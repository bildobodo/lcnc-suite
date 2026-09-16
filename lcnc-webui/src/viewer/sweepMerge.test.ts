import { describe, expect, it } from "vitest";
import { mergeEntryResult, mergedTruncated, mergedSweptFraction } from "./sweepMerge";
import type { CollisionResult } from "./collision";

const res = (over: Partial<CollisionResult>): CollisionResult => ({
  hits: [], staticContacts: [], samples: 0, coarsened: false, uncertified: null,
  pairCount: 3, pairsPrescreened: 0, bvhMs: 1, sweepMs: 10, truncated: null, ...over,
});

describe("mergeEntryResult", () => {
  it("shifts the base hits onto the entry track's axis and keeps entry hits first", () => {
    const entry = res({ hits: [{ line: 0, cum: 1.5, cumEnd: 2, a: "tool", b: "column", dist: 0, rapid: true }], samples: 4 });
    const base = res({
      hits: [{ line: 7, cum: 3, cumEnd: 4, intervals: [[3, 4]], spanCumEnd: 9, a: "tool", b: "platter", dist: 0, rapid: false }],
      samples: 100, sweepMs: 50,
    });
    const m = mergeEntryResult(entry, base, 10, 90);
    expect(m.hits.map(h => [h.line, h.cum, h.cumEnd])).toEqual([[0, 1.5, 2], [7, 13, 14]]);
    expect(m.hits[1]!.intervals).toEqual([[13, 14]]);
    expect(m.hits[1]!.spanCumEnd).toBe(19);   // the span end shifts with the rest
    expect(m.hits[0]!.spanCumEnd).toBeUndefined();
    expect(m.samples).toBe(104);
    expect(m.sweepMs).toBe(60);
    expect(m.pairCount).toBe(3);
  });
  it("one contact seen by both sweeps counts once: the entry onset takes the base's span, the base's first-line onset becomes its continuation", () => {
    // 2026-09-12: a contact begun in the entry rapid that never ends was
    // "2 clashes" — the entry sweep's onset plus the base sweep's onset on
    // line 1 (a pair clear at rest, touching at the first pose).
    const entry = res({ hits: [{ line: 0, cum: 6, cumEnd: 10, intervals: [[6, 10]], a: "ram", b: "column", dist: 0, rapid: true }] });
    const base = res({ hits: [
      { line: 1, cum: 0, cumEnd: 4, spanCumEnd: 40, spanEndLine: 9, a: "ram", b: "column", dist: 0, rapid: false },
      { line: 2, cum: 4, cumEnd: 8, continuation: 1, a: "ram", b: "column", dist: 0, rapid: false },
      { line: 5, cum: 20, cumEnd: 21, a: "tool", b: "vise", dist: 0, rapid: false },   // another pair: untouched
    ] });
    const m = mergeEntryResult(entry, base, 10, 90);
    const onsets = m.hits.filter(h => h.continuation === undefined);
    expect(onsets.map(h => [h.line, h.a, h.b])).toEqual([[0, "ram", "column"], [5, "tool", "vise"]]);
    expect(onsets[0]!.spanCumEnd).toBe(50);
    expect(onsets[0]!.spanEndLine).toBe(9);
    expect(onsets[0]!.rapid).toBe(true);
    const l1 = m.hits.find(h => h.line === 1)!;
    expect(l1.continuation).toBe(0);
    expect(l1.cum).toBe(10);
    // An entry contact that ENDS before the first point stays its own clash.
    const early = res({ hits: [{ line: 0, cum: 2, cumEnd: 5, a: "ram", b: "column", dist: 0, rapid: true }] });
    expect(mergeEntryResult(early, base, 10, 90).hits.filter(h => h.continuation === undefined)).toHaveLength(3);
  });
  it("unions static contacts by pair (two baselines: live pose and first point) and carries the base's partial state", () => {
    const entry = res({ staticContacts: [{ a: "tool", b: "vise", dist: 0.5 }] });
    const base = res({
      staticContacts: [{ a: "tool", b: "vise", dist: 0.1 }, { a: "table", b: "trunnion", dist: 1 }],
      truncated: { covered: 0.7, reason: "time" }, coarsened: true, uncertified: "kins x not evaluable",
    });
    const m = mergeEntryResult(entry, base, 5, 95);
    expect(m.staticContacts.map(c => c.a + "/" + c.b)).toEqual(["tool/vise", "table/trunnion"]);
    // TWP-12: the base's 70 % is re-based onto the MERGED axis (5 + 95):
    // (5 + 0.7 × 95) / 100 — a prefix of the route, not of the program.
    expect(m.truncated).toEqual({ covered: 0.715, reason: "time" });
    expect(m.coarsened).toBe(true);
    expect(m.uncertified).toBe("kins x not evaluable");
  });
  it("a partial ENTRY is a checked prefix that ends inside the entry move, whatever the base did (TWP-12)", () => {
    // Entry 10 long checked 25 %, base 90 long complete: the checked region
    // is [0, 2.5] ∪ [10, 100] — not a prefix, so the conservative prefix
    // is 2.5 % of the route with the entry's reason. The review probe saw
    // `null` here (the base's completeness certified the entry).
    const entry = res({ truncated: { covered: 0.25, reason: "samples" } });
    const m = mergeEntryResult(entry, res({}), 10, 90);
    expect(m.truncated).toEqual({ covered: 0.025, reason: "samples" });
    // Both partial: the entry's gap comes first.
    const m2 = mergeEntryResult(entry, res({ truncated: { covered: 0.5, reason: "time" } }), 10, 90);
    expect(m2.truncated).toEqual({ covered: 0.025, reason: "samples" });
  });
  it("a complete entry with a half-checked base rescales the base fraction onto the merged axis", () => {
    const m = mergeEntryResult(res({}), res({ truncated: { covered: 0.5, reason: "time" } }), 10, 90);
    expect(m.truncated).toEqual({ covered: 0.55, reason: "time" });
    expect(mergeEntryResult(res({}), res({}), 10, 90).truncated).toBeNull();
    expect(mergedTruncated({ covered: 1, reason: "stopped" }, null, 10, 90)).toEqual({ covered: 0.1, reason: "stopped" });
    expect(mergedTruncated(null, { covered: 0.5, reason: "time" }, 0, 0)).toEqual({ covered: 0, reason: "time" });
  });
  it("mergedSweptFraction re-bases base-relative values and passes merged ones through", () => {
    expect(mergedSweptFraction(0.5, false, 10, 90, 100)).toBeCloseTo(0.55);
    expect(mergedSweptFraction(0.5, true, 10, 90, 100)).toBe(0.5);
    expect(mergedSweptFraction(1, false, 10, 90, 100)).toBe(1);
    expect(mergedSweptFraction(2, true, 10, 90, 100)).toBe(1);
    expect(mergedSweptFraction(0.5, false, 10, 90, 0)).toBe(0);
  });
});

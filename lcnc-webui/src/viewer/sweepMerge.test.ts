import { describe, expect, it } from "vitest";
import { mergeEntryResult } from "./sweepMerge";
import type { CollisionResult } from "./collision";

const res = (over: Partial<CollisionResult>): CollisionResult => ({
  hits: [], staticContacts: [], samples: 0, coarsened: false, uncertified: null,
  pairCount: 3, bvhMs: 1, sweepMs: 10, truncated: null, ...over,
});

describe("mergeEntryResult", () => {
  it("shifts the base hits onto the entry track's axis and keeps entry hits first", () => {
    const entry = res({ hits: [{ line: 0, cum: 1.5, cumEnd: 2, a: "tool", b: "column", dist: 0, rapid: true }], samples: 4 });
    const base = res({
      hits: [{ line: 7, cum: 3, cumEnd: 4, intervals: [[3, 4]], spanCumEnd: 9, a: "tool", b: "platter", dist: 0, rapid: false }],
      samples: 100, sweepMs: 50,
    });
    const m = mergeEntryResult(entry, base, 10);
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
    const m = mergeEntryResult(entry, base, 10);
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
    expect(mergeEntryResult(early, base, 10).hits.filter(h => h.continuation === undefined)).toHaveLength(3);
  });
  it("unions static contacts by pair (two baselines: live pose and first point) and carries the base's partial state", () => {
    const entry = res({ staticContacts: [{ a: "tool", b: "vise", dist: 0.5 }] });
    const base = res({
      staticContacts: [{ a: "tool", b: "vise", dist: 0.1 }, { a: "table", b: "trunnion", dist: 1 }],
      truncated: { covered: 0.7, reason: "time" }, coarsened: true, uncertified: "kins x not evaluable",
    });
    const m = mergeEntryResult(entry, base, 5);
    expect(m.staticContacts.map(c => c.a + "/" + c.b)).toEqual(["tool/vise", "table/trunnion"]);
    expect(m.truncated).toEqual({ covered: 0.7, reason: "time" });
    expect(m.coarsened).toBe(true);
    expect(m.uncertified).toBe("kins x not evaluable");
  });
});

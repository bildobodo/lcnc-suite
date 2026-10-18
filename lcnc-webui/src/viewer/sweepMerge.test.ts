import { describe, expect, it } from "vitest";
import { mergeBeginningOntoBase, mergeEntryResult, mergedTruncated, mergedSweptFraction } from "./sweepMerge";
import type { CollisionResult } from "./collision";

// The two sweeps' METADATA (step 4 package 2, C2): what they found is their
// contact tables' — the join of one contact seen by both is contactMerge's
// (contactMerge.test.ts, contactView.test.ts "the entry move").
const res = (over: Partial<CollisionResult>): CollisionResult => ({
  staticContacts: [], samples: 0, coarsened: false, uncertified: null,
  pairCount: 3, pairsPrescreened: 0, bvhMs: 1, sweepMs: 10, truncated: null, ...over,
});

describe("mergeEntryResult", () => {
  it("adds the sweeps' counters and unites their notes — the entry move's never hide the program's", () => {
    const m = mergeEntryResult(res({ samples: 4, notes: ["entry note"], uncertified: "entry note" }),
                               res({ samples: 100, sweepMs: 50, notes: ["base note"], uncertified: "base note" }), 10, 90);
    expect(m.samples).toBe(104);
    expect(m.sweepMs).toBe(60);
    expect(m.notes).toEqual(["entry note", "base note"]);
    expect(m.uncertified).toBe("entry note; base note");
    expect("hits" in m, "no records").toBe(false);
  });
  it("keeps the model's body classes (one model for both sweeps)", () => {
    const bodies = { unusable: ["broken"], damaged: [], open: ["frame"] };
    expect(mergeEntryResult(res({}), res({ bodies }), 10, 90).bodies).toEqual(bodies);
    expect(mergeEntryResult(res({ bodies }), res({}), 10, 90).bodies).toEqual(bodies);
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
  it("a run check's bound beginning onto the base: a side cut short leaves no checked prefix; the base's range and boundary contacts stay", () => {
    const base = res({ truncated: null, range: { fromCum: 4, fromLine: 7 }, boundaryContacts: [{ a: "t", b: "w", line: 7, cum: 4, dist: 0, cutting: false }],
                       startDependent: { fromLine: 1, toLine: 3, whole: false } });
    const m = mergeBeginningOntoBase(res({ truncated: { covered: 0.4, reason: "stopped" } }), base, 5, 95);
    expect(m.truncated).toEqual({ covered: 0, reason: "stopped" });
    expect(m.range).toEqual({ fromCum: 4, fromLine: 7 });
    expect(m.boundaryContacts).toHaveLength(1);
    expect(m.startDependent, "answered by the side sweep").toBeUndefined();
    expect(mergeBeginningOntoBase(res({}), base, 5, 95).truncated, "a whole side: the base's").toBeNull();
  });
});

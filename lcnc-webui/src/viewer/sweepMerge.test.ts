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
      hits: [{ line: 7, cum: 3, cumEnd: 4, intervals: [[3, 4]], a: "tool", b: "platter", dist: 0, rapid: false }],
      samples: 100, sweepMs: 50,
    });
    const m = mergeEntryResult(entry, base, 10);
    expect(m.hits.map(h => [h.line, h.cum, h.cumEnd])).toEqual([[0, 1.5, 2], [7, 13, 14]]);
    expect(m.hits[1]!.intervals).toEqual([[13, 14]]);
    expect(m.samples).toBe(104);
    expect(m.sweepMs).toBe(60);
    expect(m.pairCount).toBe(3);
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

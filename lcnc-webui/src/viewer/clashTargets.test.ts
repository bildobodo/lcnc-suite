import { describe, it, expect } from "vitest";
import { clashTargets } from "./clashTargets";
import { mergeEntryResult } from "./sweepMerge";
import type { CollisionHit, CollisionResult } from "./collision";

const hit = (o: Partial<CollisionHit> & { line: number; cum: number }): CollisionHit =>
  ({ cumEnd: o.cum, a: "tool", b: "work", dist: 0, rapid: false, ...o }) as CollisionHit;

describe("clashTargets — one list for count, marks and navigation", () => {
  it("one record with two intervals ⇒ two targets, the second flagged re-entry", () => {
    const t = clashTargets([hit({ line: 26, cum: 45, cumEnd: 120, intervals: [[45, 50], [110, 120]] })]);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ cum: 45, cumEnd: 50, line: 26 });
    expect(t[1]).toMatchObject({ cumEnd: 120 });
    expect(new Set(t.map(x => x.key)).size, "each interval named apart").toBe(2);
    expect(t[0]!.reentry).toBeUndefined();
    expect(t[1]).toMatchObject({ cum: 110, line: 26, reentry: true });
  });
  it("a continuation record is not a clash of its own", () => {
    expect(clashTargets([hit({ line: 27, cum: 60, continuation: 26 })])).toEqual([]);
  });
  it("a near-miss (no intervals) counts once at its closest approach", () => {
    const t = clashTargets([hit({ line: 30, cum: 200, dist: 1.2 })]);
    expect(t).toEqual([{ cum: 200, cumEnd: 200, key: "C30|tool|work|0", line: 30, rapid: false, dist: 1.2, spanEndLine: undefined }]);
  });
  it("targets are cum-sorted across records and carry rapid/spanEndLine", () => {
    const t = clashTargets([
      hit({ line: 40, cum: 300, rapid: true, spanEndLine: 42 }),
      hit({ line: 26, cum: 45, cumEnd: 120, intervals: [[45, 50], [110, 120]] }),
    ]);
    expect(t.map(x => x.cum)).toEqual([45, 110, 300]);
    expect(t[2]).toMatchObject({ rapid: true, spanEndLine: 42 });
  });
  it("the entry move's contacts are named apart from the program's on the same line and pair; the program's keep their names through the merge (Codex R33 VP-I07)", () => {
    // Codex R33's XYZAC probe: the entry move ends at the first point and
    // carries L7; a contact at the live pose that the entry move leaves, and
    // the program running back into the same pair later on L7.
    const res = (hits: CollisionHit[]): CollisionResult => ({ hits, staticContacts: [], samples: 0, coarsened: false,
      uncertified: null, pairCount: 1, pairsPrescreened: 0, bvhMs: 0, sweepMs: 0, truncated: null });
    const entry = res([hit({ line: 7, cum: 0, cumEnd: 170, a: "spindle_nose", b: "a_yoke_casting", rapid: true }),
                       hit({ line: 7, cum: 0, cumEnd: 65, a: "tool", b: "a_yoke_casting", rapid: true })]);
    const base = res([hit({ line: 7, cum: 125, cumEnd: 240, intervals: [[125, 240]], a: "spindle_nose", b: "a_yoke_casting" }),
                      hit({ line: 7, cum: 232, cumEnd: 240, intervals: [[232, 240]], a: "tool", b: "a_yoke_casting" })]);
    const alone = clashTargets(base.hits);
    const merged = clashTargets(mergeEntryResult(entry, base, 300, 270).hits);
    expect(merged).toHaveLength(4);
    expect(new Set(merged.map(x => x.key)).size, "four findings, four names").toBe(4);
    expect(merged.filter(x => x.entry).map(x => x.cum)).toEqual([0, 0]);
    // A program contact chosen before the entry result arrived is found by
    // its name after it, on the shifted axis
    for (const a of alone) {
      const same = merged.find(x => x.key === a.key)!;
      expect(same.entry).toBeUndefined();
      expect(same.cum).toBe(a.cum + 300);
    }
  });
});

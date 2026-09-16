import { describe, it, expect } from "vitest";
import { clashTargets } from "./clashTargets";
import type { CollisionHit } from "./collision";

const hit = (o: Partial<CollisionHit> & { line: number; cum: number }): CollisionHit =>
  ({ cumEnd: o.cum, a: "tool", b: "work", dist: 0, rapid: false, ...o }) as CollisionHit;

describe("clashTargets — one list for count, marks and navigation", () => {
  it("one record with two intervals ⇒ two targets, the second flagged re-entry", () => {
    const t = clashTargets([hit({ line: 26, cum: 45, cumEnd: 120, intervals: [[45, 50], [110, 120]] })]);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ cum: 45, line: 26 });
    expect(t[0]!.reentry).toBeUndefined();
    expect(t[1]).toMatchObject({ cum: 110, line: 26, reentry: true });
  });
  it("a continuation record is not a clash of its own", () => {
    expect(clashTargets([hit({ line: 27, cum: 60, continuation: 26 })])).toEqual([]);
  });
  it("a near-miss (no intervals) counts once at its closest approach", () => {
    const t = clashTargets([hit({ line: 30, cum: 200, dist: 1.2 })]);
    expect(t).toEqual([{ cum: 200, line: 30, rapid: false, dist: 1.2, spanEndLine: undefined }]);
  });
  it("targets are cum-sorted across records and carry rapid/spanEndLine", () => {
    const t = clashTargets([
      hit({ line: 40, cum: 300, rapid: true, spanEndLine: 42 }),
      hit({ line: 26, cum: 45, cumEnd: 120, intervals: [[45, 50], [110, 120]] }),
    ]);
    expect(t.map(x => x.cum)).toEqual([45, 110, 300]);
    expect(t[2]).toMatchObject({ rapid: true, spanEndLine: 42 });
  });
});

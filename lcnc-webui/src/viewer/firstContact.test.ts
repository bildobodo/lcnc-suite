import { describe, expect, it } from "vitest";
import { firstOnly, holdsFirst, sameOnset, withFirstContact } from "./firstContact";
import type { CollisionHit, CollisionResult } from "./collision";

const hit = (line: number, dist: number, over: Partial<CollisionHit> = {}): CollisionHit =>
  ({ line, cum: line, cumEnd: line, a: "spindle_nose", b: "vise", dist, rapid: false, ...over });
const result = (hits: CollisionHit[]): CollisionResult => ({ hits, staticContacts: [], samples: 5, coarsened: false,
  uncertified: null, pairCount: 9, pairsPrescreened: 3, bvhMs: 0, sweepMs: 0, truncated: { covered: 0.3, reason: "running" } });

describe("the first confirmed contact folded into what is shown (Codex R136 VP-I91)", () => {
  it("replaces the record of the same onset — a near miss until the touch — and keeps every other", () => {
    const first = hit(7, 1.5, { touches: true });
    const r = withFirstContact(result([hit(3, 0, { b: "column" }), hit(7, 1.5), hit(9, 1.2, { b: "table" })]), first);
    expect(r.hits.map(h => [h.line, h.b, h.touches ?? false])).toEqual([[3, "column", false], [7, "vise", true], [9, "table", false]]);
    // the rest of the result as it was
    expect([r.pairCount, r.pairsPrescreened, r.truncated]).toEqual([9, 3, { covered: 0.3, reason: "running" }]);
  });
  it("joins in track order where the partial has no record of it", () => {
    expect(withFirstContact(result([hit(9, 1.5, { b: "table" })]), hit(4, 0)).hits.map(h => h.line)).toEqual([4, 9]);
  });
  it("is the same onset only as a program onset: not a continuation, a boundary record or the entry move's", () => {
    const f = hit(7, 0);
    expect(sameOnset(hit(7, 2), f)).toBe(true);
    for (const other of [hit(7, 0, { continuation: 5 }), hit(7, 0, { boundary: true }), hit(7, 0, { entry: true }),
                         hit(8, 0), hit(7, 0, { b: "table" })]) expect(sameOnset(other, f)).toBe(false);
  });
  it("is held only as a confirmed contact: a near miss of the onset is not yet the first", () => {
    const f = hit(7, 1.5, { touches: true });
    expect(holdsFirst(result([hit(7, 1.5)]), f)).toBe(false);
    expect(holdsFirst(result([hit(7, 1.5, { touches: true })]), f)).toBe(true);
    expect(holdsFirst(result([hit(7, 0)]), f)).toBe(true);
    expect(holdsFirst(null, f)).toBe(false);
  });
  it("alone: a running result of the contact only", () => {
    expect(firstOnly(hit(7, 0), 0.25)).toMatchObject({ hits: [hit(7, 0)], truncated: { covered: 0.25, reason: "running" } });
  });
});

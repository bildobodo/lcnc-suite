import { describe, expect, it } from "vitest";
import type { CollisionHit } from "./collision";
import { collisionLineMarks, collisionMarkByLine } from "./collisionMarks";

// Codex R116 VP-I69: a provisional record (a contact in progress where a
// range sweep began) must reach the code panel as provisional — its onset
// and kind are the full check's.
const hit = (line: number, over: Partial<CollisionHit> = {}) =>
  ({ line, a: "tool", b: "a_yoke_casting", dist: 0, cum: 0, rapid: false, ...over }) as CollisionHit;

describe("the code panel's collision marks", () => {
  it("keep a boundary record provisional, and a record's continuation", () => {
    expect(collisionLineMarks([hit(7), hit(8, { boundary: true }), hit(9, { continuation: 7 })])).toEqual([
      { line: 7, continuation: undefined }, { line: 8, continuation: undefined, boundary: true }, { line: 9, continuation: 7 }]);
  });
  it("give a line a collision's own record over a provisional one, in either order", () => {
    const own = { line: 7 }, prov = { line: 7, boundary: true as const };
    expect(collisionMarkByLine([own, prov]).get(7)).toBe(own);
    expect(collisionMarkByLine([prov, own]).get(7)).toBe(own);
    expect(collisionMarkByLine([prov]).get(7)).toBe(prov);
    const first = { line: 8, continuation: 7 }, second = { line: 8 };
    expect(collisionMarkByLine([first, second]).get(8), "two records of their own: the first").toBe(first);
  });
});

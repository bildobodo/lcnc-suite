// The G-code panel's collision marks (Codex R116 VP-I69): kept apart from
// collision.ts, which carries the sweep (three-mesh-bvh) — the code panel is
// in the main bundle, the viewer is loaded on its own.
import type { CollisionHit, CollisionLineMark } from "./collision";

/** The marks for a result's records — a boundary record stays provisional
 *  (in contact at a range sweep's start: no onset, no kind known yet). */
export function collisionLineMarks(hits: readonly CollisionHit[]): CollisionLineMark[] {
  return hits.map(h => ({ line: h.line, continuation: h.continuation, ...(h.boundary ? { boundary: true as const } : {}),
                          ...(h.possible ? { possible: true as const } : {}) }));
}

/** One mark per line: a collision's own record over a provisional one,
 *  whichever comes first — a boundary contact's line can hold a contact of
 *  its own. */
export function collisionMarkByLine(marks: readonly CollisionLineMark[]): Map<number, CollisionLineMark> {
  const m = new Map<number, CollisionLineMark>();
  for (const c of marks) {
    const had = m.get(c.line);
    // a certain record over a possible one (a braking range, parity-ef F2)
    if (!had || (had.boundary && !c.boundary) || (had.possible && !c.possible && !c.boundary)) m.set(c.line, c);
  }
  return m;
}

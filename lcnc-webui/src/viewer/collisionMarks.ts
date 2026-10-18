// The G-code panel's collision marks (Codex R116 VP-I69): kept apart from
// collision.ts, which carries the sweep (three-mesh-bvh) — the code panel is
// in the main bundle, the viewer is loaded on its own.
import type { CollisionLineMark } from "./collision";

/** The code panel's mark for a line, asked per visible line (step 4 package
 *  2, plan 4.2: no set over every line) — null: no mark. A new function per
 *  change of what is shown. */
export type CollisionLineQuery = (line: number) => CollisionLineMark | null;

// Which bodies glow at a scrub position (the clash tint). Pure: ThreeViewer
// applies it to the meshes. The decision is made PER PAIR (operator
// 2026-10-06, live on haus.ngc: the Y saddle, the yoke and the A bearings
// stayed in contact with the column to the end of the program, but their
// tint went out on every line where ANOTHER pair had a record — the
// "record on this line" test was one for the whole line).
import type { CollisionHit } from "./collision";

/** A contact the tint shows: no near-miss, a real touch. */
export const CONTACT_TINT_EPS = 1e-3;

const pairOf = (h: CollisionHit) => `${h.a}\u0000${h.b}`;

/**
 * The bodies in contact at (`line`, `cum`):
 * - a pair WITH a record on this line glows inside that record's refined
 *   intervals — contact within a line can be intermittent, and the
 *   verified-clear gaps between the intervals never glow;
 * - a pair WITHOUT a record on this line (past the MAX_HITS cap of a contact
 *   that never separates) glows while the cum lies inside one of its onsets'
 *   SPAN — the contact has provably not cleared there.
 */
export function clashTintBodies(hits: readonly CollisionHit[], line: number, cum: number): Set<string> {
  const want = new Set<string>();
  const recordHere = new Set<string>();
  for (const h of hits) if (h.line === line && h.dist <= CONTACT_TINT_EPS) recordHere.add(pairOf(h));
  for (const h of hits) {
    if (h.dist > CONTACT_TINT_EPS) continue;
    if (h.line === line) {
      const ivs = h.intervals ?? [[h.cum, h.cumEnd] as [number, number]];
      if (ivs.some(([en, ex]) => cum >= en - CONTACT_TINT_EPS && cum <= ex + CONTACT_TINT_EPS)) {
        want.add(h.a);
        want.add(h.b);
      }
    } else if (!recordHere.has(pairOf(h)) && h.continuation === undefined && h.spanCumEnd != null
               && cum > h.cumEnd && cum <= h.spanCumEnd + CONTACT_TINT_EPS) {
      want.add(h.a);
      want.add(h.b);
    }
  }
  return want;
}

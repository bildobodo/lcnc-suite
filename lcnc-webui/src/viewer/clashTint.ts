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
 * The bodies in contact at (`line`, `cum`), per PAIR:
 * - a pair glows while the cum lies inside a refined contact interval of ANY
 *   of its records — intervals are track cum, so no line match: the entry
 *   move's onset starts at cum 0 on the raw line 0, and a matched line lost
 *   it; a `carried` first interval counts (the metal touches — only the
 *   finding count skips it); the verified-clear gaps between intervals stay
 *   dark;
 * - a pair with NO record of its own on this line — of any distance: a
 *   near-miss continuation is proximity, not contact — glows while the cum
 *   lies inside one of its onsets' SPAN (past the MAX_HITS cap of a contact
 *   that never separated). Fable's review, 2026-10-06.
 */
export function clashTintBodies(hits: readonly CollisionHit[], line: number, cum: number): Set<string> {
  const want = new Set<string>();
  const recordHere = new Set<string>();
  for (const h of hits) if (h.line === line) recordHere.add(pairOf(h));
  const glow = (h: CollisionHit) => { want.add(h.a); want.add(h.b); };
  for (const h of hits) {
    if (h.dist > CONTACT_TINT_EPS) continue;
    const ivs = h.intervals ?? [[h.cum, h.cumEnd] as [number, number]];
    if (ivs.some(([en, ex]) => cum >= en - CONTACT_TINT_EPS && cum <= ex + CONTACT_TINT_EPS)) glow(h);
    else if (!recordHere.has(pairOf(h)) && h.continuation === undefined && h.spanCumEnd != null
             && cum > h.cumEnd && cum <= h.spanCumEnd + CONTACT_TINT_EPS) glow(h);
  }
  return want;
}

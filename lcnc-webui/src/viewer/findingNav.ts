// Finding navigation on the scrub timeline (Codex R32 VP-I05/I06): where a
// jump to a finding samples, which finding prev/next reach, and how a chosen
// finding survives the entry track a jump into the simulation builds. Pure.
//
// The timeline axis is seconds (or mm on a distance axis), so a FIXED nudge
// or window decided whether a short move or a close finding was reachable at
// all: a 0.1 ms violating move was jumped past into the next line, and a
// finding 5 ms after the one shown was never "next". A jump now samples
// INSIDE the finding's own extent; prev/next skip the finding just shown by
// its identity and otherwise compare where a jump would land.

/** A finding as the timeline addresses it: its extent [cum, cumEnd] on the
 *  displayed track and a key that names it (a limit line, a contact interval). */
export interface NavTarget { cum: number; cumEnd: number; key: string }

/** The finding the last jump showed, and where it left the timeline — its
 *  identity counts only while the position is still that (a scrub, playback
 *  or a run moves it: then prev/next go by position). */
export interface NavSelection { key: string; pos: number }

/** How far past a finding's start a jump samples at most: a segment's start
 *  cum is the previous segment's end, where the sample would name the
 *  previous line. Never more than half the finding's own extent. */
export const JUMP_NUDGE = 1e-3;

export function sampleCum(t: { cum: number; cumEnd: number }): number {
  const room = t.cumEnd - t.cum;
  return room > 0 ? t.cum + Math.min(JUMP_NUDGE, room / 2) : t.cum;
}

function selectedIndex<T extends NavTarget>(list: readonly T[], s: number, sel: NavSelection | null): number {
  return sel && sel.pos === s ? list.findIndex(f => f.key === sel.key) : -1;
}

/** The finding after the one shown (by identity), else the first a jump
 *  would land past `s`; wraps to the first. */
export function targetAfter<T extends NavTarget>(list: readonly T[], s: number, sel: NavSelection | null): T | null {
  if (!list.length) return null;
  const i = selectedIndex(list, s, sel);
  if (i >= 0) return list[(i + 1) % list.length]!;
  return list.find(f => sampleCum(f) > s) ?? list[0]!;
}

/** The finding before the one shown (by identity), else the last a jump
 *  would land before `s`; wraps to the last. */
export function targetBefore<T extends NavTarget>(list: readonly T[], s: number, sel: NavSelection | null): T | null {
  if (!list.length) return null;
  const i = selectedIndex(list, s, sel);
  if (i >= 0) return list[(i - 1 + list.length) % list.length]!;
  for (let k = list.length - 1; k >= 0; k--) if (sampleCum(list[k]!) < s) return list[k]!;
  return list[list.length - 1]!;
}

/** A finding chosen on one track, expressed on another built from the same
 *  base with a different entry move in front (`entryFrom` / `entryTo`: the
 *  entry move's length on each, 0 = none): a program finding moves by the
 *  difference, a finding ON the entry move stays on the entry move, scaled
 *  with it — never shifted like a program finding. */
export function mapAcrossEntry<T extends NavTarget>(t: T, entryFrom: number, entryTo: number): T {
  const at = (p: number) => (p < entryFrom ? (entryFrom > 0 ? (p / entryFrom) * entryTo : 0) : p - entryFrom + entryTo);
  return { ...t, cum: at(t.cum), cumEnd: at(t.cumEnd) };
}

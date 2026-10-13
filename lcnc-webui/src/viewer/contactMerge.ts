// Step 4 package 2, round A5: the merges on contact tables (plan
// docs/reviews/kollision-paket2.plan.md Fassung 5, 3.2 and 3.3). Pure: they
// read stores and say how rows relate; nothing is copied into a merged table —
// the views (round B) read the stores themselves.
import { IV_ENDED_AT_GAP, NONE, type ContactStore } from "./contactStore";

/** The base intervals that CONTINUE an entry contact — one contact seen by
 *  both sweeps, counted once (plan 3.3, as mergeEntryResult today): an entry
 *  interval still ON where the entry move ends, and the FIRST interval of a
 *  base episode of the same pair in contact AT the program's first point. Later
 *  intervals of that base episode stay the program's re-entries (Codex R34
 *  VP-I09). One to one; map base interval row → entry interval row.
 *
 *  Still on means OPEN: no exit, and not ended at a knowledge gap (an unknown
 *  tool ends a contact without an exit — Codex R144 VP-I97). An entry contact
 *  with an exit ended before the first point: the sweep closes one only at a
 *  decided free sample after it, which is its separation evidence — no
 *  nearness tolerance joins across it. In contact at the first point means
 *  its interval begins AT the base's first checked point `baseStart` (cum 0,
 *  or a start-dependent beginning's end; the first pose touches, so the entry
 *  is the floor itself) — never a re-entry after it, whatever the entry's
 *  length; the tolerance is the float's, not a nearness. */
export function entryJoins(entry: ContactStore, base: ContactStore, baseStart = 0): Map<number, number> {
  const atStart = baseStart + 1e-9 * Math.max(1, Math.abs(baseStart));
  const out = new Map<number, number>();
  // the entry's contacts still on at its end, per pair
  const atEnd = new Map<number, number[]>();
  const EI = entry.intervals, EE = entry.episodes;
  for (let iv = 0; iv < EI.rows; iv++) {
    if (!Number.isNaN(EI.get(iv, "exit")) || (EI.get(iv, "flags") & IV_ENDED_AT_GAP)) continue;
    const pair = EE.get(EI.get(iv, "episode"), "pair");
    atEnd.set(pair, [...(atEnd.get(pair) ?? []), iv]);
  }
  const BE = base.episodes, BI = base.intervals;
  for (let e = 0; e < BE.rows; e++) {
    const first = BE.get(e, "firstIv");
    if (first === NONE || BI.get(first, "enter") > atStart) continue;
    const cands = atEnd.get(BE.get(e, "pair"));
    if (!cands?.length) continue;
    out.set(first, cands.shift()!);
  }
  return out;
}

/** A run check's bound beginning on the base axis (plan 3.3, a named display
 *  limit as today): every cum at max(0, c − shift). Rows keep their identity —
 *  several events mapped to 0 stay apart; nothing is merged by position. */
export const toBaseAxis = (c: number, shift: number): number => Math.max(0, c - shift);


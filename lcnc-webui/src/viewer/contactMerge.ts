// Step 4 package 2, round A5: the merges on contact tables (plan
// docs/reviews/kollision-paket2.plan.md Fassung 5, 3.2 and 3.3). Pure: they
// read stores and say how rows relate; nothing is copied into a merged table —
// the views (round B) read the stores themselves.
import { NONE, type ContactStore } from "./contactStore";

/** The base intervals that CONTINUE an entry contact — one contact seen by
 *  both sweeps, counted once (plan 3.3, as mergeEntryResult today): an entry
 *  interval still in contact where the entry move ends (open, or its exit at
 *  the first point), and the FIRST interval of a base episode of the same pair
 *  that is in contact at the program's first point. Later intervals of that
 *  base episode stay the program's re-entries (Codex R34 VP-I09). One to one;
 *  map base interval row → entry interval row. `shift` is the entry track's
 *  cum at the program's first point. */
export function entryJoins(entry: ContactStore, base: ContactStore, shift: number): Map<number, number> {
  const tol = 1e-3 * Math.max(1, shift);
  const out = new Map<number, number>();
  // the entry's contacts still on at its end, per pair
  const atEnd = new Map<number, number[]>();
  const EI = entry.intervals, EE = entry.episodes;
  for (let iv = 0; iv < EI.rows; iv++) {
    const exit = EI.get(iv, "exit");
    if (!(Number.isNaN(exit) || exit >= shift - tol)) continue;
    const pair = EE.get(EI.get(iv, "episode"), "pair");
    atEnd.set(pair, [...(atEnd.get(pair) ?? []), iv]);
  }
  const BE = base.episodes, BI = base.intervals;
  for (let e = 0; e < BE.rows; e++) {
    const first = BE.get(e, "firstIv");
    if (first === NONE || BI.get(first, "enter") > tol) continue;
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

/** A pool's coverage (plan 2.4): the least any shard swept, and the earliest
 *  point any shard's budget stopped it. */
export function poolCoverage(shards: ReadonlyArray<{ covered: number; incompleteFrom?: number }>): { covered: number; incompleteFrom?: number } {
  let covered = 1, from: number | undefined;
  for (const s of shards) {
    covered = Math.min(covered, s.covered);
    if (s.incompleteFrom !== undefined) from = from === undefined ? s.incompleteFrom : Math.min(from, s.incompleteFrom);
  }
  return from === undefined ? { covered } : { covered, incompleteFrom: from };
}

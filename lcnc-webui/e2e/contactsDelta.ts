// Contact tables for a spec's fake worker answers (step 4 package 2, round
// B3): the views read the tables, so a side request a spec answers itself
// carries its contacts as the worker would — StoreDelta built here with the
// real ContactStore, sent through page.evaluate as plain data and rebuilt as
// typed arrays in the page (`window.__fromWire`, installed by FROM_WIRE_INIT).
import { ContactStore, EP_RAPID, IV_ENTER_DECIDED, IV_EXIT_DECIDED, NONE, type StoreDelta } from "../src/viewer/contactStore";

type WireCol = { t: string; v: number[] };
interface WireTable { from: number; count: number; rows: Record<string, WireCol>; updates: number[]; updated: Record<string, WireCol> }
export interface WireDelta { request: number; generation: number; episodes: WireTable; intervals: WireTable; gaps: WireTable }

const col = (a: ArrayLike<number> & { constructor: { name: string } }): WireCol => ({ t: a.constructor.name, v: Array.from(a) });
const table = (t: StoreDelta["episodes"]): WireTable => ({
  from: t.from, count: t.count, updates: Array.from(t.updates),
  rows: Object.fromEntries(Object.entries(t.rows).map(([k, a]) => [k, col(a)])),
  updated: Object.fromEntries(Object.entries(t.updated).map(([k, a]) => [k, col(a)])),
});

/** The store's next delta as plain data (forced: an empty one rides with a
 *  result), acknowledged on the spec's side at once. */
export function wireDelta(st: ContactStore): WireDelta {
  const d = st.takeDelta(true)!;
  st.ack();
  return { request: d.request, generation: d.generation, episodes: table(d.episodes), intervals: table(d.intervals), gaps: table(d.gaps) };
}

/** A side request's table with ONE contact of `pair` from `at` (the side
 *  run's first confirmed contact, on a rapid) — to `exit`, open without. */
export function oneContact(request: number, pair: number, at: number, exit = NaN): ContactStore {
  const st = new ContactStore(request, 0);
  const ep = st.episodes.append({ pair, ordinal: 0, flags: EP_RAPID, onset: at, end: exit, closeAt: at, closeDist: 0, firstIv: NONE, ivCount: 1 });
  st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: at, exit, flags: IV_ENTER_DECIDED | (Number.isNaN(exit) ? 0 : IV_EXIT_DECIDED),
                                                      next: NONE, witness: at, freeAt: NaN }));
  return st;
}

/** Installs `window.__fromWire` in the page: a WireDelta back to a StoreDelta. */
export const FROM_WIRE_INIT = `window.__fromWire = (w) => {
  const c = (x) => new globalThis[x.t](x.v);
  const tbl = (t) => ({ from: t.from, count: t.count, updates: Uint32Array.from(t.updates),
    rows: Object.fromEntries(Object.entries(t.rows).map(([k, x]) => [k, c(x)])),
    updated: Object.fromEntries(Object.entries(t.updated).map(([k, x]) => [k, c(x)])) });
  return { request: w.request, generation: w.generation, episodes: tbl(w.episodes), intervals: tbl(w.intervals), gaps: tbl(w.gaps) };
};`;

// Step 4 package 2, round B3: which contact tables a shown track reads
// (plan docs/reviews/kollision-paket2.plan.md Fassung 5, sections 3.3 and 4).
// The viewer keeps its shown-result state (the refined result, the live
// partial, the entry overlay, a run check's bound beginning); this module
// turns the requests behind exactly what is shown into ONE contact view —
// the base request's tables on the shown axis, a side run's beside them, the
// entry contacts the base continues joined (contactMerge.entryJoins). Pure
// apart from the receiver it reads.
import { entryJoins } from "./contactMerge";
import { buildContactViewSteps, lineRuns, runsOf, trackLineAt, type ContactSource, type ContactView, type LineAt, type SourceJoin, type ViewCounts } from "./contactView";
import { runToEnd, type Steps } from "./steps";
import type { GenerationTables } from "./contactPublisher";
import type { ContactStore } from "./contactStore";

/** How a source's cum lands on the shown axis: as it is; shifted by the
 *  entry move in front of it (`plus`); a run check's bound beginning mapped
 *  onto the base, max(0, c − shift) (`minus` — a named display limit, plan 3.3). */
export type ShownMap = { kind: "plus" | "minus"; shift: number } | null;

const atOf = (m: ShownMap): ((c: number) => number) =>
  !m ? c => c : m.kind === "plus" ? c => c + m.shift : c => Math.max(0, c - m.shift);

/** One request as the shown axis reads it — plain data (its JSON is the
 *  view's cache key with the tables' version). */
export interface ShownSource {
  id: number;
  map: ShownMap;
  /** On the shown axis, how far it is swept: an open interval runs to here. */
  coverage: number;
  /** Its own track's end: a fallen-back pool's coverage (track fractions)
   *  reaches its own axis through it (Codex R150 VP150-02). */
  ownEnd: number;
  /** On its OWN axis, how far it is swept — given for a source the map folds
   *  (a run check's beginning, all at 0 on the base axis): the shown 0 says
   *  nothing about how much of the beginning is checked (Codex R149 VP-I108),
   *  so the check's own limit goes in beside the shown one. */
  ownCoverage?: number;
  /** A side run's (the entry move, a bound beginning): keyed `E`. */
  entry?: boolean;
  /** On its OWN axis, where the entry move ends. */
  entryEnd?: number;
  /** The side run swept to its end — the point the base begins at — so a
   *  contact still on there continues the base's. An answer is not a whole
   *  check: a side stopped early (its budget, a stop) has an unchecked rest,
   *  and its open contact ends at its coverage, joined to nothing (Codex R149
   *  VP-I109); a running side's is open because it runs. */
  sweptToEnd?: boolean;
  /** A folded source's own track (a run check's beginning): its events' lines
   *  are this track's. Left out of the cache key (`specKey`). */
  track?: OwnTrack;
}

type OwnTrack = { count: number; cum: ArrayLike<number>; lines: ArrayLike<number>; brk?: ArrayLike<number> };
const ownTracks = new WeakMap<object, NonNullable<ContactSource["ownTrack"]>>();
function ownTrackOf(t: OwnTrack): NonNullable<ContactSource["ownTrack"]> {
  let o = ownTracks.get(t);
  if (!o) {
    const runs = lineRuns(t);
    o = { lineAt: trackLineAt(t), runs: (line: number) => runsOf(runs, line) };
    ownTracks.set(t, o);
  }
  return o;
}

/** The spec as a cache key: its data, never a track's arrays. */
export const specKey = (spec: ShownSpec): string => JSON.stringify(spec, (k, v) => (k === "track" ? undefined : v));

/** A shown track's contact view and the track's line at a position — and
 *  what the bar reads of it, built with it in bounded steps and published
 *  with it (plan 3.6): the counts, the start targets, the timeline's marks and
 *  bands at `cols` columns over `axisEnd`. */
export interface ShownContacts {
  view: ContactView;
  lineAt: LineAt;
  derived?: { counts: ViewCounts; starts: number[]; ticks: Array<{ pct: number; near: boolean }>; bands: Array<[number, number]>;
              cols: number; axisEnd: number;
              /** The boundary contacts' stretches (boundaryStretches). */
              boundaries?: Array<{ a: string; b: string; s: number; e: number }> };
}

export interface ShownSpec { base: ShownSource | null; side: ShownSource | null; axisEnd: number }

/** The view of `spec` from the tables `tables` holds, null without any. Each
 *  request names its own pairs; joining an entry contact to the base's needs
 *  ONE model's pairs — `warn` hears a mismatch, and nothing is joined then.
 *  `held` gives a request's EARLIER generation (a pool fell back to one core,
 *  plan 3.5): its source then shows the union of both. */
export function shownContactView(tables: (id: number) => GenerationTables | null, spec: ShownSpec,
                                 warn: (msg: string) => void = m => console.error(m),
                                 held: (id: number) => GenerationTables | null = () => null): ContactView | null {
  return runToEnd(shownContactViewSteps(tables, spec, warn, held));
}
/** shownContactView in bounded steps (plan 3.6). */
export function* shownContactViewSteps(tables: (id: number) => GenerationTables | null, spec: ShownSpec,
                                       warn: (msg: string) => void = m => console.error(m),
                                       held: (id: number) => GenerationTables | null = () => null): Steps<ContactView | null> {
  const sources: ContactSource[] = [];
  const parts: Array<{ s: ShownSource; t: GenerationTables }> = [];
  for (const s of [spec.base, spec.side]) {
    const t = s ? tables(s.id) : null;
    if (!s || !t || !t.stores.length) continue;
    parts.push({ s, t });
    const h = held(s.id);
    // the pairs' names come with a generation's first delta: the earlier one's until then
    const own = t.pairs ?? h?.pairs ?? null;
    sources.push({ stores: t.stores, at: atOf(s.map), coverage: s.coverage,
                   ...(h?.stores.length ? { held: h.stores, ...(h.covered ? { heldCoverage: h.covered.map(f => f * s.ownEnd) } : {}) } : {}),
                   ...(s.ownCoverage !== undefined ? { ownCoverage: s.ownCoverage } : {}),
                   ...(own ? { pairName: (p: number) => { const n = own[p]; return n ? { a: n[0], b: n[1] } : { a: `pair ${p}`, b: "" }; } } : {}),
                   ...(s.track ? { ownTrack: ownTrackOf(s.track) } : {}),
                   ...(s.entry ? { entry: true, ...(s.entryEnd !== undefined ? { entryEnd: s.entryEnd } : {}) } : {}) });
  }
  if (!sources.length) return null;
  const pairs = parts.find(p => p.t.pairs)?.t.pairs ?? null;
  let oneModel = true;
  if (parts.length === 2) {
    const [a, b] = [parts[0]!.t.pairs, parts[1]!.t.pairs];
    if (!a || !b || a.length !== b.length || a.some((p, k) => p[0] !== b[k]![0] || p[1] !== b[k]![1])) {
      oneModel = false;
      warn(`[contacts] requests ${parts[0]!.s.id} and ${parts[1]!.s.id} do not name one model's pairs — no entry contact joined`);
    }
  }
  // the joins, between every generation of the side that swept to its end
  // and every generation of the base: after a fallback the earlier
  // generation's rows are shown too, and a continuation they hold is the
  // entry's all the same (Codex R151 VP-I111)
  const joins: SourceJoin[] = [];
  const bi = parts.findIndex(p => p.s === spec.base), si = parts.findIndex(p => p.s === spec.side);
  if (bi >= 0 && si >= 0 && oneModel) {
    const gensOf = (k: number) => {
      const p = parts[k]!, h = held(p.s.id);
      const out: Array<{ stores: readonly ContactStore[]; held: boolean; whole: boolean }> = [{ stores: p.t.stores, held: false, whole: !!p.s.sweptToEnd }];
      // an earlier generation swept to its end when every shard of it did
      if (h?.stores.length) out.push({ stores: h.stores, held: true, whole: !!h.covered?.length && h.covered.every(f => f >= 1) });
      return out;
    };
    for (const eg of gensOf(si)) {
      if (!eg.whole) continue;
      for (const bg of gensOf(bi)) {
        for (let ek = 0; ek < eg.stores.length; ek++) {
          for (let bk = 0; bk < bg.stores.length; bk++) {
            // a pass over the base's episodes: one step
            const j = entryJoins(eg.stores[ek]!, bg.stores[bk]!, 0);
            if (j.size) joins.push({ entrySrc: si, baseSrc: bi, joins: j, entryShard: ek, baseShard: bk, entryHeld: eg.held, baseHeld: bg.held });
            yield;
          }
        }
      }
    }
  }
  return yield* buildContactViewSteps({
    sources,
    pairName: p => { const n = pairs?.[p]; return n ? { a: n[0], b: n[1] } : { a: `pair ${p}`, b: "" }; },
    coverage: spec.axisEnd,
    joins,
  });
}

// Step 4 package 2, round B3: which contact tables a shown track reads
// (plan docs/reviews/kollision-paket2.plan.md Fassung 5, sections 3.3 and 4).
// The viewer keeps its shown-result state (the refined result, the live
// partial, the entry overlay, a run check's bound beginning); this module
// turns the requests behind exactly what is shown into ONE contact view —
// the base request's tables on the shown axis, a side run's beside them, the
// entry contacts the base continues joined (contactMerge.entryJoins). Pure
// apart from the receiver it reads.
import { entryJoins } from "./contactMerge";
import { buildContactView, lineRuns, runsOf, trackLineAt, type ContactSource, type ContactView, type LineAt, type SourceJoin } from "./contactView";
import type { GenerationTables } from "./contactsReceiver";

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
  /** A side run's (the entry move, a bound beginning): keyed `E`. */
  entry?: boolean;
  /** On its OWN axis, where the entry move ends. */
  entryEnd?: number;
  /** The side run has its result: its contacts still on at its end continue
   *  the base's (a running side's open interval is open because it runs). */
  done?: boolean;
  /** A folded source's own track (a run check's beginning): its events' lines
   *  are this track's. Left out of the cache key (`specKey`). */
  track?: OwnTrack;
}

type OwnTrack = { count: number; cum: ArrayLike<number>; lines: ArrayLike<number> };
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

/** A shown track's contact view and the track's line at a position. */
export interface ShownContacts { view: ContactView; lineAt: LineAt }

export interface ShownSpec { base: ShownSource | null; side: ShownSource | null; axisEnd: number }

/** The view of `spec` from the tables `tables` holds, null without any. Each
 *  request names its own pairs; joining an entry contact to the base's needs
 *  ONE model's pairs — `warn` hears a mismatch, and nothing is joined then. */
export function shownContactView(tables: (id: number) => GenerationTables | null, spec: ShownSpec,
                                 warn: (msg: string) => void = m => console.error(m)): ContactView | null {
  const sources: ContactSource[] = [];
  const parts: Array<{ s: ShownSource; t: GenerationTables }> = [];
  for (const s of [spec.base, spec.side]) {
    const t = s ? tables(s.id) : null;
    if (!s || !t || !t.stores.length) continue;
    parts.push({ s, t });
    const own = t.pairs;
    sources.push({ stores: t.stores, at: atOf(s.map), coverage: s.coverage,
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
  const joins: SourceJoin[] = [];
  const bi = parts.findIndex(p => p.s === spec.base), si = parts.findIndex(p => p.s === spec.side);
  if (bi >= 0 && si >= 0 && spec.side!.done && oneModel) {
    parts[si]!.t.stores.forEach((es, ek) => parts[bi]!.t.stores.forEach((bs, bk) => {
      const j = entryJoins(es, bs, 0);
      if (j.size) joins.push({ entrySrc: si, baseSrc: bi, joins: j, entryShard: ek, baseShard: bk });
    }));
  }
  return buildContactView({
    sources,
    pairName: p => { const n = pairs?.[p]; return n ? { a: n[0], b: n[1] } : { a: `pair ${p}`, b: "" }; },
    coverage: spec.axisEnd,
    joins,
  });
}

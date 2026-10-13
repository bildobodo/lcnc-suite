// Step 4 package 2, round B1: ONE derivation for every view of the contact
// tables (plan docs/reviews/kollision-paket2.plan.md Fassung 5, section 4;
// Codex R139–R146). Pure: the store's typed columns go in, the views take
// what they need out of ONE index — the count and the words, prev/next, the
// list's window, the code panel's mark per line, the tint per pair, the
// timeline's bands at display resolution. No object per event: objects exist
// only for what a caller asks for (a list window, one navigation answer).
//
// The sources are one or more requests' tables on the axis the view shows
// (the program's base track; the entry move's in front of it in a
// simulation; a run check's beginning mapped onto the base). Positions in the
// tables are their own track's cum; `at` places them on the shown axis.
import {
  EP_AT_START, EP_ORIGIN_MASK, EP_POSSIBLE, EP_RAPID, IV_CONTINUES_CUT, IV_ENDED_AT_GAP, IV_POSSIBLE, NONE,
  ORIGIN_BOUNDARY, type ContactStore,
} from "./contactStore";
import type { ClashTarget } from "./clashTargets";
import type { CollisionLineMark } from "./collision";
import { JUMP_NUDGE } from "./findingNav";

/** One request's tables as a view reads them. */
export interface ContactSource {
  /** Its tables (a pool's are per shard; their pairs are disjoint). */
  stores: readonly ContactStore[];
  /** Places one of its cums on the shown axis (monotone). */
  at: (c: number) => number;
  /** The entry move's request: its findings are keyed `E`, the program's `C`. */
  entry?: boolean;
  /** On the shown axis, where the entry move itself ends: an entry finding
   *  before it is ON the entry move, one after it on the bound beginning. */
  entryEnd?: number;
  /** On the shown axis, how far THIS source is swept — an open interval of
   *  it runs to here (a side run's whole track; default the view's). */
  coverage?: number;
}

/** A base interval that continues an entry contact (contactMerge.entryJoins):
 *  counted once, as the entry's; its extent reaches the base interval's exit. */
export interface SourceJoin { entrySrc: number; baseSrc: number; joins: ReadonlyMap<number, number>; baseShard: number; entryShard: number }

export interface ContactViewInput {
  sources: readonly ContactSource[];
  /** The tool / work body ids of a model pair. */
  pairName: (pair: number) => { a: string; b: string };
  /** On the shown axis, how far the check has swept: an open interval runs
   *  to here (plan 4.3), never past it. */
  coverage: number;
  joins?: readonly SourceJoin[];
}

// target kind bits
export const T_NEAR = 1, T_POSSIBLE = 2, T_REENTRY = 4, T_AT_START = 8, T_ENTRY = 16, T_ENTRY_MOVE = 32, T_RAPID = 64, T_OPEN = 128;

export interface ContactView {
  readonly input: ContactViewInput;
  /** The targets in position order: an interval at its refined entry, a
   *  near miss at its closest approach. */
  readonly n: number;
  readonly pos: Float64Array;
  readonly end: Float64Array;
  readonly src: Uint8Array;
  readonly shard: Uint8Array;
  readonly row: Uint32Array;
  readonly kind: Uint8Array;
  /** Per model pair, its touch stretches on the shown axis (sorted, a gap cut
   *  out) — the tint and the bands read them. */
  readonly touch: ReadonlyMap<number, Float64Array>;
  /** Every episode's stretch on the shown axis with its mark kind — the code
   *  panel's marks read them (sorted by start; `epMax` the prefix max end). */
  readonly epStart: Float64Array;
  readonly epEnd: Float64Array;
  readonly epMark: Uint8Array;   // 0 contact, 1 possible, 2 boundary
  readonly epMax: Float64Array;
}

const EP_MARK_CONTACT = 0, EP_MARK_POSSIBLE = 1, EP_MARK_BOUNDARY = 2;

/** Where an interval ends on its own axis: its exit; one ended at a gap (an
 *  unknown tool) at that gap's start; else it is open (`open`). */
function intervalEnd(st: ContactStore, iv: number): { end: number; open: boolean } {
  const exit = st.intervals.get(iv, "exit");
  if (!Number.isNaN(exit)) return { end: exit, open: false };
  const w = st.intervals.get(iv, "witness");
  if (st.intervals.get(iv, "flags") & IV_ENDED_AT_GAP) {
    // the gap that ended it: the pair's first gap starting at or after its witness
    const pair = st.episodes.get(st.intervals.get(iv, "episode"), "pair");
    let g = Infinity;
    for (let k = 0; k < st.gaps.rows; k++) {
      if (st.gaps.get(k, "pair") !== pair) continue;
      const s = st.gaps.get(k, "start");
      if (s >= w && s < g) g = s;
    }
    return { end: Number.isFinite(g) ? g : w, open: false };
  }
  return { end: w, open: true };
}

/** Removes the `holes` (any order) from sorted, disjoint stretches. */
function cut(spans: number[], holes: ReadonlyArray<readonly [number, number]>): number[] {
  if (!holes.length) return spans;
  const hs = [...holes].sort((x, y) => x[0] - y[0]);
  const out: number[] = [];
  for (let i = 0; i < spans.length; i += 2) {
    let a = spans[i]!;
    const b = spans[i + 1]!;
    for (const [h0, h1] of hs) {
      if (h1 <= a || h0 >= b) continue;
      if (h0 > a) out.push(a, h0);
      a = Math.max(a, h1);
      if (a >= b) break;
    }
    if (a < b) out.push(a, b);
  }
  return out;
}

/** Sorted, merged stretches. */
function unite(spans: number[]): number[] {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < spans.length; i += 2) pairs.push([spans[i]!, spans[i + 1]!]);
  pairs.sort((x, y) => x[0] - y[0]);
  const out: number[] = [];
  for (const [a, b] of pairs) {
    const n = out.length;
    if (n && a <= out[n - 1]!) out[n - 1] = Math.max(out[n - 1]!, b);
    else out.push(a, b);
  }
  return out;
}

export function buildContactView(input: ContactViewInput): ContactView {
  const { sources, coverage } = input;
  const clip = (x: number) => Math.min(x, coverage);
  // the knowledge gaps on the shown axis, per pair: nothing is tinted, banded
  // or marked through one (plan 4.3)
  const holes = new Map<number, Array<[number, number]>>();
  sources.forEach(source => source.stores.forEach(st => {
    for (let g = 0; g < st.gaps.rows; g++) {
      const pair = st.gaps.get(g, "pair"), e = st.gaps.get(g, "end");
      const a = source.at(st.gaps.get(g, "start")), b = Number.isNaN(e) ? coverage : clip(source.at(e));
      if (b > a) { let l = holes.get(pair); if (!l) holes.set(pair, l = []); l.push([a, b]); }
    }
  }));
  // the base intervals that continue an entry contact (counted once, as the
  // entry's), and how far each such entry contact reaches on the base
  const joined = new Set<string>();
  const reach = new Map<string, number>();
  for (const j of input.joins ?? []) {
    const bs = sources[j.baseSrc]!, bst = bs.stores[j.baseShard]!;
    for (const [biv, eiv] of j.joins) {
      const ie = intervalEnd(bst, biv);
      joined.add(`${j.baseSrc}:${j.baseShard}:${biv}`);
      reach.set(`${j.entrySrc}:${j.entryShard}:${eiv}`, ie.open ? Math.min(bs.coverage ?? coverage, coverage) : clip(bs.at(ie.end)));
    }
  }
  const T: Array<{ pos: number; end: number; src: number; shard: number; row: number; kind: number }> = [];
  const touch = new Map<number, number[]>();
  const eps: Array<{ pair: number; s: number; e: number; m: number }> = [];
  sources.forEach((source, si) => {
    const cov = Math.min(source.coverage ?? coverage, coverage);
    const clipS = (x: number) => Math.min(x, cov);
    source.stores.forEach((st, sh) => {
      const E = st.episodes, I = st.intervals;
      for (let e = 0; e < E.rows; e++) {
        const flags = E.get(e, "flags"), pair = E.get(e, "pair");
        const boundary = (flags & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY;
        const ivCount = E.get(e, "ivCount");
        let allPossible = ivCount > 0, open = Number.isNaN(E.get(e, "end"));
        let k = 0;
        for (let iv = E.get(e, "firstIv"); iv !== NONE; iv = I.get(iv, "next"), k++) {
          const ivFlags = I.get(iv, "flags");
          if (!(ivFlags & IV_POSSIBLE)) allPossible = false;
          const enter = source.at(I.get(iv, "enter"));
          const ie = intervalEnd(st, iv);
          const r = reach.get(`${si}:${sh}:${iv}`);
          let end = ie.open ? cov : clipS(source.at(ie.end));
          if (r !== undefined) end = Math.max(end, r);
          if (end < enter) end = enter;
          if (ie.open) open = true;
          let l = touch.get(pair); if (!l) touch.set(pair, l = []); l.push(enter, end);
          // a joined base interval is the entry's finding; a later rapid part
          // of a cutting contact is the finding before it; a boundary contact
          // (a range sweep's start) is no finding of its own
          if (boundary || joined.has(`${si}:${sh}:${iv}`) || (ivFlags & IV_CONTINUES_CUT)) continue;
          let kind = 0;
          if (ivFlags & IV_POSSIBLE) kind |= T_POSSIBLE;
          if (k > 0) kind |= T_REENTRY;
          if (k === 0 && (flags & EP_AT_START)) kind |= T_AT_START;
          if (flags & EP_RAPID) kind |= T_RAPID;
          if (ie.open && r === undefined) kind |= T_OPEN;
          if (source.entry) { kind |= T_ENTRY; if (source.entryEnd !== undefined && enter < source.entryEnd) kind |= T_ENTRY_MOVE; }
          T.push({ pos: enter, end, src: si, shard: sh, row: iv, kind });
        }
        if (ivCount === 0 && !boundary) {
          const close = source.at(E.get(e, "closeAt"));
          let kind = T_NEAR;
          if (flags & EP_POSSIBLE) kind |= T_POSSIBLE;
          if (flags & EP_RAPID) kind |= T_RAPID;
          if (source.entry) { kind |= T_ENTRY; if (source.entryEnd !== undefined && close < source.entryEnd) kind |= T_ENTRY_MOVE; }
          T.push({ pos: close, end: close, src: si, shard: sh, row: e, kind });
        }
        const mark = boundary ? EP_MARK_BOUNDARY
          : (ivCount === 0 ? (flags & EP_POSSIBLE) !== 0 : allPossible) ? EP_MARK_POSSIBLE : EP_MARK_CONTACT;
        eps.push({ pair, s: source.at(E.get(e, "onset")), e: open ? cov : clipS(source.at(E.get(e, "end"))), m: mark });
      }
    });
  });
  T.sort((x, y) => x.pos - y.pos || x.end - y.end);
  const n = T.length;
  const pos = new Float64Array(n), end = new Float64Array(n), src = new Uint8Array(n), shard = new Uint8Array(n),
        row = new Uint32Array(n), kind = new Uint8Array(n);
  T.forEach((t, i) => { pos[i] = t.pos; end[i] = t.end; src[i] = t.src; shard[i] = t.shard; row[i] = t.row; kind[i] = t.kind; });
  const tmap = new Map<number, Float64Array>();
  for (const [pair, spans] of touch) tmap.set(pair, Float64Array.from(cut(unite(spans), holes.get(pair) ?? [])));
  // the episodes' stretches, a gap of the pair cut out (an interval suspended
  // at a gap is marked up to it, never through it)
  const pieces: Array<{ s: number; e: number; m: number }> = [];
  for (const ep of eps) {
    const sp = cut([ep.s, Math.max(ep.s, ep.e)], holes.get(ep.pair) ?? []);
    for (let i = 0; i < sp.length; i += 2) pieces.push({ s: sp[i]!, e: sp[i + 1]!, m: ep.m });
    if (!sp.length && ep.e <= ep.s) pieces.push({ s: ep.s, e: ep.s, m: ep.m });
  }
  pieces.sort((x, y) => x.s - y.s);
  const epStart = Float64Array.from(pieces, x => x.s), epEnd = Float64Array.from(pieces, x => x.e), epMark = Uint8Array.from(pieces, x => x.m);
  const epMax = new Float64Array(pieces.length);
  let m = -Infinity;
  for (let i = 0; i < pieces.length; i++) { m = Math.max(m, epEnd[i]!); epMax[i] = m; }
  return { input, n, pos, end, src, shard, row, kind, touch: tmap, epStart, epEnd, epMark, epMax };
}

/** The identity of target `i` (plan 1.2): origin, pair, episode number per
 *  pair, interval number in the episode (`n` for a near miss). */
export function targetKey(v: ContactView, i: number): string {
  const st = v.input.sources[v.src[i]!]!.stores[v.shard[i]!]!;
  const near = (v.kind[i]! & T_NEAR) !== 0;
  const ep = near ? v.row[i]! : st.intervals.get(v.row[i]!, "episode");
  const pair = st.episodes.get(ep, "pair"), ord = st.episodes.get(ep, "ordinal");
  let k = 0;
  if (!near) for (let iv = st.episodes.get(ep, "firstIv"); iv !== v.row[i]! && iv !== NONE; iv = st.intervals.get(iv, "next")) k++;
  return `${v.kind[i]! & T_ENTRY ? "E" : "C"}${pair}|${ord}|${near ? "n" : k}`;
}

/** Target `i` as the views' object — built only for what is shown. `lineAt`
 *  is the shown track's display line at a position (null: none, plan 1.3). */
export function targetAt(v: ContactView, i: number, lineAt: (pos: number) => number | null): ClashTarget {
  const st = v.input.sources[v.src[i]!]!.stores[v.shard[i]!]!;
  const k = v.kind[i]!;
  const ep = k & T_NEAR ? v.row[i]! : st.intervals.get(v.row[i]!, "episode");
  const { a, b } = v.input.pairName(st.episodes.get(ep, "pair"));
  const t: ClashTarget = { cum: v.pos[i]!, cumEnd: v.end[i]!, key: targetKey(v, i), line: lineAt(v.pos[i]!) ?? 0, a, b,
    dist: k & T_NEAR ? st.episodes.get(ep, "closeDist") : 0 };
  if (k & T_RAPID) t.rapid = true;
  if (k & T_REENTRY) t.reentry = true;
  if (k & T_POSSIBLE) t.possible = true;
  if (k & T_AT_START) t.atStart = true;
  if (k & T_ENTRY) t.entry = true;
  if (k & T_ENTRY_MOVE) t.entryMove = true;
  return t;
}

export interface ViewCounts { collisions: number; entryCollisions: number; nearMisses: number; possible: number; startsIn: boolean }

/** What the words count (sweepWords.findingWords' kinds), from the index. */
export function viewCounts(v: ContactView): ViewCounts {
  let collisions = 0, entryCollisions = 0, nearMisses = 0, possible = 0, startsIn = false;
  for (let i = 0; i < v.n; i++) {
    const k = v.kind[i]!;
    if (k & T_POSSIBLE) { possible++; continue; }
    if (k & T_NEAR) { nearMisses++; continue; }
    if (k & T_ENTRY_MOVE) entryCollisions++;
    else collisions++;
    if ((k & T_AT_START) && !(k & T_ENTRY)) startsIn = true;
  }
  return { collisions, entryCollisions, nearMisses, possible, startsIn };
}

const sampleAt = (v: ContactView, i: number) => {
  const room = v.end[i]! - v.pos[i]!;
  return room > 0 ? v.pos[i]! + Math.min(JUMP_NUDGE, room / 2) : v.pos[i]!;
};

/** The target after the one shown (by key, while the timeline still stands
 *  where it showed it), else the first a jump would land past `s`; wraps.
 *  findingNav's rule, on the index (binary search on the start; a jump lands
 *  at most JUMP_NUDGE past it). */
export function indexAfter(v: ContactView, s: number, sel: { key: string; pos: number } | null): number {
  if (!v.n) return -1;
  if (sel && sel.pos === s) {
    const i = findKey(v, sel.key, s);
    if (i >= 0) return (i + 1) % v.n;
  }
  // the first with pos > s − JUMP_NUDGE, then the first whose sample lies past s
  let lo = 0, hi = v.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (v.pos[mid]! <= s - JUMP_NUDGE) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < v.n; i++) if (sampleAt(v, i) > s) return i;
  return 0;
}

export function indexBefore(v: ContactView, s: number, sel: { key: string; pos: number } | null): number {
  if (!v.n) return -1;
  if (sel && sel.pos === s) {
    const i = findKey(v, sel.key, s);
    if (i >= 0) return (i - 1 + v.n) % v.n;
  }
  let lo = 0, hi = v.n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (v.pos[mid]! < s) lo = mid + 1; else hi = mid; }
  for (let i = Math.min(lo, v.n - 1); i >= 0; i--) if (sampleAt(v, i) < s) return i;
  return v.n - 1;
}

/** The index of the target `key` near position `s` (its sample lies within
 *  JUMP_NUDGE of it), else anywhere; −1 when gone. */
export function findKey(v: ContactView, key: string, near?: number): number {
  if (near !== undefined) {
    let lo = 0, hi = v.n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (v.pos[mid]! < near - 2 * JUMP_NUDGE) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < v.n && v.pos[i]! <= near + 2 * JUMP_NUDGE; i++) if (targetKey(v, i) === key) return i;
  }
  for (let i = 0; i < v.n; i++) if (targetKey(v, i) === key) return i;
  return -1;
}

/** At most `max` targets around index `center` (plan 4.4: the list's window),
 *  with how many lie before and after it. */
export function targetWindow(v: ContactView, center: number, max: number, lineAt: (pos: number) => number | null):
    { first: number; targets: ClashTarget[]; before: number; after: number } {
  if (!v.n) return { first: 0, targets: [], before: 0, after: 0 };
  const c = Math.max(0, Math.min(v.n - 1, center));
  const first = Math.max(0, Math.min(c - (max >> 1), v.n - max));
  const last = Math.min(v.n, first + max);
  const targets: ClashTarget[] = [];
  for (let i = first; i < last; i++) targets.push(targetAt(v, i, lineAt));
  return { first, targets, before: first, after: v.n - last };
}

/** The bodies in contact at `pos` (plan 4.3): a pair glows inside one of its
 *  shown touch stretches — an open one to the coverage, never through a gap
 *  of the pair. Binary search per pair. */
export function tintAt(v: ContactView, pos: number, tol = 1e-3): Set<string> {
  const out = new Set<string>();
  for (const [pair, sp] of v.touch) {
    let lo = 0, hi = sp.length >> 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sp[2 * mid + 1]! < pos - tol) lo = mid + 1; else hi = mid; }
    if (lo < sp.length >> 1 && sp[2 * lo]! <= pos + tol) {
      const { a, b } = v.input.pairName(pair);
      out.add(a); out.add(b);
    }
  }
  return out;
}

/** The code panel's mark for one display line, from the shown spans of its
 *  moves (plan 4.2: a line is marked where an episode covers one of its
 *  moves — every span of a repeated line separately). A contact's own mark
 *  over a possible one over a provisional one; a gap marks nothing. */
export function lineMark(v: ContactView, line: number, spans: ReadonlyArray<readonly [number, number]>): CollisionLineMark | null {
  let best = -1;
  for (const [a, b] of spans) {
    // the last episode starting at or before b; walk back while one may still reach a
    let lo = 0, hi = v.epStart.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (v.epStart[mid]! <= b) lo = mid + 1; else hi = mid; }
    for (let i = lo - 1; i >= 0 && v.epMax[i]! >= a; i--) {
      if (v.epEnd[i]! < a) continue;
      const m = v.epMark[i]!;
      // rank: contact 0 best, possible 1, boundary 2
      if (best < 0 || m < best) best = m;
      if (best === EP_MARK_CONTACT) break;
    }
    if (best === EP_MARK_CONTACT) break;
  }
  if (best < 0) return null;
  return { line, ...(best === EP_MARK_BOUNDARY ? { boundary: true as const } : best === EP_MARK_POSSIBLE ? { possible: true as const } : {}) };
}

/** The timeline's contact bands at display resolution (plan 4.3): `columns`
 *  pixel columns over [0, axisEnd]; a column is lit when a shown touch
 *  stretch of any pair reaches into it — a contact narrower than a column
 *  lights its column and never vanishes; a free stretch splits a band only
 *  where the resolution can show it. At most 8192 columns. Bands as
 *  [startFraction, endFraction] runs. */
export function contactBands(v: ContactView, columns: number, axisEnd: number): Array<[number, number]> {
  const W = Math.max(1, Math.min(8192, Math.floor(columns)));
  if (!(axisEnd > 0)) return [];
  const lit = new Uint8Array(W);
  const col = (x: number) => Math.max(0, Math.min(W - 1, Math.floor((x / axisEnd) * W)));
  for (const sp of v.touch.values()) {
    for (let i = 0; i < sp.length; i += 2) {
      const a = sp[i]!, b = sp[i + 1]!;
      if (b < 0 || a > axisEnd) continue;
      // a stretch ending ON a column's left edge does not reach into it
      const c0 = col(a), e = Math.max(c0, Math.min(W - 1, Math.ceil((b / axisEnd) * W) - 1));
      for (let c = c0; c <= e; c++) lit[c] = 1;
    }
  }
  const out: Array<[number, number]> = [];
  for (let c = 0; c < W; c++) {
    if (!lit[c]) continue;
    let e = c;
    while (e + 1 < W && lit[e + 1]) e++;
    out.push([c / W, (e + 1) / W]);
    c = e;
  }
  return out;
}

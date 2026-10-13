// Step 4 package 2, round B1: ONE derivation for every view of the contact
// tables (plan docs/reviews/kollision-paket2.plan.md Fassung 5, section 4;
// Codex R139–R147). Pure: the store's typed columns go in, the views take
// what they need out of ONE index — the count and the words, prev/next, the
// list's window, the code panel's mark per line, the tint per pair, the
// timeline's bands at display resolution. No object per event: objects exist
// only for what a caller asks for (a list window, one navigation answer).
//
// The sources are one or more requests' tables on the axis the view shows
// (the program's base track; the entry move's in front of it in a
// simulation; a run check's beginning mapped onto the base). Positions in the
// tables are their own track's cum; `at` places them on the shown axis.
//
// HELD (plan 3.4, Codex R147 VP-I105): references into the tables, never a
// copy of their spans — the targets as packed u32 references sorted by
// position, per pair its intervals' rows (u32), the episodes as u32
// references sorted by onset with a maximum per block of 64. Positions are
// read from the tables: an interval's entry and an episode's onset never move
// after they are written; the near miss of a stay still OPEN moves to its
// closest approach, so its position is taken when the view is built (at most
// one per pair and table). Ends are read live, clipped to the coverage the
// view was built with — a snapshot that only grows more exact.
//
// KNOWLEDGE GAPS (VP-I102, VP-I104): a gap is a closed stretch of its OWN
// source (clipped to that source's coverage, a point kept as a point); it
// cuts that source's contacts only — ignorance is no freedom, so another
// source's confirmed contact there stays. No tolerance widens a contact over
// a proven free point (VP-I101).
import {
  EP_AT_START, EP_ORIGIN_MASK, EP_POSSIBLE, EP_RAPID, GAP_TOOL_UNKNOWN, IV_CONTINUES_CUT, IV_ENDED_AT_GAP, IV_POSSIBLE,
  NONE, ORIGIN_BOUNDARY, type ContactStore,
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
  /** On the source's OWN axis, where the entry move itself ends: an entry
   *  finding at or before it is ON the entry move, one after it on the bound
   *  beginning (sweepMerge.mergeEntryResult's rule — a run check maps its
   *  whole beginning to 0 on the base axis, so the shown axis cannot tell). */
  entryEnd?: number;
  /** On the shown axis, how far THIS source is swept — an open interval and
   *  an open gap of it run to here (a side run's whole track; default the
   *  view's). */
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

/** One table of one source, indexed. */
interface TableIndex {
  st: ContactStore;
  source: ContactSource;
  src: number;
  shard: number;
  /** This source's coverage on the shown axis. */
  cov: number;
  /** Per pair, its intervals' rows in entry order. */
  pairs: Map<number, Uint32Array>;
  /** Per pair, its knowledge gaps as closed [start, end] on the shown axis,
   *  by start — clipped to this source's coverage, a point kept. */
  holes: Map<number, Float64Array>;
  /** Per pair, where its tool became unknown (own axis), ascending. */
  toolGaps: Map<number, Float64Array>;
}

export interface ContactView {
  readonly input: ContactViewInput;
  /** The targets: an interval at its refined entry, a near miss at its
   *  closest approach — `targetPos` / `targetEnd` / `targetKind` read them. */
  readonly n: number;
  /** Packed references (source, table, row, near) in position order. */
  readonly tgt: Uint32Array;
  /** An open stay's near miss: its position as built. */
  readonly live: ReadonlyMap<number, number>;
  readonly tables: ReadonlyArray<TableIndex | undefined>;
  /** Every episode (packed reference) by onset — the code panel's marks —
   *  and per block of EP_BLOCK the largest end in it and up to it. */
  readonly ep: Uint32Array;
  readonly epBlockMax: Float64Array;
  readonly epBlockPre: Float64Array;
  /** Base intervals counted as the entry's, and how far each such entry
   *  contact reaches on the shown axis. */
  readonly joined: ReadonlySet<number>;
  readonly reach: ReadonlyMap<number, number>;
}

const EP_MARK_CONTACT = 0, EP_MARK_POSSIBLE = 1, EP_MARK_BOUNDARY = 2;
const EP_BLOCK = 64;
/** The sweep's position tolerance (findings at or before the entry move's end). */
const ON_ENTRY_TOL = 1e-9;
/** Positions within this lie on one span's start (the sweep's 1e-3 bisection) —
 *  only for saying where a contact began, never for whether it is there. */
const LINE_TOL = 1e-3;

// packed reference: row (24 bits) · table (3) · source (2) · near (1)
const ROW_MASK = 0xffffff, TABLE_SHIFT = 24, SRC_SHIFT = 27, NEAR_BIT = 1 << 29;
const MAX_TABLES = 8, MAX_SOURCES = 4;
const pack = (src: number, shard: number, row: number, near = false) =>
  (row | (shard << TABLE_SHIFT) | (src << SRC_SHIFT) | (near ? NEAR_BIT : 0)) >>> 0;
const rowOf = (ref: number) => ref & ROW_MASK;
const isNearRef = (ref: number) => (ref & NEAR_BIT) !== 0;
const tableOf = (v: ContactView, ref: number) => v.tables[((ref >>> SRC_SHIFT) & 3) * MAX_TABLES + ((ref >>> TABLE_SHIFT) & 7)]!;

const onEntryMove = (source: ContactSource, ownCum: number) =>
  !!source.entry && source.entryEnd !== undefined && ownCum <= source.entryEnd + ON_ENTRY_TOL;

/** x lies in one of the closed gaps `h`. */
function inHole(h: Float64Array | undefined, x: number): boolean {
  if (!h) return false;
  for (let k = 0; k < h.length; k += 2) if (h[k]! <= x && x <= h[k + 1]!) return true;
  return false;
}

/** The closed stretch [x, y] holds a point outside every closed gap of `h`
 *  (sorted by start): a gap may cover a contact wholly, a point gap a point. */
function freeOf(h: Float64Array | undefined, x: number, y: number): boolean {
  if (!h || !h.length) return true;
  let reach = -Infinity, started = false;
  for (let k = 0; k < h.length; k += 2) {
    const s = h[k]!, e = h[k + 1]!;
    if (e < x) continue;
    if (s > y) break;
    if (!started) { if (s > x) return true; started = true; reach = e; }
    else { if (s > reach) return true; reach = Math.max(reach, e); }
    if (reach >= y) return false;
  }
  return !started || reach < y;
}

/** [x, y] less the closed gaps `h`, as pieces (a point outside every gap is
 *  a piece of its own): for the bands, at display resolution. */
function piecesOf(h: Float64Array | undefined, x: number, y: number, out: number[]): void {
  if (!h || !h.length) { out.push(x, y); return; }
  if (x === y) { if (!inHole(h, x)) out.push(x, x); return; }
  let cur = x;
  for (let k = 0; k < h.length; k += 2) {
    const s = h[k]!, e = h[k + 1]!;
    if (e < cur) continue;
    if (s > y) break;
    if (s > cur) out.push(cur, s);
    cur = Math.max(cur, e);
    if (cur >= y) return;
  }
  if (cur < y) out.push(cur, y);
}

/** Where an interval ends on the shown axis, clipped to its source's
 *  coverage: its exit; one ended at an unknown tool at the gap that ended it
 *  — the first TOOL gap of the pair from its witness on (VP-I103: an
 *  undecidable gap before it only suspended it); else it is open, to the
 *  coverage. An entry contact the base continues reaches the base's end. */
function ivEnd(reach: ReadonlyMap<number, number>, t: TableIndex, row: number, ref: number): { end: number; open: boolean } {
  const I = t.st.intervals;
  const exit = I.get(row, "exit");
  let end: number, open = false;
  if (!Number.isNaN(exit)) end = Math.min(t.source.at(exit), t.cov);
  else {
    let g = NaN;
    if (I.get(row, "flags") & IV_ENDED_AT_GAP) {
      const tg = t.toolGaps.get(t.st.episodes.get(I.get(row, "episode"), "pair"));
      const w = I.get(row, "witness");
      if (tg) {
        let lo = 0, hi = tg.length;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (tg[mid]! < w) lo = mid + 1; else hi = mid; }
        if (lo < tg.length) g = tg[lo]!;
      }
    }
    // a tool gap not in the tables the view was built from: open, never an end made up
    if (Number.isNaN(g)) { end = t.cov; open = true; }
    else end = Math.min(t.source.at(g), t.cov);
  }
  const r = reach.get(ref);
  if (r !== undefined) { end = Math.max(end, r); open = false; }
  const enter = t.source.at(I.get(row, "enter"));
  return { end: Math.max(end, enter), open };
}

/** An episode's stretch on the shown axis: onset to its end, an open one to
 *  its source's coverage. */
function epStretch(t: TableIndex, row: number): [number, number] {
  const E = t.st.episodes;
  const s = t.source.at(E.get(row, "onset")), e = E.get(row, "end");
  const end = Number.isNaN(e) ? t.cov : Math.min(t.source.at(e), t.cov);
  return [s, Math.max(s, end)];
}

export function buildContactView(input: ContactViewInput): ContactView {
  const { sources, coverage } = input;
  if (sources.length > MAX_SOURCES) throw new Error(`contactView: ${sources.length} sources (at most ${MAX_SOURCES})`);
  const tables: Array<TableIndex | undefined> = [];
  const list: TableIndex[] = [];
  sources.forEach((source, si) => {
    if (source.stores.length > MAX_TABLES) throw new Error(`contactView: ${source.stores.length} tables (at most ${MAX_TABLES})`);
    const cov = Math.min(source.coverage ?? coverage, coverage);
    source.stores.forEach((st, sh) => {
      if (st.intervals.rows > ROW_MASK || st.episodes.rows > ROW_MASK) throw new Error("contactView: a table past 2^24 rows");
      // per pair its intervals' rows: written in time order, so in entry order
      const byPair = new Map<number, number[]>();
      for (let iv = 0; iv < st.intervals.rows; iv++) {
        const pair = st.episodes.get(st.intervals.get(iv, "episode"), "pair");
        let l = byPair.get(pair); if (!l) byPair.set(pair, l = []); l.push(iv);
      }
      const pairs = new Map<number, Uint32Array>();
      for (const [pair, rows] of byPair) {
        const a = Uint32Array.from(rows);
        // (a guard, not an assumption: keep the order a binary search needs)
        for (let k = 1; k < a.length; k++) {
          if (st.intervals.get(a[k]!, "enter") < st.intervals.get(a[k - 1]!, "enter")) {
            a.sort((x, y) => st.intervals.get(x, "enter") - st.intervals.get(y, "enter"));
            break;
          }
        }
        pairs.set(pair, a);
      }
      const holesL = new Map<number, number[]>(), toolL = new Map<number, number[]>();
      for (let g = 0; g < st.gaps.rows; g++) {
        const pair = st.gaps.get(g, "pair"), s0 = st.gaps.get(g, "start"), e0 = st.gaps.get(g, "end");
        if (st.gaps.get(g, "reason") === GAP_TOOL_UNKNOWN) { let l = toolL.get(pair); if (!l) toolL.set(pair, l = []); l.push(s0); }
        const a = source.at(s0);
        if (a > cov) continue;   // past what this source checked: says nothing
        const b = Number.isNaN(e0) ? cov : Math.min(source.at(e0), cov);
        let l = holesL.get(pair); if (!l) holesL.set(pair, l = []); l.push(a, Math.max(a, b));
      }
      const holes = new Map<number, Float64Array>();
      for (const [pair, l] of holesL) {
        const idx = Array.from({ length: l.length >> 1 }, (_, k) => k).sort((x, y) => l[2 * x]! - l[2 * y]!);
        const h = new Float64Array(l.length);
        idx.forEach((k, j) => { h[2 * j] = l[2 * k]!; h[2 * j + 1] = l[2 * k + 1]!; });
        holes.set(pair, h);
      }
      const toolGaps = new Map<number, Float64Array>();
      for (const [pair, l] of toolL) toolGaps.set(pair, Float64Array.from(l).sort());
      const t: TableIndex = { st, source, src: si, shard: sh, cov, pairs, holes, toolGaps };
      tables[si * MAX_TABLES + sh] = t;
      list.push(t);
    });
  });
  // the base intervals that continue an entry contact, and how far each such
  // entry contact reaches on the shown axis
  const joined = new Set<number>();
  const reach = new Map<number, number>();
  const none = new Map<number, number>();
  for (const j of input.joins ?? []) {
    const bt = tables[j.baseSrc * MAX_TABLES + j.baseShard];
    if (!bt) continue;
    for (const [biv, eiv] of j.joins) {
      const bref = pack(j.baseSrc, j.baseShard, biv);
      joined.add(bref);
      reach.set(pack(j.entrySrc, j.entryShard, eiv), ivEnd(none, bt, biv, bref).end);
    }
  }
  // the targets: refs and their positions (temporary), then sorted
  let count = 0;
  for (const t of list) count += t.st.intervals.rows + t.st.episodes.rows;
  const refs = new Uint32Array(count), poss = new Float64Array(count);
  const live = new Map<number, number>();
  let n = 0;
  for (const t of list) {
    const E = t.st.episodes, I = t.st.intervals;
    for (let iv = 0; iv < I.rows; iv++) {
      const ep = I.get(iv, "episode");
      const ref = pack(t.src, t.shard, iv);
      // a joined base interval is the entry's finding; a later rapid part of
      // a cutting contact is the finding before it; a boundary contact (a
      // range sweep's start) is no finding of its own
      if ((E.get(ep, "flags") & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY || joined.has(ref) || (I.get(iv, "flags") & IV_CONTINUES_CUT)) continue;
      refs[n] = ref; poss[n++] = t.source.at(I.get(iv, "enter"));
    }
    for (let e = 0; e < E.rows; e++) {
      if (E.get(e, "ivCount") !== 0 || (E.get(e, "flags") & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY) continue;
      const ref = pack(t.src, t.shard, e, true), p = t.source.at(E.get(e, "closeAt"));
      if (Number.isNaN(E.get(e, "end"))) live.set(ref, p);   // still open: its closest approach may move
      refs[n] = ref; poss[n++] = p;
    }
  }
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => poss[a]! - poss[b]! || refs[a]! - refs[b]!);
  const tgt = new Uint32Array(n);
  for (let i = 0; i < n; i++) tgt[i] = refs[order[i]!]!;
  // every episode by onset, with the largest end per block and up to it
  let m = 0;
  for (const t of list) m += t.st.episodes.rows;
  const eRefs = new Uint32Array(m), eOn = new Float64Array(m), eEnd = new Float64Array(m);
  m = 0;
  for (const t of list) for (let e = 0; e < t.st.episodes.rows; e++) {
    const [s, x] = epStretch(t, e);
    eRefs[m] = pack(t.src, t.shard, e); eOn[m] = s; eEnd[m++] = x;
  }
  const eOrder = new Uint32Array(m);
  for (let i = 0; i < m; i++) eOrder[i] = i;
  eOrder.sort((a, b) => eOn[a]! - eOn[b]!);
  const ep = new Uint32Array(m);
  const blocks = Math.ceil(m / EP_BLOCK);
  const epBlockMax = new Float64Array(blocks).fill(-Infinity), epBlockPre = new Float64Array(blocks);
  for (let i = 0; i < m; i++) {
    ep[i] = eRefs[eOrder[i]!]!;
    const b = (i / EP_BLOCK) | 0;
    epBlockMax[b] = Math.max(epBlockMax[b]!, eEnd[eOrder[i]!]!);
  }
  let pre = -Infinity;
  for (let b = 0; b < blocks; b++) { pre = Math.max(pre, epBlockMax[b]!); epBlockPre[b] = pre; }
  return { input, n, tgt, live, tables, ep, epBlockMax, epBlockPre, joined, reach };
}

/** Target `i`'s position on the shown axis. */
export function targetPos(v: ContactView, i: number): number {
  const ref = v.tgt[i]!, t = tableOf(v, ref), row = rowOf(ref);
  if (isNearRef(ref)) return v.live.get(ref) ?? t.source.at(t.st.episodes.get(row, "closeAt"));
  return t.source.at(t.st.intervals.get(row, "enter"));
}

/** Where target `i` ends on the shown axis (a near miss: its position). */
export function targetEnd(v: ContactView, i: number): number {
  const ref = v.tgt[i]!;
  return isNearRef(ref) ? targetPos(v, i) : ivEnd(v.reach, tableOf(v, ref), rowOf(ref), ref).end;
}

/** Target `i`'s kind bits (T_*). */
export function targetKind(v: ContactView, i: number): number {
  const ref = v.tgt[i]!, t = tableOf(v, ref), row = rowOf(ref), E = t.st.episodes;
  if (isNearRef(ref)) {
    let kind = T_NEAR;
    const flags = E.get(row, "flags");
    if (flags & EP_POSSIBLE) kind |= T_POSSIBLE;
    if (flags & EP_RAPID) kind |= T_RAPID;
    if (t.source.entry) { kind |= T_ENTRY; if (onEntryMove(t.source, E.get(row, "closeAt"))) kind |= T_ENTRY_MOVE; }
    return kind;
  }
  const I = t.st.intervals, epRow = I.get(row, "episode"), flags = E.get(epRow, "flags"), ivFlags = I.get(row, "flags");
  const first = E.get(epRow, "firstIv") === row;
  let kind = 0;
  if (ivFlags & IV_POSSIBLE) kind |= T_POSSIBLE;
  if (!first) kind |= T_REENTRY;
  if (first && (flags & EP_AT_START)) kind |= T_AT_START;
  if (flags & EP_RAPID) kind |= T_RAPID;
  if (ivEnd(v.reach, t, row, ref).open) kind |= T_OPEN;
  if (t.source.entry) { kind |= T_ENTRY; if (onEntryMove(t.source, I.get(row, "enter"))) kind |= T_ENTRY_MOVE; }
  return kind;
}

/** The identity of target `i` (plan 1.2): origin, pair, episode number per
 *  pair, interval number in the episode (`n` for a near miss). */
export function targetKey(v: ContactView, i: number): string {
  const ref = v.tgt[i]!, t = tableOf(v, ref), row = rowOf(ref), E = t.st.episodes, I = t.st.intervals;
  const near = isNearRef(ref);
  const ep = near ? row : I.get(row, "episode");
  let k = 0;
  if (!near) for (let iv = E.get(ep, "firstIv"); iv !== row && iv !== NONE; iv = I.get(iv, "next")) k++;
  return `${t.source.entry ? "E" : "C"}${E.get(ep, "pair")}|${E.get(ep, "ordinal")}|${near ? "n" : k}`;
}

/** The line at a position of the shown track; `atEnd` reads a position where
 *  something ENDS (trackLineAt). */
export type LineAt = (pos: number, atEnd?: boolean) => number | null;

/** Target `i` as the views' object — built only for what is shown. `lineAt`
 *  is the shown track's line at a position (null: none, plan 1.3). */
export function targetAt(v: ContactView, i: number, lineAt: LineAt): ClashTarget {
  const ref = v.tgt[i]!, t = tableOf(v, ref), row = rowOf(ref);
  const k = targetKind(v, i);
  const ep = k & T_NEAR ? row : t.st.intervals.get(row, "episode");
  const { a, b } = v.input.pairName(t.st.episodes.get(ep, "pair"));
  const pos = targetPos(v, i), end = targetEnd(v, i);
  const target: ClashTarget = { cum: pos, cumEnd: end, key: targetKey(v, i), line: lineAt(pos) ?? 0, a, b,
    dist: k & T_NEAR ? t.st.episodes.get(ep, "closeDist") : 0 };
  if (k & T_RAPID) target.rapid = true;
  if (k & T_REENTRY) target.reentry = true;
  if (k & T_POSSIBLE) target.possible = true;
  if (k & T_AT_START) target.atStart = true;
  if (k & T_ENTRY) target.entry = true;
  if (k & T_ENTRY_MOVE) target.entryMove = true;
  // the last line the contact reaches: the move its end lies in or ends at
  if (end > pos) {
    const last = lineAt(end, true);
    if (last !== null && last > target.line) target.spanEndLine = last;
  }
  return target;
}

export interface ViewCounts { collisions: number; entryCollisions: number; nearMisses: number; possible: number; startsIn: boolean }

/** What the words count (sweepWords.findingWords' kinds), from the index. */
export function viewCounts(v: ContactView): ViewCounts {
  let collisions = 0, entryCollisions = 0, nearMisses = 0, possible = 0, startsIn = false;
  for (let i = 0; i < v.n; i++) {
    const k = targetKind(v, i);
    if (k & T_POSSIBLE) { possible++; continue; }
    if (k & T_NEAR) { nearMisses++; continue; }
    if (k & T_ENTRY_MOVE) entryCollisions++;
    else collisions++;
    if ((k & T_AT_START) && !(k & T_ENTRY)) startsIn = true;
  }
  return { collisions, entryCollisions, nearMisses, possible, startsIn };
}

const sampleAt = (v: ContactView, i: number) => {
  const p = targetPos(v, i), room = targetEnd(v, i) - p;
  return room > 0 ? p + Math.min(JUMP_NUDGE, room / 2) : p;
};

/** The first target whose position is past `x` (at or past with !strict). */
function firstAfter(v: ContactView, x: number, strict: boolean): number {
  let lo = 0, hi = v.n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1, p = targetPos(v, mid);
    if (strict ? p <= x : p < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

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
  for (let i = firstAfter(v, s - JUMP_NUDGE, true); i < v.n; i++) if (sampleAt(v, i) > s) return i;
  return 0;
}

export function indexBefore(v: ContactView, s: number, sel: { key: string; pos: number } | null): number {
  if (!v.n) return -1;
  if (sel && sel.pos === s) {
    const i = findKey(v, sel.key, s);
    if (i >= 0) return (i - 1 + v.n) % v.n;
  }
  for (let i = Math.min(firstAfter(v, s, false), v.n - 1); i >= 0; i--) if (sampleAt(v, i) < s) return i;
  return v.n - 1;
}

/** The index of the target `key` near position `s` (its sample lies within
 *  JUMP_NUDGE of it), else anywhere; −1 when gone. */
export function findKey(v: ContactView, key: string, near?: number): number {
  if (near !== undefined) {
    for (let i = firstAfter(v, near - 2 * JUMP_NUDGE, false); i < v.n && targetPos(v, i) <= near + 2 * JUMP_NUDGE; i++) {
      if (targetKey(v, i) === key) return i;
    }
  }
  for (let i = 0; i < v.n; i++) if (targetKey(v, i) === key) return i;
  return -1;
}

/** At most `max` targets around index `center` (plan 4.4: the list's window),
 *  with how many lie before and after it. */
export function targetWindow(v: ContactView, center: number, max: number, lineAt: LineAt):
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
 *  intervals — an open one to its source's coverage — never at a point a
 *  gap of that source holds, and never widened (Codex R147 VP-I101: a
 *  tolerance filled the proven free point between two contacts). Binary
 *  search per pair and table. */
export function tintAt(v: ContactView, pos: number): Set<string> {
  const out = new Set<string>();
  for (const t of v.tables) {
    if (!t) continue;
    const I = t.st.intervals;
    for (const [pair, rows] of t.pairs) {
      // the last interval entered at or before pos: the pair's intervals of
      // one table are disjoint, so it is the only one that can hold pos
      let lo = 0, hi = rows.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (t.source.at(I.get(rows[mid]!, "enter")) <= pos) lo = mid + 1; else hi = mid; }
      if (lo === 0) continue;
      const row = rows[lo - 1]!;
      if (ivEnd(v.reach, t, row, pack(t.src, t.shard, row)).end < pos || inHole(t.holes.get(pair), pos)) continue;
      const { a, b } = v.input.pairName(pair);
      out.add(a); out.add(b);
    }
  }
  return out;
}

/** The code panel's mark for one line, from the spans of its moves (plan
 *  4.2: a line is marked where an episode covers one of its moves — every
 *  span of a repeated line separately, a gap of the episode's source cut out:
 *  a span the gaps cover wholly is marked by nothing, VP-I102). A contact's
 *  own mark over a possible one over a provisional one. A contact that began
 *  before every span of the line it covers is "still in contact":
 *  `continuation` names the line it began on (0: the entry move) — read by
 *  `lineAt` on the shown axis; a contact beginning on the line wins. */
export function lineMark(v: ContactView, line: number, spans: ReadonlyArray<readonly [number, number]>,
                         lineAt?: LineAt): CollisionLineMark | null {
  let best = -1, own = false, contOnset = NaN, contEntry = false;
  for (const [a, b] of spans) {
    // the last episode with its onset at or before b; walk back block by
    // block while one may still reach a
    let lo = 0, hi = v.ep.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1, ref = v.ep[mid]!, t = tableOf(v, ref);
      if (t.source.at(t.st.episodes.get(rowOf(ref), "onset")) <= b) lo = mid + 1; else hi = mid;
    }
    for (let i = lo - 1; i >= 0; i--) {
      const blk = (i / EP_BLOCK) | 0;
      if (v.epBlockPre[blk]! < a) break;
      if (v.epBlockMax[blk]! < a) { i = blk * EP_BLOCK; continue; }
      const ref = v.ep[i]!, t = tableOf(v, ref), row = rowOf(ref), E = t.st.episodes;
      const [s, e] = epStretch(t, row);
      if (e < a) continue;
      if (!freeOf(t.holes.get(E.get(row, "pair")), Math.max(a, s), Math.min(b, e))) continue;
      const flags = E.get(row, "flags");
      let m: number;
      if ((flags & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY) m = EP_MARK_BOUNDARY;
      else if (E.get(row, "ivCount") === 0) m = flags & EP_POSSIBLE ? EP_MARK_POSSIBLE : EP_MARK_CONTACT;
      else {
        let all = true;
        for (let iv = E.get(row, "firstIv"); iv !== NONE; iv = t.st.intervals.get(iv, "next")) {
          if (!(t.st.intervals.get(iv, "flags") & IV_POSSIBLE)) { all = false; break; }
        }
        m = all ? EP_MARK_POSSIBLE : EP_MARK_CONTACT;
      }
      // rank: contact 0 best, possible 1, boundary 2; at one rank a contact
      // beginning in the span over one carried in
      const begins = s >= a - LINE_TOL;
      const entryMove = onEntryMove(t.source, E.get(row, "onset"));
      if (best < 0 || m < best) { best = m; own = begins; contOnset = begins ? NaN : s; contEntry = !begins && entryMove; }
      else if (m === best && begins) own = true;
      else if (m === best && !own && s < contOnset) { contOnset = s; contEntry = entryMove; }
    }
    if (best === EP_MARK_CONTACT && own) break;
  }
  if (best < 0) return null;
  const mark: CollisionLineMark = { line };
  if (best === EP_MARK_BOUNDARY) mark.boundary = true;
  else if (best === EP_MARK_POSSIBLE) mark.possible = true;
  else if (!own && !Number.isNaN(contOnset) && lineAt) {
    const from = contEntry ? 0 : lineAt(contOnset);
    if (from !== null) mark.continuation = from;
  }
  return mark;
}

/** The timeline's contact bands at display resolution (plan 4.3): `columns`
 *  pixel columns over [0, axisEnd]; a column is lit when a contact of any
 *  pair reaches into it, its source's gaps cut out — a contact narrower than
 *  a column lights its column and never vanishes (a point contact too,
 *  VP-I102); a free stretch splits a band only where the resolution can show
 *  it. At most 8192 columns. Bands as [startFraction, endFraction] runs. */
export function contactBands(v: ContactView, columns: number, axisEnd: number): Array<[number, number]> {
  const W = Math.max(1, Math.min(8192, Math.floor(columns)));
  if (!(axisEnd > 0)) return [];
  const lit = new Uint8Array(W);
  const col = (x: number) => Math.max(0, Math.min(W - 1, Math.floor((x / axisEnd) * W)));
  const pieces: number[] = [];
  for (const t of v.tables) {
    if (!t) continue;
    const I = t.st.intervals;
    for (const [pair, rows] of t.pairs) {
      const h = t.holes.get(pair);
      for (const row of rows) {
        const a = t.source.at(I.get(row, "enter")), b = ivEnd(v.reach, t, row, pack(t.src, t.shard, row)).end;
        pieces.length = 0;
        piecesOf(h, a, b, pieces);
        for (let i = 0; i < pieces.length; i += 2) {
          const x = pieces[i]!, y = pieces[i + 1]!;
          if (y < 0 || x > axisEnd) continue;
          // a stretch ending ON a column's left edge does not reach into it
          const c0 = col(x), e = Math.max(c0, Math.min(W - 1, Math.ceil((y / axisEnd) * W) - 1));
          for (let c = c0; c <= e; c++) lit[c] = 1;
        }
      }
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

/** The bytes the view holds besides the tables it reads (plan 3.4): its
 *  typed indices, and the open stays' positions and the joins at the bytes
 *  a Map or Set entry of numbers takes in V8 (~32). */
export function heldBytes(v: ContactView): number {
  let n = v.tgt.byteLength + v.ep.byteLength + v.epBlockMax.byteLength + v.epBlockPre.byteLength;
  for (const t of v.tables) {
    if (!t) continue;
    for (const a of t.pairs.values()) n += a.byteLength + 32;
    for (const a of t.holes.values()) n += a.byteLength + 32;
    for (const a of t.toolGaps.values()) n += a.byteLength + 32;
  }
  return n + 32 * (v.live.size + v.reach.size + v.joined.size);
}

/** The raw line at a position of a track (plan 1.3): the move CONTAINING it
 *  — a track point carries the line of the move ending there, so a position
 *  on a segment's start (a refined entry on a line boundary) is the NEXT
 *  move's, never the previous one's; zero-length segments are skipped. With
 *  `atEnd` the position is where something ENDS: on a segment's end it is
 *  that move's (a contact leaving at a line boundary ends on the line before). */
export function trackLineAt(t: { count: number; cum: ArrayLike<number>; lines: ArrayLike<number> }): LineAt {
  return (pos: number, atEnd = false) => {
    if (t.count < 1) return null;
    if (t.count === 1) return t.lines[0]!;
    // the first point past pos (atEnd: at or past it)
    let lo = 1, hi = t.count - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (atEnd ? t.cum[mid]! < pos : t.cum[mid]! <= pos) lo = mid + 1; else hi = mid;
    }
    return t.lines[lo]!;
  };
}

/** Per raw line, the runs of the track's moves it owns — every run apart
 *  (plan 4.2 Hinweis b: a loop's or a repeated call's line has a run per
 *  execution; one span from its first to its last would mark the moves in
 *  between). Built once per track, line-indexed like lineIndex.ts. */
export interface LineRuns {
  /** `offset[line]` .. `offset[line + 1]` index the line's runs. */
  offset: Int32Array;
  /** The runs as [start, end] pairs on the track's cum, by line, in order. */
  spans: Float64Array;
  maxLine: number;
}

export function lineRuns(t: { count: number; cum: ArrayLike<number>; lines: ArrayLike<number> }): LineRuns {
  // the runs in track order: consecutive moves of one line
  const runLine: number[] = [], runA: number[] = [], runB: number[] = [];
  let maxLine = 0;
  for (let i = 1; i < t.count; i++) {
    const ln = t.lines[i]!;
    if (ln > maxLine) maxLine = ln;
    const k = runLine.length - 1;
    if (k >= 0 && runLine[k] === ln) runB[k] = t.cum[i]!;
    else { runLine.push(ln); runA.push(t.cum[i - 1]!); runB.push(t.cum[i]!); }
  }
  const offset = new Int32Array(maxLine + 2);
  for (const ln of runLine) if (ln >= 0) offset[ln + 1]!++;
  for (let l = 1; l < offset.length; l++) offset[l] = offset[l - 1]! + offset[l]!;
  const fill = offset.slice(0, maxLine + 1);
  const spans = new Float64Array(2 * offset[maxLine + 1]!);
  for (let k = 0; k < runLine.length; k++) {
    const ln = runLine[k]!;
    if (ln < 0) continue;
    const j = fill[ln]!++;
    spans[2 * j] = runA[k]!; spans[2 * j + 1] = runB[k]!;
  }
  return { offset, spans, maxLine };
}

/** The runs of `line` as [start, end] pairs (none: an empty list). */
export function runsOf(r: LineRuns, line: number): Array<[number, number]> {
  if (line < 0 || line > r.maxLine) return [];
  const out: Array<[number, number]> = [];
  for (let j = r.offset[line]!; j < r.offset[line + 1]!; j++) out.push([r.spans[2 * j]!, r.spans[2 * j + 1]!]);
  return out;
}

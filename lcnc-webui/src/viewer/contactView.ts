// Step 4 package 2, round B1: ONE derivation for every view of the contact
// tables (plan docs/reviews/kollision-paket2.plan.md Fassung 5, section 4;
// Codex R139–R148). Pure: the store's typed columns go in, the views take
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
// A VIEW READS ITS TABLES AS BUILT (Codex R148 VP-I107): it holds references
// into them and reads positions, ends and kinds from them — a write to a
// table after the build (a delta applied, a row changed) makes the view
// stale, and every query of a stale view throws. The owner applies the
// deltas and rebuilds in one step.
//
// HELD (plan 3.4, Codex R147/R148 VP-I105): typed arrays only, nothing per
// pair in a Map — the targets as packed u32 references sorted by position,
// the other intervals (boundary contacts, a base interval the entry move's
// contact continues, a later rapid part of a cutting contact) beside them,
// each list with the largest end per block of 64; the episodes likewise;
// the knowledge gaps per table by pair (CSR); the joins as sorted arrays.
//
// KNOWLEDGE GAPS (VP-I102, VP-I104): a gap is a closed stretch on its OWN
// source's axis (an open one to that source's coverage, a point kept); it
// cuts that source's contacts only — ignorance is no freedom — and it cuts
// them on the source's own axis, BEFORE the map to the shown axis: a map
// that sends a stretch to one point (a run check's beginning at 0) must not
// let an unrelated gap mapped there erase a confirmed contact. A shown point
// is in contact where it is the image of an own point of a contact outside
// every gap of its source. An entry contact the base continues is extended
// to the base's end as a FINDING (its extent, its count); its contact there
// is the base's own, with the base's gaps (VP-I104). No tolerance widens a
// contact over a proven free point (VP-I101).
//
// AFTER A FALLBACK (round B4, plan 3.5): a source that carries the earlier
// generation's tables (`held`) shows, per pair and origin, the union of both
// generations' intervals less the free stretches of both (contactUnion.ts).
// Its events are PIECES of that union — a target is the piece's start
// evidence, one u32; its end, what it holds and its identity are asked of
// the union from that start when needed. A piece holding an earlier event's
// witness keeps that event's key; every other piece is keyed by its
// generation, its lead row and the evidence its start stands on. Its contact
// on screen is its intervals' own, less each one's generation's gaps. The
// earlier generation's coverage is how far each of its shards swept, as the
// pool reported it when it fell back (Codex R150 VP150-02: an open contact's
// rows name its entry only); the furthest position a table's rows name is a
// lower bound beside it. Near misses of the two generations are matched one to
// one per pair and origin by overlap in order: a matched one keeps the
// earlier key, an earlier one found no more is shown "from the earlier run".
import {
  EP_AT_START, EP_ORIGIN_MASK, EP_POSSIBLE, EP_RAPID, GAP_TOOL_UNKNOWN, IV_CONTINUES_CUT, IV_ENDED_AT_GAP, IV_ENTER_DECIDED,
  IV_EXIT_DECIDED, IV_POSSIBLE, NONE, ORIGIN_BOUNDARY, BLOCK as STORE_BLOCK, BLOCK_SHIFT, type ContactStore,
} from "./contactStore";
import {
  eachPiece, eachWideConflict, evidencePos, pieceFrom, pieceIntervals, START_ENTER, unionReach, type FreeMemo, type UnionPiece,
  type UnionSide,
} from "./contactUnion";
import type { ClashTarget } from "./clashTargets";
import type { CollisionLineMark } from "./collision";
import { JUMP_NUDGE } from "./findingNav";

/** One request's tables as a view reads them. */
export interface ContactSource {
  /** Its tables (a pool's are per shard; their pairs are disjoint). */
  stores: readonly ContactStore[];
  /** Places one of its cums on the shown axis (monotone, continuous). */
  at: (c: number) => number;
  /** The entry move's request: its findings are keyed `E`, the program's `C`. */
  entry?: boolean;
  /** On the source's OWN axis, where the entry move itself ends: an entry
   *  finding at or before it is ON the entry move, one after it on the bound
   *  beginning (sweepMerge.mergeEntryResult's rule — a run check maps its
   *  whole beginning to 0 on the base axis, so the shown axis cannot tell). */
  entryEnd?: number;
  /** On the source's OWN axis, how far it is swept — an open interval and an
   *  open gap of it run to here. */
  ownCoverage?: number;
  /** The same on the shown axis, when the own one is not given (the own
   *  coverage is then the last own point the map sends there). */
  coverage?: number;
  /** Its own requests' pair names (default the view's). */
  pairName?: (pair: number) => { a: string; b: string };
  /** Its OWN track's lines, for a source the map folds (a run check's
   *  beginning, all at 0 on the base axis): the line of its event is its own
   *  track's there, and the code panel marks the lines its contacts cover on
   *  its own track — never every line the fold lands on (plan 1.3). */
  ownTrack?: { lineAt: LineAt; runs: (line: number) => ReadonlyArray<readonly [number, number]> };
  /** The request's EARLIER generation (a pool that fell back to one core,
   *  plan 3.5): its tables, on the same axis. The source then shows the
   *  union of both generations. */
  held?: readonly ContactStore[];
  /** On the own axis, how far each of those tables' shards swept (by shard;
   *  Codex R150 VP150-02) — what the furthest row of a table names is only a
   *  lower bound beside it. */
  heldCoverage?: readonly number[];
}

/** A base interval that continues an entry contact (contactMerge.entryJoins):
 *  counted once, as the entry's; its extent reaches the base interval's exit. */
export interface SourceJoin { entrySrc: number; baseSrc: number; joins: ReadonlyMap<number, number>; baseShard: number; entryShard: number }

export interface ContactViewInput {
  sources: readonly ContactSource[];
  /** The tool / work body ids of a model pair. */
  pairName: (pair: number) => { a: string; b: string };
  /** On the shown axis, how far the check has swept: nothing is shown past
   *  it (plan 4.3). */
  coverage: number;
  joins?: readonly SourceJoin[];
}

// target kind bits
export const T_NEAR = 1, T_POSSIBLE = 2, T_REENTRY = 4, T_AT_START = 8, T_ENTRY = 16, T_ENTRY_MOVE = 32, T_RAPID = 64, T_OPEN = 128;
/** A near miss of the earlier generation the current one did not find again
 *  (plan 3.5: "aus dem früheren Lauf"). */
export const T_EARLIER = 256;

/** One table of one source, indexed. */
interface TableIndex {
  st: ContactStore;
  source: ContactSource;
  src: number;
  shard: number;
  /** Of the source's earlier generation (plan 3.5). */
  held: boolean;
  /** Its columns, read by row without a lookup (the union's hot paths). */
  c: Cols;
  /** The table's write revision at the build. */
  revision: number;
  /** This source's coverage, own and shown. */
  ownCov: number;
  cov: number;
  /** Its knowledge gaps on its own axis by pair (CSR): `hPairs` ascending,
   *  the pair's gaps at [hOff[k], hOff[k + 1]) of `hSpan` (closed [start,
   *  end] pairs, by start) and `hReason`. */
  hPairs: Uint32Array;
  hOff: Uint32Array;
  hSpan: Float64Array;
  hReason: Uint8Array;
}

type Col = readonly ArrayLike<number>[];
/** A column's value at `row`. */
const rd = (c: Col, row: number) => c[row >>> BLOCK_SHIFT]![row & (STORE_BLOCK - 1)]!;
interface Cols { enter: Col; exit: Col; witness: Col; flags: Col; freeAt: Col; freeR: Col; episode: Col; epPair: Col; epFlags: Col }
function colsOf(st: ContactStore): Cols {
  const I = st.intervals, E = st.episodes;
  return { enter: I.blocksOf("enter"), exit: I.blocksOf("exit"), witness: I.blocksOf("witness"), flags: I.blocksOf("flags"),
           freeAt: I.blocksOf("freeAt"), freeR: I.blocksOf("freeR"), episode: I.blocksOf("episode"),
           epPair: E.blocksOf("pair"), epFlags: E.blocksOf("flags") };
}

/** A sorted list of packed references with the largest shown end per block
 *  and up to it — the tint's and the marks' walk back from a position. */
interface RefList { refs: Uint32Array; max: Float64Array; pre: Float64Array }

export interface ContactView {
  readonly input: ContactViewInput;
  /** The targets: an interval at its refined entry, a near miss at its
   *  closest approach — `targetPos` / `targetEnd` / `targetKind` read them. */
  readonly n: number;
  /** Targets by position. */
  readonly tgt: RefList;
  /** The intervals that are no target of their own, by position. */
  readonly aux: RefList;
  /** Every episode by shown onset — the code panel's marks. */
  readonly ep: RefList;
  readonly tables: ReadonlyArray<TableIndex | undefined>;
  /** Base intervals counted as the entry's (sorted refs), and how far each
   *  such entry contact reaches as a finding (sorted entry refs, values). */
  readonly joined: Uint32Array;
  readonly reachRef: Uint32Array;
  readonly reachVal: Float64Array;
  /** Per source, the union of its two generations (plan 3.5), else none. */
  readonly unions: ReadonlyArray<UnionIndex | undefined>;
  /** The union pieces' share of the words — counted at the build, which
   *  asks every piece what it is anyway (a piece's kind is asked of the
   *  union; the words need all of them). */
  readonly unionCounts: ViewCounts;
  /** Current near misses matched to an earlier one (sorted by the current's
   *  reference), and the earlier one's — its key. */
  readonly nearCur: Uint32Array;
  readonly nearHeld: Uint32Array;
  /** Where the two generations contradict each other (plan 3.5; kept as
   *  contact and named): how many, and the first on the shown axis. */
  readonly conflicts: { count: number; at: number };
}

/** One generation of a union source: its intervals by group (pair, origin)
 *  and enter, as packed references, with its search bounds. */
interface UnionGen { uIdx: Uint32Array; back: number; front: number }
/** A source's union: [held, current] — contactUnion's side order. */
interface UnionIndex { gens: [UnionGen, UnionGen] }

const EP_MARK_CONTACT = 0, EP_MARK_POSSIBLE = 1, EP_MARK_BOUNDARY = 2;
const BLOCK = 64;
/** The sweep's position tolerance (findings at or before the entry move's end). */
const ON_ENTRY_TOL = 1e-9;
/** Positions within this lie on one span's start (the sweep's 1e-3 bisection) —
 *  only for saying where a contact began, never for whether it is there. */
const LINE_TOL = 1e-3;

// packed reference: row (22 bits) · table (3) · source (2) · near (1) · held
// generation (1) · piece (3: 0 a row, else 1 + the piece's START_* kind — the
// row is then its start evidence's interval). The budget's tables hold 2^18
// rows; 2^22 is the limit the build refuses past.
const ROW_MASK = 0x3fffff, TABLE_SHIFT = 22, SRC_SHIFT = 25, NEAR_BIT = 1 << 27, HELD_BIT = 1 << 28, PIECE_SHIFT = 29;
const MAX_TABLES = 8, MAX_SOURCES = 4;
const pack = (src: number, shard: number, row: number, near = false, held = false, piece = 0) =>
  (row | (shard << TABLE_SHIFT) | (src << SRC_SHIFT) | (near ? NEAR_BIT : 0) | (held ? HELD_BIT : 0) | (piece << PIECE_SHIFT)) >>> 0;
const rowOf = (ref: number) => ref & ROW_MASK;
const isNearRef = (ref: number) => (ref & NEAR_BIT) !== 0;
const isHeldRef = (ref: number) => (ref & HELD_BIT) !== 0;
const isPieceRef = (ref: number) => ref >>> PIECE_SHIFT !== 0;
/** A piece reference's start kind (START_*). */
const pieceKindOf = (ref: number) => (ref >>> PIECE_SHIFT) - 1;
/** The row reference a piece reference names (its start evidence's interval). */
const rowRefOf = (ref: number) => (ref & ((1 << PIECE_SHIFT) - 1)) >>> 0;
const slotOf = (src: number, held: boolean, shard: number) => (src * 2 + (held ? 1 : 0)) * MAX_TABLES + shard;
const tableOf = (v: ContactView, ref: number) =>
  v.tables[slotOf((ref >>> SRC_SHIFT) & 3, isHeldRef(ref), (ref >>> TABLE_SHIFT) & 7)]!;

const nameOf = (v: ContactView, t: TableIndex, pair: number) => (t.source.pairName ?? v.input.pairName)(pair);

const onEntryMove = (source: ContactSource, ownCum: number) =>
  !!source.entry && source.entryEnd !== undefined && ownCum <= source.entryEnd + ON_ENTRY_TOL;

/** Index of `x` in a sorted Uint32Array, −1 when absent. */
function findSorted(a: Uint32Array, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid]! < x) lo = mid + 1; else hi = mid; }
  return lo < a.length && a[lo] === x ? lo : -1;
}

/** The view still reads what it was built from — else it throws (VP-I107). */
function check(v: ContactView): void {
  for (const t of v.tables) {
    if (t && t.st.revision !== t.revision) {
      throw new Error("contactView: its tables changed since it was built — build it anew");
    }
  }
}

/** The own points [x0, x1] within [lo, hi] the map sends into [a, b] — the
 *  map is monotone, so they are one stretch; exact to adjacent doubles. Null:
 *  none. */
function preimage(at: (c: number) => number, a: number, b: number, lo: number, hi: number): [number, number] | null {
  if (!(lo <= hi) || at(hi) < a || at(lo) > b) return null;
  let x0: number, x1: number;
  if (at(lo) >= a) x0 = lo;
  else {
    let l = lo, h = hi;   // at(l) < a <= at(h)
    for (;;) { const m = l + (h - l) / 2; if (m <= l || m >= h) break; if (at(m) >= a) h = m; else l = m; }
    x0 = h;
  }
  if (at(hi) <= b) x1 = hi;
  else {
    let l = lo, h = hi;   // at(l) <= b < at(h)
    for (;;) { const m = l + (h - l) / 2; if (m <= l || m >= h) break; if (at(m) <= b) l = m; else h = m; }
    x1 = l;
  }
  return x0 <= x1 ? [x0, x1] : null;
}

/** The last own point the map sends to `c` or before it (the own coverage of
 *  a shown one). */
function lastOwnAtOrBefore(at: (c: number) => number, c: number): number {
  let lo = c, hi = Math.abs(c) + 1;
  for (let k = 0; at(lo) > c && k < 2000; k++) lo -= Math.abs(lo) + 1;
  for (let k = 0; at(hi) <= c && k < 2000; k++) hi = hi * 2 + 1;
  if (at(hi) <= c) return hi;
  for (;;) { const m = lo + (hi - lo) / 2; if (m <= lo || m >= hi) break; if (at(m) <= c) lo = m; else hi = m; }
  return lo;
}

/** The gaps of `pair` in table `t`: [from, to) into hSpan's pairs. */
function holeRange(t: TableIndex, pair: number): [number, number] {
  let lo = 0, hi = t.hPairs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t.hPairs[mid]! < pair) lo = mid + 1; else hi = mid; }
  return lo < t.hPairs.length && t.hPairs[lo] === pair ? [t.hOff[lo]!, t.hOff[lo + 1]!] : [0, 0];
}

/** The closed own stretch [x, y] holds a point outside every closed gap of
 *  `pair` (sorted by start): a gap may cover a contact wholly, a point gap a
 *  point. */
function freeOf(t: TableIndex, pair: number, x: number, y: number): boolean {
  const [from, to] = holeRange(t, pair);
  let reach = -Infinity, started = false;
  for (let k = from; k < to; k++) {
    const s = t.hSpan[2 * k]!, e = t.hSpan[2 * k + 1]!;
    if (e < x) continue;
    if (s > y) break;
    if (!started) { if (s > x) return true; started = true; reach = e; }
    else { if (s > reach) return true; reach = Math.max(reach, e); }
    if (reach >= y) return false;
  }
  return !started || reach < y;
}

/** The own stretch [x, y] less the gaps of `pair`, as pieces (a point outside
 *  every gap is a piece of its own): for the bands, at display resolution. */
function piecesOf(t: TableIndex, pair: number, x: number, y: number, out: number[]): void {
  const [from, to] = holeRange(t, pair);
  let cur = x, inside = false;
  for (let k = from; k < to; k++) {
    const s = t.hSpan[2 * k]!, e = t.hSpan[2 * k + 1]!;
    if (e < cur) continue;
    if (s > y) break;
    if (x === y) { inside = true; break; }   // a point inside a gap
    if (s > cur) out.push(cur, s);
    cur = Math.max(cur, e);
    if (cur >= y) return;
  }
  if (x === y) { if (!inside) out.push(x, x); return; }
  if (cur < y) out.push(cur, y);
}

/** Where an interval ends on its OWN axis, within its source's coverage: its
 *  exit; one ended at an unknown tool at the gap that ended it — the first
 *  TOOL gap of the pair from its witness on (VP-I103: an undecidable gap
 *  before it only suspended it; a tool gap not in the tables leaves it open,
 *  never an end made up); else it is open, to the coverage. */
function ownEnd(t: TableIndex, row: number): { end: number; open: boolean } {
  const exit = rd(t.c.exit, row);
  if (!Number.isNaN(exit)) return { end: Math.min(exit, t.ownCov), open: false };
  if (rd(t.c.flags, row) & IV_ENDED_AT_GAP) {
    const pair = rd(t.c.epPair, rd(t.c.episode, row));
    const w = rd(t.c.witness, row);
    const [from, to] = holeRange(t, pair);
    for (let k = from; k < to; k++) {
      if (t.hReason[k] === GAP_TOOL_UNKNOWN && t.hSpan[2 * k]! >= w) return { end: Math.min(t.hSpan[2 * k]!, t.ownCov), open: false };
    }
  }
  return { end: t.ownCov, open: true };
}

/** An interval's shown stretch: its contact as the shown axis has it (no
 *  join's reach — that is the base's own contact, VP-I104). */
function shownStretch(t: TableIndex, row: number): [number, number] {
  const a = t.source.at(t.st.intervals.get(row, "enter"));
  return [a, Math.max(a, Math.min(t.source.at(ownEnd(t, row).end), t.cov))];
}

/** The reach of an entry contact the base continues (its finding's extent). */
function reachOf(v: ContactView, ref: number): number | undefined {
  const k = findSorted(v.reachRef, ref);
  return k < 0 ? undefined : v.reachVal[k];
}

/** An episode's own stretch: onset to its end, an open one to its source's
 *  coverage. */
function epOwn(t: TableIndex, row: number): [number, number] {
  const E = t.st.episodes;
  const s = E.get(row, "onset"), e = E.get(row, "end");
  return [s, Math.max(s, Number.isNaN(e) ? t.ownCov : Math.min(e, t.ownCov))];
}

function refList(refs: Uint32Array, pos: Float64Array, end: Float64Array): RefList {
  const n = refs.length;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => pos[a]! - pos[b]! || refs[a]! - refs[b]!);
  const out = new Uint32Array(n);
  const blocks = Math.ceil(n / BLOCK);
  const max = new Float64Array(blocks).fill(-Infinity), pre = new Float64Array(blocks);
  for (let i = 0; i < n; i++) {
    out[i] = refs[order[i]!]!;
    const b = (i / BLOCK) | 0;
    max[b] = Math.max(max[b]!, end[order[i]!]!);
  }
  let m = -Infinity;
  for (let b = 0; b < blocks; b++) { m = Math.max(m, max[b]!); pre[b] = m; }
  return { refs: out, max, pre };
}

// ---- the fallback's union (round B4, plan 3.5) ----------------------------------------------------

type Tables = ReadonlyArray<TableIndex | undefined>;
const tableAt = (tables: Tables, ref: number) => tables[slotOf((ref >>> SRC_SHIFT) & 3, isHeldRef(ref), (ref >>> TABLE_SHIFT) & 7)]!;

/** An interval row's group: its pair and its origin (plan 3.5: "Je Paar und
 *  Herkunft"), as one sortable number. */
function groupOf(t: TableIndex, row: number): number {
  const ep = rd(t.c.episode, row);
  return rd(t.c.epPair, ep) * 4 + (rd(t.c.epFlags, ep) & EP_ORIGIN_MASK);
}
const groupOfRef = (tables: Tables, ref: number) => groupOf(tableAt(tables, ref), rowOf(ref));

/** An interval's end in the union, closed: its own end, never before it enters. */
const unionEnd = (t: TableIndex, row: number) => Math.max(rd(t.c.enter, row), ownEnd(t, row).end);

/** One generation's intervals of one group, [lo, hi) of its index, as the
 *  union reads them. */
function sideOf(tables: Tables, g: UnionGen, lo: number, hi: number): UnionSide {
  // a group's intervals are one table's (a pool splits by pair); asked per row all the same
  const u = g.uIdx;
  const tab = (k: number) => tableAt(tables, u[lo + k]!);
  const row = (k: number) => u[lo + k]! & ROW_MASK;
  return {
    n: hi - lo,
    enter: k => rd(tab(k).c.enter, row(k)),
    end: k => unionEnd(tab(k), row(k)),
    open: k => ownEnd(tab(k), row(k)).open,
    witness: k => rd(tab(k).c.witness, row(k)),
    enterDecided: k => (rd(tab(k).c.flags, row(k)) & IV_ENTER_DECIDED) !== 0,
    exitDecided: k => (rd(tab(k).c.flags, row(k)) & IV_EXIT_DECIDED) !== 0,
    freeAt: k => rd(tab(k).c.freeAt, row(k)),
    freeR: k => rd(tab(k).c.freeR, row(k)),
    back: g.back, front: g.front,
  };
}

/** The range of `group` in a generation's index: its start by bisection, its
 *  end galloping from there (a group holds a few intervals, mostly). */
function groupRange(tables: Tables, g: UnionGen, group: number): [number, number] {
  const n = g.uIdx.length, at = (i: number) => groupOfRef(tables, g.uIdx[i]!);
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (at(m) < group) lo = m + 1; else hi = m; }
  if (lo >= n || at(lo) !== group) return [lo, lo];
  let step = 1, last = lo;   // at(last) === group
  while (last + step < n && at(last + step) === group) { last += step; step *= 2; }
  let a = last + 1, b = Math.min(n, last + step);   // the end lies in [a, b]
  while (a < b) { const m = (a + b) >> 1; if (at(m) === group) a = m + 1; else b = m; }
  return [lo, a];
}

/** Every group of a union source in order: its two sides and their starts in
 *  the generations' indexes. */
function eachGroup(tables: Tables, u: UnionIndex, each: (sides: UnionSide[], los: readonly [number, number]) => void): void {
  const [gH, gC] = u.gens;
  let i = 0, j = 0;
  while (i < gH.uIdx.length || j < gC.uIdx.length) {
    const kH = i < gH.uIdx.length ? groupOfRef(tables, gH.uIdx[i]!) : Infinity;
    const kC = j < gC.uIdx.length ? groupOfRef(tables, gC.uIdx[j]!) : Infinity;
    const group = Math.min(kH, kC);
    let i2 = i, j2 = j;
    while (i2 < gH.uIdx.length && groupOfRef(tables, gH.uIdx[i2]!) === group) i2++;
    while (j2 < gC.uIdx.length && groupOfRef(tables, gC.uIdx[j2]!) === group) j2++;
    each([sideOf(tables, gH, i, i2), sideOf(tables, gC, j, j2)], [i, j]);
    i = i2; j = j2;
  }
}

/** A source's union index over its tables of both generations. */
function unionIndex(tables: Tables, src: number): UnionIndex {
  const gen = (held: boolean): UnionGen => {
    const refs: number[] = [];
    for (let sh = 0; sh < MAX_TABLES; sh++) {
      const t = tables[slotOf(src, held, sh)];
      if (t) for (let iv = 0; iv < t.st.intervals.rows; iv++) refs.push(pack(src, sh, iv, false, held));
    }
    const grp = refs.map(r => groupOfRef(tables, r));
    const ent = refs.map(r => tableAt(tables, r).st.intervals.get(rowOf(r), "enter"));
    const order = refs.map((_, k) => k).sort((x, y) => grp[x]! - grp[y]! || ent[x]! - ent[y]! || refs[x]! - refs[y]!);
    const uIdx = Uint32Array.from(order, k => refs[k]!);
    const col = (k: number, c: string) => tableAt(tables, uIdx[k]!).st.intervals.get(rowOf(uIdx[k]!), c);
    const r = unionReach(uIdx.length, k => col(k, "enter"), k => col(k, "freeAt"), k => col(k, "freeR"),
                         (k, k2) => grp[order[k]!] === grp[order[k2]!]);
    return { uIdx, back: r.back, front: r.front };
  };
  return { gens: [gen(true), gen(false)] };
}

/** What a piece holds and is: its intervals' classes, its lead (the earliest
 *  interval holding its start — plan 3.5's "Ursprungszeile") and its heir
 *  (the earlier generation's interval whose witness it holds — the event
 *  whose identity it keeps). Row references. */
interface PieceInfo {
  piece: UnionPiece;
  lead: number;
  heir: number;
  /** Every interval it holds is a boundary contact, a cutting contact's
   *  later rapid part or a base contact an entry contact continues. */
  aux: boolean;
  possible: boolean;
  /** It ends where an open interval of it runs to its coverage. */
  openEnd: boolean;
  /** Its intervals (row references), for the tint, the bands and the joins. */
  rows: number[];
}

function describePiece(tables: Tables, u: UnionIndex, los: readonly [number, number], sides: readonly UnionSide[],
                       piece: UnionPiece, joined: Uint32Array): PieceInfo {
  const info: PieceInfo = { piece, lead: -1, heir: -1, aux: true, possible: true, openEnd: false, rows: [] };
  let leadEnter = Infinity, heirW = Infinity;
  pieceIntervals(sides, piece, (sd, k, holdsStart) => {
    const r = u.gens[sd]!.uIdx[los[sd]! + k]!, t = tableAt(tables, r), row = rowOf(r), c = t.c;
    const flags = rd(c.flags, row), epFlags = rd(c.epFlags, rd(c.episode, row));
    info.rows.push(r);
    if (!((epFlags & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY || (flags & IV_CONTINUES_CUT) || findSorted(joined, r) >= 0)) info.aux = false;
    if (!(flags & IV_POSSIBLE)) info.possible = false;
    const enter = rd(c.enter, row);
    if (holdsStart && enter < leadEnter) { leadEnter = enter; info.lead = r; }
    if (sd === 0) {
      const w = rd(c.witness, row);
      const inside = (w > piece.start || (w === piece.start && !piece.startOpen)) && (w < piece.end || (w === piece.end && !piece.endOpen));
      if (inside && w < heirW) { heirW = w; info.heir = r; }
    }
    if (!piece.endOpen && ownEnd(t, row).open && unionEnd(t, row) === piece.end) info.openEnd = true;
  });
  return info;
}

/** Where `ref` (a row of the generation) stands in its group's range of the
 *  index — by enter, then the reference itself (the index's own order). */
function indexIn(tables: Tables, g: UnionGen, lo: number, hi: number, ref: number): number {
  const t = tableAt(tables, ref), e = rd(t.c.enter, rowOf(ref));
  let a = lo, b = hi;
  while (a < b) { const m = (a + b) >> 1; const r = g.uIdx[m]!; if (rd(tableAt(tables, r).c.enter, rowOf(r)) < e) a = m + 1; else b = m; }
  while (a < hi && g.uIdx[a] !== ref) a++;
  return a - lo;
}

/** A view's last asked group (a list asks of one group's pieces in turn): its
 *  ranges, sides and free stretches. The view never changes (VP-I107), so
 *  neither does what it caches. */
interface GroupCtx { src: number; group: number; r0: [number, number]; r1: [number, number]; sides: UnionSide[]; memo: FreeMemo }
const lastGroup = new WeakMap<ContactView, GroupCtx>();

/** A piece reference's union, sides and piece, asked from its start. */
function pieceCtx(v: ContactView, ref: number): { info: PieceInfo; t: TableIndex } {
  const t = tableOf(v, ref), u = v.unions[t.src]!;
  const group = groupOf(t, rowOf(ref));
  let g = lastGroup.get(v);
  if (!g || g.src !== t.src || g.group !== group) {
    const r0 = groupRange(v.tables, u.gens[0], group), r1 = groupRange(v.tables, u.gens[1], group);
    g = { src: t.src, group, r0, r1, sides: [sideOf(v.tables, u.gens[0], r0[0], r0[1]), sideOf(v.tables, u.gens[1], r1[0], r1[1])], memo: [] };
    lastGroup.set(v, g);
  }
  // its start, as the build named it: the evidence row's place in its side
  const sd = t.held ? 0 : 1, r = sd === 0 ? g.r0 : g.r1, ev = rowRefOf(ref);
  const pos = evidencePos(g.sides, sd, pieceKindOf(ref), indexIn(v.tables, u.gens[sd]!, r[0], r[1], ev), g.memo);
  const piece = pieceFrom(g.sides, pos, true, g.memo)!;
  return { info: describePiece(v.tables, u, [g.r0[0], g.r1[0]], g.sides, piece, v.joined), t };
}

/** A union piece's kind bits (T_*), from what it holds: the earlier event's
 *  where it keeps one, else its lead's. A piece begun at a free stretch or a
 *  kept place begins after a proven separation: a re-entry. */
function pieceKindBits(tables: Tables, info: PieceInfo, kind: number, source: ContactSource, reached: boolean): number {
  const rep = info.heir >= 0 ? info.heir : info.lead;
  const t = tableAt(tables, rep), row = rowOf(rep), E = t.st.episodes, ep = t.st.intervals.get(row, "episode");
  const epFlags = E.get(ep, "flags"), first = E.get(ep, "firstIv") === row;
  let bits = 0;
  if (info.possible) bits |= T_POSSIBLE;
  const begun = info.heir >= 0 || kind === START_ENTER;
  if (!first || !begun) bits |= T_REENTRY;
  if (first && begun && (epFlags & EP_AT_START)) bits |= T_AT_START;
  if (epFlags & EP_RAPID) bits |= T_RAPID;
  if (info.openEnd && !reached) bits |= T_OPEN;
  if (source.entry) { bits |= T_ENTRY; if (onEntryMove(source, info.piece.start)) bits |= T_ENTRY_MOVE; }
  return bits;
}

/** An interval row's or a near episode's identity as the view without a
 *  fallback names it: origin, pair, episode number, interval number. */
function rowKey(t: TableIndex, row: number, near: boolean): string {
  const E = t.st.episodes, I = t.st.intervals;
  const ep = near ? row : I.get(row, "episode");
  let k = 0;
  if (!near) for (let iv = E.get(ep, "firstIv"); iv !== row && iv !== NONE; iv = I.get(iv, "next")) k++;
  return `${t.source.entry ? "E" : "C"}${E.get(ep, "pair")}|${E.get(ep, "ordinal")}|${near ? "n" : k}`;
}

/** The furthest position a table's rows name — the least its sweep covered
 *  (a lower bound beside the coverage its pool reported). */
function provenCoverage(st: ContactStore): number {
  let m = 0;
  const take = (x: number) => { if (x > m) m = x; };
  const E = st.episodes, I = st.intervals, G = st.gaps;
  for (let e = 0; e < E.rows; e++) { take(E.get(e, "onset")); take(E.get(e, "closeAt")); const x = E.get(e, "end"); if (!Number.isNaN(x)) take(x); }
  for (let iv = 0; iv < I.rows; iv++) {
    take(I.get(iv, "enter")); take(I.get(iv, "witness"));
    const x = I.get(iv, "exit"), f = I.get(iv, "freeAt");
    if (!Number.isNaN(x)) take(x);
    if (!Number.isNaN(f)) take(f);
  }
  for (let g = 0; g < G.rows; g++) { take(G.get(g, "start")); const x = G.get(g, "end"); if (!Number.isNaN(x)) take(x); }
  return m;
}

const NO_COUNTS = (): ViewCounts => ({ collisions: 0, entryCollisions: 0, nearMisses: 0, possible: 0, startsIn: false });
function countKind(c: ViewCounts, k: number): void {
  if (k & T_POSSIBLE) { c.possible++; return; }
  if (k & T_NEAR) { c.nearMisses++; return; }
  if (k & T_ENTRY_MOVE) c.entryCollisions++;
  else c.collisions++;
  if ((k & T_AT_START) && !(k & T_ENTRY)) c.startsIn = true;
}

export function buildContactView(input: ContactViewInput): ContactView {
  const { sources, coverage } = input;
  if (sources.length > MAX_SOURCES) throw new Error(`contactView: ${sources.length} sources (at most ${MAX_SOURCES})`);
  const tables: Array<TableIndex | undefined> = [];
  const list: TableIndex[] = [];
  sources.forEach((source, si) => {
    const own = source.ownCoverage ?? lastOwnAtOrBefore(source.at, source.coverage ?? coverage);
    const gens: Array<[readonly ContactStore[], boolean]> = [[source.stores, false]];
    if (source.held?.length) gens.push([source.held, true]);
    for (const [stores, held] of gens) {
      if (stores.length > MAX_TABLES) throw new Error(`contactView: ${stores.length} tables (at most ${MAX_TABLES})`);
      stores.forEach((st, sh) => {
        if (st.intervals.rows > ROW_MASK || st.episodes.rows > ROW_MASK) throw new Error("contactView: a table past 2^22 rows");
        // the earlier generation's coverage: how far its shard swept, else (and
        // at least) what its own rows prove
        const ownCov = held ? Math.max(provenCoverage(st), source.heldCoverage?.[sh] ?? -Infinity) : own;
        const cov = Math.min(source.at(ownCov), coverage);
        // the gaps on the own axis, by pair then start (CSR)
        const G = st.gaps, idx: number[] = [];
        for (let g = 0; g < G.rows; g++) if (G.get(g, "start") <= ownCov) idx.push(g);
        idx.sort((x, y) => G.get(x, "pair") - G.get(y, "pair") || G.get(x, "start") - G.get(y, "start"));
        const hSpan = new Float64Array(2 * idx.length), hReason = new Uint8Array(idx.length);
        const pairs: number[] = [], off: number[] = [];
        idx.forEach((g, k) => {
          const pair = G.get(g, "pair"), s0 = G.get(g, "start"), e0 = G.get(g, "end");
          if (!pairs.length || pairs[pairs.length - 1] !== pair) { pairs.push(pair); off.push(k); }
          hSpan[2 * k] = s0;
          hSpan[2 * k + 1] = Math.max(s0, Number.isNaN(e0) ? ownCov : Math.min(e0, ownCov));
          hReason[k] = G.get(g, "reason");
        });
        off.push(idx.length);
        const t: TableIndex = { st, source, src: si, shard: sh, held, c: colsOf(st), revision: st.revision, ownCov, cov,
          hPairs: Uint32Array.from(pairs), hOff: Uint32Array.from(off), hSpan, hReason };
        tables[slotOf(si, held, sh)] = t;
        list.push(t);
      });
    }
  });
  // the joins: the base intervals counted as the entry's (between the
  // current generations — the entry side's tables and the base's)
  const joins = input.joins ?? [];
  const joined = Uint32Array.from(joins.flatMap(j => tables[slotOf(j.baseSrc, false, j.baseShard)]
    ? [...j.joins.keys()].map(biv => pack(j.baseSrc, j.baseShard, biv)) : [])).sort();
  const entryRows = Uint32Array.from(joins.flatMap(j => [...j.joins.values()].map(eiv => pack(j.entrySrc, j.entryShard, eiv)))).sort();
  // a union piece holding a joined row: its end (the reach), the entry piece holding an entry row
  const baseEnd = new Map<number, number>(), entryPiece = new Map<number, number>();
  // the targets and the other intervals (temporary positions, then sorted)
  const tR: number[] = [], tP: number[] = [], tE: number[] = [];
  const aR: number[] = [], aP: number[] = [], aE: number[] = [];
  let nE = 0;
  for (const t of list) nE += t.st.episodes.rows;
  const eRefs = new Uint32Array(nE), eOn = new Float64Array(nE), eEnd = new Float64Array(nE);
  let ei = 0;
  const unions: Array<UnionIndex | undefined> = [];
  const unionCounts = NO_COUNTS();
  const nearPairs: Array<[number, number]> = [];
  let conflicts = 0, conflictAt = Infinity;
  sources.forEach((source, si) => {
    const mine = list.filter(t => t.src === si);
    for (const t of mine) {
      const E = t.st.episodes;
      for (let e = 0; e < E.rows; e++) {
        const [s0, x] = epOwn(t, e);
        eRefs[ei] = pack(si, t.shard, e, false, t.held); eOn[ei] = source.at(s0); eEnd[ei++] = Math.min(source.at(x), t.cov);
      }
    }
    if (!source.held?.length) {
      // without a fallback: every interval its own event
      for (const t of mine) {
        const E = t.st.episodes, I = t.st.intervals;
        for (let iv = 0; iv < I.rows; iv++) {
          const ref = pack(si, t.shard, iv);
          const [p, e] = shownStretch(t, iv);
          // a joined base interval is the entry's finding; a later rapid part of
          // a cutting contact is the finding before it; a boundary contact (a
          // range sweep's start) is no finding of its own — all of them touch
          if ((E.get(I.get(iv, "episode"), "flags") & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY
              || findSorted(joined, ref) >= 0 || (I.get(iv, "flags") & IV_CONTINUES_CUT)) {
            aR.push(ref); aP.push(p); aE.push(e);
          } else { tR.push(ref); tP.push(p); tE.push(e); }
        }
        for (let e = 0; e < E.rows; e++) {
          if (E.get(e, "ivCount") !== 0 || (E.get(e, "flags") & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY) continue;
          const p = source.at(E.get(e, "closeAt"));
          tR.push(pack(si, t.shard, e, true)); tP.push(p); tE.push(p);
        }
      }
      return;
    }
    // after a fallback: the pieces of both generations' union, per group
    const u = unionIndex(tables, si);
    unions[si] = u;
    eachGroup(tables, u, (sides, los) => {
      eachPiece(sides, piece => {
        if (piece.startKind < 0) throw new Error("contactView: a union piece whose start no evidence names");
        const ev = u.gens[piece.startSide]!.uIdx[los[piece.startSide]! + piece.startIdx]!;
        const ref = (ev | ((piece.startKind + 1) << PIECE_SHIFT)) >>> 0;
        const info = describePiece(tables, u, los, sides, piece, joined);
        const p = source.at(piece.start), e = Math.max(p, Math.min(source.at(piece.end), coverage));
        for (const r of info.rows) {
          if (findSorted(joined, r) >= 0) baseEnd.set(r, e);
          if (findSorted(entryRows, r) >= 0) entryPiece.set(r, ref);
        }
        if (info.aux) { aR.push(ref); aP.push(p); aE.push(e); return; }
        tR.push(ref); tP.push(p); tE.push(e);
        countKind(unionCounts, pieceKindBits(tables, info, piece.startKind, source, info.rows.some(r => findSorted(entryRows, r) >= 0)));
      });
      eachWideConflict(sides, x => { conflicts++; conflictAt = Math.min(conflictAt, source.at(x)); });
    });
    // the near misses of both generations: one to one per group by overlap, in order
    const nears = (held: boolean) => {
      const out: Array<{ ref: number; group: number; s: number; e: number }> = [];
      for (const t of mine) {
        if (t.held !== held) continue;
        const E = t.st.episodes;
        for (let e = 0; e < E.rows; e++) {
          if (E.get(e, "ivCount") !== 0 || (E.get(e, "flags") & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY) continue;
          const [s0, x] = epOwn(t, e);
          out.push({ ref: pack(si, t.shard, e, true, held), group: E.get(e, "pair") * 4 + (E.get(e, "flags") & EP_ORIGIN_MASK), s: s0, e: x });
        }
      }
      return out.sort((a, b) => a.group - b.group || a.s - b.s || a.ref - b.ref);
    };
    const hn = nears(true), cn = nears(false);
    const at = (r: number) => { const t = tableAt(tables, r); return source.at(t.st.episodes.get(rowOf(r), "closeAt")); };
    let a = 0, b = 0;
    const show = (r: number) => { const p = at(r); tR.push(r); tP.push(p); tE.push(p); };
    while (a < hn.length || b < cn.length) {
      const h = hn[a], c = cn[b];
      if (h && c && h.group === c.group && h.s <= c.e && c.s <= h.e) { nearPairs.push([c.ref, h.ref]); show(c.ref); a++; b++; continue; }
      // the one that ends first (or the lower group) has no partner
      if (!c || (h && (h.group < c.group || (h.group === c.group && h.e < c.e)))) { show(h!.ref); a++; }
      else { show(c.ref); b++; }
    }
  });
  // the reach of every entry contact a base contact continues (its finding's extent)
  const jRef: number[] = [], jVal: number[] = [];
  for (const j of joins) {
    const bt = tables[slotOf(j.baseSrc, false, j.baseShard)];
    if (!bt) continue;
    for (const [biv, eiv] of j.joins) {
      const b = pack(j.baseSrc, j.baseShard, biv), e = pack(j.entrySrc, j.entryShard, eiv);
      jRef.push(entryPiece.get(e) ?? e);
      jVal.push(baseEnd.get(b) ?? shownStretch(bt, biv)[1]);
    }
  }
  const rOrder = jRef.map((_, k) => k).sort((x, y) => jRef[x]! - jRef[y]!);
  const reachRef = Uint32Array.from(rOrder, k => jRef[k]!), reachVal = Float64Array.from(rOrder, k => jVal[k]!);
  const tgt = refList(Uint32Array.from(tR), Float64Array.from(tP), Float64Array.from(tE));
  const aux = refList(Uint32Array.from(aR), Float64Array.from(aP), Float64Array.from(aE));
  const ep = refList(eRefs, eOn, eEnd);
  nearPairs.sort((x, y) => x[0] - y[0]);
  return { input, n: tgt.refs.length, tgt, aux, ep, tables, joined, reachRef, reachVal, unions, unionCounts,
           nearCur: Uint32Array.from(nearPairs, x => x[0]), nearHeld: Uint32Array.from(nearPairs, x => x[1]),
           conflicts: { count: conflicts, at: conflicts ? conflictAt : NaN } };
}

/** A reference's position on the shown axis (unchecked): an interval at its
 *  entry, a near miss at its closest approach, a union piece at its start. */
function refPos(v: ContactView, ref: number): number {
  const t = tableOf(v, ref), row = rowOf(ref);
  if (isPieceRef(ref)) return t.source.at(pieceCtx(v, ref).info.piece.start);
  return t.source.at(isNearRef(ref) ? t.st.episodes.get(row, "closeAt") : t.st.intervals.get(row, "enter"));
}

/** Target `i`'s position on the shown axis (unchecked). */
function posOf(v: ContactView, i: number): number { return refPos(v, v.tgt.refs[i]!); }

/** A union piece's shown end (without a join's reach). */
function pieceShownEnd(v: ContactView, t: TableIndex, p: UnionPiece): number {
  return Math.max(t.source.at(p.start), Math.min(t.source.at(p.end), v.input.coverage));
}

/** Where target `i` ends as a finding (unchecked): a near miss at its
 *  position; an interval or a union piece at its shown end, an entry contact
 *  the base continues at the base's end. */
function endOf(v: ContactView, i: number): number {
  const ref = v.tgt.refs[i]!;
  if (isNearRef(ref)) return posOf(v, i);
  let e: number;
  if (isPieceRef(ref)) { const { info, t } = pieceCtx(v, ref); e = pieceShownEnd(v, t, info.piece); }
  else e = shownStretch(tableOf(v, ref), rowOf(ref))[1];
  const r = reachOf(v, ref);
  return r === undefined ? e : Math.max(e, r);
}

function kindOf(v: ContactView, i: number): number {
  const ref = v.tgt.refs[i]!, t = tableOf(v, ref), row = rowOf(ref), E = t.st.episodes;
  if (isPieceRef(ref)) {
    const c = pieceCtx(v, ref);
    return pieceKindBits(v.tables, c.info, pieceKindOf(ref), c.t.source, reachOf(v, ref) !== undefined);
  }
  if (isNearRef(ref)) {
    let kind = T_NEAR;
    const flags = E.get(row, "flags");
    if (flags & EP_POSSIBLE) kind |= T_POSSIBLE;
    if (flags & EP_RAPID) kind |= T_RAPID;
    if (t.source.entry) { kind |= T_ENTRY; if (onEntryMove(t.source, E.get(row, "closeAt"))) kind |= T_ENTRY_MOVE; }
    // an earlier near miss the current generation did not find again (plan 3.5)
    if (t.held) kind |= T_EARLIER;
    return kind;
  }
  const I = t.st.intervals, epRow = I.get(row, "episode"), flags = E.get(epRow, "flags"), ivFlags = I.get(row, "flags");
  const first = E.get(epRow, "firstIv") === row;
  let kind = 0;
  if (ivFlags & IV_POSSIBLE) kind |= T_POSSIBLE;
  if (!first) kind |= T_REENTRY;
  if (first && (flags & EP_AT_START)) kind |= T_AT_START;
  if (flags & EP_RAPID) kind |= T_RAPID;
  if (ownEnd(t, row).open && reachOf(v, ref) === undefined) kind |= T_OPEN;
  if (t.source.entry) { kind |= T_ENTRY; if (onEntryMove(t.source, I.get(row, "enter"))) kind |= T_ENTRY_MOVE; }
  return kind;
}

/** A union piece's identity (plan 3.5): the earlier event's key where it
 *  holds that event's witness; else its generation, its lead row and the
 *  evidence its start stands on ("b": its lead's own enter). */
function pieceKey(v: ContactView, ref: number, info: PieceInfo): string {
  if (info.heir >= 0) return rowKey(tableOf(v, info.heir), rowOf(info.heir), false);
  const lt = tableOf(v, info.lead), lead = rowKey(lt, rowOf(info.lead), false);
  const ev = rowRefOf(ref), kind = pieceKindOf(ref);
  const et = tableOf(v, ev);
  const evKey = kind === START_ENTER && ev === info.lead ? "b" : `${"ef"[kind]}${et.st.generation}:${rowKey(et, rowOf(ev), false)}`;
  return `${lead}#g${lt.st.generation}/${evKey}`;
}

function keyOf(v: ContactView, i: number): string {
  const ref = v.tgt.refs[i]!, t = tableOf(v, ref), row = rowOf(ref);
  if (isPieceRef(ref)) return pieceKey(v, ref, pieceCtx(v, ref).info);
  if (isNearRef(ref) && v.unions[t.src] && !t.held) {
    // a current near miss after a fallback: matched, the earlier one's key
    const k = findSorted(v.nearCur, ref);
    if (k >= 0) { const h = v.nearHeld[k]!; return rowKey(tableOf(v, h), rowOf(h), true); }
    return `${rowKey(t, row, true)}#g${t.st.generation}`;
  }
  return rowKey(t, row, isNearRef(ref));
}

/** Target `i`'s position on the shown axis. */
export function targetPos(v: ContactView, i: number): number { check(v); return posOf(v, i); }
/** Where target `i` ends on the shown axis (a near miss: its position). */
export function targetEnd(v: ContactView, i: number): number { check(v); return endOf(v, i); }
/** Target `i`'s kind bits (T_*). */
export function targetKind(v: ContactView, i: number): number { check(v); return kindOf(v, i); }
/** The identity of target `i` (plan 1.2): origin, pair, episode number per
 *  pair, interval number in the episode (`n` for a near miss). */
export function targetKey(v: ContactView, i: number): string { check(v); return keyOf(v, i); }

/** The line at a position of the shown track; `atEnd` reads a position where
 *  something ENDS (trackLineAt). */
export type LineAt = (pos: number, atEnd?: boolean) => number | null;

/** The kind bits on a views' object. */
function flagTarget(target: ClashTarget, k: number): ClashTarget {
  if (k & T_RAPID) target.rapid = true;
  if (k & T_REENTRY) target.reentry = true;
  if (k & T_POSSIBLE) target.possible = true;
  if (k & T_AT_START) target.atStart = true;
  if (k & T_ENTRY) target.entry = true;
  if (k & T_ENTRY_MOVE) target.entryMove = true;
  if (k & T_EARLIER) target.earlier = true;
  return target;
}

function objectOf(v: ContactView, i: number, lineAt: LineAt): ClashTarget {
  const ref = v.tgt.refs[i]!, t = tableOf(v, ref), row = rowOf(ref);
  const own = t.source.ownTrack;
  if (isPieceRef(ref)) {
    // a union piece: asked once from its start
    const { info } = pieceCtx(v, ref), p = info.piece;
    const k = pieceKindBits(v.tables, info, pieceKindOf(ref), t.source, reachOf(v, ref) !== undefined);
    const rep = info.heir >= 0 ? info.heir : info.lead, rt = tableOf(v, rep);
    const { a, b } = nameOf(v, rt, rt.st.episodes.get(rt.st.intervals.get(rowOf(rep), "episode"), "pair"));
    const pos = t.source.at(p.start), r = reachOf(v, ref), e = pieceShownEnd(v, t, p), end = r === undefined ? e : Math.max(e, r);
    const line = own ? own.lineAt(p.start) : lineAt(pos);
    const target = flagTarget({ cum: pos, cumEnd: end, key: pieceKey(v, ref, info), line: line ?? 0, a, b, dist: 0, near: false }, k);
    const last = own ? own.lineAt(p.end, true) : end > pos ? lineAt(end, true) : null;
    if (last !== null && last > target.line) target.spanEndLine = last;
    return target;
  }
  const k = kindOf(v, i);
  const ep = k & T_NEAR ? row : t.st.intervals.get(row, "episode");
  const { a, b } = nameOf(v, t, t.st.episodes.get(ep, "pair"));
  const pos = posOf(v, i), end = endOf(v, i);
  // the line: the shown track's at the position — a folded source's own track's
  const ownPos = k & T_NEAR ? t.st.episodes.get(row, "closeAt") : t.st.intervals.get(row, "enter");
  const line = own ? own.lineAt(ownPos) : lineAt(pos);
  const target = flagTarget({ cum: pos, cumEnd: end, key: keyOf(v, i), line: line ?? 0, a, b,
    dist: k & T_NEAR ? t.st.episodes.get(ep, "closeDist") : 0, near: (k & T_NEAR) !== 0 }, k);
  // the last line the contact reaches: the move its end lies in or ends at
  const last = own && !(k & T_NEAR) ? own.lineAt(ownEnd(t, row).end, true) : end > pos ? lineAt(end, true) : null;
  if (last !== null && last > target.line) target.spanEndLine = last;
  return target;
}

/** Target `i` as the views' object — built only for what is shown. `lineAt`
 *  is the shown track's line at a position (null: none, plan 1.3). */
export function targetAt(v: ContactView, i: number, lineAt: LineAt): ClashTarget {
  check(v);
  return objectOf(v, i, lineAt);
}

export interface ViewCounts { collisions: number; entryCollisions: number; nearMisses: number; possible: number; startsIn: boolean }

/** What the words count (sweepWords.findingWords' kinds), from the index;
 *  a union piece's kind was counted at the build. */
export function viewCounts(v: ContactView): ViewCounts {
  check(v);
  const c = { ...v.unionCounts };
  for (let i = 0; i < v.n; i++) if (!isPieceRef(v.tgt.refs[i]!)) countKind(c, kindOf(v, i));
  return c;
}

const sampleAt = (v: ContactView, i: number) => {
  const p = posOf(v, i), room = endOf(v, i) - p;
  return room > 0 ? p + Math.min(JUMP_NUDGE, room / 2) : p;
};

/** The first target whose position is past `x` (at or past with !strict). */
function firstAfter(v: ContactView, x: number, strict: boolean): number {
  let lo = 0, hi = v.n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1, p = posOf(v, mid);
    if (strict ? p <= x : p < x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function findKeyOf(v: ContactView, key: string, near?: number): number {
  if (near !== undefined) {
    for (let i = firstAfter(v, near - 2 * JUMP_NUDGE, false); i < v.n && posOf(v, i) <= near + 2 * JUMP_NUDGE; i++) {
      if (keyOf(v, i) === key) return i;
    }
  }
  for (let i = 0; i < v.n; i++) if (keyOf(v, i) === key) return i;
  return -1;
}

/** The target after the one shown (by key, while the timeline still stands
 *  where it showed it), else the first a jump would land past `s`; wraps.
 *  findingNav's rule, on the index (binary search on the start; a jump lands
 *  at most JUMP_NUDGE past it). */
export function indexAfter(v: ContactView, s: number, sel: { key: string; pos: number } | null): number {
  check(v);
  if (!v.n) return -1;
  if (sel && sel.pos === s) {
    const i = findKeyOf(v, sel.key, s);
    if (i >= 0) return (i + 1) % v.n;
  }
  // the first with pos > s − JUMP_NUDGE, then the first whose sample lies past s
  for (let i = firstAfter(v, s - JUMP_NUDGE, true); i < v.n; i++) if (sampleAt(v, i) > s) return i;
  return 0;
}

export function indexBefore(v: ContactView, s: number, sel: { key: string; pos: number } | null): number {
  check(v);
  if (!v.n) return -1;
  if (sel && sel.pos === s) {
    const i = findKeyOf(v, sel.key, s);
    if (i >= 0) return (i - 1 + v.n) % v.n;
  }
  for (let i = Math.min(firstAfter(v, s, false), v.n - 1); i >= 0; i--) if (sampleAt(v, i) < s) return i;
  return v.n - 1;
}

/** The index of the target `key` near position `s` (its sample lies within
 *  JUMP_NUDGE of it), else anywhere; −1 when gone. */
export function findKey(v: ContactView, key: string, near?: number): number {
  check(v);
  return findKeyOf(v, key, near);
}

/** At most `max` targets around index `center` (plan 4.4: the list's window),
 *  with how many lie before and after it. */
export function targetWindow(v: ContactView, center: number, max: number, lineAt: LineAt):
    { first: number; targets: ClashTarget[]; before: number; after: number } {
  check(v);
  if (!v.n) return { first: 0, targets: [], before: 0, after: 0 };
  const c = Math.max(0, Math.min(v.n - 1, center));
  const first = Math.max(0, Math.min(c - (max >> 1), v.n - max));
  const last = Math.min(v.n, first + max);
  const targets: ClashTarget[] = [];
  for (let i = first; i < last; i++) targets.push(objectOf(v, i, lineAt));
  return { first, targets, before: first, after: v.n - last };
}

/** Walks back from `pos` over the entries of `list` whose shown stretch may
 *  hold it (block maxima skip the rest); `each` gets every candidate ref. */
function walkBack(list: RefList, pos: number, startOf: (ref: number) => number, each: (ref: number) => void): void {
  let lo = 0, hi = list.refs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (startOf(list.refs[mid]!) <= pos) lo = mid + 1; else hi = mid; }
  for (let i = lo - 1; i >= 0; i--) {
    const blk = (i / BLOCK) | 0;
    if (list.pre[blk]! < pos) break;
    if (list.max[blk]! < pos) { i = blk * BLOCK; continue; }
    each(list.refs[i]!);
  }
}

/** The shown point `pos` is the image of an own point of interval `row`'s
 *  contact outside every gap of its source (VP-I102: the gap is cut on the
 *  own axis). */
function contactAt(t: TableIndex, row: number, pos: number): boolean {
  const I = t.st.intervals;
  const enter = I.get(row, "enter"), end = ownEnd(t, row).end;
  if (pos > t.cov) return false;
  const pre = preimage(t.source.at, pos, pos, enter, end);
  return !!pre && freeOf(t, t.st.episodes.get(I.get(row, "episode"), "pair"), pre[0], pre[1]);
}

/** The bodies in contact at `pos` (plan 4.3): a pair glows where it is in
 *  contact by one of its tables — an open contact to its source's coverage,
 *  never at a point a gap of that source holds, never widened (VP-I101), an
 *  entry contact the base continues by the base's own contact (VP-I104). */
/** A union piece's own contact at the shown `pos`: an interval it holds, in
 *  contact there by its own table (its generation's gaps cut out on its own
 *  axis), within the piece (a free stretch beside it cut away). */
function pieceTint(v: ContactView, ref: number, pos: number, out: Set<string>): void {
  const { info } = pieceCtx(v, ref), p = info.piece, rows = info.rows;
  for (const r of rows) {
    const t = tableOf(v, r), row = rowOf(r), I = t.st.intervals;
    const pair = t.st.episodes.get(I.get(row, "episode"), "pair");
    const { a, b } = nameOf(v, t, pair);
    if ((out.has(a) && out.has(b)) || pos > t.cov) continue;
    const pre = preimage(t.source.at, pos, pos, Math.max(I.get(row, "enter"), p.start), Math.min(ownEnd(t, row).end, p.end));
    if (!pre || (p.startOpen && pre[1] <= p.start) || (p.endOpen && pre[0] >= p.end)) continue;
    if (freeOf(t, pair, pre[0], pre[1])) { out.add(a); out.add(b); }
  }
}

export function tintAt(v: ContactView, pos: number): Set<string> {
  check(v);
  const out = new Set<string>();
  const visit = (ref: number) => {
    if (isNearRef(ref)) return;
    if (isPieceRef(ref)) { pieceTint(v, ref, pos, out); return; }
    const t = tableOf(v, ref), row = rowOf(ref);
    const pair = t.st.episodes.get(t.st.intervals.get(row, "episode"), "pair");
    const { a, b } = nameOf(v, t, pair);
    if (out.has(a) && out.has(b)) return;
    if (contactAt(t, row, pos)) { out.add(a); out.add(b); }
  };
  // the lists' own order: an interval at its entry, a near miss at its closest approach, a piece at its start
  const start = (ref: number) => refPos(v, ref);
  walkBack(v.tgt, pos, start, visit);
  walkBack(v.aux, pos, start, visit);
  return out;
}

/** The code panel's mark for one line, from the spans of its moves (plan
 *  4.2: a line is marked where an episode covers one of its moves — every
 *  span of a repeated line separately, a gap of the episode's source cut out
 *  on its own axis: a span the gaps cover wholly is marked by nothing,
 *  VP-I102). A contact's own mark over a possible one over a provisional one.
 *  A contact that began before every span of the line it covers is "still in
 *  contact": `continuation` names the line it began on (0: the entry move) —
 *  read by `lineAt` on the shown axis; a contact beginning on the line wins. */
export function lineMark(v: ContactView, line: number, spans: ReadonlyArray<readonly [number, number]>,
                         lineAt?: LineAt): CollisionLineMark | null {
  check(v);
  let best = -1, own = false, contOnset = NaN, contEntry = false, contLine: number | null = null;
  const onsetOf = (ref: number) => { const t = tableOf(v, ref); return t.source.at(t.st.episodes.get(rowOf(ref), "onset")); };
  const rank = (t: TableIndex, row: number): number => {
    const E = t.st.episodes, flags = E.get(row, "flags");
    if ((flags & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY) return EP_MARK_BOUNDARY;
    if (E.get(row, "ivCount") === 0) return flags & EP_POSSIBLE ? EP_MARK_POSSIBLE : EP_MARK_CONTACT;
    for (let iv = E.get(row, "firstIv"); iv !== NONE; iv = t.st.intervals.get(iv, "next")) {
      if (!(t.st.intervals.get(iv, "flags") & IV_POSSIBLE)) return EP_MARK_CONTACT;
    }
    return EP_MARK_POSSIBLE;
  };
  // a folded source's episodes, by the line's runs on its own track
  for (const t of v.tables) {
    const ot = t?.source.ownTrack;
    if (!t || !ot) continue;
    const runs = ot.runs(line), E = t.st.episodes;
    if (!runs.length) continue;
    for (let row = 0; row < E.rows; row++) {
      const [s0, e0] = epOwn(t, row);
      let covers = false, begins = false;
      for (const [a, b] of runs) {
        if (e0 < a || s0 > b) continue;
        if (freeOf(t, E.get(row, "pair"), Math.max(a, s0), Math.min(b, e0))) { covers = true; if (s0 >= a - LINE_TOL) begins = true; }
      }
      if (!covers) continue;
      const m = rank(t, row);
      const entryMove = onEntryMove(t.source, s0);
      if (best < 0 || m < best) { best = m; own = begins; contOnset = NaN; contLine = begins ? null : entryMove ? 0 : ot.lineAt(s0); contEntry = false; }
      else if (m === best && begins) own = true;
    }
  }
  for (const [a, b] of spans) {
    let lo = 0, hi = v.ep.refs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (onsetOf(v.ep.refs[mid]!) <= b) lo = mid + 1; else hi = mid; }
    for (let i = lo - 1; i >= 0; i--) {
      const blk = (i / BLOCK) | 0;
      if (v.ep.pre[blk]! < a) break;
      if (v.ep.max[blk]! < a) { i = blk * BLOCK; continue; }
      const ref = v.ep.refs[i]!, t = tableOf(v, ref), row = rowOf(ref), E = t.st.episodes;
      if (t.source.ownTrack) continue;   // by its own track's lines, above
      const [s0, e0] = epOwn(t, row);
      if (a > t.cov) continue;
      const pre = preimage(t.source.at, a, Math.min(b, t.cov), s0, e0);
      if (!pre || !freeOf(t, E.get(row, "pair"), pre[0], pre[1])) continue;
      const m = rank(t, row);
      // rank: contact 0 best, possible 1, boundary 2; at one rank a contact
      // beginning in the span over one carried in
      const s = t.source.at(s0);
      const begins = s >= a - LINE_TOL;
      const entryMove = onEntryMove(t.source, s0);
      if (best < 0 || m < best) { best = m; own = begins; contOnset = begins ? NaN : s; contEntry = !begins && entryMove; contLine = null; }
      else if (m === best && begins) own = true;
      else if (m === best && !own && contLine === null && s < contOnset) { contOnset = s; contEntry = entryMove; }
    }
    if (best === EP_MARK_CONTACT && own) break;
  }
  if (best < 0) return null;
  const mark: CollisionLineMark = { line };
  if (best === EP_MARK_BOUNDARY) mark.boundary = true;
  else if (best === EP_MARK_POSSIBLE) mark.possible = true;
  else if (!own && contLine !== null) mark.continuation = contLine;
  else if (!own && !Number.isNaN(contOnset) && lineAt) {
    const from = contEntry ? 0 : lineAt(contOnset);
    if (from !== null) mark.continuation = from;
  }
  return mark;
}

/** The timeline's contact bands at display resolution (plan 4.3): `columns`
 *  pixel columns over [0, axisEnd]; a column is lit when a contact of any
 *  pair reaches into it — its source's gaps cut out on its own axis, then
 *  mapped: a contact narrower than a column lights its column and never
 *  vanishes (a point contact too, VP-I102); a free stretch splits a band only
 *  where the resolution can show it. At most 8192 columns. Bands as
 *  [startFraction, endFraction] runs. */
export function contactBands(v: ContactView, columns: number, axisEnd: number): Array<[number, number]> {
  check(v);
  const W = Math.max(1, Math.min(8192, Math.floor(columns)));
  if (!(axisEnd > 0)) return [];
  const lit = new Uint8Array(W);
  const col = (x: number) => Math.max(0, Math.min(W - 1, Math.floor((x / axisEnd) * W)));
  const pieces: number[] = [];
  /** Interval `row`'s own contact within [lo, hi] (own axis), its gaps cut out, lit. */
  const light = (t: TableIndex, row: number, lo: number, hi: number) => {
    const pair = t.st.episodes.get(t.st.intervals.get(row, "episode"), "pair");
    pieces.length = 0;
    if (hi < lo) return;
    piecesOf(t, pair, lo, hi, pieces);
    for (let i = 0; i < pieces.length; i += 2) {
      const x = t.source.at(pieces[i]!), y = Math.min(t.source.at(pieces[i + 1]!), t.cov);
      if (y < x || y < 0 || x > axisEnd) continue;
      // a stretch ending ON a column's left edge does not reach into it
      const c0 = col(x), e = Math.max(c0, Math.min(W - 1, Math.ceil((y / axisEnd) * W) - 1));
      for (let c = c0; c <= e; c++) lit[c] = 1;
    }
  };
  const band = (ref: number) => {
    // a union piece: below, group by group
    if (isNearRef(ref) || isPieceRef(ref)) return;
    const t = tableOf(v, ref), row = rowOf(ref);
    light(t, row, t.st.intervals.get(row, "enter"), ownEnd(t, row).end);
  };
  v.tgt.refs.forEach(band);
  v.aux.refs.forEach(band);
  // a union's pieces in one pass per group: each piece's intervals' own contact within it
  for (const u of v.unions) {
    if (!u) continue;
    eachGroup(v.tables, u, (sides, los) => eachPiece(sides, p => {
      for (const r of describePiece(v.tables, u, los, sides, p, v.joined).rows) {
        const t = tableOf(v, r), row = rowOf(r);
        light(t, row, Math.max(rd(t.c.enter, row), p.start), Math.min(ownEnd(t, row).end, p.end));
      }
    }));
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

/** The boundary contacts' stretches on the shown axis (a range sweep's
 *  contacts in progress at its start — provisional): the "?" names the lines
 *  each stays on. */
export function boundaryStretches(v: ContactView): Array<{ a: string; b: string; s: number; e: number }> {
  check(v);
  const out: Array<{ a: string; b: string; s: number; e: number }> = [];
  const earlier: typeof out = [];
  for (const t of v.tables) {
    if (!t) continue;
    const E = t.st.episodes;
    for (let row = 0; row < E.rows; row++) {
      if ((E.get(row, "flags") & EP_ORIGIN_MASK) !== ORIGIN_BOUNDARY) continue;
      const [s, e] = epOwn(t, row);
      (t.held ? earlier : out).push({ ...nameOf(v, t, E.get(row, "pair")), s: t.source.at(s), e: Math.min(t.source.at(e), t.cov) });
    }
  }
  // after a fallback the current run holds the same contacts again: an
  // earlier one only where the current one has none of its pair over it
  for (const h of earlier) if (!out.some(c => c.a === h.a && c.b === h.b && c.s <= h.e && h.s <= c.e)) out.push(h);
  return out;
}

/** The bytes the view holds besides the tables it reads (plan 3.4): every
 *  typed array of it — it holds nothing else per row, pair or gap. */
export function heldBytes(v: ContactView): number {
  let n = v.joined.byteLength + v.reachRef.byteLength + v.reachVal.byteLength + v.nearCur.byteLength + v.nearHeld.byteLength;
  for (const u of v.unions) if (u) for (const g of u.gens) n += g.uIdx.byteLength;
  for (const l of [v.tgt, v.aux, v.ep]) n += l.refs.byteLength + l.max.byteLength + l.pre.byteLength;
  for (const t of v.tables) {
    if (!t) continue;
    n += t.hPairs.byteLength + t.hOff.byteLength + t.hSpan.byteLength + t.hReason.byteLength;
  }
  return n;
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
 *  between). Only MOVES the sweep checked: a break (`brk` — a relabel, an
 *  unknown start, the start-dependent beginning before K) is no motion of
 *  its line; its zero-length span on another move's position let a contact
 *  there mark lines no check saw (Codex R149 VP-I110). Built once per track,
 *  line-indexed like lineIndex.ts. */
export interface LineRuns {
  /** `offset[line]` .. `offset[line + 1]` index the line's runs. */
  offset: Int32Array;
  /** The runs as [start, end] pairs on the track's cum, by line, in order. */
  spans: Float64Array;
  maxLine: number;
}

export function lineRuns(t: { count: number; cum: ArrayLike<number>; lines: ArrayLike<number>; brk?: ArrayLike<number> }): LineRuns {
  // the runs in track order: consecutive moves of one line
  const runLine: number[] = [], runA: number[] = [], runB: number[] = [];
  let maxLine = 0, broken = false;
  for (let i = 1; i < t.count; i++) {
    // a break ends the run: no run reaches over it
    if (t.brk?.[i]) { broken = true; continue; }
    const ln = t.lines[i]!;
    if (ln > maxLine) maxLine = ln;
    const k = runLine.length - 1;
    if (k >= 0 && runLine[k] === ln && !broken) runB[k] = t.cum[i]!;
    else { runLine.push(ln); runA.push(t.cum[i - 1]!); runB.push(t.cum[i]!); }
    broken = false;
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

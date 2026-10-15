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
// generations' intervals less the free stretches of both, a tool gap of
// either generation separating events (contactUnion.ts, Codex R151 VP-I113).
// Its events are PIECES of that union — a target is the piece's start
// evidence, one u32; its end, what it holds and its identity are asked of
// the union from that start when needed (the build walks each group once).
// A piece holding an earlier event's witness keeps that event's key; every
// other piece is keyed by its generation, its lead row and the evidence its
// start stands on; an earlier event a piece holds without its key is handed
// over to that piece (`findKey`). A base contact an entry contact continues is
// the entry's finding in every generation of either side (VP-I111). Its contact
// on screen is its intervals' own, less each one's generation's gaps. The
// earlier generation's coverage is how far each of its shards swept, as the
// pool reported it when it fell back (Codex R150 VP150-02: an open contact's
// rows name its entry only); the furthest position a table's rows name is a
// lower bound beside it. Near misses of the two generations are matched one to
// one per pair and origin by overlap in order: a matched one keeps the
// earlier key, an earlier one found no more is shown "from the earlier run".
import {
  EP_AT_START, EP_ORIGIN_MASK, EP_POSSIBLE, EP_RAPID, GAP_TOOL_UNKNOWN, IV_AFTER_UNKNOWN_TOOL, IV_CONTINUES_CUT, IV_ENDED_AT_GAP,
  IV_ENTER_DECIDED, IV_EXIT_DECIDED, IV_POSSIBLE, NONE, ORIGIN_BOUNDARY, BLOCK as STORE_BLOCK, BLOCK_SHIFT, type ContactStore,
  type StoreBudget,
} from "./contactStore";
import {
  eachPieceSteps, evidencePos, evidenceZone, mergeSepsSteps, NO_SEPARATORS, pieceFrom, pieceIntervals, pieceIntervalsSteps, START_ENTER, START_SEP, unionReachSteps,
  type Ops,
  unionScratch, type UnionPiece, type UnionScratch, type UnionSeps, type UnionSide,
} from "./contactUnion";
import type { ClashTarget } from "./clashTargets";
import type { CollisionLineMark } from "./collision";
import { JUMP_NUDGE } from "./findingNav";
import { STEP_OPS, copySteps, runToEnd, sortSteps, type Steps } from "./steps";

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
 *  counted once, as the entry's; its extent reaches the base interval's exit.
 *  After a fallback either side's rows may be its EARLIER generation's
 *  (`entryHeld` / `baseHeld`; Codex R151 VP-I111). */
export interface SourceJoin {
  entrySrc: number; baseSrc: number; joins: ReadonlyMap<number, number>; baseShard: number; entryShard: number;
  entryHeld?: boolean; baseHeld?: boolean;
}

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
  /** Its knowledge gaps on its own axis: their rows by pair, then start
   *  (those beginning within its coverage) — the values are the table's,
   *  read through `c`; a gap is closed, an open one to the coverage (Codex
   *  R152 VP-I112: a copy of every span and reason cost 21 B a gap). */
  hIdx: Uint32Array;
  /** Per gap of the index, the furthest end of its pair's gaps up to it —
   *  a bisection's point gap may lie inside a longer one, so ends need not
   *  rise with starts; this does, and a search by it is exact. */
  hReach: Float64Array;
}

type Col = readonly ArrayLike<number>[];
/** A column's value at `row`. */
/** Table cells a view has read, in all — the work a query did: a union
 *  piece's position decodes the piece, and a step that asks such queries
 *  counts what they read (Codex R157 VP-I115: counted as a flat few, they
 *  made steps of thousands of reads). */
export const viewWork = { n: 0 };
const rd = (c: Col, row: number) => { viewWork.n++; return c[row >>> BLOCK_SHIFT]![row & (STORE_BLOCK - 1)]!; };
interface Cols {
  enter: Col; exit: Col; witness: Col; flags: Col; freeAt: Col; freeR: Col; episode: Col; epPair: Col; epFlags: Col;
  gPair: Col; gStart: Col; gEnd: Col; gReason: Col;
}
function colsOf(st: ContactStore): Cols {
  const I = st.intervals, E = st.episodes, G = st.gaps;
  return { enter: I.blocksOf("enter"), exit: I.blocksOf("exit"), witness: I.blocksOf("witness"), flags: I.blocksOf("flags"),
           freeAt: I.blocksOf("freeAt"), freeR: I.blocksOf("freeR"), episode: I.blocksOf("episode"),
           epPair: E.blocksOf("pair"), epFlags: E.blocksOf("flags"),
           gPair: G.blocksOf("pair"), gStart: G.blocksOf("start"), gEnd: G.blocksOf("end"), gReason: G.blocksOf("reason") };
}

/** A sorted list of packed references with the largest shown end per block
 *  and up to it — the tint's and the marks' walk back from a position. */
interface RefList { refs: Uint32Array; max: Float64Array; pre: Float64Array }

export interface ContactView {
  readonly input: ContactViewInput;
  /** No longer published (replaced, or its request let go): every query
   *  fails (plan 3.6, Codex R157 VP-I117) — `retireView`. */
  retired?: boolean;
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
  /** Per source, its intervals by group and enter (a source without a
   *  fallback: its current generation's alone) — an episode's intervals in
   *  time order, the interval numbers of the keys. */
  readonly indexes: ReadonlyArray<UnionIndex>;
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
/** A source's union: [held, current] — contactUnion's side order — and its
 *  separators (the tool gaps of both generations, merged) by pair, then
 *  start: each as the two gaps — packed — it starts and ends with, their
 *  values read from the tables (8 B a separator). */
interface UnionIndex { gens: [UnionGen, UnionGen]; sRef: Uint32Array }

const EP_MARK_CONTACT = 0, EP_MARK_POSSIBLE = 1, EP_MARK_BOUNDARY = 2;
const BLOCK = 64;
/** The sweep's position tolerance (findings at or before the entry move's end). */
const ON_ENTRY_TOL = 1e-9;
/** Positions within this lie on one span's start (the sweep's 1e-3 bisection) —
 *  only for saying where a contact began, never for whether it is there. */
const LINE_TOL = 1e-3;

// packed reference: row (22 bits) · table (3) · source (2) · near (1) · held
// generation (1) · piece (3: 0 a row; 1 + START_ENTER / START_FREE — the row
// is then its start evidence's interval; 4 + the piece's origin for a
// START_SEP — the row is then the gap its separator ends at). The budget's
// tables hold 2^18 rows; 2^22 is the limit the build refuses past.
const ROW_MASK = 0x3fffff, TABLE_SHIFT = 22, SRC_SHIFT = 25, NEAR_BIT = 1 << 27, HELD_BIT = 1 << 28, PIECE_SHIFT = 29;
const MAX_TABLES = 8, MAX_SOURCES = 4;
const pack = (src: number, shard: number, row: number, near = false, held = false, piece = 0) =>
  (row | (shard << TABLE_SHIFT) | (src << SRC_SHIFT) | (near ? NEAR_BIT : 0) | (held ? HELD_BIT : 0) | (piece << PIECE_SHIFT)) >>> 0;
const rowOf = (ref: number) => ref & ROW_MASK;
const isNearRef = (ref: number) => (ref & NEAR_BIT) !== 0;
const isHeldRef = (ref: number) => (ref & HELD_BIT) !== 0;
const isPieceRef = (ref: number) => ref >>> PIECE_SHIFT !== 0;
/** A piece reference's start kind (START_*). */
const pieceKindOf = (ref: number) => (ref >>> PIECE_SHIFT >= 4 ? START_SEP : (ref >>> PIECE_SHIFT) - 1);
/** The piece field of a piece begun at a separator, for its origin. */
const SEP_FIELD = 4;
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

/** A view no longer published: every later query of it fails, wherever it is
 *  still held (a cache, a closure) — the tables it reads may be unchanged
 *  (plan 3.6, Codex R157 VP-I117). */
export function retireView(v: ContactView): void { v.retired = true; }

/** The view is the published one and still reads what it was built from —
 *  else it throws (VP-I107, R157 VP-I117). */
function check(v: ContactView): void {
  if (v.retired) throw new Error("contactView: a view no longer published — read the published one");
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

/** The gaps of `pair` in table `t`: [from, to) into its gap index. */
function holeRange(t: TableIndex, pair: number): [number, number] {
  const n = t.hIdx.length, at = (k: number) => rd(t.c.gPair, t.hIdx[k]!);
  let lo = 0, hi = n;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (at(mid) < pair) lo = mid + 1; else hi = mid; }
  let to = lo, b = n;
  while (to < b) { const mid = (to + b) >> 1; if (at(mid) <= pair) to = mid + 1; else b = mid; }
  return [lo, to];
}
/** A gap row's closed stretch on its table's own axis: an open one to the coverage. */
function gapSpan(t: TableIndex, row: number): [number, number] {
  const s0 = rd(t.c.gStart, row), e0 = rd(t.c.gEnd, row);
  return [s0, Math.max(s0, Number.isNaN(e0) ? t.ownCov : Math.min(e0, t.ownCov))];
}
const holeStart = (t: TableIndex, k: number) => rd(t.c.gStart, t.hIdx[k]!);
const holeEnd = (t: TableIndex, k: number) => gapSpan(t, t.hIdx[k]!)[1];
/** The first gap of [from, to) from which on a gap may reach x: none before
 *  it ends at or after x (by the pair's furthest end so far). */
function firstHoleReaching(t: TableIndex, from: number, to: number, x: number): number {
  let lo = from, hi = to;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t.hReach[m]! < x) lo = m + 1; else hi = m; }
  return lo;
}

/** The closed own stretch [x, y] holds a point outside every closed gap of
 *  `pair` (sorted by start): a gap may cover a contact wholly, a point gap a
 *  point. */
function freeOf(t: TableIndex, pair: number, x: number, y: number): boolean {
  const [from, to] = holeRange(t, pair);
  let reach = -Infinity, started = false;
  for (let k = firstHoleReaching(t, from, to, x); k < to; k++) {
    const s = holeStart(t, k);
    if (s > y) break;
    const e = holeEnd(t, k);
    if (e < x) continue;
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
  for (let k = firstHoleReaching(t, from, to, x); k < to; k++) {
    const s = holeStart(t, k);
    if (s > y) break;
    const e = holeEnd(t, k);
    if (e < cur) continue;
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
    // the first gap starting at or after the witness (by start), then the first tool gap from there
    let lo = from, hi = to;
    while (lo < hi) { const m = (lo + hi) >> 1; if (holeStart(t, m) < w) lo = m + 1; else hi = m; }
    for (let k = lo; k < to; k++) {
      const row = t.hIdx[k]!;
      if (rd(t.c.gReason, row) === GAP_TOOL_UNKNOWN) return { end: Math.min(rd(t.c.gStart, row), t.ownCov), open: false };
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

function* refList(refs: Uint32Array, pos: Float64Array, end: Float64Array, c: Ops): Steps<RefList> {
  const n = refs.length;
  // by position; at one position a contact before a near miss, then by
  // source, table and row — never by a piece's or a generation's bits, so a
  // union lists ties as the view without a fallback does (Codex R153's seed:
  // a near miss and a contact at one point swapped); a union's pieces come
  // group by group, each group in order: already sorted often, else a
  // run-adaptive sort
  const tie = (r: number) => r & ((NEAR_BIT << 1) - 1);
  const before = (a: number, b: number) => pos[a]! - pos[b]! || tie(refs[a]!) - tie(refs[b]!) || refs[a]! - refs[b]!;
  let sorted = true;
  for (let i = 1; i < n && sorted; i++) {
    if (before(i - 1, i) > 0) sorted = false;
    if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
  }
  // (the stable sort in steps: equal by position, tie and ref means the same ref)
  const order = sorted ? null : yield* sortSteps(n, before);
  const out = new Uint32Array(n);
  const blocks = Math.ceil(n / BLOCK);
  const max = new Float64Array(blocks).fill(-Infinity), pre = new Float64Array(blocks);
  for (let i = 0; i < n; i++) {
    const k = order ? order[i]! : i;
    out[i] = refs[k]!;
    const b = (i / BLOCK) | 0;
    max[b] = Math.max(max[b]!, end[k]!);
    if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
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
/** A piece reference's group: its evidence row's, or for a piece begun at a
 *  separator the gap's pair and the origin the reference carries. */
function pieceGroup(tables: Tables, ref: number): number {
  if (pieceKindOf(ref) !== START_SEP) return groupOfRef(tables, ref);
  return rd(tableAt(tables, ref).c.gPair, rowOf(ref)) * 4 + ((ref >>> PIECE_SHIFT) - SEP_FIELD);
}

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
    afterTool: k => (rd(tab(k).c.flags, row(k)) & IV_AFTER_UNKNOWN_TOOL) !== 0,
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

/** A pair's separators in a union, read through the gaps they start and end
 *  with, and where they begin in `sRef` (two refs a separator). */
function sepsOf(tables: Tables, u: UnionIndex, pair: number): { seps: UnionSeps; ev0: number } {
  const r = u.sRef, n = r.length >> 1;
  const pairAt = (i: number) => { const ref = r[2 * i]!; return rd(tableAt(tables, ref).c.gPair, rowOf(ref)); };
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (pairAt(m) < pair) lo = m + 1; else hi = m; }
  let to = lo, b = n;
  while (to < b) { const m = (to + b) >> 1; if (pairAt(m) <= pair) to = m + 1; else b = m; }
  if (to === lo) return { seps: NO_SEPARATORS, ev0: 0 };
  const a = lo;
  const span = (ref: number) => gapSpan(tableAt(tables, ref), rowOf(ref));
  return { seps: { count: to - a, s: i => span(r[2 * (a + i)]!)[0], e: i => span(r[2 * (a + i) + 1]!)[1] }, ev0: a };
}

/** Every group of a union source in order: its two sides, their starts in
 *  the generations' indexes, its pair's separators and the group — in bounded
 *  steps, `each` a job of its own (a group's walk). */
function* eachGroupSteps(tables: Tables, u: UnionIndex,
                         each: (sides: UnionSide[], los: readonly [number, number], seps: UnionSeps, group: number, ev0: number) => Steps<void>,
                         c: Ops): Steps<void> {
  const [gH, gC] = u.gens;
  let i = 0, j = 0;
  while (i < gH.uIdx.length || j < gC.uIdx.length) {
    const kH = i < gH.uIdx.length ? groupOfRef(tables, gH.uIdx[i]!) : Infinity;
    const kC = j < gC.uIdx.length ? groupOfRef(tables, gC.uIdx[j]!) : Infinity;
    const group = Math.min(kH, kC);
    let i2 = i, j2 = j;
    while (i2 < gH.uIdx.length && groupOfRef(tables, gH.uIdx[i2]!) === group) { i2++; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
    while (j2 < gC.uIdx.length && groupOfRef(tables, gC.uIdx[j2]!) === group) { j2++; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
    const { seps, ev0 } = sepsOf(tables, u, group >> 2);
    yield* each([sideOf(tables, gH, i, i2), sideOf(tables, gC, j, j2)], [i, j], seps, group, ev0);
    i = i2; j = j2;
  }
}

/** A source's index over its tables of both generations (and, after a
 *  fallback, `withSeps`, its separators). */
function* unionIndex(tables: Tables, src: number, withSeps: boolean, c: Ops): Steps<UnionIndex> {
  const gen = function* (held: boolean): Steps<UnionGen> {
    const ts: TableIndex[] = [];
    let n = 0;
    for (let sh = 0; sh < MAX_TABLES; sh++) { const t = tables[slotOf(src, held, sh)]; if (t) { ts.push(t); n += t.st.intervals.rows; } }
    const refs = new Uint32Array(n), grp = new Uint32Array(n), ent = new Float64Array(n);
    let i = 0, maxG = 0;
    for (const t of ts) {
      for (let iv = 0; iv < t.st.intervals.rows; iv++, i++) {
        refs[i] = pack(src, t.shard, iv, false, held);
        grp[i] = groupOf(t, iv);
        ent[i] = rd(t.c.enter, iv);
        if (grp[i]! > maxG) maxG = grp[i]!;
        if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
      }
    }
    // by group (a counting sort, stable), then by enter — the sweep wrote each
    // pair's rows in that order already; checked, else sorted
    const cnt = new Uint32Array(maxG + 2);
    for (let k = 0; k < n; k++) { cnt[grp[k]! + 1]!++; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
    for (let g = 1; g < cnt.length; g++) { cnt[g]! += cnt[g - 1]!; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
    let order: Uint32Array = new Uint32Array(n);
    for (let k = 0; k < n; k++) { order[cnt[grp[k]!]!++] = k; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
    for (let k = 1; k < n; k++) {
      const a = order[k - 1]!, b = order[k]!;
      if (grp[a] === grp[b] && (ent[a]! > ent[b]! || (ent[a] === ent[b] && refs[a]! > refs[b]!))) {
        // (every key differs by its ref: no tie to keep)
        order = yield* sortSteps(n, (x, y) => grp[x]! - grp[y]! || ent[x]! - ent[y]! || refs[x]! - refs[y]!);
        break;
      }
      if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
    }
    const uIdx = new Uint32Array(n);
    for (let k = 0; k < n; k++) { uIdx[k] = refs[order[k]!]!; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
    const col = (k: number, cn: "freeAt" | "freeR") => { const r = uIdx[k]!; return rd(tableAt(tables, r).c[cn], rowOf(r)); };
    const r = yield* unionReachSteps(n, k => ent[order[k]!]!, k => col(k, "freeAt"), k => col(k, "freeR"), (k, k2) => grp[order[k]!] === grp[order[k2]!], c);
    return { uIdx, back: r.back, front: r.front };
  };
  // the separators: the tool gaps of each generation, by pair, aligned
  // across the generations (contactUnion.mergeSeps — never two of one)
  const byPair = new Map<number, { spans: [number[], number[]]; refs: [number[], number[]] }>();
  for (const held of withSeps ? [true, false] : []) {
    const gi = held ? 0 : 1;
    for (let sh = 0; sh < MAX_TABLES; sh++) {
      const t = tables[slotOf(src, held, sh)];
      if (!t) continue;
      for (let k = 0; k < t.hIdx.length; k++) {
        if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
        const row = t.hIdx[k]!;
        if (rd(t.c.gReason, row) !== GAP_TOOL_UNKNOWN) continue;
        const pair = rd(t.c.gPair, row), e = byPair.get(pair) ?? { spans: [[], []], refs: [[], []] };
        e.spans[gi].push(...gapSpan(t, row));
        e.refs[gi].push(pack(src, sh, row, false, held));
        byPair.set(pair, e);
      }
    }
  }
  // every pair's gaps in counted steps — one pair may hold a request's every
  // gap (Codex R157 VP-I115)
  const pairs: number[] = [];
  for (const p of byPair.keys()) { pairs.push(p); if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
  const po = yield* sortSteps(pairs.length, (x, y) => pairs[x]! - pairs[y]!);
  const sRef: number[] = [];
  for (let pi = 0; pi < po.length; pi++) {
    const { spans, refs } = byPair.get(pairs[po[pi]!]!)!;
    const m = yield* mergeSepsSteps(spans, c), n0 = refs[0].length;
    const ref = (k: number) => (k < n0 ? refs[0][k]! : refs[1][k - n0]!);
    for (let i = 0; i < m.first.length; i++) { sRef.push(ref(m.first[i]!), ref(m.last[i]!)); if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; } }
  }
  const gH = yield* gen(true), gC = yield* gen(false);
  return { gens: [gH, gC], sRef: yield* copySteps(new Uint32Array(sRef.length), sRef, c) };
}

/** What a piece holds and is: its intervals' classes, its lead (the earliest
 *  interval holding its start — plan 3.5's "Ursprungszeile") and its heir
 *  (the earlier generation's interval whose witness it holds — the event
 *  whose identity it keeps). Row references. */
interface PieceInfo {
  piece: UnionPiece;
  lead: number;
  heir: number;
  /** Every interval it holds is a boundary contact or a cutting contact's
   *  later rapid part — or it holds where a base contact an entry contact
   *  continues begins: that contact's continuation (Codex R151 VP-I111: of
   *  any generation, whatever else the piece holds). */
  aux: boolean;
  possible: boolean;
  /** It ends where an open interval of it runs to its coverage. */
  openEnd: boolean;
  /** Its intervals (row references), for the tint, the bands and the joins. */
  rows: number[];
  /** The joined base rows whose enter it holds (their continuation's end). */
  joinedHere: number[];
}

function describePiece(tables: Tables, u: UnionIndex, los: readonly [number, number], sides: readonly UnionSide[],
                       seps: UnionSeps, piece: UnionPiece, joined: Uint32Array): PieceInfo {
  const d = describer(tables, u, los, piece, joined);
  pieceIntervals(sides, seps, piece, d.row);
  return d.done();
}
/** describePiece in bounded steps (the build: a piece may hold a group's every interval). */
function* describePieceSteps(tables: Tables, u: UnionIndex, los: readonly [number, number], sides: readonly UnionSide[],
                             seps: UnionSeps, piece: UnionPiece, joined: Uint32Array, c: Ops): Steps<PieceInfo> {
  const d = describer(tables, u, los, piece, joined);
  yield* pieceIntervalsSteps(sides, seps, piece, d.row, c);
  return d.done();
}
/** A piece's description, interval by interval (`row`), then `done`. */
function describer(tables: Tables, u: UnionIndex, los: readonly [number, number], piece: UnionPiece, joined: Uint32Array):
    { row: (sd: number, k: number, holdsStart: boolean) => void; done: () => PieceInfo } {
  const info: PieceInfo = { piece, lead: -1, heir: -1, aux: true, possible: true, openEnd: false, rows: [], joinedHere: [] };
  let leadEnter = Infinity, heirW = Infinity;
  const inside = (x: number) => (x > piece.start || (x === piece.start && !piece.startOpen)) && (x < piece.end || (x === piece.end && !piece.endOpen));
  return {
    row: (sd, k, holdsStart) => {
    const r = u.gens[sd]!.uIdx[los[sd]! + k]!, t = tableAt(tables, r), row = rowOf(r), c = t.c;
    const flags = rd(c.flags, row), epFlags = rd(c.epFlags, rd(c.episode, row));
    info.rows.push(r);
    if (!((epFlags & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY || (flags & IV_CONTINUES_CUT))) info.aux = false;
    if (!(flags & IV_POSSIBLE)) info.possible = false;
    const enter = rd(c.enter, row);
    if (findSorted(joined, r) >= 0 && inside(enter)) info.joinedHere.push(r);
    if (holdsStart && enter < leadEnter) { leadEnter = enter; info.lead = r; }
    if (sd === 0) {
      const w = rd(c.witness, row);
      if (inside(w) && w < heirW) { heirW = w; info.heir = r; }
    }
    if (!piece.endOpen && ownEnd(t, row).open && unionEnd(t, row) === piece.end) info.openEnd = true;
    },
    done: () => { if (info.joinedHere.length) info.aux = true; return info; },
  };
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

/** A view's last asked group (a list asks of one group's pieces in turn):
 *  its ranges, its sides and its separators (a view on the index) — a fixed
 *  handful of objects, nothing per row (Codex R151 VP-I112: a memo of free
 *  stretches per interval grew with the group, outside the budget). */
interface GroupCtx { src: number; group: number; r0: [number, number]; r1: [number, number]; sides: UnionSide[]; seps: UnionSeps }
const lastGroup = new WeakMap<ContactView, GroupCtx>();

/** The last piece a view was asked about, decoded: a list, its marks and a
 *  target's words ask one piece several times in a row, and decoding one is
 *  linear in its intervals (Codex R157 VP-I115). */
const lastPiece = new WeakMap<ContactView, { ref: number; out: { info: PieceInfo; t: TableIndex } }>();

/** A piece reference's union, sides and piece, asked from its start. */
function pieceCtx(v: ContactView, ref: number): { info: PieceInfo; t: TableIndex } {
  const m = lastPiece.get(v);
  if (m && m.ref === ref) return m.out;
  const out = decodePiece(v, ref);
  lastPiece.set(v, { ref, out });
  return out;
}
function decodePiece(v: ContactView, ref: number): { info: PieceInfo; t: TableIndex } {
  const t = tableOf(v, ref), u = v.unions[t.src]!;
  const group = pieceGroup(v.tables, ref);
  let g = lastGroup.get(v);
  if (!g || g.src !== t.src || g.group !== group) {
    const r0 = groupRange(v.tables, u.gens[0], group), r1 = groupRange(v.tables, u.gens[1], group);
    g = { src: t.src, group, r0, r1, sides: [sideOf(v.tables, u.gens[0], r0[0], r0[1]), sideOf(v.tables, u.gens[1], r1[0], r1[1])],
          seps: sepsOf(v.tables, u, group >> 2).seps };
    lastGroup.set(v, g);
  }
  // its start, as the build named it: the evidence row's place in its side,
  // or the separator its gap ends
  const kind = pieceKindOf(ref);
  let sd: number, idx: number;
  if (kind === START_SEP) {
    // the separator its gap ends: by its end, then the gap itself (two
    // separators may end at one point — a point at another's end)
    sd = -1;
    const end = gapSpan(t, rowOf(ref))[1], gap = rowRefOf(ref), { ev0 } = sepsOf(v.tables, u, group >> 2);
    let lo = 0, hi = g.seps.count;
    while (lo < hi) { const m = (lo + hi) >> 1; if (g.seps.e(m) < end) lo = m + 1; else hi = m; }
    while (lo + 1 < g.seps.count && u.sRef[2 * (ev0 + lo) + 1] !== gap) lo++;
    idx = lo;
  } else {
    sd = t.held ? 0 : 1;
    const r = sd === 0 ? g.r0 : g.r1;
    idx = indexIn(v.tables, u.gens[sd]!, r[0], r[1], rowRefOf(ref));
  }
  const z = evidenceZone(g.sides, g.seps, sd, kind, idx);
  const piece = pieceFrom(g.sides, g.seps, z, evidencePos(g.sides, g.seps, sd, kind, idx), true)!;
  return { info: describePiece(v.tables, u, [g.r0[0], g.r1[0]], g.sides, g.seps, piece, v.joined), t };
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
function rowKey(v: ContactView, t: TableIndex, row: number, near: boolean): string {
  const E = t.st.episodes;
  const ep = near ? row : rd(t.c.episode, row);
  return `${t.source.entry ? "E" : "C"}${E.get(ep, "pair")}|${E.get(ep, "ordinal")}|${near ? "n" : ordinalInEpisode(v, t, row)}`;
}
/** An interval's number in its episode — from the group index (an episode's
 *  intervals stand together there, by enter and row: its time order), never
 *  by walking the episode's chain, which a pair with many re-entries makes
 *  as long as the table (a list of every key was quadratic). */
function ordinalInEpisode(v: ContactView, t: TableIndex, row: number): number {
  const g = v.indexes[t.src]!.gens[t.held ? 0 : 1], [lo, hi] = groupRange(v.tables, g, groupOf(t, row));
  const first = t.st.episodes.get(rd(t.c.episode, row), "firstIv");
  return indexIn(v.tables, g, lo, hi, pack(t.src, t.shard, row, false, t.held)) - indexIn(v.tables, g, lo, hi, pack(t.src, t.shard, first, false, t.held));
}

/** The furthest position a table's rows name — the least its sweep covered
 *  (a lower bound beside the coverage its pool reported). */
function* provenCoverage(st: ContactStore, c: Ops): Steps<number> {
  let m = 0;
  const take = (x: number) => { if (x > m) m = x; };
  const E = st.episodes, I = st.intervals, G = st.gaps;
  // every row read, in counted steps (a held budget's rows at once: a 16 ms step, plan 3.6)
  for (let e = 0; e < E.rows; e++) {
    take(E.get(e, "onset")); take(E.get(e, "closeAt")); const x = E.get(e, "end"); if (!Number.isNaN(x)) take(x);
    if ((c.n += 3) >= STEP_OPS) { c.n = 0; yield; }
  }
  for (let iv = 0; iv < I.rows; iv++) {
    take(I.get(iv, "enter")); take(I.get(iv, "witness"));
    const x = I.get(iv, "exit"), f = I.get(iv, "freeAt");
    if (!Number.isNaN(x)) take(x);
    if (!Number.isNaN(f)) take(f);
    if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
  }
  for (let g = 0; g < G.rows; g++) {
    take(G.get(g, "start")); const x = G.get(g, "end"); if (!Number.isNaN(x)) take(x);
    if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
  }
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
  return runToEnd(buildContactViewSteps(input));
}

/** The view's build in bounded steps (plan 3.6): every loop and sort over the
 *  tables yields after about STEP_OPS operations — a group's walk too, so a
 *  request whose every interval is one pair's is no single task. Reads its
 *  tables unchanged from start to end; the caller keeps them so. */
/** A piece described at once up to this many candidate intervals, else in steps. */
const SMALL_PIECE = 64;

/** The joins' packed rows, sorted, in counted steps. */
function* packedSorted(joins: readonly SourceJoin[], rows: (j: SourceJoin) => Iterable<number>, packOf: (j: SourceJoin, row: number) => number,
                       c: Ops): Steps<Uint32Array> {
  const all: number[] = [];
  for (const j of joins) for (const r of rows(j)) { all.push(packOf(j, r)); if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
  const o = yield* sortSteps(all.length, (a, b) => all[a]! - all[b]!);
  const out = new Uint32Array(o.length);
  for (let k = 0; k < o.length; k++) { out[k] = all[o[k]!]!; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
  return out;
}

export function* buildContactViewSteps(input: ContactViewInput): Steps<ContactView> {
  const { sources, coverage } = input;
  if (sources.length > MAX_SOURCES) throw new Error(`contactView: ${sources.length} sources (at most ${MAX_SOURCES})`);
  const c: Ops = { n: 0 };
  const tick = () => ++c.n >= STEP_OPS;
  const tables: Array<TableIndex | undefined> = [];
  const list: TableIndex[] = [];
  for (let si = 0; si < sources.length; si++) {
    const source = sources[si]!;
    const own = source.ownCoverage ?? lastOwnAtOrBefore(source.at, source.coverage ?? coverage);
    const gens: Array<[readonly ContactStore[], boolean]> = [[source.stores, false]];
    if (source.held?.length) gens.push([source.held, true]);
    for (const [stores, held] of gens) {
      if (stores.length > MAX_TABLES) throw new Error(`contactView: ${stores.length} tables (at most ${MAX_TABLES})`);
      for (let sh = 0; sh < stores.length; sh++) {
        const st = stores[sh]!;
        if (st.intervals.rows > ROW_MASK || st.episodes.rows > ROW_MASK) throw new Error("contactView: a table past 2^22 rows");
        // the earlier generation's coverage: how far its shard swept, else (and
        // at least) what its own rows prove
        const ownCov = held ? Math.max(yield* provenCoverage(st, c), source.heldCoverage?.[sh] ?? -Infinity) : own;
        const cov = Math.min(source.at(ownCov), coverage);
        // the gaps on the own axis, by pair then start: their rows (a table
        // holds at most its gap budget — one sort, its work counted)
        const G = st.gaps, rows0: number[] = [];
        for (let g = 0; g < G.rows; g++) { if (G.get(g, "start") <= ownCov) rows0.push(g); if (tick()) { c.n = 0; yield; } }
        // (the row breaks every tie: the order is total)
        const go = yield* sortSteps(rows0.length, (x, y) => G.get(rows0[x]!, "pair") - G.get(rows0[y]!, "pair")
          || G.get(rows0[x]!, "start") - G.get(rows0[y]!, "start") || rows0[x]! - rows0[y]!);
        const idx = new Uint32Array(rows0.length);
        for (let k = 0; k < go.length; k++) { idx[k] = rows0[go[k]!]!; if (tick()) { c.n = 0; yield; } }
        const hReach = new Float64Array(idx.length);
        for (let k = 0; k < idx.length; k++) {
          const g = idx[k]!, s0 = G.get(g, "start"), e0 = G.get(g, "end");
          const end = Math.max(s0, Number.isNaN(e0) ? ownCov : Math.min(e0, ownCov));
          hReach[k] = k > 0 && G.get(idx[k - 1]!, "pair") === G.get(g, "pair") ? Math.max(hReach[k - 1]!, end) : end;
          if (tick()) { c.n = 0; yield; }
        }
        const t: TableIndex = { st, source, src: si, shard: sh, held, c: colsOf(st), revision: st.revision, ownCov, cov,
          hIdx: idx, hReach };
        tables[slotOf(si, held, sh)] = t;
        list.push(t);
      }
    }
  }
  // the joins: the base intervals counted as the entry's — of either
  // generation on either side (Codex R151 VP-I111)
  const joins = (input.joins ?? []).filter(j => tables[slotOf(j.baseSrc, !!j.baseHeld, j.baseShard)]
                                            && tables[slotOf(j.entrySrc, !!j.entryHeld, j.entryShard)]);
  const joined = yield* packedSorted(joins, j => j.joins.keys(), (j, biv) => pack(j.baseSrc, j.baseShard, biv, false, !!j.baseHeld), c);
  const entryRows = yield* packedSorted(joins, j => j.joins.values(), (j, eiv) => pack(j.entrySrc, j.entryShard, eiv, false, !!j.entryHeld), c);
  // the union piece holding where a joined row begins: its end (the reach);
  // the entry piece holding an entry row (the last: its end)
  const baseEnd = new Map<number, number>(), entryPiece = new Map<number, number>();
  // the targets and the other intervals (temporary positions, then sorted)
  const tR: number[] = [], tP: number[] = [], tE: number[] = [];
  const aR: number[] = [], aP: number[] = [], aE: number[] = [];
  let nE = 0;
  for (const t of list) nE += t.st.episodes.rows;
  const eRefs = new Uint32Array(nE), eOn = new Float64Array(nE), eEnd = new Float64Array(nE);
  let ei = 0;
  const unions: Array<UnionIndex | undefined> = [], indexes: UnionIndex[] = [];
  const unionCounts = NO_COUNTS();
  let walkScratch: UnionScratch | null = null;
  const scratchOf = () => (walkScratch ??= unionScratch());
  const nearPairs: Array<[number, number]> = [];
  let conflicts = 0, conflictAt = Infinity;
  for (let si = 0; si < sources.length; si++) {
    const source = sources[si]!;
    const mine = list.filter(t => t.src === si);
    const u = yield* unionIndex(tables, si, !!source.held?.length, c);
    indexes[si] = u;
    for (const t of mine) {
      const E = t.st.episodes;
      for (let e = 0; e < E.rows; e++) {
        const [s0, x] = epOwn(t, e);
        eRefs[ei] = pack(si, t.shard, e, false, t.held); eOn[ei] = source.at(s0); eEnd[ei++] = Math.min(source.at(x), t.cov);
        if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
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
          if ((c.n += 8) >= STEP_OPS) { c.n = 0; yield; }
        }
        for (let e = 0; e < E.rows; e++) {
          if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
          if (E.get(e, "ivCount") !== 0 || (E.get(e, "flags") & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY) continue;
          const p = source.at(E.get(e, "closeAt"));
          tR.push(pack(si, t.shard, e, true)); tP.push(p); tE.push(p);
        }
      }
      continue;
    }
    // after a fallback: the pieces of both generations' union, per group —
    // one walk each (Codex R151), its scratch shared group after group, in
    // steps inside a group too
    unions[si] = u;
    yield* eachGroupSteps(tables, u, (sides, los, seps, group, ev0) => eachPieceSteps(sides, seps, piece => {
      let ref: number;
      if (piece.startKind === START_SEP) ref = (u.sRef[2 * (ev0 + piece.startIdx) + 1]! | ((SEP_FIELD + (group & 3)) << PIECE_SHIFT)) >>> 0;
      else if (piece.startKind >= 0) {
        const ev = u.gens[piece.startSide]!.uIdx[los[piece.startSide]! + piece.startIdx]!;
        ref = (ev | ((piece.startKind + 1) << PIECE_SHIFT)) >>> 0;
      } else throw new Error("contactView: a union piece whose start no evidence names");
      const p = source.at(piece.start), e = Math.max(p, Math.min(source.at(piece.end), coverage));
      const shown = (info: PieceInfo, entryHere: boolean) => {
        if (info.aux) { aR.push(ref); aP.push(p); aE.push(e); return; }
        tR.push(ref); tP.push(p); tE.push(e);
        countKind(unionCounts, pieceKindBits(tables, info, piece.startKind, source, entryHere));
      };
      // a small piece at once (its work counted), a large one — a piece may
      // hold a group's every interval — in counted steps (Codex R157 VP-I115)
      if ((piece.to0 - piece.from0) + (piece.to1 - piece.from1) <= SMALL_PIECE) {
        const info = describePiece(tables, u, los, sides, seps, piece, joined);
        for (const r of info.joinedHere) baseEnd.set(r, e);
        let entryHere = false;
        for (const r of info.rows) if (findSorted(entryRows, r) >= 0) { entryPiece.set(r, ref); entryHere = true; }
        shown(info, entryHere);
        return 8 + 4 * info.rows.length;
      }
      return (function* (): Steps<void> {
        const info = yield* describePieceSteps(tables, u, los, sides, seps, piece, joined, c);
        for (const r of info.joinedHere) { baseEnd.set(r, e); if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; } }
        let entryHere = false;
        for (const r of info.rows) {
          if (findSorted(entryRows, r) >= 0) { entryPiece.set(r, ref); entryHere = true; }
          if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
        }
        shown(info, entryHere);
      })();
    }, x => { conflicts++; conflictAt = Math.min(conflictAt, source.at(x)); }, scratchOf(), c), c);
    // the near misses of both generations: one to one per group by overlap, in order
    const nears = function* (held: boolean): Steps<Array<{ ref: number; group: number; s: number; e: number }>> {
      const out: Array<{ ref: number; group: number; s: number; e: number }> = [];
      for (const t of mine) {
        if (t.held !== held) continue;
        const E = t.st.episodes;
        for (let e = 0; e < E.rows; e++) {
          if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
          if (E.get(e, "ivCount") !== 0 || (E.get(e, "flags") & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY) continue;
          const [s0, x] = epOwn(t, e);
          out.push({ ref: pack(si, t.shard, e, true, held), group: E.get(e, "pair") * 4 + (E.get(e, "flags") & EP_ORIGIN_MASK), s: s0, e: x });
        }
      }
      const ord = yield* sortSteps(out.length, (a, b) => out[a]!.group - out[b]!.group || out[a]!.s - out[b]!.s || out[a]!.ref - out[b]!.ref);
      const sorted = new Array<{ ref: number; group: number; s: number; e: number }>(ord.length);
      for (let k = 0; k < ord.length; k++) { sorted[k] = out[ord[k]!]!; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
      return sorted;
    };
    const hn = yield* nears(true), cn = yield* nears(false);
    const at = (r: number) => { const t = tableAt(tables, r); return source.at(t.st.episodes.get(rowOf(r), "closeAt")); };
    let a = 0, b = 0;
    const show = (r: number) => { const p = at(r); tR.push(r); tP.push(p); tE.push(p); };
    while (a < hn.length || b < cn.length) {
      if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
      const h = hn[a], cc = cn[b];
      if (h && cc && h.group === cc.group && h.s <= cc.e && cc.s <= h.e) { nearPairs.push([cc.ref, h.ref]); show(cc.ref); a++; b++; continue; }
      // the one that ends first (or the lower group) has no partner
      if (!cc || (h && (h.group < cc.group || (h.group === cc.group && h.e < cc.e)))) { show(h!.ref); a++; }
      else { show(cc.ref); b++; }
    }
  }
  // the reach of every entry contact a base contact continues (its finding's
  // extent): one per entry target, the furthest of its joins
  const reach = new Map<number, number>();
  for (const j of joins) {
    const bt = tables[slotOf(j.baseSrc, !!j.baseHeld, j.baseShard)]!;
    for (const [biv, eiv] of j.joins) {
      const b = pack(j.baseSrc, j.baseShard, biv, false, !!j.baseHeld), e = pack(j.entrySrc, j.entryShard, eiv, false, !!j.entryHeld);
      const key = entryPiece.get(e) ?? e, val = baseEnd.get(b) ?? shownStretch(bt, biv)[1];
      reach.set(key, Math.max(reach.get(key) ?? -Infinity, val));
      if ((c.n += 8) >= STEP_OPS) { c.n = 0; yield; }
    }
  }
  // every copy and sort below in counted steps: a budget's lists copied at
  // once were one step of ~20 ms in the browser (plan 3.6)
  const keys0 = new Uint32Array(reach.size);
  let kn = 0;
  for (const k of reach.keys()) { keys0[kn++] = k; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
  const ko = yield* sortSteps(keys0.length, (x, y) => keys0[x]! - keys0[y]!);
  const rKeys = new Uint32Array(ko.length), reachVal = new Float64Array(ko.length);
  for (let k = 0; k < ko.length; k++) {
    rKeys[k] = keys0[ko[k]!]!; reachVal[k] = reach.get(rKeys[k]!)!;
    if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
  }
  const reachRef = rKeys;
  const typed = function* (R: readonly number[], P: readonly number[], E: readonly number[]) {
    return yield* refList(yield* copySteps(new Uint32Array(R.length), R, c), yield* copySteps(new Float64Array(P.length), P, c),
                          yield* copySteps(new Float64Array(E.length), E, c), c);
  };
  const tgt = yield* typed(tR, tP, tE);
  const aux = yield* typed(aR, aP, aE);
  const ep = yield* refList(eRefs, eOn, eEnd, c);
  const np = yield* sortSteps(nearPairs.length, (x, y) => nearPairs[x]![0] - nearPairs[y]![0]);
  const nearCur = new Uint32Array(np.length), nearHeld = new Uint32Array(np.length);
  for (let k = 0; k < np.length; k++) {
    const x = nearPairs[np[k]!]!;
    nearCur[k] = x[0]; nearHeld[k] = x[1];
    if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
  }
  return { input, n: tgt.refs.length, tgt, aux, ep, tables, joined, reachRef, reachVal, unions, indexes, unionCounts,
           nearCur, nearHeld, conflicts: { count: conflicts, at: conflicts ? conflictAt : NaN } };
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
  if (info.heir >= 0) return rowKey(v, tableOf(v, info.heir), rowOf(info.heir), false);
  const lt = tableOf(v, info.lead), lead = rowKey(v, lt, rowOf(info.lead), false);
  const ev = rowRefOf(ref), kind = pieceKindOf(ref);
  const et = tableOf(v, ev);
  // a separator's evidence is its gap, by its row in its table
  const evKey = kind === START_SEP ? `s${et.st.generation}:${rowOf(ev)}`
    : kind === START_ENTER && ev === info.lead ? "b" : `${"ef"[kind]}${et.st.generation}:${rowKey(v, et, rowOf(ev), false)}`;
  return `${lead}#g${lt.st.generation}/${evKey}`;
}

function keyOf(v: ContactView, i: number): string {
  const ref = v.tgt.refs[i]!, t = tableOf(v, ref), row = rowOf(ref);
  if (isPieceRef(ref)) return pieceKey(v, ref, pieceCtx(v, ref).info);
  if (isNearRef(ref) && v.unions[t.src] && !t.held) {
    // a current near miss after a fallback: matched, the earlier one's key
    const k = findSorted(v.nearCur, ref);
    if (k >= 0) { const h = v.nearHeld[k]!; return rowKey(v, tableOf(v, h), rowOf(h), true); }
    return `${rowKey(v, t, row, true)}#g${t.st.generation}`;
  }
  return rowKey(v, t, row, isNearRef(ref));
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
  return runToEnd(viewCountsSteps(v));
}
/** viewCounts in bounded steps (plan 3.6). */
export function* viewCountsSteps(v: ContactView, ops: Ops = { n: 0 }): Steps<ViewCounts> {
  check(v);
  const c = { ...v.unionCounts };
  for (let i = 0; i < v.n; i++) {
    if (!isPieceRef(v.tgt.refs[i]!)) countKind(c, kindOf(v, i));
    if ((ops.n += 8) >= STEP_OPS) { ops.n = 0; yield; check(v); }
  }
  return c;
}

/** The targets a program starts in (T_AT_START, any source) — the "?"'s
 *  "starts in contact" names them. An episode is at the start only when its
 *  pair touched at the sweep's first pose, so its first interval enters at
 *  the table's first sample: the smallest enter of its table. Only the
 *  targets at those positions are asked for their kind — never every target
 *  (a union piece's kind is a walk of its own; plan 4.4). */
export function startTargets(v: ContactView): number[] {
  return runToEnd(startTargetsSteps(v));
}
/** startTargets in bounded steps (plan 3.6). */
export function* startTargetsSteps(v: ContactView, ops: Ops = { n: 0 }): Steps<number[]> {
  check(v);
  const xs = new Set<number>();
  for (const t of v.tables) {
    if (!t) continue;
    const rows = t.st.intervals.rows;
    let m = Infinity;
    for (let k = 0; k < t.c.enter.length; k++) {
      const b = t.c.enter[k]!;
      for (let j = 0, n = Math.min(b.length, rows - k * STORE_BLOCK); j < n; j++) if (b[j]! < m) m = b[j]!;
      if ((ops.n += STORE_BLOCK) >= STEP_OPS) { ops.n = 0; yield; check(v); }
    }
    if (m < Infinity) xs.add(t.source.at(m));
  }
  const out = new Set<number>();
  for (const x of xs) {
    // every query's own reads counted: a union piece's decodes its piece
    let w0 = viewWork.n;
    for (let i = firstAfter(v, x, false); i < v.n && posOf(v, i) === x; i++) {
      if (kindOf(v, i) & T_AT_START) out.add(i);
      if ((ops.n += 16 + viewWork.n - w0) >= STEP_OPS) { ops.n = 0; yield; check(v); }
      w0 = viewWork.n;
    }
    ops.n += viewWork.n - w0;
  }
  const list: number[] = [];
  for (const i of out) { list.push(i); if (++ops.n >= STEP_OPS) { ops.n = 0; yield; check(v); } }
  const so = yield* sortSteps(list.length, (a, b) => list[a]! - list[b]!);
  const sorted = new Array<number>(so.length);
  for (let k = 0; k < so.length; k++) { sorted[k] = list[so[k]!]!; if (++ops.n >= STEP_OPS) { ops.n = 0; yield; check(v); } }
  return sorted;
}

/** The first target whose position is past `x` (strict), or at or past it —
 *  the list's window, the marks' columns and the look-ahead (plan 4.4). */
export function indexAtOrAfter(v: ContactView, x: number, strict: boolean): number {
  check(v);
  return firstAfter(v, x, strict);
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
  return handedOver(v, key);
}

/** An earlier event whose key no target carries any more — its witness lies
 *  in a piece another earlier event's witness keeps (a free stretch between
 *  them refuted on its sample): the piece holding its interval, the
 *  selection's defined handover (Codex R151 VP-I113); −1: none. */
function handedOver(v: ContactView, key: string): number {
  const m = /^([EC])(\d+)\|(\d+)\|(\d+)$/.exec(key);
  if (!m) return -1;
  const entry = m[1] === "E", pair = +m[2]!, ordinal = +m[3]!, nth = +m[4]!;
  for (const t of v.tables) {
    if (!t || !t.held || !!t.source.entry !== entry || !v.unions[t.src]) continue;
    const E = t.st.episodes, I = t.st.intervals;
    for (let e = 0; e < E.rows; e++) {
      if (E.get(e, "pair") !== pair || E.get(e, "ordinal") !== ordinal || E.get(e, "ivCount") <= nth) continue;
      // its nth interval: nth places after its first in the group index
      const first = E.get(e, "firstIv"), g = v.indexes[t.src]!.gens[0], [lo, hi] = groupRange(v.tables, g, groupOf(t, first));
      const at = lo + indexIn(v.tables, g, lo, hi, pack(t.src, t.shard, first, false, true)) + nth;
      if (at >= hi) return -1;
      const ref = g.uIdx[at]!, row = rowOf(ref), pos = t.source.at(I.get(row, "witness"));
      let found = -1;
      walkBackIdx(v.tgt, pos, r => refPos(v, r), i => {
        const r = v.tgt.refs[i]!;
        if (!isPieceRef(r) || tableOf(v, r).src !== t.src || !pieceCtx(v, r).info.rows.includes(ref)) return false;
        found = i;
        return true;
      });
      return found;
    }
  }
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
 *  hold it (block maxima skip the rest); `each` gets every candidate's index
 *  and ends the walk by returning true. */
function walkBackIdx(list: RefList, pos: number, startOf: (ref: number) => number, each: (i: number) => boolean | void): void {
  let lo = 0, hi = list.refs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (startOf(list.refs[mid]!) <= pos) lo = mid + 1; else hi = mid; }
  for (let i = lo - 1; i >= 0; i--) {
    const blk = (i / BLOCK) | 0;
    if (list.pre[blk]! < pos) break;
    if (list.max[blk]! < pos) { i = blk * BLOCK; continue; }
    if (each(i)) return;
  }
}
function walkBack(list: RefList, pos: number, startOf: (ref: number) => number, each: (ref: number) => void): void {
  walkBackIdx(list, pos, startOf, i => { each(list.refs[i]!); });
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

/** The timeline's resolution limit, the bands' and the collision marks' alike
 *  (plan 4.3 / 4.4): at most this many columns. */
export const TIMELINE_COLUMNS = 8192;

/** The timeline's contact bands at display resolution (plan 4.3): `columns`
 *  pixel columns over [0, axisEnd]; a column is lit when a contact of any
 *  pair reaches into it — its source's gaps cut out on its own axis, then
 *  mapped: a contact narrower than a column lights its column and never
 *  vanishes (a point contact too, VP-I102); a free stretch splits a band only
 *  where the resolution can show it. At most 8192 columns. Bands as
 *  [startFraction, endFraction] runs. */
export function contactBands(v: ContactView, columns: number, axisEnd: number): Array<[number, number]> {
  return runToEnd(contactBandsSteps(v, columns, axisEnd));
}
/** contactBands in bounded steps (plan 3.6: the bands are published with the
 *  view; a union's walk took 250–410 ms at the budget). */
export function* contactBandsSteps(v: ContactView, columns: number, axisEnd: number, ops: Ops = { n: 0 }): Steps<Array<[number, number]>> {
  check(v);
  const W = Math.max(1, Math.min(TIMELINE_COLUMNS, Math.floor(columns)));
  if (!(axisEnd > 0)) return [];
  const lit = new Uint8Array(W);
  const col = (x: number) => Math.max(0, Math.min(W - 1, Math.floor((x / axisEnd) * W)));
  const pieces: number[] = [];
  /** Interval `row`'s own contact within [lo, hi] (own axis), its gaps cut out, lit. */
  /** Lights a row's shown stretch; its work (pieces and columns written). */
  const light = (t: TableIndex, row: number, lo: number, hi: number): number => {
    const pair = t.st.episodes.get(t.st.intervals.get(row, "episode"), "pair");
    pieces.length = 0;
    if (hi < lo) return 4;
    piecesOf(t, pair, lo, hi, pieces);
    let work = 4 + pieces.length;
    for (let i = 0; i < pieces.length; i += 2) {
      const x = t.source.at(pieces[i]!), y = Math.min(t.source.at(pieces[i + 1]!), t.cov);
      if (y < x || y < 0 || x > axisEnd) continue;
      // a stretch ending ON a column's left edge does not reach into it
      const c0 = col(x), e = Math.max(c0, Math.min(W - 1, Math.ceil((y / axisEnd) * W) - 1));
      for (let c = c0; c <= e; c++) lit[c] = 1;
      work += e - c0 + 1;
    }
    return work;
  };
  const band = (ref: number): number => {
    // a union piece: below, group by group
    if (isNearRef(ref) || isPieceRef(ref)) return 4;
    const t = tableOf(v, ref), row = rowOf(ref);
    return light(t, row, t.st.intervals.get(row, "enter"), ownEnd(t, row).end);
  };
  for (const refs of [v.tgt.refs, v.aux.refs]) {
    for (let i = 0; i < refs.length; i++) {
      if ((ops.n += band(refs[i]!)) >= STEP_OPS) { ops.n = 0; yield; check(v); }
    }
  }
  // a union's pieces in one walk per group: each piece's intervals' own contact within it
  const scratch = unionScratch();
  for (const u of v.unions) {
    if (!u) continue;
    yield* eachGroupSteps(v.tables, u, (sides, los, seps) => eachPieceSteps(sides, seps, p => {
      let work = 0;
      const lit1 = (sd: number, k: number) => {
        const r = u.gens[sd]!.uIdx[los[sd]! + k]!, t = tableOf(v, r), row = rowOf(r);
        work += light(t, row, Math.max(rd(t.c.enter, row), p.start), Math.min(ownEnd(t, row).end, p.end));
      };
      // a small piece at once, a large one in counted steps (Codex R157 VP-I115)
      if ((p.to0 - p.from0) + (p.to1 - p.from1) <= SMALL_PIECE) { pieceIntervals(sides, seps, p, lit1); return work; }
      return pieceIntervalsSteps(sides, seps, p, (sd, k) => { work = 0; lit1(sd, k); ops.n += work; }, ops);
    }, undefined, scratch, ops), ops);
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

/** The most a view can hold besides its tables (plan 3.4, derived after
 *  Codex R152 VP-I112) for a request's tables at `main` and a side run's at
 *  `side` (each its two generations, both after a fallback — the union
 *  everywhere), term by term:
 *  - targets and other intervals (4 B a reference, the largest end per block
 *    of 64 in two f64): every piece begins at an interval's enter, a free
 *    stretch's end (one a free sample, one a sample an interval) or a zone's
 *    start (one a separator a group, four origins a pair), every near miss is
 *    one — 2·(I₀+I₁) + 4·(G₀+G₁) + (E₀+E₁);
 *  - the episodes by onset: E₀+E₁ at the same 4.25 B;
 *  - the union index: 4 B an interval of both generations;
 *  - the gap index: 4 B a gap and 8 B its pair's furthest end so far; the
 *    separators: 8 B one, at most one a gap;
 *  - the near misses matched: 8 B a pair, at most one an episode;
 *  - the joins: a base row per entry interval open at its end and pair of
 *    generations (4 B), a reach per entry target (12 B).
 *  The 8.4 MB first agreed held no union splits, gaps, separators or near
 *  matching. */
export function derivationBound(main: StoreBudget, side: StoreBudget | null): { bytes: number; terms: Record<string, number> } {
  const ref = 4 + 16 / BLOCK, terms: Record<string, number> = {};
  const add = (name: string, n: number) => { terms[name] = (terms[name] ?? 0) + Math.ceil(n); };
  for (const b of side ? [main, side] : [main]) {
    add("targets", ref * (4 * b.intervals + 8 * b.gaps + 2 * b.episodes) + 2 * 16);
    add("episodes", ref * 2 * b.episodes + 16);
    add("unionIndex", 4 * 2 * b.intervals);
    add("gapIndex", 12 * 2 * b.gaps);
    add("separators", 8 * 2 * b.gaps);
    add("nearMatching", 8 * b.episodes);
  }
  if (side) add("joins", 4 * 4 * side.episodes + 12 * 2 * side.episodes);
  return { bytes: Object.values(terms).reduce((x, y) => x + y, 0), terms };
}

/** The bytes the view holds besides the tables it reads (plan 3.4): every
 *  typed array of it — it holds nothing else per row, pair or gap. */
export function heldBytes(v: ContactView): number {
  let n = v.joined.byteLength + v.reachRef.byteLength + v.reachVal.byteLength + v.nearCur.byteLength + v.nearHeld.byteLength;
  for (const u of v.indexes) {
    for (const g of u.gens) n += g.uIdx.byteLength;
    n += u.sRef.byteLength;
  }
  for (const l of [v.tgt, v.aux, v.ep]) n += l.refs.byteLength + l.max.byteLength + l.pre.byteLength;
  for (const t of v.tables) {
    if (!t) continue;
    n += t.hIdx.byteLength + t.hReach.byteLength;
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

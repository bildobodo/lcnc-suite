// Step 4 package 2, round B4: what a request shows after its pool fell back
// to one core (plan docs/reviews/kollision-paket2.plan.md Fassung 5, 3.5;
// Codex R140–R143, R150, R151). The local run computes the request again as a
// new generation; the earlier one's evidence stays. Per pair and origin (plan
// 3.5: "Je Paar und Herkunft") the shown contacts are the UNION of both
// generations' intervals LESS the proven free stretches of both: a free
// sample's open stretch (p − r, p + r), the point p alone when r = 0.
//
// A free stretch never takes a confirmed place ("Der Freiraum schneidet also
// nur angenommenen Kontakt"): a confirmed point inside it — a witness, a
// decided boundary — refutes the radius beyond it, and the stretch keeps only
// the radius it can hold, r' = the distance from its sample to the nearest
// such point (none, where one lies ON the sample). The point stays contact,
// the sample stays free, and no neighbourhood of the point is made contact
// (Codex R150 VP150-01: a ±tolerance around the point swallowed a whole free
// gap). The refinement's tolerance only tells the plan's numerical conflict
// (within it of the stretch's edge) from a contradiction of the two
// generations deeper inside, which is NAMED (`eachWideConflict`), never
// resolved in silence. Reaching a place is no refutation: a confirmed
// interval of either generation stays wherever the other passed without a hit.
//
// A stretch with the TOOL UNKNOWN separates events: the contact before it
// ended there and one after it begins anew (no geometric re-entry, Codex
// R140), so no shown event spans one (Codex R151 VP-I113 — an empty rerun
// joined the two events of a point gap into one and lost the second's
// identity). The tool gaps are the SEPARATORS — never two of one generation
// (R152: a time axis collapsed in f32 puts several restarts on one point, a
// known instant between them holding a contact of its own), across the
// generations the same gap aligned (`mergeSeps`). They cut the axis into
// ZONES, closed at both ends ([e_{i−1}, s_i]; between two that only touch,
// the point they share), and each zone is a union of its own. An interval's
// part in a zone is its stretch there, a part at a zone's bound with length
// elsewhere belonging where the interval goes on; a POINT interval lies in
// one zone holding its point, by its generation's order where several do —
// never before the interval before it, one further when it began after the
// unknown tool (`pointZone`). An undecidable answer is no separator: it
// suspends an interval, never ends one.
//
// The pieces are the EVENTS (targets, identity): a knowledge gap does not
// split one, as it does not split an interval without a fallback. What a
// piece shows as contact — the tint, the bands, the marks — is its
// contributors' own contact less each one's generation's gaps (ignorance is
// no freedom); the view reads that from its tables.
//
// Pure, on ONE group's intervals per generation through accessors (the view
// reads its tables, nothing is copied). The build walks a group ONCE
// (`eachPiece`: its intervals read into scratch, every free stretch computed
// once, both generations merged in order — Codex R151); every later question
// about one piece asks `pieceFrom` from the piece's start evidence alone, the
// same set by a search — so the view holds one u32 per piece. The two are held
// to each other and to a brute force by contactUnion.test.ts.
//
// The structure both rely on (the sweep's own, and the generator's in the
// test): per generation the intervals are disjoint and by enter; an interval's
// confirmed points lie in [its enter, the next one's enter); its free sample
// lies after its own confirmed points and before the next interval's enter.

import { STEP_OPS, allocF64, allocI32, allocU8, copySteps, growF64, growI32, runToEnd, sortSteps, type Steps } from "./steps";

/** A job's operations since its last yield (plan 3.6). */
export interface Ops { n: number }

/** The refinement's tolerance: a confirmed point closer than this to a free
 *  stretch's edge is the plan's numerical conflict; deeper, a contradiction
 *  that is named. */
export const PROTECT = 1e-3;

/** One generation's intervals of ONE group (pair and origin) on the source's
 *  own axis, by enter (disjoint). */
export interface UnionSide {
  readonly n: number;
  enter(k: number): number;
  /** Its own end, closed: the exit; one ended at an unknown tool at the gap;
   *  an open one at its generation's coverage. */
  end(k: number): number;
  /** Open: it runs to its generation's coverage (no exit claimed). */
  open(k: number): boolean;
  witness(k: number): number;
  enterDecided(k: number): boolean;
  exitDecided(k: number): boolean;
  /** It began after a stretch with the tool unknown (IV_AFTER_UNKNOWN_TOOL). */
  afterTool(k: number): boolean;
  /** The free sample after its exit (NaN: none) and its proven radius. */
  freeAt(k: number): number;
  freeR(k: number): number;
  /** Bounds of the searches, over the whole source (`unionReach`): how far a
   *  free stretch of this generation reaches past the NEXT interval's enter
   *  (`back`) and before its own interval's enter (`front`). */
  readonly back: number;
  readonly front: number;
}

/** The group's separators: closed spans by start, none overlapping another
 *  (`mergeSeps`); zone z is [e_{z−1}, s_z] (−∞ / +∞ at the ends) — between
 *  two separators that only touch, the one point they share is a zone of its
 *  own. Read through accessors: the view reads them from its tables. */
export interface UnionSeps { readonly count: number; s(i: number): number; e(i: number): number }
/** Separators from a flat [s0, e0, s1, e1, …] array. */
export const sepArray = (a: ArrayLike<number>): UnionSeps => ({ count: a.length >> 1, s: i => a[2 * i]!, e: i => a[2 * i + 1]! });
export const NO_SEPARATORS: UnionSeps = { count: 0, s: () => NaN, e: () => NaN };

/** What a piece's start is: an interval's enter, the end of an interval's
 *  free stretch (p + r'; the point p itself for r' = 0), or a zone's start
 *  (an interval of the other generation reaching over a separator). */
export const START_ENTER = 0, START_FREE = 1, START_SEP = 2;

/** One shown event of the group: a connected piece of its zone's union less
 *  the free stretches, on the own axis. */
export interface UnionPiece {
  zone: number;
  start: number;
  startOpen: boolean;
  end: number;
  endOpen: boolean;
  /** Its start's evidence: kind (START_*; −1 when the search began inside a
   *  piece — a later question asks from its start, never from inside), the
   *  side (0 the earlier, held generation, 1 the current; −1 for a
   *  separator) and the interval index there (the separator's index). */
  startKind: number;
  startSide: number;
  startIdx: number;
  /** The intervals of each side whose part meets it: [from, to) by index. */
  from0: number;
  to0: number;
  from1: number;
  to1: number;
}

interface Span { a: number; ao: boolean; b: number; bo: boolean }

/** A free sample's proven radius (none: 0). */
export const freeRadius = (r: number) => (r > 0 ? r : 0);

// ---- separators and zones -------------------------------------------------------------------------

/** Each generation's tool gaps (flat [s, e, …]) aligned into separators.
 *  Within ONE generation no two gaps are ever one separator: the sweep closes
 *  a gap before it opens the next, so they are distinct restarts even where a
 *  collapsed time axis puts them on one point (Codex R152 VP-I113: [1, 2] and
 *  [2, 3] joined swallowed the contact at 2). A generation's gaps in time order
 *  are by start, then end, then input order. Across generations a head is the
 *  same gap when it is identical or overlaps with positive length (one
 *  generation's gap cut at its coverage); a gap that overlaps a separator so
 *  formed joins it too (tables that disagree — separators never overlap).
 *  `first[i]` / `last[i]`: the gaps separator i starts and ends with, as
 *  indices into the generations' spans one after the other (the first such). */
export function mergeSeps(gens: ReadonlyArray<ArrayLike<number>>): { seps: Float64Array; first: Int32Array; last: Int32Array } {
  return runToEnd(mergeSepsSteps(gens, { n: 0 }));
}
/** mergeSeps in bounded steps: one pair may hold a request's every gap
 *  (Codex R157 VP-I115). `c` counts the work since the caller's last yield. */
export function* mergeSepsSteps(gens: ReadonlyArray<ArrayLike<number>>, c: Ops): Steps<{ seps: Float64Array; first: Int32Array; last: Int32Array }> {
  let base = 0;
  // each generation's gaps as typed lists (plan 3.6: every build buffer counted, Codex R158 VP-I118)
  const lists: Array<{ s: Float64Array; e: Float64Array; k: Int32Array; n: number }> = [];
  for (const g of gens) {
    const n = g.length >> 1, S = allocF64(n), E = allocF64(n), K = allocI32(n);
    for (let i = 0; i < n; i++) {
      S[i] = g[2 * i]!; E[i] = Math.max(g[2 * i]!, g[2 * i + 1]!); K[i] = base + i;
      if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
    }
    base += n;
    // by start, end, input order — every key differs by k: the order is total
    const ord = yield* sortSteps(n, (x, y) => S[x]! - S[y]! || E[x]! - E[y]! || K[x]! - K[y]!);
    const s2 = allocF64(n), e2 = allocF64(n), k2 = allocI32(n);
    for (let i = 0; i < n; i++) { const o = ord[i]!; s2[i] = S[o]!; e2[i] = E[o]!; k2[i] = K[o]!; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
    lists.push({ s: s2, e: e2, k: k2, n });
  }
  const ptr = lists.map(() => 0), has = (i: number) => ptr[i]! < lists[i]!.n;
  const hs = (i: number) => lists[i]!.s[ptr[i]!]!, he = (i: number) => lists[i]!.e[ptr[i]!]!, hk = (i: number) => lists[i]!.k[ptr[i]!]!;
  // overlap with positive length, or a point strictly inside the other
  const overlaps = (i: number, S: number, E: number) => {
    const s0 = hs(i), e0 = he(i);
    return Math.max(s0, S) < Math.min(e0, E) || (s0 === e0 && S < s0 && s0 < E) || (S === E && s0 < S && S < e0);
  };
  const out = growF64(), first = growI32(), last = growI32();
  for (;;) {
    let li = -1;
    for (let i = 0; i < lists.length; i++) {
      if (has(i) && (li < 0 || hs(i) < hs(li) || (hs(i) === hs(li) && he(i) < he(li)))) li = i;
    }
    if (li < 0) break;
    let S = hs(li), E = he(li), f = hk(li), l = f;
    ptr[li]!++;
    const take = (i: number) => {
      const ts = hs(i), te = he(i), tk = hk(i);
      ptr[i]!++;
      if (ts < S) { S = ts; f = tk; }
      if (te > E || (te === E && tk < l)) { if (te > E) E = te; l = tk; }
    };
    // the same gap in another generation
    for (let i = 0; i < lists.length; i++) {
      if (i !== li && has(i) && ((hs(i) === S && he(i) === E) || overlaps(i, S, E))) take(i);
    }
    // tables that disagree: whatever overlaps it joins it (each round takes one)
    for (let again = true; again;) {
      again = false;
      for (let i = 0; i < lists.length; i++) { if (has(i) && overlaps(i, S, E)) { take(i); again = true; } }
      if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
    }
    out.push(S, c); out.push(E, c); first.push(f, c); last.push(l, c);
    if ((c.n += 8) >= STEP_OPS) { c.n = 0; yield; }
  }
  return { seps: yield* copySteps(allocF64(out.length), out.view(), c), first: yield* copySteps(allocI32(first.length), first.view(), c),
           last: yield* copySteps(allocI32(last.length), last.view(), c) };
}

const zoneLo = (seps: UnionSeps, z: number) => (z === 0 ? -Infinity : seps.e(z - 1));
const zoneHi = (seps: UnionSeps, z: number) => (z < seps.count ? seps.s(z) : Infinity);
/** The separators ending before x (at or before it, with `incl`). */
function sepsEnding(seps: UnionSeps, x: number, incl: boolean): number {
  let lo = 0, hi = seps.count;
  while (lo < hi) { const m = (lo + hi) >> 1; const e = seps.e(m); if (e < x || (incl && e === x)) lo = m + 1; else hi = m; }
  return lo;
}
/** The separators starting before x. */
function sepsStarting(seps: UnionSeps, x: number): number {
  let lo = 0, hi = seps.count;
  while (lo < hi) { const m = (lo + hi) >> 1; if (seps.s(m) < x) lo = m + 1; else hi = m; }
  return lo;
}

/** The zone a point interval at x lies in, from the zone of the interval
 *  before it (`prev`) and whether it began after the unknown tool. The zones
 *  holding x are [separators starting before x, separators ending at or
 *  before x]; where separators meet at x (a time axis collapsed to one
 *  coordinate) several do, and the side's time order decides: never before
 *  the interval before it, one further when it began after a restart (−1:
 *  inside a separator). */
function pointZoneAt(seps: UnionSeps, x: number, after: boolean, prev: number): number {
  const zmin = sepsStarting(seps, x), zmax = sepsEnding(seps, x, true);
  if (zmin >= zmax) return zmin === zmax ? zmin : -1;
  return Math.min(zmax, Math.max(zmin, prev + (after ? 1 : 0)));
}
/** The zone interval k's LAST part lies in: a point interval's (pointZone),
 *  else the zone its end lies in (a part at a zone's lower bound belongs to
 *  the zone before). */
const endZone = (seps: UnionSeps, b: number) => sepsEnding(seps, b, false);
/** A point interval's zone: pointZoneAt with the side's order — back over the
 *  point intervals whose zone may depend on the one before, then forward. */
function pointZone(s: UnionSide, k: number, seps: UnionSeps): number {
  // before the side's first interval: the zone its track begins in
  let j = k, prev = 0;
  for (;;) {
    const x = s.enter(j), zmin = sepsStarting(seps, x), zmax = sepsEnding(seps, x, true);
    if (zmin >= zmax || j === 0) break;          // decided by x alone, or the first
    const pa = s.enter(j - 1), pb = s.end(j - 1);
    if (pa !== pb) { prev = endZone(seps, pb); break; }
    if (sepsEnding(seps, pa, true) + 1 <= zmin) break;   // the one before cannot reach a zone at x
    j--;
  }
  for (let i = j; i <= k; i++) prev = pointZoneAt(seps, s.enter(i), s.afterTool(i), prev);
  return prev;
}

/** Interval k's part in zone z, closed; null: none. A point part at a zone's
 *  bound belongs to the zone the interval goes on in; a point interval lies in
 *  its point zone. */
function partOf(s: UnionSide, k: number, seps: UnionSeps, z: number, out?: Span): Span | null {
  const a = s.enter(k), b = s.end(k);
  if (a === b && seps.count) return pointZone(s, k, seps) === z ? setSpan(out, a, a) : null;
  return clipPart(a, b, seps, z, out);
}
/** partOf's rule for an interval with length (or no separators). */
function clipPart(a: number, b: number, seps: UnionSeps, z: number, out?: Span,
                  lo = zoneLo(seps, z), hi = zoneHi(seps, z)): Span | null {
  const A = a > lo ? a : lo, B = b < hi ? b : hi;
  if (A > B) return null;
  if (A === B && a < b) {
    if (z > 0 && A === lo && a < lo) return null;
    if (z < seps.count && B === hi && b > hi) return null;
  }
  return setSpan(out, A, B);
}
function setSpan(out: Span | undefined, a: number, b: number): Span {
  if (!out) return { a, ao: false, b, bo: false };
  out.a = a; out.ao = false; out.b = b; out.bo = false;
  return out;
}
/** A span the hot loops reuse (never held across a call that reuses it). */
const TMP: Span = { a: 0, ao: false, b: 0, bo: false };

/** Interval k's part in zone z at or after y (after y with !incl); null: none. */
function partFrom(s: UnionSide, k: number, seps: UnionSeps, z: number, y: number, incl: boolean, out?: Span): Span | null {
  const p = partOf(s, k, seps, z, out);
  if (!p) return null;
  if (y < p.a || (y === p.a && incl)) return p;
  if (y > p.b || (y === p.b && !incl)) return null;
  p.a = y; p.ao = !incl;
  return p;
}

// ---- free stretches -------------------------------------------------------------------------------

/** Last interval with enter ≤ y (−1: none). */
function predEnter(s: UnionSide, y: number): number {
  let lo = 0, hi = s.n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s.enter(m) <= y) lo = m + 1; else hi = m; }
  return lo - 1;
}
/** First interval with enter ≥ y. */
function firstEnterFrom(s: UnionSide, y: number): number {
  let lo = 0, hi = s.n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s.enter(m) < y) lo = m + 1; else hi = m; }
  return lo;
}

/** The point y (incl) — or the points just after it (!incl) — lie in the span. */
function holds(sp: Span, y: number, incl: boolean): boolean {
  if (incl) return (y > sp.a || (y === sp.a && !sp.ao)) && (y < sp.b || (y === sp.b && !sp.bo));
  return y >= sp.a && y < sp.b;
}

/** Two spans share a point. */
function meet(x: Span, y: Span): boolean {
  if (x.b < y.a || y.b < x.a) return false;
  if (x.b === y.a) return !x.bo && !y.ao;
  if (y.b === x.a) return !y.bo && !x.ao;
  return true;
}

const inSpan = (f: Span, x: number) => (f.a === f.b ? x === f.a : x > f.a && x < f.b);

/** The confirmed points of interval k inside the free stretch f — its
 *  witness, its decided boundaries — through `each(x)`. */
function confirmedIn(s: UnionSide, k: number, f: Span, each: (x: number) => void): void {
  const w = s.witness(k);
  if (inSpan(f, w)) each(w);
  if (s.enterDecided(k) && inSpan(f, s.enter(k))) each(s.enter(k));
  if (s.exitDecided(k) && !s.open(k) && inSpan(f, s.end(k))) each(s.end(k));
}

/** Every confirmed point of both sides inside f: an interval's points lie in
 *  [its enter, the next enter), so the intervals from the one before the last
 *  entering at or before f's start on hold all of them (two intervals of one
 *  generation touch at a point separator). */
function eachConfirmedIn(sides: readonly UnionSide[], f: Span, each: (x: number) => void): void {
  for (const t of sides) {
    for (let k = Math.max(0, firstEnterFrom(t, f.a) - 1); k < t.n && t.enter(k) <= f.b; k++) confirmedIn(t, k, f, each);
  }
}

/** Interval j's (side `fs`) proven free stretch: the open (p − r', p + r'),
 *  r' its radius cut back to the nearest confirmed point (either side)
 *  inside the stretch; the point {p} where r' = 0 from r = 0; null where it
 *  has no sample or a confirmed point lies on the sample itself. */
function freeStretch(sides: readonly UnionSide[], fs: number, j: number): Span | null {
  const s = sides[fs]!, p = s.freeAt(j);
  if (Number.isNaN(p)) return null;
  let r = freeRadius(s.freeR(j));
  const f: Span = r > 0 ? { a: p - r, ao: true, b: p + r, bo: true } : { a: p, ao: false, b: p, bo: false };
  let onSample = false;
  eachConfirmedIn(sides, f, x => { if (x === p) onSample = true; r = Math.min(r, Math.abs(x - p)); });
  if (onSample) return null;
  return r > 0 ? { a: p - r, ao: true, b: p + r, bo: true } : { a: p, ao: false, b: p, bo: false };
}

/** The zone a free stretch's end starts a piece in: the last zone it meets. */
function freeZone(seps: UnionSeps, f: Span): number {
  return f.a === f.b ? sepsEnding(seps, f.b, true) : sepsEnding(seps, f.b, false);
}

/** Every proven free stretch of both sides that may meet [lo, hi], through `each`. */
function eachFreeNear(sides: readonly UnionSide[], lo: number, hi: number, each: (g: Span) => void): void {
  for (let fs = 0; fs < sides.length; fs++) {
    const s = sides[fs]!;
    // a free stretch of j lies in (enter_j − front, enter_{j+1} + back)
    const j1 = predEnter(s, hi + s.front);
    for (let j = Math.max(0, firstEnterFrom(s, lo - s.back) - 1); j <= j1; j++) {
      // the raw stretch first: one that misses [lo, hi] has nothing in it
      const p = s.freeAt(j);
      if (Number.isNaN(p)) continue;
      const r = freeRadius(s.freeR(j));
      if (p + r < lo || p - r > hi) continue;
      const g = freeStretch(sides, fs, j);
      if (g) each(g);
    }
  }
}

// ---- one piece, asked from its start ----------------------------------------------------------------

/** The zone a piece's start evidence names (−1: none). */
export function evidenceZone(sides: readonly UnionSide[], seps: UnionSeps, side: number, kind: number, idx: number): number {
  if (kind === START_SEP) return idx + 1;
  const s = sides[side]!;
  if (kind === START_ENTER) {
    const a = s.enter(idx);
    if (a === s.end(idx) && seps.count) return pointZone(s, idx, seps);
    const z = sepsEnding(seps, a, true);
    for (const c of [z, z - 1]) {
      if (c < 0) continue;
      const p = partOf(s, idx, seps, c);
      if (p && p.a === a) return c;
    }
    return -1;
  }
  const f = freeStretch(sides, side, idx);
  return f ? freeZone(seps, f) : -1;
}

/** The position a piece's start evidence names — the build and every later
 *  question compute it with this one function (NaN: the evidence names none). */
export function evidencePos(sides: readonly UnionSide[], seps: UnionSeps, side: number, kind: number, idx: number): number {
  if (kind === START_ENTER) return sides[side]!.enter(idx);
  if (kind === START_SEP) return seps.e(idx);
  const f = freeStretch(sides, side, idx);
  return f ? f.b : NaN;
}

/** The first piece of zone z starting at y or after it (after it with
 *  !incl): the component of the zone's union less the free stretches that y
 *  opens, or the next one; null: none. */
export function pieceFrom(sides: readonly UnionSide[], seps: UnionSeps, z: number, y: number, incl = true): UnionPiece | null {
  const lo = zoneLo(seps, z), hi = zoneHi(seps, z);
  if (y < lo) { y = lo; incl = true; }
  let start: Span, startSide: number, startK: number;
  // the start: the earliest part point at or after y outside every free stretch
  for (;;) {
    let best: Span | null = null, bSide = 0, bK = 0;
    for (let si = 0; si < sides.length; si++) {
      const s = sides[si]!;
      // from the one before the last entering at or before y (two intervals
      // of a generation touch at a point separator, in two zones)
      for (let k = Math.max(0, firstEnterFrom(s, y) - 1); k < s.n && s.enter(k) <= hi; k++) {
        const p = partFrom(s, k, seps, z, y, incl);
        if (!p) continue;
        if (!best || p.a < best.a || (p.a === best.a && best.ao && !p.ao)) { best = p; bSide = si; bK = k; }
        break;
      }
    }
    if (!best) return null;
    const cand = best;
    let hit: Span | null = null;
    eachFreeNear(sides, cand.a, cand.a, g => {
      if (holds(g, cand.a, !cand.ao) && (!hit || g.b > hit.b || (g.b === hit.b && !g.bo))) hit = g;
    });
    if (!hit) { start = cand; startSide = bSide; startK = bK; break; }
    // past the fragment: its end point is no proof of freedom when open
    y = (hit as Span).b; incl = (hit as Span).bo;
  }
  const st = start;
  // the start's evidence: an enter, else a free stretch's end in this zone, else the zone's start
  let kind = -1, side = startSide, idx = startK;
  if (!st.ao && st.a === sides[startSide]!.enter(startK)) kind = START_ENTER;
  else {
    for (let ti = 0; ti < sides.length && kind < 0; ti++) {
      const t = sides[ti]!;
      const j1 = predEnter(t, st.a + t.front);
      for (let j = Math.max(0, firstEnterFrom(t, st.a - t.back) - 1); j <= j1; j++) {
        if (Number.isNaN(t.freeAt(j))) continue;
        const f = freeStretch(sides, ti, j);
        if (f && f.b === st.a && freeZone(seps, f) === z) { kind = START_FREE; side = ti; idx = j; break; }
      }
    }
    if (kind < 0 && z > 0 && !st.ao && st.a === lo) { kind = START_SEP; side = -1; idx = z - 1; }
  }
  // the end: the first fragment from the start on — by side in order, each
  // side's search ends past the best one found (a stretch of j begins after
  // enter_j − front) …
  const after: Span = { a: st.a, ao: st.ao, b: Infinity, bo: false };
  let cut: Span | null = null;
  for (let fs = 0; fs < sides.length; fs++) {
    const s = sides[fs]!;
    for (let j = Math.max(0, firstEnterFrom(s, st.a - s.back) - 1); j < s.n; j++) {
      const from = s.enter(j) - s.front;
      if (from > hi || (cut && from > (cut as Span).a)) break;
      const p = s.freeAt(j);
      if (Number.isNaN(p) || p + freeRadius(s.freeR(j)) < st.a) continue;
      const g = freeStretch(sides, fs, j);
      if (!g || !meet(g, after)) continue;
      if (!cut || g.a < cut.a || (g.a === cut.a && !g.ao && cut.ao)) cut = g;
    }
  }
  // … and the zone union's reach from the start, up to it
  const stop = cut ? (cut as Span).a : Infinity;
  let b = st.b, bo = st.bo;
  for (let grew = true; grew && b < stop;) {
    grew = false;
    for (const s of sides) {
      const k = predEnter(s, b);
      for (let q = Math.max(0, firstEnterFrom(s, b) - 1); q <= k; q++) {
        const p = partFrom(s, q, seps, z, b, true);
        if (!p || p.a !== b) continue;
        if (p.b > b || (p.b === b && bo && !p.bo)) { b = p.b; bo = p.bo; grew = true; }
      }
    }
  }
  if (cut) {
    const c: Span = cut;
    // the fragment cuts the piece where it meets it: before the reach's end
    if (c.a < b || (c.a === b && !c.ao && !bo)) { b = c.a; bo = !c.ao; }
  }
  const piece: UnionPiece = { zone: z, start: st.a, startOpen: st.ao, end: b, endOpen: bo, startKind: kind, startSide: side, startIdx: idx,
                              from0: 0, to0: 0, from1: 0, to1: 0 };
  rangesOf(sides, seps, piece);
  return piece;
}

/** The intervals of each side whose zone part meets the piece, as index
 *  ranges (contiguous: the parts are apart, by enter). */
function rangesOf(sides: readonly UnionSide[], seps: UnionSeps, p: UnionPiece): void {
  const span: Span = { a: p.start, ao: p.startOpen, b: p.end, bo: p.endOpen };
  for (let si = 0; si < 2; si++) {
    const s = sides[si];
    let from = 0, to = 0;
    if (s) {
      from = -1;
      for (let k = Math.max(0, firstEnterFrom(s, p.start) - 1); k < s.n && s.enter(k) <= p.end; k++) {
        const iv = partOf(s, k, seps, p.zone, TMP);
        if (!iv || !meet(iv, span)) continue;
        if (from < 0) from = k;
        to = k + 1;
      }
      if (from < 0) from = to = 0;
    }
    if (si === 0) { p.from0 = from; p.to0 = to; } else { p.from1 = from; p.to1 = to; }
  }
}

/** Every interval (side, index) whose zone part meets the piece — by side,
 *  by enter — and whether it holds the piece's start (its earliest such is
 *  the piece's lead, plan 3.5's "Ursprungszeile"). */
export function pieceIntervals(sides: readonly UnionSide[], seps: UnionSeps, p: UnionPiece,
                               each: (side: number, k: number, holdsStart: boolean) => void): void {
  for (let si = 0; si < sides.length; si++) {
    const s = sides[si]!, from = si === 0 ? p.from0 : p.from1, to = si === 0 ? p.to0 : p.to1;
    for (let k = from; k < to; k++) {
      const iv = partFrom(s, k, seps, p.zone, p.start, !p.startOpen, TMP);
      each(si, k, !!iv && iv.a === p.start && iv.ao === p.startOpen);
    }
  }
}
/** pieceIntervals in bounded steps: a piece may hold a group's every interval
 *  (Codex R157 VP-I115). `c` counts the work since the caller's last yield. */
export function* pieceIntervalsSteps(sides: readonly UnionSide[], seps: UnionSeps, p: UnionPiece,
                                     each: (side: number, k: number, holdsStart: boolean) => void, c: Ops): Steps<void> {
  for (let si = 0; si < sides.length; si++) {
    const s = sides[si]!, from = si === 0 ? p.from0 : p.from1, to = si === 0 ? p.to0 : p.to1;
    for (let k = from; k < to; k++) {
      const iv = partFrom(s, k, seps, p.zone, p.start, !p.startOpen, TMP);
      each(si, k, !!iv && iv.a === p.start && iv.ao === p.startOpen);
      if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
    }
  }
}

// ---- the build: one walk per group ------------------------------------------------------------------

/** One side read once (the walk's scratch; grows, never shrinks). */
interface SideScratch {
  n: number;
  enter: Float64Array; end: Float64Array; witness: Float64Array; freeAt: Float64Array; freeR: Float64Array;
  /** 1 enter decided, 2 exit decided, 4 open, 8 after the unknown tool. */
  flags: Uint8Array;
  /** A point interval's zone (pointZone, computed forward once). */
  pz: Int32Array;
  /** Its free stretches by interval order: count, start, end, a point, the interval. */
  fn: number;
  fLo: Float64Array; fHi: Float64Array; fPt: Uint8Array; fJ: Int32Array;
  /** The stretches' order by end (identity unless the structure is broken). */
  fByHi: Int32Array | null;
}
/** A build's scratch, reused group after group (dropped with the build). */
export interface UnionScratch { sides: SideScratch[]; fLo: Float64Array; fHi: Float64Array; fLoOpen: Uint8Array; fHiOpen: Uint8Array }
export function unionScratch(): UnionScratch {
  const side = (): SideScratch => ({ n: 0, enter: allocF64(0), end: allocF64(0), witness: allocF64(0),
                                     freeAt: allocF64(0), freeR: allocF64(0), flags: allocU8(0), pz: allocI32(0),
                                     fn: 0, fLo: allocF64(0), fHi: allocF64(0), fPt: allocU8(0), fJ: allocI32(0), fByHi: null });
  return { sides: [side(), side()], fLo: allocF64(0), fHi: allocF64(0), fLoOpen: allocU8(0), fHiOpen: allocU8(0) };
}
const F_ED = 1, F_XD = 2, F_OPEN = 4, F_AFTER = 8;
// (the scratch's growth counted where it is made: plan 3.6, Codex R158 VP-I118)
const grow64 = (a: Float64Array, n: number) => (a.length >= n ? a : allocF64(Math.max(n, 2 * a.length)));
const grow8 = (a: Uint8Array, n: number) => (a.length >= n ? a : allocU8(Math.max(n, 2 * a.length)));
const grow32 = (a: Int32Array, n: number) => (a.length >= n ? a : allocI32(Math.max(n, 2 * a.length)));

function* readSide(s: UnionSide, x: SideScratch, c: Ops): Steps<void> {
  const n = s.n;
  x.n = n;
  x.enter = grow64(x.enter, n); x.end = grow64(x.end, n); x.witness = grow64(x.witness, n); x.flags = grow8(x.flags, n);
  x.freeAt = grow64(x.freeAt, n); x.freeR = grow64(x.freeR, n);
  for (let k = 0; k < n; k++) {
    x.enter[k] = s.enter(k); x.end[k] = s.end(k); x.witness[k] = s.witness(k); x.freeAt[k] = s.freeAt(k); x.freeR[k] = s.freeR(k);
    x.flags[k] = (s.enterDecided(k) ? F_ED : 0) | (s.exitDecided(k) ? F_XD : 0) | (s.open(k) ? F_OPEN : 0) | (s.afterTool(k) ? F_AFTER : 0);
    if ((c.n += 8) >= STEP_OPS) { c.n = 0; yield; }
  }
}

/** partOf from a side's scratch. */
const partX = (x: SideScratch, k: number, seps: UnionSeps, z: number, out: Span, lo: number, hi: number) => {
  const a = x.enter[k]!, b = x.end[k]!;
  if (a === b && seps.count) return x.pz[k] === z ? setSpan(out, a, a) : null;
  return clipPart(a, b, seps, z, out, lo, hi);
};

/** Every point interval's zone, forward in the side's order — pointZone's
 *  rule, each from the one before. */
function* readPointZones(x: SideScratch, seps: UnionSeps, c: Ops): Steps<void> {
  x.pz = grow32(x.pz, x.n);
  if (!seps.count) return;
  let prev = 0;
  // an interval's zone: a bisection or two over the separators (each probe a gap read)
  const zone = 4 + 8 * Math.ceil(Math.log2(seps.count + 1));
  for (let k = 0; k < x.n; k++) {
    const a = x.enter[k]!, b = x.end[k]!;
    if (a === b) { prev = pointZoneAt(seps, a, (x.flags[k]! & F_AFTER) !== 0, prev); x.pz[k] = prev; }
    else prev = endZone(seps, b);
    if ((c.n += zone) >= STEP_OPS) { c.n = 0; yield; }
  }
}

/** Last index with enter ≤ y in a side's scratch (−1: none). */
function predEnterX(x: SideScratch, y: number): number {
  let lo = 0, hi = x.n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (x.enter[m]! <= y) lo = m + 1; else hi = m; }
  return lo - 1;
}

/** The distance from p to the nearest confirmed point of interval k (Infinity:
 *  none; 0: one on p). */
function nearestIn(x: SideScratch, k: number, p: number): number {
  if (k < 0 || k >= x.n) return Infinity;
  const f = x.flags[k]!;
  let d = Math.abs(x.witness[k]! - p);
  if (f & F_ED) d = Math.min(d, Math.abs(x.enter[k]! - p));
  if ((f & F_XD) && !(f & F_OPEN)) d = Math.min(d, Math.abs(x.end[k]! - p));
  return d;
}

/** Side `si`'s free stretches, cut back (freeStretch's rule from the
 *  scratch: the nearest confirmed points around p lie in the intervals
 *  k − 1 … k + 1 of each side, k the last entering at or before p). The
 *  contradictions deeper than the tolerance go to `conflict`. */
function* readStretches(xs: SideScratch[], si: number, c: Ops, conflict?: (x: number) => void): Steps<void> {
  const x = xs[si]!;
  x.fLo = grow64(x.fLo, x.n); x.fHi = grow64(x.fHi, x.n); x.fPt = grow8(x.fPt, x.n); x.fJ = grow32(x.fJ, x.n);
  let fn = 0, sorted = true;
  // the last interval of each side entering at or before p: the samples come
  // in order (the structure), so it only moves on — else it is searched
  const kp = [-1, -1], lastP = [-Infinity, -Infinity];
  const pred = (ti: number, p: number) => {
    const t = xs[ti]!;
    if (p < lastP[ti]!) kp[ti] = predEnterX(t, p);
    else while (kp[ti]! + 1 < t.n && t.enter[kp[ti]! + 1]! <= p) kp[ti]!++;
    lastP[ti] = p;
    return kp[ti]!;
  };
  for (let j = 0; j < x.n; j++) {
    const p = x.freeAt[j]!;
    if (Number.isNaN(p)) continue;
    const r0 = freeRadius(x.freeR[j]!);
    let r = r0;
    for (let ti = 0; ti < xs.length; ti++) {
      const t = xs[ti]!, k = pred(ti, p);
      for (let q = k - 1; q <= k + 1; q++) r = Math.min(r, nearestIn(t, q, p));
    }
    // a contradiction needs a confirmed point inside the stretch: only then is
    // r cut below r0 (the nearest points around p, by the structure)
    if (conflict && r0 > PROTECT && r < r0) wideX(xs, p, r0, conflict);
    if (r === 0 && r0 > 0) continue;   // a confirmed point on the sample
    if (r0 === 0) {
      // a point stretch: none where a confirmed point lies on it
      let on = false;
      for (let ti = 0; ti < xs.length; ti++) { const t = xs[ti]!, k = pred(ti, p); for (let q = k - 1; q <= k + 1; q++) if (nearestIn(t, q, p) === 0) on = true; }
      if (on) continue;
    }
    x.fLo[fn] = p - r; x.fHi[fn] = p + r; x.fPt[fn] = r > 0 ? 0 : 1; x.fJ[fn] = j;
    if (fn > 0 && (x.fLo[fn]! < x.fLo[fn - 1]! || x.fHi[fn]! < x.fHi[fn - 1]!)) sorted = false;
    fn++;
    if ((c.n += 16) >= STEP_OPS) { c.n = 0; yield; }
  }
  x.fn = fn;
  x.fByHi = null;
  if (!sorted) {
    // the structure is broken: order by start for the union, by end for the evidence
    // (stable, in steps: ties keep their index order, as the engine's sort did)
    const ord = yield* sortSteps(fn, (a, b) => x.fLo[a]! - x.fLo[b]! || x.fPt[b]! - x.fPt[a]!);
    const lo = allocF64(fn), hi = allocF64(fn), pt = allocU8(fn), jj = allocI32(fn);
    for (let k = 0; k < fn; k++) {
      const i = ord[k]!;
      lo[k] = x.fLo[i]!; hi[k] = x.fHi[i]!; pt[k] = x.fPt[i]!; jj[k] = x.fJ[i]!;
      if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
    }
    x.fLo.set(lo); x.fHi.set(hi); x.fPt.set(pt); x.fJ.set(jj);
    const byHi = yield* sortSteps(fn, (a, b) => x.fHi[a]! - x.fHi[b]! || x.fJ[a]! - x.fJ[b]!);
    x.fByHi = yield* copySteps(allocI32(fn), byHi, c);
  }
}

/** wideIn from the scratch: the same points, the same test. */
function wideX(xs: SideScratch[], p: number, r: number, each: (x: number) => void): void {
  const a = p - r, b = p + r;
  const deep = (x: number) => { if (x > a && x < b && x - a > PROTECT && b - x > PROTECT) each(x); };
  for (const t of xs) {
    for (let k = Math.max(0, predEnterX(t, a) - 1); k < t.n && t.enter[k]! <= b; k++) {
      const f = t.flags[k]!;
      deep(t.witness[k]!);
      if (f & F_ED) deep(t.enter[k]!);
      if ((f & F_XD) && !(f & F_OPEN)) deep(t.end[k]!);
    }
  }
}

/** The contradictions inside the original stretch (p − r, p + r): confirmed
 *  points deeper than the tolerance from both edges. */
function wideIn(sides: readonly UnionSide[], p: number, r: number, each: (x: number) => void): void {
  const f: Span = { a: p - r, ao: true, b: p + r, bo: true };
  eachConfirmedIn(sides, f, x => { if (x - f.a > PROTECT && f.b - x > PROTECT) each(x); });
}

/** Both sides' free stretches as one union, by start: sorted spans apart. */
function* mergeFree(xs: SideScratch[], sc: UnionScratch, c: Ops): Steps<number> {
  const total = xs[0]!.fn + xs[1]!.fn;
  sc.fLo = grow64(sc.fLo, total); sc.fHi = grow64(sc.fHi, total); sc.fLoOpen = grow8(sc.fLoOpen, total); sc.fHiOpen = grow8(sc.fHiOpen, total);
  let i = 0, j = 0, m = 0;
  const A = xs[0]!, B = xs[1]!;
  while (i < A.fn || j < B.fn) {
    // by start, a closed (point) start first
    let take0: boolean;
    if (j >= B.fn) take0 = true;
    else if (i >= A.fn) take0 = false;
    else take0 = A.fLo[i]! < B.fLo[j]! || (A.fLo[i] === B.fLo[j] && A.fPt[i]! >= B.fPt[j]!);
    const X = take0 ? A : B, q = take0 ? i++ : j++;
    if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
    const a = X.fLo[q]!, b = X.fHi[q]!, pt = X.fPt[q] === 1;
    const ao = !pt, bo = !pt;
    if (m > 0) {
      const lb = sc.fHi[m - 1]!, lbo = sc.fHiOpen[m - 1] === 1;
      // they share a point, or one holds the point between them
      if (a < lb || (a === lb && !(ao && lbo))) {
        if (b > lb) { sc.fHi[m - 1] = b; sc.fHiOpen[m - 1] = bo ? 1 : 0; }
        else if (b === lb && !bo) sc.fHiOpen[m - 1] = 0;
        continue;
      }
    }
    sc.fLo[m] = a; sc.fLoOpen[m] = ao ? 1 : 0; sc.fHi[m] = b; sc.fHiOpen[m] = bo ? 1 : 0;
    m++;
  }
  return m;
}

/** Side x's stretch ending at `at` in zone z, the first by interval (−1: none). */
function freeEndingAt(x: SideScratch, seps: UnionSeps, z: number, at: number): number {
  const hiAt = (i: number) => x.fHi[x.fByHi ? x.fByHi[i]! : i]!;
  let lo = 0, hi = x.fn;
  while (lo < hi) { const m = (lo + hi) >> 1; if (hiAt(m) < at) lo = m + 1; else hi = m; }
  for (let i = lo; i < x.fn && hiAt(i) === at; i++) {
    const q = x.fByHi ? x.fByHi[i]! : i;
    const f: Span = { a: x.fLo[q]!, ao: x.fPt[q] === 0, b: x.fHi[q]!, bo: x.fPt[q] === 0 };
    if (freeZone(seps, f) === z) return x.fJ[q]!;
  }
  return -1;
}

/** Every piece of the group, zone by zone, in order — ONE walk (Codex R151):
 *  the intervals read once, each free stretch computed once, both
 *  generations' parts merged by start and their free stretches cut out. The
 *  contradictions deeper than the tolerance go to `conflict` (as
 *  `eachWideConflict` names them). `each` may not keep the piece past its
 *  call. */
export function eachPiece(sides: readonly UnionSide[], seps: UnionSeps, each: (p: UnionPiece) => void,
                          conflict?: (x: number) => void, scratch: UnionScratch = unionScratch()): void {
  runToEnd(eachPieceSteps(sides, seps, each, conflict, scratch));
}
/** Intervals the walk looks at between two counts of its work. */
const SCAN = 64;
/** A piece's callback: its work as a number, or a job of bounded steps that
 *  counts its own work (a piece may hold a group's every interval — a number
 *  added after the work bounded nothing, Codex R157 VP-I115). */
export type PieceEach = (p: UnionPiece) => number | void | Steps<void>;
/** eachPiece in bounded steps (plan 3.6): it yields inside a group, inside a
 *  component and inside a piece too — one group may hold a request's every
 *  interval, one component every part of it. `c` counts the work since the
 *  caller's last yield. */
export function* eachPieceSteps(sides: readonly UnionSide[], seps: UnionSeps, each: PieceEach,
                                conflict?: (x: number) => void, scratch: UnionScratch = unionScratch(), c: Ops = { n: 0 }): Steps<void> {
  const xs = scratch.sides;
  for (let si = 0; si < 2; si++) {
    const s = sides[si];
    if (s) { yield* readSide(s, xs[si]!, c); yield* readPointZones(xs[si]!, seps, c); } else { xs[si]!.n = 0; }
  }
  for (let si = 0; si < 2; si++) { if (sides[si]) yield* readStretches(xs, si, c, conflict); else xs[si]!.fn = 0; }
  const fm = yield* mergeFree(xs, scratch, c);
  const fLo = scratch.fLo, fHi = scratch.fHi, fLoOpen = scratch.fLoOpen, fHiOpen = scratch.fHiOpen;
  const zones = seps.count + 1;
  // per side: the first interval that may have a part in the zone (an
  // interval reaching over a separator has parts on both sides of it)
  const kz = [0, 0];
  let fp = 0;   // the first free stretch that may still meet a part
  const parts: Array<Span | null> = [null, null], pk = [0, 0];
  const own: Span[] = [{ a: 0, ao: false, b: 0, bo: false }, { a: 0, ao: false, b: 0, bo: false }];
  for (let z = 0; z < zones; z++) {
    const lo = zoneLo(seps, z), hi = zoneHi(seps, z);
    // the parts of each side in the zone, in order: pk[s] the next index
    for (let si = 0; si < 2; si++) {
      const x = xs[si]!;
      while (kz[si]! < x.n && x.end[kz[si]!]! < lo) { kz[si]!++; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
      pk[si] = kz[si]!;
    }
    // the next part of a side in the zone from pk[si] on, at most SCAN
    // intervals looked at a call: false — not found yet. The walk counts each
    // call and yields between them (Codex R157 VP-I115: a component's parts
    // were gathered at once — a coarse held contact over a finer rerun's
    // every contact); no generator a part on the common path
    const scan = (si: number): boolean => {
      const x = xs[si]!;
      for (let m = 0; m < SCAN; m++) {
        if (!(pk[si]! < x.n && x.enter[pk[si]!]! <= hi)) { parts[si] = null; return true; }
        const p = partX(x, pk[si]!, seps, z, own[si]!, lo, hi);
        if (p) { parts[si] = p; return true; }
        pk[si]!++;
      }
      return false;
    };
    for (let si = 0; si < 2; si++) {
      while (!scan(si)) if ((c.n += 2 * SCAN) >= STEP_OPS) { c.n = 0; yield; }
      if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
    }
    // for the ranges: the first part of each side that may meet the next piece
    const rp = [pk[0]!, pk[1]!];
    // the union's components: closed spans of parts that share points
    for (;;) {
      if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
      const s0 = parts[0], s1 = parts[1];
      if (!s0 && !s1) break;
      const take0 = !!s0 && (!s1 || s0.a <= s1.a);
      const first = (take0 ? s0 : s1)!;
      const ca = first.a;
      let cb = first.b;
      // advance the taken part, then absorb every part starting within the component
      let si = take0 ? 0 : 1;
      for (;;) {
        pk[si]!++;
        while (!scan(si)) if ((c.n += 2 * SCAN) >= STEP_OPS) { c.n = 0; yield; }
        if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
        const n0 = parts[0], n1 = parts[1];
        if (n0 && n0.a <= cb) { if (n0.b > cb) cb = n0.b; si = 0; }
        else if (n1 && n1.a <= cb) { if (n1.b > cb) cb = n1.b; si = 1; }
        else break;
      }
      // the component [ca, cb] less the free stretches: its pieces
      while (fp < fm && (fHi[fp]! < ca || (fHi[fp] === ca && fHiOpen[fp] === 1))) { fp++; if (++c.n >= STEP_OPS) { c.n = 0; yield; } }
      let x = ca, xo = false;
      let fi = fp;
      const emit = function* (b: number, bo: boolean): Steps<void> {
        if (x > b || (x === b && (xo || bo))) return;
        yield* emitPieceSteps(sides, seps, xs, z, lo, hi, x, xo, b, bo, rp, each, c);
      };
      for (; fi < fm && (fLo[fi]! < cb || (fLo[fi] === cb && fLoOpen[fi] === 0)); fi++) {
        yield* emit(fLo[fi]!, fLoOpen[fi] === 0);
        if (fHi[fi]! > x || (fHi[fi] === x && !xo)) { x = fHi[fi]!; xo = fHiOpen[fi] === 0; }
        if (x > cb) break;
        if (++c.n >= STEP_OPS) { c.n = 0; yield; }
      }
      if (x < cb || (x === cb && !xo)) yield* emit(cb, false);
      // a stretch reaching past the component may meet the next one too
      fp = Math.max(fp, fi > fp ? fi - 1 : fp);
    }
    // the next zone starts its parts from this one's first: an interval may
    // reach over the separator, and a point part this zone left out may be
    // the next one's (the skip by end is linear over all zones)
  }
}

/** A piece found by the walk: its start evidence, its ranges, then `each` —
 *  every part read counted, `each`'s work too (in steps when it is a job). */
function* emitPieceSteps(sides: readonly UnionSide[], seps: UnionSeps, xs: SideScratch[], z: number, lo: number, hi: number,
                         a: number, ao: boolean, b: number, bo: boolean, rp: number[], each: PieceEach, c: Ops): Steps<void> {
  if ((c.n += 8) >= STEP_OPS) { c.n = 0; yield; }
  const span: Span = { a, ao, b, bo };
  const piece: UnionPiece = { zone: z, start: a, startOpen: ao, end: b, endOpen: bo, startKind: -1, startSide: -1, startIdx: -1,
                              from0: 0, to0: 0, from1: 0, to1: 0 };
  // the ranges, and the part holding the start: pieces come in order, so the
  // first part that may meet one only moves on
  let holder = -1, holderSide = -1;
  for (let si = 0; si < 2; si++) {
    const s = sides[si], x = xs[si]!;
    let from = -1, to = 0;
    if (s) {
      while (rp[si]! < x.n && x.enter[rp[si]!]! <= b) {
        const p = partX(x, rp[si]!, seps, z, TMP, lo, hi);
        if (p && (p.b > a || (p.b === a && !ao))) break;
        rp[si]!++;
        if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
      }
      for (let k = rp[si]!; k < x.n && x.enter[k]! <= b; k++) {
        if ((c.n += 2) >= STEP_OPS) { c.n = 0; yield; }
        const p = partX(x, k, seps, z, TMP, lo, hi);
        if (!p || !meet(p, span)) continue;
        if (from < 0) from = k;
        to = k + 1;
        // the start's holder: the earliest side whose part holds the start
        if (holderSide < 0 && holds(p, a, !ao)) { holder = k; holderSide = si; }
      }
    }
    if (from < 0) from = to = 0;
    if (si === 0) { piece.from0 = from; piece.to0 = to; } else { piece.from1 = from; piece.to1 = to; }
  }
  // the evidence, pieceFrom's rule: the holding side's enter, else a free
  // stretch's end in this zone (side by side, by interval), else the zone's start
  if (!ao && holderSide >= 0 && xs[holderSide]!.enter[holder] === a) { piece.startKind = START_ENTER; piece.startSide = holderSide; piece.startIdx = holder; }
  else {
    for (let si = 0; si < 2 && piece.startKind < 0; si++) {
      const j = freeEndingAt(xs[si]!, seps, z, a);
      if (j >= 0) { piece.startKind = START_FREE; piece.startSide = si; piece.startIdx = j; }
    }
    if (piece.startKind < 0 && z > 0 && !ao && a === lo) { piece.startKind = START_SEP; piece.startSide = -1; piece.startIdx = z - 1; }
  }
  const r = each(piece);
  if (typeof r === "object" && r !== null) yield* r;
  else if ((c.n += r ?? 0) >= STEP_OPS) { c.n = 0; yield; }
}

/** The places where the two generations contradict each other on one
 *  geometry: a confirmed point inside a free stretch deeper than the
 *  refinement's tolerance from both edges (plan 3.5's conflict is the
 *  tolerance case) — possible as soon as the radius exceeds the tolerance
 *  (Codex R151 VP-I114). Kept as contact all the same; `each` gets the point
 *  (own axis). */
export function eachWideConflict(sides: readonly UnionSide[], each: (x: number) => void): void {
  for (let fs = 0; fs < sides.length; fs++) {
    const s = sides[fs]!;
    for (let j = 0; j < s.n; j++) {
      const p = s.freeAt(j);
      if (Number.isNaN(p)) continue;
      const r = freeRadius(s.freeR(j));
      if (r > PROTECT) wideIn(sides, p, r, each);
    }
  }
}

/** The search bounds of one generation (`UnionSide.back` / `front`) over a
 *  source's intervals sorted by group and enter. */
export function unionReach(n: number, enter: (k: number) => number, freeAt: (k: number) => number,
                           freeR: (k: number) => number, sameGroup: (k: number, k2: number) => boolean): { back: number; front: number } {
  return runToEnd(unionReachSteps(n, enter, freeAt, freeR, sameGroup));
}
/** unionReach in bounded steps (plan 3.6). */
export function* unionReachSteps(n: number, enter: (k: number) => number, freeAt: (k: number) => number,
                                 freeR: (k: number) => number, sameGroup: (k: number, k2: number) => boolean,
                                 c: Ops = { n: 0 }): Steps<{ back: number; front: number }> {
  let back = 0, front = 0;
  for (let k = 0; k < n; k++) {
    if ((c.n += 4) >= STEP_OPS) { c.n = 0; yield; }
    const p = freeAt(k);
    if (Number.isNaN(p)) continue;
    const r = freeRadius(freeR(k));
    front = Math.max(front, enter(k) - (p - r));
    if (k + 1 < n && sameGroup(k, k + 1)) back = Math.max(back, p + r - enter(k + 1));
  }
  return { back, front };
}

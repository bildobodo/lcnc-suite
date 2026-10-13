// Step 4 package 2, round B4: what a request shows after its pool fell back
// to one core (plan docs/reviews/kollision-paket2.plan.md Fassung 5, 3.5;
// Codex R140–R143). The local run computes the request again as a new
// generation; the earlier one's evidence stays. Per pair and origin (plan
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
// The pieces are the EVENTS (targets, identity): a knowledge gap does not
// split one, as it does not split an interval without a fallback. What a
// piece shows as contact — the tint, the bands, the marks — is its
// contributors' own contact less each one's generation's gaps (ignorance is
// no freedom); the view reads that from its tables.
//
// Pure, on ONE group's intervals per generation through accessors (the view
// reads its tables, nothing is copied). ONE search, `pieceFrom`, answers both
// the build (piece after piece) and every later question about a piece (its
// end, what it holds) from the piece's start alone — so the view holds one
// u32 per piece, and what it shows is what the build found.

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
  /** The free sample after its exit (NaN: none) and its proven radius. */
  freeAt(k: number): number;
  freeR(k: number): number;
  /** Bounds of the searches, over the whole source (`unionReach`): how far a
   *  free stretch of this generation reaches past the NEXT interval's enter
   *  (`back`) and before its own interval's enter (`front`). */
  readonly back: number;
  readonly front: number;
}

/** What a piece's start is: an interval's enter, or the end of an interval's
 *  free stretch (p + r'; the point p itself for r' = 0). */
export const START_ENTER = 0, START_FREE = 1;

/** One shown event of the group: a connected piece of the union less the
 *  free stretches, on the own axis. */
export interface UnionPiece {
  start: number;
  startOpen: boolean;
  end: number;
  endOpen: boolean;
  /** Its start's evidence: kind (START_*; −1 when the search began inside a
   *  piece — a later question asks from its start, never from inside), the
   *  side (0 the earlier, held generation, 1 the current) and the interval
   *  index there. */
  startKind: number;
  startSide: number;
  startIdx: number;
}

interface Span { a: number; ao: boolean; b: number; bo: boolean }

/** A free sample's proven radius (none: 0). */
export const freeRadius = (r: number) => (r > 0 ? r : 0);

/** One group's free stretches, computed once per interval while a build
 *  walks its pieces or a view asks of one group's pieces in turn (by side, by
 *  interval; undefined: not computed yet). */
export type FreeMemo = Array<Array<Span | null | undefined>>;

/** The position a piece's start evidence names — the build and every later
 *  question compute it with this one function (NaN: the evidence names none). */
export function evidencePos(sides: readonly UnionSide[], side: number, kind: number, idx: number, memo?: FreeMemo): number {
  if (kind === START_ENTER) return sides[side]!.enter(idx);
  const f = freeOf(sides, side, idx, memo);
  return f ? f.b : NaN;
}

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

/** Interval k at or after y (after y with !incl), clipped to it; null: none. */
function intervalFrom(s: UnionSide, k: number, y: number, incl: boolean): Span | null {
  const enter = s.enter(k), end = s.end(k);
  let a: number, ao: boolean;
  if (y < enter || (y === enter && incl)) { a = enter; ao = false; } else { a = y; ao = !incl; }
  if (a > end || (a === end && ao)) return null;
  return { a, ao, b: end, bo: false };
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
  for (const t of sides) {
    // the intervals of t overlapping [f.a, f.b]
    let k = predEnter(t, f.a);
    if (k < 0) k = 0;
    else if (t.end(k) < f.a) k++;
    for (; k < t.n && t.enter(k) <= f.b; k++) {
      confirmedIn(t, k, f, x => { if (x === p) onSample = true; r = Math.min(r, Math.abs(x - p)); });
    }
  }
  if (onSample) return null;
  return r > 0 ? { a: p - r, ao: true, b: p + r, bo: true } : { a: p, ao: false, b: p, bo: false };
}

/** freeStretch, through the build's memo where there is one. */
function freeOf(sides: readonly UnionSide[], fs: number, j: number, memo?: FreeMemo): Span | null {
  if (!memo) return freeStretch(sides, fs, j);
  const m = (memo[fs] ??= []);
  let f = m[j];
  if (f === undefined) m[j] = f = freeStretch(sides, fs, j);
  return f;
}

/** Every proven free stretch of both sides that may meet [lo, hi], through `each`. */
function eachFreeNear(sides: readonly UnionSide[], lo: number, hi: number, each: (g: Span) => void, memo?: FreeMemo): void {
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
      const g = freeOf(sides, fs, j, memo);
      if (g) each(g);
    }
  }
}

/** The first piece starting at y or after it (after it with !incl): the
 *  component of the union less the free stretches that y opens, or the next
 *  one; null: none. */
export function pieceFrom(sides: readonly UnionSide[], y: number, incl = true, memo?: FreeMemo): UnionPiece | null {
  let start: Span, startSide: number, startK: number;
  // the start: the earliest interval point at or after y outside every free stretch
  for (;;) {
    let best: Span | null = null, bSide = 0, bK = 0;
    for (let si = 0; si < sides.length; si++) {
      const s = sides[si]!;
      for (let k = Math.max(0, predEnter(s, y)); k < s.n; k++) {
        const p = intervalFrom(s, k, y, incl);
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
    }, memo);
    if (!hit) { start = cand; startSide = bSide; startK = bK; break; }
    // past the fragment: its end point is no proof of freedom when open
    y = (hit as Span).b; incl = (hit as Span).bo;
  }
  const st = start;
  // the start's evidence
  let kind = -1, side = startSide, idx = startK;
  if (!st.ao && st.a === sides[startSide]!.enter(startK)) kind = START_ENTER;
  else {
    // a free stretch's end (its j lies within the search bounds)
    for (let ti = 0; ti < sides.length && kind < 0; ti++) {
      const t = sides[ti]!;
      const j1 = predEnter(t, st.a + t.front);
      for (let j = Math.max(0, firstEnterFrom(t, st.a - t.back) - 1); j <= j1; j++) {
        if (!Number.isNaN(t.freeAt(j)) && evidencePos(sides, ti, START_FREE, j, memo) === st.a) { kind = START_FREE; side = ti; idx = j; break; }
      }
    }
  }
  // the end: the first fragment from the start on — by side in order, each
  // side's search ends past the best one found (a stretch of j begins after
  // enter_j − front) …
  const after: Span = { a: st.a, ao: st.ao, b: Infinity, bo: false };
  let cut: Span | null = null;
  for (let fs = 0; fs < sides.length; fs++) {
    const s = sides[fs]!;
    for (let j = Math.max(0, firstEnterFrom(s, st.a - s.back) - 1); j < s.n; j++) {
      if (cut && s.enter(j) - s.front > (cut as Span).a) break;
      const p = s.freeAt(j);
      if (Number.isNaN(p) || p + freeRadius(s.freeR(j)) < st.a) continue;
      const g = freeOf(sides, fs, j, memo);
      if (!g || !meet(g, after)) continue;
      if (!cut || g.a < cut.a || (g.a === cut.a && !g.ao && cut.ao)) cut = g;
    }
  }
  // … and the union's reach from the start, up to it
  const stop = cut ? (cut as Span).a : Infinity;
  let b = st.b, bo = st.bo;
  for (let grew = true; grew && b < stop;) {
    grew = false;
    for (const s of sides) {
      const k = predEnter(s, b);
      if (k < 0) continue;
      const p = intervalFrom(s, k, b, true);
      if (!p || p.a !== b) continue;
      if (p.b > b || (p.b === b && bo && !p.bo)) { b = p.b; bo = p.bo; grew = true; }
    }
  }
  if (cut) {
    const c: Span = cut;
    // the fragment cuts the piece where it meets it: before the reach's end
    if (c.a < b || (c.a === b && !c.ao && !bo)) { b = c.a; bo = !c.ao; }
  }
  return { start: st.a, startOpen: st.ao, end: b, endOpen: bo, startKind: kind, startSide: side, startIdx: idx };
}

/** Every interval (side, index) that meets the piece — by side, by enter —
 *  and whether it holds the piece's start (its earliest such is the piece's
 *  lead, plan 3.5's "Ursprungszeile"). */
export function pieceIntervals(sides: readonly UnionSide[], p: UnionPiece, each: (side: number, k: number, holdsStart: boolean) => void): void {
  const span: Span = { a: p.start, ao: p.startOpen, b: p.end, bo: p.endOpen };
  for (let si = 0; si < sides.length; si++) {
    const s = sides[si]!;
    for (let k = Math.max(0, predEnter(s, p.start)); k < s.n && s.enter(k) <= p.end; k++) {
      const iv = intervalFrom(s, k, p.start, !p.startOpen);
      if (iv && meet(iv, span)) each(si, k, iv.a === p.start && iv.ao === p.startOpen);
    }
  }
}

/** Every piece of the group, in order. */
export function eachPiece(sides: readonly UnionSide[], each: (p: UnionPiece) => void): void {
  let y = -Infinity, incl = true;
  const memo: FreeMemo = [];
  for (let p = pieceFrom(sides, y, incl, memo); p; p = pieceFrom(sides, y, incl, memo)) {
    each(p);
    y = p.end; incl = p.endOpen;
  }
}

/** The places where the two generations contradict each other on one
 *  geometry: a confirmed point inside a free stretch deeper than the
 *  refinement's tolerance (plan 3.5's conflict is the tolerance case). Kept as
 *  contact all the same; `each` gets the point (own axis). */
export function eachWideConflict(sides: readonly UnionSide[], each: (x: number) => void): void {
  for (let fs = 0; fs < sides.length; fs++) {
    const s = sides[fs]!;
    for (let j = 0; j < s.n; j++) {
      const p = s.freeAt(j);
      if (Number.isNaN(p)) continue;
      const r = freeRadius(s.freeR(j));
      if (!(r > 2 * PROTECT)) continue;
      const f: Span = { a: p - r, ao: true, b: p + r, bo: true };
      for (const t of sides) {
        let k = predEnter(t, f.a);
        if (k < 0) k = 0;
        else if (t.end(k) < f.a) k++;
        for (; k < t.n && t.enter(k) <= f.b; k++) confirmedIn(t, k, f, x => { if (x - f.a > PROTECT && f.b - x > PROTECT) each(x); });
      }
    }
  }
}

/** The search bounds of one generation (`UnionSide.back` / `front`) over a
 *  source's intervals sorted by group and enter. */
export function unionReach(n: number, enter: (k: number) => number, freeAt: (k: number) => number,
                           freeR: (k: number) => number, sameGroup: (k: number, k2: number) => boolean): { back: number; front: number } {
  let back = 0, front = 0;
  for (let k = 0; k < n; k++) {
    const p = freeAt(k);
    if (Number.isNaN(p)) continue;
    const r = freeRadius(freeR(k));
    front = Math.max(front, enter(k) - (p - r));
    if (k + 1 < n && sameGroup(k, k + 1)) back = Math.max(back, p + r - enter(k + 1));
  }
  return { back, front };
}

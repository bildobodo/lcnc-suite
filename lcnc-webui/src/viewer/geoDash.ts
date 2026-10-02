// One geometry-anchored dash for every bound (package 4, operator 2026-10-01:
// the box dashes "ändern beim Zoomen die Länge der Elemente" — one calm
// pattern, the same for every bound; plan docs/reviews/viewer-marks.plan.md,
// Fassungen 2–3.1, Codex R62–R65). Pure: the cell choice with hysteresis, the
// visible parameter interval of a segment, the stable reach chains.
//
// A UNIT (a box edge, a reach chain) is cut into N = 2^k equal cells,
// alternating dark / light, phased at the unit's fixed first end (t = 0) —
// the cells hang on the geometry and grow with it while zooming. N is the
// unit's STATE: it changes only when the mean VISIBLE cell (the visible
// projected length over N · Δt, Δt the visible parameter fraction) leaves
// 6 / 1.25 … 12 · 1.25 CSS px, then to the power of two that puts it in
// 6 … 12. Promise (Fassung 3.1): a visible piece LONGER than 15 CSS px, N
// below its cap, holds an inner cell boundary — both tones have positive
// parameter length there. No pixel or legibility guarantee: perspective
// squeezes single cells, a chain's other pieces may be over-refined.

export const GEO_CELL_MIN_PX = 6;
export const GEO_CELL_MAX_PX = 12;
export const GEO_HYSTERESIS = 1.25;
/** Both tones on every visible unit (R45 VP-I12's lost tone stays closed). */
export const GEO_CELLS_MIN = 2;
/** Named limit (Fassung 3): beyond it the 15 px promise no longer holds. */
export const GEO_CELLS_MAX = 2 ** 14;

/** The cell count for a unit whose visible part spans `pxPerUnit` CSS px per
 *  unit of its parameter (the governing piece's L_visible / Δt), keeping
 *  `prev` while its mean cell stays inside the hysteresis band. An invisible
 *  unit (pxPerUnit not > 0) keeps `prev`. */
export function chooseCells(pxPerUnit: number, prev: number): number {
  const lo = GEO_CELL_MIN_PX / GEO_HYSTERESIS, hi = GEO_CELL_MAX_PX * GEO_HYSTERESIS;
  const valid = prev >= GEO_CELLS_MIN && prev <= GEO_CELLS_MAX;
  if (!(pxPerUnit > 0) || !Number.isFinite(pxPerUnit)) return valid ? prev : GEO_CELLS_MIN;
  if (valid) {
    const mean = pxPerUnit / prev;
    // at the floor N cannot halve, at the cap it cannot double: a mean
    // outside the band there is the band's end, not a reason to move
    if ((mean >= lo || prev === GEO_CELLS_MIN) && (mean <= hi || prev === GEO_CELLS_MAX)) return prev;
  }
  // the smallest power of two with mean ≤ 12 puts it in (6, 12]
  const want = Math.ceil(Math.log2(pxPerUnit / GEO_CELL_MAX_PX) - 1e-9);
  return Math.min(GEO_CELLS_MAX, Math.max(GEO_CELLS_MIN, 2 ** Math.max(0, want)));
}

/** The visible parameter interval [s0, s1] ⊆ [0, 1] of the segment from clip
 *  coordinates `a` to `b` (x, y, z, w — linear in the segment's world
 *  parameter), clipped against all six planes of the WebGL view volume
 *  (−w ≤ x, y, z ≤ w); null when nothing is visible. Liang–Barsky. */
export function clipParam(a: ArrayLike<number>, b: ArrayLike<number>, out: { [i: number]: number }): boolean {
  let s0 = 0, s1 = 1;
  // each plane: f(s) = p0 + s (p1 − p0) ≥ 0
  for (let i = 0; i < 6; i++) {
    const axis = i >> 1, sign = i & 1 ? -1 : 1;
    const p0 = a[3]! + sign * a[axis]!, p1 = b[3]! + sign * b[axis]!;
    if (p0 < 0 && p1 < 0) return false;
    if (p0 < 0) s0 = Math.max(s0, p0 / (p0 - p1));
    else if (p1 < 0) s1 = Math.min(s1, p0 / (p0 - p1));
  }
  if (s1 <= s0) return false;
  out[0] = s0; out[1] = s1;
  return true;
}

/** A reach soup's segments as CHAINS with a stable identity (Fassung 3,
 *  R63): segments meeting end to end at a vertex shared by exactly two; a
 *  junction (≥ 3) or an open end ends a chain. An open chain starts at its
 *  lexicographically smaller end (x, then y, then z), a ring at its
 *  lexicographically smallest vertex, running towards the smaller of its two
 *  neighbours; a chain with BOTH ends at one junction runs the way whose
 *  walk is the smaller vertex by vertex (R66 VP-I27) — independent of the
 *  storage order. Per segment: its chain,
 *  and the chain parameters t of its first and second STORED end (the
 *  chain's world length normalised to 0 … 1). `order` lists each chain's
 *  segments from its start. */
export interface Chains {
  chainOf: Int32Array;
  t: Float32Array;          // 2 per segment: t at stored end 0, t at stored end 1
  starts: Int32Array;       // chain c's segments are order[starts[c] … starts[c + 1])
  order: Int32Array;
  count: number;
}

export function buildChains(positions: ArrayLike<number>): Chains {
  const n = Math.floor(positions.length / 6);
  const P = (s: number, e: number, k: number) => positions[s * 6 + e * 3 + k]!;
  const key = (s: number, e: number) => `${P(s, e, 0)},${P(s, e, 1)},${P(s, e, 2)}`;
  const at = new Map<string, number[]>();
  for (let s = 0; s < n; s++) for (let e = 0; e < 2; e++) {
    const k = key(s, e); const l = at.get(k);
    if (l) l.push(s * 2 + e); else at.set(k, [s * 2 + e]);
  }
  const deg = (s: number, e: number) => at.get(key(s, e))!.length;
  const lexLess = (s: number, e: number, s2: number, e2: number) => {
    for (let k = 0; k < 3; k++) { const d = P(s, e, k) - P(s2, e2, k); if (d) return d < 0; }
    return false;
  };
  /** The other segment end at `s`'s end `e` when the vertex joins exactly two. */
  const next = (s: number, e: number) => {
    const l = at.get(key(s, e))!;
    if (l.length !== 2) return -1;
    return l[0] === s * 2 + e ? l[1]! : l[0]!;
  };
  /** Walks from segment end (s, e) and (s2, e2) — positions after the start
   *  vertex compared one by one, lexicographically: which walk is the smaller
   *  GEOMETRICALLY. Ties between two starts at one position (a contour that
   *  returns to its junction has both ends there) are decided by the shape
   *  of the walk, never by the storage index (Codex R66 VP-I27). Walks that
   *  are equal all along draw the same picture either way. */
  const walkCmp = (s: number, e: number, s2: number, e2: number) => {
    let a = s, ae = e, b = s2, be = e2;
    for (let steps = 0; steps < n; steps++) {
      if (lexLess(a, 1 - ae, b, 1 - be)) return -1;
      if (lexLess(b, 1 - be, a, 1 - ae)) return 1;
      const na = next(a, 1 - ae), nb = next(b, 1 - be);
      if (na < 0 || nb < 0 || na >> 1 === s || nb >> 1 === s2) return 0;
      a = na >> 1; ae = na & 1; b = nb >> 1; be = nb & 1;
    }
    return 0;
  };
  const chainOf = new Int32Array(n).fill(-1);
  const t = new Float32Array(2 * n);
  const order: number[] = [], starts: number[] = [];
  const walk = (s: number, eIn: number) => {
    // from segment s entered at its end eIn: collect until an end or back
    const segs: number[] = [], ins: number[] = [];
    let cs = s, ce = eIn;
    for (let steps = 0; steps < n; steps++) {
      if (chainOf[cs] !== -1) break;
      chainOf[cs] = starts.length;
      segs.push(cs); ins.push(ce);
      const o = next(cs, 1 - ce);
      if (o < 0) break;
      cs = o >> 1; ce = o & 1;
    }
    let total = 0;
    const len = (q: number) => Math.hypot(P(q, 1, 0) - P(q, 0, 0), P(q, 1, 1) - P(q, 0, 1), P(q, 1, 2) - P(q, 0, 2));
    for (const q of segs) total += len(q);
    let acc = 0;
    starts.push(order.length);
    segs.forEach((q, i) => {
      const l = len(q), e = ins[i]!;
      const a = total > 0 ? acc / total : 0, b = total > 0 ? (acc + l) / total : 1;
      t[q * 2 + e] = a; t[q * 2 + (1 - e)] = b;
      acc += l;
      order.push(q);
    });
  };
  // open chains: every open end (degree ≠ 2); start at the smaller of a chain's two ends
  const ends: [number, number][] = [];
  for (let s = 0; s < n; s++) for (let e = 0; e < 2; e++) if (deg(s, e) !== 2) ends.push([s, e]);
  ends.sort((x, y) => (lexLess(x[0], x[1], y[0], y[1]) ? -1 : lexLess(y[0], y[1], x[0], x[1]) ? 1
    : walkCmp(x[0], x[1], y[0], y[1]) || x[0] - y[0] || x[1] - y[1]));
  for (const [s, e] of ends) if (chainOf[s] === -1) walk(s, e);
  // rings: whatever is left, each from its smallest vertex towards the smaller neighbour
  for (;;) {
    let best = -1, bestE = 0;
    for (let s = 0; s < n; s++) if (chainOf[s] === -1) for (let e = 0; e < 2; e++) {
      if (best < 0 || lexLess(s, e, best, bestE)) { best = s; bestE = e; }
    }
    if (best < 0) break;
    // the two segments at that vertex: leave along the one whose far end is smaller
    const l = at.get(key(best, bestE))!.filter(x => chainOf[x >> 1] === -1);
    let pick = l[0]!;
    for (const x of l) if (walkCmp(x >> 1, x & 1, pick >> 1, pick & 1) < 0) pick = x;
    walk(pick >> 1, pick & 1);
  }
  starts.push(order.length);
  return { chainOf, t, starts: Int32Array.from(starts), order: Int32Array.from(order), count: starts.length - 1 };
}

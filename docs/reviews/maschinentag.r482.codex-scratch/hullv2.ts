// P6-c2 probe helper (NOT product code; copied into lcnc-webui/src/viewer/
// for a run, removed after): the CLOSED stepped hull of a drawn tool, its
// mutants, and the guard's own measurements of a built mesh.
//
// The hull (Codex R461 F8-2, plan v3 Rule C2 "stepped hull"):
//  * z range [min(0, zmin), max(L+20, zmax)] of EVERY drawn triangle;
//  * K = min(32, ceil(len / 5 mm)) equal slabs (the slab grows past 5 mm only
//    when len > 160 mm); boundaries are f32 values, the outer two rounded
//    OUTWARD, so clip and mesh use the same numbers;
//  * per slab the largest distance from the axis of the drawn triangles
//    CLIPPED to the slab (the distance to the axis is convex, so its maximum
//    on a clipped polygon is at one of its vertices: an original vertex in
//    the slab or a crossing of an edge with a slab boundary);
//  * united with today's body: its BUILT triangles (toolCylinderPositions(D,
//    L+20), whose bottom lies at about -1e-15, not at 0) join the input, so
//    the union is measured like every drawn branch;
//  * a slab with no drawn geometry and outside [0, L+20] (only a native mesh
//    with axial holes) is BRIDGED at D/2 — counted, never silent;
//  * each radius CIRCUMSCRIBED (n-gon circumradius r / cos(π/n), times
//    1 + 2^-20 so the f32 vertices never fall inside r);
//  * ONE closed solid: caps as fans, side walls, the steps as annuli, equal
//    neighbouring radii merged; every edge shared by exactly two facets in
//    opposite directions (insideCheck.meshClosure decides it in the model).
import { buildToolGeometries, type ToolMeta } from "/tmp/r482/tree/lcnc-webui/src/toolGeometry";
import { toolCylinderPositions } from "/tmp/r482/tree/lcnc-webui/src/viewer/collision";

export const visLen = (L: number) => Math.max(40, L + 20);

/** The drawn marker's own geometry (buildToolGeometries: native mesh, native
 *  profile, parametric) as one triangle soup, tip frame, +Z. */
export function drawnSoup(D: number, len: number, meta: ToolMeta | null, unitsPerMm = 1): Float32Array {
  const { cutter, shaft } = buildToolGeometries(D, len, meta, unitsPerMm);
  const parts: Float32Array[] = [];
  for (const g of [cutter, shaft]) {
    if (!g) continue;
    const n = g.index ? g.toNonIndexed() : g;
    parts.push(new Float32Array(n.getAttribute("position").array as Float32Array));
    if (n !== g) n.dispose();
    g.dispose();
  }
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---- f32 outward rounding ----
const fb = new ArrayBuffer(4), fv = new Float32Array(fb), iv = new Int32Array(fb);
function f32Step(x: number, dir: 1 | -1): number {
  fv[0] = x;
  if (fv[0] === 0) { iv[0] = dir > 0 ? 1 : (0x80000001 | 0); return fv[0]!; }
  iv[0] = iv[0]! + ((fv[0]! > 0) === (dir > 0) ? 1 : -1);
  return fv[0]!;
}
export const f32Up = (x: number) => { const f = Math.fround(x); return f >= x ? f : f32Step(f, 1); };
export const f32Down = (x: number) => { const f = Math.fround(x); return f <= x ? f : f32Step(f, -1); };

type P3 = [number, number, number];
/** Sutherland–Hodgman against ONE plane z = zc (closed half-space). */
function clipZ(poly: P3[], zc: number, keepAbove: boolean): P3[] {
  const out: P3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!, q = poly[(i + 1) % poly.length]!;
    const pin = keepAbove ? p[2] >= zc : p[2] <= zc;
    const qin = keepAbove ? q[2] >= zc : q[2] <= zc;
    if (pin) out.push(p);
    if (pin !== qin) {
      const u = (zc - p[2]) / (q[2] - p[2]);
      out.push([p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1]), zc]);
    }
  }
  return out;
}
/** The triangle t of a soup clipped to [a, b]: its polygon (maybe empty). */
export function clipTri(soup: Float32Array, t: number, a: number, b: number): P3[] {
  const o = t * 9;
  let poly: P3[] = [[soup[o]!, soup[o + 1]!, soup[o + 2]!], [soup[o + 3]!, soup[o + 4]!, soup[o + 5]!],
                    [soup[o + 6]!, soup[o + 7]!, soup[o + 8]!]];
  poly = clipZ(poly, a, true);
  if (poly.length) poly = clipZ(poly, b, false);
  return poly;
}

export interface HullMut {
  /** mutant: only ORIGINAL vertices inside the slab (no crossings) */
  verticesOnly?: boolean;
  /** mutant: the n-gon's circumradius = r (inscribed; apothem r·cos(π/n)) */
  inscribed?: boolean;
  /** mutant: no union with today's body (D/2 over [0, L+20]) */
  noPinUnion?: boolean;
  /** mutant: the range starts at 0 (a drawn part below the tip lost) */
  zFromZero?: boolean;
  /** mutant: the range ends at L+20 (a drawn part above it lost) */
  zToVisLen?: boolean;
}
export interface Hull {
  pos: Float32Array; b: Float32Array; r: Float64Array; rho: Float32Array; K: number; h: number;
  z0: number; z1: number; bridged: number[]; tris: number; profilePts: number; buildMs: number; n: number;
}

/** The input the hull must contain: the drawn soup and today's body. */
export function hullInput(drawn: Float32Array, D: number, L: number, withPin = true): Float32Array {
  if (!withPin) return drawn;
  const pin = toolCylinderPositions(D, visLen(L));
  const all = new Float32Array(drawn.length + pin.length);
  all.set(drawn, 0); all.set(pin, drawn.length);
  return all;
}

export function closedHull(drawn: Float32Array, D: number, L: number,
                           o: { slabMm?: number; maxSlabs?: number; n?: number; unitsPerMm?: number; mut?: HullMut;
                                /** the slab COUNT ignores this much of the range (the built pin's f32 µm); the range itself stays whole */
                                snapMm?: number } = {}): Hull {
  const t0 = performance.now();
  const n = o.n ?? 20, u = o.unitsPerMm ?? 1, mut = o.mut ?? {};
  const vl = visLen(L);
  const soup = hullInput(drawn, D, L, !mut.noPinUnion);
  let zmin = Infinity, zmax = -Infinity;
  for (let i = 2; i < soup.length; i += 3) { zmin = Math.min(zmin, soup[i]!); zmax = Math.max(zmax, soup[i]!); }
  if (!(zmin <= zmax)) { zmin = 0; zmax = vl; }
  const z0 = mut.zFromZero ? 0 : Math.min(0, zmin);
  const z1 = mut.zToVisLen ? vl : Math.max(vl, zmax);
  const slab = (o.slabMm ?? 5) * u;
  const K = Math.max(1, Math.min(o.maxSlabs ?? 32, Math.ceil((z1 - z0 - (o.snapMm ?? 0) * u) / slab - 1e-9)));
  const h = (z1 - z0) / K;
  const b = new Float32Array(K + 1);
  b[0] = f32Down(z0); b[K] = f32Up(z1);
  for (let k = 1; k < K; k++) b[k] = Math.fround(z0 + k * h);
  const r = new Float64Array(K);
  const nTri = Math.floor(soup.length / 9);
  for (let t = 0; t < nTri; t++) {
    const p = t * 9;
    const za = Math.min(soup[p + 2]!, soup[p + 5]!, soup[p + 8]!), zb = Math.max(soup[p + 2]!, soup[p + 5]!, soup[p + 8]!);
    // the slabs whose CLOSED interval the triangle's z range meets
    let k0 = 0, lo = 0, hi = K;
    while (lo < hi) { const m = (lo + hi) >> 1; if (b[m + 1]! < za) lo = m + 1; else hi = m; }
    k0 = lo;
    for (let k = k0; k < K && b[k]! <= zb; k++) {
      let rad = 0;
      if (mut.verticesOnly) {
        for (let j = 0; j < 3; j++) {
          const z = soup[p + 3 * j + 2]!;
          if (z >= b[k]! && z <= b[k + 1]!) rad = Math.max(rad, Math.hypot(soup[p + 3 * j]!, soup[p + 3 * j + 1]!));
        }
      } else {
        for (const q of clipTri(soup, t, b[k]!, b[k + 1]!)) rad = Math.max(rad, Math.hypot(q[0], q[1]));
      }
      if (rad > r[k]!) r[k] = rad;
    }
  }
  const bridged: number[] = [];
  for (let k = 0; k < K; k++) {
    if (!(r[k]! > 0)) { r[k] = D / 2 > 0 ? D / 2 : 1e-3 * u; bridged.push(k); }
  }
  const circ = mut.inscribed ? 1 : 1 / Math.cos(Math.PI / n);
  const rho = new Float32Array(K);
  for (let k = 0; k < K; k++) rho[k] = f32Up(r[k]! * circ * (1 + 2 ** -20));
  // the profile (radius, z) bottom axis → top axis, equal neighbours merged
  const prof: Array<[number, number]> = [[0, b[0]!], [rho[0]!, b[0]!]];
  for (let k = 0; k < K; k++) {
    if (k + 1 < K && rho[k + 1] === rho[k]) continue;
    prof.push([rho[k]!, b[k + 1]!]);
    if (k + 1 < K) prof.push([rho[k + 1]!, b[k + 1]!]);
  }
  prof.push([0, b[K]!]);
  const cs = new Float64Array(n), sn = new Float64Array(n);
  for (let j = 0; j < n; j++) { cs[j] = Math.cos(2 * Math.PI * j / n); sn[j] = Math.sin(2 * Math.PI * j / n); }
  const out: number[] = [];
  const V = (rr: number, z: number, j: number): P3 => rr === 0 ? [0, 0, z] : [Math.fround(rr * cs[j % n]!), Math.fround(rr * sn[j % n]!), z];
  for (let i = 0; i + 1 < prof.length; i++) {
    const [ra, za] = prof[i]!, [rb, zb] = prof[i + 1]!;
    if (ra === rb && za === zb) continue;
    for (let j = 0; j < n; j++) {
      const A0 = V(ra, za, j), A1 = V(ra, za, j + 1), B0 = V(rb, zb, j), B1 = V(rb, zb, j + 1);
      if (ra > 0) out.push(...A0, ...A1, ...B1);
      if (rb > 0) out.push(...A0, ...B1, ...B0);
    }
  }
  const pos = new Float32Array(out);
  return { pos, b, r, rho, K, h, z0, z1, bridged, tris: pos.length / 9, profilePts: prof.length,
           buildMs: performance.now() - t0, n };
}

/** The v1 probe's construction (separate stacked cylinders, NOT closed) at
 *  the same slabs — for the closed-vs-stacked comparison only. */
export function stackedOf(hh: Hull, toolCylinderPositions: (d: number, l: number, s?: number) => Float32Array): Float32Array {
  const parts: Float32Array[] = [];
  for (let k = 0; k < hh.K; k++) {
    const hk = hh.b[k + 1]! - hh.b[k]!;
    const p = toolCylinderPositions(2 * hh.rho[k]!, hk, hh.n);
    for (let i = 2; i < p.length; i += 3) p[i] += hh.b[k]!;
    parts.push(p);
  }
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---- the guard's OWN measurements (independent of closedHull's arrays) ----

/** The mesh's cross-section at z = zc: the segments where facets cross the
 *  plane; the APOTHEM = the least distance from the axis to a segment's line,
 *  and whether the axis lies inside (every segment turns the same way). */
export function crossSection(pos: Float32Array, zc: number) {
  let apothem = Infinity, nSeg = 0, pos_ = 0, neg = 0;
  let worst: { a: [number, number]; b: [number, number] } | null = null;
  for (let t = 0; t < pos.length; t += 9) {
    const pts: Array<[number, number]> = [];
    for (let j = 0; j < 3; j++) {
      const p = [pos[t + 3 * j]!, pos[t + 3 * j + 1]!, pos[t + 3 * j + 2]!];
      const q = [pos[t + 3 * ((j + 1) % 3)]!, pos[t + 3 * ((j + 1) % 3) + 1]!, pos[t + 3 * ((j + 1) % 3) + 2]!];
      if ((p[2]! - zc) * (q[2]! - zc) < 0) {
        const u = (zc - p[2]!) / (q[2]! - p[2]!);
        pts.push([p[0]! + u * (q[0]! - p[0]!), p[1]! + u * (q[1]! - p[1]!)]);
      }
    }
    if (pts.length !== 2) continue;
    const [a, c] = pts as [[number, number], [number, number]];
    const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-12) continue;
    nSeg++;
    const cr = a[0] * dy - a[1] * dx;        // the axis relative to the segment's line
    if (cr > 0) pos_++; else if (cr < 0) neg++;
    const d = Math.abs(cr) / L;
    if (d < apothem) { apothem = d; worst = { a, b: c }; }
  }
  return { apothem, nSeg, axisInside: nSeg > 0 && (pos_ === 0 || neg === 0), worst };
}

/** The required radius per slab from the drawn soup, computed by the guard:
 *  every clipped polygon vertex of every triangle meeting the slab. */
export function requiredRadii(soup: Float32Array, b: Float32Array) {
  const K = b.length - 1, r = new Float64Array(K), pts: P3[][] = Array.from({ length: K }, () => []);
  for (let t = 0; t < soup.length / 9; t++) {
    for (let k = 0; k < K; k++) {
      const poly = clipTri(soup, t, b[k]!, b[k + 1]!);
      for (const q of poly) { const d = Math.hypot(q[0], q[1]); if (d > r[k]!) r[k] = d; pts[k]!.push(q); }
    }
  }
  return { r, pts };
}

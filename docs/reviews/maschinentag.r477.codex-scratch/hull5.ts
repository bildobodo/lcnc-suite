// P6-c5 scratch (no product code): the v5 hull builder in COUNTED steps, from
// the mesh's own nested arrays (no flatten, no geometry) or from a profile.
import { toolCylinderPositions } from "/home/cnc/lcnc-suite-p6c/lcnc-webui/src/viewer/collision";
export type Steps<T> = Generator<void, T, void>;
export interface HullNumbers { n: number; z: Float32Array; rho: Float32Array }
const fb = new ArrayBuffer(4), fv = new Float32Array(fb), iv = new Int32Array(fb);
function f32Step(x: number, dir: 1 | -1): number {
  fv[0] = x;
  if (fv[0] === 0) { iv[0] = dir > 0 ? 1 : (0x80000001 | 0); return fv[0]!; }
  iv[0] = iv[0]! + ((fv[0]! > 0) === (dir > 0) ? 1 : -1);
  return fv[0]!;
}
export let MUT = "";
export const setMut = (m: string) => { MUT = m; };
export const f32Up = (x: number) => { const f = Math.fround(x); return f >= x ? f : f32Step(f, 1); };
export const f32Down = (x: number) => { const f = Math.fround(x); return f <= x ? f : f32Step(f, -1); };

export interface Counter { n: number; total: number; steps: number }
export const counter = (): Counter => ({ n: 0, total: 0, steps: 0 });
export interface HullOpts { slab: number; maxSlabs: number; snap: number; n: number; budget: number; mut?: string }

/** The slab boundaries: K equal slabs, outer ones rounded outward. */
export function boundaries(z0: number, z1: number, o: HullOpts): Float32Array {
  const K = Math.max(1, Math.min(o.maxSlabs, Math.ceil((z1 - z0 - o.snap) / o.slab - 1e-9)));
  if (MUT === "snapCuts") z1 -= o.snap;          // mutant: the 1 µm cut off the range itself
  if (MUT === "zFromZero") z0 = 0;
  const b = new Float32Array(K + 1);
  if (MUT === "endsNearest") { b[0] = z0; b[K] = z1; } else
  { b[0] = f32Down(z0); b[K] = f32Up(z1); }
  for (let k = 1; k < K; k++) b[k] = Math.fround(z0 + (z1 - z0) * k / K);
  return b;
}
/** Where a value lies: the lowest slab whose closed interval reaches z (log2 K ≤ 5 ops). */
function lowSlab(b: Float32Array, z: number): number {
  let lo = 0, hi = b.length - 2;
  while (lo < hi) { const m = (lo + hi) >> 1; if (b[m + 1]! < z) lo = m + 1; else hi = m; }
  return lo;
}
/** One edge p→q into r2 (squared radii per slab): its ends in their slabs and
 *  its crossing of every boundary strictly between them, counted. */
function edge(b: Float32Array, r2: Float64Array, px: number, py: number, pz: number, qx: number, qy: number, qz: number, c: Counter): void {
  if (pz > qz) { let t = px; px = qx; qx = t; t = py; py = qy; qy = t; t = pz; pz = qz; qz = t; }
  const K = b.length - 1;
  let k = lowSlab(b, pz);
  // the lower end: its slab, and the one above when it stands on the boundary
  const rp = px * px + py * py;
  if (MUT === "boundaryLow" && k + 1 < K && pz >= b[k + 1]!) { /* mutant: the upper slab only */ } else
  if (rp > r2[k]!) r2[k] = rp;
  const ck = k;
  if (k + 1 < K && pz >= b[k + 1]! && rp > r2[k + 1]!) r2[k + 1] = rp;
  for (let j = k + 1; j < K && b[j]! <= qz; j++) {
    if (MUT !== "verticesOnly" && b[j]! >= pz && qz > pz) {
      const u = (b[j]! - pz) / (qz - pz), x = px + u * (qx - px), y = py + u * (qy - py), r = x * x + y * y;
      if (MUT !== "oneSide" && r > r2[j - 1]!) r2[j - 1] = r;
      if (r > r2[j]!) r2[j] = r;
    }
    k = j;
  }
  // the upper end
  const rq = qx * qx + qy * qy;
  if (rq > r2[k]!) r2[k] = rq;
  if (k > 0 && qz <= b[k]! && rq > r2[k - 1]!) r2[k - 1] = rq;
  c.n += 8 + (k - ck);
}

export interface MeshIn { vertices: ArrayLike<number>[]; triangles: ArrayLike<number>[] }
/** The hull's numbers from an indexed mesh ∪ today's pin, in counted steps.
 *  Throws on a coordinate that is not finite or an index out of range. */
export function* meshHullSteps(m: MeshIn, D: number, visLen: number, o: HullOpts, c: Counter): Steps<HullNumbers> {
  let zmin = 0, zmax = MUT === "noPin" ? 0 : visLen;
  const V = m.vertices, nV = V.length;
  for (let i = 0; i < nV; i++) {
    const v = V[i]!, z = v[2]!;
    if (!(Number.isFinite(v[0]!) && Number.isFinite(v[1]!) && Number.isFinite(z))) throw new Error("coordinate not finite");
    if (z < zmin) zmin = z; else if (z > zmax) zmax = z;
    if ((c.n += 3) >= o.budget) { c.total += c.n; c.n = 0; c.steps++; yield; }
  }
  const pin = MUT === "noPin" ? new Float32Array(0) : toolCylinderPositions(D, visLen);
  for (let i = 2; i < pin.length; i += 3) { zmin = Math.min(zmin, pin[i]!); zmax = Math.max(zmax, pin[i]!); }
  const b = boundaries(zmin, zmax, o), K = b.length - 1, r2 = new Float64Array(K);
  for (let t = 0; t + 8 < pin.length; t += 9) {
    for (const [i, j] of [[0, 3], [3, 6], [6, 0]] as const) edge(b, r2, pin[t + i]!, pin[t + i + 1]!, pin[t + i + 2]!, pin[t + j]!, pin[t + j + 1]!, pin[t + j + 2]!, c);
  }
  const T = m.triangles, nT = T.length;
  for (let t = 0; t < nT; t++) {
    const tr = T[t]!, A = V[tr[0]!], B = V[tr[1]!], C = V[tr[2]!];
    if (!A || !B || !C) throw new Error("index out of range");
    edge(b, r2, A[0]!, A[1]!, A[2]!, B[0]!, B[1]!, B[2]!, c);
    edge(b, r2, B[0]!, B[1]!, B[2]!, C[0]!, C[1]!, C[2]!, c);
    edge(b, r2, C[0]!, C[1]!, C[2]!, A[0]!, A[1]!, A[2]!, c);
    if (c.n >= o.budget) { c.total += c.n; c.n = 0; c.steps++; yield; }
  }
  return numbers(b, r2, D, o);
}
/** …from a profile (radius, z) polyline(s): the revolved body's radius is the
 *  polyline's; the lathe's facets lie inside it. */
export function* profileHullSteps(parts: Array<ArrayLike<{ x: number; y: number }>>, D: number, visLen: number, o: HullOpts, c: Counter): Steps<HullNumbers> {
  let zmin = 0, zmax = MUT === "noPin" ? 0 : visLen;
  for (const pts of parts) for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    if (!(Number.isFinite(p.x) && Number.isFinite(p.y))) throw new Error("coordinate not finite");
    const f = Math.fround(p.y);
    if (f < zmin) zmin = f; if (f > zmax) zmax = f;
    if (p.y < zmin) zmin = p.y; if (p.y > zmax) zmax = p.y;
    if ((c.n += 4) >= o.budget) { c.total += c.n; c.n = 0; c.steps++; yield; }
  }
  const pin = MUT === "noPin" ? new Float32Array(0) : toolCylinderPositions(D, visLen);
  for (let i = 2; i < pin.length; i += 3) { zmin = Math.min(zmin, pin[i]!); zmax = Math.max(zmax, pin[i]!); }
  // the lathe is rotated upright: its z carries r·6e-17 — the range alone is widened
  if (MUT !== "noPad") { const pad = 1e-9 * (Math.abs(zmin) + Math.abs(zmax)); zmin -= pad; zmax += pad; }
  const b = boundaries(zmin, zmax, o), K = b.length - 1, r2 = new Float64Array(K);
  for (let t = 0; t + 8 < pin.length; t += 9) {
    for (const [i, j] of [[0, 3], [3, 6], [6, 0]] as const) edge(b, r2, pin[t + i]!, pin[t + i + 1]!, pin[t + i + 2]!, pin[t + j]!, pin[t + j + 1]!, pin[t + j + 2]!, c);
  }
  for (const pts of parts) for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i]!, q = pts[i + 1]!;
    edge(b, r2, p.x, 0, p.y, q.x, 0, q.y, c);
    if (c.n >= o.budget) { c.total += c.n; c.n = 0; c.steps++; yield; }
  }
  return numbers(b, r2, D, o);
}
function numbers(b: Float32Array, r2: Float64Array, D: number, o: HullOpts): HullNumbers {
  const K = r2.length, circ = MUT === "inscribed" ? 1 : (1 / Math.cos(Math.PI / o.n)) * (MUT === "noInflate" ? 1 : 1 + 2 ** -20);
  // equal neighbours merged: the boundary between them goes
  const z: number[] = [b[0]!], rho: number[] = [];
  for (let k = 0; k < K; k++) {
    const r = (MUT === "rhoDown" ? f32Down : f32Up)((r2[k]! > 0 ? Math.sqrt(r2[k]!) : D / 2) * circ);
    if (MUT === "mergeNear" && rho.length && Math.abs(rho[rho.length - 1]! - r) < 0.05 * r) { z[z.length - 1] = b[k + 1]!; continue; }
    if (rho.length && rho[rho.length - 1] === r) { z[z.length - 1] = b[k + 1]!; continue; }
    rho.push(r); z.push(b[k + 1]!);
  }
  return { n: o.n, z: Float32Array.from(z), rho: Float32Array.from(rho) };
}
/** The worker's half: the closed triangle soup from the numbers alone. */
export function hullPositions(h: HullNumbers): Float32Array {
  const { n, z, rho } = h, M = rho.length;
  const prof: Array<[number, number]> = [[0, z[0]!]];
  for (let k = 0; k < M; k++) prof.push([rho[k]!, z[k]!], [rho[k]!, z[k + 1]!]);
  prof.push([0, z[M]!]);
  const out: number[] = [];
  const V = (r: number, zz: number, j: number) => r === 0 ? [0, 0, zz] : [Math.fround(r * Math.cos(2 * Math.PI * (j % n) / n)), Math.fround(r * Math.sin(2 * Math.PI * (j % n) / n)), zz];
  for (let i = 0; i + 1 < prof.length; i++) {
    const [ra, za] = prof[i]!, [rb, zb] = prof[i + 1]!;
    if (ra === rb && za === zb) continue;
    for (let j = 0; j < n; j++) {
      const A0 = V(ra, za, j), A1 = V(ra, za, j + 1), B0 = V(rb, zb, j), B1 = V(rb, zb, j + 1);
      if (ra > 0) out.push(...A0, ...A1, ...B1);
      if (rb > 0) out.push(...A0, ...B1, ...B0);
    }
  }
  return new Float32Array(out);
}
export function runAll<T>(g: Steps<T>): T { for (;;) { const r = g.next(); if (r.done) return r.value; } }
export const OPTS = (u = 1): HullOpts => ({ slab: 5 * u, maxSlabs: 32, snap: 0.001 * u, n: 20, budget: 4096 });

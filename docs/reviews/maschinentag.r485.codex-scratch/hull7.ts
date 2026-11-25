// P6-c6 scratch (no product code): ONE canonical float32 source for the drawing
// AND the body (Codex R477 MT477-01). No pad, no tolerance.
import * as THREE from "three";
import { toolCylinderPositions } from "/tmp/r485/tree/lcnc-webui/src/viewer/collision";
import { buildToolParts, buildToolProfile, type ToolMeta } from "/tmp/r485/tree/lcnc-webui/src/toolGeometry";
export type Steps<T> = Generator<void, T, void>;
export interface Counter { n: number; total: number; steps: number; max: number }
export const counter = (): Counter => ({ n: 0, total: 0, steps: 0, max: 0 });
export interface HullNumbers { n: number; z: Float32Array; rho: Float32Array }
export interface HullOpts { slab: number; maxSlabs: number; snap: number; n: number; budget: number }
export const OPTS6 = (u = 1): HullOpts => ({ slab: 5 * u, maxSlabs: 32, snap: 0.001 * u, n: 20, budget: 4096 });
export let MUT = ""; export const setMut6 = (m: string) => { MUT = m; };
const tick = (c: Counter, o: { budget: number }): boolean => { if (c.n < o.budget) return false; c.total += c.n; if (c.n > c.max) c.max = c.n; c.n = 0; c.steps++; return true; };

const fb = new ArrayBuffer(4), fv = new Float32Array(fb), iv = new Int32Array(fb);
export const ulpUp = (x: number): number => { fv[0] = x; if (fv[0] === 0) return 1.401298464324817e-45; iv[0] = iv[0]! + (fv[0]! > 0 ? 1 : -1); return fv[0]!; };
const f32Up = (x: number) => { const f = Math.fround(x); return f >= x ? f : ulpUp(f); };

// ---- canonical sources (what is drawn, exactly) ----
export interface CanonMesh { pos: Float32Array; idx: Uint32Array }
/** nested → typed, every coordinate rounded ONCE; refuses what f32 cannot hold */
export function* canonMeshSteps(m: { vertices: ArrayLike<number>[]; triangles: ArrayLike<number>[] }, o: { budget: number }, c: Counter): Steps<CanonMesh> {
  const V = m.vertices, T = m.triangles, nV = V.length, nT = T.length;
  const pos = new Float32Array(nV * 3), idx = new Uint32Array(nT * 3);
  for (let i = 0; i < nV; i++) {
    const v = V[i]!;
    for (let j = 0; j < 3; j++) { const x = Math.fround(v[j]!); if (!Number.isFinite(x)) throw new Error("shape not usable: coordinate"); pos[3 * i + j] = x; }
    c.n += 4; if (tick(c, o)) yield;
  }
  for (let t = 0; t < nT; t++) {
    const r = T[t]!;
    for (let j = 0; j < 3; j++) { const k = r[j]!; if (!(Number.isInteger(k) && k >= 0 && k < nV)) throw new Error("shape not usable: index"); idx[3 * t + j] = k; }
    c.n += 4; if (tick(c, o)) yield;
  }
  return { pos, idx };
}
/** [r, z] pairs in f32 */
export function canonProfile(pts: ArrayLike<{ x: number; y: number }>): Float32Array {
  const out = new Float32Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) { const r = Math.fround(pts[i]!.x), z = Math.fround(pts[i]!.y); if (!(Number.isFinite(r) && Number.isFinite(z) && r >= 0)) throw new Error("shape not usable: profile"); out[2 * i] = r; out[2 * i + 1] = z; }
  return out;
}
export type Drawing = { kind: "mesh"; mesh: CanonMesh } | { kind: "lathe"; parts: Array<{ prof: Float32Array; segments: number }> };
export function* drawingSteps(D: number, vl: number, meta: ToolMeta | null, u: number, o: { budget: number }, c: Counter): Steps<Drawing> {
  if (meta?.native_mesh) return { kind: "mesh", mesh: yield* canonMeshSteps(meta.native_mesh as any, o, c) };
  if (meta?.native_profile?.length) {
    const radius = Math.max(...meta.native_profile.map(p => p[0])), step = 2 * Math.acos(Math.max(-1, 1 - .01 * u / radius));
    return { kind: "lathe", parts: [{ prof: canonProfile(buildToolProfile(D, vl, meta, u).pts), segments: Math.min(512, Math.max(48, Math.ceil(2 * Math.PI / step))) }] };
  }
  const p = buildToolParts(D, vl, meta, u);
  return { kind: "lathe", parts: [p.cutter, p.shaft].filter(x => x.length >= 3).map(x => ({ prof: canonProfile(x), segments: 24 })) };
}
/** The quarter turn, EXACT: (x, y, z) → (x, −z, y). Positions and normals. */
export function quarterTurn(a: Float32Array): void { for (let i = 0; i < a.length; i += 3) { const y = a[i + 1]!, z = a[i + 2]!; a[i + 1] = -z; a[i + 2] = y; } }
/** One lathe sector of the canonical profile — the one path of the full and the sector drawing. */
export function latheSector(prof: Float32Array, s: number, k: number, segments: number): THREE.LatheGeometry {
  const n = prof.length / 2, pts = Array.from({ length: n }, (_, i) => new THREE.Vector2(prof[2 * i]!, prof[2 * i + 1]!));
  const g = new THREE.LatheGeometry(pts, k, s * 2 * Math.PI / segments, k * 2 * Math.PI / segments);
  const a = g.getAttribute("position").array as Float32Array;
  if (MUT === "rotated" || MUT === "rotatedZPatched") {            // today / v6
    g.rotateX(Math.PI / 2);
    if (MUT === "rotatedZPatched") for (let v = 0; v < a.length / 3; v++) a[3 * v + 2] = prof[2 * (v % n) + 1]!;
  } else { quarterTurn(a); quarterTurn(g.getAttribute("normal").array as Float32Array); }
  return g;
}
/** the DRAWN triangles (f32 soup) — the cache's output, positions only */
export function drawnSoup6(d: Drawing, per = 0): Float32Array {
  if (d.kind === "mesh") { const { pos, idx } = d.mesh, out = new Float32Array(idx.length * 3); for (let i = 0; i < idx.length; i++) { const k = 3 * idx[i]!; out[3 * i] = pos[k]!; out[3 * i + 1] = pos[k + 1]!; out[3 * i + 2] = pos[k + 2]!; } return out; }
  const parts: Float32Array[] = [];
  for (const { prof, segments } of d.parts) for (let s = 0, w = per || segments; s < segments; s += w)
    parts.push(new Float32Array(latheSector(prof, s, Math.min(w, segments - s), segments).toNonIndexed().getAttribute("position").array as Float32Array));
  const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; } return all;
}

// ---- the body ----
export function boundaries6(z0: number, z1: number, o: HullOpts): Float32Array {
  if (MUT === "snapCuts") z1 = Math.fround(z1 - o.snap);
  if (MUT === "zFromZero") z0 = 0;
  const K = Math.max(1, Math.min(o.maxSlabs, Math.ceil((z1 - z0 - o.snap) / o.slab - 1e-9)));
  const b = new Float32Array(K + 1);
  b[0] = z0; b[K] = z1;                      // both ARE f32 values (canonical or the pin's own)
  for (let k = 1; k < K; k++) b[k] = z0 + (z1 - z0) * k / K;
  return b;
}
function lowSlab(b: Float32Array, z: number): number { let lo = 0, hi = b.length - 2; while (lo < hi) { const m = (lo + hi) >> 1; if (b[m + 1]! < z) lo = m + 1; else hi = m; } return lo; }
/** One edge p→q (the TOUCHING rule, every facet alike, flat ones included):
 *  its ends into every slab whose CLOSED interval holds them, its crossing of
 *  each boundary strictly between them into both neighbours. */
function edge(b: Float32Array, r2: Float64Array, px: number, py: number, pz: number, qx: number, qy: number, qz: number, c: Counter): void {
  if (pz > qz) { let t = px; px = qx; qx = t; t = py; py = qy; qy = t; t = pz; pz = qz; qz = t; }
  const K = b.length - 1; let k = lowSlab(b, pz); const ck = k;
  const rp = px * px + py * py;
  if (rp > r2[k]!) r2[k] = rp;
  if (k + 1 < K && pz >= b[k + 1]! && MUT !== "upperLost" && rp > r2[k + 1]!) r2[k + 1] = rp;
  for (let j = k + 1; j < K && b[j]! <= qz; j++) {
    if (MUT !== "verticesOnly" && b[j]! > pz && b[j]! < qz) {
      const t = (b[j]! - pz) / (qz - pz), x = px + t * (qx - px), y = py + t * (qy - py), r = x * x + y * y;
      if (MUT !== "oneSide" && r > r2[j - 1]!) r2[j - 1] = r;
      if (r > r2[j]!) r2[j] = r;
    }
    k = j;
  }
  const rq = qx * qx + qy * qy;
  if (rq > r2[k]!) r2[k] = rq;
  if (k > 0 && qz <= b[k]! && MUT !== "lowerLost" && rq > r2[k - 1]!) r2[k - 1] = rq;
  c.n += 8 + (k - ck);
}
function facet(b: Float32Array, r2: Float64Array, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, c: Counter): void {
  if (MUT === "flatOneSide" && az === bz && bz === cz) {   // v6's scratch: a flat facet widens one neighbour only
    const k = lowSlab(b, az), r = Math.max(ax * ax + ay * ay, bx * bx + by * by, cx * cx + cy * cy); if (r > r2[k]!) r2[k] = r; c.n += 8; return;
  }
  edge(b, r2, ax, ay, az, bx, by, bz, c); edge(b, r2, bx, by, bz, cx, cy, cz, c); edge(b, r2, cx, cy, cz, ax, ay, az, c);
}
function segment(b: Float32Array, r2: Float64Array, r0: number, z0: number, r1: number, z1: number, c: Counter): void {
  if (MUT === "flatOneSide" && z0 === z1) { const k = lowSlab(b, z0), r = Math.max(r0, r1) ** 2; if (r > r2[k]!) r2[k] = r; c.n += 8; return; }
  edge(b, r2, r0, 0, z0, r1, 0, z1, c);
}
function* pinEdges(pin: Float32Array, b: Float32Array, r2: Float64Array, o: HullOpts, c: Counter): Steps<void> {
  for (let t = 0; t + 8 < pin.length; t += 9) {
    facet(b, r2, pin[t]!, pin[t + 1]!, pin[t + 2]!, pin[t + 3]!, pin[t + 4]!, pin[t + 5]!, pin[t + 6]!, pin[t + 7]!, pin[t + 8]!, c);
    if (tick(c, o)) yield;
  }
}
export function* bodySteps(d: Drawing, D: number, vl: number, o: HullOpts, c: Counter, src?: { vertices: ArrayLike<number>[] }): Steps<HullNumbers> {
  const pin = MUT === "noPin" ? new Float32Array([0, 0, 0]) : toolCylinderPositions(D, vl);
  let z0 = 0, z1 = 0;
  for (let i = 2; i < pin.length; i += 3) { if (pin[i]! < z0) z0 = pin[i]!; if (pin[i]! > z1) z1 = pin[i]!; }
  if (d.kind === "mesh") { const p = d.mesh.pos; for (let i = 2; i < p.length; i += 3) { const z = p[i]!; if (z < z0) z0 = z; else if (z > z1) z1 = z; c.n++; if (tick(c, o)) yield; } }
  else for (const { prof } of d.parts) for (let i = 1; i < prof.length; i += 2) { const z = prof[i]!; if (z < z0) z0 = z; if (z > z1) z1 = z; c.n++; if (tick(c, o)) yield; }
  const b = boundaries6(z0, z1, o), K = b.length - 1, r2 = new Float64Array(K);
  if (MUT !== "noPin") yield* pinEdges(pin, b, r2, o, c);
  if (d.kind === "mesh") {
    const p = d.mesh.pos, ix = d.mesh.idx;
    const at = MUT === "f64Source" && src ? (k: number, j: number) => src.vertices[k]![j]! : (k: number, j: number) => p[3 * k + j]!;
    for (let t = 0; t < ix.length; t += 3) {
      const A = ix[t]!, B = ix[t + 1]!, C = ix[t + 2]!;
      const ax = at(A, 0), ay = at(A, 1), az = at(A, 2), bx = at(B, 0), by = at(B, 1), bz = at(B, 2), cx = at(C, 0), cy = at(C, 1), cz = at(C, 2);
      facet(b, r2, ax, ay, az, bx, by, bz, cx, cy, cz, c);
      if (tick(c, o)) yield;
    }
  } else for (const { prof } of d.parts) for (let i = 0; i + 3 < prof.length; i += 2) { segment(b, r2, prof[i]!, prof[i + 1]!, prof[i + 2]!, prof[i + 3]!, c); if (tick(c, o)) yield; }
  const circ = MUT === "inscribed" ? 1 : (1 / Math.cos(Math.PI / o.n)) * (MUT === "noInflate" ? 1 : 1 + 2 ** -20);
  const z: number[] = [b[0]!], rho: number[] = [];
  for (let k = 0; k < K; k++) {
    const r = f32Up((r2[k]! > 0 ? Math.sqrt(r2[k]!) : D / 2) * circ);
    if (MUT === "mergeNear" && rho.length && Math.abs(rho[rho.length - 1]! - r) < 0.05 * r) { z[z.length - 1] = b[k + 1]!; continue; }
    if (rho.length && rho[rho.length - 1] === r) { z[z.length - 1] = b[k + 1]!; continue; }
    rho.push(r); z.push(b[k + 1]!);
  }
  return { n: o.n, z: Float32Array.from(z), rho: Float32Array.from(rho) };
}
export function runAll<T>(g: Steps<T>): T { for (;;) { const r = g.next(); if (r.done) return r.value; } }

// What a tool is drawn from, in ONE canonical float32 form (P6-c plan v8 §2.1,
// Codex R477 MT477-01, R480, R482): the positions the drawing puts out ARE the
// source — nothing is rounded a second time between a drawing and whatever else
// is derived from the shape. Pure and three-free: typed arrays and bounded,
// counted steps (viewer/steps.ts), so the same code runs at once (tab preview,
// live marker) and in slices (toolShapeCache.ts).
import type { Steps } from "./viewer/steps";

/** A shape that cannot be drawn: a coordinate float32 cannot hold, a negative
 *  radius, an index out of range. Named when it is built, never a partial shape. */
export class ShapeNotUsable extends Error {
  constructor(what: string) { super(`shape not usable: ${what}`); this.name = "ShapeNotUsable"; }
}

/** Operations between two yields (viewer/steps.ts STEP_OPS): the work of the
 *  next piece is asked for BEFORE it runs (Codex R485-H1). */
export const DRAW_BUDGET = 4096;
/** Vertices of ONE drawing over all its parts, seam columns included: the
 *  admission of a lathe. With position and normal (24 B a vertex) and an index
 *  of fewer than 6 entries a vertex: at most 48 B × this = 19.2 MB. */
export const LATHE_VERTICES_MAX = 400_000;
/** An imported mesh (freecad_import.MAX_VERTICES / MAX_TRIANGLES). */
export const MESH_VERTICES_MAX = 100_000;
export const MESH_TRIANGLES_MAX = 200_000;

/** Counts a step's work; `max` is the most between two yields (a guard reads it). */
export interface DrawCounter { n: number; max: number; total: number }
export const drawCounter = (): DrawCounter => ({ n: 0, max: 0, total: 0 });
/** Takes `k` (at most DRAW_BUDGET) for the next piece; true: the budget is
 *  spent — yield first, the piece belongs to the next step. */
export function spent(c: DrawCounter, k: number): boolean {
  if (c.n + k <= DRAW_BUDGET) { c.n += k; return false; }
  settle(c);
  c.n = k;
  return true;
}
export function settle(c: DrawCounter): void { c.total += c.n; if (c.n > c.max) c.max = c.n; c.n = 0; }

/** What a build holds at once — counted where an array is made (a guard's
 *  meter; `arrays` lists them, for a guard that watches them fill). */
export interface HeldMeter { bytes: number; peak: number; arrays?: ArrayBufferView[] }
let held: HeldMeter | null = null;
/** Every array the builders below make while `f` runs is counted into `m`. */
export function withHeldMeter<R>(m: HeldMeter | null, f: () => R): R {
  const prev = held;
  held = m;
  try { return f(); } finally { held = prev; }
}
function made<A extends ArrayBufferView>(a: A): A {
  if (held) { held.bytes += a.byteLength; held.arrays?.push(a); if (held.bytes > held.peak) held.peak = held.bytes; }
  return a;
}

// ---- canonical sources ------------------------------------------------------

/** A mesh as drawn: every coordinate rounded to float32 once. */
export interface CanonMesh { pos: Float32Array; idx: Uint32Array }
/** A mesh as a library holds it. */
export interface NestedMesh { vertices: ArrayLike<number>[]; triangles: ArrayLike<number>[] }
/** A lathe's profile as drawn: [r, z] pairs in float32. */
export type CanonProfile = Float32Array;

export const isCanonMesh = (m: unknown): m is CanonMesh =>
  (m as CanonMesh | null)?.pos instanceof Float32Array && (m as CanonMesh).idx instanceof Uint32Array;

export function* canonMeshSteps(m: NestedMesh, c: DrawCounter = drawCounter()): Steps<CanonMesh> {
  const V = m.vertices, T = m.triangles, nV = V.length, nT = T.length;
  const pos = made(new Float32Array(nV * 3)), idx = made(new Uint32Array(nT * 3));
  for (let i = 0; i < nV; i++) {
    if (spent(c, 4)) yield;
    const v = V[i];
    if (!v || v.length < 3) throw new ShapeNotUsable("a mesh vertex");
    for (let j = 0; j < 3; j++) {
      const raw: unknown = v[j], x = typeof raw === "number" ? Math.fround(raw) : NaN;   // null is no 0
      if (!Number.isFinite(x)) throw new ShapeNotUsable("a mesh coordinate");
      pos[3 * i + j] = x;
    }
  }
  for (let t = 0; t < nT; t++) {
    if (spent(c, 4)) yield;
    const r = T[t];
    if (!r || r.length < 3) throw new ShapeNotUsable("a mesh triangle");
    for (let j = 0; j < 3; j++) {
      const k = r[j]!;
      if (!(Number.isInteger(k) && k >= 0 && k < nV)) throw new ShapeNotUsable("a mesh index");
      idx[3 * t + j] = k;
    }
  }
  settle(c);
  return { pos, idx };
}

/** A profile's points (radius x, height y) as drawn. */
export function canonProfile(pts: ArrayLike<{ x: number; y: number }>): CanonProfile {
  const out = made(new Float32Array(pts.length * 2));
  for (let i = 0; i < pts.length; i++) {
    const r = Math.fround(pts[i]!.x), z = Math.fround(pts[i]!.y);
    if (!(Number.isFinite(r) && Number.isFinite(z) && r >= 0)) throw new ShapeNotUsable("a profile point");
    out[2 * i] = r;
    out[2 * i + 1] = z;
  }
  return out;
}

/** One revolved part: its profile and how many columns it is drawn with. */
export interface LathePart { role: "cutter" | "shaft"; prof: CanonProfile; segments: number }
/** What is drawn — the ONE source of a tool's geometry. */
export type ToolDrawing = { kind: "mesh"; mesh: CanonMesh } | { kind: "lathe"; parts: LathePart[] };

// ---- the drawn arrays -------------------------------------------------------

/** The attributes a drawing keeps: position and normal, a lathe its index. No
 *  UVs: no tool material has a map and nothing on the page reads a tool's UV. */
export interface DrawnPart {
  role: "cutter" | "shaft";
  positions: Float32Array;
  normals: Float32Array;
  index: Uint16Array | Uint32Array | null;
  /** its bounding box and sphere: three's own pass over a mesh of 200 000
   *  triangles is a 10 ms task in the first frame */
  box: [number, number, number, number, number, number];
  sphere: [number, number, number, number];
}

/** Vertices and index entries of one lathe part — known before it is built. */
export const latheSize = (points: number, segments: number): { v: number; i: number } =>
  ({ v: (segments + 1) * points, i: 6 * segments * (points - 1) });

/** Vertices of a drawing over all its parts, seam columns included. */
export function drawingVertices(d: ToolDrawing): number {
  return d.kind === "mesh" ? d.mesh.idx.length
    : d.parts.reduce((n, p) => n + latheSize(p.prof.length / 2, p.segments).v, 0);
}
/** Within the admission (checked before anything is allocated)? */
export const drawingAdmitted = (d: ToolDrawing): boolean =>
  d.kind === "mesh" ? d.mesh.idx.length <= 3 * MESH_TRIANGLES_MAX : drawingVertices(d) <= LATHE_VERTICES_MAX;
/** The bytes a drawing's arrays take, from its sizes: 72 B a mesh triangle; a
 *  lathe 24 B a vertex and 4 B (2 B below 65 536 vertices) an index entry. */
export function drawingBytes(d: ToolDrawing): number {
  if (d.kind === "mesh") return d.mesh.idx.length * 24;
  return d.parts.reduce((n, p) => {
    const { v, i } = latheSize(p.prof.length / 2, p.segments);
    return n + 24 * v + (v > 65535 ? 4 : 2) * i;
  }, 0);
}

/** three's LatheGeometry of `prof` (r, z), written column by column into its
 *  preallocated arrays — no intermediate geometry —, with the quarter turn as
 *  an EXACT signed axis swap (x, y, z) → (x, −z, y): the drawn z IS the
 *  profile's z and x, y are the rounded radial coordinates alone. A rotation
 *  matrix mixes the axial value into y by y·cos(π/2) (Codex R480: 4e-5 mm at
 *  z 1e12). Value-equal to `new LatheGeometry` + the swap, three's meridian
 *  normals (the last one not normalised) and index included — a test holds
 *  the two against each other. */
export function* latheColumnsSteps(part: LathePart, c: DrawCounter = drawCounter()): Steps<DrawnPart> {
  const { prof, segments, role } = part, np = prof.length / 2, { v, i } = latheSize(np, segments);
  const mn = made(new Float64Array(2 * np));
  let px = 0, py = 0, rmax = 0, zmin = Infinity, zmax = -Infinity;
  for (let j = 0; j < np; j++) {
    if (spent(c, 4)) yield;
    const r = prof[2 * j]!, z = prof[2 * j + 1]!;
    if (r > rmax) rmax = r;
    if (z < zmin) zmin = z;
    if (z > zmax) zmax = z;
    if (j === np - 1) { mn[2 * j] = px; mn[2 * j + 1] = py; break; }
    const dx = prof[2 * j + 2]! - r, dy = prof[2 * j + 3]! - z;
    let x = dy * 1.0, y = -dx;
    const cx = x, cy = y;
    if (j > 0) { x += px; y += py; }
    const l = 1 / (Math.sqrt(x * x + y * y) || 1);
    mn[2 * j] = x * l;
    mn[2 * j + 1] = y * l;
    px = cx;
    py = cy;
  }
  const positions = made(new Float32Array(3 * v));
  yield;
  const normals = made(new Float32Array(3 * v));
  yield;
  const index = made(v > 65535 ? new Uint32Array(i) : new Uint16Array(i));
  yield;
  const inv = 1.0 / segments;
  for (let s = 0, o = 0; s <= segments; s++) {
    const phi = s * inv * (Math.PI * 2), sin = Math.sin(phi), cos = Math.cos(phi);
    for (let j = 0; j < np; j++, o += 3) {
      if (spent(c, 1)) yield;                // a vertex; a column goes over steps
      const r = prof[2 * j]!, nx = mn[2 * j]!;
      positions[o] = r * sin;
      positions[o + 1] = -(r * cos);
      positions[o + 2] = prof[2 * j + 1]!;
      normals[o] = nx * sin;
      normals[o + 1] = -(nx * cos);
      normals[o + 2] = mn[2 * j + 1]!;
    }
  }
  for (let s = 0, k = 0; s < segments; s++) {
    for (let j = 0; j < np - 1; j++) {
      if (spent(c, 6)) yield;                // six index entries
      const a = j + s * np, b = a + np;
      index[k++] = a; index[k++] = b; index[k++] = a + 1;
      index[k++] = b + 1; index[k++] = a + 1; index[k++] = b;
    }
  }
  settle(c);
  const h = (zmax - zmin) / 2;
  return { role, positions, normals, index, box: [-rmax, -rmax, zmin, rmax, rmax, zmax],
           sphere: [0, 0, zmin + h, Math.hypot(rmax, h)] };
}

/** The mesh as flat-shaded triangles (an imported body keeps its edges). */
export function* meshSoupSteps(m: CanonMesh, c: DrawCounter = drawCounter()): Steps<DrawnPart> {
  const n = m.idx.length / 3, p = m.pos, ix = m.idx;
  const positions = made(new Float32Array(n * 9));
  yield;
  const normals = made(new Float32Array(n * 9));
  yield;
  const box: DrawnPart["box"] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    if (spent(c, 24)) yield;
    const o = 9 * t;
    for (let k = 0; k < 3; k++) {
      const a = 3 * ix[3 * t + k]!;
      for (let j = 0; j < 3; j++) {
        const x = p[a + j]!;
        positions[o + 3 * k + j] = x;
        if (x < box[j]!) box[j] = x;
        if (x > box[3 + j]!) box[3 + j] = x;
      }
    }
    // three's computeVertexNormals of a facet: (C − B) × (A − B)
    const bx = positions[o + 3]!, by = positions[o + 4]!, bz = positions[o + 5]!;
    const ux = positions[o + 6]! - bx, uy = positions[o + 7]! - by, uz = positions[o + 8]! - bz;
    const vx = positions[o]! - bx, vy = positions[o + 1]! - by, vz = positions[o + 2]! - bz;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 9; k += 3) { normals[o + k] = nx; normals[o + k + 1] = ny; normals[o + k + 2] = nz; }
  }
  if (!n) box.fill(0);
  const cx = (box[0] + box[3]) / 2, cy = (box[1] + box[4]) / 2, cz = (box[2] + box[5]) / 2;
  let r2 = 0;
  for (let i = 0; i < p.length; i += 3) {
    if (spent(c, 1)) yield;
    const x = p[i]! - cx, y = p[i + 1]! - cy, z = p[i + 2]! - cz, d = x * x + y * y + z * z;
    if (d > r2) r2 = d;
  }
  settle(c);
  return { role: "shaft", positions, normals, index: null, box, sphere: [cx, cy, cz, Math.sqrt(r2)] };
}

/** Every part of a drawing, in counted steps. */
export function* drawnSteps(d: ToolDrawing, c: DrawCounter = drawCounter()): Steps<DrawnPart[]> {
  if (d.kind === "mesh") return [yield* meshSoupSteps(d.mesh, c)];
  const out: DrawnPart[] = [];
  for (const p of d.parts) out.push(yield* latheColumnsSteps(p, c));
  return out;
}

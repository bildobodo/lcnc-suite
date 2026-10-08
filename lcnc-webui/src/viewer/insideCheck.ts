// The inside check (collision plan step 2, docs/reviews/collision-inside.plan.md
// Fassung 2, Codex R96/R97): a body wholly inside another has its surfaces
// apart — a distance query reads "clear" — so where the sweep has no
// continuity to rely on (the baseline, a jump, a separation decision) it asks
// whether a component of one body lies inside the other. Pure; unit-tested.
//
// Contract:
//  - A decision is three-valued: "inside" | "outside" | "undecidable".
//    "undecidable" is never "outside" — a caller must give it neither a
//    clearance certificate nor a static exclusion (VP96-03).
//  - A point is decided by ONE ray that meets the surface only properly: a
//    hit near an edge or a vertex (barycentric < EPS_BARY), a hit grazing the
//    face (|cos| < EPS_COS) or two hits at one distance (< EPS_T × the
//    body's diagonal) make the ray degenerate, and the next of the fixed
//    directions is tried; all degenerate → "undecidable" (VP96-02 — a box's
//    centre seen along a shared edge gave two hits at one distance, and
//    plain hit parity said outside).
//  - Only a CLOSED surface has an inside: every directed edge has its reverse
//    and none occurs twice in one direction (`meshClosure`); a body that is
//    not closed is "undecidable" for every point.
//  - The exclusion before the ray is exact (VP96-01): a point outside every
//    one of the container's LOCAL component boxes is outside — a transformed,
//    inflated box proves nothing.
//  - The winding number (`windingNumber`, Van Oosterom–Strackee solid angles
//    over every triangle, no BVH) is the independent check the tests hold the
//    rays to, on analytic shapes and on the shipped models.
import * as THREE from "three";
import type { MeshBVH } from "three-mesh-bvh";

export type InsideVerdict = "inside" | "outside" | "undecidable";

export const EPS_BARY = 1e-6;
export const EPS_COS = 1e-6;
export const EPS_T = 1e-6;

/** Fixed, generic directions (unit length), from a seeded search: every
 *  component ≥ 0.146 (no axis), ≤ 0.891 along a box diagonal and ≤ 0.907
 *  along a face diagonal, pairwise |cos| ≤ 0.851 — a degenerate ray rarely
 *  makes the next one degenerate too. */
export const RAY_DIRS: readonly THREE.Vector3[] = [
  [-0.3614, 0.1461, -0.9209], [-0.9036, 0.3652, -0.2238], [-0.1464, -0.9448, 0.2931],
  [0.9332, 0.3252, 0.1527], [0.2193, -0.1643, -0.9617], [-0.2661, -0.4001, -0.877],
].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());

/** One vertex per connected component and whether every component is a
 *  closed surface (vertices welded to 1 µm, like componentBoxes). */
export interface MeshClosure {
  /** xyz of one vertex per component, in the mesh's local frame. */
  repVerts: Float32Array;
  components: number;
  closed: boolean;
  /** Why not closed: directed edges without a reverse, edges repeated in one
   *  direction (a non-manifold or inconsistently oriented surface). */
  open: number;
  repeated: number;
}

export function meshClosure(pos: Float32Array): MeshClosure {
  const nTri = Math.floor(pos.length / 9);
  const vid = new Map<string, number>();
  const tv = new Int32Array(nTri * 3);
  for (let t = 0; t < nTri; t++) {
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      const key = `${Math.round(pos[o]! * 1000)},${Math.round(pos[o + 1]! * 1000)},${Math.round(pos[o + 2]! * 1000)}`;
      let id = vid.get(key);
      if (id === undefined) { id = vid.size; vid.set(key, id); }
      tv[t * 3 + v] = id;
    }
  }
  // components by shared vertices
  const parent = new Int32Array(nTri);
  for (let i = 0; i < nTri; i++) parent[i] = i;
  const find = (a: number): number => { while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; } return a; };
  const firstTri = new Int32Array(vid.size).fill(-1);
  for (let t = 0; t < nTri; t++) {
    for (let v = 0; v < 3; v++) {
      const id = tv[t * 3 + v]!;
      const f = firstTri[id]!;
      if (f < 0) firstTri[id] = t;
      else { const ra = find(t), rb = find(f); if (ra !== rb) parent[ra] = rb; }
    }
  }
  const reps: number[] = [];
  const seenRoot = new Set<number>();
  for (let t = 0; t < nTri; t++) {
    const r = find(t);
    if (seenRoot.has(r)) continue;
    seenRoot.add(r);
    reps.push(pos[t * 9]!, pos[t * 9 + 1]!, pos[t * 9 + 2]!);
  }
  // closure by directed edges
  const dir = new Map<string, number>();
  for (let t = 0; t < nTri; t++) {
    const a = tv[t * 3]!, b = tv[t * 3 + 1]!, c = tv[t * 3 + 2]!;
    if (a === b || b === c || a === c) continue;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const k = `${p}>${q}`;
      dir.set(k, (dir.get(k) ?? 0) + 1);
    }
  }
  let open = 0, repeated = 0;
  for (const [k, n] of dir) {
    if (n > 1) repeated++;
    const [p, q] = k.split(">");
    if (!dir.has(`${q}>${p}`)) open++;
  }
  return { repVerts: new Float32Array(reps), components: seenRoot.size, closed: open === 0 && repeated === 0, open, repeated };
}

/** Whether `p` (in the container's local frame) lies in at least one of its
 *  local component boxes (6 floats each) — the exact exclusion: a point
 *  outside all of them is outside the container. */
export function inLocalBoxes(p: THREE.Vector3, comps: Float32Array, pad = 0): boolean {
  for (let i = 0; i < comps.length; i += 6) {
    if (p.x >= comps[i]! - pad && p.x <= comps[i + 3]! + pad
      && p.y >= comps[i + 1]! - pad && p.y <= comps[i + 4]! + pad
      && p.z >= comps[i + 2]! - pad && p.z <= comps[i + 5]! + pad) return true;
  }
  return false;
}

const _ray = new THREE.Ray();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _n = new THREE.Vector3(), _bary = new THREE.Vector3(), _tri = new THREE.Triangle();

/** One ray's verdict: the crossing count's parity when every hit is a proper
 *  crossing, else null (degenerate). `scale` sizes EPS_T (the body's
 *  diagonal). */
export function rayVerdict(bvh: MeshBVH, geom: THREE.BufferGeometry, p: THREE.Vector3, d: THREE.Vector3, scale: number):
    "inside" | "outside" | null {
  _ray.origin.copy(p);
  _ray.direction.copy(d);
  const hits = bvh.raycast(_ray, THREE.DoubleSide);
  const pos = geom.getAttribute("position");
  const idx = geom.index;
  const ts: number[] = [];
  for (const h of hits) {
    const f = h.faceIndex ?? -1;
    if (f < 0) return null;
    const ia = idx ? idx.getX(f * 3) : f * 3, ib = idx ? idx.getX(f * 3 + 1) : f * 3 + 1, ic = idx ? idx.getX(f * 3 + 2) : f * 3 + 2;
    _a.fromBufferAttribute(pos, ia); _b.fromBufferAttribute(pos, ib); _c.fromBufferAttribute(pos, ic);
    _tri.set(_a, _b, _c);
    _tri.getNormal(_n);
    if (Math.abs(_n.dot(d)) < EPS_COS) return null;                 // grazing
    _tri.getBarycoord(h.point, _bary);
    if (Math.min(_bary.x, _bary.y, _bary.z) < EPS_BARY) return null; // on an edge or a vertex
    ts.push(h.distance);
  }
  ts.sort((x, y) => x - y);
  for (let i = 1; i < ts.length; i++) if (ts[i]! - ts[i - 1]! < EPS_T * scale) return null;  // two hits at one place
  return ts.length % 2 === 1 ? "inside" : "outside";
}

/** A point's verdict against a closed body: the first non-degenerate ray of
 *  `dirs` decides; none → "undecidable". */
export function pointInside(bvh: MeshBVH, geom: THREE.BufferGeometry, p: THREE.Vector3, scale: number,
    dirs: readonly THREE.Vector3[] = RAY_DIRS): InsideVerdict {
  for (const d of dirs) {
    const v = rayVerdict(bvh, geom, p, d, scale);
    if (v) return v;
  }
  return "undecidable";
}

/** The generalised winding number of a closed, consistently oriented
 *  triangle soup about `p` (Van Oosterom & Strackee's solid angle per
 *  triangle, summed, over 4π): 1 inside, 0 outside, ±1 per nesting shell —
 *  the independent check for the rays. No BVH; O(triangles). */
export function windingNumber(pos: Float32Array, p: { x: number; y: number; z: number }): number {
  let sum = 0;
  for (let i = 0; i + 8 < pos.length; i += 9) {
    const ax = pos[i]! - p.x, ay = pos[i + 1]! - p.y, az = pos[i + 2]! - p.z;
    const bx = pos[i + 3]! - p.x, by = pos[i + 4]! - p.y, bz = pos[i + 5]! - p.z;
    const cx = pos[i + 6]! - p.x, cy = pos[i + 7]! - p.y, cz = pos[i + 8]! - p.z;
    const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz), lc = Math.hypot(cx, cy, cz);
    const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la + (cx * ax + cy * ay + cz * az) * lb;
    sum += 2 * Math.atan2(det, den);
  }
  return sum / (4 * Math.PI);
}

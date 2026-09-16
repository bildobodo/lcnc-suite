// Reachable-volume outlines (2026-09-12). Pure; run off-thread by
// reachWorker.ts.
//
// Two shapes, both from the LIVE joint limits, the machine.json chain and
// the live tool length — no program involved:
//
//   ROOM: where the TOOL TIP can be in the machine frame (the scene's
//   machineFrameGrp: the work group's frame with every work-chain rotary
//   at zero). For each head-rotary sample the tip is affine in the linear
//   joints, so the reach at that tilt is the image of the travel box's 8
//   corners; the union over the sampled tilts is hulled. Exact where the
//   tip orbit is convex; a concave orbit (a missing C wedge) is filled by
//   the hull — an OUTLINE, never a certificate.
//
//   PART: where the tip can be RELATIVE TO THE PART, i.e. the room solid
//   swept through every work-chain rotary over its limit range, walked
//   down the chain the way the scene composes it (static base translate,
//   then the node's rotations, inverted — the part sees the room turn the
//   other way). A sweep is evaluated per slice along the axis and per ray
//   from it: the ray's span inside the input solid, then the circular
//   min/max over the swept angle window (a full turn = every direction).
//   The union of spans along one ray is kept as ONE interval [min, max]
//   (a ray from the axis meets a convex slice in one span; sweeping a
//   contiguous window keeps it connected). The result is a radial table
//   in the child frame — itself a Solid, so a second work rotary (a
//   trunnion's C under A) sweeps it again. Rendered as outer/inner sheets
//   with walls where coverage stops and caps at the axial ends.
//
// Everything a 5-axis workspace really is (five-dimensional: position +
// tool direction) projects onto these two 3D solids; what the picture
// cannot say is WHICH tilt reaches a point. Collision-free volume is
// explicitly out of scope — the collision sweep answers that per program.
import * as THREE from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import {
  buildChain, tipInRoomFrame, tipInWorkFrame, type Chain, type ChainNode, type JointLimitList, type PartFrameMachine,
} from "./partFrame";

export interface ReachOptions {
  /** Head-rotary sampling step (degrees; coarsened to keep the sample
   *  product under maxRotSamples). */
  rotStepDeg?: number;
  maxRotSamples?: number;
  /** Sweep resolution: slices along a work rotary's axis, rays per slice. */
  slices?: number;
  rays?: number;
}

export interface ReachInfo {
  /** Head-rotary samples × travel-box corners hulled. */
  samples: number;
  corners: number;
  hullFaces: number;
  /** Honest limitations that applied (a linear joint under a work rotary,
   *  a rotary without finite limits taken as a full turn, …). */
  notes: string[];
  ms: number;
}

export interface ReachResult {
  /** Room-frame tip reach (machineFrameGrp coordinates): triangle soup. */
  roomTris: Float32Array;
  room: Solid;
  /** Part-frame reach (work group coordinates) — null when the work chain
   *  has no rotary (then the room solid IS the part reach). */
  partTris: Float32Array | null;
  part: Solid | null;
  info: ReachInfo;
}

/** A closed solid: ray spans, directional extent, membership, and its
 *  triangle soup. Coordinates are the frame the solid was built in. */
export interface Solid {
  /** [s0, s1] of the ray o + s·d (s ≥ 0, |d| = 1) inside the solid; null = miss. */
  raySpan(o: THREE.Vector3, d: THREE.Vector3): [number, number] | null;
  /** [min, max] of p·dir over the solid (|dir| = 1). */
  extent(dir: THREE.Vector3): [number, number];
  contains(p: THREE.Vector3): boolean;
  mesh(): Float32Array;
  /** Outline line segments [x,y,z, x,y,z, …] that read from ANY viewpoint —
   *  a swept solid is a cylinder-like body the camera usually sits inside,
   *  and crease edges alone show nothing of it; null = derive crease edges
   *  from the mesh instead (a hull's rounded edges are facet creases). */
  cage(ringEvery?: number, genEveryDeg?: number): Float32Array | null;
}

const DEFAULTS = { rotStepDeg: 5, maxRotSamples: 4096, slices: 64, rays: 360 };
const EPS = 1e-6;

// ---------------------------------------------------------------- hull solid

/** Deterministic jitter amplitude (machine units) that breaks the exact
 *  degeneracies of the reach input — 8 translated copies of one orbit,
 *  coplanar by construction — which three's quickhull sometimes turns into
 *  faces that are not supporting planes (observed on the trsrn model: a
 *  face 3.5 m inside the hull). Invisible at any drawing scale. */
const HULL_JITTER = 1e-3;
const HULL_TRIES = 4;
const HULL_TOL = 1e-3;

/** Convex hull of a point set as a plane-bounded solid. Input is
 *  deduplicated and jittered; the result is VALIDATED (every plane must
 *  hold every hull vertex) and rebuilt with a fresh jitter seed on failure;
 *  faces that still fail are dropped (`dropped` > 0 — the solid stays a
 *  convex bound by its remaining supporting planes; the mesh gets a hole). */
export class HullSolid implements Solid {
  readonly planes: { n: THREE.Vector3; c: number }[] = [];
  tris: Float32Array = new Float32Array(0);
  readonly verts: THREE.Vector3[] = [];
  dropped = 0;
  attempts = 0;

  constructor(points: THREE.Vector3[]) {
    const base = dedupePoints(points, 1e-4);
    const seed = 0x9e3779b9;
    for (let attempt = 1; attempt <= HULL_TRIES; attempt++) {
      this.attempts = attempt;
      const input = jitterPoints(base, HULL_JITTER, seed + attempt * 7919);
      const hull = new ConvexHull().setFromPoints(input);
      this.planes.length = 0; this.verts.length = 0;
      const tris: number[] = [];
      const seen = new Set<unknown>();
      for (const face of hull.faces) {
        this.planes.push({ n: face.normal.clone(), c: face.constant });
        let edge = face.edge;
        let k = 0;
        do {
          const v = edge.head();
          tris.push(v.point.x, v.point.y, v.point.z);
          if (!seen.has(v)) { seen.add(v); this.verts.push(v.point.clone()); }
          edge = edge.next;
          k++;
        } while (edge !== face.edge && k < 8);
      }
      this.tris = Float32Array.from(tris);
      const bad = this._invalidFaces();
      if (bad.length === 0) { this.dropped = 0; return; }
      if (attempt === HULL_TRIES) {
        // Keep the supporting planes only; drop the bad faces' triangles.
        const badSet = new Set(bad);
        const keptPlanes = this.planes.filter((_, i) => !badSet.has(i));
        const keptTris: number[] = [];
        for (let i = 0; i < this.planes.length; i++) if (!badSet.has(i)) for (let q = 0; q < 9; q++) keptTris.push(this.tris[i * 9 + q]!);
        this.planes.length = 0; this.planes.push(...keptPlanes);
        this.tris = Float32Array.from(keptTris);
        this.dropped = bad.length;
      }
    }
  }

  /** Indices of faces whose plane fails to hold some hull vertex. */
  private _invalidFaces(): number[] {
    const bad: number[] = [];
    for (let i = 0; i < this.planes.length; i++) {
      const { n, c } = this.planes[i]!;
      for (const v of this.verts) { if (n.dot(v) - c > HULL_TOL) { bad.push(i); break; } }
    }
    return bad;
  }

  raySpan(o: THREE.Vector3, d: THREE.Vector3): [number, number] | null {
    let s0 = 0, s1 = Infinity;
    for (const { n, c } of this.planes) {
      const nd = n.dot(d);
      const f = n.dot(o) - c;               // > 0 = outside this plane at s = 0
      if (Math.abs(nd) < 1e-12) {
        if (f > EPS) return null;
        continue;
      }
      const s = -f / nd;
      if (nd > 0) { if (s < s1) s1 = s; }   // leaving
      else { if (s > s0) s0 = s; }          // entering
      if (s0 > s1 + EPS) return null;
    }
    return s1 === Infinity ? null : [s0, Math.max(s0, s1)];
  }

  extent(dir: THREE.Vector3): [number, number] {
    let lo = Infinity, hi = -Infinity;
    for (const v of this.verts) { const t = v.dot(dir); if (t < lo) lo = t; if (t > hi) hi = t; }
    return [lo, hi];
  }

  contains(p: THREE.Vector3): boolean {
    for (const { n, c } of this.planes) if (n.dot(p) - c > EPS) return false;
    return true;
  }

  mesh(): Float32Array { return this.tris; }
  cage(): Float32Array | null { return null; }   // hull creases are cut by the caller
}

function dedupePoints(pts: THREE.Vector3[], q: number): THREE.Vector3[] {
  const mp = new Map<string, THREE.Vector3>();
  for (const p of pts) mp.set(`${Math.round(p.x / q)},${Math.round(p.y / q)},${Math.round(p.z / q)}`, p);
  return [...mp.values()];
}

function jitterPoints(pts: THREE.Vector3[], amp: number, seed: number): THREE.Vector3[] {
  let s = seed >>> 0;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296 - 0.5; };
  return pts.map(p => new THREE.Vector3(p.x + amp * rnd(), p.y + amp * rnd(), p.z + amp * rnd()));
}

// -------------------------------------------------------- translated solid

const _tv = new THREE.Vector3();

/** `inner` shifted by `offset` (the child frame's view of its parent's solid). */
export class TranslatedSolid implements Solid {
  readonly inner: Solid;
  readonly offset: THREE.Vector3;
  constructor(inner: Solid, offset: THREE.Vector3) { this.inner = inner; this.offset = offset; }
  raySpan(o: THREE.Vector3, d: THREE.Vector3) { return this.inner.raySpan(_tv.copy(o).sub(this.offset), d); }
  extent(dir: THREE.Vector3): [number, number] {
    const [lo, hi] = this.inner.extent(dir);
    const s = this.offset.dot(dir);
    return [lo + s, hi + s];
  }
  contains(p: THREE.Vector3) { return this.inner.contains(_tv.copy(p).sub(this.offset)); }
  mesh(): Float32Array { return this._shift(this.inner.mesh()); }
  cage(ringEvery?: number, genEveryDeg?: number): Float32Array | null {
    const c = this.inner.cage(ringEvery, genEveryDeg);
    return c ? this._shift(c) : null;
  }
  private _shift(src: Float32Array): Float32Array {
    const m = src.slice();
    for (let i = 0; i < m.length; i += 3) { m[i] = m[i]! + this.offset.x; m[i + 1] = m[i + 1]! + this.offset.y; m[i + 2] = m[i + 2]! + this.offset.z; }
    return m;
  }
}

// ------------------------------------------------------------ radial solid

/** A solid of (partial) revolution about an axis through the frame origin:
 *  per slice t_i along the axis and ray angle θ_j, the radial interval
 *  [rIn, rOut] (NaN = the direction is not covered on that slice). */
export class RadialSolid implements Solid {
  private _tris: Float32Array | null = null;
  private _rMax = 0;
  readonly a: THREE.Vector3; readonly e1: THREE.Vector3; readonly e2: THREE.Vector3;
  readonly t0: number; readonly dt: number; readonly nT: number; readonly nR: number;
  readonly rIn: Float32Array; readonly rOut: Float32Array;
  constructor(
    a: THREE.Vector3, e1: THREE.Vector3, e2: THREE.Vector3,
    t0: number, dt: number, nT: number, nR: number,
    rIn: Float32Array, rOut: Float32Array,
  ) {
    this.a = a; this.e1 = e1; this.e2 = e2; this.t0 = t0; this.dt = dt; this.nT = nT; this.nR = nR; this.rIn = rIn; this.rOut = rOut;
    for (let k = 0; k < rOut.length; k++) { const r = rOut[k]!; if (r === r && r > this._rMax) this._rMax = r; }
  }

  /** Nearest table cell of a point; -1 when off the axial range. */
  private _cell(p: THREE.Vector3): number {
    const t = p.dot(this.a);
    const i = Math.round((t - this.t0) / this.dt);
    if (i < 0 || i >= this.nT) return -1;
    const x = p.dot(this.e1), y = p.dot(this.e2);
    let j = Math.round(Math.atan2(y, x) / (2 * Math.PI / this.nR));
    j = ((j % this.nR) + this.nR) % this.nR;
    return i * this.nR + j;
  }

  contains(p: THREE.Vector3): boolean {
    const k = this._cell(p);
    if (k < 0) return false;
    const r = Math.hypot(p.dot(this.e1), p.dot(this.e2));
    return r >= this.rIn[k]! - EPS && r <= this.rOut[k]! + EPS;   // NaN → false
  }

  raySpan(o: THREE.Vector3, d: THREE.Vector3): [number, number] | null {
    // March the ray through the table (nearest-cell membership), then
    // bisect both ends. The table is the resolution anyway.
    const tLen = this.dt * (this.nT - 1);
    const sMax = o.length() + this._rMax + tLen + 1;
    const N = 256;
    const p = new THREE.Vector3();
    let first = -1, last = -1;
    for (let k = 0; k <= N; k++) {
      const s = sMax * k / N;
      p.copy(o).addScaledVector(d, s);
      if (this.contains(p)) { if (first < 0) first = s; last = s; }
    }
    if (first < 0) return null;
    const step = sMax / N;
    const refine = (inside: number, outside: number): number => {
      for (let it = 0; it < 10; it++) {
        const m = (inside + outside) / 2;
        p.copy(o).addScaledVector(d, m);
        if (this.contains(p)) inside = m; else outside = m;
      }
      return inside;
    };
    const s0 = first > 0 ? refine(first, Math.max(0, first - step)) : 0;
    const s1 = refine(last, last + step);
    return [s0, s1];
  }

  /** A node of the table as a point (inner or outer sheet). */
  point(i: number, j: number, outer: boolean, out: THREE.Vector3): THREE.Vector3 | null {
    const k = i * this.nR + j;
    const r = outer ? this.rOut[k]! : this.rIn[k]!;
    if (r !== r) return null;
    const th = 2 * Math.PI * j / this.nR;
    const t = this.t0 + this.dt * i;
    return out.copy(this.a).multiplyScalar(t)
      .addScaledVector(this.e1, r * Math.cos(th)).addScaledVector(this.e2, r * Math.sin(th));
  }

  extent(dir: THREE.Vector3): [number, number] {
    let lo = Infinity, hi = -Infinity;
    const p = new THREE.Vector3();
    for (let i = 0; i < this.nT; i++) for (let j = 0; j < this.nR; j++) {
      for (const outer of [true, false]) {
        if (!this.point(i, j, outer, p)) continue;
        const v = p.dot(dir);
        if (v < lo) lo = v; if (v > hi) hi = v;
      }
    }
    return lo === Infinity ? [0, 0] : [lo, hi];
  }

  mesh(): Float32Array {
    if (this._tris) return this._tris;
    const { nT, nR } = this;
    const out: number[] = [];
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const has = (i: number, j: number) => i >= 0 && i < nT && this.rOut[i * nR + (((j % nR) + nR) % nR)]! === this.rOut[i * nR + (((j % nR) + nR) % nR)]!;
    const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
      out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
    };
    for (let i = 0; i < nT; i++) {
      for (let j = 0; j < nR; j++) {
        if (!has(i, j)) continue;
        const j1 = (j + 1) % nR;
        // sheets between (i,j),(i,j+1),(i+1,j+1),(i+1,j)
        if (i + 1 < nT && has(i, j1) && has(i + 1, j) && has(i + 1, j1)) {
          for (const outer of [true, false]) {
            this.point(i, j, outer, P[0]!); this.point(i, j1, outer, P[1]!);
            this.point(i + 1, j1, outer, P[2]!); this.point(i + 1, j, outer, P[3]!);
            if (outer) quad(P[0]!, P[1]!, P[2]!, P[3]!); else quad(P[3]!, P[2]!, P[1]!, P[0]!);
          }
        }
        // angular walls where the next direction is uncovered (partial sweeps)
        if (i + 1 < nT && has(i + 1, j)) {
          if (!has(i, j1) || !has(i + 1, j1)) {
            this.point(i, j, false, P[0]!); this.point(i, j, true, P[1]!);
            this.point(i + 1, j, true, P[2]!); this.point(i + 1, j, false, P[3]!);
            quad(P[0]!, P[1]!, P[2]!, P[3]!);
          }
          const jm = (j - 1 + nR) % nR;
          if (!has(i, jm) || !has(i + 1, jm)) {
            this.point(i, j, false, P[0]!); this.point(i, j, true, P[1]!);
            this.point(i + 1, j, true, P[2]!); this.point(i + 1, j, false, P[3]!);
            quad(P[3]!, P[2]!, P[1]!, P[0]!);
          }
        }
        // axial caps: the first/last slice and any interior coverage edge
        if (has(i, j1)) {
          if (i === 0 || !has(i - 1, j) || !has(i - 1, j1)) {
            this.point(i, j, false, P[0]!); this.point(i, j1, false, P[1]!);
            this.point(i, j1, true, P[2]!); this.point(i, j, true, P[3]!);
            quad(P[0]!, P[1]!, P[2]!, P[3]!);
          }
          if (i === nT - 1 || !has(i + 1, j) || !has(i + 1, j1)) {
            this.point(i, j, false, P[0]!); this.point(i, j1, false, P[1]!);
            this.point(i, j1, true, P[2]!); this.point(i, j, true, P[3]!);
            quad(P[3]!, P[2]!, P[1]!, P[0]!);
          }
        }
      }
    }
    this._tris = Float32Array.from(out);
    return this._tris;
  }

  /** Rings every `ringEvery` slices (plus both ends), generators every
   *  `genEveryDeg`, and radial spokes where coverage stops and at the caps
   *  — on both sheets. */
  cage(ringEvery = 8, genEveryDeg = 15): Float32Array {
    const { nT, nR } = this;
    const out: number[] = [];
    const A = new THREE.Vector3(), B = new THREE.Vector3();
    const idx = (i: number, j: number) => i * nR + (((j % nR) + nR) % nR);
    const has = (i: number, j: number) => i >= 0 && i < nT && this.rOut[idx(i, j)]! === this.rOut[idx(i, j)]!;
    const seg = (a: THREE.Vector3, b: THREE.Vector3) => { if (a.distanceToSquared(b) > 1e-12) out.push(a.x, a.y, a.z, b.x, b.y, b.z); };
    const genStep = Math.max(1, Math.round(genEveryDeg / (360 / nR)));
    for (let i = 0; i < nT; i++) {
      const ring = i % ringEvery === 0 || i === nT - 1;
      for (let j = 0; j < nR; j++) {
        if (!has(i, j)) continue;
        const j1 = j + 1, jm = j - 1;
        const boundary = !has(i, j1) || !has(i, jm);
        if (ring && has(i, j1)) {
          for (const outer of [true, false]) { this.point(i, j, outer, A); this.point(i, j1 % nR, outer, B); seg(A, B); }
        }
        if ((j % genStep === 0 || boundary) && i + 1 < nT && has(i + 1, j)) {
          for (const outer of [true, false]) { this.point(i, j, outer, A); this.point(i + 1, j, outer, B); seg(A, B); }
        }
        // Spokes (inner → outer) only where a profile line meets a cap, and
        // at an angular coverage boundary on a ring — never all around a
        // cap (360 spokes filled the flat ends solid; operator, 2026-09-12).
        const cap = i === 0 || i === nT - 1 || !has(i - 1, j) || !has(i + 1, j);
        if ((ring && boundary) || (cap && j % genStep === 0)) {
          this.point(i, j, false, A); this.point(i, j, true, B); seg(A, B);
        }
      }
    }
    return Float32Array.from(out);
  }
}

/** Sweep `solid` about the unit `axis` through the origin by every angle
 *  in [psi0, psi1] (radians; a window ≥ 2π is a full turn). */
export function sweepAboutAxis(solid: Solid, axis: THREE.Vector3, psi0: number, psi1: number,
                               slices = DEFAULTS.slices, rays = DEFAULTS.rays): RadialSolid {
  const a = axis.clone().normalize();
  const helper = Math.abs(a.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const e1 = new THREE.Vector3().crossVectors(helper, a).normalize();
  const e2 = new THREE.Vector3().crossVectors(a, e1).normalize();
  const [tLo, tHi] = solid.extent(a);
  const nT = Math.max(2, slices), nR = Math.max(8, rays);
  const pad = (tHi - tLo) * 1e-4 + 1e-9;
  const t0 = tLo + pad, dt = (tHi - pad - t0) / (nT - 1);
  const dth = 2 * Math.PI / nR;
  const r0 = new Float32Array(nT * nR).fill(NaN), r1 = new Float32Array(nT * nR).fill(NaN);
  const o = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < nT; i++) {
    o.copy(a).multiplyScalar(t0 + dt * i);
    for (let j = 0; j < nR; j++) {
      const th = dth * j;
      d.copy(e1).multiplyScalar(Math.cos(th)).addScaledVector(e2, Math.sin(th));
      const sp = solid.raySpan(o, d);
      if (sp) { r0[i * nR + j] = sp[0]; r1[i * nR + j] = sp[1]; }
    }
  }
  const rIn = new Float32Array(nT * nR).fill(NaN), rOut = new Float32Array(nT * nR).fill(NaN);
  const full = psi1 - psi0 >= 2 * Math.PI - 1e-9;
  for (let i = 0; i < nT; i++) {
    const base = i * nR;
    if (full) {
      let lo = Infinity, hi = -Infinity;
      for (let k = 0; k < nR; k++) {
        const v0 = r0[base + k]!, v1 = r1[base + k]!;
        if (v0 !== v0) continue;
        if (v0 < lo) lo = v0; if (v1 > hi) hi = v1;
      }
      if (lo !== Infinity) for (let j = 0; j < nR; j++) { rIn[base + j] = lo; rOut[base + j] = hi; }
      continue;
    }
    // direction j is covered by source directions k with θ_k ∈ [θ_j − psi1, θ_j − psi0]
    const kLo = Math.ceil(-psi1 / dth), kHi = Math.floor(-psi0 / dth);
    for (let j = 0; j < nR; j++) {
      let lo = Infinity, hi = -Infinity;
      for (let q = kLo; q <= kHi; q++) {
        const k = (((j + q) % nR) + nR) % nR;
        const v0 = r0[base + k]!, v1 = r1[base + k]!;
        if (v0 !== v0) continue;
        if (v0 < lo) lo = v0; if (v1 > hi) hi = v1;
      }
      if (lo !== Infinity) { rIn[base + j] = lo; rOut[base + j] = hi; }
    }
  }
  return new RadialSolid(a, e1, e2, t0, dt, nT, nR, rIn, rOut);
}

// ------------------------------------------------------------- the reach

function limitOf(limits: JointLimitList, j: number): [number, number] | null {
  const l = limits?.[j];
  if (!l || typeof l[0] !== "number" || typeof l[1] !== "number") return null;
  if (!Number.isFinite(l[0]) || !Number.isFinite(l[1]) || l[1] < l[0]) return null;
  return [l[0], l[1]];
}

function pathToRoot(chain: Chain, idx: number): ChainNode[] {
  const out: ChainNode[] = [];
  for (let i = idx; i >= 0; i = chain.nodes[i]!.parentIdx) out.push(chain.nodes[i]!);
  return out;   // leaf first
}

/** Compute both reach solids. Throws with an operator-readable message
 *  when a linear joint of the box has no finite limits (no box, no
 *  envelope — unchecked ≠ clean) or the chain is unresolvable. */
export function computeReach(
  machine: PartFrameMachine, jointLimits: JointLimitList, tlo: readonly number[], opts: ReachOptions = {},
): ReachResult {
  const t0 = performance.now();
  const o = { ...DEFAULTS, ...opts };
  const notes: string[] = [];
  const chain = buildChain(machine);
  if (chain.workIdx < 0 || chain.toolIdx < 0) throw new Error("work/tool group missing from machine.json");

  // Joint classes: the work chain above its topmost rotary + the whole tool
  // chain contribute LINEAR joints to the box and the tool chain its
  // ROTARY joints to the orbit; work rotaries are swept afterwards; a
  // linear joint under a work rotary would have to be swept in the rotated
  // frame — evaluated at 0 and said so.
  const workPath = pathToRoot(chain, chain.workIdx);     // work node first … root-most last
  const toolPath = pathToRoot(chain, chain.toolIdx);
  const workRotTop = workPath.findIndex(n => n.dofs.some(d => d.rotate)) >= 0
    ? Math.max(...workPath.map((n, i) => n.dofs.some(d => d.rotate) ? i : -1)) : -1;
  const boxJoints = new Set<number>();
  const toolRot: { joint: number }[] = [];
  for (const n of toolPath) for (const d of n.dofs) { if (d.rotate) toolRot.push({ joint: d.joint }); else boxJoints.add(d.joint); }
  workPath.forEach((n, i) => {
    for (const d of n.dofs) {
      if (d.rotate) continue;
      if (i > workRotTop) boxJoints.add(d.joint);
      else notes.push(`linear joint ${d.joint} sits under the work rotary — evaluated at 0`);
    }
  });
  let maxJoint = -1;
  for (const n of chain.nodes) for (const d of n.dofs) if (d.joint > maxJoint) maxJoint = d.joint;
  const jointVals: number[] = new Array(Math.max(0, maxJoint + 1)).fill(0);

  // Box corners over the linear joints (each must have finite limits).
  const lin = [...boxJoints].sort((a, b) => a - b).map(j => {
    const l = limitOf(jointLimits, j);
    if (!l) throw new Error(`joint ${j} has no finite soft limits — no travel box, no envelope`);
    return { joint: j, lo: l[0], hi: l[1] };
  });
  const corners = 1 << lin.length;

  // Head-rotary grid (a rotary without finite limits = a full turn).
  const rot = toolRot.map(({ joint }) => {
    let l = limitOf(jointLimits, joint);
    if (!l) { notes.push(`rotary joint ${joint} has no finite limits — sampled as a full turn`); l = [-180, 180]; }
    return { joint, lo: l[0], hi: l[1] };
  });
  let step = o.rotStepDeg;
  const countsFor = (s: number) => rot.map(r => Math.max(2, Math.ceil((r.hi - r.lo) / s) + 1));
  let counts = countsFor(step);
  while (counts.reduce((p, c) => p * c, 1) > o.maxRotSamples && step < 90) { step *= 1.5; counts = countsFor(step); }
  const samples = counts.reduce((p, c) => p * c, 1);

  // Tip in the ROOM frame — the zero-rotary work frame; without a work
  // rotary that IS the work frame (tipInRoomFrame would leave root coords).
  const tipRoom = chain.hasRoom ? tipInRoomFrame : tipInWorkFrame;
  const pts: THREE.Vector3[] = [];
  const idx = new Array(rot.length).fill(0);
  for (let s = 0; s < samples; s++) {
    rot.forEach((r, k) => { const n = counts[k]!; jointVals[r.joint] = n === 1 ? r.lo : r.lo + (r.hi - r.lo) * idx[k]! / (n - 1); });
    for (let c = 0; c < corners; c++) {
      lin.forEach((l, k) => { jointVals[l.joint] = (c >> k) & 1 ? l.hi : l.lo; });
      pts.push(tipRoom(chain, jointVals, tlo, new THREE.Vector3()));
    }
    for (let k = 0; k < rot.length; k++) { if (++idx[k]! < counts[k]!) break; idx[k] = 0; }
  }
  if (pts.length < 4) {
    // A machine with no travel box dimension (degenerate) — pad to a hullable set.
    while (pts.length < 4) pts.push(pts[0]!.clone().add(new THREE.Vector3(1e-3 * pts.length, 1e-3, 1e-3)));
  }
  const room = new HullSolid(pts);
  if (room.dropped > 0) notes.push(`hull: ${room.dropped} inconsistent faces dropped after ${room.attempts} attempts (outline has a hole)`);

  // Part sweep: from the room frame (linIdx frame minus roomOffset) down the
  // work path — base translate, then the node's rotations inverted.
  let part: Solid | null = null;
  if (chain.hasRoom && workRotTop >= 0) {
    let cur: Solid = new TranslatedSolid(room, chain.roomOffset.clone());   // → the linIdx frame
    for (let i = workRotTop; i >= 0; i--) {
      const n = workPath[i]!;
      cur = new TranslatedSolid(cur, n.base.clone().negate());
      for (const d of n.dofs) {
        if (!d.rotate) continue;
        let l = limitOf(jointLimits, d.joint);
        if (!l) { notes.push(`work rotary joint ${d.joint} has no finite limits — swept as a full turn`); l = [-180, 180]; }
        // The node rotates by v·sign about axisVec; the child frame sees the
        // parent's solid rotated by −v·sign.
        const a0 = THREE.MathUtils.degToRad(-l[1] * d.sign), a1 = THREE.MathUtils.degToRad(-l[0] * d.sign);
        cur = sweepAboutAxis(cur, d.axisVec, Math.min(a0, a1), Math.max(a0, a1), o.slices, o.rays);
      }
    }
    part = cur;
  }
  const roomTris = room.mesh();
  const partTris = part ? part.mesh() : null;
  return {
    roomTris, room, partTris, part,
    info: { samples, corners, hullFaces: room.planes.length, notes, ms: Math.round(performance.now() - t0) },
  };
}

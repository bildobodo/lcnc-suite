// three-mesh-bvh's OrientedBox.distanceToBox (0.9.14, still in 0.9.15) builds
// the axis-aligned box's edges with `max[f2]` where `max[f3]` belongs, so its
// edge-to-edge distances run against the wrong edges and the box-to-box
// distance can come out too LARGE. closestPointToGeometry prunes every bound
// at or past its threshold by exactly that distance: a bounded query then
// skips the bounds that hold the closest triangles and answers "nothing
// nearer" — 120 mm apart, asked below 121, it said none (the TWP gantry's
// saddle plates and side walls, the estimator hunt 2026-10-07). The sweep's
// pairDistance reads such an answer as "beyond the horizon" and its
// certificate jumps — the class of the 2026-10-06 horizon bug.
//
// The correction is the library's own algorithm with the right edges and a
// textbook segment distance (Ericson, Real-Time Collision Detection 5.1.9):
// boxes the library's separating-axis test cannot separate are 0 apart
// (it tests 6 of the 15 axes — it may call separated boxes intersecting,
// which only prunes less); separated ones are closest at a corner against
// the other box or at an edge pair. bvhBoxDistance.test.ts holds it to an
// exact reference and checks that the library's original is still wrong —
// when an update fixes it, that test says this file can go.
import * as THREE from "three";
import { OrientedBox } from "three-mesh-bvh";

const _c = new THREE.Vector3(), _q = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3();
const _corners = Array.from({ length: 8 }, () => new THREE.Vector3());

/** Squared distance between segments p1q1 and p2q2; the closest points land in a and b. */
function segSegSq(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _r.subVectors(p1, p2);
  const aa = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s: number, t: number;
  if (aa <= 1e-12 && e <= 1e-12) { s = 0; t = 0; }
  else if (aa <= 1e-12) { s = 0; t = Math.min(1, Math.max(0, f / e)); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-12) { t = 0; s = Math.min(1, Math.max(0, -c / aa)); }
    else {
      const bb = _d1.dot(_d2), den = aa * e - bb * bb;
      s = den !== 0 ? Math.min(1, Math.max(0, (bb * f - c * e) / den)) : 0;
      t = (bb * s + f) / e;
      if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / aa)); }
      else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (bb - c) / aa)); }
    }
  }
  a.copy(p1).addScaledVector(_d1, s);
  b.copy(p2).addScaledVector(_d2, t);
  return a.distanceToSquared(b);
}

// The 12 edges of a box whose corners are indexed x | y << 1 | z << 2 (the
// library's OrientedBox.points order): corner pairs one bit apart.
const EDGES: Array<[number, number]> = [];
for (let i = 0; i < 8; i++) for (let bit = 0; bit < 3; bit++) if (!(i & (1 << bit))) EDGES.push([i, i | (1 << bit)]);

function distanceToBox(this: any, box: THREE.Box3, threshold = 0, target1: THREE.Vector3 | null = null, target2: THREE.Vector3 | null = null): number {
  if (this.needsUpdate) this.update();
  if (this.intersectsBox(box)) {
    if (target1 || target2) {
      box.getCenter(_q);
      this.closestPointToPoint(_q, _c);
      box.clampPoint(_c, _q);
      if (target1) target1.copy(_c);
      if (target2) target2.copy(_q);
    }
    return 0;
  }
  const thr2 = threshold * threshold;
  const pts: THREE.Vector3[] = this.points;
  const { min, max } = box;
  let best = Infinity;
  const take = (d: number, p: THREE.Vector3, q: THREE.Vector3) => {
    if (d >= best) return false;
    best = d;
    if (target1) target1.copy(p);
    if (target2) target2.copy(q);
    return d < thr2;
  };
  for (const p of pts) {
    _q.copy(p).clamp(min, max);
    if (take(p.distanceToSquared(_q), p, _q)) return Math.sqrt(best);
  }
  for (let i = 0; i < 8; i++) {
    const c = _corners[i]!.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
    this.closestPointToPoint(c, _q);
    if (take(c.distanceToSquared(_q), _q, c)) return Math.sqrt(best);
  }
  for (const [i0, i1] of EDGES) {
    for (const [j0, j1] of EDGES) {
      const d = segSegSq(pts[i0]!, pts[i1]!, _corners[j0]!, _corners[j1]!, _a, _b);
      if (take(d, _a, _b)) return Math.sqrt(best);
    }
  }
  return Math.sqrt(best);
}

/** The library's own distanceToBox, kept for the test that shows it is still wrong. */
export const libraryDistanceToBox: (...args: any[]) => number = (OrientedBox.prototype as any).distanceToBox;

/** Puts the corrected distanceToBox on OrientedBox — every closest-point
 *  query of the library uses it. Idempotent. */
export function installBoxDistanceFix(): void {
  (OrientedBox.prototype as any).distanceToBox = distanceToBox;
}
export const fixedDistanceToBox = distanceToBox;

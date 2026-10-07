// The exact distance between two triangles, written apart from three-mesh-bvh
// — the independent reference the collision tests hold the library to
// (collisionBounds.test.ts, bvhBoxDistance.test.ts). Two triangles that do
// not intersect are closest at an edge pair or at a vertex and the other's
// face; intersecting ones are 0 apart. Plain and allocation-light, not fast:
// it is for brute-force checks, never for the sweep.
import * as THREE from "three";

type V = THREE.Vector3;
const _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _r = new THREE.Vector3();
const _c1 = new THREE.Vector3(), _c2 = new THREE.Vector3();

/** Distance between the segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentDistance(p1: V, q1: V, p2: V, q2: V): number {
  _d1.subVectors(q1, p1); _d2.subVectors(q2, p2); _r.subVectors(p1, p2);
  const a = _d1.dot(_d1), e = _d2.dot(_d2), f = _d2.dot(_r);
  let s: number, t: number;
  if (a <= 1e-12 && e <= 1e-12) return p1.distanceTo(p2);
  if (a <= 1e-12) { s = 0; t = THREE.MathUtils.clamp(f / e, 0, 1); }
  else {
    const c = _d1.dot(_r);
    if (e <= 1e-12) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
    else {
      const b = _d1.dot(_d2), den = a * e - b * b;
      s = den !== 0 ? THREE.MathUtils.clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = THREE.MathUtils.clamp(-c / a, 0, 1); }
      else if (t > 1) { t = 1; s = THREE.MathUtils.clamp((b - c) / a, 0, 1); }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s); _c2.copy(p2).addScaledVector(_d2, t);
  return _c1.distanceTo(_c2);
}

const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _pv = new THREE.Vector3(), _tv = new THREE.Vector3(), _qv = new THREE.Vector3(), _dv = new THREE.Vector3();
/** Does the segment p→q cross the triangle abc (Möller–Trumbore, t in [0, 1])? */
export function segmentHitsTriangle(p: V, q: V, a: V, b: V, c: V): boolean {
  _dv.subVectors(q, p); _e1.subVectors(b, a); _e2.subVectors(c, a);
  _pv.crossVectors(_dv, _e2);
  const det = _e1.dot(_pv);
  if (Math.abs(det) < 1e-12) return false;   // parallel: an edge pair or a vertex finds the distance
  const inv = 1 / det;
  _tv.subVectors(p, a);
  const u = _tv.dot(_pv) * inv; if (u < 0 || u > 1) return false;
  _qv.crossVectors(_tv, _e1);
  const v = _dv.dot(_qv) * inv; if (v < 0 || u + v > 1) return false;
  const t = _e2.dot(_qv) * inv;
  return t >= 0 && t <= 1;
}

const _tri = new THREE.Triangle(), _cp = new THREE.Vector3();
function pointTriangle(p: V, a: V, b: V, c: V): number {
  _tri.set(a, b, c);
  return _tri.closestPointToPoint(p, _cp).distanceTo(p);
}

/** The exact distance between triangles A and B (three vertices each). */
export function triangleDistance(A: readonly V[], B: readonly V[]): number {
  for (let i = 0; i < 3; i++) {
    if (segmentHitsTriangle(A[i]!, A[(i + 1) % 3]!, B[0]!, B[1]!, B[2]!)) return 0;
    if (segmentHitsTriangle(B[i]!, B[(i + 1) % 3]!, A[0]!, A[1]!, A[2]!)) return 0;
  }
  let best = Infinity;
  for (let i = 0; i < 3; i++) {
    best = Math.min(best, pointTriangle(A[i]!, B[0]!, B[1]!, B[2]!), pointTriangle(B[i]!, A[0]!, A[1]!, A[2]!));
    for (let j = 0; j < 3; j++) best = Math.min(best, segmentDistance(A[i]!, A[(i + 1) % 3]!, B[j]!, B[(j + 1) % 3]!));
  }
  return best;
}

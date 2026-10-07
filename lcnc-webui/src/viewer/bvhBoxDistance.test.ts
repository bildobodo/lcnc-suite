// The box-to-box distance closestPointToGeometry prunes by (bvhBoxDistance.ts):
// the correction against an exact reference over random boxes, and the
// library's original still wrong — when an update fixes it, the second test
// fails and the correction can go.
import * as THREE from "three";
import { OrientedBox } from "three-mesh-bvh";
import { describe, expect, it } from "vitest";
import { fixedDistanceToBox, installBoxDistanceFix, libraryDistanceToBox } from "./bvhBoxDistance";
import { triangleDistance } from "./triDistance";
import "./collision";

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const corners = (min: THREE.Vector3, max: THREE.Vector3, m?: THREE.Matrix4) =>
  Array.from({ length: 8 }, (_, i) => {
    const v = new THREE.Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
    return m ? v.applyMatrix4(m) : v;
  });
// A box's surface as 12 triangles (corners indexed x | y << 1 | z << 2).
const FACES = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
const surface = (c: THREE.Vector3[]) => FACES.flatMap(([a, b, d, e]) => [[c[a!]!, c[b!]!, c[d!]!], [c[a!]!, c[d!]!, c[e!]!]]);
// The exact distance between two boxes: 0 when no axis of the 15 separates
// them, else the closest pair of surface triangles.
function exact(A: THREE.Vector3[], B: THREE.Vector3[]): number {
  const axesOf = (c: THREE.Vector3[]) => [1, 2, 4].map(b => new THREE.Vector3().subVectors(c[b]!, c[0]!).normalize());
  const ea = axesOf(A), eb = axesOf(B);
  const axes = [...ea, ...eb, ...ea.flatMap(a => eb.map(b => new THREE.Vector3().crossVectors(a, b)))].filter(v => v.lengthSq() > 1e-10);
  const separated = axes.some(ax => {
    const pa = A.map(v => v.dot(ax)), pb = B.map(v => v.dot(ax));
    return Math.max(...pa) < Math.min(...pb) - 1e-9 || Math.max(...pb) < Math.min(...pa) - 1e-9;
  });
  if (!separated) return 0;
  let best = Infinity;
  for (const x of surface(A)) for (const y of surface(B)) best = Math.min(best, triangleDistance(x, y));
  return best;
}

describe("the box-to-box distance the bounded query prunes by", () => {
  const cases = () => {
    const rand = rng(20261007), out: Array<{ obb: OrientedBox; box: THREE.Box3; A: THREE.Vector3[]; B: THREE.Vector3[] }> = [];
    for (let k = 0; k < 600; k++) {
      // Elongated boxes (node bounds of long rails) at a few mm to a few
      // hundred apart; every fourth one axis-aligned, which makes edge
      // pairs the closest features.
      const half = () => new THREE.Vector3(1 + rand() * 80, 1 + rand() * 20, 1 + rand() * 5);
      const h1 = half(), h2 = half();
      const q = k % 4 === 0 ? new THREE.Quaternion()
        : new THREE.Quaternion().setFromEuler(new THREE.Euler(rand() * 6.3, rand() * 6.3, rand() * 6.3));
      const m = new THREE.Matrix4().compose(new THREE.Vector3((rand() - 0.5) * 300, (rand() - 0.5) * 300, (rand() - 0.5) * 300), q, new THREE.Vector3(1, 1, 1));
      const obb = new OrientedBox(new THREE.Vector3(), new THREE.Vector3());
      obb.set(h1.clone().negate(), h1.clone(), m);
      const c = new THREE.Vector3((rand() - 0.5) * 60, (rand() - 0.5) * 60, (rand() - 0.5) * 60);
      const box = new THREE.Box3(c.clone().sub(h2), c.clone().add(h2));
      out.push({ obb, box, A: corners(h1.clone().negate(), h1, m), B: corners(box.min, box.max) });
    }
    return out;
  };

  it("is installed on the library's OrientedBox", () => {
    installBoxDistanceFix();
    expect((OrientedBox.prototype as any).distanceToBox).toBe(fixedDistanceToBox);
  });

  it("is the exact distance wherever the boxes are apart, and never more", () => {
    let apart = 0;
    for (const { obb, box, A, B } of cases()) {
      const want = exact(A, B), got = fixedDistanceToBox.call(obb, box);
      expect(got, `never above the exact ${want}`).toBeLessThanOrEqual(want + 1e-6);
      if (!(obb as any).intersectsBox(box)) { apart++; expect(Math.abs(got - want), `apart: exactly ${want}`).toBeLessThanOrEqual(1e-6); }
    }
    expect(apart, "boxes apart").toBeGreaterThan(300);
  });

  it("the library's original is still too large somewhere (three-mesh-bvh ≤ 0.9.15)", () => {
    let over = 0, worst = 0;
    for (const { obb, box, A, B } of cases()) {
      const d = libraryDistanceToBox.call(obb, box) - exact(A, B);
      if (d > 1e-3) { over++; worst = Math.max(worst, d); }
    }
    expect(over, `cases where the original overstates the distance (worst by ${worst.toFixed(1)})`).toBeGreaterThan(0);
  });
});

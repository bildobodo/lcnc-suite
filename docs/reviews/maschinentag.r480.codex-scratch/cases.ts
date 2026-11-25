// P6-c5 scratch (no product code): the measured native meshes as the importer
// would deliver them (nested arrays, machine units).
export type V3 = [number, number, number];
export interface Mesh { vertices: V3[]; triangles: V3[] }
/** n-sided closed cylinder r x len: 2n+2 vertices, 4n triangles (2n side: long). */
export function cylinder(n: number, r = 4, len = 160): Mesh {
  const vertices: V3[] = [], triangles: V3[] = [];
  for (let k = 0; k < n; k++) {
    const a = 2 * Math.PI * k / n, x = r * Math.cos(a), y = r * Math.sin(a);
    vertices.push([x, y, 0], [x, y, len]);
  }
  const c0 = vertices.push([0, 0, 0]) - 1, c1 = vertices.push([0, 0, len]) - 1;
  for (let k = 0; k < n; k++) {
    const a = 2 * k, b = 2 * ((k + 1) % n);
    triangles.push([a, b, b + 1], [a, b + 1, a + 1], [c0, b, a], [c1, a + 1, b + 1]);
  }
  return { vertices, triangles };
}
/** A finely meshed revolved body (short facets): nz rings x ns sides. */
export function fine(nz: number, ns: number, len = 100): Mesh {
  const vertices: V3[] = [], triangles: V3[] = [];
  for (let i = 0; i <= nz; i++) for (let j = 0; j < ns; j++) {
    const z = len * i / nz, r = 2 + 2 * z / len + 0.3 * Math.sin(40 * z / len), a = 2 * Math.PI * j / ns;
    vertices.push([r * Math.cos(a), r * Math.sin(a), z]);
  }
  for (let i = 0; i < nz; i++) for (let j = 0; j < ns; j++) {
    const p = i * ns + j, q = i * ns + (j + 1) % ns;
    triangles.push([p, q, q + ns], [p, q + ns, p + ns]);
  }
  return { vertices, triangles };
}
/** The worst the importer accepts: every one of 200 000 triangles spans the
 *  whole length (two edges cross every plane). Closedness is not checked. */
export function worst(nTri = 200_000, len = 160): Mesh {
  const n = 50_000 - 1, vertices: V3[] = [], triangles: V3[] = [];
  for (let k = 0; k < n; k++) {
    const a = 2 * Math.PI * k / n;
    vertices.push([4 * Math.cos(a), 4 * Math.sin(a), 0], [4 * Math.cos(a), 4 * Math.sin(a), len]);
  }
  for (let t = 0; t < nTri; t++) {
    const k = t % n, m = (k + 1 + Math.floor(t / n)) % n;
    triangles.push(t % 2 ? [2 * k, 2 * m, 2 * m + 1] : [2 * k, 2 * k + 1, 2 * m + 1]);
  }
  return { vertices, triangles };
}
export const CASES: Record<string, () => Mesh> = {
  fine200k: () => fine(250, 400),        // 100 400 v, 200 000 t
  codex80k: () => cylinder(20_000),      // 40 002 v, 80 000 t
  long200k: () => cylinder(49_999),      // 100 000 v, 199 996 t
  worst200k: () => worst(),              // 99 998 v, 200 000 t, all spanning
};

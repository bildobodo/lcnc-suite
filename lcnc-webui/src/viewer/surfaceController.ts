// Surface-map controller (frontend split, A3 — extracted from ThreeViewer.vue).
//
// Renders the probe surface map: a viridis-coloured mesh from the scipy comp
// grid plus the raw probe points as a single InstancedMesh, grouped under the
// work-rotation group. build() atomically replaces the prior surface (disposing
// its geometry/materials/instanceMatrix — H6: it owns the group, so a scene
// rebuild can't leave a stale double-disposed reference behind).
//
// Factory: created once in <script setup>; build() takes a fresh ViewerCtx per
// call (scene/workRotGroup/workOrigin are reassigned per rebuild — never cached).
import * as THREE from "three";
import type { ViewerCtx } from "./viewerContext";

type Pt = [number, number, number];
export type CompGrid = { x: number[]; y: number[]; zi: number[][]; method: number };

// 5-stop viridis ramp, linearly interpolated. t is clamped to [0,1].
function viridis(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  const c: [number, number, number][] = [[68,1,84],[59,82,139],[33,145,140],[94,201,98],[253,231,37]];
  const idx = t * (c.length - 1);
  const i = Math.floor(idx);
  const f = idx - i;
  const a = c[Math.min(i, c.length - 1)]!;
  const b = c[Math.min(i + 1, c.length - 1)]!;
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export interface SurfaceController {
  /** Atomically (re)build the surface from points + grid, or clear it if the
   *  data is incomplete. No-op until scene/workOrigin exist. */
  build(ctx: ViewerCtx, pts: Pt[], grid: CompGrid | null | undefined): void;
  setVisible(on: boolean): void;
  /** Drop the group reference WITHOUT disposing — the scene teardown
   *  (clearScene/disposeObject) already freed it; this just prevents a stale
   *  double-dispose on the next build (H6). */
  forgetAfterSceneClear(): void;
  dispose(): void;
}

export function createSurfaceController(): SurfaceController {
  let group: THREE.Group | null = null;
  let visible = true;

  function disposeGroup() {
    if (group) {
      group.parent?.remove(group);
      group.traverse((o: any) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
        if (typeof o.dispose === "function") o.dispose();  // InstancedMesh.instanceMatrix
      });
      group = null;
    }
  }

  return {
    build(ctx, pts, grid) {
      if (!ctx.scene || !ctx.workOrigin) return;

      // Remove previous
      disposeGroup();

      // Atomic render: both surface points AND scipy comp grid required, or nothing
      if (!pts || pts.length < 3) return;
      if (!grid || grid.x.length < 2 || grid.y.length < 2) return;

      group = new THREE.Group();

      // Z-bounds for color mapping (taken from raw points)
      let zMin = Infinity, zMax = -Infinity;
      for (const p of pts) {
        if (p[2] < zMin) zMin = p[2]; if (p[2] > zMax) zMax = p[2];
      }
      const zRange = zMax - zMin || 0.001;

      // Build mesh from scipy-interpolated grid at 1:1 WCS scale
      const nx = grid.x.length, ny = grid.y.length;
      const gxRange = grid.x[nx - 1]! - grid.x[0]!;
      const gyRange = grid.y[ny - 1]! - grid.y[0]!;
      const geom = new THREE.PlaneGeometry(gxRange || 1, gyRange || 1, nx - 1, ny - 1);
      const posArr = geom.attributes.position!;
      const colors = new Float32Array(nx * ny * 3);  // pre-allocated, set by vertex index (P4.2)

      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const vi = iy * nx + ix;
          const gx = grid.x[ix]!, gy = grid.y[iy]!;
          let z = grid.zi[ix]?.[iy];
          // Complete grid expected — out-of-hull cells are filled server-side now
          // (compensation.py nearest backfill; a95fc7d "no IDW fallback"). A residual
          // null only means a stale/pre-fix grid file → render flat, no main-thread scan.
          if (z == null || !isFinite(z)) z = 0;
          posArr.setX(vi, gx);
          posArr.setY(vi, gy);
          posArr.setZ(vi, z);
          const t = (z - zMin) / zRange;
          const [r, g, b] = viridis(t);
          colors[vi * 3] = r / 255;
          colors[vi * 3 + 1] = g / 255;
          colors[vi * 3 + 2] = b / 255;
        }
      }
      geom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geom.computeVertexNormals();

      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      });
      group.add(new THREE.Mesh(geom, mat));

      // Probe-point dots as a single InstancedMesh (P4.2): one geometry + one draw call
      // instead of N separate Mesh objects, which each added scene-graph + per-frame
      // cull/draw overhead for as long as the surface stayed visible.
      const dotR = Math.min(gxRange || 1, gyRange || 1) * 0.012;
      const dotGeom = new THREE.SphereGeometry(dotR, 8, 8);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0xff3333 });
      const dots = new THREE.InstancedMesh(dotGeom, dotMat, pts.length);
      const _dotM = new THREE.Matrix4();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        _dotM.makeTranslation(p[0], p[1], p[2]);
        dots.setMatrixAt(i, _dotM);
      }
      dots.instanceMatrix.needsUpdate = true;
      group.add(dots);

      ctx.workRotGroup!.add(group);
      group.visible = visible;
      ctx.requestRender();
    },

    setVisible(on) {
      visible = on;
      if (group) group.visible = on;
    },

    forgetAfterSceneClear() { group = null; },

    dispose() { disposeGroup(); },
  };
}

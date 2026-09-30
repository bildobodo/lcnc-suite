// "On top" per layer (operator 2026-09-30: Settings → Layers' "on top"
// column). A layer drawn over the machine needs TWO things: no depth test,
// AND a draw after the machine — three sorts by renderOrder first, so a line
// at renderOrder 0 with its depth test off is still overwritten by a machine
// mesh drawn later. The order ladder (on top): boxes and reach under the path
// (10 / 11 / 12 — toolpathController), markers over it.
import type * as THREE from "three";

/** renderOrder bases while on top — each object keeps its own offset from
 *  its built order (a two-tone line's dashes stay over its solid line). */
export const ON_TOP_ORDER = {
  reach: 6,
  workplane: 7,
  box: 8,
  marker: 20,
} as const;

interface Base { renderOrder: number }
interface MatBase { depthTest: boolean }

/** Every drawn descendant of `root`: depth test off and drawn at
 *  `order` + its own built order while `on`; exactly as built when not
 *  (the built values are kept the first time the object is seen). */
export function applyOnTop(root: THREE.Object3D | null | undefined, on: boolean, order: number): void {
  root?.traverse(o => {
    const mats = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!mats) return;
    const base = (o.userData._onTopBase ??= { renderOrder: o.renderOrder }) as Base;
    o.renderOrder = on ? order + base.renderOrder : base.renderOrder;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      const mb = (m.userData._onTopBase ??= { depthTest: m.depthTest }) as MatBase;
      m.depthTest = on ? false : mb.depthTest;
    }
  });
}

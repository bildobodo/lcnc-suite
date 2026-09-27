// Unit tests for viewer/backplotController.ts (A3.2; 2 px ring of segments since
// the viewer contrast plan, E11). The ring buffer + THREE geometry are pure JS,
// so this runs headless. The drawn state is read off the line under the parent
// group (the controller doesn't expose internals): the segment count is the
// geometry's instanceCount, the segments its interleaved start/end records.
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import type { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { createBackplotController, BACKPLOT_WIDTH_PX } from "./backplotController";

const BACKPLOT_MAX = 20000;

function lineIn(parent: THREE.Object3D): LineSegments2 {
  return parent.children.find(c => (c as any).isLineSegments2) as LineSegments2;
}
/** The drawn segments as [x0, y0, z0, x1, y1, z1] tuples, in ring order. */
function segments(parent: THREE.Object3D): number[][] {
  const g = lineIn(parent).geometry as THREE.InstancedBufferGeometry;
  const arr = (g.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data.array as Float32Array;
  return Array.from({ length: g.instanceCount }, (_, i) => Array.from(arr.subarray(i * 6, i * 6 + 6)));
}
const instances = (parent: THREE.Object3D) => (lineIn(parent).geometry as THREE.InstancedBufferGeometry).instanceCount;

describe("backplotController", () => {
  it("build adds one 2 px screen-space line under the parent and starts empty; reset fires requestRender", () => {
    const rr = vi.fn();
    const c = createBackplotController(rr);
    const parent = new THREE.Group();
    c.build(parent, "#ff00ff", true);
    const line = lineIn(parent);
    expect(line, "a LineSegments2 — WebGL draws core lines 1 px wide").toBeTruthy();
    const mat = line.material as LineMaterial;
    expect(BACKPLOT_WIDTH_PX).toBe(2);
    expect(mat.linewidth, "the width ladder: path 1, backplot 2, selection 3").toBe(BACKPLOT_WIDTH_PX);
    expect(mat.worldUnits, "screen pixels").toBe(false);
    expect(mat.userData.role).toBe("backplot");
    expect(c.count).toBe(0);
    expect(instances(parent)).toBe(0);
    expect(rr).toHaveBeenCalled();      // build() ends with reset()
  });

  it("a single point draws nothing; each further point draws the segment from its predecessor", () => {
    const c = createBackplotController(vi.fn());
    const parent = new THREE.Group();
    c.build(parent, "#fff", true);
    c.push(0, 0, 0);
    expect(c.count).toBe(1);
    expect(instances(parent), "no segment of one point").toBe(0);
    c.push(1, 0, 0);
    c.push(2, 0, 0);
    expect(c.count).toBe(3);
    expect(segments(parent)).toEqual([[0, 0, 0, 1, 0, 0], [1, 0, 0, 2, 0, 0]]);
  });

  it("dedupes points closer than EPS (0.01 mm)", () => {
    const c = createBackplotController(vi.fn());
    const parent = new THREE.Group();
    c.build(parent, "#fff", true);
    c.push(0, 0, 0);
    c.push(0.001, 0, 0);   // within EPS → ignored
    expect(c.count).toBe(1);
    c.push(1, 0, 0);       // far enough
    expect(c.count).toBe(2);
    expect(segments(parent)).toEqual([[0, 0, 0, 1, 0, 0]]);
  });

  it("wraps at BACKPLOT_MAX: the window keeps the newest points and never joins the newest to the oldest", () => {
    const c = createBackplotController(vi.fn());
    const parent = new THREE.Group();
    c.build(parent, "#fff", true);
    for (let i = 0; i < BACKPLOT_MAX + 5; i++) c.push(i, 0, 0);   // 1 mm apart > EPS
    expect(c.count).toBe(BACKPLOT_MAX);
    expect(c.isFull).toBe(true);
    const s = segments(parent);
    expect(s).toHaveLength(BACKPLOT_MAX - 1);
    // Every drawn segment joins two CONSECUTIVE history points (1 mm apart) —
    // a strip over a ring would draw one from the newest back to the oldest.
    expect(s.filter(([x0, , , x1]) => x1! - x0! !== 1)).toEqual([]);
    // The window is the newest BACKPLOT_MAX points: the oldest dropped.
    const xs = s.map(([x0]) => x0!);
    expect(Math.min(...xs)).toBe(5);
    expect(Math.max(...s.map(([, , , x1]) => x1!))).toBe(BACKPLOT_MAX + 4);
  });

  it("a push uploads only the segment it wrote — no re-sort or full upload of the history", () => {
    const c = createBackplotController(vi.fn());
    const parent = new THREE.Group();
    c.build(parent, "#fff", true);
    const data = (lineIn(parent).geometry.getAttribute("instanceStart") as THREE.InterleavedBufferAttribute).data;
    c.push(0, 0, 0);
    c.push(1, 0, 0);
    c.push(2, 0, 0);
    expect(data.updateRanges).toEqual([{ start: 0, count: 6 }, { start: 6, count: 6 }]);
  });

  it("reset empties the window but keeps the allocation, and the next point does not join the old trail", () => {
    const c = createBackplotController(vi.fn());
    const parent = new THREE.Group();
    c.build(parent, "#fff", true);
    c.push(0, 0, 0); c.push(1, 0, 0);
    c.reset();
    expect(c.count).toBe(0);
    expect(instances(parent)).toBe(0);
    c.push(5, 0, 0);                       // still usable after reset
    expect(c.count).toBe(1);
    expect(instances(parent), "no segment back to the pre-reset point").toBe(0);
    c.push(6, 0, 0);
    expect(segments(parent)).toEqual([[5, 0, 0, 6, 0, 0]]);
  });

  it("ADVERSARIAL stale-pointer: after rebuild, push targets the NEW line, not the old", () => {
    const c = createBackplotController(vi.fn());
    const parentA = new THREE.Group();
    c.build(parentA, "#fff", true);
    c.push(0, 0, 0); c.push(1, 0, 0);
    expect(instances(parentA)).toBe(1);

    // Scene rebuild: fresh parent (the old line would be removed by clearScene).
    const parentB = new THREE.Group();
    c.build(parentB, "#fff", true);
    expect(c.count).toBe(0);              // build() reset the cursor
    c.push(9, 0, 0);
    c.push(10, 0, 0);

    // The new line (under B) received the points; A's geometry is untouched —
    // a cached stale pointer would have written into A's instead — and B does
    // not join the old trail.
    expect(segments(parentB)).toEqual([[9, 0, 0, 10, 0, 0]]);
    expect(segments(parentA)).toEqual([[0, 0, 0, 1, 0, 0]]);
    expect(lineIn(parentB)).not.toBe(lineIn(parentA));
  });

  it("setVisible / setColor / setDepthTest mutate the live material; dispose frees it", () => {
    const c = createBackplotController(vi.fn());
    const parent = new THREE.Group();
    c.build(parent, "#ff00ff", true);
    const line = lineIn(parent);
    const mat = line.material as LineMaterial;

    c.setVisible(false);
    expect(line.visible).toBe(false);
    c.setColor("#00ff00");
    expect(mat.color.getHexString()).toBe("00ff00");
    c.setDepthTest(false);
    expect(mat.depthTest).toBe(false);
    expect(mat.depthWrite).toBe(false);

    const geom = line.geometry;
    const disposeSpy = vi.spyOn(geom, "dispose");
    const matSpy = vi.spyOn(mat, "dispose");
    c.dispose();
    expect(disposeSpy).toHaveBeenCalledOnce();
    expect(matSpy).toHaveBeenCalledOnce();     // build()-created material freed too
    expect(parent.children).toHaveLength(0);   // removed from the graph
  });
});

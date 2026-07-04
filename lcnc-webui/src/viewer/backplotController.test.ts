// Unit tests for viewer/backplotController.ts (A3.2). The ring buffer + THREE
// geometry are pure JS, so this runs headless. drawRange is read off the line's
// geometry via the parent group (the controller doesn't expose internals).
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createBackplotController } from "./backplotController";

const BACKPLOT_MAX = 20000;

function lineIn(parent: THREE.Object3D): THREE.Line {
  return parent.children.find(c => (c as any).isLine) as THREE.Line;
}
function drawRange(parent: THREE.Object3D) {
  return (lineIn(parent).geometry as THREE.BufferGeometry).drawRange;
}

describe("backplotController", () => {
  it("build adds one line under the parent and starts empty; reset fires requestRender", () => {
    const rr = vi.fn();
    const c = createBackplotController(rr);
    const parent = new THREE.Group();
    c.build(parent, "#ff00ff", true);
    expect(lineIn(parent)).toBeTruthy();
    expect(c.count).toBe(0);
    expect(drawRange(parent).count).toBe(0);
    expect(rr).toHaveBeenCalled();      // build() ends with reset()
  });

  it("push appends points and grows the draw range", () => {
    const c = createBackplotController(vi.fn());
    const parent = new THREE.Group();
    c.build(parent, "#fff", true);
    c.push(0, 0, 0);
    c.push(1, 0, 0);
    c.push(2, 0, 0);
    expect(c.count).toBe(3);
    expect(drawRange(parent)).toMatchObject({ start: 0, count: 3 });
  });

  it("dedupes points closer than EPS (0.01 mm)", () => {
    const c = createBackplotController(vi.fn());
    c.build(new THREE.Group(), "#fff", true);
    c.push(0, 0, 0);
    c.push(0.001, 0, 0);   // within EPS → ignored
    expect(c.count).toBe(1);
    c.push(1, 0, 0);       // far enough
    expect(c.count).toBe(2);
  });

  it("wraps at BACKPLOT_MAX: count caps and the window slides to head", () => {
    const c = createBackplotController(vi.fn());
    const parent = new THREE.Group();
    c.build(parent, "#fff", true);
    for (let i = 0; i < BACKPLOT_MAX + 5; i++) c.push(i, 0, 0);   // 1 mm apart > EPS
    expect(c.count).toBe(BACKPLOT_MAX);
    expect(c.isFull).toBe(true);
    // Full buffer: drawRange starts at head (=5 after 5 wraps) and spans MAX.
    expect(drawRange(parent)).toMatchObject({ start: 5, count: BACKPLOT_MAX });
  });

  it("reset empties the window but keeps the allocation", () => {
    const c = createBackplotController(vi.fn());
    const parent = new THREE.Group();
    c.build(parent, "#fff", true);
    c.push(0, 0, 0); c.push(1, 0, 0);
    c.reset();
    expect(c.count).toBe(0);
    expect(drawRange(parent).count).toBe(0);
    c.push(5, 0, 0);                       // still usable after reset
    expect(c.count).toBe(1);
  });

  it("ADVERSARIAL stale-pointer: after rebuild, push targets the NEW line, not the old", () => {
    const c = createBackplotController(vi.fn());
    const parentA = new THREE.Group();
    c.build(parentA, "#fff", true);
    c.push(0, 0, 0); c.push(1, 0, 0);
    const geomA = lineIn(parentA).geometry as THREE.BufferGeometry;
    expect(geomA.drawRange.count).toBe(2);

    // Scene rebuild: fresh parent (the old line would be removed by clearScene).
    const parentB = new THREE.Group();
    c.build(parentB, "#fff", true);
    expect(c.count).toBe(0);              // build() reset the cursor
    c.push(9, 0, 0);

    // The new line (under B) received the point; A's geometry is untouched —
    // a cached stale pointer would have written into geomA instead.
    expect((lineIn(parentB).geometry as THREE.BufferGeometry).drawRange.count).toBe(1);
    expect(geomA.drawRange.count).toBe(2);
    expect(lineIn(parentB)).not.toBe(lineIn(parentA));
  });

  it("setVisible / setColor / setDepthTest mutate the live material; dispose frees it", () => {
    const c = createBackplotController(vi.fn());
    const parent = new THREE.Group();
    c.build(parent, "#ff00ff", true);
    const line = lineIn(parent);
    const mat = line.material as THREE.LineBasicMaterial;

    c.setVisible(false);
    expect(line.visible).toBe(false);
    c.setColor("#00ff00");
    expect(mat.color.getHexString()).toBe("00ff00");
    c.setDepthTest(false);
    expect(mat.depthTest).toBe(false);

    const geom = line.geometry as THREE.BufferGeometry;
    const disposeSpy = vi.spyOn(geom, "dispose");
    const matSpy = vi.spyOn(mat, "dispose");
    c.dispose();
    expect(disposeSpy).toHaveBeenCalledOnce();
    expect(matSpy).toHaveBeenCalledOnce();     // build()-created material freed too
    expect(parent.children).toHaveLength(0);   // removed from the graph
  });
});

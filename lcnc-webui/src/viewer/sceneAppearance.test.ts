import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createGroundGrid, createMachineLighting, updateGroundGridColors } from "./sceneAppearance";
import { disposeObject } from "./disposal";

describe("machine scene appearance", () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-400, -800, -500), new THREE.Vector3(800, 800, 1200));

  it("lights both sides and uses machine Z as the sky direction", () => {
    const rig = createMachineLighting();
    const sky = rig.children.find(c => c instanceof THREE.HemisphereLight)!;
    expect(sky.position.toArray()).toEqual([0, 0, 1]);
    const lights = rig.children.filter(c => c instanceof THREE.DirectionalLight);
    expect(lights.some(l => l.position.x < 0)).toBe(true);
    expect(lights.some(l => l.position.x > 0)).toBe(true);
    expect(lights.some(l => l.position.y > 0)).toBe(true);
  });

  it("centres a horizontal grid below the assembly without changing its bounds", () => {
    const original = bounds.clone();
    const grid = createGroundGrid(bounds, 1)!;
    expect(bounds.equals(original)).toBe(true);
    expect(grid.position.x).toBe(200);
    expect(grid.position.y).toBe(0);
    const actual = new THREE.Box3().setFromObject(grid);
    expect(actual.max.z).toBeLessThan(bounds.min.z);
    expect(actual.max.z - actual.min.z).toBeLessThan(1e-6);
    expect(actual.min.x).toBeLessThan(bounds.min.x);
    expect(actual.max.y).toBeGreaterThan(bounds.max.y);
    expect(grid.material.depthWrite).toBe(false);
    disposeObject(grid);
  });

  it("has the same physical spacing and elevation on inch machines", () => {
    const mm = createGroundGrid(bounds, 1)!;
    const inches = createGroundGrid(new THREE.Box3(bounds.min.clone().divideScalar(25.4), bounds.max.clone().divideScalar(25.4)), 1 / 25.4)!;
    expect(inches.position.clone().multiplyScalar(25.4).distanceTo(mm.position)).toBeLessThan(1e-6);
    const a = new THREE.Box3().setFromObject(mm).getSize(new THREE.Vector3());
    const b = new THREE.Box3().setFromObject(inches).getSize(new THREE.Vector3()).multiplyScalar(25.4);
    expect(a.distanceTo(b)).toBeLessThan(0.001);
    disposeObject(mm);
    disposeObject(inches);
  });

  it("updates the existing grid for a dark theme and disposes owned resources", () => {
    const grid = createGroundGrid(bounds, 1)!;
    updateGroundGridColors(grid, new THREE.Color("white"), new THREE.Color("black"));
    const colors = grid.geometry.getAttribute("color");
    const light = colors.getX(0);
    updateGroundGridColors(grid, new THREE.Color("black"), new THREE.Color("white"));
    expect(colors.getX(0)).toBeLessThan(light);
    expect(colors.getX(12 * 4)).toBeGreaterThan(colors.getX(0));
    const geometryDispose = vi.spyOn(grid.geometry, "dispose");
    const materialDispose = vi.spyOn(grid.material, "dispose");
    disposeObject(grid);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
  });

  it("omits the grid when no usable model or envelope exists", () => {
    expect(createGroundGrid(new THREE.Box3(), 1)).toBeNull();
    expect(createGroundGrid(new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()), 1)).toBeNull();
  });
});

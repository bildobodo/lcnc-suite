// Unit tests for viewer/surfaceController.ts (A3.3). THREE geometry/material
// ops are pure JS → headless. Asserts the atomic rebuild (prior surface
// disposed), the data/scene guards, and the H6 orphan guard.
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createSurfaceController, type CompGrid } from "./surfaceController";
import type { ViewerCtx } from "./viewerContext";

function makeCtx(over: Partial<ViewerCtx> = {}): ViewerCtx & { workRotGroup: THREE.Group } {
  const workRotGroup = new THREE.Group();
  return {
    scene: new THREE.Scene(),
    workRotGroup,
    workOrigin: new THREE.Group(),
    requestRender: vi.fn(),
    ...over,
  } as any;
}

const GRID: CompGrid = {
  x: [0, 10, 20], y: [0, 10, 20],
  zi: [[0, 1, 2], [1, 2, 3], [2, 3, 4]],
  method: 2,
};
const PTS: [number, number, number][] = [[0, 0, 0], [10, 10, 2], [20, 20, 4], [5, 5, 1]];

const surfaceGroupOf = (ctx: { workRotGroup: THREE.Group }) =>
  ctx.workRotGroup.children.find(c => c.type === "Group") as THREE.Group | undefined;

describe("surfaceController", () => {
  it("builds a viridis mesh + InstancedMesh dots under workRotGroup", () => {
    const c = createSurfaceController();
    const ctx = makeCtx();
    c.build(ctx, PTS, GRID);
    const g = surfaceGroupOf(ctx)!;
    expect(g).toBeTruthy();
    expect(g.children.some(o => (o as any).isMesh && !(o as any).isInstancedMesh)).toBe(true);
    const inst = g.children.find(o => (o as any).isInstancedMesh) as THREE.InstancedMesh;
    expect(inst.count).toBe(PTS.length);
    expect(ctx.requestRender).toHaveBeenCalled();
  });

  it("rebuild atomically disposes the prior surface's geometry + material", () => {
    const c = createSurfaceController();
    const ctx = makeCtx();
    c.build(ctx, PTS, GRID);
    const prev = surfaceGroupOf(ctx)!;
    const mesh = prev.children.find(o => (o as any).isMesh && !(o as any).isInstancedMesh) as THREE.Mesh;
    const gSpy = vi.spyOn(mesh.geometry as THREE.BufferGeometry, "dispose");
    const mSpy = vi.spyOn(mesh.material as THREE.Material, "dispose");

    c.build(ctx, PTS, GRID);   // rebuild
    expect(gSpy).toHaveBeenCalledOnce();
    expect(mSpy).toHaveBeenCalledOnce();
    expect(ctx.workRotGroup.children.filter(o => o.type === "Group")).toHaveLength(1); // not two
  });

  it("clears (and disposes) the surface when data is incomplete", () => {
    const c = createSurfaceController();
    const ctx = makeCtx();
    c.build(ctx, PTS, GRID);
    expect(surfaceGroupOf(ctx)).toBeTruthy();
    c.build(ctx, [[0, 0, 0]], GRID);       // <3 points → clear
    expect(surfaceGroupOf(ctx)).toBeUndefined();
    c.build(ctx, PTS, GRID);
    c.build(ctx, PTS, null);               // no grid → clear
    expect(surfaceGroupOf(ctx)).toBeUndefined();
  });

  it("no-ops before scene/workOrigin exist (no build, no dispose of prior)", () => {
    const c = createSurfaceController();
    const ctx = makeCtx();
    c.build(ctx, PTS, GRID);
    const prev = surfaceGroupOf(ctx)!;
    // scene not ready → must return BEFORE touching the existing surface.
    c.build(makeCtx({ scene: null, workRotGroup: ctx.workRotGroup }), PTS, GRID);
    expect(surfaceGroupOf(ctx)).toBe(prev);
  });

  it("setVisible toggles the live group", () => {
    const c = createSurfaceController();
    const ctx = makeCtx();
    c.build(ctx, PTS, GRID);
    c.setVisible(false);
    expect(surfaceGroupOf(ctx)!.visible).toBe(false);
    // applies to the NEXT build too
    c.build(ctx, PTS, GRID);
    expect(surfaceGroupOf(ctx)!.visible).toBe(false);
  });

  it("forgetAfterSceneClear drops the ref so the next build can't double-dispose (H6)", () => {
    const c = createSurfaceController();
    const ctx = makeCtx();
    c.build(ctx, PTS, GRID);
    const stale = surfaceGroupOf(ctx)!;
    const mesh = stale.children.find(o => (o as any).isMesh && !(o as any).isInstancedMesh) as THREE.Mesh;
    const gSpy = vi.spyOn(mesh.geometry as THREE.BufferGeometry, "dispose");

    // Simulate ensureCoreGroups: clearScene already freed `stale`; controller forgets it.
    c.forgetAfterSceneClear();
    c.build(makeCtx(), PTS, GRID);   // fresh workRotGroup (rebuild)
    expect(gSpy).not.toHaveBeenCalled();   // the forgotten group was NOT re-disposed
  });

  it("dispose frees the surface and detaches it", () => {
    const c = createSurfaceController();
    const ctx = makeCtx();
    c.build(ctx, PTS, GRID);
    const inst = surfaceGroupOf(ctx)!.children.find(o => (o as any).isInstancedMesh) as THREE.InstancedMesh;
    const iSpy = vi.spyOn(inst, "dispose");
    c.dispose();
    expect(iSpy).toHaveBeenCalledOnce();
    expect(surfaceGroupOf(ctx)).toBeUndefined();
  });
});

// Unit tests for viewer/disposal.ts (A2). THREE geometry/material .dispose()
// are pure JS (they only dispatch a 'dispose' event) — no WebGL context needed,
// so a constructed scene graph + dispose spies give a precise, deterministic
// guard for the disposal contract. This is the guard the renderer.info e2e
// probe CANNOT provide: renderer.info never counts material instances, and
// material leaks (edge materials, color clones orphaned per reconnect) are the
// genuinely unbounded A2 leak class.
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { disposeObject } from "./disposal";

function privateMesh() {
  const geom = new THREE.BufferGeometry();
  const mat = new THREE.MeshBasicMaterial();
  return { mesh: new THREE.Mesh(geom, mat), geom, mat };
}

function sharedMesh() {
  const geom = new THREE.BufferGeometry();
  geom.userData._shared = true;
  const mat = new THREE.MeshBasicMaterial();
  mat.userData._shared = true;
  return { mesh: new THREE.Mesh(geom, mat), geom, mat };
}

describe("disposeObject", () => {
  it("disposes private geometry AND private material (the leak the old helper missed)", () => {
    const { mesh, geom, mat } = privateMesh();
    const root = new THREE.Group();
    root.add(mesh);
    const gSpy = vi.spyOn(geom, "dispose");
    const mSpy = vi.spyOn(mat, "dispose");
    disposeObject(root);
    expect(gSpy).toHaveBeenCalledOnce();
    expect(mSpy).toHaveBeenCalledOnce();
  });

  it("skips _shared geometry AND _shared materials (cache geoms + MAT.* reused across rebuilds)", () => {
    const { mesh, geom, mat } = sharedMesh();
    const root = new THREE.Group();
    root.add(mesh);
    const gSpy = vi.spyOn(geom, "dispose");
    const mSpy = vi.spyOn(mat, "dispose");
    disposeObject(root);
    expect(gSpy).not.toHaveBeenCalled();
    expect(mSpy).not.toHaveBeenCalled();
  });

  it("handles a material array: disposes private members, skips shared members", () => {
    const geom = new THREE.BufferGeometry();
    const priv = new THREE.MeshBasicMaterial();
    const shared = new THREE.MeshBasicMaterial();
    shared.userData._shared = true;
    const mesh = new THREE.Mesh(geom, [priv, shared]);
    const root = new THREE.Group();
    root.add(mesh);
    const pSpy = vi.spyOn(priv, "dispose");
    const sSpy = vi.spyOn(shared, "dispose");
    disposeObject(root);
    expect(pSpy).toHaveBeenCalledOnce();
    expect(sSpy).not.toHaveBeenCalled();
  });

  it("recurses into the whole subtree (toolMarker = nested cutter/shaft/holder meshes)", () => {
    const root = new THREE.Group();
    const a = privateMesh(), b = privateMesh();
    const inner = new THREE.Group();
    inner.add(b.mesh);
    root.add(a.mesh);
    root.add(inner);
    const spies = [a.geom, a.mat, b.geom, b.mat].map(r => vi.spyOn(r, "dispose"));
    disposeObject(root);
    for (const s of spies) expect(s).toHaveBeenCalledOnce();
  });

  it("a private clone of a shared material IS disposed once _shared is cleared (H4 gotcha)", () => {
    // THREE.Material.clone() deep-copies userData, so a clone of a _shared MAT.*
    // inherits _shared=true and would wrongly survive teardown. The per-part
    // colour clones (buildFromInit + setMachinePartColor) clear it to false;
    // this pins that disposeObject then frees them. The raw-inherited case is
    // the bug, shown alongside so the requirement is explicit.
    const base = new THREE.MeshStandardMaterial();
    base.userData._shared = true;

    const inheritedClone = base.clone();          // still _shared=true (the trap)
    expect(inheritedClone.userData._shared).toBe(true);

    const privateClone = base.clone();
    privateClone.userData._shared = false;        // what the fix does

    const root = new THREE.Group();
    const g1 = new THREE.BufferGeometry(), g2 = new THREE.BufferGeometry();
    root.add(new THREE.Mesh(g1, inheritedClone));
    root.add(new THREE.Mesh(g2, privateClone));
    const inheritedSpy = vi.spyOn(inheritedClone, "dispose");
    const privateSpy = vi.spyOn(privateClone, "dispose");

    disposeObject(root);
    expect(privateSpy, "private clone must be freed").toHaveBeenCalledOnce();
    expect(inheritedSpy, "an un-cleared clone would leak — that's why the fix clears _shared")
      .not.toHaveBeenCalled();
  });

  it("calls InstancedMesh.dispose() to free its instanceMatrix (surface probe dots)", () => {
    const geom = new THREE.BufferGeometry();
    const mat = new THREE.MeshBasicMaterial();
    const inst = new THREE.InstancedMesh(geom, mat, 4);
    const iSpy = vi.spyOn(inst, "dispose");
    const root = new THREE.Group();
    root.add(inst);
    disposeObject(root);
    expect(iSpy).toHaveBeenCalledOnce();
  });
});

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { fixtureLocalMatrix } from "./fixtureLocal";

// The machine-xyzacb-trsrn work chain: a_table [-1700,0,0] rotating about X
// (joint 3, sign -1) → a_work [700,1000,2000]. `_workGrp` is a_work.
function tableChain(aDeg: number) {
  const root = new THREE.Group();
  const table = new THREE.Group();
  table.position.set(-1700, 0, 0);
  table.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -THREE.MathUtils.degToRad(aDeg));
  const work = new THREE.Group();
  work.position.set(700, 1000, 2000);
  root.add(table);
  table.add(work);
  work.updateWorldMatrix(true, false);
  return { root, table, work, W: work.matrixWorld.clone() };
}

const POSE = { pos: [50, 40, -30], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const near = (v: THREE.Vector3, x: number, y: number, z: number) => {
  expect(v.x).toBeCloseTo(x, 6); expect(v.y).toBeCloseTo(y, 6); expect(v.z).toBeCloseTo(z, 6);
};

describe("fixtureLocalMatrix", () => {
  const W0 = tableChain(0).W;

  it("W0 of the trsrn chain is T(-1000,1000,2000), not the identity", () => {
    const p = new THREE.Vector3().setFromMatrixPosition(W0);
    near(p, -1000, 1000, 2000);
  });

  it("A=0: the local transform equals the machine-frame pose (identity case)", () => {
    const m = fixtureLocalMatrix(W0, W0, POSE);
    near(new THREE.Vector3().setFromMatrixPosition(m), 50, 40, -30);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    expect(q.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 9);
  });

  it("A=30: the triad's WORLD position equals W0·pose — it stays put in the room", () => {
    const { W } = tableChain(30);
    const local = fixtureLocalMatrix(W, W0, POSE);
    const world = new THREE.Matrix4().copy(W).multiply(local);
    // expected = W0 · pose.pos
    const exp = new THREE.Vector3(50, 40, -30).applyMatrix4(W0);
    near(new THREE.Vector3().setFromMatrixPosition(world), exp.x, exp.y, exp.z);
    const q = new THREE.Quaternion().setFromRotationMatrix(world);
    expect(q.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 9);
  });

  it("A=30 with a rotated pose basis (Rz 90°): the world basis is unchanged by the table angle", () => {
    const { W } = tableChain(30);
    const pose = { pos: [0, 0, 0], x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] };
    const world = new THREE.Matrix4().copy(W).multiply(fixtureLocalMatrix(W, W0, pose));
    const xw = new THREE.Vector3().setFromMatrixColumn(world, 0);
    near(xw, 0, 1, 0);
  });

  it("does not allocate per call when `out` is supplied", () => {
    const out = new THREE.Matrix4();
    const r = fixtureLocalMatrix(W0, W0, POSE, out);
    expect(r).toBe(out);
  });
});

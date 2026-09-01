// Where a MACHINE-frame pose goes when it is drawn under a MOVING group whose
// LOCAL frame is machine coordinates.
//
// The viewer's work group (`_workGrp`) is that group: every machine-frame
// object (workOrigin, the plane overlay, backplot, bounds) attaches under it
// and reads its position as machine coordinates — the group's static base
// translates are arranged so that at all-zero joints local == machine. But
// its WORLD matrix at zero joints, W0, is NOT the identity on any chain with
// static bases (machine-xyzacb-trsrn: a_table [-1700,0,0] → a_work
// [700,1000,2000] gives W0 = T(-1000,1000,2000)); only the 3-axis dev model
// has W0 = I, which is how a `W(A)⁻¹ · pose` counter-transform shipped and
// drew the active-fixture triad (+1000,-1000,-2000) mm off (operator-caught:
// "Zero All does not move the G54 triad to the tool tip").
//
// A machine-frame pose P that must stay put in the room while the table
// turns is therefore  local = W(A)⁻¹ · W0 · P  — identity at zero joints,
// a pure counter-rotation about the table pivot otherwise. Callers must
// refresh W(A) through the ANCESTOR chain (`updateWorldMatrix(true, false)`):
// `updateMatrixWorld()` on the child composes with the parent's LAST-frame
// matrix and lags the table by one frame (the "jumpy datum").

import * as THREE from "three";

export interface FixturePoseLike {
  pos: readonly number[];
  x: readonly number[];
  y: readonly number[];
  z: readonly number[];
}

const _p = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _inv = new THREE.Matrix4();

/** `out` = W⁻¹ · W0 · P, where P is the pose as a rigid transform (basis
 *  columns x/y/z, origin pos). No allocation per call. */
export function fixtureLocalMatrix(
  W: THREE.Matrix4,
  W0: THREE.Matrix4,
  pose: FixturePoseLike,
  out: THREE.Matrix4 = new THREE.Matrix4(),
): THREE.Matrix4 {
  _p.makeBasis(
    _x.set(pose.x[0]!, pose.x[1]!, pose.x[2]!),
    _y.set(pose.y[0]!, pose.y[1]!, pose.y[2]!),
    _z.set(pose.z[0]!, pose.z[1]!, pose.z[2]!),
  );
  _p.setPosition(pose.pos[0]!, pose.pos[1]!, pose.pos[2]!);
  _inv.copy(W).invert();
  return out.copy(_inv).multiply(W0).multiply(_p);
}

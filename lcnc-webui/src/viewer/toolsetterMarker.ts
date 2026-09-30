// The tool setter in the 3D view (operator 2026-09-29: "ist die Position
// bekannt, wo er auslöst? … eine Anzeige der Kontaktposition"). A puck in the
// MACHINE frame (machineFrameGrp, like the machine box) at the WebUI's tool
// setter position — where the next measurement the WebUI starts probes:
//
// - centre at touchX / touchY (#3100 / #3101, G53);
// - TOP face at touchZ (#3102): the machine Z of the control point when a
//   zero-length tool touches — the plate top exactly where the spindle nose
//   face is drawn at that joint Z (the tool routine: length = contact Z − #3102).
//
// Only for a SET-UP tool setter (confirmedToolsetter().ok): TOOLSETTER_FALLBACK's
// zeros are no position. A machine part, so its greys come from the model's
// ladder (viewer/palette.ts MACHINE_PALETTE) — no palette role of its own.
import * as THREE from "three";
import type { ToolsetterSetup } from "../toolsetterSetup";
import { MACHINE_PALETTE } from "./palette";

/** The puck's size in mm (scaled by the viewer's unit scale). */
export const TOOLSETTER_DIAMETER_MM = 30;
export const TOOLSETTER_HEIGHT_MM = 40;
/** The contact face: a lighter disc on top, this thick. */
export const TOOLSETTER_CAP_MM = 2;

export interface ToolsetterPlacement { x: number; y: number; topZ: number }

/** Where the puck's top centre goes (machine units), or null when the tool
 *  setter is not set up. Pure. */
export function toolsetterPlacement(setup: ToolsetterSetup): ToolsetterPlacement | null {
  if (!setup.ok) return null;
  const { touchX, touchY, touchZ } = setup.values;
  if (![touchX, touchY, touchZ].every(Number.isFinite)) return null;
  return { x: touchX, y: touchY, topZ: touchZ };
}

/** The puck: body + a lighter contact face, its ORIGIN at the top centre (so
 *  placing the group puts the contact face at the placement). Z up. */
export function buildToolsetterMarker(unitScale: number, surface: THREE.MeshStandardMaterialParameters): THREE.Group {
  const r = (TOOLSETTER_DIAMETER_MM / 2) * unitScale;
  const h = TOOLSETTER_HEIGHT_MM * unitScale;
  const cap = TOOLSETTER_CAP_MM * unitScale;
  const group = new THREE.Group();
  group.name = "toolsetter";
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, h - cap, 40).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ ...surface, color: MACHINE_PALETTE.steel }));
  body.position.z = -cap - (h - cap) / 2;
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(r, r, cap, 40).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ ...surface, color: MACHINE_PALETTE.marks }));
  face.position.z = -cap / 2;
  body.userData.part = face.userData.part = "toolsetter";
  group.add(body, face);
  return group;
}

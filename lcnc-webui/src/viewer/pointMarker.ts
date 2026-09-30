// A POINT the operator wants to find in the 3D view — the tool setter's
// contact point, the tool-change position (operator 2026-09-30: "eine
// Markierung mit Beschriftung, die man gut sieht — anstelle eines Modells").
// A neutral pin: a cross lying at the point and a stem rising from it, in the
// boxes' two tones (a dark line with light dashes over it: one of them reads
// on any background and on every grey of the model), and a label above the
// stem. No axis triad — it must not read as a work coordinate system. Drawn
// over the machine by default (Settings → Layers' "on top" column), and the
// same size ON SCREEN at every zoom: the pin is built in CSS px and the
// viewer scales it by the world size of a pixel at its point every frame
// (scalePointMarker) — in millimetres a 30 mm cross was a few pixels in the
// whole-machine view.
import * as THREE from "three";
import { makeTwoToneSegments, type TwoToneLines } from "./boxLines";

/** Every size in CSS px (the group is scaled to world units per frame). */
export const POINT_MARKER = {
  /** Stem height above the point; the label sits over its top. */
  stemPx: 40,
  /** Half the cross's arm length. */
  crossPx: 12,
  /** The label's text height and its gap over the stem. */
  labelPx: 13,
  labelGapPx: 12,
  /** Line width and dash — the path's width: a marker is looked for. */
  px: 2,
  dashPx: 4,
} as const;

/** The pin as segment pairs (six floats each) about the point at the origin,
 *  in CSS px: the cross in the XY plane, then the stem up +Z. Pure. */
export function pointMarkerSegments(): Float32Array {
  const c = POINT_MARKER.crossPx, h = POINT_MARKER.stemPx;
  return new Float32Array([
    -c, 0, 0, c, 0, 0,
    0, -c, 0, 0, c, 0,
    0, 0, 0, 0, 0, h,
  ]);
}

export interface PointMarker extends THREE.Group {
  setColors(color: string, alt: string): void;
}

/** The pin with its label (the caller's text object, POINT_MARKER.labelPx
 *  high — the viewer builds its labels with the bundled font), origin at the
 *  point, in CSS px until scalePointMarker sizes it. */
export function buildPointMarker(o: { color: string; alt: string; label: THREE.Object3D; name: string }): PointMarker {
  const group = new THREE.Group() as PointMarker;
  group.name = o.name;
  const lines: TwoToneLines = makeTwoToneSegments(pointMarkerSegments(), {
    color: o.color, alt: o.alt, width: POINT_MARKER.px, dashPx: POINT_MARKER.dashPx, role: "marker",
  });
  group.add(lines);
  o.label.position.set(0, 0, POINT_MARKER.stemPx + POINT_MARKER.labelGapPx + POINT_MARKER.labelPx / 2);
  group.add(o.label);
  group.setColors = (color, alt) => lines.setColors(color, alt);
  return group;
}

const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();

/** Pose the pin for this frame: one of its units = one CSS px at its point
 *  (`worldPerPx` = world units per CSS px there — boxLines.worldPerPixel),
 *  and its label UP ON SCREEN from the point (`cameraUp` = the camera's up
 *  in world coordinates) — seen from above the stem points at the eye, and a
 *  label up the stem covered the cross. */
export function posePointMarker(m: THREE.Object3D, worldPerPx: number, cameraUp: THREE.Vector3): void {
  if (Number.isFinite(worldPerPx) && worldPerPx > 0) m.scale.setScalar(worldPerPx);
  const label = m.children.find(c => !(c as THREE.Group).isGroup);
  if (!label) return;
  m.getWorldQuaternion(_q).invert();
  _up.copy(cameraUp).applyQuaternion(_q).normalize();
  label.position.copy(_up).multiplyScalar(POINT_MARKER.stemPx + POINT_MARKER.labelGapPx + POINT_MARKER.labelPx / 2);
}

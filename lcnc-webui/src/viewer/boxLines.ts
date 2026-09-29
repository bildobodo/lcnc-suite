// The viewer's two boxes (operator 2026-09-29, replacing the cased edges of
// fixed palette P2): ONE screen-space line each, no casing — the machine
// bounds solid and a little wider than a path line, the toolpath bounds
// dashed at the path's width and named by its size labels. Their colour is
// the theme's neutral (`--viewer-bounds` / `--viewer-toolpath-bounds`: dark
// on a light scene, light on a dark one) — the boxes may follow the theme,
// the path lines never do.
//
// A LineSegments2 over the edges' segment pairs (the source geometry is
// copied, not kept): widths are CSS px, the line respects depth (a box never
// hides a path in front of it).
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/** The machine-bounds box, CSS px — wider than the path's 1 px. */
export const MACHINE_BOX_PX = 2;
/** The toolpath-bounds box, CSS px — the path's width, dashed. */
export const TOOLPATH_BOX_PX = 1;

export interface BoxEdgesOptions {
  color: string;
  /** CSS px. */
  width: number;
  /** The palette role (`userData.role`). */
  role: string;
  /** Dash and gap in the edges' local units; absent = solid. */
  dashed?: { dash: number; gap: number };
  clippingPlanes?: THREE.Plane[];
}

export interface BoxEdges extends LineSegments2 {
  setColor(color: string): void;
}

export function makeBoxEdges(edges: THREE.BufferGeometry, o: BoxEdgesOptions): BoxEdges {
  const geom = new LineSegmentsGeometry().setPositions(edges.getAttribute("position").array as Float32Array);
  const mat = new LineMaterial({ color: o.color, linewidth: o.width, worldUnits: false });
  mat.userData.role = o.role;
  if (o.dashed) {
    mat.dashed = true;
    mat.dashSize = o.dashed.dash;
    mat.gapSize = o.dashed.gap;
  }
  if (o.clippingPlanes) mat.clippingPlanes = o.clippingPlanes;
  const line = new LineSegments2(geom, mat) as BoxEdges;
  line.onBeforeRender = (renderer) => { renderer.getSize(mat.resolution); };
  if (o.dashed) line.computeLineDistances();
  line.setColor = (color) => { mat.color.set(color); };
  return line;
}

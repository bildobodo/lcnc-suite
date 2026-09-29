// The viewer's two boxes (operator 2026-09-29): TWO-TONE edges — a dark
// solid line with light dashes drawn over it, like the selection border of a
// drawing program. One of the two tones reads on any background and on any
// grey of the machine model (a single neutral vanished wherever a model part
// had its lightness), so the pair is the same in every theme
// (`--viewer-bounds` / `--viewer-toolpath-bounds` dark, `--viewer-bounds-alt`
// light). No casing: both passes are the same width. The machine box has
// long dashes, the toolpath box short ones and its size labels.
//
// Both passes are screen-space lines (LineSegments2) over ONE geometry built
// at the box's real size — never a unit cube under a non-uniform scale, which
// would stretch the dashes differently along X, Y and Z. The dash length is
// held in CSS px: each frame it is re-expressed in the box's local units at
// its distance from the camera (world units per pixel). Both passes respect
// depth (a box never hides a path in front of it); the dashes draw after the
// solid line at the same depth.
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

/** Both boxes, CSS px — the width of every drawn line (operator: 2 px). */
export const MACHINE_BOX_PX = 2;
export const TOOLPATH_BOX_PX = 2;
/** Dash (= gap) length, CSS px: the machine box long, the toolpath box short. */
export const MACHINE_BOX_DASH_PX = 10;
export const TOOLPATH_BOX_DASH_PX = 5;

export interface BoxEdgesOptions {
  /** The dark tone — the role's colour. */
  color: string;
  /** The light tone of the dashes. */
  alt: string;
  /** CSS px. */
  width: number;
  /** Dash and gap length, CSS px. */
  dashPx: number;
  /** The dark tone's palette role (`userData.role`); the dashes are `${role}Alt`. */
  role: string;
  clippingPlanes?: THREE.Plane[];
}

export interface BoxEdges extends THREE.Group {
  setColors(color: string, alt: string): void;
  /** Rebuild the edges for a box of this size, centred on the group's origin. */
  setSize(sx: number, sy: number, sz: number): void;
}

/** The twelve edges of an axis-aligned box centred on the origin, as segment pairs. */
export function boxEdgePositions(sx: number, sy: number, sz: number): Float32Array {
  const box = new THREE.BoxGeometry(Math.max(sx, 1e-3), Math.max(sy, 1e-3), Math.max(sz, 1e-3));
  const edges = new THREE.EdgesGeometry(box);
  const out = Float32Array.from(edges.getAttribute("position").array as Float32Array);
  box.dispose();
  edges.dispose();
  return out;
}

const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _camPos = new THREE.Vector3();

/** World units per CSS pixel at `obj`'s origin, seen by `camera` over a
 *  drawing area `heightPx` tall. */
export function worldPerPixel(camera: THREE.Camera, obj: THREE.Object3D, heightPx: number): number {
  if (!(heightPx > 0)) return 1;
  const ortho = camera as THREE.OrthographicCamera;
  if (ortho.isOrthographicCamera) return (ortho.top - ortho.bottom) / ortho.zoom / heightPx;
  const persp = camera as THREE.PerspectiveCamera;
  obj.getWorldPosition(_pos);
  camera.getWorldPosition(_camPos);
  const dist = Math.max(1e-6, _pos.distanceTo(_camPos));
  return (2 * dist * Math.tan(THREE.MathUtils.degToRad(persp.fov ?? 45) / 2)) / (persp.zoom || 1) / heightPx;
}

export function makeBoxEdges(size: [number, number, number], o: BoxEdgesOptions): BoxEdges {
  const geom = new LineSegmentsGeometry().setPositions(boxEdgePositions(...size));
  const material = (color: string, role: string) => {
    const m = new LineMaterial({ color, linewidth: o.width, worldUnits: false });
    m.userData.role = role;
    if (o.clippingPlanes) m.clippingPlanes = o.clippingPlanes;
    return m;
  };
  const solidMat = material(o.color, o.role);
  const dashMat = material(o.alt, `${o.role}Alt`);
  dashMat.dashed = true;
  const solid = new LineSegments2(geom, solidMat);
  const dashes = new LineSegments2(geom, dashMat);
  dashes.renderOrder = 1;
  dashes.computeLineDistances();
  solid.onBeforeRender = (renderer) => { renderer.getSize(solidMat.resolution); };
  const group = new THREE.Group() as BoxEdges;
  // Object3D's full signature: LineSegments2 declares a renderer-only one.
  (dashes as THREE.Object3D).onBeforeRender = (renderer, _scene, camera) => {
    renderer.getSize(dashMat.resolution);
    group.getWorldScale(_scale);
    const d = (o.dashPx * worldPerPixel(camera, group, dashMat.resolution.y)) / Math.max(1e-9, _scale.x);
    dashMat.dashSize = d;
    dashMat.gapSize = d;
  };
  group.add(solid, dashes);
  group.setColors = (color, alt) => { solidMat.color.set(color); dashMat.color.set(alt); };
  // A new geometry per size: replaced attributes of a live geometry keep
  // their GL buffers until the geometry itself is disposed.
  group.setSize = (sx, sy, sz) => {
    const old = solid.geometry;
    const next = new LineSegmentsGeometry().setPositions(boxEdgePositions(sx, sy, sz));
    solid.geometry = next;
    dashes.geometry = next;
    dashes.computeLineDistances();
    old.dispose();
  };
  return group;
}

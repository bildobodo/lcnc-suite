// The viewer's two boxes (operator 2026-09-29): TWO-TONE edges — a dark
// solid line with light dashes drawn over it, like the selection border of a
// drawing program. One of the two tones reads on any background and on any
// grey of the machine model (a single neutral vanished wherever a model part
// had its lightness), so the pair is the same in every theme
// (`--viewer-bounds` / `--viewer-toolpath-bounds` dark, `--viewer-bounds-alt`
// light). No casing: both passes are the same width. The machine box has
// long dashes, the toolpath box short ones and its size labels; the reach
// outlines are the same two tones at 1 px, dotted (makeTwoToneSegments).
//
// Both passes are screen-space lines (LineSegments2) over ONE geometry built
// at the box's real size. The dashes are measured in CSS px ALONG EACH
// PROJECTED SEGMENT, in the shader (screenDash): a world dash length scaled
// at the group's centre kept the zoom but not the edge's direction or its
// perspective depth — a Y edge read 5 px where 10 were promised, a receding X
// edge under 1 px (Codex R44 VP-I10). Each segment's pattern starts at its
// first end (a box edge is one segment; a reach cage's short segments restart
// theirs). Both passes respect depth (a box never hides a path in front of
// it); the dashes draw after the solid line at the same depth.
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
/** The reach outlines (Machine / Part Reach layers): the same two tones,
 *  thinner and dotted — context lines, quieter than the boxes. */
export const REACH_PX = 1;
export const REACH_DASH_PX = 3;

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
const _camPos = new THREE.Vector3();

// ── screen-space dashes (Codex R44 VP-I10) ────────────────────────────────
// LineMaterial dashes by a per-instance WORLD distance. screenDash replaces
// it, for this material only (define SCREEN_DASH — its own program), by the
// distance from the segment's first end in CSS px on screen: 0 at the first
// end, the projected length at the other. Varyings interpolate
// perspective-correctly (linear in the world, not on screen) and GLSL ES 3.00
// has no `noperspective`: the vertex writes d·w and w, the fragment divides —
// the ratio interpolates linearly on screen. The anchors are LineMaterial's
// own source (three r182); a missing one throws — a three upgrade must fail
// loudly, never draw world dashes again.
const SD_VERT_DECL = "varying float vLineDistance;";
const SD_VERT_MAIN = "gl_Position = clip;";
const SD_FRAG_DECL = "varying float vLineDistance;";
const SD_FRAG_TEST = "if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX";

function replaceOnce(src: string, anchor: string, by: string, where: string): string {
  const at = src.indexOf(anchor);
  if (at < 0 || src.indexOf(anchor, at + 1) >= 0) {
    throw new Error(`screenDash: the ${where} anchor "${anchor}" is not in LineMaterial's shader exactly once`);
  }
  return src.slice(0, at) + by + src.slice(at + anchor.length);
}

export function screenDashShaders(vertex: string, fragment: string): { vertex: string; fragment: string } {
  const varyings = "\n\t\tvarying float vDashW;\n\t\tvarying float vDashInvW;\n";
  let v = replaceOnce(vertex, SD_VERT_DECL, SD_VERT_DECL + varyings, "vertex declaration");
  v = replaceOnce(v, SD_VERT_MAIN, `${SD_VERT_MAIN}
			#ifdef SCREEN_DASH
				vec2 sdPx = ( ndcEnd.xy - ndcStart.xy ) * 0.5 * resolution;
				float dPx = ( position.y < 0.5 ) ? 0.0 : length( sdPx );
				vDashW = dPx * clip.w;
				vDashInvW = clip.w;
			#endif`, "vertex main");
  let f = replaceOnce(fragment, SD_FRAG_DECL, SD_FRAG_DECL + varyings, "fragment declaration");
  f = replaceOnce(f, SD_FRAG_TEST, `#ifdef SCREEN_DASH
				if ( mod( vDashW / vDashInvW + dashOffset, dashSize + gapSize ) > dashSize ) discard;
			#else
				${SD_FRAG_TEST}
			#endif`, "fragment dash test");
  return { vertex: v, fragment: f };
}

/** Dash `m` in CSS px along each projected segment: `px` on, `px` off. */
export function screenDash(m: LineMaterial, px: number): void {
  m.dashed = true;
  m.defines.SCREEN_DASH = "";
  m.dashSize = px;
  m.gapSize = px;
  m.onBeforeCompile = shader => {
    const s = screenDashShaders(shader.vertexShader, shader.fragmentShader);
    shader.vertexShader = s.vertex;
    shader.fragmentShader = s.fragment;
  };
  m.customProgramCacheKey = () => "screenDash";
}

/** World units per CSS pixel at `obj`'s origin, seen by `camera` over a
 *  drawing area `heightPx` tall (a scale at one point — no longer the box
 *  dashes' rule, see screenDash). */
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

/** Any segment soup as a two-tone line: the dark solid pass and the light
 *  dashes over it, one width, one geometry (the reach outlines use it too). */
export interface TwoToneLines extends THREE.Group {
  setColors(color: string, alt: string): void;
}

export function makeTwoToneSegments(positions: Float32Array, o: BoxEdgesOptions & { renderOrder?: number }): TwoToneLines {
  const geom = new LineSegmentsGeometry().setPositions(positions);
  const material = (color: string, role: string) => {
    const m = new LineMaterial({ color, linewidth: o.width, worldUnits: false });
    m.userData.role = role;
    if (o.clippingPlanes) m.clippingPlanes = o.clippingPlanes;
    return m;
  };
  const solidMat = material(o.color, o.role);
  const dashMat = material(o.alt, `${o.role}Alt`);
  screenDash(dashMat, o.dashPx);
  const solid = new LineSegments2(geom, solidMat);
  const dashes = new LineSegments2(geom, dashMat);
  solid.renderOrder = o.renderOrder ?? 0;
  dashes.renderOrder = solid.renderOrder + 1;
  dashes.computeLineDistances();   // LineMaterial's own dash attributes (unused under SCREEN_DASH)
  solid.onBeforeRender = (renderer) => { renderer.getSize(solidMat.resolution); };
  dashes.onBeforeRender = (renderer) => { renderer.getSize(dashMat.resolution); };
  const group = new THREE.Group() as TwoToneLines;
  group.add(solid, dashes);
  group.setColors = (color, alt) => { solidMat.color.set(color); dashMat.color.set(alt); };
  return group;
}

export function makeBoxEdges(size: [number, number, number], o: BoxEdgesOptions): BoxEdges {
  const group = makeTwoToneSegments(boxEdgePositions(...size), o) as BoxEdges;
  const [solid, dashes] = group.children as LineSegments2[];
  // A new geometry per size: replaced attributes of a live geometry keep
  // their GL buffers until the geometry itself is disposed.
  group.setSize = (sx, sy, sz) => {
    const old = solid!.geometry;
    const next = new LineSegmentsGeometry().setPositions(boxEdgePositions(sx, sy, sz));
    solid!.geometry = next;
    dashes!.geometry = next;
    dashes!.computeLineDistances();
    old.dispose();
  };
  return group;
}

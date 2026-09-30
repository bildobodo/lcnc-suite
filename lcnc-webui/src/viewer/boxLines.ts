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
// first end (a box edge is one segment). A soup of SHORT segments (the reach
// cage: ~40 % under one dash on screen) would read all light that way — every
// segment would start with a light dash (Codex R45 VP-I12): with `tones`
// the segments are chained through their shared ends and alternate a tone
// along each chain (alternateTones), and a segment shorter than two dash
// periods on screen draws WHOLLY in its tone. Both passes respect depth (a box never hides a path in front of
// it); the dashes draw after the solid line at the same depth.
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { counted, countedGeometry, f32 } from "./allocMeter";

/** Both boxes (and the toolpath box's overflow edges), CSS px: 1 — the
 *  boxes are context, quieter than the 2 px path (operator 2026-09-30:
 *  "weniger präsent"; the two tones keep them readable on any grey). */
export const MACHINE_BOX_PX = 1;
export const TOOLPATH_BOX_PX = 1;
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

/** The twelve edges of an axis-aligned box centred on the origin, as segment
 *  pairs — written out, no BoxGeometry / EdgesGeometry built and dropped for
 *  it (their arrays were scratch the toolpath ledger never saw, Codex R48). */
export function boxEdgePositions(sx: number, sy: number, sz: number): Float32Array {
  const h = [Math.max(sx, 1e-3) / 2, Math.max(sy, 1e-3) / 2, Math.max(sz, 1e-3) / 2];
  const out = f32(12 * 6);
  let o = 0;
  // per axis a: the four edges along a, at every sign pair of the other two
  for (let a = 0; a < 3; a++) {
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
      for (const sa of [-1, 1]) {
        out[o + a] = sa * h[a]!; out[o + b] = sb * h[b]!; out[o + c] = sc * h[c]!;
        o += 3;
      }
    }
  }
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
  const varyings = "\n\t\tvarying float vDashW;\n\t\tvarying float vDashInvW;\n\t\tvarying float vTone;\n\t\tvarying float vSegPx;\n";
  const toneAttr = "\n\t\t#ifdef SCREEN_DASH_TONE\n\t\t\tattribute float instanceTone;\n\t\t#endif\n";
  let v = replaceOnce(vertex, SD_VERT_DECL, SD_VERT_DECL + varyings + toneAttr, "vertex declaration");
  v = replaceOnce(v, SD_VERT_MAIN, `${SD_VERT_MAIN}
			#ifdef SCREEN_DASH
				vec2 sdPx = ( ndcEnd.xy - ndcStart.xy ) * 0.5 * resolution;
				float dPx = ( position.y < 0.5 ) ? 0.0 : length( sdPx );
				vDashW = dPx * clip.w;
				vDashInvW = clip.w;
				vSegPx = length( sdPx );
				#ifdef SCREEN_DASH_TONE
					vTone = instanceTone;
				#else
					vTone = 1.0;
				#endif
			#endif`, "vertex main");
  let f = replaceOnce(fragment, SD_FRAG_DECL, SD_FRAG_DECL + varyings, "fragment declaration");
  f = replaceOnce(f, SD_FRAG_TEST, `#ifdef SCREEN_DASH
				#ifdef SCREEN_DASH_TONE
					if ( vSegPx < 2.0 * ( dashSize + gapSize ) ) {
						if ( vTone < 0.5 ) discard;   // a short segment: wholly its chain's tone
					} else if ( mod( vDashW / vDashInvW + dashOffset, dashSize + gapSize ) > dashSize ) discard;
				#else
					if ( mod( vDashW / vDashInvW + dashOffset, dashSize + gapSize ) > dashSize ) discard;
				#endif
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

/** A tone per segment (0 = the dark line shows, 1 = the light dash draws),
 *  alternating along each CHAIN of segments that meet end to end at a vertex
 *  shared by exactly two segments; a junction (three or more) or an open end
 *  ends a chain. Pure. `positions` = segment pairs, 6 floats each; ends are
 *  matched exactly (the reach worker computes a shared point once). */
export function alternateTones(positions: Float32Array | number[]): Float32Array {
  const n = Math.floor(positions.length / 6);
  const key = (s: number, e: number) => {
    const o = s * 6 + e * 3;
    return `${positions[o]},${positions[o + 1]},${positions[o + 2]}`;
  };
  const at = new Map<string, number[]>();   // vertex → the segment ends there (s * 2 + e)
  for (let s = 0; s < n; s++) for (let e = 0; e < 2; e++) {
    const k = key(s, e);
    const l = at.get(k);
    if (l) l.push(s * 2 + e); else at.set(k, [s * 2 + e]);
  }
  /** The segment end continuing a chain through `s`'s end `e`, or -1. */
  const next = (s: number, e: number) => {
    const l = at.get(key(s, e))!;
    if (l.length !== 2) return -1;
    return l[0] === s * 2 + e ? l[1]! : l[0]!;
  };
  const tones = f32(n).fill(-1);
  for (let s0 = 0; s0 < n; s0++) {
    if (tones[s0] !== -1) continue;
    // back to the chain's start: an open end, a junction, or once around a ring
    let s = s0, e = 0;
    for (let steps = 0; steps < n; steps++) {
      const o = next(s, e);
      if (o < 0 || (o >> 1) === s0) break;
      s = o >> 1; e = 1 - (o & 1);
    }
    // forward from there, alternating
    let tone = 0, cs = s, ce = 1 - e;
    for (let steps = 0; steps < n && tones[cs] === -1; steps++) {
      tones[cs] = tone;
      tone = 1 - tone;
      const o = next(cs, ce);
      if (o < 0) break;
      cs = o >> 1; ce = 1 - (o & 1);
    }
  }
  return tones;
}

export function makeTwoToneSegments(positions: Float32Array, o: BoxEdgesOptions & { renderOrder?: number; tones?: boolean }): TwoToneLines {
  const geom = new LineSegmentsGeometry();
  countedGeometry(geom);   // three's own quad mesh (allocMeter: the toolpath box is a build's too)
  geom.setPositions(positions);
  if (o.tones) geom.setAttribute("instanceTone", new THREE.InstancedBufferAttribute(alternateTones(positions), 1));
  const material = (color: string, role: string) => {
    const m = new LineMaterial({ color, linewidth: o.width, worldUnits: false });
    m.userData.role = role;
    if (o.clippingPlanes) m.clippingPlanes = o.clippingPlanes;
    return m;
  };
  const solidMat = material(o.color, o.role);
  const dashMat = material(o.alt, `${o.role}Alt`);
  screenDash(dashMat, o.dashPx);
  if (o.tones) {
    dashMat.defines.SCREEN_DASH_TONE = "";
    dashMat.customProgramCacheKey = () => "screenDashTone";
  }
  const solid = new LineSegments2(geom, solidMat);
  const dashes = new LineSegments2(geom, dashMat);
  solid.renderOrder = o.renderOrder ?? 0;
  dashes.renderOrder = solid.renderOrder + 1;
  dashes.computeLineDistances();   // LineMaterial's own dash attributes (unused under SCREEN_DASH)
  countedLineDistances(geom);
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
    const next = new LineSegmentsGeometry();
    countedGeometry(next);
    next.setPositions(boxEdgePositions(sx, sy, sz));
    solid!.geometry = next;
    dashes!.geometry = next;
    dashes!.computeLineDistances();
    countedLineDistances(next);
    old.dispose();
  };
  return group;
}

/** The per-instance distances three's computeLineDistances just allocated. */
export function countedLineDistances(g: THREE.BufferGeometry): void {
  counted((g.getAttribute("instanceDistanceStart") as THREE.InterleavedBufferAttribute | undefined)?.data.array as Float32Array | undefined);
}

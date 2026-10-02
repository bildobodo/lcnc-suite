// The viewer's two boxes (operator 2026-09-29): TWO-TONE edges — a dark
// solid line with light cells drawn over it, like the selection border of a
// drawing program. One of the two tones reads on any background and on any
// grey of the machine model (a single neutral vanished wherever a model part
// had its lightness), so the pair is the same in every theme
// (`--viewer-bounds` / `--viewer-toolpath-bounds` dark, `--viewer-bounds-alt`
// light). No casing: both passes are the same width.
//
// ONE pattern for every bound (package 4, operator 2026-10-01: the dashes
// "ändern beim Zoomen die Länge der Elemente", lines here and dots there):
// the machine box, the toolpath box (its orange overflow edges too) and both
// reach outlines draw the GEOMETRY-ANCHORED cells of GeoDashState — N = 2^k
// equal cells per unit (a box edge, a reach chain), phased at the unit's
// fixed first end, N held with hysteresis so the mean visible cell stays
// 6 … 12 CSS px (viewer/geoDash.ts; plan docs/reviews/viewer-marks.plan.md,
// Codex R62–R65). It replaces R44 VP-I10's screen-px dash, which crawled
// along each edge as its projected length changed. The toolpath box is told
// from the machine box by its dimension end marks and its label, not by a
// dash length. The pins keep a screen dash (screenDash): a marker in CSS px
// has no geometry to anchor to.
//
// Every pass is a screen-space line (LineSegments2) over ONE geometry built
// at the box's real size. Both passes respect depth (a box never hides a
// path in front of it); the light cells draw after the solid line.
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { counted, countedGeometry, f32, u32 } from "./allocMeter";
import { chooseCells, clipParam, GEO_CELLS_MIN } from "./geoDash";

/** Both boxes (and the toolpath box's overflow edges), CSS px: 1 — the
 *  boxes are context, quieter than the 2 px path (operator 2026-09-30:
 *  "weniger präsent"; the two tones keep them readable on any grey). */
export const MACHINE_BOX_PX = 1;
export const TOOLPATH_BOX_PX = 1;
/** The reach outlines (Machine / Part Reach layers): the same two tones and
 *  the same geometry-anchored pattern as the boxes (package 4: one pattern
 *  for every bound — no dots), 1 px. */
export const REACH_PX = 1;

export interface BoxEdgesOptions {
  /** The dark tone — the role's colour. */
  color: string;
  /** The light tone of the dashes. */
  alt: string;
  /** CSS px. */
  width: number;
  /** Dash and gap length, CSS px — the pins' screen dash only; the bounds
   *  carry the geometry-anchored pattern (GeoDashState). */
  dashPx?: number;
  /** The dark tone's palette role (`userData.role`); the dashes are `${role}Alt`. */
  role: string;
  clippingPlanes?: THREE.Plane[];
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

// ── geometry-anchored dashes (package 4, plan Fassungen 2–3.1) ─────────────
// The bounds' light tone draws the ODD cells of N equal cells per UNIT (a
// box edge, a reach chain), phased at the unit's fixed first end (t = 0):
// the pattern hangs on the geometry and grows with it while zooming — the
// screen-px dash of R44 VP-I10 crawled along every edge as its projected
// length changed. Per instance: `instanceGeoT` = the unit parameter t at the
// segment's stored ends, `instanceGeoCells` = its unit's N (GeoDashState
// chooses it per frame on the CPU, with hysteresis — the shader is
// stateless). t is world-linear, so the varying interpolates it
// perspective-correctly; where LineMaterial trims a segment that reaches
// behind the camera (trimSegment, the near estimate) the trimmed end gets
// the t of the trim point, the same alpha — the cells stay at the real world
// end (Codex R63's near-plane case). Anchors are LineMaterial's own source.
const GD_VERT_END = "vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );";

export function geoDashShaders(vertex: string, fragment: string): { vertex: string; fragment: string } {
  const decl = "\n\t\tattribute vec2 instanceGeoT;\n\t\tattribute float instanceGeoCells;\n\t\tvarying float vGeoT;\n\t\tvarying float vGeoCells;\n";
  let v = replaceOnce(vertex, SD_VERT_DECL, SD_VERT_DECL + decl, "vertex declaration");
  v = replaceOnce(v, GD_VERT_END, `${GD_VERT_END}
			{
				float gTS = instanceGeoT.x, gTE = instanceGeoT.y;
				if ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ) {
					float gNear = - 0.5 * projectionMatrix[ 3 ][ 2 ] / projectionMatrix[ 2 ][ 2 ];
					if ( start.z < 0.0 && end.z >= 0.0 ) gTE = mix( gTS, gTE, ( gNear - start.z ) / ( end.z - start.z ) );
					else if ( end.z < 0.0 && start.z >= 0.0 ) gTS = mix( gTE, gTS, ( gNear - end.z ) / ( start.z - end.z ) );
				}
				vGeoT = ( position.y < 0.5 ) ? gTS : gTE;
				vGeoCells = instanceGeoCells;
			}`, "vertex end point");
  let f = replaceOnce(fragment, SD_FRAG_DECL, SD_FRAG_DECL + "\n\t\tvarying float vGeoT;\n\t\tvarying float vGeoCells;\n", "fragment declaration");
  f = replaceOnce(f, SD_FRAG_TEST, "if ( mod( floor( vGeoT * vGeoCells ), 2.0 ) < 0.5 ) discard;   // even cells: the dark carrier shows", "fragment dash test");
  return { vertex: v, fragment: f };
}

/** Draw `m` as the light tone of the geometry-anchored pattern. */
export function geoDash(m: LineMaterial): void {
  m.dashed = true;
  m.defines.GEO_DASH = "";
  m.onBeforeCompile = shader => {
    const s = geoDashShaders(shader.vertexShader, shader.fragmentShader);
    shader.vertexShader = s.vertex;
    shader.fragmentShader = s.fragment;
  };
  m.customProgramCacheKey = () => "geoDash";
}

/** The units of a segment soup and their cell counts — the per-frame state
 *  (Fassung 2 A'.3). `unitOf` / `t` per segment, `order` lists a unit's
 *  segments in parameter order. */
export class GeoDashState {
  readonly cells: Float32Array;            // the instance attribute's array
  readonly attrs: THREE.InstancedBufferAttribute[] = [];
  private readonly n: Uint32Array;         // N per unit
  private readonly a4 = [0, 0, 0, 0];
  private readonly b4 = [0, 0, 0, 0];
  private readonly st = [0, 0];
  private readonly mvp = new THREE.Matrix4();

  readonly positions: Float32Array;   // the segment pairs (6 floats each)
  readonly unitOf: Uint32Array;       // per segment
  readonly t: Float32Array;           // per segment: t at stored end 0, end 1
  readonly starts: Uint32Array;       // unit u: order[starts[u] … starts[u + 1])
  readonly order: Uint32Array;

  constructor(positions: Float32Array, unitOf: Uint32Array, t: Float32Array, starts: Uint32Array, order: Uint32Array) {
    this.positions = positions; this.unitOf = unitOf; this.t = t; this.starts = starts; this.order = order;
    this.cells = f32(unitOf.length).fill(GEO_CELLS_MIN);
    this.n = u32(starts.length - 1).fill(GEO_CELLS_MIN);
  }

  /** N of every unit (diagnostics). */
  cellsOf(): number[] { return Array.from(this.n); }

  /** Every array the state holds (the toolpath ledger counts them). */
  arrays(): ArrayBufferView[] { return [this.positions, this.unitOf, this.t, this.starts, this.order, this.cells, this.n]; }

  /** Re-choose every unit's N for this view; upload only when one changed.
   *  `cssW`/`cssH` = the drawing area in CSS px. */
  update(object: THREE.Object3D, camera: THREE.Camera, cssW: number, cssH: number): boolean {
    this.mvp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(object.matrixWorld);
    const e = this.mvp.elements, P = this.positions;
    const proj = (o: number, out: number[]) => {
      const x = P[o]!, y = P[o + 1]!, z = P[o + 2]!;
      out[0] = e[0]! * x + e[4]! * y + e[8]! * z + e[12]!;
      out[1] = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
      out[2] = e[2]! * x + e[6]! * y + e[10]! * z + e[14]!;
      out[3] = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
    };
    const hx = cssW / 2, hy = cssH / 2, a = this.a4, b = this.b4, st = this.st;
    let changed = false;
    for (let u = 0; u + 1 < this.starts.length; u++) {
      let ratio = 0, pieceL = 0, pieceDt = 0, open = false;
      for (let k = this.starts[u]!; k < this.starts[u + 1]!; k++) {
        const s = this.order[k]!;
        proj(s * 6, a); proj(s * 6 + 3, b);
        const ta = this.t[s * 2]!, tb = this.t[s * 2 + 1]!;
        const fwd = tb >= ta;   // the chain runs from stored end 0 to end 1
        if (!clipParam(a, b, st)) {
          if (open && pieceDt > 0) ratio = Math.max(ratio, pieceL / pieceDt);
          open = false; pieceL = 0; pieceDt = 0;
          continue;
        }
        const [s0, s1] = [st[0]!, st[1]!];
        // a piece continues when the previous visible part reached this
        // segment's back end and this one starts there
        const back = fwd ? s0 === 0 : s1 === 1;
        if (open && !back) { if (pieceDt > 0) ratio = Math.max(ratio, pieceL / pieceDt); pieceL = 0; pieceDt = 0; }
        const w0 = a[3]! + s0 * (b[3]! - a[3]!), w1 = a[3]! + s1 * (b[3]! - a[3]!);
        const x0 = (a[0]! + s0 * (b[0]! - a[0]!)) / w0 * hx, y0 = (a[1]! + s0 * (b[1]! - a[1]!)) / w0 * hy;
        const x1 = (a[0]! + s1 * (b[0]! - a[0]!)) / w1 * hx, y1 = (a[1]! + s1 * (b[1]! - a[1]!)) / w1 * hy;
        pieceL += Math.hypot(x1 - x0, y1 - y0);
        pieceDt += Math.abs(tb - ta) * (s1 - s0);
        open = fwd ? s1 === 1 : s0 === 0;   // reaches this segment's front end
        if (!open) { if (pieceDt > 0) ratio = Math.max(ratio, pieceL / pieceDt); pieceL = 0; pieceDt = 0; }
      }
      if (open && pieceDt > 0) ratio = Math.max(ratio, pieceL / pieceDt);
      const n = chooseCells(ratio, this.n[u]!);
      if (n !== this.n[u]) {
        this.n[u] = n;
        for (let k = this.starts[u]!; k < this.starts[u + 1]!; k++) this.cells[this.order[k]!] = n;
        changed = true;
      }
    }
    if (changed) for (const attr of this.attrs) attr.needsUpdate = true;
    return changed;
  }
}

/** A box's twelve edges as twelve units, each phased at its smaller
 *  coordinate (boxEdgePositions writes that end first). */
export function boxGeoState(positions: Float32Array): GeoDashState {
  const n = Math.floor(positions.length / 6);
  const unitOf = u32(n), t = f32(2 * n), starts = u32(n + 1), order = u32(n);
  for (let s = 0; s < n; s++) { unitOf[s] = s; t[s * 2] = 0; t[s * 2 + 1] = 1; starts[s] = s; order[s] = s; }
  starts[n] = n;
  return new GeoDashState(positions, unitOf, t, starts, order);
}

/** A pattern for diagnostics: per unit its cell count; per segment its unit,
 *  its world end points and the unit parameter t at them. */
export function patternDiag(g: GeoTwoTone): { cells: number[]; segments: { unit: number; a: number[]; b: number[]; ta: number; tb: number }[] } {
  g.updateWorldMatrix(true, false);
  const st = g.geo, p = st.positions, segments = [];
  for (let s = 0; s * 6 < p.length; s++) {
    const a = new THREE.Vector3(p[s * 6]!, p[s * 6 + 1]!, p[s * 6 + 2]!).applyMatrix4(g.matrixWorld);
    const b = new THREE.Vector3(p[s * 6 + 3]!, p[s * 6 + 4]!, p[s * 6 + 5]!).applyMatrix4(g.matrixWorld);
    segments.push({ unit: st.unitOf[s]!, a: a.toArray(), b: b.toArray(), ta: st.t[s * 2]!, tb: st.t[s * 2 + 1]! });
  }
  return { cells: st.cellsOf(), segments };
}

/** Give `geom` the pattern's instance attributes from `state` (one cells
 *  attribute per geometry, all updated together). */
export function attachGeo(geom: LineSegmentsGeometry, state: GeoDashState): void {
  geom.setAttribute("instanceGeoT", new THREE.InstancedBufferAttribute(state.t, 2));
  const cells = new THREE.InstancedBufferAttribute(state.cells, 1);
  cells.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute("instanceGeoCells", cells);
  state.attrs.push(cells);
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
  const geom = new LineSegmentsGeometry();
  countedGeometry(geom);   // three's own quad mesh (allocMeter: the toolpath box is a build's too)
  geom.setPositions(positions);
  const material = (color: string, role: string) => {
    const m = new LineMaterial({ color, linewidth: o.width, worldUnits: false });
    m.userData.role = role;
    if (o.clippingPlanes) m.clippingPlanes = o.clippingPlanes;
    return m;
  };
  const solidMat = material(o.color, o.role);
  const dashMat = material(o.alt, `${o.role}Alt`);
  screenDash(dashMat, o.dashPx ?? 3);
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

/** A two-tone line carrying the geometry-anchored pattern (package 4): the
 *  dark solid pass and the light ODD cells over it, one width, one geometry
 *  with the state's instance attributes. Per frame: `geo.update(...)`. */
export interface GeoTwoTone extends TwoToneLines {
  geo: GeoDashState;
}

export function makeGeoTwoTone(state: GeoDashState, o: BoxEdgesOptions & { renderOrder?: number }): GeoTwoTone {
  const geom = new LineSegmentsGeometry();
  countedGeometry(geom);   // three's own quad mesh (allocMeter) — setPositions keeps the
  geom.setPositions(state.positions);   // state's positions without a copy, and the
  attachGeo(geom, state);  // state's attributes f32 counted already
  const material = (color: string, role: string) => {
    const m = new LineMaterial({ color, linewidth: o.width, worldUnits: false });
    m.userData.role = role;
    if (o.clippingPlanes) m.clippingPlanes = o.clippingPlanes;
    return m;
  };
  const solidMat = material(o.color, o.role);
  const dashMat = material(o.alt, `${o.role}Alt`);
  geoDash(dashMat);
  const solid = new LineSegments2(geom, solidMat);
  const dashes = new LineSegments2(geom, dashMat);
  solid.renderOrder = o.renderOrder ?? 0;
  dashes.renderOrder = solid.renderOrder + 1;
  dashes.computeLineDistances();   // LineMaterial reads them under USE_DASH (the pattern does not)
  countedLineDistances(geom);
  solid.onBeforeRender = (renderer) => { renderer.getSize(solidMat.resolution); };
  dashes.onBeforeRender = (renderer) => { renderer.getSize(dashMat.resolution); };
  const group = new THREE.Group() as GeoTwoTone;
  group.add(solid, dashes);
  group.geo = state;
  group.setColors = (color, alt) => { solidMat.color.set(color); dashMat.color.set(alt); };
  return group;
}

export interface BoxEdges extends GeoTwoTone {
  /** Rebuild the edges for a box of this size, centred on the group's origin. */
  setSize(sx: number, sy: number, sz: number): void;
}

export function makeBoxEdges(size: [number, number, number], o: BoxEdgesOptions): BoxEdges {
  const group = makeGeoTwoTone(boxGeoState(boxEdgePositions(...size)), o) as BoxEdges;
  const [solid, dashes] = group.children as LineSegments2[];
  // A new geometry per size: replaced attributes of a live geometry keep
  // their GL buffers until the geometry itself is disposed. The edges are
  // new units — their cell counts start afresh.
  group.setSize = (sx, sy, sz) => {
    const old = solid!.geometry;
    const state = boxGeoState(boxEdgePositions(sx, sy, sz));
    const next = new LineSegmentsGeometry();
    countedGeometry(next);
    next.setPositions(state.positions);
    attachGeo(next, state);
    solid!.geometry = next;
    dashes!.geometry = next;
    dashes!.computeLineDistances();
    countedLineDistances(next);
    group.geo = state;
    old.dispose();
  };
  return group;
}

/** The per-instance distances three's computeLineDistances just allocated. */
export function countedLineDistances(g: THREE.BufferGeometry): void {
  counted((g.getAttribute("instanceDistanceStart") as THREE.InterleavedBufferAttribute | undefined)?.data.array as Float32Array | undefined);
}

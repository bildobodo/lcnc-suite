// Part-frame ("path on part") preview transform.
//
// The programmed polyline is the tool position in WORK coordinates assuming
// the work frame never rotates. On machines with rotary axes in the work or
// tool chain, the true tool-versus-workpiece path differs on every move that
// sweeps a rotary. This module resamples such moves and transforms each
// sample into the work group's local frame by evaluating the SAME machine.json
// kinematic chain the live scene uses (viewer/kinematics.ts — single source
// of truth), so the transformed preview overlays the backplot by construction
// for any machine layout.
//
// Frame math (mirrors ThreeViewer's scene graph exactly):
//   scene renders line vertices v as  world = W_work · T(o) · Rz(θ) · v
//   where o = live effective XYZ offset (g5x + Rz(θ)·g92 — RS274 applies g92
//   BEFORE the rotation, see WcsTerms), θ = live XY rotation, and W_work is
//   the workGroup chain's world matrix at the sample's joint values.
//   The true tool TIP is W_tool's translation minus the live TCP tool
//   offset (canon coords are tip positions — TLO-exclusive; joints under
//   G43 are tip + TLO, and applyState phase 3 makes the same subtraction
//   for the live marker).
//   Therefore:  v = Rz(−θ) · (W_work⁻¹ · (p_tool − tlo) − o)
//   For a machine with no rotary DOFs this reduces to v = programmed point —
//   the existing pipeline's identity, preserved by construction.
//
// Joint mapping: axis values are converted to machine coords (xyz: rotate
// by θ, add o, add TLO; abc: add live rotary offsets), then machine coords
// become joints through the kins boundary (viewer/kins.ts — trivkins today,
// real inverse kinematics behind the same interface later).
import * as THREE from "three";
import type { ViewerInit } from "../ws/bulkData";
import { normalizeKinematics, type KinRuntime } from "./kinematics";
import { kinsForSegment, makeKins, type KinsModel, type KinsSpec } from "./kins";
import { tloForIndex, type TloEvent } from "./tloEvents";

export interface PartFrameMachine {
  groups: Array<{ id: string; parent: string; translate?: [number, number, number] | number[] }>;
  kinematics: ViewerInit["kinematics"];
  workGroup: string;
  toolGroup: string;
  /** machine.json mm → machine units (1 for mm machines, 1/25.4 for inch). */
  unitScale: number;
  /** Axis letters in JOINT order (viewer_init.axes, from axis_mask). On
   *  XYZAC, C is joint 4 but canonical axis 5; kinematics entries are
   *  joint-indexed, preview data is axis-lettered, and this list is the
   *  bridge the kins boundary converts across. */
  axes: string[];
  /** Kins selection (serializable — this machine crosses postMessage).
   *  Absent = trivkins. */
  kins?: KinsSpec;
}

export interface PartFrameWcs {
  /** Live g5x offset (axis-indexed, machine units / degrees). */
  g5x: number[];
  /** Live g92 offset. */
  g92: number[];
  /** Live XY rotation, degrees. */
  rotationDeg: number;
  /** LIVE applied TCP tool offset (G43), machine-frame XYZ —
   *  stat.tool_offset. Since schema 8 the offset is PER-SEGMENT state
   *  (tloEvents on the track/polyline); this live value is the fallback
   *  for segments before the program's first G43/M6 row (the run inherits
   *  the machine's modal G43 state) and for payloads without the channel.
   *  Consumers resolve it through tloEvents.tloForIndex and lift with
   *  liftToJoints — never through wcsTerms' tx/ty/tz on epoch terms (those
   *  are tip-space). Rotary TLO components are out of scope (matches
   *  applyState phase 3 and the gateway limit check). */
  tool?: number[];
}

/** The same WCS with the tool offset stripped — TIP-space terms. Every
 *  per-segment consumer builds its terms from this and adds the segment's
 *  own offset via liftToJoints, so the offset can never ride twice. */
export function tipWcs(wcs: PartFrameWcs): PartFrameWcs {
  return wcs.tool ? { g5x: wcs.g5x, g92: wcs.g92, rotationDeg: wcs.rotationDeg } : wcs;
}

/** Program coords → TRUE JOINT-SPACE machine values: programToMachine under
 *  TIP-space terms, then + the segment's tool offset (joint = tip + TLO,
 *  what the servos hold under G43). ONE lift for every consumer (scrub
 *  pose, entry inverse, part-frame, collision) — schema 8. */
export function liftToJoints(
  px: number, py: number, pz: number, pa: number, pb: number, pc: number,
  oTip: WcsTerms, tlo: readonly number[], out: number[],
): void {
  programToMachine(px, py, pz, pa, pb, pc, oTip, out);
  out[0]! += tlo[0] ?? 0;
  out[1]! += tlo[1] ?? 0;
  out[2]! += tlo[2] ?? 0;
}

/** Exact inverse of liftToJoints: TLO-inclusive machine values → program
 *  coords under TIP-space terms. */
export function jointsToProgram(
  mx: number, my: number, mz: number, ma: number, mb: number, mc: number,
  oTip: WcsTerms, tlo: readonly number[], out: number[],
): void {
  machineToProgram(mx - (tlo[0] ?? 0), my - (tlo[1] ?? 0), mz - (tlo[2] ?? 0),
                   ma, mb, mc, oTip, out);
}

export interface PartFramePolyline {
  pos: Float32Array;        // flat programmed [x,y,z,...]
  abc: Float32Array;        // flat programmed [a,b,c,...] degrees, same length
  lines?: Uint32Array;      // optional per-vertex source line numbers
  /** Section-start vertex indices (track-derived sectioned streams): the
   *  segment INTO such a vertex is a false connector across a stream
   *  interleave — never subdivided, and the renderer index-skips it. */
  breaks?: Uint32Array;
  /** Per-vertex RAW switchkins type (phase 2, raw since phase 3): the
   *  segment ENDING at vertex i carries type mode[i]; the transform maps
   *  it per the declared kins family (kinsForSegment). Absent = no
   *  mode data — every segment derives as trivkins, as before. */
  mode?: Uint8Array;
  /** Per-vertex governing TWP frame index into `frames` (0xff = none) —
   *  TOOL-mode (type 2) segments need it to pin the plane frame. */
  frame?: Uint8Array;
  /** TWP frame triplets [preRot rad, primary deg, secondary deg]. */
  frames?: [number, number, number][];
  /** Per-vertex WCS epoch index (review P2) — selects which entry of the
   *  transform's `epochTerms` converts this vertex's program coords to
   *  machine coords. Absent = single-basis (the live `wcs` terms). */
  wcs?: Uint8Array;
  /** Per-vertex source TRACK index (review P3) — carried through
   *  subdivision so the positional highlight keeps its address space. */
  src?: Uint32Array;
  /** Per-vertex TLO/tool event index into `tloEvents` (schema 8; 0xff =
   *  before the first row → the live `wcs.tool` governs). The segment
   *  ENDING at vertex i lifts AND peels with that offset. Absent = live
   *  offset throughout (pre-8 behavior). */
  tlo?: Uint8Array;
  tloEvents?: TloEvent[];
}

export interface PartFrameResult {
  pos: Float32Array;
  lines?: Uint32Array;
  /** Input breaks remapped to output (subdivided) vertex indices. */
  breaks?: Uint32Array;
  /** Input src carried per output sample (subdivided samples share their
   *  segment's src, keeping the array ascending). */
  src?: Uint32Array;
}

/** Max rotary sweep per emitted sample. 4° ≈ 0.06% chord error at any radius. */
export const DEFAULT_ROT_STEP_DEG = 4;
const MAX_SUBDIV = 256;  // per segment — bounds memory on pathological programs

export type ChainNode = {
  id: string;
  parentIdx: number;               // -1 = root
  base: THREE.Vector3;             // static translate, unit-scaled
  dofs: KinRuntime[];              // entries driving this node, machine.json order
  local: THREE.Matrix4;
  world: THREE.Matrix4;
};

/** The evaluation-ordered work+tool chain of one machine (buildChain). The
 *  node matrices are scratch: tipInWorkFrame overwrites them per call. */
export interface Chain { nodes: ChainNode[]; workIdx: number; toolIdx: number }

/** Resolve the group tree into an evaluation-ordered node list (parents first).
 *  Only nodes on the root→workGroup / root→toolGroup chains are kept — the
 *  rest of the machine can't affect the relative tool/work pose. */
export function buildChain(machine: PartFrameMachine): Chain {
  const defs = new Map(machine.groups.map(g => [g.id, g]));
  const wanted = new Set<string>();
  for (const tip of [machine.workGroup, machine.toolGroup]) {
    let cur: string | undefined = tip;
    let hops = 0;
    while (cur && cur !== "root" && hops++ < 64) {
      wanted.add(cur);
      cur = defs.get(cur)?.parent;
    }
  }
  const kin = normalizeKinematics(machine.kinematics);
  const nodes: ChainNode[] = [];
  const idxOf = new Map<string, number>();
  // Parents-first insertion; machine.json order already satisfies this, the
  // outer loop just retries until the set converges (cycles bail via `hops`).
  let remaining = [...wanted];
  let guard = 0;
  while (remaining.length && guard++ < 64) {
    const next: string[] = [];
    for (const id of remaining) {
      const def = defs.get(id);
      if (!def) continue;  // dangling parent — same tolerance as the live scene
      const pIdx = def.parent === "root" ? -1 : idxOf.get(def.parent);
      if (pIdx === undefined && def.parent !== "root" && wanted.has(def.parent)) {
        next.push(id);  // parent not inserted yet
        continue;
      }
      const t = def.translate;
      nodes.push({
        id,
        parentIdx: pIdx ?? -1,
        base: new THREE.Vector3(
          (t?.[0] ?? 0) * machine.unitScale,
          (t?.[1] ?? 0) * machine.unitScale,
          (t?.[2] ?? 0) * machine.unitScale,
        ),
        dofs: kin.filter(k => k.group === id),
        local: new THREE.Matrix4(),
        world: new THREE.Matrix4(),
      });
      idxOf.set(id, nodes.length - 1);
    }
    remaining = next;
  }
  return {
    nodes,
    workIdx: idxOf.get(machine.workGroup) ?? -1,
    toolIdx: idxOf.get(machine.toolGroup) ?? -1,
  };
}

// Scratch for tipInWorkFrame (allocation-free; one JS context at a time).
const _tipPos = new THREE.Vector3();
const _tipQuat = new THREE.Quaternion();
const _tipStep = new THREE.Quaternion();
const _tipInvWork = new THREE.Matrix4();
const SCALE1 = new THREE.Vector3(1, 1, 1);

/** The chain at `jointVals` → the TOOL TIP in the WORK group's LOCAL frame.
 *
 *  Nodes evaluate parents-first from their static base + composed DOFs,
 *  exactly like the live applyState (translations add, rotations
 *  right-multiply). With a tool offset the joints are TLO-inclusive (the
 *  tool group's origin sits at the JOINT position), so the TLO is
 *  subtracted to reach the tip — in the TOOL's frame: applyState phase 3
 *  shifts _toolGrp.position local to the rotated spindle chain and the
 *  collision worker bakes −TLO into tool-local cylinder verts, so the
 *  offset is rotated by the tool node's world rotation before the world
 *  subtraction. A world-axis subtraction is off by a constant rigid offset
 *  whenever the spindle chain is tilted (W3 P0, operator-caught: 12.58 mm
 *  at B=−40.86/C=130.25 with TLO z=22). Column-major elements directly;
 *  transformDirection would normalize.
 *
 *  ONE rule for three consumers: the part-frame preview (per vertex, via
 *  transformToPartFrame), the program-zero markers (viewer/programZero.ts)
 *  and, by contract, the live scene. `out` is returned. */
export function tipInWorkFrame(
  chain: Chain, jointVals: ArrayLike<number | null>, tlo: readonly number[], out: THREE.Vector3,
): THREE.Vector3 {
  const { nodes, workIdx, toolIdx } = chain;
  for (const node of nodes) {
    _tipPos.copy(node.base);
    _tipQuat.identity();
    for (const d of node.dofs) {
      const v = (jointVals[d.joint] ?? 0) * d.sign;
      if (d.rotate) {
        _tipStep.setFromAxisAngle(d.axisVec, THREE.MathUtils.degToRad(v));
        _tipQuat.multiply(_tipStep);
      } else {
        _tipPos.addScaledVector(d.axisVec, v);
      }
    }
    node.local.compose(_tipPos, _tipQuat, SCALE1);
    if (node.parentIdx >= 0) node.world.multiplyMatrices(nodes[node.parentIdx]!.world, node.local);
    else node.world.copy(node.local);
  }
  const we = nodes[toolIdx]!.world.elements;
  const tx = tlo[0] ?? 0, ty = tlo[1] ?? 0, tz = tlo[2] ?? 0;
  out.setFromMatrixPosition(nodes[toolIdx]!.world);
  out.x -= we[0]! * tx + we[4]! * ty + we[8]! * tz;
  out.y -= we[1]! * tx + we[5]! * ty + we[9]! * tz;
  out.z -= we[2]! * tx + we[6]! * ty + we[10]! * tz;
  _tipInvWork.copy(nodes[workIdx]!.world).invert();
  return out.applyMatrix4(_tipInvWork);
}

/** Precomputed live-WCS terms for program→machine conversion. Every element
 *  defaulted — the WCS arrays can be empty before the first status tick.
 *
 *  RS274 ORDER (rs274.interpret.Translated.rotate_and_translate — the
 *  interpreter's own source, our oracle in rs274.test.ts):
 *      machine = g5x + Rz(θ)·(program + g92)
 *  i.e. g92 is applied BEFORE the rotation, g5x after. The equivalent
 *  single post-rotation offset is  o = g5x + Rz(θ)·g92  — which is what
 *  ox/oy hold. The old combined g5x+g92 deviated from the interpreter
 *  whenever G92 and G10 R rotation were both active. Rotation never
 *  touches Z or rotary axes, so those stay plain sums.
 *
 *  tx/ty/tz are the TCP tool offset (0 when wcs.tool is absent): applied
 *  post-rotation like g5x, they lift program coords into joint space. */
export interface WcsTerms {
  ox: number; oy: number; oz: number;
  oa: number; ob: number; oc: number;
  tx: number; ty: number; tz: number;
  cth: number; sth: number;
}

/** The scene-graph anchor of a drawn toolpath: where program (0,0,0) sits in
 *  the work group (g5x + Rz(θ)·g92, z = g5x_z + g92_z) and the XY rotation.
 *  ONE formula for applyState's live work origin AND the anchor a baked
 *  toolpath is parented under (2026-09-03: the lines hung under the LIVE
 *  origin while their vertices were peeled against the origin at bake
 *  time — a G10 L2 / fixture switch mid-run moved the anchor at once and
 *  the vertices ≥300 ms later: the whole path jumped, then returned). */
export interface AnchorTerms { ox: number; oy: number; oz: number; thetaDeg: number }

export function anchorTerms(wcs: PartFrameWcs, out?: AnchorTerms): AnchorTerms {
  const t = wcsTerms(wcs);
  const o = out ?? { ox: 0, oy: 0, oz: 0, thetaDeg: 0 };
  o.ox = t.ox; o.oy = t.oy; o.oz = t.oz; o.thetaDeg = wcs.rotationDeg || 0;
  return o;
}

export function wcsTerms(wcs: PartFrameWcs): WcsTerms {
  const th = THREE.MathUtils.degToRad(wcs.rotationDeg || 0);
  const cth = Math.cos(th), sth = Math.sin(th);
  const g92x = wcs.g92[0] ?? 0, g92y = wcs.g92[1] ?? 0;
  return {
    ox: (wcs.g5x[0] ?? 0) + g92x * cth - g92y * sth,
    oy: (wcs.g5x[1] ?? 0) + g92x * sth + g92y * cth,
    oz: (wcs.g5x[2] ?? 0) + (wcs.g92[2] ?? 0),
    oa: (wcs.g5x[3] ?? 0) + (wcs.g92[3] ?? 0),
    ob: (wcs.g5x[4] ?? 0) + (wcs.g92[4] ?? 0),
    oc: (wcs.g5x[5] ?? 0) + (wcs.g92[5] ?? 0),
    tx: wcs.tool?.[0] ?? 0,
    ty: wcs.tool?.[1] ?? 0,
    tz: wcs.tool?.[2] ?? 0,
    cth, sth,
  };
}

/** Program → machine axis values under the trivkins assumption: XY rotated by
 *  the live rotation then offset, Z/ABC offset. With wcs.tool provided the
 *  result is TRUE JOINT-SPACE (TLO-inclusive). Fills out[0..5] = X..C.
 *  Single source of truth shared by the part-frame transform and the scrub
 *  pose (viewer/scrubTrack.ts). */
export function programToMachine(
  px: number, py: number, pz: number, pa: number, pb: number, pc: number,
  o: WcsTerms, out: number[],
): void {
  out[0] = px * o.cth - py * o.sth + o.ox + o.tx;
  out[1] = px * o.sth + py * o.cth + o.oy + o.ty;
  out[2] = pz + o.oz + o.tz;
  out[3] = pa + o.oa;
  out[4] = pb + o.ob;
  out[5] = pc + o.oc;
}

/** Exact inverse of programToMachine — machine axis values → program coords.
 *  Used to place the LIVE machine position on the (program-space) scrub
 *  track, e.g. as the entry-move start point. Live joints under G43 are
 *  TLO-inclusive, so callers must pass wcs.tool for a correct inversion.
 *  Fills out[0..5]. */
export function machineToProgram(
  mx: number, my: number, mz: number, ma: number, mb: number, mc: number,
  o: WcsTerms, out: number[],
): void {
  const dx = mx - o.ox - o.tx, dy = my - o.oy - o.ty;
  out[0] = dx * o.cth + dy * o.sth;
  out[1] = -dx * o.sth + dy * o.cth;
  out[2] = mz - o.oz - o.tz;
  out[3] = ma - o.oa;
  out[4] = mb - o.ob;
  out[5] = mc - o.oc;
}

/** True when the transform can change anything: a rotary DOF sits on the
 *  work or tool chain. Pure translate chains reproduce the input exactly. */
export function chainsHaveRotary(machine: PartFrameMachine): boolean {
  const { nodes } = buildChain(machine);
  return nodes.some(n => n.dofs.some(d => d.rotate));
}

export function transformToPartFrame(
  machine: PartFrameMachine,
  wcs: PartFrameWcs,
  input: PartFramePolyline,
  rotStepDeg = DEFAULT_ROT_STEP_DEG,
  epochTerms?: readonly WcsTerms[],
): PartFrameResult {
  const n = Math.min(input.pos.length, input.abc.length) / 3 | 0;
  if (n === 0) return { pos: new Float32Array(0), lines: input.lines && new Uint32Array(0), src: input.src && new Uint32Array(0) };

  const chain = buildChain(machine);
  const { workIdx, toolIdx } = chain;
  if (workIdx < 0 || toolIdx < 0) {
    // Chain unresolvable (broken machine.json) — loud, and fall back to the
    // programmed polyline rather than rendering garbage.
    console.error("[partFrame] work/tool group missing from machine.json — programmed preview used");
    return { pos: input.pos.slice(), lines: input.lines?.slice(), breaks: input.breaks?.slice(), src: input.src?.slice() };
  }

  // Every element defaulted (inside wcsTerms): on a fresh page load the
  // preview can arrive before the first status tick, so the live WCS may
  // still be empty — the transform then runs offset-free and re-runs when
  // g5x/g92 first arrive (ThreeViewer's WCS-change refresh). A bare [0]!
  // here turned that race into NaN vertices — invisible geometry, no error.
  // TIP-space terms: the tool offset is per-vertex (schema 8) and enters
  // through liftToJoints / the peel below with ONE source per vertex —
  // the old code lifted with the epoch terms' (live) tool but peeled with
  // the active terms' (live) tool, an asymmetry that was invisible only
  // because both were the same value.
  const o = wcsTerms(tipWcs(wcs));
  // Output peel stays in the LIVE ACTIVE frame — the rendered polyline hangs
  // under the single workOrigin group. Per-epoch terms (review P2) only
  // steer the INPUT side: program coords → machine coords per vertex.
  const { ox, oy, oz, cth, sth } = o;
  const inWcs = input.wcs;
  const termFor = (i: number): WcsTerms =>
    (inWcs && epochTerms?.[inWcs[i] ?? 0]) ? epochTerms[inWcs[i] ?? 0]! : o;
  const tloFor = (i: number): readonly number[] =>
    tloForIndex(input.tlo?.[i], input.tloEvents, wcs.tool);

  // Section starts: segments INTO these vertices are false connectors across
  // stream interleaves — a single un-subdivided sample keeps the vertex (the
  // renderer index-skips the segment) without smoothing a phantom sweep.
  const breakSet = new Set<number>();
  if (input.breaks) for (const b of input.breaks) breakSet.add(b);

  // Pass 1 — sample count (subdivide segments by their largest rotary delta).
  let total = 1;
  const segSamples = new Uint16Array(Math.max(0, n - 1));
  for (let i = 1; i < n; i++) {
    const j = i * 3, k = j - 3;
    const da = Math.abs(input.abc[j]! - input.abc[k]!);
    const db = Math.abs(input.abc[j + 1]! - input.abc[k + 1]!);
    const dc = Math.abs(input.abc[j + 2]! - input.abc[k + 2]!);
    const steps = breakSet.has(i) ? 1
      : Math.min(MAX_SUBDIV, Math.max(1, Math.ceil(Math.max(da, db, dc) / rotStepDeg)));
    segSamples[i - 1] = steps;
    total += steps;
  }

  const outPos = new Float32Array(total * 3);
  const outLines = input.lines ? new Uint32Array(total) : undefined;
  const outSrc = input.src ? new Uint32Array(total) : undefined;

  // Scratch (allocation-free inner loop).
  const tool = new THREE.Vector3();
  // UVW joints come back null from the kins boundary; the DOF loop's
  // `?? 0` keeps them at zero in the pose, as before.
  const jointVals: (number | null)[] = [];
  const axisLetters = machine.axes.length ? machine.axes : ["X", "Y", "Z", "A", "B", "C"];
  // Per-vertex kins model (phase 3): RAW switchkins type + governing TWP
  // frame → kinsForSegment (family-aware routing; the loud honesty warns
  // live there). An untracked polyline (no mode array) stays trivkins
  // throughout. Live TLO feeds the model's pivot math where the family
  // uses it (trt world, trsrn TCP).
  const identityKins = makeKins(axisLetters);
  const inFrames = input.frames;
  const vertModel: KinsModel[] | null = input.mode
    ? Array.from(input.mode, (t, i) => {
        const fi = input.frame?.[i];
        const fr = (fi != null && fi !== 0xff && inFrames) ? inFrames[fi] ?? null : null;
        return kinsForSegment(axisLetters, machine.kins, t, fr,
                              tloFor(i)[2] || undefined, "part-frame preview");
      })
    : null;
  const machineVals: number[] = [0, 0, 0, 0, 0, 0];

  let out = 0;
  const emit = (px: number, py: number, pz: number, pa: number, pb: number, pc: number, line: number, model: KinsModel, oIn: WcsTerms, tloV: readonly number[]) => {
    // Program → machine coords (per the sample's EPOCH terms + the
    // segment's TLO), then machine → joints via the kins boundary.
    liftToJoints(px, py, pz, pa, pb, pc, oIn, tloV, machineVals);
    model.inverse(machineVals, jointVals);

    // Chain at those joints → tool tip in the work frame (tipInWorkFrame:
    // the TLO peel in the tool node's rotation lives there), then peel WCS.
    tipInWorkFrame(chain, jointVals, tloV, tool);
    const rx = tool.x - ox, ry = tool.y - oy;
    outPos[out * 3] = rx * cth + ry * sth;
    outPos[out * 3 + 1] = -rx * sth + ry * cth;
    outPos[out * 3 + 2] = tool.z - oz;
    if (outLines) outLines[out] = line;
    if (outSrc) outSrc[out] = _srcCur;
    out++;
  };

  const outBreaks: number[] = [];
  let _srcCur = input.src?.[0] ?? 0;
  emit(input.pos[0]!, input.pos[1]!, input.pos[2]!,
       input.abc[0]!, input.abc[1]!, input.abc[2]!, input.lines?.[0] ?? 0,
       vertModel?.[0] ?? identityKins, termFor(0), tloFor(0));
  if (breakSet.has(0)) outBreaks.push(0);
  for (let i = 1; i < n; i++) {
    const j = i * 3, k = j - 3;
    const steps = segSamples[i - 1]!;
    const line = input.lines?.[i] ?? 0;
    const model = vertModel?.[i] ?? identityKins;  // segment mode: all its samples share it
    const oSeg = termFor(i);                       // ...and its epoch terms
    const tloSeg = tloFor(i);                      // ...and its tool offset
    _srcCur = input.src?.[i] ?? i;                 // ...and its track index
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      emit(
        input.pos[k]! + (input.pos[j]! - input.pos[k]!) * t,
        input.pos[k + 1]! + (input.pos[j + 1]! - input.pos[k + 1]!) * t,
        input.pos[k + 2]! + (input.pos[j + 2]! - input.pos[k + 2]!) * t,
        input.abc[k]! + (input.abc[j]! - input.abc[k]!) * t,
        input.abc[k + 1]! + (input.abc[j + 1]! - input.abc[k + 1]!) * t,
        input.abc[k + 2]! + (input.abc[j + 2]! - input.abc[k + 2]!) * t,
        line,
        model,
        oSeg,
        tloSeg,
      );
    }
    // Remap the section start to its output index (the segment's endpoint —
    // steps is 1 for break segments, so this IS the input vertex).
    if (breakSet.has(i)) outBreaks.push(out - 1);
  }

  return {
    pos: outPos, lines: outLines,
    breaks: input.breaks ? Uint32Array.from(outBreaks) : undefined,
    src: outSrc,
  };
}

/** Cumulative polyline distance (dashed-line attribute), same algorithm as
 *  previewWorker's — exported here so the part-frame worker reuses it. */
export function lineDistances(pos: Float32Array): Float32Array {
  const n = pos.length / 3;
  const d = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dx = pos[i * 3]! - pos[(i - 1) * 3]!;
    const dy = pos[i * 3 + 1]! - pos[(i - 1) * 3 + 1]!;
    const dz = pos[i * 3 + 2]! - pos[(i - 1) * 3 + 2]!;
    d[i] = d[i - 1]! + Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return d;
}

/** Source-line → point-index range map over (possibly subdivided) lines. */
export function buildLineMap(lines: Uint32Array | undefined): Map<number, { start: number; end: number }> {
  const m = new Map<number, { start: number; end: number }>();
  if (!lines) return m;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const entry = m.get(ln);
    if (entry) entry.end = i;
    else m.set(ln, { start: i, end: i });
  }
  return m;
}

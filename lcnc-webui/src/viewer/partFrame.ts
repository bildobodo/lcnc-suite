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
  /** Live TCP tool offset (G43), machine-frame XYZ — stat.tool_offset.
   *  When provided, programToMachine produces TRUE JOINT-SPACE values
   *  (joint = tip + TLO, what the servos actually hold under G43) and
   *  machineToProgram inverts TLO-inclusive live joints correctly. Omit for
   *  tip-space math (path placement). Rotary TLO components are out of
   *  scope (matches applyState phase 3 and the gateway limit check). */
  tool?: number[];
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
}

export interface PartFrameResult {
  pos: Float32Array;
  lines?: Uint32Array;
  /** Input breaks remapped to output (subdivided) vertex indices. */
  breaks?: Uint32Array;
}

/** Max rotary sweep per emitted sample. 4° ≈ 0.06% chord error at any radius. */
export const DEFAULT_ROT_STEP_DEG = 4;
const MAX_SUBDIV = 256;  // per segment — bounds memory on pathological programs

type Node = {
  id: string;
  parentIdx: number;               // -1 = root
  base: THREE.Vector3;             // static translate, unit-scaled
  dofs: KinRuntime[];              // entries driving this node, machine.json order
  local: THREE.Matrix4;
  world: THREE.Matrix4;
};

/** Resolve the group tree into an evaluation-ordered node list (parents first).
 *  Only nodes on the root→workGroup / root→toolGroup chains are kept — the
 *  rest of the machine can't affect the relative tool/work pose. */
function buildChain(machine: PartFrameMachine): { nodes: Node[]; workIdx: number; toolIdx: number } {
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
  const nodes: Node[] = [];
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
  if (n === 0) return { pos: new Float32Array(0), lines: input.lines && new Uint32Array(0) };

  const { nodes, workIdx, toolIdx } = buildChain(machine);
  if (workIdx < 0 || toolIdx < 0) {
    // Chain unresolvable (broken machine.json) — loud, and fall back to the
    // programmed polyline rather than rendering garbage.
    console.error("[partFrame] work/tool group missing from machine.json — programmed preview used");
    return { pos: input.pos.slice(), lines: input.lines?.slice(), breaks: input.breaks?.slice() };
  }

  // Every element defaulted (inside wcsTerms): on a fresh page load the
  // preview can arrive before the first status tick, so the live WCS may
  // still be empty — the transform then runs offset-free and re-runs when
  // g5x/g92 first arrive (ThreeViewer's WCS-change refresh). A bare [0]!
  // here turned that race into NaN vertices — invisible geometry, no error.
  const o = wcsTerms(wcs);
  // Output peel stays in the LIVE ACTIVE frame — the rendered polyline hangs
  // under the single workOrigin group. Per-epoch terms (review P2) only
  // steer the INPUT side: program coords → machine coords per vertex.
  const { ox, oy, oz, cth, sth } = o;
  const inWcs = input.wcs;
  const termFor = (i: number): WcsTerms =>
    (inWcs && epochTerms?.[inWcs[i] ?? 0]) ? epochTerms[inWcs[i] ?? 0]! : o;

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

  // Scratch (allocation-free inner loop).
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const step = new THREE.Quaternion();
  const tool = new THREE.Vector3();
  const invWork = new THREE.Matrix4();
  const SCALE1 = new THREE.Vector3(1, 1, 1);
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
                              wcs.tool?.[2] || undefined, "part-frame preview");
      })
    : null;
  const machineVals: number[] = [0, 0, 0, 0, 0, 0];

  let out = 0;
  const emit = (px: number, py: number, pz: number, pa: number, pb: number, pc: number, line: number, model: KinsModel, oIn: WcsTerms) => {
    // Program → machine coords (per the sample's EPOCH terms), then machine
    // → joints via the kins boundary.
    programToMachine(px, py, pz, pa, pb, pc, oIn, machineVals);
    model.inverse(machineVals, jointVals);

    // Evaluate chain nodes (parents first): base + composed DOFs, exactly
    // like the live applyState — translations add, rotations right-multiply.
    for (const node of nodes) {
      pos.copy(node.base);
      quat.identity();
      for (const d of node.dofs) {
        const v = (jointVals[d.joint] ?? 0) * d.sign;
        if (d.rotate) {
          step.setFromAxisAngle(d.axisVec, THREE.MathUtils.degToRad(v));
          quat.multiply(step);
        } else {
          pos.addScaledVector(d.axisVec, v);
        }
      }
      node.local.compose(pos, quat, SCALE1);
      if (node.parentIdx >= 0) node.world.multiplyMatrices(nodes[node.parentIdx]!.world, node.local);
      else node.world.copy(node.local);
    }

    // Tool tip world position, then into the work frame, then peel WCS.
    // With wcs.tool set the joints above are TLO-inclusive, so the tool
    // group's origin sits at the JOINT position — subtract the TLO to get
    // the tip, exactly like applyState phase 3 shifts the live marker.
    tool.setFromMatrixPosition(nodes[toolIdx]!.world);
    tool.x -= o.tx; tool.y -= o.ty; tool.z -= o.tz;
    invWork.copy(nodes[workIdx]!.world).invert();
    tool.applyMatrix4(invWork);
    const rx = tool.x - ox, ry = tool.y - oy;
    outPos[out * 3] = rx * cth + ry * sth;
    outPos[out * 3 + 1] = -rx * sth + ry * cth;
    outPos[out * 3 + 2] = tool.z - oz;
    if (outLines) outLines[out] = line;
    out++;
  };

  const outBreaks: number[] = [];
  emit(input.pos[0]!, input.pos[1]!, input.pos[2]!,
       input.abc[0]!, input.abc[1]!, input.abc[2]!, input.lines?.[0] ?? 0,
       vertModel?.[0] ?? identityKins, termFor(0));
  if (breakSet.has(0)) outBreaks.push(0);
  for (let i = 1; i < n; i++) {
    const j = i * 3, k = j - 3;
    const steps = segSamples[i - 1]!;
    const line = input.lines?.[i] ?? 0;
    const model = vertModel?.[i] ?? identityKins;  // segment mode: all its samples share it
    const oSeg = termFor(i);                       // ...and its epoch terms
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
      );
    }
    // Remap the section start to its output index (the segment's endpoint —
    // steps is 1 for break segments, so this IS the input vertex).
    if (breakSet.has(i)) outBreaks.push(out - 1);
  }

  return {
    pos: outPos, lines: outLines,
    breaks: input.breaks ? Uint32Array.from(outBreaks) : undefined,
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

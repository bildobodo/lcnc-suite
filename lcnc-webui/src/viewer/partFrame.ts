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
//   where o = live g5x+g92 XYZ offset, θ = live XY rotation, and W_work is
//   the workGroup chain's world matrix at the sample's joint values.
//   The true tool position is W_tool's translation (tool tip at toolGroup
//   origin — TLO is already folded into programmed coords by the canon; the
//   live TCP tool_offset shifts the tool MARKER, never the path).
//   Therefore:  v = Rz(−θ) · (W_work⁻¹ · p_tool − o)
//   For a machine with no rotary DOFs this reduces to v = programmed point —
//   the existing pipeline's identity, preserved by construction.
//
// Joint mapping: axis values are converted to machine coords (xyz: rotate by
// θ then add o; abc: add live rotary offsets) and used as joint values —
// the same trivkins assumption the live machine model makes.
import * as THREE from "three";
import type { ViewerInit } from "../ws/bulkData";
import { normalizeKinematics, type KinRuntime } from "./kinematics";

export interface PartFrameMachine {
  groups: Array<{ id: string; parent: string; translate?: [number, number, number] | number[] }>;
  kinematics: ViewerInit["kinematics"];
  workGroup: string;
  toolGroup: string;
  /** machine.json mm → machine units (1 for mm machines, 1/25.4 for inch). */
  unitScale: number;
  /** Axis letters in JOINT order (viewer_init.axes, from axis_mask) — the
   *  joint↔axis mapping under trivkins. On XYZAC, C is joint 4 but canonical
   *  axis 5; kinematics entries are joint-indexed, preview data is
   *  axis-lettered, and this list is the bridge. */
  axes: string[];
}

export interface PartFrameWcs {
  /** Live g5x offset (axis-indexed, machine units / degrees). */
  g5x: number[];
  /** Live g92 offset. */
  g92: number[];
  /** Live XY rotation, degrees. */
  rotationDeg: number;
}

export interface PartFramePolyline {
  pos: Float32Array;        // flat programmed [x,y,z,...]
  abc: Float32Array;        // flat programmed [a,b,c,...] degrees, same length
  lines?: Uint32Array;      // optional per-vertex source line numbers
}

export interface PartFrameResult {
  pos: Float32Array;
  lines?: Uint32Array;
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
): PartFrameResult {
  const n = Math.min(input.pos.length, input.abc.length) / 3 | 0;
  if (n === 0) return { pos: new Float32Array(0), lines: input.lines && new Uint32Array(0) };

  const { nodes, workIdx, toolIdx } = buildChain(machine);
  if (workIdx < 0 || toolIdx < 0) {
    // Chain unresolvable (broken machine.json) — loud, and fall back to the
    // programmed polyline rather than rendering garbage.
    console.error("[partFrame] work/tool group missing from machine.json — programmed preview used");
    return { pos: input.pos.slice(), lines: input.lines?.slice() };
  }

  // Every element defaulted: on a fresh page load the preview can arrive
  // before the first status tick, so the live WCS may still be empty — the
  // transform then runs offset-free and re-runs when g5x/g92 first arrive
  // (ThreeViewer's WCS-change refresh). A bare [0]! here turned that race
  // into NaN vertices — invisible geometry with no error.
  const ox = (wcs.g5x[0] ?? 0) + (wcs.g92[0] ?? 0);
  const oy = (wcs.g5x[1] ?? 0) + (wcs.g92[1] ?? 0);
  const oz = (wcs.g5x[2] ?? 0) + (wcs.g92[2] ?? 0);
  const oa = (wcs.g5x[3] ?? 0) + (wcs.g92[3] ?? 0);
  const ob = (wcs.g5x[4] ?? 0) + (wcs.g92[4] ?? 0);
  const oc = (wcs.g5x[5] ?? 0) + (wcs.g92[5] ?? 0);
  const th = THREE.MathUtils.degToRad(wcs.rotationDeg || 0);
  const cth = Math.cos(th), sth = Math.sin(th);

  // Pass 1 — sample count (subdivide segments by their largest rotary delta).
  let total = 1;
  const segSamples = new Uint16Array(Math.max(0, n - 1));
  for (let i = 1; i < n; i++) {
    const j = i * 3, k = j - 3;
    const da = Math.abs(input.abc[j]! - input.abc[k]!);
    const db = Math.abs(input.abc[j + 1]! - input.abc[k + 1]!);
    const dc = Math.abs(input.abc[j + 2]! - input.abc[k + 2]!);
    const steps = Math.min(MAX_SUBDIV, Math.max(1, Math.ceil(Math.max(da, db, dc) / rotStepDeg)));
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
  const jointVals: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  // Joint index → axis slot (0..5 = machine X,Y,Z,A,B,C; -1 = unknown/UVW).
  // kinematics joints are JOINT-indexed; the axes list maps them to letters.
  const axisLetters = machine.axes.length ? machine.axes : ["X", "Y", "Z", "A", "B", "C"];
  const jointSlot = axisLetters.map(l => "XYZABC".indexOf(l.toUpperCase()));
  const machineVals: number[] = [0, 0, 0, 0, 0, 0];

  let out = 0;
  const emit = (px: number, py: number, pz: number, pa: number, pb: number, pc: number, line: number) => {
    // Program → machine coords (joints under the trivkins assumption).
    machineVals[0] = px * cth - py * sth + ox;
    machineVals[1] = px * sth + py * cth + oy;
    machineVals[2] = pz + oz;
    machineVals[3] = pa + oa;
    machineVals[4] = pb + ob;
    machineVals[5] = pc + oc;
    for (let ji = 0; ji < jointVals.length; ji++) {
      const slot = jointSlot[ji];
      jointVals[ji] = slot !== undefined && slot >= 0 ? machineVals[slot]! : 0;
    }

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
    tool.setFromMatrixPosition(nodes[toolIdx]!.world);
    invWork.copy(nodes[workIdx]!.world).invert();
    tool.applyMatrix4(invWork);
    const rx = tool.x - ox, ry = tool.y - oy;
    outPos[out * 3] = rx * cth + ry * sth;
    outPos[out * 3 + 1] = -rx * sth + ry * cth;
    outPos[out * 3 + 2] = tool.z - oz;
    if (outLines) outLines[out] = line;
    out++;
  };

  emit(input.pos[0]!, input.pos[1]!, input.pos[2]!,
       input.abc[0]!, input.abc[1]!, input.abc[2]!, input.lines?.[0] ?? 0);
  for (let i = 1; i < n; i++) {
    const j = i * 3, k = j - 3;
    const steps = segSamples[i - 1]!;
    const line = input.lines?.[i] ?? 0;
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
      );
    }
  }

  return { pos: outPos, lines: outLines };
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

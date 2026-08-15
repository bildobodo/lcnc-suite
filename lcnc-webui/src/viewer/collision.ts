// Machine collision sweep (offline dry run, stage 3).
//
// Sweeps the articulated machine model through the loaded program's scrub
// track and reports tool-side vs work-side body pairs that come within a
// clearance margin — the crash class soft limits can't see (a legal-travel
// pose can still drive the spindle head into the trunnion). Static geometry
// only: machine.json STL bodies plus a parametric tool cylinder. No stock
// model — the control-side gap is machine motion safety, not chip removal.
//
// Pipeline per sample: lerp the track segment (same subdivision idea as the
// part-frame preview: rotary AND linear steps, since a straight plunge can
// fly through a body between endpoints), program→machine via the shared
// wcsTerms/programToMachine, letters→joints via viewer_init.axes, evaluate
// the FULL group tree (not just the work/tool chains — every body needs its
// world matrix), then pair-test tool-side bodies against work-side bodies:
// bounding-sphere prescreen first, BVH closest-point only when spheres come
// within the margin.
//
// Pair derivation: any two bodies whose connecting path through the group
// tree crosses at least one kinematic DOF have program-driven relative
// motion and form a pair — tool-vs-work, tool-vs-frame, and same-side
// pairs that straddle a DOF (platter edge vs table across the A tilt) all
// fall out of the same rule. Bodies on the same rigid subchain never move
// relative to each other and are skipped entirely.
//
// Noise control (baseline subtraction): mechanically-joined neighbors —
// slides, bearings, trunnion mounts — sit inside the margin PERMANENTLY;
// per-line reporting would flood every line of every program. Pairs already
// within the margin at the program's FIRST pose are therefore reported once
// as `staticContacts` and excluded from the per-line sweep. A program that
// genuinely starts in a crashed pose still surfaces there — "in contact
// from the start" is exactly what's true.
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { normalizeKinematics, type KinRuntime } from "./kinematics";
import { programToMachine, wcsTerms, type PartFrameWcs } from "./partFrame";
import type { ScrubTrack } from "../ws/bulkData";

export interface CollisionMachine {
  groups: Array<{ id: string; parent: string; translate?: number[] }>;
  kinematics: Array<Record<string, any>>;
  workGroup: string;
  toolGroup: string;
  /** machine.json mm → machine units (1 mm machines, 1/25.4 inch). */
  unitScale: number;
  /** Axis letters in JOINT order (viewer_init.axes). */
  axes: string[];
}

export interface CollisionBody {
  id: string;
  group: string;
  /** Triangle soup in machine.json mm (unit-scaled at build time). */
  positions: Float32Array;
  /** Static placement inside the group — mm and radians, as machine.json. */
  translate?: number[];
  rotate?: number[];
}

export interface CollisionHit {
  line: number;
  /** Scrub-track cum parameter of the worst sample — scrub-to-hit target. */
  cum: number;
  a: string;               // tool-side body id
  b: string;               // work-side body id
  dist: number;            // machine units; 0 = contact/penetration
  /** True when the contact happens during a RAPID — always a real problem.
   *  Feed-move contact with the work-holding (platter) can be legitimate
   *  cutting; there is no stock model to tell the difference. */
  rapid: boolean;
}

export interface CollisionOptions {
  /** Clearance margin in machine units — pairs closer than this are hits. */
  margin: number;
  /** Linear sample step in machine units. */
  linStepMm?: number;
  /** Rotary sample step in degrees. */
  rotStepDeg?: number;
  /** Hard cap on total samples — the step sizes are COARSENED to fit (and
   *  the result says so); never silently truncate the program. */
  maxSamples?: number;
}

export interface CollisionResult {
  hits: CollisionHit[];
  /** Pairs already inside the margin at the program's first pose (mechanical
   *  joints — or a program that starts in contact). Reported once, excluded
   *  from the per-line sweep. */
  staticContacts: Array<{ a: string; b: string; dist: number }>;
  samples: number;
  /** True when maxSamples forced coarser steps than requested. */
  coarsened: boolean;
  pairCount: number;
  bvhMs: number;
  sweepMs: number;
}

const DEFAULTS = { linStepMm: 5, rotStepDeg: 4, maxSamples: 60_000 };
const MAX_HITS = 200;

interface Node {
  id: string;
  parentIdx: number;
  base: THREE.Vector3;
  dofs: KinRuntime[];
  local: THREE.Matrix4;
  world: THREE.Matrix4;
}

interface BuiltBody {
  id: string;
  nodeIdx: number;
  side: "tool" | "work" | "other";
  bvh: MeshBVH;
  geom: THREE.BufferGeometry;
  localMat: THREE.Matrix4;       // static translate+rotate inside the group
  center: THREE.Vector3;         // local bounding-sphere
  radius: number;
  world: THREE.Matrix4;          // scratch, updated per sample
  worldCenter: THREE.Vector3;    // scratch
}

/** Full-tree node list, parents first (unlike partFrame's chain-only build —
 *  collision needs a world matrix for every body-carrying group). */
function buildTree(machine: CollisionMachine): { nodes: Node[]; idxOf: Map<string, number> } {
  const defs = new Map(machine.groups.map(g => [g.id, g]));
  const kin = normalizeKinematics(machine.kinematics as any);
  const nodes: Node[] = [];
  const idxOf = new Map<string, number>();
  let remaining = machine.groups.map(g => g.id);
  let guard = 0;
  while (remaining.length && guard++ < 64) {
    const next: string[] = [];
    for (const id of remaining) {
      const def = defs.get(id)!;
      const pIdx = def.parent === "root" ? -1 : idxOf.get(def.parent);
      if (pIdx === undefined && def.parent !== "root" && defs.has(def.parent)) {
        next.push(id);
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
  return { nodes, idxOf };
}

function chainIds(machine: CollisionMachine, tip: string): Set<string> {
  const defs = new Map(machine.groups.map(g => [g.id, g]));
  const out = new Set<string>();
  let cur: string | undefined = tip;
  let hops = 0;
  while (cur && cur !== "root" && hops++ < 64) {
    out.add(cur);
    cur = defs.get(cur)?.parent;
  }
  return out;
}

/** Parametric tool body: cylinder of `diam`×`len`, tip at origin, +Z up —
 *  the same convention as tool STLs and the viewer's fallback marker. */
export function toolCylinderPositions(diam: number, len: number, segments = 20): Float32Array {
  const geom = new THREE.CylinderGeometry(diam / 2, diam / 2, len, segments);
  geom.rotateX(Math.PI / 2);        // cylinder Y-axis → Z-up
  geom.translate(0, 0, len / 2);    // tip at origin, extends +Z
  const nonIndexed = geom.toNonIndexed();
  const pos = new Float32Array(nonIndexed.getAttribute("position").array as Float32Array);
  geom.dispose();
  nonIndexed.dispose();
  return pos;
}

export interface CollisionModel {
  nodes: Node[];
  bodies: BuiltBody[];
  pairs: Array<[number, number]>;  // indices into bodies: [tool-side, work-side]
  machine: CollisionMachine;
  bvhMs: number;
}

export function buildCollisionModel(machine: CollisionMachine, bodyDefs: CollisionBody[]): CollisionModel {
  const { nodes, idxOf } = buildTree(machine);
  const toolSide = chainIds(machine, machine.toolGroup);
  const workSide = chainIds(machine, machine.workGroup);
  const t0 = performance.now();

  const bodies: BuiltBody[] = [];
  const _e = new THREE.Euler();
  for (const def of bodyDefs) {
    const nodeIdx = idxOf.get(def.group);
    if (nodeIdx === undefined) continue;  // dangling group — same tolerance as the live scene
    const side = toolSide.has(def.group) ? "tool" : workSide.has(def.group) ? "work" : "other";
    // Unit-scale a copy of the triangle soup so all collision math is in
    // machine units (matches node bases and joint values).
    const scaled = new Float32Array(def.positions.length);
    for (let i = 0; i < scaled.length; i++) scaled[i] = def.positions[i]! * machine.unitScale;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(scaled, 3));
    const bvh = new MeshBVH(geom);
    (geom as any).boundsTree = bvh;   // lets closestPointToGeometry use both trees
    geom.computeBoundingSphere();
    const sphere = geom.boundingSphere!;
    const localMat = new THREE.Matrix4();
    if (def.rotate) _e.set(def.rotate[0] ?? 0, def.rotate[1] ?? 0, def.rotate[2] ?? 0);
    else _e.set(0, 0, 0);
    localMat.makeRotationFromEuler(_e);
    localMat.setPosition(
      (def.translate?.[0] ?? 0) * machine.unitScale,
      (def.translate?.[1] ?? 0) * machine.unitScale,
      (def.translate?.[2] ?? 0) * machine.unitScale,
    );
    bodies.push({
      id: def.id, nodeIdx, side, bvh, geom, localMat,
      center: sphere.center.clone(), radius: sphere.radius,
      world: new THREE.Matrix4(), worldCenter: new THREE.Vector3(),
    });
  }

  // A pair is worth sweeping iff the two bodies MOVE relative to each other:
  // a DOF must sit strictly between them (below their lowest common
  // ancestor). DOFs on the LCA or above move both bodies rigidly together.
  const pairHasRelativeMotion = (ia: number, ib: number): boolean => {
    const pathA: number[] = [];
    for (let i = ia; i >= 0; i = nodes[i]!.parentIdx) pathA.push(i);
    const aSet = new Set(pathA);
    let lca = -1;
    const rel: number[] = [];
    for (let i = ib; i >= 0; i = nodes[i]!.parentIdx) {
      if (aSet.has(i)) { lca = i; break; }
      rel.push(i);
    }
    for (const i of pathA) {
      if (i === lca) break;
      rel.push(i);
    }
    return rel.some(i => nodes[i]!.dofs.length > 0);
  };

  const pairs: Array<[number, number]> = [];
  for (let a = 0; a < bodies.length; a++) {
    for (let b = a + 1; b < bodies.length; b++) {
      const A = bodies[a]!, B = bodies[b]!;
      if (A.nodeIdx === B.nodeIdx) continue;  // same group — rigid
      if (!pairHasRelativeMotion(A.nodeIdx, B.nodeIdx)) continue;
      // Tool-side body first when there is one — hit messages read better.
      if (B.side === "tool" && A.side !== "tool") pairs.push([b, a]);
      else pairs.push([a, b]);
    }
  }
  return { nodes, bodies, pairs, machine, bvhMs: performance.now() - t0 };
}

/** One kinematic pose: evaluate every node's world matrix from joint values. */
function poseTree(nodes: Node[], jointVals: number[], scratch: {
  pos: THREE.Vector3; quat: THREE.Quaternion; step: THREE.Quaternion; one: THREE.Vector3;
}) {
  for (const node of nodes) {
    scratch.pos.copy(node.base);
    scratch.quat.identity();
    for (const d of node.dofs) {
      const v = (jointVals[d.joint] ?? 0) * d.sign;
      if (d.rotate) {
        scratch.step.setFromAxisAngle(d.axisVec, THREE.MathUtils.degToRad(v));
        scratch.quat.multiply(scratch.step);
      } else {
        scratch.pos.addScaledVector(d.axisVec, v);
      }
    }
    node.local.compose(scratch.pos, scratch.quat, scratch.one);
    if (node.parentIdx >= 0) node.world.multiplyMatrices(nodes[node.parentIdx]!.world, node.local);
    else node.world.copy(node.local);
  }
}

/** Sweep the track. `shouldYield` is polled between segments — return true to
 *  abort (the worker maps a cancel message onto it). `onProgress` gets 0..1. */
export function sweepCollisions(
  model: CollisionModel,
  track: ScrubTrack,
  wcs: PartFrameWcs,
  opts: CollisionOptions,
  onProgress?: (frac: number) => void,
  shouldAbort?: () => boolean,
): CollisionResult {
  const { nodes, bodies, pairs, machine } = model;
  const linStep0 = opts.linStepMm ?? DEFAULTS.linStepMm;
  const rotStep0 = opts.rotStepDeg ?? DEFAULTS.rotStepDeg;
  const maxSamples = opts.maxSamples ?? DEFAULTS.maxSamples;
  const t0 = performance.now();

  // Pass 1 — sample counts at requested resolution; coarsen uniformly if over
  // budget (never drop segments).
  const n = track.count;
  const segSteps = new Uint16Array(Math.max(0, n - 1));
  let total = 1;
  const stepsFor = (i: number, linStep: number, rotStep: number) => {
    const j = i * 3, k = j - 3;
    const dx = track.pos[j]! - track.pos[k]!;
    const dy = track.pos[j + 1]! - track.pos[k + 1]!;
    const dz = track.pos[j + 2]! - track.pos[k + 2]!;
    const lin = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rot = Math.max(
      Math.abs(track.abc[j]! - track.abc[k]!),
      Math.abs(track.abc[j + 1]! - track.abc[k + 1]!),
      Math.abs(track.abc[j + 2]! - track.abc[k + 2]!),
    );
    return Math.min(255, Math.max(1, Math.ceil(Math.max(lin / linStep, rot / rotStep))));
  };
  for (let i = 1; i < n; i++) {
    segSteps[i - 1] = stepsFor(i, linStep0, rotStep0);
    total += segSteps[i - 1]!;
  }
  let coarsened = false;
  if (total > maxSamples) {
    coarsened = true;
    const f = total / maxSamples;
    total = 1;
    for (let i = 1; i < n; i++) {
      segSteps[i - 1] = stepsFor(i, linStep0 * f, rotStep0 * f);
      total += segSteps[i - 1]!;
    }
  }

  const o = wcsTerms(wcs);
  const machineVals: number[] = [0, 0, 0, 0, 0, 0];
  const jointVals: number[] = new Array(Math.max(machine.axes.length, 9)).fill(0);
  const jointSlot = machine.axes.map(l => "XYZABC".indexOf(l.toUpperCase()));
  const scratch = {
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
    step: new THREE.Quaternion(), one: new THREE.Vector3(1, 1, 1),
  };
  const relMat = new THREE.Matrix4();
  const invA = new THREE.Matrix4();
  const target1 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };
  const target2 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };

  // Worst hit per (line, pair) — same attribution shape as stage 1.
  const worst = new Map<string, CollisionHit>();
  let done = 0;

  const poseAt = (px: number, py: number, pz: number, pa: number, pb: number, pc: number) => {
    programToMachine(px, py, pz, pa, pb, pc, o, machineVals);
    for (let ji = 0; ji < jointSlot.length; ji++) {
      const slot = jointSlot[ji]!;
      jointVals[ji] = slot >= 0 ? machineVals[slot]! : 0;  // UVW: 0, as the preview transform
    }
    poseTree(nodes, jointVals, scratch);
    for (const body of bodies) {
      body.world.multiplyMatrices(nodes[body.nodeIdx]!.world, body.localMat);
      body.worldCenter.copy(body.center).applyMatrix4(body.world);
    }
  };

  // Distance between two posed bodies, Infinity when provably beyond the
  // margin (sphere prescreen, then BVH closest-point with margin early-out;
  // the matrix maps B's geometry into A's local frame: A⁻¹ · B).
  const pairDistance = (A: BuiltBody, B: BuiltBody): number => {
    const centerDist = A.worldCenter.distanceTo(B.worldCenter);
    if (centerDist - A.radius - B.radius > opts.margin) return Infinity;
    invA.copy(A.world).invert();
    relMat.multiplyMatrices(invA, B.world);
    const res = A.bvh.closestPointToGeometry(B.geom, relMat, target1, target2, 0, opts.margin);
    return res ? target1.distance : Infinity;
  };

  // Baseline pass (first pose): pairs already inside the margin here are
  // mechanical-joint proximity (slides, bearings, trunnion mounts) — or a
  // program that starts in contact. Reported once, excluded from the sweep.
  const staticExcluded = new Uint8Array(pairs.length);
  const staticContacts: CollisionResult["staticContacts"] = [];
  poseAt(track.pos[0]!, track.pos[1]!, track.pos[2]!,
         track.abc[0]!, track.abc[1]!, track.abc[2]!);
  for (let pi = 0; pi < pairs.length; pi++) {
    const [ai, bi] = pairs[pi]!;
    const dist = pairDistance(bodies[ai]!, bodies[bi]!);
    if (dist <= opts.margin) {
      staticExcluded[pi] = 1;
      staticContacts.push({ a: bodies[ai]!.id, b: bodies[bi]!.id, dist });
    }
  }
  done++;

  const testSample = (px: number, py: number, pz: number, pa: number, pb: number, pc: number, line: number, cum: number, rapid: boolean) => {
    poseAt(px, py, pz, pa, pb, pc);
    for (let pi = 0; pi < pairs.length; pi++) {
      if (staticExcluded[pi]) continue;
      const [ai, bi] = pairs[pi]!;
      const A = bodies[ai]!, B = bodies[bi]!;
      const dist = pairDistance(A, B);
      if (dist <= opts.margin) {
        const key = `${line}|${A.id}|${B.id}`;
        const prev = worst.get(key);
        if (!prev || dist < prev.dist) {
          worst.set(key, { line, cum, a: A.id, b: B.id, dist, rapid });
        } else if (rapid && !prev.rapid) {
          prev.rapid = true;  // any rapid contact on this (line, pair) marks it
        }
      }
    }
  };

  for (let i = 1; i < n; i++) {
    if (shouldAbort?.()) break;
    const j = i * 3, k = j - 3;
    const steps = segSteps[i - 1]!;
    const line = track.lines[i]!;
    const isRapid = track.rapid[i] === 1;
    const c0 = track.cum[i - 1]!, c1 = track.cum[i]!;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      testSample(
        track.pos[k]! + (track.pos[j]! - track.pos[k]!) * t,
        track.pos[k + 1]! + (track.pos[j + 1]! - track.pos[k + 1]!) * t,
        track.pos[k + 2]! + (track.pos[j + 2]! - track.pos[k + 2]!) * t,
        track.abc[k]! + (track.abc[j]! - track.abc[k]!) * t,
        track.abc[k + 1]! + (track.abc[j + 1]! - track.abc[k + 1]!) * t,
        track.abc[k + 2]! + (track.abc[j + 2]! - track.abc[k + 2]!) * t,
        line, c0 + (c1 - c0) * t, isRapid,
      );
      done++;
    }
    if (onProgress && (i & 63) === 0) onProgress(done / total);
  }
  onProgress?.(1);

  const hits = [...worst.values()].sort((x, y) => x.cum - y.cum).slice(0, MAX_HITS);
  return {
    hits,
    staticContacts,
    samples: done,
    coarsened,
    pairCount: pairs.length,
    bvhMs: model.bvhMs,
    sweepMs: performance.now() - t0,
  };
}

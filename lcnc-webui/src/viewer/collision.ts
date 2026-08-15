// Machine collision sweep (offline dry run, stage 3).
//
// Sweeps the articulated machine model through the loaded program's scrub
// track and reports tool-side vs work-side body pairs that come within a
// clearance margin — the crash class soft limits can't see (a legal-travel
// pose can still drive the spindle head into the trunnion). Static geometry
// only: machine.json STL bodies plus a parametric tool cylinder. No stock
// model — the control-side gap is machine motion safety, not chip removal.
//
// Stepping is CONSERVATIVE ADVANCEMENT, not fixed sampling: each distance
// query yields a certificate — the pair cannot reach the margin within
// (distance − margin) / V of track parameter, where V is a provably
// conservative bound on the pair's relative surface speed (translations
// exact; rotations × endpoint lever arms with documented inflation,
// segments chunked ≤22.5° of rotary sweep so lever drift stays bounded).
// Pairs are re-queried only when their certificate expires. Guarantee: no
// margin crossing wider than MIN_ADV (0.25 units) of path is missed —
// clear programs stride in a handful of samples, approaches tighten
// automatically. Per sample: lerp the track segment, program→machine via
// the shared wcsTerms/programToMachine, letters→joints via
// viewer_init.axes, evaluate the FULL group tree (every body needs its
// world matrix), bounding-sphere prescreen, then BVH closest-point.
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
  /** Re-probe cadence INSIDE contact regions + budget-fallback step (the
   *  free-space step is distance-driven — conservative advancement). */
  linStepMm?: number;
  /** Folded into the explore cadence (1° ≙ 1 mm); kept for callers. */
  rotStepDeg?: number;
  /** Safety budget on pose evaluations — on breach the sweep degrades to
   *  fixed explore steps (result says `coarsened`); never truncates. */
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
  // Implicit root node: STATIC frame bodies (machine.json parts without a
  // group — column, base, spindle housing) attach here. They never move,
  // but everything else moves relative to THEM — trunnion-into-spindle-base
  // is a frame collision, and dropping these bodies made the sweep blind to
  // it while the scrub visuals showed it plainly.
  nodes.push({
    id: "root", parentIdx: -1, base: new THREE.Vector3(), dofs: [],
    local: new THREE.Matrix4(), world: new THREE.Matrix4(),
  });
  idxOf.set("root", 0);
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

/** A kinematic DOF on the path between a pair's bodies, with the node that
 *  carries it — the inputs to the pair's relative-velocity bound. */
interface PathDof {
  nodeIdx: number;
  dof: KinRuntime;
}

export interface CollisionModel {
  nodes: Node[];
  bodies: BuiltBody[];
  pairs: Array<[number, number]>;  // indices into bodies (tool-side first when there is one)
  /** Per pair: the DOFs strictly between the two bodies (below their LCA) —
   *  exactly the motion that changes their relative pose. */
  pairDofs: PathDof[][];
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
  // Returns exactly those DOFs — they drive the pair's velocity bound.
  const pathDofsBetween = (ia: number, ib: number): PathDof[] => {
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
    const out: PathDof[] = [];
    for (const i of rel) for (const dof of nodes[i]!.dofs) out.push({ nodeIdx: i, dof });
    return out;
  };

  const pairs: Array<[number, number]> = [];
  const pairDofs: PathDof[][] = [];
  for (let a = 0; a < bodies.length; a++) {
    for (let b = a + 1; b < bodies.length; b++) {
      const A = bodies[a]!, B = bodies[b]!;
      if (A.nodeIdx === B.nodeIdx) continue;  // same group — rigid
      const dofs = pathDofsBetween(A.nodeIdx, B.nodeIdx);
      if (!dofs.length) continue;
      // Tool-side body first when there is one — hit messages read better.
      if (B.side === "tool" && A.side !== "tool") pairs.push([b, a]);
      else pairs.push([a, b]);
      pairDofs.push(dofs);
    }
  }
  return { nodes, bodies, pairs, pairDofs, machine, bvhMs: performance.now() - t0 };
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
  const { nodes, bodies, pairs, pairDofs, machine } = model;
  const maxSamples = opts.maxSamples ?? DEFAULTS.maxSamples;
  const t0 = performance.now();
  const n = track.count;
  const totalCum = n > 0 ? track.cum[n - 1]! : 0;

  // Conservative advancement parameters. EXPLORE is the fixed step used
  // INSIDE contact regions (the pair is already flagged there) and as the
  // budget-exceeded fallback; MIN_ADV is the smallest advancement — a
  // below-margin dip narrower than MIN_ADV of path is the residual
  // detection epsilon (0.25 machine units, vs 5 mm fixed sampling before).
  const EXPLORE = Math.max(opts.linStepMm ?? DEFAULTS.linStepMm, opts.rotStepDeg ?? DEFAULTS.rotStepDeg);
  const MIN_ADV = 0.25;
  const HORIZON = Math.max(20, opts.margin * 10);  // distance query cap — beyond it, advance HORIZON-based
  const CHUNK_ROT_DEG = 22.5;  // lever bounds are computed per chunk; ≤22.5° keeps drift factors small
  let coarsened = false;

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

  // Worst hit per (line, pair) — same attribution shape as stage 1. `pi`
  // (pair index) is internal, for the contact-refinement pass.
  const worst = new Map<string, CollisionHit & { pi: number }>();
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

  // Distance between two posed bodies, capped at `maxT`: returns Infinity
  // when provably ≥ maxT (sphere prescreen — its slack also LOWER-bounds the
  // true distance, so advancement can use it — then BVH closest-point with
  // early-out; the matrix maps B's geometry into A's local frame: A⁻¹ · B).
  const pairDistance = (A: BuiltBody, B: BuiltBody, maxT: number): number => {
    const centerDist = A.worldCenter.distanceTo(B.worldCenter);
    const sphereGap = centerDist - A.radius - B.radius;
    if (sphereGap > maxT) return sphereGap;  // valid LOWER bound on true distance
    invA.copy(A.world).invert();
    relMat.multiplyMatrices(invA, B.world);
    const res = A.bvh.closestPointToGeometry(B.geom, relMat, target1, target2, 0, maxT);
    return res ? target1.distance : Infinity;  // null: provably beyond maxT
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
    const dist = pairDistance(bodies[ai]!, bodies[bi]!, opts.margin);
    if (dist <= opts.margin) {
      staticExcluded[pi] = 1;
      staticContacts.push({ a: bodies[ai]!.id, b: bodies[bi]!.id, dist });
    }
  }
  done++;

  const recordHit = (line: number, cum: number, rapid: boolean, pi: number, dist: number) => {
    const [ai, bi] = pairs[pi]!;
    const key = `${line}|${bodies[ai]!.id}|${bodies[bi]!.id}`;
    const prev = worst.get(key);
    if (!prev || dist < prev.dist) {
      worst.set(key, { line, cum, a: bodies[ai]!.id, b: bodies[bi]!.id, dist, rapid, pi });
    } else if (rapid && !prev.rapid) {
      prev.rapid = true;  // any rapid contact on this (line, pair) marks it
    }
  };

  // Conservative lever arm of a rotary DOF for one body at the CURRENT pose:
  // distance from the DOF's world axis line to the body's bounding sphere.
  const _axisPos = new THREE.Vector3();
  const _axisDir = new THREE.Vector3();
  const _leverV = new THREE.Vector3();
  const leverFor = (pd: PathDof, body: BuiltBody): number => {
    const nw = nodes[pd.nodeIdx]!.world;
    _axisPos.setFromMatrixPosition(nw);
    _axisDir.copy(pd.dof.axisVec).transformDirection(nw);
    _leverV.copy(body.worldCenter).sub(_axisPos);
    const along = _leverV.dot(_axisDir);
    return Math.sqrt(Math.max(0, _leverV.lengthSq() - along * along)) + body.radius;
  };

  // Pose the track at an arbitrary cum parameter and return one pair's
  // distance — the contact-refinement probe. Interpolates the same way the
  // sweep does, so refined parameters lie exactly on the swept path.
  const distAtCum = (s: number, pi: number): number => {
    let lo = 1, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (track.cum[mid]! < s) lo = mid + 1;
      else hi = mid;
    }
    const c0 = track.cum[lo - 1]!, c1 = track.cum[lo]!;
    const u = c1 > c0 ? Math.min(1, Math.max(0, (s - c0) / (c1 - c0))) : 1;
    const j = lo * 3, k = j - 3;
    poseAt(
      track.pos[k]! + (track.pos[j]! - track.pos[k]!) * u,
      track.pos[k + 1]! + (track.pos[j + 1]! - track.pos[k + 1]!) * u,
      track.pos[k + 2]! + (track.pos[j + 2]! - track.pos[k + 2]!) * u,
      track.abc[k]! + (track.abc[j]! - track.abc[k]!) * u,
      track.abc[k + 1]! + (track.abc[j + 1]! - track.abc[k + 1]!) * u,
      track.abc[k + 2]! + (track.abc[j + 2]! - track.abc[k + 2]!) * u,
    );
    const [ai, bi] = pairs[pi]!;
    return pairDistance(bodies[ai]!, bodies[bi]!, opts.margin);
  };

  // ---- Conservative advancement ----
  // Instead of fixed-step sampling, each step is bounded by
  // (distance − margin) / V, where V conservatively bounds the pair's
  // relative surface speed per unit of track parameter: translations
  // contribute their exact per-unit deltas; rotations contribute
  // Δangle × lever, with levers measured at both chunk endpoints and
  // inflated ×2 (+ the chunk's translation budget) to cover mid-chunk
  // drift — sound for chunks ≤ CHUNK_ROT_DEG of rotary sweep. Guarantee:
  // no margin crossing wider than MIN_ADV of path parameter is missed.
  const inContact = new Uint8Array(pairs.length);
  const pairV = new Float64Array(pairs.length);
  const sSafe = new Float64Array(pairs.length);
  const rotLever = pairDofs.map(list => new Float64Array(list.length));
  const jv0: number[] = new Array(jointVals.length).fill(0);
  const jv1: number[] = new Array(jointVals.length).fill(0);
  let budgetExceeded = false;

  const interpPose = (i: number, t: number) => {
    const j = i * 3, k = j - 3;
    poseAt(
      track.pos[k]! + (track.pos[j]! - track.pos[k]!) * t,
      track.pos[k + 1]! + (track.pos[j + 1]! - track.pos[k + 1]!) * t,
      track.pos[k + 2]! + (track.pos[j + 2]! - track.pos[k + 2]!) * t,
      track.abc[k]! + (track.abc[j]! - track.abc[k]!) * t,
      track.abc[k + 1]! + (track.abc[j + 1]! - track.abc[k + 1]!) * t,
      track.abc[k + 2]! + (track.abc[j + 2]! - track.abc[k + 2]!) * t,
    );
  };

  outer:
  for (let i = 1; i < n; i++) {
    if (shouldAbort?.()) break;
    const line = track.lines[i]!;
    const isRapid = track.rapid[i] === 1;
    const c0 = track.cum[i - 1]!, c1 = track.cum[i]!;
    const L = c1 - c0;
    if (L <= 1e-9) continue;
    const j = i * 3, k = j - 3;
    const rotDelta = Math.max(
      Math.abs(track.abc[j]! - track.abc[k]!),
      Math.abs(track.abc[j + 1]! - track.abc[k + 1]!),
      Math.abs(track.abc[j + 2]! - track.abc[k + 2]!),
    );
    const chunks = Math.max(1, Math.ceil(rotDelta / CHUNK_ROT_DEG));

    for (let ch = 0; ch < chunks; ch++) {
      const s0 = c0 + (L * ch) / chunks;
      const s1 = c0 + (L * (ch + 1)) / chunks;
      const Lc = s1 - s0;

      // Chunk endpoint joint values + start-pose rotary levers.
      interpPose(i, (s0 - c0) / L);
      for (let x = 0; x < jointVals.length; x++) jv0[x] = jointVals[x]!;
      for (let pi = 0; pi < pairs.length; pi++) {
        if (staticExcluded[pi]) continue;
        const [ai, bi] = pairs[pi]!;
        const list = pairDofs[pi]!;
        const lev = rotLever[pi]!;
        for (let di = 0; di < list.length; di++) {
          const pd = list[di]!;
          lev[di] = pd.dof.rotate
            ? Math.max(leverFor(pd, bodies[ai]!), leverFor(pd, bodies[bi]!))
            : 0;
        }
      }
      interpPose(i, (s1 - c0) / L);
      for (let x = 0; x < jointVals.length; x++) jv1[x] = jointVals[x]!;

      for (let pi = 0; pi < pairs.length; pi++) {
        if (staticExcluded[pi]) { pairV[pi] = 0; continue; }
        const [ai, bi] = pairs[pi]!;
        const A = bodies[ai]!, B = bodies[bi]!;
        const list = pairDofs[pi]!;
        let trans = 0;
        let rotRadLever = 0;
        for (let di = 0; di < list.length; di++) {
          const pd = list[di]!;
          const dJ = Math.abs((jv1[pd.dof.joint] ?? 0) - (jv0[pd.dof.joint] ?? 0));
          if (!pd.dof.rotate) trans += dJ;
          else {
            const lever = Math.max(rotLever[pi]![di]!, leverFor(pd, A), leverFor(pd, B));
            rotRadLever += (dJ * Math.PI / 180) * (lever + trans);
          }
        }
        // Soundness: within the chunk, the true lever exceeds the endpoint
        // lever by at most the chunk's own relative displacement — the
        // recursion leverTrue ≤ (leverEnd + trans) / (1 − rotRad) with
        // rotRad ≤ 0.4 (22.5° chunks) is bounded by ×1.65; ×2 gives slack.
        pairV[pi] = (trans + rotRadLever * 2) / Lc;
      }

      // Certificates: a distance query at s proves the pair cannot reach
      // the margin before sSafe = s + (d − margin)/V — no re-query needed
      // until then (lazy conservative advancement). V changes per chunk, so
      // certificates never carry across chunk boundaries.
      sSafe.fill(s0);

      let s = s0;
      for (;;) {
        interpPose(i, (s - c0) / L);
        done++;
        if (done > maxSamples && !budgetExceeded) {
          budgetExceeded = true;
          coarsened = true;  // honest: from here on, fixed EXPLORE steps
        }
        let step = s1 - s;
        for (let pi = 0; pi < pairs.length; pi++) {
          if (staticExcluded[pi]) continue;
          if (sSafe[pi]! > s + 1e-9) {
            const remain = sSafe[pi]! - s;
            if (remain < step) step = remain;
            continue;  // certificate still valid — skip the query
          }
          const [ai, bi] = pairs[pi]!;
          const A = bodies[ai]!, B = bodies[bi]!;
          const d = pairDistance(A, B, HORIZON);
          if (d <= opts.margin) {
            recordHit(line, s, isRapid, pi, d);
            inContact[pi] = 1;
            sSafe[pi] = s + EXPLORE;  // re-probe cadence inside the contact
          } else {
            if (inContact[pi] && d > opts.margin * 2) inContact[pi] = 0;
            const bound = d === Infinity ? HORIZON : d;
            sSafe[pi] = s + Math.max(MIN_ADV, (bound - opts.margin) / Math.max(pairV[pi]!, 1e-9));
          }
          const remain = sSafe[pi]! - s;
          if (remain < step) step = remain;
        }
        if (budgetExceeded) step = Math.min(step, EXPLORE);
        if (s >= s1 - 1e-9) break;
        s = Math.min(s1, s + Math.max(step, MIN_ADV));
        if (done > maxSamples * 4) break outer;  // hard runaway backstop
      }
    }
    if (onProgress && (i & 15) === 0) onProgress(Math.min(1, c1 / (totalCum || 1)));
  }
  // Contact refinement: a penetrating hit's discovering sample can sit up
  // to one sample step PAST true contact — jumping to it would show the
  // tool already buried. Walk back by the local sample step to the last
  // clear parameter (crossing segment boundaries freely), then bisect the
  // first-contact crossing. Cost: only hit pairs, ~30 probes each.
  // "Contact" for the refinement probes: intersecting meshes report a
  // closest distance of ~1e-8 (float), never a clean 0.
  const CONTACT_EPS = 1e-4;
  for (const h of worst.values()) {
    if (h.dist > CONTACT_EPS || h.cum <= 0) continue;  // near-misses keep their closest-approach sample
    let hi = h.cum;
    let lo = hi;
    let guard = 0;
    let bracketed = false;
    const back = Math.max(MIN_ADV, EXPLORE / 4);
    while (guard++ < 128 && lo > 0) {
      lo = Math.max(0, lo - back);
      if (distAtCum(lo, h.pi) > CONTACT_EPS) { bracketed = true; break; }
      hi = lo;  // still in contact — earliest known contact moves back
    }
    if (!bracketed) { h.cum = hi; continue; }  // contact reaches the walk limit — keep the earliest probe
    for (let it = 0; it < 24 && hi - lo > 1e-3; it++) {
      const mid = (lo + hi) / 2;
      if (distAtCum(mid, h.pi) <= CONTACT_EPS) hi = mid;
      else lo = mid;
    }
    h.cum = hi;
  }
  onProgress?.(1);

  const hits = [...worst.values()]
    .sort((x, y) => x.cum - y.cum)
    .slice(0, MAX_HITS)
    .map(({ pi: _pi, ...rest }) => rest);
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

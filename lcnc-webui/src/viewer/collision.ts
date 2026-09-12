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
import { liftToJoints, tipWcs, wcsTerms, type PartFrameWcs, type WcsTerms } from "./partFrame";
import { tloForIndex, toolForIndex, type TloEvent } from "./tloEvents";
import { kinsForSegment, makeKins, worldModeForSpec, type KinsModel, type KinsSpec } from "./kins";
/** The subset of the scrub track the sweep consumes. The worker request
 *  ships a COPIED projection of the real ScrubTrack (typed arrays only —
 *  line index and the time-axis fields never cross), so the
 *  boundary type says exactly that instead of posing as the full track. */
export interface CollisionTrack {
  pos: Float32Array;
  abc: Float32Array;
  lines: Uint32Array;
  rapid: Uint8Array;
  cum: Float32Array;
  count: number;
  /** Per-segment RAW switchkins type (phase 2b, raw since phase 3) —
   *  absent = untracked. Mapped per family via kinsForSegment. */
  mode?: Uint8Array;
  /** Per-segment governing TWP frame index into `frames` (0xff = none). */
  frame?: Uint8Array;
  /** TWP frame triplets [preRot rad, primary deg, secondary deg]. */
  frames?: [number, number, number][];
  /** Kins-flip relabel flags: brk[i]=1 ⇒ segment i-1→i is a frame relabel
   *  at a stationary pose — zero machine motion, excluded from the sweep
   *  and from its distance parameterization. Absent = legacy track. */
  brk?: Uint8Array;
  /** Per-segment WCS epoch index (review P2) — selects the entry of
   *  CollisionOptions.epochTerms that converts this segment's program
   *  coords to machine coords. Absent = single-basis (live wcs terms). */
  wcs?: Uint8Array;
  /** Per-segment TLO/tool event index (schema 8) into
   *  CollisionOptions.tloEvents (0xff = live offset governs). The lift and
   *  the tool body's tip shift both use that segment's offset. */
  tlo?: Uint8Array;
}

export interface CollisionMachine {
  groups: Array<{ id: string; parent: string; translate?: number[] }>;
  kinematics: Array<Record<string, any>>;
  workGroup: string;
  toolGroup: string;
  /** machine.json mm → machine units (1 mm machines, 1/25.4 inch). */
  unitScale: number;
  /** Axis letters in JOINT order (viewer_init.axes). */
  axes: string[];
  /** Kins selection (serializable — crosses the worker boundary). Absent =
   *  trivkins. */
  kins?: KinsSpec;
}

export interface CollisionBody {
  id: string;
  group: string;
  /** Triangle soup in machine.json mm (unit-scaled at build time). */
  positions: Float32Array;
  /** Static placement inside the group — mm and radians, as machine.json. */
  translate?: number[];
  rotate?: number[];
  /** STOCK body: the one thing the tool may FEED into (cutting). Without a
   *  stock body — the current default — the tool may touch NOTHING: real
   *  programs cut stock sitting above the fixture, so tool contact with any
   *  machine body is a crash by definition. */
  stock?: boolean;
}

export interface CollisionHit {
  line: number;
  /** Track-cum of FIRST TOUCH (refined) for contact hits; closest-approach
   *  sample for near-misses — the scrub-to-hit target. */
  cum: number;
  /** Track-cum where the contact ENDS (refined exit, clamped to the line) —
   *  equals `cum` for near-misses. With `intervals` present this is the
   *  LAST interval's end (kept for compatibility). */
  cumEnd: number;
  /** Contact intervals [enter, exit] in track cum, boundary-refined —
   *  contact within one line can be INTERMITTENT (a rotary sweep can
   *  brush a part, leave it, and brush it again; user-caught on a TCP
   *  return move). The clash tint tests membership here; the timeline
   *  marks every interval ONSET. Absent for near-misses. */
  intervals?: Array<[number, number]>;
  a: string;               // tool-side body id
  b: string;               // work-side body id
  dist: number;            // machine units; 0 = contact/penetration
  /** True when the contact happens during a RAPID — always a real problem.
   *  Feed-move contact with the work-holding (platter) can be legitimate
   *  cutting; there is no stock model to tell the difference. */
  rapid: boolean;
  /** Set when this record's contact BEGAN on an earlier line and never
   *  separated (verified: the pair never cleared 2× the margin): the value
   *  is that onset line. The pair is still in contact here — this is NOT a
   *  new event (operator-caught: a beam rammed into the portal on the entry
   *  move was re-reported on every following line). Absent = this record
   *  IS the onset. Records are still one per (line, pair) so the clash tint
   *  and the G-code line marks show the full extent. */
  continuation?: number;
  /** On an ONSET record: the last line the contact persists through
   *  (== line when the contact ends on its own line). */
  spanEndLine?: number;
}

/** What the G-code panel marks: every line in contact, onset or not. */
export interface CollisionLineMark { line: number; continuation?: number }

export interface CollisionOptions {
  /** Clearance margin in machine units — pairs closer than this are hits. */
  margin: number;
  /** Re-probe cadence INSIDE contact regions + budget-fallback step (the
   *  free-space step is distance-driven — conservative advancement). */
  linStepMm?: number;
  /** Folded into the explore cadence (1° ≙ 1 mm); kept for callers. */
  rotStepDeg?: number;
  /** Safety budget on pose evaluations — on breach the sweep degrades to
   *  fixed explore steps (result says `coarsened`). The hard backstop at
   *  4× this count STOPS the sweep and says so (`truncated.reason ===
   *  "samples"`) — it used to break out silently. */
  maxSamples?: number;
  /** Wall-clock budget (ms). On breach the sweep STOPS where it is and the
   *  result says `truncated` with the covered fraction — never silently: a
   *  program too large for the budget reports "N % swept", not "clear".
   *  (2026-09-10: a 1.18 M-point program ran ~2 h per sweep, restarted on
   *  every touch-off, and starved the operator's GPU the whole time.) */
  maxMs?: number;
  /** Snapshot hook for a driver that parks and resumes the sweep (the
   *  collision worker): see SnapshotHandle. Absent = no snapshots. */
  snapshot?: SnapshotHandle;
  /** The clock the budget (and `sweepMs`) runs on — default performance.now.
   *  The worker passes an ACTIVE-time clock that stands still while the
   *  sweep is paused for camera interaction, so a pause never eats the budget. */
  clock?: () => number;
  /** Time between iterator checkpoints (ms, on `clock`; default YIELD_MS).
   *  The count-based checkpoints (every 16 segments / SAMPLES_PER_YIELD
   *  samples) stay as the FLOOR — a frozen clock still yields — this is the
   *  ceiling on how long a stop/cancel/park waits (2026-09-12: with pairs
   *  inside the margin every 0.25 units queries the meshes, and 512 such
   *  samples were seconds between checkpoints — the operator's ❚❚ looked
   *  ignored). */
  yieldMs?: number;
  /** Per-epoch WCS re-add terms (review P2), indexed by the track's `wcs`
   *  bytes — built by wcsEpochs.epochTermsFor from the payload's wcs_frames
   *  + the live table. Absent = single-basis (the live `wcs` terms). */
  epochTerms?: WcsTerms[];
  /** Per-segment TLO/tool events (schema 8), indexed by the track's `tlo`
   *  bytes. Absent = the live `wcs.tool` governs every segment. */
  tloEvents?: TloEvent[];
  /** Dims (machine units, the DISPLAYED marker formula) per PROGRAM tool
   *  number: the tool body is swapped to the segment's tool as the sweep
   *  walks the track (schema 8). Tools without an entry keep the base body
   *  (the loaded tool / stub the caller built). */
  toolDims?: Record<number, { diam: number; len: number }>;
  /** The loaded tool number — what a segment before the first M6 row
   *  (or a payload without the channel) runs with. */
  liveTool?: number | null;
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
  /** Set when the no-missed-crossing guarantee does NOT hold for this sweep,
   *  with the reason. The clearance bounds are certified per kins FAMILY
   *  (kinsBulge.test.ts), so a segment whose declared kins this client cannot
   *  evaluate falls back to an identity pose whose bound is 0 — sound for a
   *  trivkins machine, wrong for the machine that declared otherwise. Null
   *  means the sweep is certified. Unchecked is not clear. */
  uncertified: string | null;
  pairCount: number;
  bvhMs: number;
  sweepMs: number;
  /** Set when the sweep stopped before the end of the track — the wall-clock
   *  budget (`time`) or the hard sample backstop (`samples`). `covered` is
   *  the swept fraction of the track's path (dist parameter, 0..1). Null =
   *  the whole track was swept. A truncated sweep with no hits is NOT
   *  "clear": only the covered part is. */
  truncated: { covered: number; reason: "time" | "samples" | "stopped" } | null;
}

/** Driver-side stop/continue (2026-09-12). The iterator installs `take` at
 *  its start and clears it when it returns. While the generator is
 *  SUSPENDED at a checkpoint the driver may call `take(reason)` to get the
 *  sweep-so-far as a CollisionResult — `truncated` set with that reason and
 *  the covered fraction — WITHOUT ending the generator: resuming it
 *  afterwards continues the sweep with every certificate and contact state
 *  intact. The refinement runs on COPIES of the hit records and the loop
 *  re-poses every sample itself, so a snapshot leaves the suspended sweep
 *  exactly as it found it. */
export interface SnapshotHandle {
  take: ((reason: "time" | "stopped") => CollisionResult) | null;
}

// maxSamples is a RUNAWAY backstop, not the operative bound: with carried
// clearance certificates a certified sample costs ~10 µs, and a program of a
// million short segments needs at least one sample per segment — the old
// 60 k (sized for ~1 ms samples) truncated such a program at 9 % in 3 s.
// The wall-clock budget (`maxMs`) is what bounds a sweep's cost now.
const DEFAULTS = { linStepMm: 5, rotStepDeg: 4, maxSamples: 4_000_000 };
/** Samples between iterator checkpoints inside one segment: a long segment
 *  (a slow plunge, a full rotary turn) must still yield to its driver. The
 *  count is the floor; YIELD_MS of active time also yields (the clock is
 *  read every SAMPLES_PER_CLOCK samples — one read per sample would be
 *  measurable on a million certified 10 µs samples). */
const SAMPLES_PER_YIELD = 512;
const SAMPLES_PER_CLOCK = 32;
const YIELD_MS = 8;
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
  /** Per pair: tool-side body × an explicit STOCK body. FEED contact on
   *  these pairs is CUTTING — expected machining, not reported; contact
   *  whose onset falls in a RAPID is a crash and reports normally. */
  pairCutting: boolean[];
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

  // Cutting pairs: tool-side body × an EXPLICIT stock body. No machine part
  // is ever implicitly cuttable — the platter is workholding, not stock.
  const stockIds = new Set(bodyDefs.filter(d => d.stock).map(d => d.id));
  const isCuttingBody = (b: BuiltBody) => stockIds.has(b.id);

  const pairs: Array<[number, number]> = [];
  const pairDofs: PathDof[][] = [];
  const pairCutting: boolean[] = [];
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
      pairCutting.push(
        (A.side === "tool" && isCuttingBody(B)) || (B.side === "tool" && isCuttingBody(A)),
      );
    }
  }
  return { nodes, bodies, pairs, pairDofs, pairCutting, machine, bvhMs: performance.now() - t0 };
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

/**
 * Refinement can split ONE continuous contact into windows that meet at a
 * boundary: the clusters are seeded from in-contact samples (pushed only at
 * dist ≤ CONTACT_EPS), so a sample gap wider than CLUSTER_GAP opens two
 * clusters even when every probe between them is still in contact. The exit
 * walk of the first then reaches the next cluster's first sample unbracketed
 * and the entry walk of the second starts there — the two boundaries land on
 * the SAME cum. Two boundaries within twice the bisection tolerance (1e-3)
 * are one boundary; the windows are one contact. Operator-caught 2026-09-03
 * as "one clash reported, two marks on the timeline". Pure; unit-tested.
 */
export function mergeContiguousIntervals(
  ivs: ReadonlyArray<readonly [number, number]>,
  eps = 2e-3,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const iv of ivs) {
    const last = out[out.length - 1];
    if (last && iv[0] - last[1] <= eps) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

/** Sweep the track to completion (or to its budget). `onProgress` gets 0..1
 *  at the iterator's checkpoints; `shouldAbort` is polled there — true stops
 *  the sweep with what was swept so far (an abort is the caller's decision,
 *  so `truncated` stays null). Drives `sweepCollisionsIter`; tests and the
 *  envelope gates use this form. */
export function sweepCollisions(
  model: CollisionModel,
  track: CollisionTrack,
  wcs: PartFrameWcs,
  opts: CollisionOptions,
  onProgress?: (frac: number) => void,
  shouldAbort?: () => boolean,
): CollisionResult {
  const it = sweepCollisionsIter(model, track, wcs, opts);
  let r = it.next();
  while (!r.done) {
    onProgress?.(r.value);
    r = it.next(shouldAbort?.() === true);
  }
  return r.value;
}

/** The sweep as a resumable iterator: yields its progress (0..1) at
 *  checkpoints — before the first segment, every 16 segments, every
 *  SAMPLES_PER_YIELD samples inside a segment, whenever `yieldMs` of clock
 *  time has passed since the last checkpoint (checked per segment and every
 *  SAMPLES_PER_CLOCK samples), and once at the end — and returns the result. `next(true)` at a checkpoint aborts. The worker drives
 *  it in time slices so a cancel message lands between checkpoints instead
 *  of needing the worker terminated (and the BVH model rebuilt). The
 *  wall-clock budget (`opts.maxMs`) is checked at the same checkpoints. */
export function* sweepCollisionsIter(
  model: CollisionModel,
  track: CollisionTrack,
  wcs: PartFrameWcs,
  opts: CollisionOptions,
): Generator<number, CollisionResult, boolean | undefined> {
  const { nodes, bodies, pairs, pairDofs, pairCutting, machine } = model;
  const maxSamples = opts.maxSamples ?? DEFAULTS.maxSamples;
  const clock = opts.clock ?? (() => performance.now());
  const t0 = clock();
  const yieldMs = opts.yieldMs ?? YIELD_MS;
  let lastYield: number;   // set after the baseline checkpoint
  const n = track.count;

  // The sweep runs in its own DISTANCE parameterization (mm, 1° ≙ 1 mm) —
  // never the track's cum, which may be TIME (unified timeline): the
  // guarantee constants (MIN_ADV, EXPLORE, chunking) are spatial, and on a
  // time axis a fast rapid would compress a 20 mm window into 0.25 s.
  // Hits are converted back to track-cum at the end (scrub-to-hit target).
  const dcum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    if (track.brk?.[i]) {
      // Frame relabel — a re-expression, not travel: contributing its
      // program-space jump would stretch the sweep's spatial guarantee
      // constants across motion that never happens. Zero width also makes
      // the segment loop's L<=eps guard skip it without a special case.
      dcum[i] = dcum[i - 1]!;
      continue;
    }
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
    dcum[i] = dcum[i - 1]! + Math.max(lin, rot);
  }
  const totalCum = n > 0 ? dcum[n - 1]! : 0;

  // Dist-parameter → track-cum (linear within a segment; monotonic).
  const distToTrackCum = (s: number): number => {
    if (n < 2) return 0;
    let lo = 1, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dcum[mid]! < s) lo = mid + 1;
      else hi = mid;
    }
    const d0 = dcum[lo - 1]!, d1 = dcum[lo]!;
    const u = d1 > d0 ? Math.min(1, Math.max(0, (s - d0) / (d1 - d0))) : 1;
    return track.cum[lo - 1]! + u * (track.cum[lo]! - track.cum[lo - 1]!);
  };

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

  // TIP-space terms; the tool offset is per segment (schema 8) and enters
  // through liftToJoints + the tool body's tip shift below, ONE source.
  const o = wcsTerms(tipWcs(wcs));
  const liveTlo = tloForIndex(undefined, undefined, wcs.tool);
  const tloFor = (i: number): readonly number[] =>
    tloForIndex(track.tlo?.[i], opts.tloEvents, wcs.tool);
  // The parametric tool body (id "tool", tip at its local origin): the
  // swept joints are G43-inclusive, which poses the tool GROUP at the joint
  // position (tip + TLO), so the body is shifted by −TLO in the tool node's
  // LOCAL frame per pose — the same subtraction applyState phase 3 makes
  // for the live marker and partFrame makes for the drawn tip. It used to
  // be baked into the cylinder verts once per sweep, which could not follow
  // a per-segment offset.
  const toolBodyIdx = bodies.findIndex(b => b.id === "tool");
  const _tloMat = new THREE.Matrix4();
  // Per-program-tool body VARIANTS (schema 8): the segment's tool number
  // (toolForIndex) selects the cylinder the tool body wears. Only the ONE
  // tool BuiltBody's geometry/BVH/sphere swap — pairs, pair DOFs and the
  // cutting flags are properties of the body's identity and stay invariant
  // (pushing K tool bodies would mint K× pairs and misattribute hits).
  type ToolVariant = { geom: THREE.BufferGeometry; bvh: MeshBVH; center: THREE.Vector3; radius: number };
  const toolVariants = new Map<number, ToolVariant>();
  let baseVariant: ToolVariant | null = null;
  let appliedTool: number | null | undefined = undefined;
  if (toolBodyIdx >= 0 && opts.toolDims && opts.tloEvents?.length) {
    const tb = bodies[toolBodyIdx]!;
    baseVariant = { geom: tb.geom, bvh: tb.bvh, center: tb.center, radius: tb.radius };
    for (const ev of opts.tloEvents) {
      const tn = ev.tool;
      if (tn == null || toolVariants.has(tn)) continue;
      const dims = opts.toolDims[tn];
      if (!dims) continue;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(toolCylinderPositions(dims.diam, dims.len), 3));
      const bvh = new MeshBVH(geom);
      (geom as any).boundsTree = bvh;
      geom.computeBoundingSphere();
      toolVariants.set(tn, { geom, bvh, center: geom.boundingSphere!.center.clone(), radius: geom.boundingSphere!.radius });
    }
  }
  const applyTool = (tn: number | null) => {
    if (!baseVariant || tn === appliedTool) return;
    appliedTool = tn;
    const v = (tn != null ? toolVariants.get(tn) : undefined) ?? baseVariant;
    const tb = bodies[toolBodyIdx]!;
    tb.geom = v.geom; tb.bvh = v.bvh; tb.center = v.center; tb.radius = v.radius;
  };
  const toolFor = (i: number): number | null =>
    toolForIndex(track.tlo?.[i], opts.tloEvents, opts.liveTool);
  const machineVals: number[] = [0, 0, 0, 0, 0, 0];
  // Chunk-start machine coords. machineVals is shared scratch that the second
  // interpPose overwrites, so the bulge bound needs its own copy of the first
  // endpoint or it would be handed the same pose twice.
  const chunkM0: number[] = [0, 0, 0, 0, 0, 0];
  const jointVals: number[] = new Array(Math.max(machine.axes.length, 9)).fill(0);
  // Identity kins always; the machine's WORLD kins only for track segments
  // the phase-2 mode flags mark (live TLO overlays the pivot math).
  // Soundness for the V bounds below under world kins: the pivot
  // compensation makes the LINEAR joints trigonometric in the swept rotary,
  // so chunk-endpoint deltas can under-read their true in-chunk travel —
  // and for a pair whose DOF path does NOT contain the rotary (e.g.
  // tool-vs-column during a C sweep) the rotary lever term supplies no
  // budget at all (review finding: the old note claimed it did). The fix is
  // KinsModel.jointBulge: each family bounds its OWN per-joint mid-chunk
  // excursion from its own geometry, and this file no longer knows any
  // family's parameter names. It used to read the trt-only KinsParams, which
  // a trsrn spec does not carry at all — so that machine's ~2 m rotary lever
  // came out as the distance from the machine origin. Certified per family by
  // kinsBulge.test.ts.
  const identityKins = makeKins(machine.axes);
  const jointBulge = new Float64Array(jointVals.length);
  // Raw wire types → per-vertex world flags for THIS machine's family
  // (worldModeForSpec) — the uncertified check below indexes these.
  const modeWorld = track.mode
    ? Array.from(track.mode, (t) => worldModeForSpec(t, machine.kins))
    : null;
  // Per-vertex kins model (phase 3): RAW type + governing TWP frame via
  // kinsForSegment (family-aware; loud fallbacks live there).
  const tFrames = track.frames;
  const vertModel: KinsModel[] | null = track.mode
    ? Array.from(track.mode, (t, i) => {
        const fi = track.frame?.[i];
        const fr = (fi != null && fi !== 0xff && tFrames) ? tFrames[fi] ?? null : null;
        return kinsForSegment(machine.axes, machine.kins, t, fr,
                              tloFor(i)[2] || undefined, "collision sweep");
      })
    : null;
  // The guarantee is certified per FAMILY, so it can only be claimed for a
  // segment whose model is the one the machine declared. kinsForSegment falls
  // back to trivkins — loudly, but still — for a kins type this client cannot
  // evaluate or a plane segment with no frame; that model's bulge is
  // legitimately 0, which would then be silently wrong for the real machine.
  // Report it instead of assuming it: unchecked is not clear.
  let uncertified: string | null = null;
  if (modeWorld && vertModel) {
    for (let i = 0; i < modeWorld.length; i++) {
      if (!modeWorld[i]) continue;
      const m = vertModel[i];
      if (m && m.type !== "trivkins") continue;
      uncertified = `non-identity segments fell back to trivkins (declared `
        + `${machine.kins?.type ?? "unknown"}) — poses and clearance bounds `
        + `are identity approximations`;
      break;
    }
  }
  const kinsOut: (number | null)[] = [];
  const scratch = {
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
    step: new THREE.Quaternion(), one: new THREE.Vector3(1, 1, 1),
  };
  const relMat = new THREE.Matrix4();
  const invA = new THREE.Matrix4();
  const target1 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };
  const target2 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };

  // Worst hit per (line, pair) — same attribution shape as stage 1. `pi`
  // (pair index) and `samples` (in-contact sample cums, the interval
  // clustering input) are internal to the refinement pass.
  const worst = new Map<string, CollisionHit & { pi: number; samples: number[] }>();
  let done = 0;

  // Per-segment epoch terms (review P2): a segment's program coords convert
  // through ITS epoch's basis; single-basis tracks fall through to `o`.
  const termFor = (i: number): WcsTerms =>
    (track.wcs && opts.epochTerms?.[track.wcs[i] ?? 0]) ? opts.epochTerms[track.wcs[i] ?? 0]! : o;

  const poseAt = (px: number, py: number, pz: number, pa: number, pb: number, pc: number, model: KinsModel = identityKins, oSeg: WcsTerms = o, tloSeg: readonly number[] = liveTlo, toolSeg: number | null = null) => {
    applyTool(toolSeg);
    liftToJoints(px, py, pz, pa, pb, pc, oSeg, tloSeg, machineVals);
    model.inverse(machineVals, kinsOut);
    for (let ji = 0; ji < kinsOut.length; ji++) {
      jointVals[ji] = kinsOut[ji] ?? 0;  // UVW: 0, as the preview transform
    }
    // Models write only the joints they drive (trsrn hardcodes six), so on a
    // machine with more joints than that the tail would keep whatever a
    // PRECEDING segment's model left there — a stale pose, not a fresh one.
    for (let ji = kinsOut.length; ji < jointVals.length; ji++) jointVals[ji] = 0;
    poseTree(nodes, jointVals, scratch);
    for (let bi = 0; bi < bodies.length; bi++) {
      const body = bodies[bi]!;
      body.world.multiplyMatrices(nodes[body.nodeIdx]!.world, body.localMat);
      if (bi === toolBodyIdx && (tloSeg[0] || tloSeg[1] || tloSeg[2])) {
        body.world.multiply(_tloMat.makeTranslation(-(tloSeg[0] ?? 0), -(tloSeg[1] ?? 0), -(tloSeg[2] ?? 0)));
      }
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
  // CUTTING pairs are never baseline-excluded (a tool parked on the work is
  // normal) — they instead seed the in-contact state for onset tracking.
  const staticExcluded = new Uint8Array(pairs.length);
  const inContact = new Uint8Array(pairs.length);
  const onsetRapid = new Uint8Array(pairs.length);
  // The line a pair's CURRENT contact began on (-1 = not in contact) — the
  // same latch the cutting semantics use for onsetRapid, now read by the
  // non-cutting branch too: a record minted on a later line while the pair
  // never separated is a CONTINUATION, not a new clash.
  const onsetLine = new Int32Array(pairs.length).fill(-1);
  const staticContacts: CollisionResult["staticContacts"] = [];
  poseAt(track.pos[0]!, track.pos[1]!, track.pos[2]!,
         track.abc[0]!, track.abc[1]!, track.abc[2]!, vertModel?.[0] ?? identityKins,
         termFor(0), tloFor(0), toolFor(0));
  for (let pi = 0; pi < pairs.length; pi++) {
    const [ai, bi] = pairs[pi]!;
    const dist = pairDistance(bodies[ai]!, bodies[bi]!, opts.margin);
    if (dist <= opts.margin) {
      if (pairCutting[pi]) {
        inContact[pi] = 1;  // engaged from the start — a later retract is benign
      } else {
        staticExcluded[pi] = 1;
        staticContacts.push({ a: bodies[ai]!.id, b: bodies[bi]!.id, dist });
      }
    }
  }
  done++;

  // Full closest distance of ~1e-8 (float) never a clean 0 — see the
  // refinement pass, which shares this contact threshold.
  const CONTACT_EPS = 1e-4;
  const keyFor = (line: number, pi: number) => {
    const [ai, bi] = pairs[pi]!;
    return `${line}|${bodies[ai]!.id}|${bodies[bi]!.id}`;
  };
  const recordHit = (line: number, cum: number, rapid: boolean, pi: number, dist: number) => {
    const [ai, bi] = pairs[pi]!;
    const key = keyFor(line, pi);
    const prev = worst.get(key);
    if (!prev || dist < prev.dist) {
      const rec: CollisionHit & { pi: number; samples: number[] } = {
        line, cum, cumEnd: cum, a: bodies[ai]!.id, b: bodies[bi]!.id, dist, rapid, pi,
        samples: prev ? prev.samples : [] };
      // Continuation: the pair's contact began on an EARLIER line and has
      // not separated since. A worse sample on the same line keeps the
      // record's existing verdict.
      const cont = prev ? prev.continuation
        : (onsetLine[pi]! >= 0 && onsetLine[pi] !== line ? onsetLine[pi]! : undefined);
      if (cont !== undefined) rec.continuation = cont;
      if (prev) rec.cumEnd = Math.max(prev.cumEnd, cum);
      if (dist <= CONTACT_EPS) rec.samples.push(cum);
      worst.set(key, rec);
    } else {
      if (dist <= CONTACT_EPS) {
        prev.samples.push(cum);  // in-contact sample — interval clustering input
        if (cum > prev.cumEnd) prev.cumEnd = cum;
      }
      if (rapid && !prev.rapid) prev.rapid = true;  // any rapid contact on this (line, pair) marks it
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
      if (dcum[mid]! < s) lo = mid + 1;
      else hi = mid;
    }
    const c0 = dcum[lo - 1]!, c1 = dcum[lo]!;
    const u = c1 > c0 ? Math.min(1, Math.max(0, (s - c0) / (c1 - c0))) : 1;
    const j = lo * 3, k = j - 3;
    poseAt(
      track.pos[k]! + (track.pos[j]! - track.pos[k]!) * u,
      track.pos[k + 1]! + (track.pos[j + 1]! - track.pos[k + 1]!) * u,
      track.pos[k + 2]! + (track.pos[j + 2]! - track.pos[k + 2]!) * u,
      track.abc[k]! + (track.abc[j]! - track.abc[k]!) * u,
      track.abc[k + 1]! + (track.abc[j + 1]! - track.abc[k + 1]!) * u,
      track.abc[k + 2]! + (track.abc[j + 2]! - track.abc[k + 2]!) * u,
      vertModel?.[lo] ?? identityKins,
      termFor(lo),
      tloFor(lo),
      toolFor(lo),
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
  const pairV = new Float64Array(pairs.length);
  const sSafe = new Float64Array(pairs.length);
  // Carried clearance certificates (2026-09-10). A distance query leaves a
  // pair with clearance (d − margin); a chunk can consume at most V × Lc of
  // it (V bounds the relative surface speed per unit of path). The remainder
  // CARRIES into the next chunk, re-expressed in that chunk's V — the old
  // per-chunk reset re-queried every pair at every chunk boundary, which on
  // a program of a million 0.1 mm segments was 45 BVH queries per 0.1 mm
  // (2.85 ms per segment, ~2 h per sweep). Same guarantee: the bound is
  // summed piecewise over the chunks the pair skipped.
  const clear = new Float64Array(pairs.length);   // clearance left since the last query
  const sQ = new Float64Array(pairs.length);      // path parameter of that query (or chunk start)
  const qLine = new Int32Array(pairs.length).fill(-1);   // line of that query (per-line contact marks)
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
      vertModel?.[i] ?? identityKins,
      termFor(i),
      tloFor(i),
      toolFor(i),
    );
  };

  const maxMs = opts.maxMs ?? Infinity;
  let truncated: CollisionResult["truncated"] = null;
  // Driver abort (next(true)): the result is discarded by every driver, so
  // the epilogue must not refine — a cancelled sweep with thousands of
  // contact records used to spend 10+ s refining them before the worker
  // could start the sweep that superseded it (trace 2026-09-12: 14 s at 0 %).
  let aborted = false;
  let sweptTo = 0;   // dist parameter reached — the covered fraction on truncation
  const overBudget = (): boolean => clock() - t0 > maxMs;
  const frac = (s: number): number => Math.min(1, s / (totalCum || 1));
  // Contact refinement: a penetrating hit's discovering sample can sit up
  // to one sample step PAST true contact — jumping to it would show the
  // tool already buried. Walk back by the local sample step to the last
  // clear parameter (crossing segment boundaries freely), then bisect the
  // first-contact crossing. Cost: only hit pairs, ~30 probes each.
  // "Contact" for the refinement probes: intersecting meshes report a
  // Dist-cum where the hit's LINE begins — refinement must never walk back
  // past it: through-contact across line boundaries (the pair never clears
  // between lines) would collapse every following line's hit onto the first
  // line's contact point (same jump target, wrong line label).
  const segOfLine = (cum: number, line: number): number => {
    let lo = 1, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dcum[mid]! < cum) lo = mid + 1;
      else hi = mid;
    }
    // A hit recorded exactly ON a boundary (chunk starts sit on dcum values)
    // binary-searches into the PREVIOUS segment — step forward to the
    // segment that actually carries the hit's line.
    while (lo < n - 1 && track.lines[lo] !== line && track.lines[lo + 1] === line) lo++;
    return lo;
  };
  const lineStartDist = (cum: number, line: number): number => {
    let lo = segOfLine(cum, line);
    while (lo > 1 && track.lines[lo - 1] === line) lo--;
    return dcum[lo - 1]!;
  };
  const lineEndDist = (cum: number, line: number): number => {
    let lo = segOfLine(cum, line);
    while (lo < n - 1 && track.lines[lo + 1] === line) lo++;
    return dcum[lo]!;
  };
  const back = Math.max(MIN_ADV, EXPLORE / 4);
  // Bisect a contact boundary between a known in-contact cum and a known
  // clear cum (either order); returns the refined in-contact-side cum.
  const bisectBoundary = (contactCum: number, clearCum: number, pi: number): number => {
    let c = contactCum, x = clearCum;
    for (let it = 0; it < 24 && Math.abs(x - c) > 1e-3; it++) {
      const mid = (c + x) / 2;
      if (distAtCum(mid, pi) <= CONTACT_EPS) c = mid;
      else x = mid;
    }
    return c;
  };
  // The result — built from a set of hit RECORDS so it can run twice: on the
  // originals when the sweep ends, and on COPIES for a snapshot of the sweep-
  // so-far while the generator is parked (SnapshotHandle). Everything below
  // reads the loop's live state (sweptTo, done, coarsened, uncertified, the
  // static contacts) at call time.
  // Refinement memo (2026-09-12): a park snapshots the sweep-so-far by
  // re-running buildResult on COPIES of every record, and the refinement
  // below is its cost — mesh probes per contact boundary, for every record
  // including the continuation records past the MAX_HITS cap (a long
  // penetration is one record per line). A record whose inputs have not
  // changed since it was last refined — its raw extent and sample count;
  // records only ever GAIN samples — refines to the same intervals, so the
  // second and every later snapshot (and the final result) reuse them.
  // Values are DIST cum (captured before the track-cum conversion below).
  const refined = new Map<string, { sig: string; cum: number; cumEnd: number; intervals: Array<[number, number]> }>();
  const buildResult = (recs: typeof worst, trunc: CollisionResult["truncated"], final: boolean, refine: boolean): CollisionResult => {
    // The REPORTED set first — onsets first when the cap bites: a long
    // penetration's continuation records must never evict a genuinely
    // distinct later clash — and only it is refined (2026-09-12: every
    // record was, continuation records past the cap included — a program
    // in contact from its first point is one record per LINE, and a park
    // or the final result refined thousands of them at ~30 mesh probes
    // each). Selection on the raw cums: refinement moves an onset back by
    // under one sample step, so the order is the same but for near-ties.
    const entries = [...recs.entries()];
    const onsetE = entries.filter(([, h]) => h.continuation === undefined).sort((x, y) => x[1].cum - y[1].cum);
    const contE = entries.filter(([, h]) => h.continuation !== undefined).sort((x, y) => x[1].cum - y[1].cum);
    const selected = [...onsetE, ...contE].slice(0, MAX_HITS);
    for (const [key, h] of selected) {
      if (!refine) break;
      if (h.dist > CONTACT_EPS || h.cum <= 0) continue;  // near-misses keep their closest-approach sample
      const sig = `${h.samples.length},${h.cum},${h.cumEnd}`;
      const memo = refined.get(key);
      if (memo && memo.sig === sig) {
        h.cum = memo.cum;
        h.cumEnd = memo.cumEnd;
        h.intervals = memo.intervals.map(iv => [iv[0], iv[1]] as [number, number]);
        continue;
      }
      const floor = lineStartDist(h.cum, h.line);
      const ceil = lineEndDist(Math.max(h.cumEnd, h.cum), h.line);

      // Contact within one line can be INTERMITTENT. The advancement loop
      // samples every EXPLORE step while a pair sits inside the margin
      // (certificates cannot stride there), so gaps wider than the stride
      // between in-contact samples are VERIFIED separations — cluster the
      // samples into candidate intervals, then refine every boundary.
      const CLUSTER_GAP = EXPLORE * 2 + MIN_ADV;
      h.samples.sort((x, y) => x - y);
      const clusters: Array<[number, number]> = [];
      for (const s of h.samples) {
        const last = clusters[clusters.length - 1];
        if (!last || s - last[1] > CLUSTER_GAP) clusters.push([s, s]);
        else last[1] = s;
      }
      if (!clusters.length) clusters.push([h.cum, Math.max(h.cum, h.cumEnd)]);
      // Pathological chatter cap — merge the tail rather than grow unbounded.
      while (clusters.length > 16) {
        const t = clusters.pop()!;
        clusters[clusters.length - 1]![1] = t[1];
      }

      const intervals: Array<[number, number]> = [];
      for (let ci = 0; ci < clusters.length; ci++) {
        const [cs, ce] = clusters[ci]!;
        // ENTRY: walk back toward the previous interval's exit / line start.
        const efloor = ci === 0 ? floor : intervals[ci - 1]![1];
        let hi = cs, lo = hi, guard = 0, bracketed = false;
        while (guard++ < 128 && lo > efloor) {
          lo = Math.max(efloor, lo - back);
          if (distAtCum(lo, h.pi) > CONTACT_EPS) { bracketed = true; break; }
          hi = lo;  // still in contact — earliest known contact moves back
        }
        const entry = bracketed ? bisectBoundary(hi, lo, h.pi) : hi;
        // EXIT: walk forward toward the next cluster / line end.
        const eceil = ci === clusters.length - 1 ? ceil : clusters[ci + 1]![0];
        let elo = Math.max(ce, entry), ehi = elo;
        guard = 0;
        let exitBracketed = false;
        while (guard++ < 128 && ehi < eceil) {
          ehi = Math.min(eceil, ehi + back);
          if (distAtCum(ehi, h.pi) > CONTACT_EPS) { exitBracketed = true; break; }
          elo = ehi;
        }
        const exit = exitBracketed ? bisectBoundary(elo, ehi, h.pi) : ehi;
        intervals.push([entry, exit]);
      }
      const merged = mergeContiguousIntervals(intervals);
      h.cum = merged[0]![0];
      h.cumEnd = merged[merged.length - 1]![1];
      h.intervals = merged;
      refined.set(key, { sig, cum: h.cum, cumEnd: h.cumEnd,
                         intervals: merged.map(iv => [iv[0], iv[1]] as [number, number]) });
    }
    // Hits leave the sweep in TRACK cum (time on a time-based track) — the
    // scrub-to-hit target must live on the slider's axis.
    for (const [, h] of selected) {
      h.cum = distToTrackCum(h.cum);
      h.cumEnd = Math.max(h.cum, distToTrackCum(h.cumEnd));
      if (h.intervals) {
        for (const iv of h.intervals) {
          iv[0] = distToTrackCum(iv[0]);
          iv[1] = Math.max(iv[0], distToTrackCum(iv[1]));
        }
      }
    }

    // Back-fill spanEndLine on every onset: the last line its contact persists
    // through (continuations point at their onset by line + pair) — over ALL
    // records: a continuation past the cap still extends its onset's span.
    for (const h of recs.values()) {
      if (h.continuation === undefined) continue;
      const onset = recs.get(keyFor(h.continuation, h.pi));
      if (onset) onset.spanEndLine = Math.max(onset.spanEndLine ?? onset.line, h.line);
    }

    // Re-sorted by cum after refinement (ScrubBar relies on cum order).
    const hits = selected.map(([, h]) => h)
      .sort((x, y) => x.cum - y.cum)
      .map(({ pi: _pi, samples: _s, ...rest }) => rest);

    // Hand the model back wearing its BASE tool body: a caller that reuses
    // the model (tests, a future cached build) must not inherit the last
    // segment's program tool. (Final result only — a snapshot leaves the
    // suspended loop's tool alone; it re-poses every sample anyway.)
    if (final) applyTool(null);
    return {
      hits,
      staticContacts,
      samples: done,
      coarsened,
      uncertified,
      pairCount: pairs.length,
      bvhMs: model.bvhMs,
      sweepMs: clock() - t0,
      truncated: trunc,
    };
    };

  if (opts.snapshot) {
    opts.snapshot.take = (reason) => {
      const copy: typeof worst = new Map();
      for (const [k, h] of worst) {
        copy.set(k, { ...h, samples: h.samples.slice(),
                      intervals: h.intervals?.map(iv => [iv[0], iv[1]] as [number, number]) });
      }
      return buildResult(copy, { covered: frac(sweptTo), reason }, false, true);
    };
  }
  // Checkpoint before the first segment: an abort here leaves the baseline
  // pose only (the "aborts early" contract).
  const abortAtStart = (yield 0) === true;
  if (abortAtStart) aborted = true;
  lastYield = clock();
  outer:
  for (let i = 1; i < n && !abortAtStart; i++) {
    // i > 1 for the time-based checkpoint: a segment-1 checkpoint has
    // swept nothing, and a budget check there would report 0 % covered for
    // a sweep that merely started late (scheduler pause between the
    // baseline yield and the first resume).
    if ((i & 15) === 0 || (i > 1 && clock() - lastYield >= yieldMs)) {
      if (overBudget()) { truncated = { covered: frac(sweptTo), reason: "time" }; break; }
      if ((yield frac(dcum[i - 1]!)) === true) { aborted = true; break; }
      lastYield = clock();
    }
    const line = track.lines[i]!;
    const isRapid = track.rapid[i] === 1;
    const c0 = dcum[i - 1]!, c1 = dcum[i]!;
    const L = c1 - c0;
    if (L <= 1e-9) continue;
    const j = i * 3, k = j - 3;
    const dA = Math.abs(track.abc[j]! - track.abc[k]!);
    const dB = Math.abs(track.abc[j + 1]! - track.abc[k + 1]!);
    const dC = Math.abs(track.abc[j + 2]! - track.abc[k + 2]!);
    // Chunk on the SUMMED rotary sweep, not the largest single one. The ×2
    // lever-drift inflation below is justified by rotRad ≤ 0.4 rad giving
    // 1/(1−rotRad) ≤ 1.65; with three rotaries turning at once, capping only
    // the largest let the per-chunk total reach 67.5° and 1−rotRad go
    // NEGATIVE — the argument stopped holding exactly on the machines that
    // sweep three rotaries. Costs nothing when one rotary moves (the common
    // case), where sum == max.
    const chunks = Math.max(1, Math.ceil((dA + dB + dC) / CHUNK_ROT_DEG));
    const segModel = vertModel?.[i] ?? identityKins;
    const segBulges = segModel.type !== "trivkins";

    for (let ch = 0; ch < chunks; ch++) {
      const s0 = c0 + (L * ch) / chunks;
      const s1 = c0 + (L * (ch + 1)) / chunks;
      const Lc = s1 - s0;

      // Chunk endpoint joint values + start-pose rotary levers.
      interpPose(i, (s0 - c0) / L);
      for (let x = 0; x < jointVals.length; x++) jv0[x] = jointVals[x]!;
      // poseAt left this endpoint's machine coords in machineVals; keep them,
      // the second interpPose is about to overwrite the buffer.
      if (segBulges) for (let x = 0; x < 6; x++) chunkM0[x] = machineVals[x]!;
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
      // How far each joint can stray from the straight line between the two
      // endpoint values just measured — the excursion jv1−jv0 cannot see.
      // Zero under identity kins, so identity segments pay nothing.
      if (segBulges) segModel.jointBulge(chunkM0, machineVals, jointBulge);
      else jointBulge.fill(0);

      for (let pi = 0; pi < pairs.length; pi++) {
        if (staticExcluded[pi]) { pairV[pi] = 0; continue; }
        const [ai, bi] = pairs[pi]!;
        const A = bodies[ai]!, B = bodies[bi]!;
        const list = pairDofs[pi]!;
        // Each linear DOF on this pair's path contributes its endpoint delta
        // PLUS its own mid-chunk bulge — per joint, so a pair riding only X
        // pays only X's. The budget then flows into the rotary lever+trans
        // recursion below, which needs it too.
        let trans = 0;
        let rotRadLever = 0;
        for (let di = 0; di < list.length; di++) {
          const pd = list[di]!;
          const dJ = Math.abs((jv1[pd.dof.joint] ?? 0) - (jv0[pd.dof.joint] ?? 0));
          if (!pd.dof.rotate) trans += dJ + (jointBulge[pd.dof.joint] ?? 0);
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
      // the carried clearance is re-expressed in THIS chunk's V here; a
      // pair inside the margin keeps its absolute re-probe cadence
      // (sSafe = s + EXPLORE), which needs no conversion.
      for (let pi = 0; pi < pairs.length; pi++) {
        if (staticExcluded[pi]) continue;
        sQ[pi] = s0;
        if (inContact[pi]) {
          // Every LINE a pair stays in contact with gets at least one sample
          // (its continuation record — the G-code panel marks it); within a
          // line the EXPLORE cadence carries across the chunks.
          if (qLine[pi] !== line) sSafe[pi] = s0;
          continue;
        }
        const c = clear[pi]!;
        sSafe[pi] = c > 0 ? s0 + c / Math.max(pairV[pi]!, 1e-9) : s0;
      }

      let s = s0;
      for (;;) {
        interpPose(i, (s - c0) / L);
        done++;
        sweptTo = s;
        if ((done & (SAMPLES_PER_CLOCK - 1)) === 0
            && ((done & (SAMPLES_PER_YIELD - 1)) === 0 || clock() - lastYield >= yieldMs)) {
          if (overBudget()) { truncated = { covered: frac(s), reason: "time" }; break outer; }
          if ((yield frac(s)) === true) { aborted = true; break outer; }
          lastYield = clock();
        }
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
            if (!inContact[pi]) {
              inContact[pi] = 1;
              onsetRapid[pi] = isRapid ? 1 : 0;
              onsetLine[pi] = line;
              // Re-entry promotion: a genuine onset on a line whose record
              // was minted as a continuation (contact carried in, separated,
              // came back on the same line) is a real clash — never hidden.
              const ex = worst.get(keyFor(line, pi));
              if (ex && ex.continuation !== undefined) delete ex.continuation;
            }
            if (pairCutting[pi]) {
              // Cutting pair (tool × workGroup body): feed contact is
              // MACHINING — never reported. A contact whose ONSET fell in a
              // rapid is the gouge class and reports for that rapid; a
              // retract leaving contact begun on a feed (or present from
              // the program start) is benign.
              if (isRapid && onsetRapid[pi]) recordHit(line, s, true, pi, d);
            } else {
              recordHit(line, s, isRapid, pi, d);
            }
            sSafe[pi] = s + EXPLORE;  // re-probe cadence inside the contact
            clear[pi] = 0;
            sQ[pi] = s;
            qLine[pi] = line;
          } else {
            if (inContact[pi] && d > opts.margin * 2) {
              inContact[pi] = 0;
              onsetRapid[pi] = 0;
              onsetLine[pi] = -1;  // verified separation: the next touch is a new onset
            }
            const bound = d === Infinity ? HORIZON : d;
            clear[pi] = bound - opts.margin;
            sQ[pi] = s;
            qLine[pi] = line;
            sSafe[pi] = s + Math.max(MIN_ADV, (bound - opts.margin) / Math.max(pairV[pi]!, 1e-9));
          }
          const remain = sSafe[pi]! - s;
          if (remain < step) step = remain;
        }
        if (budgetExceeded) step = Math.min(step, EXPLORE);
        if (s >= s1 - 1e-9) break;
        s = Math.min(s1, s + Math.max(step, MIN_ADV));
        if (done > maxSamples * 4) {   // hard runaway backstop — said, never silent
          truncated = { covered: frac(s), reason: "samples" };
          break outer;
        }
      }
      // Chunk done: what this chunk could have consumed of each carried
      // clearance since its last query (or since the chunk start).
      for (let pi = 0; pi < pairs.length; pi++) {
        if (staticExcluded[pi] || inContact[pi]) continue;
        clear[pi] = clear[pi]! - pairV[pi]! * (s1 - sQ[pi]!);
      }
    }
  }
  const finalResult = buildResult(worst, truncated, true, !aborted);
  yield truncated ? truncated.covered : 1;
  if (opts.snapshot) opts.snapshot.take = null;
  return finalResult;
}

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
// Pairs are re-queried only when their certificate expires; inside the
// margin a pair not touching is re-queried by its distance to a touch.
// Guarantee: no margin crossing — and no touch — wider than MIN_ADV (0.25
// units) of path is missed —
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
// within the margin at the program's FIRST pose AND at the model's REST pose
// (every joint at zero — the designed pose machineModel.test.ts requires to
// be self-collision-free but for the designed joints) are therefore reported
// once as `staticContacts` and excluded from the per-line sweep. A pair
// clear at rest but touching at the first pose is a CRASH the program
// starts in (operator-caught 2026-09-12: the entry rapid drove the portal
// into the X slide and the base sweep filed the pair as "in contact from
// the start (excluded)", never queried it again, and its tint and extent
// stopped at the program's first line): seeded as an onset on the first
// line, like the tool rule below, and checked throughout. NEVER the tool
// (2026-09-12, operator decision): the tool is no one's mechanical
// neighbour, so a tool pair in contact at the first pose is a contact ONSET
// on the first line — the same cut-or-crash ambiguity the sweep reports
// anywhere else — and the pair stays checked. Excluding it silenced a
// program that starts on the platter ("clear" + a tooltip) AND every later
// rapid through it: an excluded pair is never queried again.
import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import { normalizeKinematics, type KinRuntime } from "./kinematics";
import { liftToJoints, tipWcs, wcsTerms, type PartFrameWcs, type WcsTerms } from "./partFrame";
import { tloForIndex, toolForIndex, type TloEvent } from "./tloEvents";
import { EVENT_NONE } from "./eventIndex";
import { jointSpeedBound, kinsForSegment, makeKins, worldModeForSpec, type KinsModel, type KinsSpec } from "./kins";
import { installBoxDistanceFix } from "./bvhBoxDistance";
import { assignPairs } from "./pairAssign";
import { inLocalBoxes, meshClosure, pointInside, type InsideVerdict } from "./insideCheck";
import { displayLineForPoint } from "./scrubTrack";
import { probeStopTitle, type ProbeStop } from "./probeStop";

// Every bounded closest-point query prunes by the library's box-to-box
// distance, which came out too large (bvhBoxDistance.ts): corrected before
// any model is built.
installBoxDistanceFix();
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
  /** Per-segment governing TWP frame index into `frames` (EVENT_NONE = none). */
  frame?: Uint32Array;
  /** TWP frame triplets [preRot rad, primary deg, secondary deg]. */
  frames?: [number, number, number][];
  /** Kins-flip relabel flags: brk[i]=1 ⇒ segment i-1→i is a frame relabel
   *  at a stationary pose — zero machine motion, excluded from the sweep
   *  and from its distance parameterization. Absent = legacy track. */
  brk?: Uint8Array;
  /** Unknown-start flags (wire rapid_ustart): ustart[i]=1 ⇒ point i is
   *  reached by a path no parse can know (a tool change the controller moves
   *  at) — its segment is a brk too. The sweep names every one after the
   *  program's own start in `uncertified`. Absent = none. */
  ustart?: Uint8Array;
  /** Per-segment WCS epoch index (review P2) — selects the entry of
   *  CollisionOptions.epochTerms that converts this segment's program
   *  coords to machine coords. Absent = single-basis (live wcs terms). */
  wcs?: Uint32Array;
  /** Per-segment TLO/tool event index (schema 8) into
   *  CollisionOptions.tloEvents (TLO_NONE = live offset governs). The lift and
   *  the tool body's tip shift both use that segment's offset. */
  tlo?: Uint32Array;
  /** 1 = after a tool measurement the preview cannot predict (M600): an
   *  unknown start for that reason, named apart (CollisionOptions.probeStops). */
  unpredicted?: Uint8Array;
  /** The line a note names for a point (scrubTrack.displayLineForPoint):
   *  its own where trusted, else the verified call line. */
  lineOk?: Uint8Array;
  sub?: Uint8Array;
  cline?: Uint16Array;
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
  /** The TOOL body (the parametric cutter the worker attaches to the tool
   *  group). Never baseline-excluded — see the header. */
  tool?: boolean;
}

/** The mesh a machine.json part contributes to the sweep: its collision
 *  PROXY (`collision`, a coarser superset — one box per component for
 *  rails/blocks) when it declares one, else its display mesh. One rule for
 *  the viewer's body builder and the model gates (2026-09-13). */
export function partCollisionFile(p: { file: string; collision?: string | null }): string {
  return p.collision || p.file;
}

/** `collide: false` parts are decorative — never collision bodies. A crash
 *  into one is NOT reported; that is the model author's declaration. */
export function partCollides(p: { collide?: boolean | null }): boolean {
  return p.collide !== false;
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
  /** On an ONSET record whose contact persists past its own line: the track
   *  cum where it finally ends (the last continuation's exit — over ALL
   *  records, past the MAX_HITS cap too). The tint and the timeline's red
   *  extent read it for lines that have no record of their own (a contact
   *  that never separates over thousands of lines keeps only the first
   *  200 records). Absent when the contact ends on the onset line. */
  spanCumEnd?: number;
  /** This onset record's FIRST interval continues a contact that began
   *  earlier and never separated — on an earlier line of this sweep (the
   *  record was a continuation until a re-entry on its line made it an
   *  onset) or on the entry move (mergeEntryResult). That interval is the
   *  earlier finding's contact, not one of its own; the LATER intervals are
   *  re-entries, findings of their own (Codex R34 VP-I09). */
  carried?: true;
  /** Set by mergeEntryResult on the ENTRY MOVE's records: its own sweep,
   *  whose line is the program's first line (the entry move ends at the
   *  first point and carries its line) — the same line and pair as a
   *  program contact, another finding (Codex R33 VP-I07). */
  entry?: true;
  /** A record of a contact in progress at a RANGE sweep's start (plan
   *  „Prüfung im Lauf“ 3b): it began before the range, so the range cannot
   *  tell its onset or its kind — the full check does. Never a collision of
   *  its own; its records stand as provisional until the pair separates. */
  boundary?: true;
}

/** What the G-code panel marks: every line in contact, onset or not. */
export interface CollisionLineMark {
  line: number;
  continuation?: number;
  /** A provisional record of a contact in progress at a range sweep's start
   *  (CollisionHit.boundary): no onset, no kind known yet. */
  boundary?: true;
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
  /** Lines that set an offset or a stored position FROM the position after
   *  an unseen tool change (payload `stale_offset_lines`, Codex R95 VP-I53):
   *  every move from there on is unchecked to the end — the note says why. */
  staleOffsetLines?: number[];
  /** The program's offsets set from that position are not tracked (its
   *  lines do not run in text order — subroutines, loops): the note says so. */
  staleOffsetUntracked?: boolean;
  /** Tool measurements the preview cannot predict (payload
   *  `probe_unpredicted`, M600 in the preview): every move after the first is
   *  an unknown start (the track's `unpredicted`) — the note names the
   *  measurement and why, apart from those after an unseen tool change. */
  probeStops?: Pick<ProbeStop, "tool" | "reason">[];
  /** Program tools whose BODY is unknown — no length in the table, or no row
   *  (M600 plan, state table row 3): while one is in the spindle the tool's
   *  own pairs are not checked (the machine's still are) and the note says
   *  so; a contact of the tool does not carry across such a stretch. */
  unknownTools?: number[];
  /** Diagnostics (2026-09-13): when set, the sweep allocates and fills
   *  per-pair distance-query counts and milliseconds, indexed like
   *  `model.pairs` — the tool for finding which pairs a slow sweep spends its
   *  time on. Off by default; costs nothing when absent. */
  profile?: { queries?: Uint32Array; ms?: Float64Array };
  /** The pairs this sweep checks (1 = check), indexed like `model.pairs`: a
   *  SHARD of the parallel sweep (sweepShards.ts). Pairs are independent —
   *  each has its own certificates, contact state and records — so shards
   *  over disjoint masks merge by concatenation. A masked-out pair is never
   *  queried, takes no part in the baseline and is not counted as
   *  prescreened. Absent = every pair. */
  pairMask?: Uint8Array;
  /** This sweep is shard `index` of `of` (the parallel sweep): after the
   *  baseline every shard splits the remaining pairs the same way — the
   *  ones inside the margin at the first pose weigh most, by their two
   *  meshes' triangles: they are the ones queried along the program — and
   *  checks only its own. The static
   *  contacts and the prescreened count are reported by shard 0 alone, so the
   *  merge sums to the single sweep's. Absent = every pair. */
  shard?: { index: number; of: number };
  /** Sweep only from track point `from` on (plan „Prüfung im Lauf“ 3b, the
   *  provisional check during a run): the PROGRAM's baseline — its first
   *  pose and the rest pose decide the static exclusions, as in the full
   *  sweep — then every pair is queried afresh at `from`. A pair inside the
   *  margin there (cutting pairs too) is a BOUNDARY contact: begun before
   *  the range, its onset and kind are unknown (`boundaryContacts`; its
   *  records carry `boundary` until it separates). Nothing before `from` is
   *  swept, refined or reported. Absent = the whole track. */
  range?: { from: number };
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
  /** The statements `uncertified` joins ("; "), one each — what a merge of
   *  results (the shards, the entry move over the program) unites, so no
   *  result's statement is lost behind another's (`unitedNotes`). Absent on
   *  a result built elsewhere: its `uncertified` counts as one statement. */
  notes?: string[];
  pairCount: number;
  /** Pairs the whole-program reach prescreen dropped before the sweep:
   *  provably beyond the margin at every pose the sweep would evaluate
   *  (2026-09-13). Never queried, never certified. `pairCount` still counts
   *  them. */
  pairsPrescreened: number;
  bvhMs: number;
  sweepMs: number;
  /** Set when the sweep stopped before the end of the track — the wall-clock
   *  budget (`time`), the hard sample backstop (`samples`) or a driver park
   *  (`stopped`). `covered` is the swept fraction of the TRACK'S AXIS (0..1;
   *  time on a time-based track — what the scrub bar's swept band and its
   *  "N % swept" text show). Null = the whole track was swept. A truncated
   *  sweep with no hits is NOT "clear": only the covered part is. */
  truncated: { covered: number; reason: "time" | "samples" | "stopped" | "running" } | null;
  /** How many workers swept it (the parallel sweep, sweepShards.ts); absent
   *  = one. */
  shards?: number;
  /** A RANGE sweep's start (CollisionOptions.range): the track cum and line
   *  of point `from`. `empty`: nothing of positive length after it — no
   *  verdict (plan 3c: a range of length zero, or of unknown-start points
   *  only, is a state of its own). Absent on a full sweep. */
  range?: { fromCum: number; fromLine: number; empty?: true };
  /** A range sweep's BOUNDARY contacts: the pairs inside the margin at its
   *  start, in track cum — not collisions (plan 3b: "contact at the check's
   *  start — its kind is the full check's"). Absent on a full sweep. */
  boundaryContacts?: Array<{ a: string; b: string; line: number; cum: number; dist: number; cutting: boolean }>;
}

/** The statements of several results, each once, in order — and the
 *  `uncertified` they make. */
export function unitedNotes(results: readonly CollisionResult[]): { notes: string[]; uncertified: string | null } {
  const notes: string[] = [];
  for (const r of results) {
    for (const n of r.notes ?? (r.uncertified ? [r.uncertified] : [])) if (!notes.includes(n)) notes.push(n);
  }
  return { notes, uncertified: notes.length ? notes.join("; ") : null };
}

/** Driver-side stop/continue (2026-09-12). The iterator installs `take` once
 *  its initialization (the reach prescreen and the baseline) is done —
 *  initialization checkpoints exist (TWP-11) but a stop arriving during them
 *  parks at the first checkpoint after — and clears it when it returns.
 *  While the generator is
 *  SUSPENDED at a checkpoint the driver may call `take(reason)` to get the
 *  sweep-so-far as a CollisionResult — `truncated` set with that reason and
 *  the covered fraction — WITHOUT ending the generator: resuming it
 *  afterwards continues the sweep with every certificate and contact state
 *  intact. The refinement runs on COPIES of the hit records, and every
 *  checkpoint sits BEFORE the pose of the sample it precedes (TWP-07 — the
 *  in-segment checkpoint used to sit between the pose and its distance
 *  queries, so a refinement probe or a side sweep re-posed the shared model
 *  under them), so the loop re-poses after every resume and a snapshot
 *  leaves the suspended sweep exactly as it found it. */
export interface SnapshotHandle {
  take: ((reason: "time" | "stopped") => CollisionResult) | null;
  /** The sweep-so-far WITHOUT refinement (2026-09-13, live findings on the
   *  timeline): hits at their discovering samples — up to one sample step
   *  late — with `truncated.reason === "running"`. Cheap: a shallow copy of
   *  the records, no mesh probes. The refined result replaces it when the
   *  sweep ends or parks. */
  peek: (() => CollisionResult) | null;
  /** Contact records so far — the driver peeks only when this changed. */
  records: (() => number) | null;
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
/** A distance at or below this is a TOUCH: a full closest distance of ~1e-8
 *  (float) is never a clean 0. The refinement shares it. */
export const CONTACT_EPS = 1e-4;
/** A query stops at the first triangle pair nearer than this: a touch is
 *  all a touching pair's query decides (every reader compares a distance
 *  with CONTACT_EPS or more), and the exact minimum of two meshes in each
 *  other cost a walk over every overlapping leaf — ×1.3 on haus.ngc's
 *  permanent contacts, the same answers (2026-10-07). Above it the result
 *  is the exact distance, unchanged. */
const TOUCH_STOP = CONTACT_EPS / 2;

/** Records a result reports — onsets first (see buildResult); the parallel
 *  sweep's merge applies the same cap over its shards (sweepShards.ts). */
export const MAX_HITS = 200;

export interface Node {
  id: string;
  parentIdx: number;
  base: THREE.Vector3;
  dofs: KinRuntime[];
  local: THREE.Matrix4;
  world: THREE.Matrix4;
}

export interface BuiltBody {
  id: string;
  nodeIdx: number;
  side: "tool" | "work" | "other";
  bvh: MeshBVH;
  geom: THREE.BufferGeometry;
  localMat: THREE.Matrix4;       // static translate+rotate inside the group
  center: THREE.Vector3;         // local bounding-sphere
  radius: number;
  /** AABB diagonal of the local mesh. The LARGER body of a pair is the outer
   *  traversal of the closest-point query (2026-09-13): three-mesh-bvh
   *  prunes the outer tree by the INNER body's bounding box, so an inner box
   *  that spans the work volume (the side walls, a rail set) prunes nothing
   *  and the query walks every outer leaf — 12.8 ms for the spindle nose
   *  against the walls; the other way round, 0.02 ms, same answer. */
  extent: number;
  /** Connected components' local AABBs, 6 floats each (min xyz, max xyz).
   *  The tight distance LOWER BOUND for multi-component bodies (two walls,
   *  eight rails, sixteen end caps): their one bounding sphere spans the
   *  machine and the library's node boxes are pruned by the other body's
   *  WHOLE box, so a 12 mm mechanical neighbour cost a 3 ms tree walk every
   *  10 mm of path. Boxes of components contain them, so the box-to-box
   *  distance never exceeds the true one. Capped at MAX_COMPS: a soup of
   *  unshared triangles collapses to the whole-mesh box (still valid). */
  comps: Float32Array;
  /** The inside check's data (insideCheck.ts, collision-inside.plan.md):
   *  one LOCAL vertex per connected component, and whether every component
   *  is a closed surface — a body that is not has no inside to decide
   *  (VP96-03). */
  insideReps: Float32Array;
  insideClosed: boolean;
  world: THREE.Matrix4;          // scratch, updated per sample
  worldCenter: THREE.Vector3;    // scratch
}

const MAX_COMPS = 256;

/** Local AABB per connected component of a triangle soup (vertices shared to
 *  1 µm), 6 floats each — see BuiltBody.comps. Exported for tests. */
export function componentBoxes(pos: Float32Array): Float32Array {
  const nTri = Math.floor(pos.length / 9);
  const parent = new Int32Array(nTri);
  for (let i = 0; i < nTri; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; }
    return a;
  };
  const seen = new Map<string, number>();
  for (let t = 0; t < nTri; t++) {
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      const key = `${Math.round(pos[o]! * 1000)},${Math.round(pos[o + 1]! * 1000)},${Math.round(pos[o + 2]! * 1000)}`;
      const prev = seen.get(key);
      if (prev === undefined) seen.set(key, t);
      else {
        const ra = find(t), rb = find(prev);
        if (ra !== rb) parent[ra] = rb;
      }
    }
  }
  const boxOf = new Map<number, number[]>();
  for (let t = 0; t < nTri; t++) {
    const r = find(t);
    let b = boxOf.get(r);
    if (!b) { b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; boxOf.set(r, b); }
    for (let v = 0; v < 3; v++) {
      const o = t * 9 + v * 3;
      for (let k = 0; k < 3; k++) {
        const c = pos[o + k]!;
        if (c < b[k]!) b[k] = c;
        if (c > b[k + 3]!) b[k + 3] = c;
      }
    }
  }
  let boxes = [...boxOf.values()];
  if (boxes.length > MAX_COMPS || boxes.length === 0) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const bx of boxes) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k]!, bx[k]!); b[k + 3] = Math.max(b[k + 3]!, bx[k + 3]!); }
    boxes = boxes.length ? [b] : [];
  }
  return new Float32Array(boxes.flat());
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

/** A tool body's swappable geometry (schema 8): the model's BASE cylinder
 *  (the live tool) or a per-program-tool variant. The base is owned by the
 *  MODEL (TWP-07, review 2026-09-14): an iterator that captured "whatever
 *  the shared body wears right now" as its base could inherit another run's
 *  program tool and restore THAT at completion — a later fallback sweep on
 *  the resident model then reported the wrong tool's contacts. */
export interface ToolVariant {
  geom: THREE.BufferGeometry; bvh: MeshBVH; center: THREE.Vector3; radius: number; extent: number; comps: Float32Array;
  insideReps: Float32Array; insideClosed: boolean;
}

function toolVariantOf(b: BuiltBody): ToolVariant {
  return { geom: b.geom, bvh: b.bvh, center: b.center, radius: b.radius, extent: b.extent, comps: b.comps,
           insideReps: b.insideReps, insideClosed: b.insideClosed };
}

/** Install `v` on the model's tool body unless it already wears it. The
 *  test is geometry IDENTITY on the shared body, never a per-run cache
 *  (TWP-07: two iterators on one resident model kept divergent
 *  bookkeeping, so a run resumed after a side sweep believed its tool was
 *  installed while the body wore the other run's). Returns true if swapped. */
export function installToolVariant(model: CollisionModel, v: ToolVariant): boolean {
  if (model.toolBodyIdx < 0) return false;
  const tb = model.bodies[model.toolBodyIdx]!;
  if (tb.geom === v.geom) return false;
  tb.geom = v.geom; tb.bvh = v.bvh; tb.center = v.center; tb.radius = v.radius; tb.extent = v.extent; tb.comps = v.comps;
  tb.insideReps = v.insideReps; tb.insideClosed = v.insideClosed;
  return true;
}

/** Hand the model back wearing its BASE tool. A resident model outlives
 *  every sweep — completion, a dropped parked run, an error path — and each
 *  of those must leave it as built. Returns true if a swap was needed. */
export function restoreBaseTool(model: CollisionModel): boolean {
  return model.baseTool ? installToolVariant(model, model.baseTool) : false;
}

export interface CollisionModel {
  nodes: Node[];
  bodies: BuiltBody[];
  /** Index of the ONE tool body (id "tool" / `tool: true`), −1 when none. */
  toolBodyIdx: number;
  /** The tool body's geometry as BUILT (the live tool's cylinder) — what
   *  every sweep restores at completion (see restoreBaseTool). */
  baseTool: ToolVariant | null;
  pairs: Array<[number, number]>;  // indices into bodies (tool-side first when there is one)
  /** Per pair: the DOFs strictly between the two bodies (below their LCA) —
   *  exactly the motion that changes their relative pose. */
  pairDofs: PathDof[][];
  /** Per pair: tool-side body × an explicit STOCK body. FEED contact on
   *  these pairs is CUTTING — expected machining, not reported; contact
   *  whose onset falls in a RAPID is a crash and reports normally. */
  pairCutting: boolean[];
  /** Per pair: one body is the TOOL — never a static exclusion. */
  pairTool: boolean[];
  /** Per pair: node index of the bodies' lowest common ancestor — the frame
   *  the whole-program reach prescreen compares them in (2026-09-13). */
  pairLca: number[];
  machine: CollisionMachine;
  /** Bodies with no facet that has area (VP-I46): left out of the model, so
   *  never checked — every sweep's `uncertified` names them. */
  unusable: string[];
  /** Bodies that lost facets with a coordinate that is not finite (R87):
   *  their remaining surface is checked, the result says "partly checked". */
  damaged: string[];
  /** Bodies whose surface is not closed (an edge without its reverse, or one
   *  repeated in one direction — insideCheck.meshClosure): they have no
   *  inside to decide, so a part wholly inside them is not found — every
   *  sweep's `uncertified` names them (collision-inside.plan.md Fassung 3). */
  open: string[];
  bvhMs: number;
}

/** A triangle soup without its facets that have no area — three distinct
 *  collinear vertices or coincident ones (VP-I46: three-mesh-bvh read a
 *  collinear facet as touching a triangle 1.5 mm away) — and without its
 *  DAMAGED ones, a coordinate that is not finite. "No area" is relative:
 *  twice the area at most 1e-10 of the longest edge squared — a sliver
 *  1e-7 mm wide over 1 m is a line on its neighbours' edges, nothing is lost.
 *  A damaged facet is surface nobody can check (R87): counted apart. */
export function withoutArealessFacets(pos: Float32Array): { positions: Float32Array; dropped: number; damaged: number } {
  const nTri = Math.floor(pos.length / 9);
  const keep = new Uint8Array(nTri);
  let kept = 0, damaged = 0;
  for (let t = 0; t < nTri; t++) {
    const o = t * 9;
    const ax = pos[o]!, ay = pos[o + 1]!, az = pos[o + 2]!;
    const ux = pos[o + 3]! - ax, uy = pos[o + 4]! - ay, uz = pos[o + 5]! - az;
    const vx = pos[o + 6]! - ax, vy = pos[o + 7]! - ay, vz = pos[o + 8]! - az;
    const wx = vx - ux, wy = vy - uy, wz = vz - uz;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    const cross2 = cx * cx + cy * cy + cz * cz;
    const edge2 = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz);
    if (!Number.isFinite(cross2) || !Number.isFinite(edge2)) { damaged++; continue; }
    if (cross2 > 1e-20 * edge2 * edge2) { keep[t] = 1; kept++; }
  }
  if (kept === nTri) return { positions: pos, dropped: 0, damaged: 0 };
  const out = new Float32Array(kept * 9);
  for (let t = 0, k = 0; t < nTri; t++) if (keep[t]) { out.set(pos.subarray(t * 9, t * 9 + 9), k); k += 9; }
  return { positions: out, dropped: nTri - kept, damaged };
}

/** The note a sweep's `uncertified` carries for the model's geometry: the
 *  bodies left out (VP-I46) and the bodies checked without their damaged
 *  facets (R87) — never a plain "clear" over surface nobody checked. */
export function geometryNote(model: CollisionModel): string | null {
  const notes: string[] = [];
  if (model.unusable.length) notes.push(`${model.unusable.join(", ")}: no facet with area — not checked`);
  const partly = model.damaged.filter(id => !model.unusable.includes(id));
  if (partly.length) notes.push(`${partly.join(", ")}: facets with coordinates that are not numbers — partly checked`);
  if (model.open.length) notes.push(`${model.open.join(", ")}: surface not closed — a part wholly inside ${model.open.length === 1 ? "it" : "them"} is not found`);
  return notes.length ? notes.join("; ") : null;
}

export function buildCollisionModel(machine: CollisionMachine, bodyDefs: CollisionBody[]): CollisionModel {
  const { nodes, idxOf } = buildTree(machine);
  const toolSide = chainIds(machine, machine.toolGroup);
  const workSide = chainIds(machine, machine.workGroup);
  const t0 = performance.now();

  const bodies: BuiltBody[] = [];
  const unusable: string[] = [];
  const damaged: string[] = [];
  const open: string[] = [];
  const _e = new THREE.Euler();
  const _size = new THREE.Vector3();
  for (const def of bodyDefs) {
    const nodeIdx = idxOf.get(def.group);
    if (nodeIdx === undefined) continue;  // dangling group — same tolerance as the live scene
    const side = toolSide.has(def.group) ? "tool" : workSide.has(def.group) ? "work" : "other";
    // Unit-scale a copy of the triangle soup so all collision math is in
    // machine units (matches node bases and joint values).
    const raw = new Float32Array(def.positions.length);
    for (let i = 0; i < raw.length; i++) raw[i] = def.positions[i]! * machine.unitScale;
    // Facets without area (VP-I46, Codex R86): three-mesh-bvh takes three
    // DISTINCT collinear vertices for a triangle — its zero normal leaves the
    // separating axis and the plane useless, and the distance from such a
    // facet to one 1.5 mm away came out 0, a contact that is none. A facet
    // without area is a line on its neighbours' edges and carries no surface:
    // it is dropped (so is one with a coordinate that is not finite). A body
    // left with none is not checked — every sweep names it in `uncertified`.
    const { positions: scaled, dropped, damaged: bad } = withoutArealessFacets(raw);
    if (dropped) console.warn(`[collision] ${def.id}: ${dropped} of ${raw.length / 9} facets dropped (${bad} with coordinates that are not numbers)`);
    if (bad) damaged.push(def.id);
    if (scaled.length === 0) { unusable.push(def.id); continue; }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(scaled, 3));
    const bvh = new MeshBVH(geom);
    (geom as any).boundsTree = bvh;   // lets closestPointToGeometry use both trees
    geom.computeBoundingSphere();
    const sphere = geom.boundingSphere!;
    geom.computeBoundingBox();
    const extent = geom.boundingBox!.getSize(_size).length();
    const comps = componentBoxes(scaled);
    const closure = meshClosure(scaled);
    if (!closure.closed) open.push(def.id);
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
      center: sphere.center.clone(), radius: sphere.radius, extent, comps,
      insideReps: closure.repVerts, insideClosed: closure.closed,
      world: new THREE.Matrix4(), worldCenter: new THREE.Vector3(),
    });
  }

  // A pair is worth sweeping iff the two bodies MOVE relative to each other:
  // a DOF must sit strictly between them (below their lowest common
  // ancestor). DOFs on the LCA or above move both bodies rigidly together.
  // Returns exactly those DOFs — they drive the pair's velocity bound.
  const pathDofsBetween = (ia: number, ib: number): { dofs: PathDof[]; lca: number } => {
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
    return { dofs: out, lca };
  };

  // Cutting pairs: the CUTTER (the tool body) × an EXPLICIT stock body. No
  // machine part is ever implicitly cuttable — the platter is workholding,
  // not stock — and nothing but the cutter cuts: the spindle nose, the ram or
  // the head feeding into the stock is a crash. Every tool-SIDE body used to
  // count, and a ram driven into the work piece on a feed (or resting in it
  // at the program's start) was never reported (2026-10-07, the oracle hunt
  // on the TWP gantry).
  const stockIds = new Set(bodyDefs.filter(d => d.stock).map(d => d.id));
  const toolIds = new Set(bodyDefs.filter(b => b.tool).map(b => b.id));
  const isCuttingBody = (b: BuiltBody) => stockIds.has(b.id);
  const isToolBody = (b: BuiltBody) => toolIds.has(b.id);

  const pairs: Array<[number, number]> = [];
  const pairDofs: PathDof[][] = [];
  const pairLca: number[] = [];
  const pairCutting: boolean[] = [];
  const pairTool: boolean[] = [];
  for (let a = 0; a < bodies.length; a++) {
    for (let b = a + 1; b < bodies.length; b++) {
      const A = bodies[a]!, B = bodies[b]!;
      if (A.nodeIdx === B.nodeIdx) continue;  // same group — rigid
      const { dofs, lca } = pathDofsBetween(A.nodeIdx, B.nodeIdx);
      if (!dofs.length) continue;
      // Tool-side body first when there is one — hit messages read better.
      if (B.side === "tool" && A.side !== "tool") pairs.push([b, a]);
      else pairs.push([a, b]);
      pairDofs.push(dofs);
      pairLca.push(lca);
      pairCutting.push((isToolBody(A) && isCuttingBody(B)) || (isToolBody(B) && isCuttingBody(A)));
      pairTool.push(isToolBody(A) || isToolBody(B));
    }
  }
  const toolBodyIdx = bodies.findIndex(b => isToolBody(b) || b.id === "tool");
  const baseTool = toolBodyIdx >= 0 ? toolVariantOf(bodies[toolBodyIdx]!) : null;
  return { nodes, bodies, toolBodyIdx, baseTool, pairs, pairDofs, pairCutting, pairTool, pairLca, machine, unusable, damaged, open, bvhMs: performance.now() - t0 };
}

// Distance lower bound from the two bodies' component boxes, `rel` mapping
// B's frame into A's (see BuiltBody.comps): each B box's eight corners →
// an AABB in A's frame, min box-to-box gap over all component pairs.
// Exported for the estimator test (collisionBounds.test.ts).
export function boxLowerBound(A: BuiltBody, B: BuiltBody, rel: THREE.Matrix4): number {
  const ca = A.comps, cb = B.comps;
  if (!ca.length || !cb.length) return 0;
  const e = rel.elements;
  let best = Infinity;
  for (let j = 0; j < cb.length; j += 6) {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let k = 0; k < 8; k++) {
      const bx = (k & 1) ? cb[j + 3]! : cb[j]!, by = (k & 2) ? cb[j + 4]! : cb[j + 1]!, bz = (k & 4) ? cb[j + 5]! : cb[j + 2]!;
      const x = e[0]! * bx + e[4]! * by + e[8]! * bz + e[12]!;
      const y = e[1]! * bx + e[5]! * by + e[9]! * bz + e[13]!;
      const z = e[2]! * bx + e[6]! * by + e[10]! * bz + e[14]!;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    for (let i = 0; i < ca.length; i += 6) {
      const gx = Math.max(0, ca[i]! - x1, x0 - ca[i + 3]!);
      const gy = Math.max(0, ca[i + 1]! - y1, y0 - ca[i + 4]!);
      const gz = Math.max(0, ca[i + 2]! - z1, z0 - ca[i + 5]!);
      const d = Math.sqrt(gx * gx + gy * gy + gz * gz);
      if (d < best) { best = d; if (best === 0) return 0; }
    }
  }
  return best;
}

const _pdInv = new THREE.Matrix4();
const _pdRel = new THREE.Matrix4();
const _pdT1 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };
const _pdT2 = { point: new THREE.Vector3(), distance: 0, faceIndex: -1 };

/**
 * Closest distance between two POSED bodies, or a valid LOWER bound when
 * that is already above `maxT` (sphere gap), above `margin` (component
 * boxes — exact contact is then impossible and the certificate needs only a
 * bound), or Infinity when provably beyond `maxT` (BVH). The larger body is
 * the outer traversal (BuiltBody.extent). Every finite answer is ≤ the true
 * distance — the sweep's certificates rest on it; collisionBounds.test.ts
 * holds every estimator to it on the shipped models.
 */
export function pairDistance(A: BuiltBody, B: BuiltBody, maxT: number, margin: number): number {
  const centerDist = A.worldCenter.distanceTo(B.worldCenter);
  const sphereGap = centerDist - A.radius - B.radius;
  if (sphereGap > maxT) return sphereGap;  // valid LOWER bound on true distance
  const O = A.extent >= B.extent ? A : B;
  const I = O === A ? B : A;
  _pdInv.copy(O.world).invert();
  _pdRel.multiplyMatrices(_pdInv, I.world);
  const lb = boxLowerBound(O, I, _pdRel);
  if (lb > margin) return lb;               // no contact possible; bound for the certificate
  const res = O.bvh.closestPointToGeometry(I.geom, _pdRel, _pdT1, _pdT2, TOUCH_STOP, maxT);
  // null: provably beyond maxT. So is a distance ABOVE maxT: the library
  // visits only the bounds nearer than maxT, and what it returns past it is
  // the closest of the triangles it happened to visit — not the minimum
  // (three-mesh-bvh 0.9.14; live haus.ngc 2026-10-06: 291 returned at a
  // true 82, the certificate jumped 230 mm past the yoke's onset).
  return res && _pdT1.distance <= maxT ? _pdT1.distance : Infinity;
}

const _ipP = new THREE.Vector3();
const _ipInv = new THREE.Matrix4();
const _ipRel = new THREE.Matrix4();

/**
 * Does a component of one POSED body lie inside the other (insideCheck.ts,
 * collision-inside.plan.md)? Valid only when their surfaces do not touch
 * (the caller's d > CONTACT_EPS): then every component is wholly inside or
 * wholly outside, and one local vertex each decides. A vertex outside every
 * local component box of the other body is outside (the exact exclusion,
 * VP96-01). "undecidable" = every ray degenerate (VP96-02/03) — a property
 * of the pose, which a later pose may decide. A container whose surface is
 * not closed is NOT asked (Fassung 3): it has no inside at any pose, asking
 * again never decides it, so it is named once for the model
 * (`CollisionModel.open`, geometryNote) and its pairs keep the surface's
 * guarantee alone.
 */
export function pairInside(A: BuiltBody, B: BuiltBody): InsideVerdict {
  let undecided = false;
  for (let k = 0; k < 2; k++) {
    const P = k === 0 ? A : B, Q = k === 0 ? B : A;
    if (!Q.insideClosed) continue;
    _ipInv.copy(Q.world).invert();
    _ipRel.multiplyMatrices(_ipInv, P.world);
    const r = P.insideReps;
    const qb = Q.geom.boundingBox!;
    for (let i = 0; i + 2 < r.length; i += 3) {
      _ipP.set(r[i]!, r[i + 1]!, r[i + 2]!).applyMatrix4(_ipRel);
      if (!qb.containsPoint(_ipP) || !inLocalBoxes(_ipP, Q.comps)) continue;
      const v = pointInside(Q.bvh, Q.geom, _ipP, Q.extent);
      if (v === "inside") return "inside";
      if (v === "undecidable") undecided = true;
    }
  }
  return undecided ? "undecidable" : "outside";
}

/** Pose every node and body at `jointVals` (joint order; no tool offset) —
 *  the sweep's own compose. Exported for the estimator and oracle tests. */
export function poseModel(model: CollisionModel, jointVals: number[]): void {
  poseTree(model.nodes, jointVals, _poseScratch);
  for (const body of model.bodies) {
    body.world.multiplyMatrices(model.nodes[body.nodeIdx]!.world, body.localMat);
    body.worldCenter.copy(body.center).applyMatrix4(body.world);
  }
}
const _poseScratch = {
  pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
  step: new THREE.Quaternion(), one: new THREE.Vector3(1, 1, 1),
};

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

/** The sweep as a resumable iterator: yields its progress (0..1 of the
 *  track's axis — see `truncated.covered`) at
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
  const { nodes, bodies, pairs, pairDofs, pairCutting, pairTool, pairLca, machine } = model;
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
  // Aborted during INITIALIZATION — before any pose or query (R-04,
  // implementation review 2026-09-15). The per-vertex passes below are the
  // first substantial work the sweep does, and they used to run to
  // completion before the first checkpoint: a cancel or pause could not be
  // acknowledged for ~400 ms on a million-point TWP track. Every one of them
  // now yields, and an abort there returns the same empty stopped result the
  // prescreen's does.
  let abortedInit = false;
  const dcum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    if ((i & 65535) === 0 && (yield 0) === true) { abortedInit = true; break; }
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
  const toolBodyIdx = model.toolBodyIdx;
  const _tloMat = new THREE.Matrix4();
  // Per-program-tool body VARIANTS (schema 8): the segment's tool number
  // (toolForIndex) selects the cylinder the tool body wears. Only the ONE
  // tool BuiltBody's geometry/BVH/sphere swap — pairs, pair DOFs and the
  // cutting flags are properties of the body's identity and stay invariant
  // (pushing K tool bodies would mint K× pairs and misattribute hits).
  // The BASE is the model's own (TWP-07), never "what the body wears now".
  const toolVariants = new Map<number, ToolVariant>();
  const baseVariant: ToolVariant | null = model.baseTool;
  if (toolBodyIdx >= 0 && baseVariant && opts.toolDims && opts.tloEvents?.length) {
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
      geom.computeBoundingBox();
      const vpos = geom.getAttribute("position").array as Float32Array;
      const vclo = meshClosure(vpos);
      toolVariants.set(tn, { geom, bvh, center: geom.boundingSphere!.center.clone(), radius: geom.boundingSphere!.radius,
                             extent: geom.boundingBox!.getSize(new THREE.Vector3()).length(),
                             comps: componentBoxes(vpos), insideReps: vclo.repVerts, insideClosed: vclo.closed });
    }
  }
  const applyTool = (tn: number | null) => {
    if (!baseVariant) return;
    const v = (tn != null ? toolVariants.get(tn) : undefined) ?? baseVariant;
    installToolVariant(model, v);   // geometry identity on the SHARED body, no private cache
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
  // curvature from its own geometry (the bulge is M/8 of a bound M on j''),
  // and the speed budget is `jointSpeedBound(|Δj|, bulge)` = |Δj| + M/2 —
  // the bulge itself is a chord deviation, no speed: |Δj| + bulge let a
  // C sweep about an extremum cross a part unseen (Codex R101 VP-I57). This
  // file knows no family's parameter names. It used to read the trt-only KinsParams, which
  // a trsrn spec does not carry at all — so that machine's ~2 m rotary lever
  // came out as the distance from the machine origin. Certified per family by
  // kinsBulge.test.ts.
  const identityKins = makeKins(machine.axes);
  const jointBulge = new Float64Array(jointVals.length);
  // Per-vertex kins models for THIS machine's family, and the certification
  // check that needs each vertex's world flag, in ONE checkpointed pass.
  //
  // A vertex's model is fully determined by (raw type, TWP frame index, TLO
  // event index), and those change a handful of times in a program while the
  // vertices number millions — so resolve on CHANGE and reuse the model for
  // the run (R-04: this pass used to call kinsForSegment per vertex, and its
  // trsrn branch builds a memo key by joining seven pivot floats, so the
  // memoized construction was paid for with an unmemoized lookup). Repeats
  // of a context seen earlier hit the small per-sweep map.
  //
  // The guarantee is certified per FAMILY, so it can only be claimed for a
  // segment whose model is the one the machine declared. kinsForSegment falls
  // back to trivkins — loudly, but still — for a kins type this client cannot
  // evaluate or a plane segment with no frame; that model's bulge is
  // legitimately 0, which would then be silently wrong for the real machine.
  // Report it instead of assuming it: unchecked is not clear.
  const tFrames = track.frames;
  let vertModel: KinsModel[] | null = null;
  // What this sweep cannot promise, one statement each (CollisionResult.notes).
  const noteParts: string[] = [];
  const geoNote = geometryNote(model);
  if (geoNote) noteParts.push(geoNote);
  const notesOf = (parts: string[]) => ({ uncertified: parts.length ? parts.join("; ") : null, notes: parts.slice() });
  // A move whose START no parse can know (an unknown-start point after the
  // first — the program's own start is the entry move's): the controller
  // moved the machine at a tool change ([EMCIO] TOOL_CHANGE_POSITION) where
  // the preview does not see it, and until every axis it moved is commanded
  // again the preview's positions are its own guess (gcode_canon `stale`).
  // Such a move is not checked — said, never assumed (2026-10-07/08, Codex
  // R92 VP-I51; a G43 is no such move, gcode_canon.tool_offset).
  const unknownStarts: number[] = [];
  // ...and those after a tool measurement the preview cannot predict (M600):
  // their position is unknown for the measurement's sake (probeStops).
  const afterProbe: number[] = [];
  // The line a note names for a point is the one the operator sees: inside
  // a called file (an M600's routine) the call line — the raw number is the
  // called file's own ("from L339" in a 60-line program, live 2026-10-09).
  const shownLine = (i: number) => displayLineForPoint(track, i, true).line ?? 0;
  if (track.ustart) for (let i = 1; i < n; i++) if (track.ustart[i]) {
    if (track.unpredicted?.[i]) afterProbe.push(shownLine(i));
    else unknownStarts.push(shownLine(i));
  }
  const list = (ls: number[]) => `${ls.slice(0, 3).map(l => "L" + l).join(", ")}${ls.length > 3 ? " …" : ""}`;
  // An offset or a stored position set FROM that position is the preview's
  // guess for good — an absolute move does not repair it, a later fixture
  // may carry it — so from its line on nothing is checked to the end, and
  // the note says so instead of promising a recovery (Codex R95 VP-I53).
  if (unknownStarts.length) {
    const k = unknownStarts.length;
    const at = [...new Set(unknownStarts)];   // a cycle is several moves on one line
    // 0 = a write the parse caught without a main-file line to name
    const off = opts.staleOffsetLines ?? [], named = off.filter(l => l > 0);
    noteParts.push(`${k} move${k === 1 ? "" : "s"} after a tool change run${k === 1 ? "s" : ""} from a position the preview cannot know — `
      + (!off.length ? `not checked until the position is known again (${list(at)})`
        : named.length ? `not checked to the program's end: the offset${named.length === 1 ? "" : "s"} set from that position at ${list(named)} `
            + `stay${named.length === 1 ? "s" : ""} unknown whatever is positioned after (${list(at)})`
        : `not checked to the program's end: an offset set from that position stays unknown whatever is positioned after (${list(at)})`)
      + (opts.staleOffsetUntracked ? "; in subroutines and loops, stored positions (G28.1 / G30.1) and fixture writes in called files are not tracked" : ""));
  }
  if (opts.probeStops?.length || afterProbe.length) {
    const stop = opts.probeStops?.[0];
    const k = afterProbe.length, at = [...new Set(afterProbe.filter(l => l > 0))];
    noteParts.push(`${stop ? probeStopTitle(stop) : "Tool measurement not predicted"} — `
      + (k ? `${k} move${k === 1 ? "" : "s"} after it not checked to the program's end${at.length ? ` (${list(at)})` : ""}`
           : "nothing after it is checked"));
  }
  // A program tool whose body is unknown (no table length): per real segment
  // it is in the spindle for, the tool's own pairs are skipped.
  const unknownTool = new Set((opts.unknownTools ?? []).filter(t => t > 0));
  let segUnk: Uint8Array | undefined;
  if (unknownTool.size && model.toolBodyIdx >= 0) {
    const byTool = new Map<number, number[]>();
    for (let i = 1; i < n; i++) {
      const tn = toolFor(i);
      if (tn == null || !unknownTool.has(tn) || track.brk?.[i]) continue;
      (segUnk ??= new Uint8Array(n))[i] = 1;
      let ls = byTool.get(tn);
      if (!ls) byTool.set(tn, ls = []);
      const l = shownLine(i);
      if (l > 0 && !ls.includes(l)) ls.push(l);
    }
    for (const [tn, ls] of byTool) {
      noteParts.push(`T${tn} has no length in the table: its own contacts are not checked${ls.length ? ` (${list(ls)})` : ""}`);
    }
  }
  let fellBack = false;
  if (track.mode && !abortedInit) {
    const vm = new Array<KinsModel>(n);
    const worldLut: (boolean | undefined)[] = [];
    const modelByCtx = new Map<string, KinsModel>();
    let pType = -1, pFrame = -1, pTlo = -1;
    let cur: KinsModel | null = null;
    for (let i = 0; i < n; i++) {
      if ((i & 65535) === 0 && i > 0 && (yield 0) === true) { abortedInit = true; break; }
      const ty = track.mode[i]!;
      const world = worldLut[ty] ?? (worldLut[ty] = worldModeForSpec(ty, machine.kins));
      const fi = track.frame?.[i] ?? EVENT_NONE;
      const li = track.tlo?.[i] ?? EVENT_NONE;
      if (cur === null || ty !== pType || fi !== pFrame || li !== pTlo) {
        const key = ty + "|" + fi + "|" + li;
        let m = modelByCtx.get(key);
        if (!m) {
          const fr = (fi !== EVENT_NONE && tFrames) ? tFrames[fi] ?? null : null;
          m = kinsForSegment(machine.axes, machine.kins, ty, fr,
                             tloFor(i)[2] || undefined, "collision sweep");
          modelByCtx.set(key, m);
        }
        cur = m; pType = ty; pFrame = fi; pTlo = li;
      }
      vm[i] = cur;
      if (world && !fellBack && cur.type === "trivkins") {
        fellBack = true;
        noteParts.push(`non-identity segments fell back to trivkins (declared `
          + `${machine.kins?.type ?? "unknown"}) — poses and clearance bounds `
          + `are identity approximations`);
      }
    }
    if (!abortedInit) vertModel = vm;
  }
  if (abortedInit) {
    // Nothing posed, nothing queried (same contract as the prescreen abort).
    restoreBaseTool(model);
    return { hits: [], staticContacts: [], samples: 0, coarsened: false, ...notesOf(noteParts),
             pairCount: model.pairs.length, pairsPrescreened: 0, bvhMs: model.bvhMs,
             sweepMs: clock() - t0, truncated: { covered: 0, reason: "stopped" } };
  }
  const kinsOut: (number | null)[] = [];
  const scratch = {
    pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
    step: new THREE.Quaternion(), one: new THREE.Vector3(1, 1, 1),
  };

  // Worst hit per (line, pair) — same attribution shape as stage 1. `pi`
  // (pair index), `samples` (in-contact sample cums, the interval
  // clustering input) and `carriedFrom` (the onset line of the contact a
  // record carried in before a re-entry made it an onset) are internal to
  // the refinement pass.
  const worst = new Map<string, CollisionHit & { pi: number; samples: number[]; carriedFrom?: number }>();
  let done = 0;

  // Per-segment epoch terms (review P2): a segment's program coords convert
  // through ITS epoch's basis; single-basis tracks fall through to `o`.
  const termFor = (i: number): WcsTerms =>
    (track.wcs && opts.epochTerms?.[track.wcs[i] ?? 0]) ? opts.epochTerms[track.wcs[i] ?? 0]! : o;

  /** Joints for one program-space point under a segment's labeling — the
   *  first half of poseAt, shared with the reach prescreen so both derive
   *  joints through exactly one path. Leaves the machine coords in
   *  machineVals (jointBulge's input) and the joints in jointVals. */
  const liftJoints = (px: number, py: number, pz: number, pa: number, pb: number, pc: number, model: KinsModel, oSeg: WcsTerms, tloSeg: readonly number[]) => {
    liftToJoints(px, py, pz, pa, pb, pc, oSeg, tloSeg, machineVals);
    model.inverse(machineVals, kinsOut);
    for (let ji = 0; ji < kinsOut.length; ji++) {
      jointVals[ji] = kinsOut[ji] ?? 0;  // UVW: 0, as the preview transform
    }
    // Models write only the joints they drive (trsrn hardcodes six), so on a
    // machine with more joints than that the tail would keep whatever a
    // PRECEDING segment's model left there — a stale pose, not a fresh one.
    for (let ji = kinsOut.length; ji < jointVals.length; ji++) jointVals[ji] = 0;
  };
  const poseAt = (px: number, py: number, pz: number, pa: number, pb: number, pc: number, model: KinsModel = identityKins, oSeg: WcsTerms = o, tloSeg: readonly number[] = liveTlo, toolSeg: number | null = null) => {
    applyTool(toolSeg);
    liftJoints(px, py, pz, pa, pb, pc, model, oSeg, tloSeg);
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

  // ── Whole-program reach prescreen (2026-09-13) ────────────────────────
  // A pair whose two bodies can PROVABLY never come within the margin at any
  // pose this sweep will evaluate is dropped before it starts: no baseline
  // probe, no certificates, no queries. Why: the wall gantry has ~450 pairs
  // over 236k triangles, and a 130 mm program reaches a tenth of them, yet
  // every pair used to cost a first query and periodic re-certification —
  // hours for a 1.2 M-point sweep. Sound by construction:
  //  1. every joint's RANGE over the program: both endpoints of every
  //     segment under that segment's own kins labeling (exactly what
  //     interpPose lerps between; vertex 0 under its own labeling is the
  //     baseline pose), widened by the family's jointBulge on non-identity
  //     segments — the mid-segment excursion a chord cannot see, the same
  //     bound the advancement uses, taken over the whole segment (≥ any
  //     chunk's). Zero-length and relabel segments cost nothing but are
  //     included, which is merely conservative.
  //  2. each body's REACH SPHERE in the pair's LCA frame: its bounding
  //     sphere pushed up the group tree through only the DOFs below the LCA
  //     (the ones that move the pair relatively — pathDofsBetween's set),
  //     composed as poseTree composes a node (rotations about the node
  //     origin, last-listed applied first, then base + translations): a
  //     translation DOF widens it by half its range, a rotation DOF by the
  //     chord its centre can swing over the range — 2ρ·sin(min(Δ/4, π/2)),
  //     ρ the centre's distance from the axis. Joint ranges are treated as
  //     independent, which over-approximates the reachable set, never under.
  //  3. the tool body's sphere covers EVERY program-tool variant (max
  //     tip-relative extent over the cylinders) plus the largest TLO shift
  //     applied in the tool node's frame.
  const nJ = jointVals.length;
  const jLo = new Float64Array(nJ).fill(Infinity);
  const jHi = new Float64Array(nJ).fill(-Infinity);
  const jPad = new Float64Array(nJ);
  const bulgeTmp = new Float64Array(nJ);
  const rsM0: number[] = [0, 0, 0, 0, 0, 0], rsM1: number[] = [0, 0, 0, 0, 0, 0];
  let tloMax = 0;
  const noteJoints = () => {
    for (let ji = 0; ji < nJ; ji++) {
      const v = jointVals[ji]!;
      if (v < jLo[ji]!) jLo[ji] = v;
      if (v > jHi[ji]!) jHi[ji] = v;
    }
  };
  const noteTlo = (t: readonly number[]) => {
    const mag = Math.hypot(t[0] ?? 0, t[1] ?? 0, t[2] ?? 0);
    if (mag > tloMax) tloMax = mag;
  };
  const liftJointsAt = (i: number, t: number) => {
    const j = i * 3, k = j - 3;
    liftJoints(
      track.pos[k]! + (track.pos[j]! - track.pos[k]!) * t,
      track.pos[k + 1]! + (track.pos[j + 1]! - track.pos[k + 1]!) * t,
      track.pos[k + 2]! + (track.pos[j + 2]! - track.pos[k + 2]!) * t,
      track.abc[k]! + (track.abc[j]! - track.abc[k]!) * t,
      track.abc[k + 1]! + (track.abc[j + 1]! - track.abc[k + 1]!) * t,
      track.abc[k + 2]! + (track.abc[j + 2]! - track.abc[k + 2]!) * t,
      vertModel?.[i] ?? identityKins, termFor(i), tloFor(i));
  };
  // Initialization checkpoints (TWP-11, review 2026-09-14): the joint-range
  // scan is 2n inverse-kinematics evaluations and ran to completion before
  // the first yield — 50–100 ms per 100 k points, more under a world kins
  // — so a cancel or pause could not land until it was done. A checkpoint
  // every 4096 vertices (and every 256 pairs below) keeps the ack latency
  // in the same class as the sweep's own. An abort here returns the empty
  // stopped result: nothing was posed or queried yet.
  let abortedEarly = false;
  if (n > 0) {
    liftJoints(track.pos[0]!, track.pos[1]!, track.pos[2]!, track.abc[0]!, track.abc[1]!, track.abc[2]!,
               vertModel?.[0] ?? identityKins, termFor(0), tloFor(0));
    noteJoints();
    noteTlo(tloFor(0));
    for (let i = 1; i < n; i++) {
      if ((i & 4095) === 0 && (yield 0) === true) { abortedEarly = true; break; }
      noteTlo(tloFor(i));
      const segModel = vertModel?.[i] ?? identityKins;
      const bulges = segModel.type !== "trivkins";
      liftJointsAt(i, 0);
      noteJoints();
      if (bulges) for (let x = 0; x < 6; x++) rsM0[x] = machineVals[x]!;
      liftJointsAt(i, 1);
      noteJoints();
      if (bulges) {
        for (let x = 0; x < 6; x++) rsM1[x] = machineVals[x]!;
        segModel.jointBulge(rsM0, rsM1, bulgeTmp);
        for (let ji = 0; ji < nJ; ji++) if (bulgeTmp[ji]! > jPad[ji]!) jPad[ji] = bulgeTmp[ji]!;
      }
    }
  }
  for (let ji = 0; ji < nJ; ji++) {
    if (jLo[ji] === Infinity) { jLo[ji] = 0; jHi[ji] = 0; }
    jLo[ji] = jLo[ji]! - jPad[ji]!;
    jHi[ji] = jHi[ji]! + jPad[ji]!;
  }
  const _rsAxis = new THREE.Vector3(), _rsProj = new THREE.Vector3(), _rsRad = new THREE.Vector3();
  const reachSphere = (bi: number, lca: number, out: { c: THREE.Vector3; r: number }) => {
    const body = bodies[bi]!;
    const c = out.c;
    let r: number;
    if (bi === toolBodyIdx) {
      let ext = body.center.length() + body.radius;
      if (baseVariant) ext = Math.max(ext, baseVariant.center.length() + baseVariant.radius);
      for (const v of toolVariants.values()) ext = Math.max(ext, v.center.length() + v.radius);
      c.set(0, 0, 0).applyMatrix4(body.localMat);
      r = ext + tloMax;
    } else {
      c.copy(body.center).applyMatrix4(body.localMat);
      r = body.radius;
    }
    let ni = body.nodeIdx;
    let guard = 0;
    while (ni !== lca && ni >= 0 && guard++ < 64) {
      const node = nodes[ni]!;
      for (let di = node.dofs.length - 1; di >= 0; di--) {
        const d = node.dofs[di]!;
        if (!d.rotate) continue;
        const a0 = (jLo[d.joint] ?? 0) * d.sign, a1 = (jHi[d.joint] ?? 0) * d.sign;
        const lo = Math.min(a0, a1), hi = Math.max(a0, a1);
        const mid = THREE.MathUtils.degToRad((lo + hi) / 2);
        const half = THREE.MathUtils.degToRad((hi - lo) / 2);
        _rsAxis.copy(d.axisVec).normalize();
        _rsProj.copy(_rsAxis).multiplyScalar(c.dot(_rsAxis));
        const rho = _rsRad.copy(c).sub(_rsProj).length();
        c.applyAxisAngle(_rsAxis, mid);
        r += 2 * rho * Math.sin(Math.min(half / 2, Math.PI / 2));
      }
      for (const d of node.dofs) {
        if (d.rotate) continue;
        const v0 = (jLo[d.joint] ?? 0) * d.sign, v1 = (jHi[d.joint] ?? 0) * d.sign;
        const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
        c.addScaledVector(d.axisVec, (lo + hi) / 2);
        r += (hi - lo) / 2;
      }
      c.add(node.base);
      ni = node.parentIdx;
    }
    out.r = r;
  };
  const unreachable = new Uint8Array(pairs.length);
  let pairsPrescreened = 0;
  const rsA = { c: new THREE.Vector3(), r: 0 }, rsB = { c: new THREE.Vector3(), r: 0 };
  for (let pi = 0; pi < pairs.length && !abortedEarly; pi++) {
    if ((pi & 255) === 255 && (yield 0) === true) { abortedEarly = true; break; }
    if (opts.pairMask && !opts.pairMask[pi]) { unreachable[pi] = 1; continue; }   // another shard's
    const [ai, bi] = pairs[pi]!;
    reachSphere(ai, pairLca[pi]!, rsA);
    reachSphere(bi, pairLca[pi]!, rsB);
    if (rsA.c.distanceTo(rsB.c) - rsA.r - rsB.r > opts.margin) {
      unreachable[pi] = 1;
      pairsPrescreened++;
    }
  }
  if (abortedEarly) {
    // Nothing posed, nothing queried, no certificate or contact state to
    // report; the driver discards a cancelled sweep's value anyway.
    restoreBaseTool(model);
    return { hits: [], staticContacts: [], samples: 0, coarsened: false, ...notesOf(noteParts),
             pairCount: pairs.length, pairsPrescreened, bvhMs: model.bvhMs,
             sweepMs: clock() - t0, truncated: { covered: 0, reason: "stopped" } };
  }
  // Pairs the sweep never touches: prescreened here, static after the baseline.
  const skipPair = new Uint8Array(unreachable);
  const prof = opts.profile;
  if (prof) {
    prof.queries = new Uint32Array(pairs.length);
    prof.ms = new Float64Array(pairs.length);
  }

  // Baseline pass (first pose): pairs already inside the margin here are
  // mechanical-joint proximity (slides, bearings, trunnion mounts). Reported
  // once, excluded from the sweep. CUTTING pairs are never baseline-excluded
  // (a tool parked on the work is normal) — they instead seed the in-contact
  // state for onset tracking. TOOL pairs are never excluded either: contact
  // here is an ONSET on the first line (see the header) — the seeded latch
  // makes the sweep's first sample record it and the following lines'
  // records continuations of it.
  // The onset belongs to the first segment WITH length: a zero-length
  // unknown-start rapid (schema 6) carries no sample.
  let firstSeg = 1;
  while (firstSeg < n - 1 && dcum[firstSeg]! - dcum[firstSeg - 1]! <= 1e-9) firstSeg++;
  const staticExcluded = new Uint8Array(pairs.length);
  const inContact = new Uint8Array(pairs.length);
  const onsetRapid = new Uint8Array(pairs.length);
  // The line a pair's CURRENT contact began on (-1 = not in contact) — the
  // same latch the cutting semantics use for onsetRapid, now read by the
  // non-cutting branch too: a record minted on a later line while the pair
  // never separated is a CONTINUATION, not a new clash.
  const onsetLine = new Int32Array(pairs.length).fill(-1);
  // A pair in contact (inContact) whose LAST query found it touching
  // (d ≤ CONTACT_EPS): it keeps the EXPLORE cadence. One that was not
  // touching carries a clearance certificate like a clear pair — see the
  // advancement loop.
  const touching = new Uint8Array(pairs.length).fill(1);
  // Where a pair's last TOUCHING query was (NaN: none yet) — the start of the
  // stretch re-sampled when it is next found not touching (VP-I45).
  const lastTouch = new Float64Array(pairs.length).fill(NaN);
  // The inside check (collision-inside.plan.md, pairInside): a query that
  // finds the surfaces apart proves the pair apart only where it is known not
  // to lie wholly inside the other. Between two surface contacts the answer
  // cannot change (in and out only through a touch, which the sweep finds),
  // so it is ASKED only where it is not known: the baseline, the first query
  // after a jump (`needInside`: a break, a tool or offset change), a pair
  // whose last query touched (a separation decision — `inContact &&
  // touching`, the beyond-horizon Infinity included) and a pair whose last
  // answer was undecidable. "inside" counts as a touch (distance 0);
  // "undecidable" gives no record, no separation and no clearance
  // certificate, and its stretch is named for good (`undecSpans`, VP96-03).
  const undecided = new Uint8Array(pairs.length);
  const needInside = new Uint8Array(pairs.length);
  const undecSpans = new Map<number, Array<[number, number]>>();   // per pair: [first, last] line of each undecidable stretch
  const askInside = (pi: number): boolean =>
    (inContact[pi] === 1 && touching[pi] === 1) || undecided[pi] === 1 || needInside[pi] === 1;
  const insideOf = (pi: number): InsideVerdict => {
    const [ai, bi] = pairs[pi]!;
    return pairInside(bodies[ai]!, bodies[bi]!);
  };
  // The state after a query in TIME order: an undecidable answer opens or
  // extends its pair's stretch, anything else (a decided answer, a touch, a
  // pair not asked — known outside) ends it.
  const markInside = (pi: number, v: InsideVerdict | null, line: number) => {
    if (v !== "undecidable") { undecided[pi] = 0; return; }
    let spans = undecSpans.get(pi);
    if (!spans) undecSpans.set(pi, spans = []);
    if (undecided[pi] && spans.length) spans[spans.length - 1]![1] = line;
    else spans.push([line, line]);
    undecided[pi] = 1;
  };
  const staticContacts: CollisionResult["staticContacts"] = [];
  // Contact from the program's first point: an ONSET on the first line the
  // sweep's first sample records; later lines' records are continuations.
  const seedOnset = (pi: number) => {
    inContact[pi] = 1;
    onsetLine[pi] = track.lines[firstSeg] ?? 0;
    onsetRapid[pi] = track.rapid[firstSeg] === 1 ? 1 : 0;
  };
  const poseFirst = () => poseAt(track.pos[0]!, track.pos[1]!, track.pos[2]!,
                                 track.abc[0]!, track.abc[1]!, track.abc[2]!, vertModel?.[0] ?? identityKins,
                                 termFor(0), tloFor(0), toolFor(0));
  // The model's REST pose — every joint at zero, raw (no kins, no WCS, no
  // TLO): the second baseline that tells a mechanical neighbour (touching
  // here too) from a crash pose (clear here). A classification probe, not
  // a sweep sample — `done` does not count it.
  const poseRest = () => {
    jointVals.fill(0);
    poseTree(nodes, jointVals, scratch);
    for (let bi = 0; bi < bodies.length; bi++) {
      const body = bodies[bi]!;
      body.world.multiplyMatrices(nodes[body.nodeIdx]!.world, body.localMat);
      body.worldCenter.copy(body.center).applyMatrix4(body.world);
    }
  };
  poseFirst();
  const candidates: number[] = [];   // machine pairs inside the margin at the first pose
  const firstDist = new Float64Array(pairs.length);
  const nearFirst = new Uint8Array(pairs.length);   // inside the margin at the first pose (shard costs)
  const firstLine = track.lines[firstSeg] ?? 0;
  for (let pi = 0; pi < pairs.length; pi++) {
    if (unreachable[pi]) continue;   // provably beyond the margin everywhere (prescreen)
    const [ai, bi] = pairs[pi]!;
    let dist = pairDistance(bodies[ai]!, bodies[bi]!, opts.margin, opts.margin);
    if (dist > opts.margin) {
      // Surfaces apart: wholly inside is a contact the distance cannot see.
      const v = insideOf(pi);
      if (v === "inside") dist = 0;
      else markInside(pi, v, firstLine);
    }
    if (dist <= opts.margin) {
      nearFirst[pi] = 1;
      if (pairCutting[pi]) {
        inContact[pi] = 1;  // engaged from the start — a later retract is benign
      } else if (pairTool[pi]) {
        seedOnset(pi);
      } else {
        candidates.push(pi);
        firstDist[pi] = dist;
      }
    }
  }
  if (candidates.length) {
    poseRest();
    for (const pi of candidates) {
      const [ai, bi] = pairs[pi]!;
      // At rest too: touching or wholly inside — decided, never undecidable
      // (VP96-03: no static exclusion on an answer nobody has).
      let rest = pairDistance(bodies[ai]!, bodies[bi]!, opts.margin, opts.margin) <= opts.margin;
      if (!rest) {
        const v = insideOf(pi);
        rest = v === "inside";
        if (v === "undecidable") markInside(pi, v, firstLine);
      }
      if (rest) {
        staticExcluded[pi] = 1;   // touching at rest too: a slide, a bearing, a mount
        staticContacts.push({ a: bodies[ai]!.id, b: bodies[bi]!.id, dist: firstDist[pi]! });
      } else {
        seedOnset(pi);            // clear at rest: the program starts crashed
      }
    }
    poseFirst();   // leave the model where the sweep expects it
  }
  done++;
  for (let pi = 0; pi < pairs.length; pi++) if (staticExcluded[pi]) skipPair[pi] = 1;
  if (opts.shard && opts.shard.of > 1) {
    // Every shard computes this same split from the same baseline. A pair
    // inside the margin at the first pose is what a long sweep queries
    // along the program, and its query costs with the two meshes it walks:
    // weighed by their triangles (on haus.ngc the C faceplate's 5576 against
    // the Y saddle's 44 — measured per pair 252 s against 78 s; with all of
    // them alike the slowest of 4 shards had 384 s of work, by triangles 323,
    // 266 at best).
    const tris = (b: BuiltBody) => b.geom.attributes.position!.count / 3;
    const cost = new Float64Array(pairs.length);
    for (let pi = 0; pi < pairs.length; pi++) {
      const [ai, bi] = pairs[pi]!;
      cost[pi] = skipPair[pi] ? 0 : nearFirst[pi] ? 10 + tris(bodies[ai]!) + tris(bodies[bi]!) : 1;
    }
    const mine = assignPairs(cost, opts.shard.of)[opts.shard.index]!;
    for (let pi = 0; pi < pairs.length; pi++) {
      if (mine[pi]) continue;
      skipPair[pi] = 1;
      undecSpans.delete(pi);   // the baseline's answer for another shard's pair is that shard's to report
    }
    if (opts.shard.index !== 0) { staticContacts.length = 0; pairsPrescreened = 0; }
  }

  // ── A RANGE sweep (plan „Prüfung im Lauf“ 3b) ─────────────────────────
  // The baseline above is the PROGRAM's — its first pose and the rest pose
  // decide the static exclusions (a baseline at the range start would take a
  // pair touching there and at rest for a mount, VP112-04). What the first
  // pose SEEDED is not the range's: no contact state, no undecidable stretch
  // at the first line. The sweep starts at the first segment with length
  // after point `from`, every pair queried afresh there: no certificate yet
  // (`clear` 0), and no surface distance measured (`surf` 0), so the inside
  // question is asked too; a pair inside the margin at that first sample is a
  // BOUNDARY contact (noteQuery). Nothing before `rangeStart` is swept,
  // refined or reported.
  const rangeFrom = opts.range ? Math.max(0, Math.min(n - 1, Math.floor(opts.range.from))) : 0;
  let startSeg = 1;
  if (opts.range) {
    startSeg = rangeFrom + 1;
    while (startSeg < n && dcum[startSeg]! - dcum[startSeg - 1]! <= 1e-9) startSeg++;
    inContact.fill(0);
    onsetLine.fill(-1);
    onsetRapid.fill(0);
    undecided.fill(0);
    undecSpans.clear();
  }
  const rangeStart = opts.range && n > 0 ? dcum[rangeFrom]! : 0;
  const rangeEmpty = !!opts.range && startSeg >= n;
  // In contact at the range's first sample: begun before the range, its
  // onset and kind unknown — its records carry `boundary` until it separates.
  const boundaryPair = new Uint8Array(pairs.length);
  const boundaryContacts: NonNullable<CollisionResult["boundaryContacts"]> = [];

  const keyFor = (line: number, pi: number, boundary = false) => {
    const [ai, bi] = pairs[pi]!;
    return `${boundary ? "B" : ""}${line}|${bodies[ai]!.id}|${bodies[bi]!.id}`;
  };
  const recordHit = (line: number, cum: number, rapid: boolean, pi: number, dist: number) => {
    const [ai, bi] = pairs[pi]!;
    // A boundary contact's records have keys of their own: the pair may
    // separate and come back on the same line — a collision of its own.
    const boundary = boundaryPair[pi] === 1;
    const key = keyFor(line, pi, boundary);
    const prev = worst.get(key);
    if (!prev || dist < prev.dist) {
      const rec: CollisionHit & { pi: number; samples: number[]; carriedFrom?: number } = {
        line, cum, cumEnd: cum, a: bodies[ai]!.id, b: bodies[bi]!.id, dist, rapid, pi,
        samples: prev ? prev.samples : [] };
      if (prev?.carriedFrom !== undefined) rec.carriedFrom = prev.carriedFrom;
      // Continuation: the pair's contact began on an EARLIER line and has
      // not separated since. A worse sample on the same line keeps the
      // record's existing verdict.
      const cont = prev ? prev.continuation
        : (onsetLine[pi]! >= 0 && onsetLine[pi] !== line ? onsetLine[pi]! : undefined);
      if (cont !== undefined) rec.continuation = cont;
      if (boundary) rec.boundary = true;
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

  // One query's answer for a pair's CONTACT STATE and records — the main
  // loop's and the re-sampling's after a touch (VP-I45, R87): the onset
  // (with the re-entry promotion), the record under the cutting rule, a
  // verified separation past 2 × margin. The main loop then sets the pair's
  // certificates; the re-sampling sets none.
  const noteQuery = (pi: number, s: number, line: number, isRapid: boolean, d: number) => {
    if (d <= opts.margin) {
      if (!inContact[pi]) {
        inContact[pi] = 1;
        onsetRapid[pi] = isRapid ? 1 : 0;
        onsetLine[pi] = line;
        if (opts.range && s <= rangeStart + 1e-9) {
          // In contact where the range starts: begun before it. A cutting
          // pair's onset is unknown — taken as feed-begun, so it reports
          // nothing; the boundary contact names it for the full check.
          boundaryPair[pi] = 1;
          onsetRapid[pi] = 0;
          const [ai, bi] = pairs[pi]!;
          boundaryContacts.push({ a: bodies[ai]!.id, b: bodies[bi]!.id, line, cum: s, dist: Math.max(0, d),
                                  cutting: !!pairCutting[pi] });
        }
        // Re-entry promotion: a genuine onset on a line whose record
        // was minted as a continuation (contact carried in, separated,
        // came back on the same line) is a real clash — never hidden.
        // Its carried-in part stays the earlier onset's contact
        // (carriedFrom → `carried` after refinement, Codex R34 VP-I09).
        const ex = worst.get(keyFor(line, pi));
        if (ex && ex.continuation !== undefined) {
          ex.carriedFrom = ex.continuation;
          delete ex.continuation;
        }
      }
      if (pairCutting[pi]) {
        // Cutting pair (the cutter × a stock body): feed contact is
        // MACHINING — never reported. (A boundary contact's onset is taken
        // as feed: it records nothing.) A contact whose ONSET fell in a
        // rapid is the gouge class and reports for that rapid; a
        // retract leaving contact begun on a feed (or present from
        // the program start) is benign.
        if (isRapid && onsetRapid[pi]) recordHit(line, s, true, pi, d);
      } else {
        recordHit(line, s, isRapid, pi, d);
      }
    } else if (inContact[pi] && d > opts.margin * 2) {
      inContact[pi] = 0;
      onsetRapid[pi] = 0;
      onsetLine[pi] = -1;  // verified separation: the next touch is a new onset
      boundaryPair[pi] = 0;
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
  // The segment a dist parameter lies on (the one ENDING at the returned
  // vertex; its line and rapid flag are that vertex's).
  const segAtDist = (s: number): number => {
    let lo = 1, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (dcum[mid]! < s) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  // Does the path between dist parameters a < b run on any rapid segment?
  const rapidBetween = (a: number, b: number): boolean => {
    for (let seg = segAtDist(a), end = segAtDist(b); seg <= end; seg++) if (track.rapid[seg] === 1) return true;
    return false;
  };
  const distAtCum = (s: number, pi: number, maxT: number = opts.margin): number => {
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
    return pairDistance(bodies[ai]!, bodies[bi]!, maxT, opts.margin);
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
  // An INSIDE answer's certificate (inside check, plan step 5): the answer
  // can only change through a surface crossing, and none can happen before
  // the surfaces' distance is used up at the pair's speed bound — carried
  // like `clear` (the distance at `inQ`, re-expressed in each chunk's V).
  // Until then the pair's samples (a long inside contact owes one per line)
  // need neither the distance query nor the rays. 0 = no certificate.
  const inClear = new Float64Array(pairs.length);
  const inQ = new Float64Array(pairs.length);
  // The surfaces' distance at the pair's last query (a lower bound; beyond the
  // horizon the horizon), used up at the pair's speed bound like `clear`. Spent,
  // a surface crossing may have come since — the sampling floor (MIN_ADV)
  // steps past a touch narrower than itself, and through one the pair can have
  // gone wholly inside: the inside answer is asked again then (a 0.08° touch
  // at 12 mm/° on a C sweep left the inside stretch after it unseen,
  // collision.test "a world kins' speed").
  const surf = new Float64Array(pairs.length);
  const surfQ = new Float64Array(pairs.length);
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
  // dist parameter reached — the covered fraction on truncation; a range
  // sweep has covered nothing before its start
  let sweptTo = rangeStart;
  const overBudget = (): boolean => clock() - t0 > maxMs;
  // Progress and `covered` are fractions of the TRACK's axis (time on a
  // time-based track): the scrub bar draws the swept section on its
  // timeline (2026-09-12), so the sweep's own distance parameter converts
  // through distToTrackCum here — only at checkpoints, so the binary search
  // is free. On a distance track the two axes coincide.
  const trackMax = n > 0 ? track.cum[n - 1]! : 0;
  const frac = (s: number): number => Math.min(1, distToTrackCum(s) / (trackMax || 1));
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
  // Does a segment whose tool body is unknown lie between dist parameters a < b?
  const unknownToolBetween = (a: number, b: number): boolean => {
    for (let seg = segAtDist(a), end = segAtDist(b); seg <= end; seg++) if (segUnk![seg]) return true;
    return false;
  };
  // The stretch of segments around a dist parameter whose tool body is known.
  // A parameter ON an unknown segment's end (or start) belongs to the known
  // segment beyond it — segAtDist hands a boundary to the segment ending there.
  const knownToolSpan = (s: number): [number, number] => {
    let a = segAtDist(s);
    if (segUnk![a] && a < n - 1 && s >= dcum[a]! - 1e-9) a++;
    else if (segUnk![a] && a > 1 && s <= dcum[a - 1]! + 1e-9) a--;
    let b = a;
    while (a > 1 && !segUnk![a - 1]) a--;
    while (b < n - 1 && !segUnk![b + 1]) b++;
    return [dcum[a - 1]!, dcum[b]!];
  };
  // The refinement's predicate: touching OR wholly inside — and undecidable
  // counts as contact (the interval grows, it never shrinks over an answer
  // nobody has). Its boundaries are where the surfaces cross.
  // An undecidable answer here is named too (Codex R101 VP-I58) — apart from
  // the forward sweep's time-ordered state (`undecided` / `undecSpans`), which
  // a refinement walking back must not touch: per pair, the lines it hit.
  const refineUndec = new Map<number, Set<number>>();
  const contactAtDist = (s: number, pi: number): boolean => {
    if (distAtCum(s, pi) <= CONTACT_EPS) return true;
    const v = insideOf(pi);
    if (v === "undecidable") {
      let lines = refineUndec.get(pi);
      if (!lines) refineUndec.set(pi, lines = new Set());
      lines.add(track.lines[segAtDist(s)]!);
    }
    return v !== "outside";
  };
  // Bisect a contact boundary between a known in-contact cum and a known
  // clear cum (either order); returns the refined in-contact-side cum.
  const bisectBoundary = (contactCum: number, clearCum: number, pi: number): number => {
    let c = contactCum, x = clearCum;
    for (let it = 0; it < 24 && Math.abs(x - c) > 1e-3; it++) {
      const mid = (c + x) / 2;
      if (contactAtDist(mid, pi)) c = mid;
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
  const refined = new Map<string, { sig: string; cum: number; cumEnd: number; intervals: Array<[number, number]>; carried: boolean }>();
  // One statement per pair whose inside check was undecidable, its stretches
  // by line (three, then "…") — per pair, so the shards' statements unite.
  const insideNotes = (): string[] => {
    const at = (spans: Array<[number, number]>) =>
      spans.slice(0, 3).map(([a, b]) => (a === b ? `L${a}` : `L${a}–L${b}`)).join(", ") + (spans.length > 3 ? " …" : "");
    // the forward sweep's stretches and the refinement's lines, per pair
    const byPair = new Map<number, Array<[number, number]>>();
    for (const [pi, spans] of undecSpans) byPair.set(pi, spans.slice());
    for (const [pi, lines] of refineUndec) {
      const spans = byPair.get(pi) ?? [];
      for (const l of lines) if (!spans.some(([a, b]) => l >= Math.min(a, b) && l <= Math.max(a, b))) spans.push([l, l]);
      byPair.set(pi, spans);
    }
    return [...byPair.entries()]
      .map(([pi, spans]) => [pi, spans.sort((x, y) => x[0] - y[0])] as const)
      .sort((x, y) => x[1][0]![0] - y[1][0]![0] || x[0] - y[0])
      .map(([pi, spans]) => {
        const [ai, bi] = pairs[pi]!;
        return `inside check undecidable for ${bodies[ai]!.id} ↔ ${bodies[bi]!.id} (${at(spans)}) — a part wholly inside the other is not found there`;
      });
  };
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
    // (a boundary contact's records are no onsets: they go with the
    // continuations)
    const isOnset = (h: CollisionHit) => h.continuation === undefined && !h.boundary;
    const onsetE = entries.filter(([, h]) => isOnset(h)).sort((x, y) => x[1].cum - y[1].cum);
    const contE = entries.filter(([, h]) => !isOnset(h)).sort((x, y) => x[1].cum - y[1].cum);
    const selected = [...onsetE, ...contE].slice(0, MAX_HITS);
    for (const [key, h] of selected) {
      if (!refine) break;
      // Near-misses keep their closest-approach sample. A contact from the
      // start of the axis (the program begins in it) refines too: its entry
      // needs no walk back, but it may separate and come back on its line —
      // one window over the clear gap lost the re-entry (Codex R34 VP-I09).
      if (h.dist > CONTACT_EPS) continue;
      // carriedFrom is an input too: a promotion without a new contact
      // sample (a re-entry inside the margin) changes `carried` alone.
      const sig = `${h.samples.length},${h.cum},${h.cumEnd},${h.carriedFrom ?? ""}`;
      const memo = refined.get(key);
      if (memo && memo.sig === sig) {
        h.cum = memo.cum;
        h.cumEnd = memo.cumEnd;
        h.intervals = memo.intervals.map(iv => [iv[0], iv[1]] as [number, number]);
        if (memo.carried) h.carried = true;
        else delete h.carried;
        continue;
      }
      // never before a range's start: a contact just after it on the same
      // line would walk back past it into contact before the range
      const floor = Math.max(lineStartDist(h.cum, h.line), rangeStart);
      const ceil = lineEndDist(Math.max(h.cumEnd, h.cum), h.line);
      // A tool pair never walks into a stretch where the tool's body is
      // unknown: every boundary stays inside its own cluster's known span.
      const clampTool = !!segUnk && pairTool[h.pi]!;

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
        // ...and a stretch whose tool body is unknown lies between two
        // clusters, whatever its length: no interval spans what was not asked
        if (!last || s - last[1] > CLUSTER_GAP || (clampTool && unknownToolBetween(last[1], s))) clusters.push([s, s]);
        else last[1] = s;
      }
      if (!clusters.length) clusters.push([h.cum, Math.max(h.cum, h.cumEnd)]);
      // Pathological chatter cap — merge the tail rather than grow unbounded.
      while (clusters.length > 16) {
        const t = clusters.pop()!;
        clusters[clusters.length - 1]![1] = t[1];
      }

      const intervals: Array<[number, number]> = [];
      // Does the first interval reach back to the line's start, contact all
      // the way? Then a record that carried its contact in (carriedFrom)
      // starts with that carried contact.
      let fromLineStart = false;
      for (let ci = 0; ci < clusters.length; ci++) {
        const [cs, ce] = clusters[ci]!;
        // ENTRY: walk back toward the previous interval's exit / line start.
        const efloor0 = ci === 0 ? floor : intervals[ci - 1]![1];
        const efloor = clampTool ? Math.max(efloor0, knownToolSpan(cs)[0]) : efloor0;
        let hi = cs, lo = hi, guard = 0, bracketed = false;
        while (guard++ < 128 && lo > efloor) {
          lo = Math.max(efloor, lo - back);
          if (!contactAtDist(lo, h.pi)) { bracketed = true; break; }
          hi = lo;  // still in contact — earliest known contact moves back
        }
        const entry = bracketed ? bisectBoundary(hi, lo, h.pi) : hi;
        if (ci === 0) fromLineStart = !bracketed && entry <= efloor0;
        // EXIT: walk forward toward the next cluster / line end.
        const eceil0 = ci === clusters.length - 1 ? ceil : clusters[ci + 1]![0];
        const eceil = clampTool ? Math.min(eceil0, knownToolSpan(ce)[1]) : eceil0;
        let elo = Math.max(ce, entry), ehi = elo;
        guard = 0;
        let exitBracketed = false;
        while (guard++ < 128 && ehi < eceil) {
          ehi = Math.min(eceil, ehi + back);
          if (!contactAtDist(ehi, h.pi)) { exitBracketed = true; break; }
          elo = ehi;
        }
        const exit = exitBracketed ? bisectBoundary(elo, ehi, h.pi) : ehi;
        intervals.push([entry, exit]);
      }
      const merged = mergeContiguousIntervals(intervals);
      h.cum = merged[0]![0];
      h.cumEnd = merged[merged.length - 1]![1];
      h.intervals = merged;
      const carried = h.carriedFrom !== undefined && fromLineStart;
      if (carried) h.carried = true;
      else delete h.carried;
      refined.set(key, { sig, cum: h.cum, cumEnd: h.cumEnd, carried,
                         intervals: merged.map(iv => [iv[0], iv[1]] as [number, number]) });
    }
    // Where each onset's contact finally ENDS, over ALL records (dist cum —
    // refined for selected records, the raw last in-contact sample for the
    // rest): the span the tint and the red extent paint past the cap.
    // A carried first interval is that onset's contact too.
    const spanEndDist = new Map<string, number>();
    for (const h of recs.values()) {
      const from = h.continuation ?? (h.carried ? h.carriedFrom : undefined);
      if (from === undefined) continue;
      const end = h.continuation !== undefined ? h.cumEnd : h.intervals![0]![1];
      const key = keyFor(from, h.pi, !!h.boundary);
      spanEndDist.set(key, Math.max(spanEndDist.get(key) ?? -Infinity, end));
    }
    // Hits leave the sweep in TRACK cum (time on a time-based track) — the
    // scrub-to-hit target must live on the slider's axis.
    for (const [key, h] of selected) {
      const se = h.continuation === undefined ? spanEndDist.get(key) : undefined;
      if (se !== undefined && se > h.cumEnd) h.spanCumEnd = distToTrackCum(se);
      else delete h.spanCumEnd;
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
      const from = h.continuation ?? (h.carried ? h.carriedFrom : undefined);
      if (from === undefined) continue;
      const onset = recs.get(keyFor(from, h.pi, !!h.boundary));
      if (onset) onset.spanEndLine = Math.max(onset.spanEndLine ?? onset.line, h.line);
    }

    // Re-sorted by cum after refinement (ScrubBar relies on cum order).
    const hits = selected.map(([, h]) => h)
      .sort((x, y) => x.cum - y.cum)
      .map(({ pi: _pi, samples: _s, carriedFrom: _c, ...rest }) => rest);

    // Hand the model back wearing its BASE tool body — the model's own
    // (TWP-07): a caller that reuses the model (the resident worker model,
    // tests) must not inherit the last segment's program tool. (Final
    // result only — a snapshot leaves the suspended loop's tool alone; the
    // loop re-installs its tool at every pose, which follows every resume.)
    if (final) restoreBaseTool(model);
    return {
      hits,
      staticContacts,
      samples: done,
      coarsened,
      ...notesOf([...noteParts, ...insideNotes()]),
      pairCount: pairs.length,
      pairsPrescreened,
      bvhMs: model.bvhMs,
      sweepMs: clock() - t0,
      truncated: trunc,
      ...(opts.range ? {
        range: { fromCum: n > 0 ? track.cum[rangeFrom]! : 0, fromLine: shownLine(Math.min(startSeg, n - 1)),
                 ...(rangeEmpty ? { empty: true as const } : {}) },
        boundaryContacts: boundaryContacts.map(b => ({ ...b, cum: distToTrackCum(b.cum) })),
      } : {}),
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
    opts.snapshot.peek = () => {
      // refine=false never sorts or mutates a record's samples, so a shallow
      // copy suffices (live records carry no intervals yet).
      const copy: typeof worst = new Map();
      for (const [k, h] of worst) copy.set(k, { ...h });
      return buildResult(copy, { covered: frac(sweptTo), reason: "running" }, false, false);
    };
    opts.snapshot.records = () => worst.size;
  }
  // Checkpoint before the first segment: an abort here leaves the baseline
  // pose only (the "aborts early" contract).
  const abortAtStart = (yield opts.range ? frac(rangeStart) : 0) === true;
  if (abortAtStart) aborted = true;
  lastYield = clock();
  // Tool geometry / tool offset of the previous segment (TWP-06): a carried
  // clearance certificate is only valid while the tool body's geometry and
  // its −TLO shift are those it was measured with.
  let prevTool = toolFor(opts.range ? Math.min(startSeg, n - 1) : 0);
  let prevTlo = tloFor(opts.range ? Math.min(startSeg, n - 1) : 0);
  let prevUnknown = false;
  // A break crossed since the last swept segment (R-03, implementation review
  // 2026-09-15). `brk` carries TWO things: a kins/WCS relabel, which is a
  // stationary re-expression, and an unknown START (scrubTrack ORs `ustart`
  // in) — an endpoint the machine reached by a path no parse can know, e.g.
  // the motion around an M6. Both arrive as a zero-length segment, which the
  // L <= eps guard below skips, so clearance measured BEFORE the break used
  // to survive it: the sweep then strode past real contact in the known
  // motion after the gap (the review's probe: 0 hits combined, 1 hit on the
  // suffix alone). Carried clearance is a statement about a distance that was
  // actually measured, and after unknown motion there is no such statement —
  // for ANY pair, not just the tool's (a tool change moves the table too).
  // So: remember the break and invalidate everything at the next real
  // segment. Relabels pay the same single re-query; there are a handful per
  // program, which is why this does not need the two flags separated on the
  // wire.
  let pendingBreak = false;
  outer:
  for (let i = startSeg; i < n && !abortAtStart; i++) {
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
    if (track.brk?.[i]) pendingBreak = true;
    if (L <= 1e-9) continue;
    // Tool-geometry / tool-offset discontinuity (TWP-06, review 2026-09-14):
    // a carried clearance was measured with the PREVIOUS segment's tool
    // body. A different program tool swaps the cylinder; a different tool
    // offset shifts the body by −TLO in the tool node. Either invalidates
    // every tool pair's certificate: their clearance is zeroed so the
    // chunk-start block re-queries them at this segment's start, and pairs
    // in contact are forced to re-query too (a swap to a thinner tool is a
    // separation the d > 2·margin rule then verifies; a swap to a fatter
    // one is contact it measures — onset state is never guessed). Kins/WCS
    // relabels (brk vertices) are zero-width and stationary, not a
    // discontinuity of this kind; non-tool pairs are unaffected.
    const segTool = toolFor(i), segTlo = tloFor(i);
    const toolBoundary = segTool !== prevTool
      || segTlo[0] !== prevTlo[0] || segTlo[1] !== prevTlo[1] || segTlo[2] !== prevTlo[2];
    const breakBoundary = pendingBreak;
    pendingBreak = false;
    if (toolBoundary || breakBoundary) {
      for (let pi = 0; pi < pairs.length; pi++) {
        if (skipPair[pi]) continue;
        // No continuous motion here: what was outside may be inside after it.
        if (breakBoundary || pairTool[pi]) { clear[pi] = 0; needInside[pi] = 1; inClear[pi] = 0; }
      }
    }
    prevTool = segTool; prevTlo = segTlo;
    // The tool's body unknown here: its pairs are not checked. Out of such a
    // stretch, a contact of the tool does not carry across it — a touch from
    // here on is a new onset, never the stretch's continuation.
    const segUnknown = segUnk?.[i] === 1;
    if (prevUnknown && !segUnknown) {
      for (let pi = 0; pi < pairs.length; pi++) {
        if (!pairTool[pi]) continue;
        inContact[pi] = 0; touching[pi] = 0; onsetLine[pi] = -1; onsetRapid[pi] = 0; boundaryPair[pi] = 0;
      }
    }
    prevUnknown = segUnknown;
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
        if (skipPair[pi] || (segUnknown && pairTool[pi])) continue;
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
        if (skipPair[pi] || (segUnknown && pairTool[pi])) { pairV[pi] = 0; continue; }
        const [ai, bi] = pairs[pi]!;
        const A = bodies[ai]!, B = bodies[bi]!;
        const list = pairDofs[pi]!;
        // Each linear DOF on this pair's path contributes a bound on its
        // speed over the chunk (its endpoint delta and four times its bulge)
        // — per joint, so a pair riding only X pays only X's. The budget then
        // flows into the rotary lever+trans recursion below, which needs it
        // too: the speed bounds the travel over the whole chunk as well.
        let trans = 0;
        let rotRadLever = 0;
        for (let di = 0; di < list.length; di++) {
          const pd = list[di]!;
          const dJ = Math.abs((jv1[pd.dof.joint] ?? 0) - (jv0[pd.dof.joint] ?? 0));
          // a SPEED bound, never the chord deviation (VP-I57)
          if (!pd.dof.rotate) trans += jointSpeedBound(dJ, jointBulge[pd.dof.joint] ?? 0);
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
        if (skipPair[pi] || (segUnknown && pairTool[pi])) continue;
        sQ[pi] = s0;
        if (inContact[pi]) {
          // A tool/TLO boundary re-measures in-contact tool pairs at once
          // (TWP-06), a break re-measures EVERY pair (R-03) — see the
          // segment head. Contact carried across either is not a measurement
          // of this segment; the d > 2·margin rule verifies any separation.
          if (ch === 0 && (breakBoundary || (toolBoundary && pairTool[pi]))) {
            sSafe[pi] = s0; continue;
          }
          // Every LINE a pair stays in contact with gets at least one sample
          // (its continuation record — the G-code panel marks it); within a
          // line the EXPLORE cadence carries across the chunks. A cutting
          // pair in FEED-begun contact mints no record at all (machining),
          // so it owes no per-line sample — the EXPLORE cadence alone keeps
          // watching for separation (2026-09-13: on a 0.7 mm-line random walk
          // the per-line rule queried the tool×stock pair 7× more often than
          // its cadence, a fifth of the whole sweep).
          if (qLine[pi] !== line && !(pairCutting[pi] && !onsetRapid[pi])) { sSafe[pi] = s0; continue; }
          // Not touching at its last query: its clearance (to a touch inside
          // the margin, to the margin past it) was measured in the last
          // chunk's V and is re-expressed in this chunk's, like every carried
          // certificate — a certificate carried as an absolute sSafe
          // overshot wherever V grew (a rotary chunk's longer lever).
          if (!touching[pi]) sSafe[pi] = s0 + Math.max(0, clear[pi]!) / Math.max(pairV[pi]!, 1e-9);
          continue;
        }
        const c = clear[pi]!;
        sSafe[pi] = c > 0 ? s0 + c / Math.max(pairV[pi]!, 1e-9) : s0;
      }

      let s = s0;
      for (;;) {
        done++;
        // Checkpoint BEFORE the pose (TWP-07): a yield between interpPose and
        // the distance queries let whatever ran in between — a side sweep,
        // a snapshot's refinement probe — re-pose the shared model under
        // this sample's queries. Progress reports the last COMPLETED sample.
        if ((done & (SAMPLES_PER_CLOCK - 1)) === 0
            && ((done & (SAMPLES_PER_YIELD - 1)) === 0 || clock() - lastYield >= yieldMs)) {
          if (overBudget()) { truncated = { covered: frac(sweptTo), reason: "time" }; break outer; }
          if ((yield frac(sweptTo)) === true) { aborted = true; break outer; }
          lastYield = clock();
        }
        interpPose(i, (s - c0) / L);
        if (done > maxSamples && !budgetExceeded) {
          budgetExceeded = true;
          coarsened = true;  // honest: from here on, fixed EXPLORE steps
        }
        let step = s1 - s;
        for (let pi = 0; pi < pairs.length; pi++) {
          if (skipPair[pi] || (segUnknown && pairTool[pi])) continue;
          if (sSafe[pi]! > s + 1e-9) {
            const remain = sSafe[pi]! - s;
            if (remain < step) step = remain;
            continue;  // certificate still valid — skip the query
          }
          const [ai, bi] = pairs[pi]!;
          const A = bodies[ai]!, B = bodies[bi]!;
          let d: number;
          let v: InsideVerdict | null = null;
          const inCert = inClear[pi]! > 0 && s - inQ[pi]! < inClear[pi]! / Math.max(pairV[pi]!, 1e-9);
          const mayHaveCrossed = surf[pi]! - pairV[pi]! * (s - surfQ[pi]!) <= 0;
          if (inCert) {
            d = 0;   // still inside: no surface crossing since it was measured
          } else if (prof) {
            const tq = clock();
            d = pairDistance(A, B, HORIZON, opts.margin);
            if (d > CONTACT_EPS && (askInside(pi) || mayHaveCrossed)) v = pairInside(A, B);
            prof.ms![pi] = prof.ms![pi]! + (clock() - tq);
            prof.queries![pi] = prof.queries![pi]! + 1;
          } else {
            d = pairDistance(A, B, HORIZON, opts.margin);
            // Decided at THIS sample's pose, before the re-sampling below
            // moves the model (it poses it back for the pairs after this one).
            if (d > CONTACT_EPS && (askInside(pi) || mayHaveCrossed)) v = pairInside(A, B);
          }
          needInside[pi] = 0;
          if (!inCert) {
            surf[pi] = d === Infinity ? HORIZON : Math.min(d, HORIZON);
            surfQ[pi] = s;
          }
          const unknownInside = v === "undecidable";
          if (v === "inside") {
            inClear[pi] = d === Infinity ? HORIZON : Math.min(d, HORIZON);   // a lower bound of the surfaces' distance
            inQ[pi] = s;
            d = 0;
          } else if (!inCert) {
            inClear[pi] = 0;
          }
          // VP-I45 (Codex R86/R87): a touching pair re-probes every EXPLORE,
          // and inside that stride the contact can end, the pair separate and
          // touch AGAIN — a second contact wider than MIN_ADV no sample saw.
          // Found not touching now, the stretch since its last touch is
          // re-sampled at MIN_ADV BEFORE this sample's state changes, each
          // sample through the same state step in time order: a separation
          // past 2 × margin there ends the old contact, and a touch after it
          // is a new onset on its own line and kind of move — a rapid
          // re-contact after a feed contact was taken for its benign retract
          // (R87). Queried to HORIZON, so a separation can be seen at all.
          // A pair still touching keeps the stretch as contact — an
          // unchecked gap never reads as clear — EXCEPT a cutting pair in a
          // feed-begun contact whose stretch reaches a rapid (R88): touching
          // again at this sample, it would carry the feed contact's benign
          // origin over a separation and a rapid re-entry inside the stretch,
          // the gouge never reported. Feed-only stretches need no look: a
          // re-entry on a feed is machining.
          const resample = touching[pi] && s - lastTouch[pi]! > MIN_ADV
            && (d > CONTACT_EPS || (pairCutting[pi] && !onsetRapid[pi] && rapidBetween(lastTouch[pi]!, s)));
          if (resample) {
            for (let x = lastTouch[pi]! + MIN_ADV; x < s - 1e-9; x += MIN_ADV) {
              done++;
              let dx = distAtCum(x, pi, HORIZON);
              const seg = segAtDist(x);
              // Every sample of the stretch is a separation decision.
              const vx = dx > CONTACT_EPS ? insideOf(pi) : null;
              markInside(pi, vx, track.lines[seg]!);
              if (vx === "inside") dx = 0;
              else if (vx === "undecidable") dx = Math.min(dx, opts.margin * 2);
              noteQuery(pi, x, track.lines[seg]!, track.rapid[seg] === 1, dx);
            }
            interpPose(i, (s - c0) / L);   // this sample's pose for the pairs after this one
          }
          markInside(pi, v, line);
          // Undecidable: a record only for what the surfaces show (inside the
          // margin), never a separation (at most 2 × margin).
          noteQuery(pi, s, line, isRapid, unknownInside ? Math.min(d, opts.margin * 2) : d);
          if (unknownInside) {
            // No clearance certificate: asked again at the contact cadence
            // until a pose decides it.
            clear[pi] = 0;
            touching[pi] = 0;
            sSafe[pi] = s + EXPLORE;
            sQ[pi] = s;
            qLine[pi] = line;
          } else if (d <= opts.margin) {
            if (d > CONTACT_EPS) {
              // Inside the margin but not touching: the distance certifies
              // that the pair cannot TOUCH before s + d/V. The fixed EXPLORE
              // cadence stepped over a touch between two in-margin samples
              // and the record stayed "near miss, 1.5 mm apart" while the
              // parts met 1 mm deep (2026-10-07, the oracle hunt; on a
              // rotary move 5° of a long lever passes a part through
              // another). Same floor as the margin guarantee: no touch wider
              // than MIN_ADV of path is missed.
              clear[pi] = d;
              touching[pi] = 0;
              sSafe[pi] = s + Math.max(MIN_ADV, Math.min(EXPLORE, d / Math.max(pairV[pi]!, 1e-9)));
            } else {
              clear[pi] = 0;
              touching[pi] = 1;
              lastTouch[pi] = s;
              sSafe[pi] = s + EXPLORE;  // re-probe cadence inside the contact
            }
            sQ[pi] = s;
            qLine[pi] = line;
          } else {
            touching[pi] = 0;
            const bound = d === Infinity ? HORIZON : d;
            clear[pi] = bound - opts.margin;
            sQ[pi] = s;
            qLine[pi] = line;
            sSafe[pi] = s + Math.max(MIN_ADV, (bound - opts.margin) / Math.max(pairV[pi]!, 1e-9));
          }
          const remain = sSafe[pi]! - s;
          if (remain < step) step = remain;
        }
        sweptTo = s;   // this sample's queries are complete
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
        if (skipPair[pi] || (segUnknown && pairTool[pi])) continue;
        if (inClear[pi]! > 0) {
          inClear[pi] = inClear[pi]! - pairV[pi]! * (s1 - inQ[pi]!);
          inQ[pi] = s1;
        }
        surf[pi] = surf[pi]! - pairV[pi]! * (s1 - surfQ[pi]!);
        surfQ[pi] = s1;
        if (inContact[pi] && touching[pi]) continue;
        clear[pi] = clear[pi]! - pairV[pi]! * (s1 - sQ[pi]!);
      }
    }
  }
  const finalResult = buildResult(worst, truncated, true, !aborted);
  yield truncated ? truncated.covered : 1;
  if (opts.snapshot) { opts.snapshot.take = null; opts.snapshot.peek = null; opts.snapshot.records = null; }
  return finalResult;
}

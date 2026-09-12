// Unit tests for viewer/collision.ts — synthetic machines with box bodies.
import * as THREE from "three";
import { emptyLineIndex } from "./lineIndex";
import { describe, expect, it } from "vitest";
import {
  buildCollisionModel, sweepCollisions, sweepCollisionsIter, toolCylinderPositions, type SnapshotHandle,
  type CollisionBody, type CollisionMachine, type CollisionResult, mergeContiguousIntervals } from "./collision";
import type { ScrubTrack } from "../ws/bulkData";

const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 };

function boxPositions(size: number): Float32Array {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  const pos = new Float32Array(g.getAttribute("position").array as Float32Array);
  g.dispose();
  return pos;
}

function track(points: number[][], abc?: number[][], lines?: number[], rapid?: number[]): ScrubTrack {
  const n = points.length;
  const pos = new Float32Array(points.flat());
  const abcArr = new Float32Array((abc ?? points.map(() => [0, 0, 0])).flat());
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const j = i * 3, k = j - 3;
    const lin = Math.hypot(pos[j]! - pos[k]!, pos[j + 1]! - pos[k + 1]!, pos[j + 2]! - pos[k + 2]!);
    const rot = Math.max(
      Math.abs(abcArr[j]! - abcArr[k]!),
      Math.abs(abcArr[j + 1]! - abcArr[k + 1]!),
      Math.abs(abcArr[j + 2]! - abcArr[k + 2]!));
    cum[i] = cum[i - 1]! + Math.max(lin, rot);
  }
  return {
    pos, abc: abcArr,
    lines: new Uint32Array(lines ?? points.map((_, i) => i + 1)),
    rapid: rapid ? new Uint8Array(rapid) : new Uint8Array(n), cum, count: n,
    lineIndex: emptyLineIndex(), timeBased: false,
  };
}

// Plunge mill: tool box rides a Z-driven tool group above a work box on an
// X-driven table. Tool group base z=50, box half-size 5 → tool bottom at
// 40+Z; work box top at +5. Contact at Z=-35, margin 2 breached below Z=-33.
const PLUNGE: CollisionMachine = {
  groups: [
    { id: "table", parent: "root" },
    // workGroup is a LEAF under the table so the vise (group "table") is a
    // fixture body, not a cutting body — cutting semantics get their own test.
    { id: "platter", parent: "table" },
    { id: "head", parent: "root", translate: [0, 0, 50] },
  ],
  kinematics: [
    { group: "table", joint: 0, type: "translate", direction: "x", sign: 1 },
    { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 },
  ],
  workGroup: "platter",
  toolGroup: "head",
  unitScale: 1,
  axes: ["X", "Y", "Z"],
};
const PLUNGE_BODIES: CollisionBody[] = [
  { id: "vise", group: "table", positions: boxPositions(10) },
  { id: "spindle", group: "head", positions: boxPositions(10) },
];

describe("buildCollisionModel", () => {
  it("derives pairs from relative motion, tool-side body first", () => {
    const m = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    expect(m.bodies.map(b => b.side)).toEqual(["work", "tool"]);
    expect(m.pairs).toEqual([[1, 0]]);
  });

  it("skips rigid pairs (same group / no DOF between) and includes DOF-crossing ones", () => {
    // Two bodies on the head group are rigid to each other; a body on a
    // static frame group still pairs with both movers (DOFs on their side).
    const machine = {
      ...PLUNGE,
      groups: [...PLUNGE.groups, { id: "frame", parent: "root" }],
    };
    const m = buildCollisionModel(machine, [
      ...PLUNGE_BODIES,
      { id: "spindle2", group: "head", positions: boxPositions(4) },
      { id: "column", group: "frame", positions: boxPositions(4) },
    ]);
    const key = (p: [number, number]) => [m.bodies[p[0]]!.id, m.bodies[p[1]]!.id].sort().join("/");
    const pairKeys = m.pairs.map(key).sort();
    // NOT present: spindle/spindle2 (same group).
    expect(pairKeys).toEqual([
      "column/spindle", "column/spindle2", "column/vise",
      "spindle/vise", "spindle2/vise",
    ].sort());
  });

  it("drops bodies on unknown groups instead of crashing", () => {
    const m = buildCollisionModel(PLUNGE, [
      ...PLUNGE_BODIES,
      { id: "ghost", group: "nope", positions: boxPositions(4) },
    ]);
    expect(m.bodies).toHaveLength(2);
  });
});

describe("sweepCollisions", () => {
  it("flags a plunge into the work body with worst-per-line attribution", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    // Plunge to -43: head-box bottom (45+Z) meets vise top (+5) at Z=-40,
    // which falls BETWEEN samples (43/9 ≈ 4.78 mm steps) — the discovering
    // sample sits ~3 mm deep in penetration.
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43]], undefined, [7, 8]), WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(1);
    const h = r.hits[0]!;
    expect(h.line).toBe(8);
    expect(h.a).toBe("spindle");
    expect(h.b).toBe("vise");
    // Worst sample is the deepest: penetration → distance 0.
    expect(h.dist).toBeCloseTo(0, 5);
    expect(h.rapid).toBe(false);
    // Contact refinement: scrub-to-hit lands at FIRST TOUCH (cum 40), not
    // at the sample that discovered the penetration (cum ≈ 43).
    expect(h.cum).toBeCloseTo(40, 2);
  });

  it("marks contacts that happen during a rapid segment", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -45]], undefined, [7, 8], [0, 1]), WCS0, { margin: 2 });
    expect(r.hits[0]!.rapid).toBe(true);
  });

  it("skips kins-flip relabel segments — a phantom crossing reports nothing", () => {
    // Head down at Z=-40: crossing X -30→+30 drives the vise straight
    // through the tool. As a REAL segment that is a certain hit (control);
    // flagged brk=1 it is a frame relabel at a stationary pose — the sweep
    // must exclude it (and its width) entirely, then sweep the following
    // real retract normally.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const pts = [[-30, 0, -40], [30, 0, -40], [30, 0, 0]];
    const control = sweepCollisions(model, track(pts, undefined, [5, 1029, 8]),
                                    WCS0, { margin: 2 });
    expect(control.hits.length).toBeGreaterThan(0);
    const t = track(pts, undefined, [5, 1029, 8]);
    t.brk = new Uint8Array([0, 1, 0]);
    t.cum[1] = t.cum[0]!;                       // buildScrubTrack zeroes brk widths
    t.cum[2] = t.cum[1]! + 40;
    const r = sweepCollisions(model, t, WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(0);
  });

  it("stays silent on a clear traverse — with big advancement strides", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, track(
      [[-100, 0, 0], [100, 0, 0]]), WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(0);
    // Conservative advancement: distance-driven steps stride through clear
    // space — far fewer samples than the old fixed 5 mm grid (200/5 = 40).
    expect(r.samples).toBeGreaterThan(1);
    expect(r.samples).toBeLessThan(30);
  });

  it("applies the live WCS offset to the pose", () => {
    // Same plunge program, but g5x lifts Z by +40 → machine never gets close.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -45]]), { g5x: [0, 0, 40, 0, 0, 0], g92: [], rotationDeg: 0 }, { margin: 2 });
    expect(r.hits).toHaveLength(0);
  });

  it("coarsens to the sample budget without dropping the hit", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -45]]), WCS0, { margin: 2, maxSamples: 4 });
    expect(r.coarsened).toBe(true);
    expect(r.samples).toBeLessThanOrEqual(6);
    expect(r.hits.length).toBeGreaterThan(0);  // contact window is wide enough
  });

  it("catches a mid-sweep rotary collision both endpoints miss", () => {
    // Pillar at platter radius 20 sweeps C 0→180°; a static tool body sits at
    // (0, 20). Only the C≈90° subdivision samples see the clash.
    const rotary: CollisionMachine = {
      groups: [
        { id: "platter", parent: "root" },
        { id: "work", parent: "platter" },
        { id: "spindle", parent: "root", translate: [0, 20, 0] },
      ],
      kinematics: [{ group: "platter", joint: 0, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "work",
      toolGroup: "spindle",
      unitScale: 1,
      axes: ["C"],
    };
    const bodies: CollisionBody[] = [
      { id: "pillar", group: "platter", positions: boxPositions(10), translate: [20, 0, 0] },
      { id: "tool", group: "spindle", positions: boxPositions(10) },
    ];
    const model = buildCollisionModel(rotary, bodies);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 180]], [3, 4]), WCS0, { margin: 1 });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.line).toBe(4);
    expect(r.hits[0]!.dist).toBeCloseTo(0, 5);  // full overlap at 90°
    // Worst-per-line keeps the FIRST deepest sample, so cum marks first
    // contact of the swing — before dead center (90°), after the clear start.
    expect(r.hits[0]!.cum).toBeGreaterThan(30);
    expect(r.hits[0]!.cum).toBeLessThan(90);
  });

  it("aborts early when asked", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -45]]), WCS0, { margin: 2 }, undefined, () => true);
    expect(r.samples).toBe(1);  // only the baseline pose before the first segment
    expect(r.truncated).toBeNull();   // an abort is the caller's decision, not a budget
  });

  // A 40-segment plunge (1 mm each, clear of the work): long enough to pass
  // the every-16-segments checkpoint where the budgets are checked.
  const plunge40 = () => track(Array.from({ length: 41 }, (_, i) => [0, 0, 60 - i]));

  it("stops at the wall-clock budget and says how much it swept — never a silent 'clear'", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, plunge40(), WCS0, { margin: 2, maxMs: 0 });
    expect(r.truncated).not.toBeNull();
    expect(r.truncated!.reason).toBe("time");
    expect(r.truncated!.covered).toBeGreaterThan(0);
    expect(r.truncated!.covered).toBeLessThan(1);
    expect(r.hits).toHaveLength(0);
  });

  it("the budget runs on the caller's clock — a paused sweep spends none of it", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    // A clock that never advances: even a 1 ms budget is never exceeded.
    const frozen = sweepCollisions(model, plunge40(), WCS0, { margin: 2, maxMs: 1, clock: () => 0 });
    expect(frozen.truncated).toBeNull();
    expect(frozen.sweepMs).toBe(0);
    // A clock that jumps 100 ms per read: the 50 ms budget is over at the
    // first checkpoint that looks.
    let t = 0;
    const racing = sweepCollisions(model, plunge40(), WCS0, { margin: 2, maxMs: 50, clock: () => (t += 100) });
    expect(racing.truncated?.reason).toBe("time");
    expect(racing.truncated!.covered).toBeLessThan(1);
  });

  it("the hard sample backstop stops the sweep and says so instead of breaking out silently", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, plunge40(), WCS0, { margin: 2, maxSamples: 2 });
    expect(r.coarsened).toBe(true);
    expect(r.truncated).not.toBeNull();
    expect(r.truncated!.reason).toBe("samples");
    expect(r.truncated!.covered).toBeLessThan(1);
    expect(r.samples).toBeLessThanOrEqual(10);
  });

  it("a completed sweep carries no truncation claim", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, plunge40(), WCS0, { margin: 2, maxMs: 60_000 });
    expect(r.truncated).toBeNull();
  });

  it("the iterator yields progress checkpoints and returns the sync sweep's result", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const t = track([[0, 0, 0], [0, 0, -45]]);
    const sync = sweepCollisions(model, t, WCS0, { margin: 2 });
    const it = sweepCollisionsIter(model, t, WCS0, { margin: 2 });
    const progress: number[] = [];
    let r = it.next();
    while (!r.done) { progress.push(r.value); r = it.next(); }
    expect(progress[0]).toBe(0);
    expect(progress[progress.length - 1]).toBe(1);
    expect(r.value.hits.map(h => [h.line, h.a, h.b, +h.cum.toFixed(3)]))
      .toEqual(sync.hits.map(h => [h.line, h.a, h.b, +h.cum.toFixed(3)]));
    expect(r.value.samples).toBe(sync.samples);
    expect(r.value.truncated).toBeNull();
  });

  it("stop/continue via the snapshot hook: every snapshot is a truncated sweep-so-far, continuing ends in the uninterrupted result", () => {
    // 2026-09-12: the worker parks a sweep (budget, operator stop, rotary
    // motion) by simply not resuming the generator, snapshots the sweep-so-
    // far through opts.snapshot, and resumes it later. The snapshots must
    // not disturb the suspended sweep: the final result equals the sync one.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const pts: number[][] = [];
    for (let z = 0; z >= -45; z -= 0.5) pts.push([0, 0, z]);   // 90 short segments → checkpoints every 16
    const t = track(pts);
    const sync = sweepCollisions(model, t, WCS0, { margin: 2 });
    expect(sync.hits.length).toBeGreaterThan(0);
    const snap: SnapshotHandle = { take: null };
    const it = sweepCollisionsIter(model, t, WCS0, { margin: 2, snapshot: snap });
    let r = it.next();
    expect(snap.take).not.toBeNull();       // installed before the first checkpoint
    const covered: number[] = [], hitCounts: number[] = [];
    while (!r.done) {
      const partial = snap.take!("stopped");   // taken while SUSPENDED at this checkpoint
      expect(partial.truncated?.reason).toBe("stopped");
      expect(partial.truncated!.covered).toBeGreaterThanOrEqual(covered[covered.length - 1] ?? 0);
      expect(partial.hits.length).toBeGreaterThanOrEqual(hitCounts[hitCounts.length - 1] ?? 0);
      for (const h of partial.hits) expect(sync.hits.some(x => x.line === h.line && x.a === h.a && x.b === h.b)).toBe(true);
      covered.push(partial.truncated!.covered); hitCounts.push(partial.hits.length);
      r = it.next();
    }
    expect(covered.length).toBeGreaterThan(3);
    expect(covered[0]).toBe(0);
    expect(hitCounts[hitCounts.length - 1]).toBe(sync.hits.length);   // the last snapshot already knew every hit
    const full = r.value as CollisionResult;
    expect(full.truncated).toBeNull();
    expect(full.hits.map(h => [h.line, h.a, h.b, +h.cum.toFixed(3), +h.cumEnd.toFixed(3)]))
      .toEqual(sync.hits.map(h => [h.line, h.a, h.b, +h.cum.toFixed(3), +h.cumEnd.toFixed(3)]));
    expect(full.samples).toBe(sync.samples);
    expect(snap.take).toBeNull();           // cleared when the generator returned
  });

  it("time-based checkpoints: an advancing clock yields between the count-based floors, a frozen clock keeps the floor", () => {
    // 2026-09-12: the worker parks/cancels only at a checkpoint, and 512
    // in-margin samples were seconds — the operator's ❚❚ looked ignored.
    // The count-based checkpoints stay as the floor (a fake clock that
    // never advances must still yield); `yieldMs` of clock time adds one.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const yieldsWith = (clock: () => number): number[] => {
      const it = sweepCollisionsIter(model, plunge40(), WCS0, { margin: 2, clock, yieldMs: 8 });
      const out: number[] = [];
      let r = it.next();
      while (!r.done) { out.push(r.value); r = it.next(); }
      return out;
    };
    const frozen = yieldsWith(() => 0);
    // start, segments 16 and 32, end — the floor for a 40-segment track
    expect(frozen).toHaveLength(4);
    let t = 0;
    const advancing = yieldsWith(() => (t += 5));   // 5 ms per read → a checkpoint every other segment
    expect(advancing.length).toBeGreaterThan(frozen.length * 3);
    for (let i = 1; i < advancing.length; i++) expect(advancing[i]).toBeGreaterThanOrEqual(advancing[i - 1]!);
    expect(advancing[0]).toBe(0);
    expect(advancing[advancing.length - 1]).toBe(1);
  });

  it("refinement memo: repeated snapshots at one checkpoint are identical, later snapshots never move a hit's extent backwards", () => {
    // 2026-09-12: every park snapshots by refining every record again —
    // records whose inputs have not changed reuse their refinement. The
    // memo must be invisible: a second take at the same checkpoint equals
    // the first, and a record that gained samples refines to an extent at
    // least as long as before.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const pts: number[][] = [];
    for (let z = 0; z >= -45; z -= 0.5) pts.push([0, 0, z]);
    const t = track(pts);
    const snap: SnapshotHandle = { take: null };
    const it = sweepCollisionsIter(model, t, WCS0, { margin: 2, snapshot: snap });
    let r = it.next();
    const ends = new Map<string, number>();
    let sawTwo = 0;
    while (!r.done) {
      const a = snap.take!("stopped"), b = snap.take!("stopped");
      expect(b.hits).toEqual(a.hits);   // the memo answers the second take
      for (const h of a.hits) {
        const k = `${h.line}/${h.a}/${h.b}`;
        const prev = ends.get(k);
        if (prev !== undefined) { expect(h.cumEnd).toBeGreaterThanOrEqual(prev - 1e-9); sawTwo++; }
        ends.set(k, h.cumEnd);
      }
      r = it.next();
    }
    expect(sawTwo).toBeGreaterThan(0);   // some record was snapshotted at two checkpoints
    const sync = sweepCollisions(model, t, WCS0, { margin: 2 });
    expect((r.value as CollisionResult).hits.map(h => [h.line, +h.cum.toFixed(3), +h.cumEnd.toFixed(3)]))
      .toEqual(sync.hits.map(h => [h.line, +h.cum.toFixed(3), +h.cumEnd.toFixed(3)]));
  });

  it("next(true) at a checkpoint aborts: baseline only, epilogue still returns a result", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const it = sweepCollisionsIter(model, track([[0, 0, 0], [0, 0, -45]]), WCS0, { margin: 2 });
    it.next();                       // to the first checkpoint (baseline posed)
    let r = it.next(true);           // abort there
    while (!r.done) r = it.next();   // the epilogue's final progress yield
    const res = r.value as CollisionResult;
    expect(res.samples).toBe(1);
    expect(res.truncated).toBeNull();
  });

  it("moves pairs in contact at the first pose to staticContacts instead of flooding lines", () => {
    // A table-mounted body overlapping the head box AT THE START pose plays
    // the role of a mechanical joint (slides/bearings sit inside the margin
    // permanently). Baseline subtraction must report it once and exclude it
    // from the sweep, while the genuine plunge hit still reports per-line.
    const withDrawbar: CollisionBody[] = [
      ...PLUNGE_BODIES,
      { id: "drawbar", group: "table", positions: boxPositions(10), translate: [0, 0, 50] },
    ];
    const model = buildCollisionModel(PLUNGE, withDrawbar);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -45]], undefined, [7, 8]), WCS0, { margin: 2 });
    expect(r.staticContacts.map(c => [c.a, c.b].sort().join("/"))).toContain("drawbar/spindle");
    // No per-line hits for the static pair …
    expect(r.hits.every(h => [h.a, h.b].sort().join("/") !== "drawbar/spindle")).toBe(true);
    // … while the genuine plunge hit is still attributed normally.
    expect(r.hits.some(h => [h.a, h.b].sort().join("/") === "spindle/vise")).toBe(true);
  });

  it("a TOOL body in contact at the first pose is an onset on the first line, never a static exclusion — and a later rapid through the same body still reports", () => {
    // 2026-09-12 (operator decision): the tool is no one's mechanical
    // neighbour. The excluded pair used to silence a program that starts on
    // the platter AND every later rapid through it — an excluded pair is
    // never queried again. Geometry: the tool box hangs 50 below the head,
    // i.e. inside the vise at the start pose.
    const bodies = (toolFlag: boolean): CollisionBody[] => [
      { id: "vise", group: "table", positions: boxPositions(10) },
      { id: "spindle", group: "head", positions: boxPositions(10) },
      { id: "tool", group: "head", positions: boxPositions(10), translate: [0, 0, -50], tool: toolFlag || undefined },
    ];
    // L7 feed X through the vise (in contact from the start), L8 feed Z up
    // and out of it, L9 RAPID back down into it.
    // (per-POINT arrays: segment i carries lines[i] / rapid[i])
    const prog = () => track([[0, 0, 0], [10, 0, 0], [10, 0, 30], [10, 0, 0]], undefined, [0, 7, 8, 9], [0, 0, 0, 1]);
    const r = sweepCollisions(buildCollisionModel(PLUNGE, bodies(true)), prog(), WCS0, { margin: 2 });
    expect(r.staticContacts).toEqual([]);
    const onsets = r.hits.filter(h => h.continuation === undefined && [h.a, h.b].sort().join("/") === "tool/vise");
    expect(onsets.map(h => [h.line, h.rapid])).toEqual([[7, false], [9, true]]);
    expect(onsets[0]!.cum).toBe(0);                       // in contact from the program's first point
    expect(onsets[0]!.spanEndLine).toBe(8);               // still touching while L8 retracts
    // The control: the same body WITHOUT the flag is a machine part — the
    // old rule: one static contact, and the L9 rapid plunge reports NOTHING.
    const c = sweepCollisions(buildCollisionModel(PLUNGE, bodies(false)), prog(), WCS0, { margin: 2 });
    expect(c.staticContacts.map(x => [x.a, x.b].sort().join("/"))).toEqual(["tool/vise"]);
    expect(c.hits.filter(h => [h.a, h.b].sort().join("/") === "tool/vise")).toEqual([]);
  });

  it("catches a graze narrower than the old fixed sample step", () => {
    // 1 mm head cube passes a 1 mm plate offset 1.0 mm laterally: the
    // below-margin window is ~2 mm of path — the old 5 mm grid (43/9 ≈
    // 4.78 mm samples at Z ≈ -38.2 and -43) straddled it and reported
    // clear. Conservative advancement must find it.
    const bodies: CollisionBody[] = [
      { id: "plate", group: "table", positions: boxPositions(1), translate: [2, 0, 10] },
      { id: "probe", group: "head", positions: boxPositions(1) },
    ];
    const model = buildCollisionModel(PLUNGE, bodies);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43]], undefined, [7, 8]), WCS0, { margin: 2 });
    const graze = r.hits.find(h => [h.a, h.b].sort().join("/") === "plate/probe");
    expect(graze).toBeTruthy();
    expect(graze!.dist).toBeLessThanOrEqual(2);
  });

  it("adversarial rotary lever: catches a narrow-angle clash at large radius", () => {
    // Pillar at radius 100 sweeping 180°; a small post sits on its circle.
    // The below-margin window is only ~2.3° — under the old fixed 4° rotary
    // step this could fall between samples. The lever-based bound must
    // shrink steps near the post regardless of the radius.
    const rotary: CollisionMachine = {
      groups: [
        { id: "platter", parent: "root" },
        { id: "work", parent: "platter" },
        { id: "frame", parent: "root" },
      ],
      kinematics: [{ group: "platter", joint: 0, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "work",
      toolGroup: "frame",
      unitScale: 1,
      axes: ["C"],
    };
    const bodies: CollisionBody[] = [
      { id: "pillar", group: "platter", positions: boxPositions(2), translate: [100, 0, 0] },
      { id: "post", group: "frame", positions: boxPositions(2), translate: [0, 100, 0] },
    ];
    const model = buildCollisionModel(rotary, bodies);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 180]], [3, 4]), WCS0, { margin: 1 });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.dist).toBeLessThanOrEqual(1);
    // First contact ≈ 90° minus the small angular half-width of the boxes.
    expect(r.hits[0]!.cum).toBeGreaterThan(85);
    expect(r.hits[0]!.cum).toBeLessThan(91);
  });

  it("cutting semantics: feed contact with an EXPLICIT stock body is machining; rapid onset is a gouge", () => {
    // Only a body flagged `stock` is cuttable — machine parts never are
    // (without stock, the tool may touch nothing). On a FEED into stock:
    // cutting — no report. On a RAPID whose onset enters contact: gouge,
    // reported. A retract rapid leaving feed-begun contact stays benign.
    const bodies: CollisionBody[] = [
      { id: "stock", group: "platter", positions: boxPositions(10), stock: true },
      { id: "spindle", group: "head", positions: boxPositions(10) },
    ];
    const model = buildCollisionModel(PLUNGE, bodies);
    // Feed plunge into the stock, feed retract: pure cutting.
    let r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43], [0, 0, 0]], undefined, [7, 8, 9], [0, 0, 0]), WCS0, { margin: 2 });
    expect(r.hits).toEqual([]);
    expect(r.staticContacts).toEqual([]);   // cutting pairs never go static
    // Same plunge as a RAPID: onset in rapid → gouge.
    r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43]], undefined, [7, 8], [0, 1]), WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.rapid).toBe(true);
    // Feed plunge, then RAPID retract out of contact: benign (onset was feed).
    r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43], [0, 0, 0]], undefined, [7, 8, 9], [0, 0, 1]), WCS0, { margin: 2 });
    expect(r.hits).toEqual([]);
  });

  it("detects collisions with root-attached static frame bodies", () => {
    // Ungrouped machine.json parts (column, base, spindle housing) map to
    // the implicit root node. A frame obstacle in the head's plunge path
    // must be hit — dropping these bodies blinded the sweep to frame
    // collisions the scrub visuals showed plainly.
    const withFrame: CollisionBody[] = [
      ...PLUNGE_BODIES,
      { id: "base_spindle", group: "root", positions: boxPositions(10), translate: [0, 0, 20] },
    ];
    const model = buildCollisionModel(PLUNGE, withFrame);
    // Frame body pairs with both movers (their DOFs sit below the LCA).
    const key = (p: [number, number]) => [model.bodies[p[0]]!.id, model.bodies[p[1]]!.id].sort().join("/");
    expect(model.pairs.map(key).sort()).toContain("base_spindle/spindle");
    // Head box [45+Z, 55+Z] reaches the obstacle top (z=25) at Z=-20.
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43]], undefined, [7, 8]), WCS0, { margin: 2 });
    const frameHit = r.hits.find(h => [h.a, h.b].sort().join("/") === "base_spindle/spindle");
    expect(frameHit).toBeTruthy();
    expect(frameHit!.cum).toBeCloseTo(20, 2);  // refined to first touch
  });

  it("catches a same-side pair that straddles a DOF (v1 scope gap closed)", () => {
    // Pillar on a C platter vs a post on the table it sits on: both "work"
    // side, C DOF between them. The sweep must flag the rotary clash.
    const machine: CollisionMachine = {
      groups: [
        { id: "table", parent: "root" },
        { id: "platter", parent: "table" },
        { id: "head", parent: "root", translate: [0, 0, 500] },  // far away
      ],
      kinematics: [
        { group: "table", joint: 0, type: "translate", direction: "x", sign: 1 },
        { group: "platter", joint: 1, type: "rotate", direction: "z", sign: 1 },
      ],
      workGroup: "platter",
      toolGroup: "head",
      unitScale: 1,
      axes: ["X", "C"],
    };
    const bodies: CollisionBody[] = [
      { id: "pillar", group: "platter", positions: boxPositions(10), translate: [20, 0, 0] },
      { id: "post", group: "table", positions: boxPositions(10), translate: [0, 20, 0] },
    ];
    const model = buildCollisionModel(machine, bodies);
    // C sweeps 0→180°: pillar swings from (20,0) through the post at (0,20).
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 180]], [3, 4]), WCS0, { margin: 1 });
    expect(r.hits).toHaveLength(1);
    expect([r.hits[0]!.a, r.hits[0]!.b].sort()).toEqual(["pillar", "post"]);
    expect(r.hits[0]!.line).toBe(4);
  });
});

describe("toolCylinderPositions", () => {
  it("builds a tip-at-origin +Z cylinder", () => {
    const pos = toolCylinderPositions(6, 60);
    let minZ = Infinity, maxZ = -Infinity, maxR = 0;
    for (let i = 0; i < pos.length; i += 3) {
      minZ = Math.min(minZ, pos[i + 2]!);
      maxZ = Math.max(maxZ, pos[i + 2]!);
      maxR = Math.max(maxR, Math.hypot(pos[i]!, pos[i + 1]!));
    }
    expect(minZ).toBeCloseTo(0, 5);
    expect(maxZ).toBeCloseTo(60, 5);
    expect(maxR).toBeCloseTo(3, 5);
  });
});

describe("contact-window refinement (glow window)", () => {
  // User-reported scenario 2026-08-16: a line that STARTS inside a
  // collision and separates mid-line — the glow window [cum, cumEnd]
  // must end at the separation point, not run to the line's end.
  it("cumEnd lands at the separation point, not the line end", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    // Tool bottom = 45+Z, vise top = +5: touch at Z=-40, 5 deep at -45.
    // L25 plunges 0 -> -45; L26 retracts: separation (dist > eps) at
    // Z=-40, i.e. 5 units into the 45-unit line (cum 50 of 45..90).
    const t = track([[0, 0, 0], [0, 0, -45], [0, 0, 0]], undefined, [25, 25, 26]);
    const res = sweepCollisions(model, t, WCS0, { margin: 2 });
    const l26 = res.hits.find(h => h.line === 26 && h.dist < 1e-3)!;
    expect(l26).toBeDefined();
    expect(l26.cum).toBeLessThan(45.5);       // in contact from line start
    expect(l26.cumEnd).toBeGreaterThan(49);   // ends at separation (~50)...
    expect(l26.cumEnd).toBeLessThan(51);      // ...never the line end (90)
    // The line-26 record is a CONTINUATION of the line-25 onset (the pair
    // never separated between the lines); the onset spans through 26.
    expect(l26.continuation).toBe(25);
    const l25 = res.hits.find(h => h.line === 25 && h.dist < 1e-3)!;
    expect(l25.continuation).toBeUndefined();
    expect(l25.spanEndLine).toBe(26);
  });

  it("through-contact across lines: one onset spanning to the last in-contact line, continuations for the rest", () => {
    // L25 plunges into contact; L26/L27 traverse INSIDE it; L28 retracts.
    // Operator-caught: a beam rammed into the portal was re-reported on
    // every following line. One clash (the onset), three continuations.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const t = track(
      [[0, 0, 0], [0, 0, -45], [2, 0, -45], [4, 0, -45], [4, 0, 0]],
      undefined, [25, 25, 26, 27, 28]);
    const res = sweepCollisions(model, t, WCS0, { margin: 2 });
    const contact = res.hits.filter(h => h.dist < 1e-3);
    const onsets = contact.filter(h => h.continuation === undefined);
    expect(onsets).toHaveLength(1);
    expect(onsets[0]!.line).toBe(25);
    expect(onsets[0]!.spanEndLine).toBe(28);
    const conts = contact.filter(h => h.continuation !== undefined);
    expect(conts.map(h => h.line).sort()).toEqual([26, 27, 28]);
    expect(conts.every(h => h.continuation === 25)).toBe(true);
  });

  it("verified separation (>2×margin) then re-entry two lines later yields two onset records", () => {
    // L25 plunge (contact), L26 retract to clear, L27 lateral clear,
    // L28 plunge again — the second touch is a NEW clash.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const t = track(
      [[0, 0, 0], [0, 0, -45], [0, 0, 0], [5, 0, 0], [5, 0, -45]],
      undefined, [25, 25, 26, 27, 28]);
    const res = sweepCollisions(model, t, WCS0, { margin: 2 });
    const onsets = res.hits.filter(h => h.dist < 1e-3 && h.continuation === undefined).map(h => h.line);
    expect(onsets.sort()).toEqual([25, 28]);
    const l26 = res.hits.find(h => h.line === 26 && h.dist < 1e-3)!;
    expect(l26.continuation).toBe(25);
  });

  it("intermittent contact on ONE line yields separate refined intervals", () => {
    // The user's line-26 shape: enter contact, leave it, re-enter — all on
    // one source line. One [cum, cumEnd] window would glow across the
    // verified-clear middle; intervals must split it.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    // Touch at Z=-40. L26: -45 (in contact) -> -10 (clear) -> -45 (back in)
    // -> 0 (clear). Line cums: 45..80..115..160; contact ends ~50,
    // resumes ~110, ends ~120.
    const t = track(
      [[0, 0, 0], [0, 0, -45], [0, 0, -10], [0, 0, -45], [0, 0, 0]],
      undefined, [25, 25, 26, 26, 26]);
    const res = sweepCollisions(model, t, WCS0, { margin: 2 });
    const l26 = res.hits.find(h => h.line === 26 && h.dist < 1e-3)!;
    expect(l26).toBeDefined();
    expect(l26.intervals).toHaveLength(2);
    const [a, b] = l26.intervals!;
    expect(a![0]).toBeLessThan(45.5);      // in contact from line start
    expect(a![1]).toBeGreaterThan(49);     // separates at Z=-40 (cum 50)
    expect(a![1]).toBeLessThan(51);
    expect(b![0]).toBeGreaterThan(109);    // re-touches at Z=-40 (cum 110)
    expect(b![0]).toBeLessThan(111);
    expect(b![1]).toBeGreaterThan(119);    // separates again (cum 120)
    expect(b![1]).toBeLessThan(121);
    // compat fields span the whole contact story
    expect(l26.cum).toBe(a![0]);
    expect(l26.cumEnd).toBe(b![1]);
  });

  it("cumEnd lands at separation under world kins (TCP line-26 shape)", () => {
    // XYZAC world segments at fixed world (20,0,-45): jx = 20*cos(C), so
    // the table slides -20 -> +20 as C returns 180 -> 0. Vise rides the
    // table at +20: penetrating at C=180, separating near C=120.
    const M5: CollisionMachine = {
      groups: [{ id: "table", parent: "root" }, { id: "platter", parent: "table" },
               { id: "head", parent: "root", translate: [0, 0, 50] }],
      kinematics: [{ group: "table", joint: 0, type: "translate", direction: "x", sign: 1 },
                   { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 }],
      workGroup: "platter", toolGroup: "head", unitScale: 1,
      axes: ["X", "Y", "Z", "A", "C"],
      kins: { type: "xyzac-trt", identityFirst: true },  // raw type 1 = world
    };
    const B5: CollisionBody[] = [
      { id: "vise", group: "table", positions: boxPositions(10), translate: [20, 0, 0] },
      { id: "spindle", group: "head", positions: boxPositions(10) },
    ];
    const model = buildCollisionModel(M5, B5);
    // p0 clear (C=0, vise at +40) -> L25 sweeps INTO contact (C 0->180)
    // -> L26 returns C 180->0, separating at C~120 (60 of its 180 cum).
    const t = track(
      [[20, 0, -45], [20, 0, -45], [20, 0, -45]],
      [[0, 0, 0], [0, 0, 180], [0, 0, 0]],
      [25, 25, 26]);
    t.mode = new Uint8Array([1, 1, 1]);
    const res = sweepCollisions(model, t, WCS0, { margin: 2 });
    const l26 = res.hits.find(h => h.line === 26 && h.dist < 1e-3)!;
    expect(l26).toBeDefined();
    expect(l26.continuation).toBe(25);   // carried in from the line-25 sweep
    // L26 spans cum 180..360; contact ends near C=120 -> cum ~240.
    expect(l26.cum).toBeLessThan(185);
    expect(l26.cumEnd).toBeGreaterThan(230);
    expect(l26.cumEnd).toBeLessThan(250);
  });
});

describe("world-kins conservative advancement (sagitta slack)", () => {
  // The review's miss class: a C sweep symmetric about the joint-X
  // extremum. The pair's DOF path is {X} only, so chunk-endpoint joint
  // deltas give V = 0 (jx(±10°) are equal) and no rotary-lever budget
  // applies (C is not on the pair's path) — the pre-fix certificate
  // spanned the whole chunk from a clear starting distance while jx
  // bulged R·(1−cos 10°) ≈ 4.6 into the wall mid-chunk. The sagitta
  // slack seeds V for world-driven linear joints and forces mid-chunk
  // queries.
  const CSWEEP: CollisionMachine = {
    groups: [
      { id: "frame", parent: "root" },
      { id: "xslide", parent: "root" },
    ],
    kinematics: [{ group: "xslide", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "frame",
    toolGroup: "xslide",
    unitScale: 1,
    axes: ["X", "Y", "Z", "A", "C"],
    kins: { type: "xyzac-trt", identityFirst: true, params: {} },  // raw type 1 = world
  };
  const wallBodies = (wallX: number): CollisionBody[] => {
    const wall = boxPositions(10);
    for (let i = 0; i < wall.length; i += 3) wall[i] = wall[i]! + wallX;
    return [
      { id: "wall", group: "frame", positions: wall },
      { id: "mover", group: "xslide", positions: boxPositions(10) },
    ];
  };
  // World X=300 fixed while C sweeps −10°→+10° (one 20° chunk): under
  // xyzac-trt with pivots at origin, jx = 300·cos C — endpoints equal
  // (295.44), peak 300 exactly mid-chunk.
  const sweep = {
    ...track([[300, 0, 0], [300, 0, 0]], [[0, 0, -10], [0, 0, 10]]),
    mode: new Uint8Array([1, 1]),
  };

  it("catches the mid-chunk pivot bulge endpoint deltas cannot see", () => {
    // Wall near face at 303.44: endpoint gap 3.0 (clear of margin 2),
    // peak overlap 1.56 — with V = 0 a certificate from the endpoint
    // distance skips the whole chunk and misses the crossing.
    const model = buildCollisionModel(CSWEEP, wallBodies(308.44));
    const r = sweepCollisions(model, sweep, WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(1);
    expect([r.hits[0]!.a, r.hits[0]!.b].sort()).toEqual(["mover", "wall"]);
  });

  it("adds no false positive when the bulge stays clear", () => {
    // Wall 10 further out: peak gap 8.4 — slack may only shrink steps,
    // never manufacture hits.
    const model = buildCollisionModel(CSWEEP, wallBodies(318.44));
    const r = sweepCollisions(model, sweep, WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(0);
  });
});

describe("trsrn (TWP) conservative advancement", () => {
  // Same miss class as the trt case above, on the family whose bound the
  // sweep could not previously compute AT ALL: it read the trt-only
  // KinsParams, which a trsrn spec does not carry, so the rotary radius
  // collapsed from ~2 m to the distance from the machine origin.
  //
  // The pair's DOF path is {Z} only, so no rotary-lever budget applies (A is
  // not on the path), and the A sweep is centred on the Z joint's extremum so
  // the endpoint deltas are exactly zero. Under trsrn mode 1 at the machine
  // origin the Z joint is 2000·cos A − 1000·sin A − 2000, i.e. a cosine of
  // amplitude 2236 about A = −26.5651°. Over ±10° about that centre both ends
  // read 202.0971 while the middle reaches 236.0680 — a 33.97 excursion that
  // only jointBulge can see.
  const A_MID = -26.5651, A_HALF = 10;
  const J_END = 202.0971, J_MID = 236.0680;

  const TSWEEP: CollisionMachine = {
    groups: [
      { id: "frame", parent: "root" },
      { id: "zslide", parent: "root" },
    ],
    kinematics: [{ group: "zslide", joint: 2, type: "translate", direction: "z", sign: 1 }],
    workGroup: "frame",
    toolGroup: "zslide",
    unitScale: 1,
    axes: ["X", "Y", "Z", "A", "B", "C"],
    // The upstream TWP machine's INI geometry; raw type 1 = TCP.
    kins: {
      type: "xyzacb-trsrn", identityFirst: false,
      trsrn: { yPivot: 50, zPivot: 120, xOffset: 0, yOffset: 0,
               yRotAxis: -1000, zRotAxis: -2000, nutAngle: 55 },
    },
  };
  const wallBodies = (wallZ: number): CollisionBody[] => {
    const wall = boxPositions(10);
    for (let i = 2; i < wall.length; i += 3) wall[i] = wall[i]! + wallZ;
    return [
      { id: "wall", group: "frame", positions: wall },
      { id: "mover", group: "zslide", positions: boxPositions(10) },
    ];
  };
  // World XYZ pinned at the machine origin while A sweeps 20° — one chunk.
  const sweep = {
    ...track([[0, 0, 0], [0, 0, 0]],
             [[A_MID - A_HALF, 0, 0], [A_MID + A_HALF, 0, 0]]),
    mode: new Uint8Array([1, 1]),
  };

  it("catches the mid-chunk excursion the endpoint deltas cannot see", () => {
    // Wall near face at J_END + 10 + 3: endpoint gap 3.0 (clear of margin 2),
    // mid-chunk overlap ~31. With a zero bulge the pair's V is 0, one
    // certificate from the endpoint distance spans the whole chunk, and the
    // crossing is missed entirely.
    const model = buildCollisionModel(TSWEEP, wallBodies(J_END + 13));
    const r = sweepCollisions(model, sweep, WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(1);
    expect([r.hits[0]!.a, r.hits[0]!.b].sort()).toEqual(["mover", "wall"]);
    expect(r.uncertified).toBeNull();
  });

  it("adds no false positive when the excursion stays clear", () => {
    // Wall 12 beyond the peak: the bulge may only shrink steps, never invent
    // a hit. This is the half of the pair that a merely-larger bound passes
    // trivially — it is here so an over-conservative bound is visible too.
    const model = buildCollisionModel(TSWEEP, wallBodies(J_MID + 22));
    const r = sweepCollisions(model, sweep, WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(0);
  });

  it("reports a declared kins it cannot evaluate instead of posing identity", () => {
    // kinsForSegment falls back to trivkins for an unknown family. That
    // model's bulge is legitimately 0, which would be silently wrong here —
    // so the sweep must SAY the guarantee does not hold rather than return a
    // clean-looking result.
    // identityFirst so raw type 1 reads as non-identity under the trt
    // convention worldModeForSpec applies to families it does not know.
    const unknown: CollisionMachine = {
      ...TSWEEP, kins: { type: "xyzsomething-new", identityFirst: true },
    };
    const model = buildCollisionModel(unknown, wallBodies(J_END + 13));
    const r = sweepCollisions(model, sweep, WCS0, { margin: 2 });
    expect(r.uncertified).toMatch(/trivkins/);
    expect(r.uncertified).toMatch(/xyzsomething-new/);
  });
});

describe("per-epoch WCS terms (review P2)", () => {
  it("poses each segment through ITS epoch's terms", () => {
    // A plunge that misses under the live wcs (z 0) but whose epoch basis
    // sits 30 low — with epochTerms + track.wcs the sweep must see the deep
    // contact (start pose stays clear of the baseline pass); without them
    // it must stay silent.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const t = { ...track([[0, 0, 0], [0, 0, -13]], undefined, [7, 8]),
                wcs: new Uint8Array([0, 0]) };
    const epochTerms = [{ ox: 0, oy: 0, oz: -30, oa: 0, ob: 0, oc: 0, tx: 0, ty: 0, tz: 0, cth: 1, sth: 0 }];
    const hit = sweepCollisions(model, t, WCS0, { margin: 2, epochTerms });
    expect(hit.hits.length).toBeGreaterThan(0);
    const miss = sweepCollisions(model, t, WCS0, { margin: 2 });
    expect(miss.hits).toHaveLength(0);
  });
});

describe("per-segment tool offset (schema 8)", () => {
  // The parametric tool body (tip at its local origin) under the PLUNGE
  // head: with a live TLO the swept joints are tip + TLO, so the body must
  // be shifted back per pose or the tip floats a tool length above the path.
  const TOOL_BODIES: CollisionBody[] = [
    { id: "vise", group: "table", positions: boxPositions(10) },
    { id: "tool", group: "head", positions: toolCylinderPositions(6, 20) },
  ];
  // Tool tip at head origin z=50+Z, work box top at +5 → contact at Z=−45.
  const plunge = track([[0, 0, 0], [0, 0, -50]], undefined, [1, 2]);

  it("the tip lands on the path under a live TLO — same first touch as without", () => {
    const m = buildCollisionModel(PLUNGE, TOOL_BODIES);
    const r0 = sweepCollisions(m, plunge, WCS0, { margin: 0.5 });
    const r22 = sweepCollisions(m, plunge, { ...WCS0, tool: [0, 0, 22] }, { margin: 0.5 });
    expect(r0.hits.length).toBe(1);
    expect(r22.hits.length).toBe(1);
    expect(r22.hits[0]!.cum).toBeCloseTo(r0.hits[0]!.cum, 1);
    expect(r0.hits[0]!.cum).toBeCloseTo(45, 0.5);
  });

  it("a mid-track event changes the housing height but not the tip", () => {
    // Spindle housing box (bottom at 40+Z) + tool body; plunge twice: line 2
    // under the live offset (0) contacts the vise at Z=−35 (housing) and
    // the tool tip at −45; line 4 under the program's G43 (22) lifts the
    // HOUSING 22 higher (contact at −57 — beyond the −40 plunge) while the
    // tool tip still lands at −45. So line 4 reports the tool, not the housing.
    const bodies: CollisionBody[] = [...PLUNGE_BODIES, TOOL_BODIES[1]!];
    const m = buildCollisionModel(PLUNGE, bodies);
    const t = track([[0, 0, 0], [0, 0, -48], [0, 0, 0], [0, 0, -48]], undefined, [1, 2, 3, 4]);
    t.tlo = new Uint8Array([0xff, 0xff, 0, 0]);
    t.tloEvents = [{ seq: 0, xyz: [0, 0, 22], tool: 3 }];
    const r = sweepCollisions(m, t, WCS0, { margin: 0.5, tloEvents: t.tloEvents });
    const pairsOn = (line: number) => r.hits.filter(h => h.line === line).map(h => h.a).sort();
    expect(pairsOn(2)).toEqual(["spindle", "tool"]);
    expect(pairsOn(4)).toEqual(["tool"]);
  });
});

describe("per-segment tool dims (schema 8)", () => {
  // A pillar the FAT tool (Ø30) hits and the THIN one (Ø6) clears: the
  // track passes the pillar twice — under T1 (thin, live) and, after an
  // M6 row, under T2 (fat). Only the fat pass reports.
  const PILLAR: CollisionBody[] = [
    // pillar top at +5 (box centred at origin), offset 12 in X on the table
    { id: "pillar", group: "table", positions: boxPositions(10), translate: [12, 0, 0] },
    { id: "tool", group: "head", positions: toolCylinderPositions(6, 20) },
  ];
  it("swaps the tool body to the segment's tool", () => {
    const m = buildCollisionModel(PLUNGE, PILLAR);
    // Tip at head origin z=50+Z: plunge at X=0 to Z=−45 → tip at +5 (pillar
    // top height) but 12 mm off in X: thin tool (r 3) clears, fat (r 15) hits.
    const t = track([[0, 0, 0], [0, 0, -45], [0, 0, 0], [0, 0, -45]], undefined, [1, 2, 3, 4]);
    // The event governs the segment ENDING at vertex 3 (line 4) only — the
    // retract (line 3) still runs under the thin tool.
    t.tlo = new Uint8Array([0xff, 0xff, 0xff, 0]);
    t.tloEvents = [{ seq: 0, xyz: [0, 0, 0], tool: 2 }];
    const r = sweepCollisions(m, t, WCS0, {
      margin: 0.5, tloEvents: t.tloEvents, liveTool: 1,
      toolDims: { 1: { diam: 6, len: 20 }, 2: { diam: 30, len: 20 } },
    });
    const lines = [...new Set(r.hits.map(h => h.line))].sort();
    expect(lines).toEqual([4]);
    // Without dims the base (thin) body is used throughout: nothing reports.
    const r2 = sweepCollisions(m, t, WCS0, { margin: 0.5, tloEvents: t.tloEvents, liveTool: 1 });
    expect(r2.hits).toEqual([]);
  });
});

describe("mergeContiguousIntervals", () => {
  it("windows meeting at one boundary are one contact (the sample-gap split)", () => {
    expect(mergeContiguousIntervals([[45, 50], [50, 60]])).toEqual([[45, 60]]);
    expect(mergeContiguousIntervals([[45, 50.001], [50.0025, 60]])).toEqual([[45, 60]]);
  });
  it("keeps a verified separation apart", () => {
    expect(mergeContiguousIntervals([[45, 50], [110, 120]])).toEqual([[45, 50], [110, 120]]);
    expect(mergeContiguousIntervals([[45, 50], [50.01, 60]])).toHaveLength(2);
  });
  it("chains and never mutates its input", () => {
    const input: Array<[number, number]> = [[0, 1], [1, 2], [2, 3], [10, 11]];
    expect(mergeContiguousIntervals(input)).toEqual([[0, 3], [10, 11]]);
    expect(input).toEqual([[0, 1], [1, 2], [2, 3], [10, 11]]);
    expect(mergeContiguousIntervals([])).toEqual([]);
  });
});

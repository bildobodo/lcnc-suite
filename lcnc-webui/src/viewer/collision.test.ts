// Unit tests for viewer/collision.ts — synthetic machines with box bodies.
import * as THREE from "three";
import { emptyLineIndex } from "./lineIndex";
import { describe, expect, it } from "vitest";
import {
  buildCollisionModel, sweepCollisions, withoutArealessFacets, poseModel, pairDistance, sweepCollisionsIter, toolCylinderPositions, restoreBaseTool, type SnapshotHandle,
  type CollisionBody, type CollisionMachine, type CollisionResult, type CollisionOptions, type CollisionHit, mergeContiguousIntervals, componentBoxes } from "./collision";
import type { ScrubTrack } from "../ws/bulkData";
import { buildScrubTrack } from "./scrubTrack";
import { TLO_NONE } from "./tloEvents";
import { runSweepSlice } from "./sweepPump";
import { clashTargets } from "./clashTargets";

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

  it("progress and covered are fractions of the TRACK axis, not of the sweep's distance parameter", () => {
    // 2026-09-12: the scrub bar draws the swept section on its timeline,
    // whose axis is TIME on a time-based track. A track whose cum runs at
    // double pace over its second half: the count-based checkpoints at
    // segments 16 and 32 must yield cum[15]/cumMax and cum[31]/cumMax — the
    // distance fractions would be 15/40 and 31/40.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const t = plunge40();
    for (let i = 21; i < t.count; i++) t.cum[i] = t.cum[20]! + 2 * (i - 20);
    const cumMax = t.cum[t.count - 1]!;   // 60
    const it = sweepCollisionsIter(model, t, WCS0, { margin: 2, clock: () => 0 });
    const progress: number[] = [];
    let r = it.next();
    while (!r.done) { progress.push(r.value); r = it.next(); }
    expect(progress).toHaveLength(4);   // start, segments 16 and 32, end (frozen clock = the floor)
    expect(progress[1]).toBeCloseTo(t.cum[15]! / cumMax, 6);   // 0.25, not 0.375
    expect(progress[2]).toBeCloseTo(t.cum[31]! / cumMax, 6);   // 0.7, not 0.775
    expect(progress[3]).toBe(1);
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
    const snap: SnapshotHandle = { take: null, peek: null, records: null };
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
    const snap: SnapshotHandle = { take: null, peek: null, records: null };
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

  it("peek: the unrefined sweep-so-far at any checkpoint — hits ⊆ the final, record count monotonic, the suspended sweep undisturbed", () => {
    // 2026-09-13: the worker streams these while sweeping so clashes show on
    // the timeline as they are found; no refinement, no mesh probes.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const pts: number[][] = [];
    for (let z = 0; z >= -45; z -= 0.5) pts.push([0, 0, z]);
    const t = track(pts);
    const sync = sweepCollisions(model, t, WCS0, { margin: 2 });
    const snap: SnapshotHandle = { take: null, peek: null, records: null };
    const it = sweepCollisionsIter(model, t, WCS0, { margin: 2, snapshot: snap });
    let r = it.next();
    expect(snap.peek).not.toBeNull();
    let lastRecords = 0, peeks = 0;
    while (!r.done) {
      const recs = snap.records!();
      expect(recs).toBeGreaterThanOrEqual(lastRecords);
      lastRecords = recs;
      const p = snap.peek!();
      peeks++;
      expect(p.truncated?.reason).toBe("running");
      for (const h of p.hits) expect(sync.hits.some(x => x.line === h.line && x.a === h.a && x.b === h.b)).toBe(true);
      r = it.next();
    }
    expect(peeks).toBeGreaterThan(3);
    const full = r.value as CollisionResult;
    expect(full.hits.map(h => [h.line, +h.cum.toFixed(3), +h.cumEnd.toFixed(3)]))
      .toEqual(sync.hits.map(h => [h.line, +h.cum.toFixed(3), +h.cumEnd.toFixed(3)]));
    expect(snap.peek).toBeNull();
    expect(snap.records).toBeNull();
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

  it("a machine pair touching at the program's first pose but CLEAR at the model's rest pose is a crash from the start, not a static contact", () => {
    // 2026-09-12 (operator-caught: the entry rapid drove the portal into the
    // X slide; the base sweep filed the pair as static and never looked at
    // it again). Rest pose = every joint at zero. The beam sits at z 5..15 on
    // the table; the head box is at 45..55 at Z=0 (clear) and at 5..15 when
    // the program starts at Z −40 (touching).
    const bodies: CollisionBody[] = [
      { id: "vise", group: "table", positions: boxPositions(10) },
      { id: "spindle", group: "head", positions: boxPositions(10) },
      { id: "beam", group: "table", positions: boxPositions(10), translate: [0, 0, 10] },
    ];
    const model = buildCollisionModel(PLUNGE, bodies);
    // L1 feed X through the beam (in contact from the start), L2 feed Z up
    // and out of it, L3 RAPID back down into it. (per-point arrays)
    const r = sweepCollisions(model, track(
      [[0, 0, -40], [10, 0, -40], [10, 0, 0], [10, 0, -40]], undefined, [0, 1, 2, 3], [0, 0, 0, 1]), WCS0, { margin: 2 });
    expect(r.staticContacts.map(c => [c.a, c.b].sort().join("/"))).not.toContain("beam/spindle");
    const beam = r.hits.filter(h => [h.a, h.b].sort().join("/") === "beam/spindle");
    const onsets = beam.filter(h => h.continuation === undefined);
    expect(onsets.map(h => [h.line, h.rapid])).toEqual([[1, false], [3, true]]);
    expect(onsets[0]!.cum).toBe(0);
    expect(onsets[0]!.spanEndLine).toBe(2);
    // The span end: the contact persists into L2 (rising out of the beam),
    // so the onset carries where it finally ends — past its own line's end
    // (L1 ends at cum 10) and before L2's end (cum 50).
    expect(onsets[0]!.spanCumEnd).toBeGreaterThan(onsets[0]!.cumEnd);
    expect(onsets[0]!.spanCumEnd!).toBeGreaterThan(10);
    expect(onsets[0]!.spanCumEnd!).toBeLessThan(50);
    expect(onsets[1]!.spanCumEnd).toBeUndefined();   // the L3 re-entry ends on its own line
    // Control: the SAME pair touching at rest too (the beam raised to the
    // head's rest height) is a mechanical neighbour — static, never a hit.
    const raised: CollisionBody[] = [bodies[0]!, bodies[1]!, { ...bodies[2]!, translate: [0, 0, 50] }];
    const c = sweepCollisions(buildCollisionModel(PLUNGE, raised), track(
      [[0, 0, 0], [10, 0, 0]], undefined, [0, 1], [0, 0]), WCS0, { margin: 2 });
    expect(c.staticContacts.map(x => [x.a, x.b].sort().join("/"))).toEqual(["beam/spindle"]);
    expect(c.hits.filter(h => [h.a, h.b].sort().join("/") === "beam/spindle")).toEqual([]);
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
      { id: "spindle", group: "head", positions: boxPositions(10), tool: true },
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

  it("only the cutter cuts: another tool-side body feeding into the stock is a crash", () => {
    // The same feed plunge with the head's box NOT the cutter (a spindle
    // housing, a ram): every tool-side body used to count as cutting, and a
    // ram driven into the work piece on a feed was never reported
    // (2026-10-07, the oracle hunt on the TWP gantry).
    const model = buildCollisionModel(PLUNGE, [
      { id: "stock", group: "platter", positions: boxPositions(10), stock: true },
      { id: "housing", group: "head", positions: boxPositions(10) },
    ]);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43], [0, 0, 0]], undefined, [7, 8, 9], [0, 0, 0]), WCS0, { margin: 2 });
    const onset = r.hits.find(h => h.dist <= 1e-4 && h.continuation === undefined);
    expect(onset, "the feed into the stock is reported").toBeDefined();
    expect([onset!.a, onset!.b].sort()).toEqual(["housing", "stock"]);
    expect(onset!.rapid).toBe(false);
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
    // L26 carried L25's contact in: its first interval is L25's finding, the
    // re-entry its own — two findings, not three (Codex R34 VP-I09)
    expect(l26.continuation).toBeUndefined();
    expect(l26.carried).toBe(true);
    const targets = clashTargets(res.hits);
    expect(targets.map(x => [x.line, x.key])).toEqual([[25, "C25|spindle|vise|0"], [26, "C26|spindle|vise|1"]]);
    expect(targets[1]!.cum).toBe(b![0]);
    expect(targets[1]!.reentry).toBe(true);
    // …and L25's contact reaches through the carried interval
    const l25 = res.hits.find(h => h.line === 25 && h.dist < 1e-3)!;
    expect(l25.spanEndLine).toBe(26);
    expect(l25.spanCumEnd).toBe(a![1]);
  });

  it("a program that starts in contact, separates and comes back on the same line: two intervals, two findings (Codex R34 VP-I09)", () => {
    // Touch at Z=-40. L26 starts at -45 (in contact at the first point),
    // rises to -10 (clear from cum 5), comes back down to -45 (contact again
    // from cum 65) — L27 lifts out (clear from cum 75).
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const t = track([[0, 0, -45], [0, 0, -10], [0, 0, -45], [0, 0, 0]], undefined, [26, 26, 26, 27]);
    const res = sweepCollisions(model, t, WCS0, { margin: 2 });
    const l26 = res.hits.find(h => h.line === 26 && h.dist < 1e-3)!;
    expect(l26.cum).toBe(0);
    expect(l26.carried).toBeUndefined();   // the program's own onset
    expect(l26.intervals).toHaveLength(2);
    const [a, b] = l26.intervals!;
    expect(a![0]).toBe(0);
    expect(a![1]).toBeGreaterThan(4);
    expect(a![1]).toBeLessThan(6);
    expect(b![0]).toBeGreaterThan(64);
    expect(b![0]).toBeLessThan(66);
    const targets = clashTargets(res.hits);
    expect(targets.map(x => x.key)).toEqual(["C26|spindle|vise|0", "C26|spindle|vise|1"]);
    expect(res.hits.find(h => h.line === 27 && h.dist < 1e-3)!.continuation).toBe(26);
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

describe("a world kins' speed, not its chord deviation (Codex R101 VP-I57)", () => {
  // XYZAC under TCP, program X1000 held while C sweeps: the X joint is
  // 1000·cos C — equal at both ends of a sweep symmetric about C 0, so the
  // endpoint delta is 0 and only the curvature prices the motion. A 1 mm cube
  // starts at the centre of a 20 mm box, leaves it as X grows and comes back
  // as C sweeps on: two contacts, analytically. The budget |Δj| + bulge
  // (the chord deviation) priced a quarter of the speed — the inside answer
  // ran to 10° and the return was never seen.
  const M: CollisionMachine = {
    groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root" }],
    kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z", "A", "C"],
    kins: { type: "xyzac-trt", identityFirst: true, params: {} },
  };
  const sweepC = (half: number) => {
    const x0 = 1000 * Math.cos(half * Math.PI / 180);
    const model = buildCollisionModel(M, [
      { id: "outer", group: "table", positions: boxPositions(20), translate: [x0, 0, 0] },
      { id: "inner", group: "head", positions: boxPositions(1) },
    ]);
    const t: ScrubTrack = {
      pos: new Float32Array([1000, 0, 0, 1000, 0, 0]), abc: new Float32Array([0, 0, -half, 0, 0, half]),
      cum: new Float32Array([0, 2 * half]), lines: new Uint32Array([1, 2]), rapid: new Uint8Array(2),
      mode: new Uint8Array([1, 1]), count: 2, lineIndex: emptyLineIndex(), timeBased: false,
    };
    const r = sweepCollisions(model, t, WCS0, { margin: 0.1 });
    const exit = half - Math.acos((x0 + 10.5) / 1000) * 180 / Math.PI;
    return { r, exit, end: 2 * half };
  };
  const ivs = (r: CollisionResult) => r.hits.flatMap(h => h.intervals ?? []).map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]);

  it("one chunk (C ±11.25°): out of the box at the analytic exit, back in at its mirror", () => {
    const { r, exit, end } = sweepC(11.25);
    expect(r.uncertified).toBeNull();
    expect(ivs(r)).toEqual([[0, +exit.toFixed(2)], [+(end - exit).toFixed(2), end]]);
  });

  it("short lines into the box: the surface budget is used up across their boundaries", () => {
    // From C 30 to 45 in 0.2° lines (each its own chunk): the cube enters
    // the box through a 0.08° touch near C 44.14 and stays wholly inside to
    // the end. Each line ends sampled, but a pair whose distance was measured
    // in an earlier line has spent part of it since: unspent, the pair would
    // read "no crossing possible" at the next line and the inside stretch
    // would stay unseen.
    const x0 = 1000 * Math.cos(Math.PI / 4);
    const model = buildCollisionModel(M, [
      { id: "outer", group: "table", positions: boxPositions(20), translate: [x0, 0, 0] },
      { id: "inner", group: "head", positions: boxPositions(1) },
    ]);
    const cs = Array.from({ length: 76 }, (_, i) => 30 + i * 0.2);
    const n = cs.length;
    const t: ScrubTrack = {
      pos: new Float32Array(cs.flatMap(() => [1000, 0, 0])), abc: new Float32Array(cs.flatMap(c => [0, 0, c])),
      cum: Float32Array.from(cs, c => c - 30), lines: Uint32Array.from(cs, (_, i) => i + 1), rapid: new Uint8Array(n),
      mode: new Uint8Array(n).fill(1), count: n, lineIndex: emptyLineIndex(), timeBased: false,
    };
    const r = sweepCollisions(model, t, WCS0, { margin: 0.1 });
    const entry = Math.acos((x0 + 10.5) / 1000) * 180 / Math.PI - 30;
    const all = r.hits.flatMap(h => h.intervals ?? []);
    expect(Math.min(...all.map(iv => iv[0]))).toBeCloseTo(entry, 1);
    expect(Math.max(...all.map(iv => iv[1]))).toBeCloseTo(15, 2);
  });

  it("four chunks (C ±45°): the budget carried across the chunk boundaries finds the return too", () => {
    const { r, exit, end } = sweepC(45);
    expect(r.uncertified).toBeNull();
    expect(ivs(r)).toEqual([[0, +exit.toFixed(2)], [+(end - exit).toFixed(2), end]]);
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
                wcs: new Uint32Array([0, 0]) };
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
    t.tlo = new Uint32Array([TLO_NONE, TLO_NONE, 0, 0]);
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
    t.tlo = new Uint32Array([TLO_NONE, TLO_NONE, TLO_NONE, 0]);
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

describe("whole-program reach prescreen (2026-09-13)", () => {
  // PLUNGE plus a frame post the head and the table can never reach: both
  // of its pairs are dropped before the sweep; the plunge hit is unchanged.
  it("drops pairs that can provably never come within the margin and keeps the hit", () => {
    const machine = { ...PLUNGE, groups: [...PLUNGE.groups, { id: "frame", parent: "root" }] };
    const bodies: CollisionBody[] = [
      ...PLUNGE_BODIES,
      { id: "far_post", group: "frame", positions: boxPositions(10), translate: [500, 500, 0] },
    ];
    const model = buildCollisionModel(machine, bodies);
    expect(model.pairs).toHaveLength(3);
    const r = sweepCollisions(model, track([[0, 0, 0], [0, 0, -40]]), WCS0, { margin: 2 });
    expect(r.pairCount).toBe(3);
    expect(r.pairsPrescreened).toBe(2);
    expect(r.hits.map(h => `${h.a}/${h.b}`)).toEqual(["spindle/vise"]);
  });

  // The adversarial lever machine: pillar at radius 100 swinging 180°, a post
  // on its circle at 90° — far at BOTH track vertices, met only mid-arc.
  // The rotary range bound (the chord over the whole arc) keeps the pair;
  // the sweep then finds the clash exactly as before.
  const ROTARY: CollisionMachine = {
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
  const pillarAnd = (post: number[]): CollisionBody[] => [
    { id: "pillar", group: "platter", positions: boxPositions(2), translate: [100, 0, 0] },
    { id: "post", group: "frame", positions: boxPositions(2), translate: post },
  ];
  const arc = track([[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 180]], [3, 4]);

  it("keeps a pair that only meets mid-arc of a rotary sweep (both endpoints far)", () => {
    const r = sweepCollisions(buildCollisionModel(ROTARY, pillarAnd([0, 100, 0])), arc, WCS0, { margin: 1 });
    expect(r.pairsPrescreened).toBe(0);
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.cum).toBeGreaterThan(85);
    expect(r.hits[0]!.cum).toBeLessThan(91);
  });

  it("drops a rotary pair whose whole arc stays clear", () => {
    // The post sits 300 out; the pillar's chord bound over 180° is its full
    // orbit diameter (2ρ = 200) — still 100 short of the post, minus box radii.
    const r = sweepCollisions(buildCollisionModel(ROTARY, pillarAnd([0, 300, 0])), arc, WCS0, { margin: 1 });
    expect(r.pairsPrescreened).toBe(1);
    expect(r.hits).toHaveLength(0);
    expect(r.staticContacts).toHaveLength(0);
  });

  it("a pair reached only at one end of a linear range is kept", () => {
    // The vise rides the X table; a frame post 60 mm out in X is reached only
    // at the last vertex — the translation range must count in full.
    const machine = { ...PLUNGE, groups: [...PLUNGE.groups, { id: "frame", parent: "root" }] };
    const bodies: CollisionBody[] = [
      ...PLUNGE_BODIES,
      { id: "post", group: "frame", positions: boxPositions(10), translate: [60, 0, 0] },
    ];
    const r = sweepCollisions(buildCollisionModel(machine, bodies),
      track([[0, 0, 0], [30, 0, 0], [60, 0, 0]]), WCS0, { margin: 2 });
    expect(r.hits.map(h => `${h.a}/${h.b}`)).toContain("vise/post");
    // vise/post kept (the X range reaches the post at its far end); the
    // spindle never descends in this track, so BOTH its pairs are dropped.
    expect(r.pairsPrescreened).toBe(2);
    expect(r.pairCount).toBe(3);
  });
});

describe("component boxes + query lower bound (2026-09-13)", () => {
  it("componentBoxes: one AABB per connected component, whole-mesh box past the cap", () => {
    const a = boxPositions(2);                       // centred at the origin
    const b = new Float32Array(boxPositions(2));
    for (let i = 0; i < b.length; i += 3) b[i] = b[i]! + 100;   // a second, disjoint box at x=100
    const two = new Float32Array([...a, ...b]);
    const boxes = componentBoxes(two);
    expect(boxes.length).toBe(12);
    const sorted = [boxes.subarray(0, 6), boxes.subarray(6, 12)].sort((u, v) => u[0]! - v[0]!);
    expect([...sorted[0]!]).toEqual([-1, -1, -1, 1, 1, 1]);
    expect([...sorted[1]!]).toEqual([99, -1, -1, 101, 1, 1]);
    // A soup of unshared triangles (each translated apart) collapses to one box.
    const soup = new Float32Array(9 * 300);
    for (let t = 0; t < 300; t++) { soup.set([t * 10, 0, 0, t * 10 + 1, 0, 0, t * 10, 1, 0], t * 9); }
    expect(componentBoxes(soup).length).toBe(6);
  });

  it("a rotated body's box bound never hides a real contact (corner-transformed AABB contains it)", () => {
    // A box rotated 45° about Z presents a CORNER to the vise; the table
    // carries the vise toward it, from 5 mm clear (also clear at the rest
    // pose — so no static exclusion) to 1.5 mm. Its axis-aligned bounds in
    // the vise's frame contain the rotated box, so the bound never exceeds
    // the true distance — the exact query runs and the contact is found.
    // The same body unrotated, ending 3.5 mm away, must stay clear.
    const machine = { ...PLUNGE, groups: [...PLUNGE.groups, { id: "frame", parent: "root" }] };
    const near = (rot: number[] | undefined, dx: number): CollisionBody[] => [
      ...PLUNGE_BODIES,
      { id: "post", group: "frame", positions: boxPositions(10), translate: [dx, 0, 0], rotate: rot },
    ];
    // vise half-size 5 → its +x face at x=5+X. Rotated post: the corner
    // reaches 5·√2 ≈ 7.07 toward −x from its centre.
    const hit = sweepCollisions(buildCollisionModel(machine, near([0, 0, Math.PI / 4], 5 + 7.07 + 5)),
      track([[0, 0, 0], [3.5, 0, 0]]), WCS0, { margin: 2 });
    expect(hit.hits.map(h => `${h.a}/${h.b}`)).toContain("vise/post");
    expect(hit.staticContacts).toHaveLength(0);
    const clear = sweepCollisions(buildCollisionModel(machine, near(undefined, 5 + 5 + 5)),
      track([[0, 0, 0], [1.5, 0, 0]]), WCS0, { margin: 2 });
    expect(clear.hits.filter(h => h.b === "post" || h.a === "post")).toHaveLength(0);
  });

  it("query order does not change the answer: swapping the bodies' declaration order gives the same hits", () => {
    const fwd = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const rev = buildCollisionModel(PLUNGE, [...PLUNGE_BODIES].reverse());
    const t = track([[0, 0, 0], [0, 0, -40]]);
    const a = sweepCollisions(fwd, t, WCS0, { margin: 2 }), b = sweepCollisions(rev, t, WCS0, { margin: 2 });
    expect(a.hits.map(h => [h.line, h.cum.toFixed(3), h.dist.toFixed(6)])).toEqual(b.hits.map(h => [h.line, h.cum.toFixed(3), h.dist.toFixed(6)]));
  });
});

describe("clearance across a break (R-03, implementation review 2026-09-15)", () => {
  // The review's fixture: a tool on an X-driven head and a fixed vise, with
  // an UNKNOWN-START gap in the middle of the approach. `brk` carries both a
  // stationary relabel and an unknown start (scrubTrack ORs `ustart` in), and
  // the gap segment is zero-width — so clearance measured before it used to
  // survive it and the sweep strode past real contact after it.
  const M: CollisionMachine = {
    groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root" }],
    kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
  };
  const makeModel = (extra: CollisionBody[] = []) => buildCollisionModel(M, [
    { id: "vise", group: "table", positions: boxPositions(2), translate: [0, 0, 1] },
    { id: "tool", group: "head", positions: toolCylinderPositions(2, 2), tool: true },
    ...extra,
  ]);
  const xs = (points: number[], brk?: number[]): ScrubTrack => {
    const base = track(points.map(x => [x, 0, 0]), undefined, undefined, points.map(() => 1));
    return brk ? { ...base, brk: new Uint8Array(brk) } : base;
  };
  const pairsOf = (r: CollisionResult) =>
    [...new Set(r.hits.map(h => [h.a, h.b].sort().join("|")))].sort();

  it("does not carry clearance across an unknown-start gap", () => {
    // Exactly the review's probe, through the REAL stream merger: the
    // unknown-start flag becomes brk on the way to the worker.
    const points = [20, 19, 5, 0];
    const merged = buildScrubTrack({ pos: new Float32Array() }, {
      pos: new Float32Array(points.flatMap(x => [x, 0, 0])),
      abc: new Float32Array(points.length * 3),
      lines: new Uint32Array(points.map((_, i) => i + 1)),
      seq: new Uint32Array(points.map((_, i) => i + 1)),
      ustart: new Uint8Array([0, 0, 1, 0]),
    })!;
    expect([...merged.brk!]).toEqual([0, 0, 1, 0]);
    const combined = sweepCollisions(makeModel(), merged, WCS0, { margin: 0.1 });
    // The known motion after the gap, swept on its own, is the ground truth.
    const suffix = sweepCollisions(makeModel(), xs([5, 0]), WCS0, { margin: 0.1 });
    expect(suffix.hits.length).toBe(1);
    expect(combined.hits.length).toBe(suffix.hits.length);
    expect(pairsOf(combined)).toEqual(pairsOf(suffix));
  });

  it("finds a same-tool re-entry after a gap", () => {
    // In contact, out of contact, unknown gap, back into contact: the second
    // approach is its own onset and must be reported.
    const tr = xs([0, 10, 9, 0], [0, 0, 1, 0]);
    const r = sweepCollisions(makeModel(), tr, WCS0, { margin: 0.1 });
    const onsets = r.hits.filter(h => h.continuation === undefined);
    expect(onsets.length).toBeGreaterThanOrEqual(1);
    // The approach AFTER the gap (the last segment, line 4) is found.
    expect(r.hits.some(h => h.line === 4)).toBe(true);
  });

  it("invalidates non-tool pairs too", () => {
    // A shroud on the head (z 8..10) and a wide post on the table (z 5..11,
    // half-width 3) touch at |X| <= 4, well clear of the tool (z 0..2),
    // which reaches the vise only at |X| <= 2 — so this suffix exercises the
    // NON-tool pair alone. The old invalidation covered tool
    // pairs only; after unknown motion the whole machine may have moved.
    const extra: CollisionBody[] = [
      { id: "shroud", group: "head", positions: boxPositions(2), translate: [0, 0, 9] },
      { id: "post", group: "table", positions: boxPositions(6), translate: [0, 0, 8] },
    ];
    const combined = sweepCollisions(makeModel(extra), xs([20, 19, 5, 3], [0, 0, 1, 0]), WCS0, { margin: 0.1 });
    const suffix = sweepCollisions(makeModel(extra), xs([5, 3]), WCS0, { margin: 0.1 });
    expect(pairsOf(suffix)).toEqual(["post|shroud"]);
    expect(pairsOf(combined)).toEqual(pairsOf(suffix));
  });

  it("reports the same findings with and without a relabel break", () => {
    // A relabel is a stationary re-expression: invalidating there is
    // conservative (one extra query), never a change of findings.
    const withBrk = sweepCollisions(makeModel(), xs([20, 10, 10, 0], [0, 0, 1, 0]), WCS0, { margin: 0.1 });
    const without = sweepCollisions(makeModel(), xs([20, 10, 10, 0]), WCS0, { margin: 0.1 });
    expect(pairsOf(withBrk)).toEqual(pairsOf(without));
    expect(withBrk.hits.length).toBe(without.hits.length);
  });
});

describe("the move after a G43 or a tool change (operator 2026-10-07, haus.ngc L18)", () => {
  // A G43 moves nothing: the parse puts a relabel vertex where the machine
  // stands and records the move after it as a real one — swept along its
  // path. A move whose start no parse can know (a tool change the controller
  // moves at) stays an unknown start: checked at its end, and SAID.
  const M: CollisionMachine = {
    groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root" }],
    kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
  };
  const model = () => buildCollisionModel(M, [
    { id: "vise", group: "table", positions: boxPositions(2), translate: [0, 0, 1] },
    { id: "tool", group: "head", positions: toolCylinderPositions(2, 2), tool: true },
  ]);
  const rapids = (xs: number[], lines: number[], flags: { brk?: number[]; ustart?: number[] }) =>
    buildScrubTrack({ pos: new Float32Array() }, {
      pos: new Float32Array(xs.flatMap(x => [x, 0, 0])),
      abc: new Float32Array(xs.length * 3),
      lines: new Uint32Array(lines),
      seq: new Uint32Array(xs.map((_, i) => i + 1)),
      ...(flags.brk ? { brk: new Uint8Array(flags.brk) } : {}),
      ...(flags.ustart ? { ustart: new Uint8Array(flags.ustart) } : {}),
    })!;

  it("sweeps the move after a relabel along its path", () => {
    // L1 the first point, L3 `G43 … G0 X-20`: the relabel vertex where the
    // head stands (X20), then the move through the vise.
    const r = sweepCollisions(model(), rapids([20, 20, -20], [1, 3, 3], { brk: [0, 1, 0] }), WCS0, { margin: 0.1 });
    expect(r.hits.some(h => h.line === 3 && [h.a, h.b].sort().join("|") === "tool|vise")).toBe(true);
    expect(r.uncertified).toBeNull();
  });

  it("says which moves start unknown — not checked", () => {
    // The same move as an unknown start (what every G43 used to be): the
    // path into X-20 is not swept and X-20 itself is clear — so nothing is
    // found, and the result must not read as certified.
    const r = sweepCollisions(model(), rapids([20, -20], [1, 3], { ustart: [1, 1] }), WCS0, { margin: 0.1 });
    expect(r.hits).toHaveLength(0);
    expect(r.uncertified).toBe("1 move after a tool change runs from a position the preview cannot know — not checked until the position is known again (L3)");
    // the program's own first point is the entry move's, never counted
    const first = sweepCollisions(model(), rapids([20, 30], [1, 3], { ustart: [1, 0] }), WCS0, { margin: 0.1 });
    expect(first.uncertified).toBeNull();
  });
});

describe("tool geometry lifetime (TWP-06/07, review 2026-09-14)", () => {
  // The review probes' fixture: a tool on an X-driven head approaches a
  // fixed vise (cube 2 at z 0..2) from X 20 to X 5; the tool cylinder
  // (tip at the head origin, +Z) is swapped per segment. Ø20 touches the
  // vise at X ≈ 11; Ø2 never reaches it (X 5 > 2).
  const M: CollisionMachine = {
    groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root" }],
    kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
  };
  const makeModel = () => buildCollisionModel(M, [
    { id: "vise", group: "table", positions: boxPositions(2), translate: [0, 0, 1] },
    { id: "tool", group: "head", positions: toolCylinderPositions(2, 2), tool: true },
  ]);
  const approach = (n: number): ScrubTrack & { tlo: Uint32Array } => {
    const pts = Array.from({ length: n }, (_, i) => [20 - 15 * i / (n - 1), 0, 0]);
    const t = track(pts, undefined, undefined, pts.map(() => 1));
    return { ...t, tlo: new Uint32Array(n) };
  };
  type TloEvents = NonNullable<CollisionOptions["tloEvents"]>;
  const DIMS = { 1: { diam: 20, len: 2 }, 2: { diam: 2, len: 2 } };
  const EVENTS: TloEvents = [{ seq: 0, xyz: [0, 0, 0], tool: 2 }, { seq: 1, xyz: [0, 0, 0], tool: 1 }];
  const opts = (extra: Partial<CollisionOptions> = {}): CollisionOptions =>
    ({ margin: 0.1, tloEvents: EVENTS, toolDims: DIMS, liveTool: 2, ...extra });
  const finish = (it: ReturnType<typeof sweepCollisionsIter>): CollisionResult => {
    let r = it.next(); while (!r.done) r = it.next(); return r.value;
  };
  const onsets = (r: CollisionResult) => r.hits.filter(h => h.continuation === undefined).length;
  const contactLines = (r: CollisionResult) => [...new Set(r.hits.map(h => h.line))].sort((a, b) => a - b);
  // A clock that always says "yieldMs elapsed": checkpoints at every
  // segment and every SAMPLES_PER_CLOCK samples.
  const eagerClock = () => { let t = 0; return () => (t += 1000); };

  it("a small→large tool change mid-approach finds the later contact (TWP-06)", () => {
    const t = approach(40); t.tlo.fill(1, 5);          // Ø20 from vertex 5 on
    const changed = sweepCollisions(makeModel(), t, WCS0, opts());
    const large = approach(40); large.tlo.fill(1);     // Ø20 throughout
    const expected = sweepCollisions(makeModel(), large, WCS0, opts());
    expect(onsets(expected)).toBe(1);
    expect(onsets(changed)).toBe(1);
    expect(contactLines(changed)).toEqual(contactLines(expected));
    expect(changed.hits[0]!.b).toBe("vise");
  });

  it("a tool-offset change mid-approach invalidates the carried clearance, both directions (TWP-06)", () => {
    // TLO 50 lifts the Ø20 body 50 below the vise: a clearance of ~48
    // carried past the G43 change hid the contact after the offset went
    // back to 0 (and the reverse: a contact found under TLO 0 must END at
    // a change to 50, never be carried).
    const ev: TloEvents = [{ seq: 0, xyz: [0, 0, 50], tool: 1 }, { seq: 1, xyz: [0, 0, 0], tool: 1 }];
    const t = approach(40); t.tlo.fill(1, 5);          // TLO 50 → 0 at vertex 5
    const r = sweepCollisions(makeModel(), t, WCS0, opts({ tloEvents: ev }));
    expect(onsets(r)).toBe(1);
    const back = approach(40); back.tlo.fill(0, 30);   // TLO 0 → 50 at vertex 30 (in contact by then)
    back.tlo.fill(1, 0, 30);
    const r2 = sweepCollisions(makeModel(), back, WCS0, opts({ tloEvents: ev }));
    expect(onsets(r2)).toBe(1);
    expect(Math.max(...contactLines(r2))).toBeLessThanOrEqual(31);   // contact ends at the lift
    // No change at all: no contact under TLO 50.
    const lifted = approach(40);
    expect(sweepCollisions(makeModel(), lifted, WCS0, opts({ tloEvents: ev })).hits).toEqual([]);
  });

  it("interleaving a side run at the initial checkpoint leaves the main run's findings unchanged (TWP-07)", () => {
    const large = approach(2); large.tlo.fill(1);
    const standalone = sweepCollisions(makeModel(), large, WCS0, opts());
    const shared = makeModel();
    const main = sweepCollisionsIter(shared, large, WCS0, opts());
    main.next();                                        // parked at the initial yield, Ø20 installed
    const side = sweepCollisionsIter(shared, approach(2), WCS0, opts());   // Ø2 (live tool)
    side.next();                                        // its baseline re-installed Ø2 on the shared body
    const mixed = finish(main);
    finish(side);
    expect(mixed.hits.length).toBe(standalone.hits.length);
    expect(mixed.hits.length).toBe(1);
  });

  it("interleaving a side run at ANY checkpoint of the main run leaves its findings unchanged (TWP-07)", () => {
    const large = approach(40); large.tlo.fill(1);
    const standalone = sweepCollisions(makeModel(), large, WCS0, opts());
    let total = 0;
    { const it = sweepCollisionsIter(makeModel(), large, WCS0, opts({ yieldMs: 0, clock: eagerClock() }));
      let r = it.next(); while (!r.done) { total++; r = it.next(); } }
    expect(total).toBeGreaterThan(3);                   // segment + in-segment checkpoints exist
    for (let k = 1; k <= total; k++) {
      const shared = makeModel();
      const main = sweepCollisionsIter(shared, large, WCS0, opts({ yieldMs: 0, clock: eagerClock() }));
      for (let i = 0; i < k; i++) main.next();
      finish(sweepCollisionsIter(shared, approach(2), WCS0, opts()));   // poses + re-tools the shared model
      const m = finish(main);
      expect(contactLines(m), `interleaved at checkpoint ${k}`).toEqual(contactLines(standalone));
    }
  });

  it("after interleaved runs the model wears its base tool and a fallback sweep matches a fresh model (TWP-07)", () => {
    const shared = makeModel();
    const original = shared.bodies[shared.toolBodyIdx]!.geom;
    expect(shared.baseTool!.geom).toBe(original);
    const large = approach(2); large.tlo.fill(1);
    const main = sweepCollisionsIter(shared, large, WCS0, opts()); main.next();
    const side = sweepCollisionsIter(shared, approach(2), WCS0, opts()); side.next();
    finish(main); finish(side);
    expect(shared.bodies[shared.toolBodyIdx]!.geom).toBe(original);
    // The response's counterexample: a subsequent sweep with the fallback
    // (base) tool and no events must agree with a fresh model — 0 hits.
    const fallback = sweepCollisions(shared, approach(2), WCS0, { margin: 0.1 }).hits.length;
    expect(fallback).toBe(sweepCollisions(makeModel(), approach(2), WCS0, { margin: 0.1 }).hits.length);
    expect(fallback).toBe(0);
  });

  it("restoreBaseTool puts the base cylinder back on a model a dropped run left mid-sweep (TWP-07)", () => {
    const shared = makeModel();
    const original = shared.bodies[shared.toolBodyIdx]!.geom;
    const large = approach(40); large.tlo.fill(1);
    const it = sweepCollisionsIter(shared, large, WCS0, opts({ yieldMs: 0, clock: eagerClock() }));
    it.next(); it.next(); it.next();                    // parked mid-sweep wearing Ø20
    expect(shared.bodies[shared.toolBodyIdx]!.geom).not.toBe(original);
    expect(restoreBaseTool(shared)).toBe(true);
    expect(shared.bodies[shared.toolBodyIdx]!.geom).toBe(original);
    expect(restoreBaseTool(shared)).toBe(false);        // idempotent
    // A run that completes restores it by itself.
    finish(sweepCollisionsIter(shared, large, WCS0, opts()));
    expect(shared.bodies[shared.toolBodyIdx]!.geom).toBe(original);
  });

  it("agrees with a reference sweep that starts fresh at every tool/TLO boundary (TWP-06)", () => {
    // 30 points X 20 → 5: the tool alternates Ø2/Ø20 every 5 vertices and
    // the tool offset toggles 0/30 every 7 — boundaries of both kinds, some
    // inside the contact zone (X ≤ 11).
    const n = 30;
    const t = approach(n);
    const events: TloEvents = [];
    const idxOf = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const tool = Math.floor(i / 5) % 2 ? 1 : 2;
      const z = Math.floor(i / 7) % 2 ? 30 : 0;
      const key = `${tool}/${z}`;
      if (!idxOf.has(key)) { idxOf.set(key, events.length); events.push({ seq: events.length, xyz: [0, 0, z], tool }); }
      t.tlo[i] = idxOf.get(key)!;
    }
    const full = sweepCollisions(makeModel(), t, WCS0, opts({ tloEvents: events }));
    const ref = new Set<string>();
    for (let i = 1; i < n; i++) {
      // Every segment alone, under its own tool/TLO: no certificate can
      // carry across a boundary here by construction.
      const seg = track([[t.pos[3 * (i - 1)]!, 0, 0], [t.pos[3 * i]!, 0, 0]], undefined, [i, i + 1], [1, 1]);
      seg.tlo = new Uint32Array([t.tlo[i]!, t.tlo[i]!]);
      for (const h of sweepCollisions(makeModel(), seg, WCS0, opts({ tloEvents: events })).hits) {
        ref.add(`${i + 1}/${h.a}/${h.b}`);
      }
    }
    expect(ref.size).toBeGreaterThan(0);
    const got = new Set(full.hits.map(h => `${h.line}/${h.a}/${h.b}`));
    expect([...got].sort()).toEqual([...ref].sort());
  });
});

describe("initialization checkpoints (TWP-11, review 2026-09-14)", () => {
  // 20 k points along X, far from any contact: the prescreen's joint-range
  // scan is the dominant pre-sweep cost and must yield on the way.
  const big = (n: number) => track(Array.from({ length: n }, (_, i) => [i * 0.01, 0, 0]));
  const TOOLED: CollisionBody[] = [
    { id: "vise", group: "table", positions: boxPositions(10) },
    { id: "tool", group: "head", positions: toolCylinderPositions(6, 20), tool: true },
  ];

  it("yields checkpoints during the prescreen, before the baseline, on a large track", () => {
    const it = sweepCollisionsIter(buildCollisionModel(PLUNGE, PLUNGE_BODIES), big(20000), WCS0, { margin: 2 });
    let zeros = 0;
    let r = it.next();
    while (!r.done && r.value === 0) { zeros++; r = it.next(); }
    // 4 in the joint-range scan (every 4096 of 20 k) + the pre-segment one.
    expect(zeros).toBeGreaterThanOrEqual(5);
    while (!r.done) r = it.next();
    expect(r.value.hits).toEqual([]);
    expect(r.value.truncated).toBeNull();
  });

  // R-04 (implementation review 2026-09-15): the per-vertex passes that run
  // BEFORE the prescreen — the distance parameterization and the kins-model
  // selection — used to finish first, so on a million-point TWP track the
  // first checkpoint was ~400 ms away. A TWP track (mode 2 + frames) is the
  // case that matters: its model selection is the expensive one.
  const twpTrack = (n: number, frames: number): ScrubTrack => {
    const base = track(Array.from({ length: n }, (_, i) => [i * 0.01, 0, 0]));
    const frame = new Uint32Array(n);
    for (let i = 0; i < n; i++) frame[i] = Math.floor(i / Math.ceil(n / frames));
    return { ...base, mode: new Uint8Array(n).fill(2), frame,
             frames: Array.from({ length: frames }, (_, k) => [k, k, k] as [number, number, number]) };
  };
  const TRSRN: CollisionMachine = { ...PLUNGE, axes: ["X", "Y", "Z", "A", "B", "C"],
    kins: { type: "xyzacb-trsrn", identityFirst: false,
            trsrn: { yPivot: 50, zPivot: 120, xOffset: 0, yOffset: 0,
                     yRotAxis: -1000, zRotAxis: -2000, nutAngle: 55 } } };

  it("checkpoints the per-vertex passes that run before the prescreen", () => {
    // Counting reads of the TWP frame table shows how much work the sweep
    // does before its FIRST checkpoint: per-vertex model selection reads it
    // once per vertex, so a first checkpoint that lands after that pass has
    // already read all 200 k. The fix yields long before, and resolves a
    // model per (type, frame, TLO) context rather than per vertex.
    const n = 200_000;
    const tr = twpTrack(n, 4);
    let frameReads = 0;
    tr.frames = new Proxy(tr.frames!, {
      get(target, prop, recv) {
        if (typeof prop === "string" && /^\d+$/.test(prop)) frameReads++;
        return Reflect.get(target, prop, recv);
      },
    });
    const it = sweepCollisionsIter(buildCollisionModel(TRSRN, PLUNGE_BODIES), tr, WCS0, { margin: 2 });
    const first = it.next();
    expect(first.done).toBe(false);
    expect(first.value).toBe(0);
    expect(frameReads).toBeLessThan(n / 10);
    // And the whole initialization keeps yielding on the way to the sweep.
    let zeros = 1, r = it.next();
    while (!r.done && r.value === 0) { zeros++; r = it.next(); }
    expect(zeros).toBeGreaterThanOrEqual(8);
    // Model selection never re-resolved a context it had already built.
    expect(frameReads).toBeLessThanOrEqual(64);
  });

  it("an abort during the per-vertex passes returns the stopped result", () => {
    const m = buildCollisionModel(TRSRN, TOOLED);
    const it = sweepCollisionsIter(m, twpTrack(200_000, 4), WCS0, { margin: 2 });
    expect(it.next().value).toBe(0);
    const r = it.next(true);
    expect(r.done).toBe(true);
    const res = r.value as CollisionResult;
    expect(res.samples).toBe(0);
    expect(res.hits).toEqual([]);
    expect(res.truncated).toEqual({ covered: 0, reason: "stopped" });
    expect(m.bodies[m.toolBodyIdx]!.geom).toBe(m.baseTool!.geom);
  });

  it("resolves one kins model per (type, frame, tool-offset) context", () => {
    // Same findings as a sweep that re-resolved per vertex — the caching is
    // an identity of contexts, not an approximation. A TWP track whose
    // frames alternate between two values must still see both models.
    const n = 4000;
    const base = track(Array.from({ length: n }, (_, i) => [i * 0.01, 0, 0]));
    const frame = new Uint32Array(n);
    for (let i = 0; i < n; i++) frame[i] = i % 2;          // alternating, worst case
    const alt: ScrubTrack = { ...base, mode: new Uint8Array(n).fill(2), frame,
      frames: [[0, 0, 0], [0, 30, 0]] as [number, number, number][] };
    const runs: ScrubTrack = { ...alt, frame: Uint32Array.from({ length: n }, (_, i) => (i < n / 2 ? 0 : 1)) };
    const a = sweepCollisions(buildCollisionModel(TRSRN, PLUNGE_BODIES), alt, WCS0, { margin: 2 });
    const b = sweepCollisions(buildCollisionModel(TRSRN, PLUNGE_BODIES), runs, WCS0, { margin: 2 });
    // Both complete and stay certified: the second frame's model was really
    // built, not carried over from the first.
    expect(a.uncertified).toBeNull();
    expect(b.uncertified).toBeNull();
    expect(a.samples).toBeGreaterThan(0);
    expect(b.samples).toBeGreaterThan(0);
  });

  it("an abort during the prescreen ends with an empty stopped result and the base tool installed", () => {
    const m = buildCollisionModel(PLUNGE, TOOLED);
    const it = sweepCollisionsIter(m, big(20000), WCS0, { margin: 2 });
    const first = it.next();
    expect(first.done).toBe(false);
    expect(first.value).toBe(0);
    const r = it.next(true);
    expect(r.done).toBe(true);
    const res = r.value as CollisionResult;
    expect(res.samples).toBe(0);
    expect(res.hits).toEqual([]);
    expect(res.truncated).toEqual({ covered: 0, reason: "stopped" });
    expect(m.bodies[m.toolBodyIdx]!.geom).toBe(m.baseTool!.geom);
    // Through the worker's driver: a cancel lands at the first checkpoint.
    const slice = runSweepSlice(sweepCollisionsIter(m, big(20000), WCS0, { margin: 2 }), 10_000, () => true);
    expect(slice.done).toBe(true);
    expect(slice.cancelled).toBe(true);
    expect(slice.checkpoints).toBeLessThanOrEqual(2);
  });
});


describe("a touch inside the margin (the oracle hunt, 2026-10-07)", () => {
  // A thin slide passes 1.5 mm from a wall — inside the 2 mm margin the
  // whole way — and runs 1 mm deep into a 1 mm bump on it: contact for
  // X 99.5…101.5. The sweep stepped a pair inside the margin by a fixed
  // EXPLORE (5) and the bump fell between two samples: "near miss, 1.5 mm
  // apart" for a real touch, the tint dark.
  const slab = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
    const p = new Float32Array(g.getAttribute("position").array as Float32Array);
    g.dispose();
    return p;
  };
  const join = (...a: Float32Array[]) => {
    const o = new Float32Array(a.reduce((s, x) => s + x.length, 0));
    let k = 0;
    for (const x of a) { o.set(x, k); k += x.length; }
    return o;
  };
  const SLIDE: CollisionMachine = {
    groups: [{ id: "frame", parent: "root" }, { id: "xslide", parent: "root" }],
    kinematics: [{ group: "xslide", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "frame", toolGroup: "xslide", unitScale: 1, axes: ["X", "Y", "Z"],
  };
  // Wall face at Y 6.5 from X 20 (clear of the slide at rest, X 0), the bump
  // X 100…101 down to Y 4; the slide is 1 wide in X, its top at Y 5.
  const model = () => buildCollisionModel(SLIDE, [
    { id: "wall", group: "frame", positions: join(slab(180, 10, 10, 110, 11.5, 0), slab(1, 2.5, 10, 100.5, 5.25, 0)) },
    { id: "slide", group: "xslide", positions: slab(1, 10, 10, 0, 0, 0) },
  ]);
  const touch = (r: CollisionResult, x0: number) => {
    expect(r.hits.filter(h => h.dist > 1e-4), "no near-miss record stands for the touch").toEqual([]);
    const h = r.hits.find(x => x.dist <= 1e-4)!;
    expect(h, "the touch is a contact").toBeDefined();
    expect(h.intervals!.map(([a, b]) => [a + x0, b + x0].map(v => +v.toFixed(3))), "where it touches").toEqual([[99.5, 101.5]]);
  };

  it("is a contact wherever the samples fall", () => {
    // Every phase of the old 5-unit cadence against the bump: 48 put the
    // samples at 98 and 103.
    for (const x0 of [48, 48.3, 48.6, 49, 49.5]) {
      const r = sweepCollisions(model(), track([[x0, 0, 0], [180, 0, 0]], undefined, [1, 2]), WCS0, { margin: 2 });
      touch(r, x0);
    }
  });

  it("a second touch inside a touching pair's stride is a contact too (Codex R86 VP-I45)", () => {
    // A second bump X 103.25…103.5 (contact 102.75…104, 0.5 clear at 102):
    // after the first touch the pair re-probed only every EXPLORE, and the
    // whole second contact fell inside that stride — no interval, at every
    // phase. The stretch since the last touch is re-sampled when the pair is
    // next found clear; an unchecked gap may merge the two, never read clear.
    const twoBumps = buildCollisionModel(SLIDE, [
      { id: "wall", group: "frame", positions: join(slab(180, 10, 10, 110, 11.5, 0), slab(1, 2.5, 10, 100.5, 5.25, 0), slab(0.25, 2.5, 10, 103.375, 5.25, 0)) },
      { id: "slide", group: "xslide", positions: slab(1, 10, 10, 0, 0, 0) },
    ]);
    for (const x0 of [48, 48.3, 48.6, 49, 49.5]) {
      const r = sweepCollisions(twoBumps, track([[x0, 0, 0], [180, 0, 0]], undefined, [1, 2]), WCS0, { margin: 2 });
      const ivs = r.hits.flatMap(h => (h.intervals ?? []).map(([a, b]) => [a + x0, b + x0] as [number, number]));
      for (const x of [99.6, 101.4, 102.8, 103.9]) {
        expect(ivs.some(([a, b]) => a <= x && x <= b), `start ${x0}: the touch at X ${x} lies in a contact interval — ${JSON.stringify(ivs)}`).toBe(true);
      }
      expect(Math.min(...ivs.map(iv => iv[0])), `start ${x0}: no contact before the first bump`).toBeGreaterThan(99.5 - 1e-3);
      expect(Math.max(...ivs.map(iv => iv[1])), `start ${x0}: no contact past the second`).toBeLessThan(104 + 1e-3);
    }
  });

  it("carries the clearance into a faster chunk in that chunk's speed", () => {
    // Line 7 first moves Y — which drives nothing the pair rides (V 0) —
    // with the slide 1.5 from the wall, then X into the bump. A certificate
    // carried as an absolute position from the still segment reached 5 past
    // the X segment's start (X 103): the bump lay inside it.
    const r = sweepCollisions(model(), track([[98, 0, 0], [98, 10, 0], [180, 10, 0]], undefined, [7, 7, 7]), WCS0, { margin: 2 });
    touch(r, 98 - 10);
  });
});

describe("re-sampling after a touch follows the contact state (Codex R87 VP-I45)", () => {
  // The re-sampling after a touch recorded only touches and ignored what
  // else it measured: a separation past 2 × margin in the stretch did not
  // end the old contact, so a cutting pair's rapid re-contact after its feed
  // contact was taken for the benign retract from it and never reported.
  const slab = (w: number, h: number, d: number, x: number, y: number) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(x, y, 0).toNonIndexed();
    const p = new Float32Array(g.getAttribute("position").array as Float32Array);
    g.dispose();
    return p;
  };
  const join = (...a: Float32Array[]) => {
    const o = new Float32Array(a.reduce((s, x) => s + x.length, 0));
    let k = 0;
    for (const x of a) { o.set(x, k); k += x.length; }
    return o;
  };
  const rapidOnLine3 = (r: CollisionResult) => r.hits.some(h => h.rapid && h.line === 3 && h.dist <= 1e-4);

  it("a rotary rapid re-contact after a feed contact and a real separation is a gouge", () => {
    // The cutter on a 1000 mm radius passes two stock blocks: feed A 5→10°
    // touches the first (machining), then clear by far more than 2 × margin,
    // the rapid 10→15° touches the second. With the second block at 13° the
    // next coarse sample (15°) is clear again (R87); at 14.5° and 15° it
    // TOUCHES again, and the separation before it was never looked at —
    // the rapid re-entry inherited the feed contact's benign origin (R88).
    const R = 1000, rad = Math.PI / 180;
    const ROT: CollisionMachine = {
      groups: [{ id: "frame", parent: "root" }, { id: "arm", parent: "root" }],
      kinematics: [{ group: "arm", joint: 3, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "frame", toolGroup: "arm", unitScale: 1, axes: ["X", "Y", "Z", "A"],
    };
    for (const second of [13, 14.5, 15, 15.5]) {
      const model = buildCollisionModel(ROT, [
        { id: "stock", group: "frame", stock: true, positions: join(
          slab(10, 10, 10, R * Math.cos(10 * rad), R * Math.sin(10 * rad)),
          slab(10, 10, 10, R * Math.cos(second * rad), R * Math.sin(second * rad))) },
        { id: "tool", group: "arm", tool: true, positions: slab(2, 20, 20, R, 0) },
      ]);
      const t: ScrubTrack = { ...track([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
        [[5, 0, 0], [10, 0, 0], [15, 0, 0], [20, 0, 0]], [1, 2, 3, 4], [0, 0, 1, 1]) };
      const r = sweepCollisions(model, t, WCS0, { margin: 2 });
      expect(r.hits.some(h => h.rapid && h.line >= 3 && h.dist <= 1e-4), `second block at ${second}°: the rapid gouge — ${JSON.stringify(r.hits.map(h => [h.line, h.rapid, h.dist]))}`).toBe(true);
    }
  });

  it("a translated rapid re-contact after a feed contact and a separation is a gouge too", () => {
    // Margin 0.2: the feed into the first bump (X 99.5…101.5), clear past
    // 0.4 at X 102, the rapid into the second (102.75…104).
    const SLIDE: CollisionMachine = {
      groups: [{ id: "frame", parent: "root" }, { id: "xslide", parent: "root" }],
      kinematics: [{ group: "xslide", joint: 0, type: "translate", direction: "x", sign: 1 }],
      workGroup: "frame", toolGroup: "xslide", unitScale: 1, axes: ["X", "Y", "Z"],
    };
    const model = buildCollisionModel(SLIDE, [
      { id: "wall", group: "frame", stock: true, positions: join(slab(180, 10, 10, 110, 11.5), slab(1, 2.5, 10, 100.5, 5.25), slab(0.25, 2.5, 10, 103.375, 5.25)) },
      { id: "slide", group: "xslide", tool: true, positions: slab(1, 10, 10, 0, 0) },
    ]);
    const t = track([[48, 0, 0], [100, 0, 0], [105, 0, 0], [180, 0, 0]], undefined, [1, 2, 3, 4], [0, 0, 1, 1]);
    expect(rapidOnLine3(sweepCollisions(model, t, WCS0, { margin: 0.2 }))).toBe(true);
  });
});

describe("facets without area (Codex R86 VP-I46)", () => {
  // three-mesh-bvh takes three DISTINCT collinear vertices for a triangle:
  // its zero normal leaves the separating axis and the plane useless, and
  // the distance from such a facet to a triangle 1.5 mm away came out 0.
  const tri = (...v: number[]) => new Float32Array(v);
  const COLLINEAR = tri(0, 0, 0, 4, 0, 0, 2, 0, 0);
  const NEAR = tri(0, 1.5, 0, 2, 1.5, 0, 1, 2.5, 0);
  const BELOW = tri(0, -10, 0, 4, -10, 0, 2, -9, 0);
  const FLAT: CollisionMachine = {
    groups: [{ id: "frame", parent: "root" }, { id: "xslide", parent: "root" }],
    kinematics: [{ group: "xslide", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "frame", toolGroup: "xslide", unitScale: 1, axes: ["X", "Y", "Z"],
  };
  const join = (...a: Float32Array[]) => {
    const o = new Float32Array(a.reduce((s, x) => s + x.length, 0));
    let k = 0;
    for (const x of a) { o.set(x, k); k += x.length; }
    return o;
  };

  it("drops collinear, coincident and non-finite facets and keeps the rest", () => {
    const r = withoutArealessFacets(join(COLLINEAR, NEAR, tri(1, 1, 1, 1, 1, 1, 3, 3, 3), tri(0, 0, 0, 1, 0, 0, NaN, 1, 0), BELOW));
    expect(r.dropped).toBe(3);
    expect(r.damaged, "the facet with NaN is damaged, not merely without area").toBe(1);
    expect(Array.from(r.positions)).toEqual([...NEAR, ...BELOW]);
    // A sliver with area stays: 0.01 wide over 100.
    expect(withoutArealessFacets(tri(0, 0, 0, 100, 0, 0, 50, 0.01, 0)).dropped).toBe(0);
  });

  it("a body's collinear facet is no contact: the distance is its real surface's", () => {
    const model = buildCollisionModel(FLAT, [
      { id: "flat", group: "frame", positions: join(COLLINEAR, BELOW) },
      { id: "plate", group: "xslide", positions: NEAR },
    ]);
    poseModel(model, [0, 0, 0]);
    // Plate at y ≥ 1.5, the real facet's top vertex at (2, −9): 10.5 apart.
    expect(pairDistance(model.bodies[0]!, model.bodies[1]!, 20, 2)).toBeCloseTo(10.5, 6);
  });

  it("a body with no facet that has area is left out and named, never read as clear", () => {
    const model = buildCollisionModel(FLAT, [
      { id: "line", group: "frame", positions: COLLINEAR },
      { id: "plate", group: "xslide", positions: NEAR },
      { id: "post", group: "frame", positions: BELOW },
    ]);
    expect(model.unusable).toEqual(["line"]);
    expect(model.bodies.map(b => b.id)).toEqual(["plate", "post"]);
    const r = sweepCollisions(model, track([[0, 0, 0], [5, 0, 0]]), WCS0, { margin: 2 });
    expect(r.uncertified).toMatch(/^line: no facet with area — not checked/);
  });

  it("a body that lost a damaged facet is checked on what is left and said to be partly checked (Codex R87)", () => {
    // A facet with a coordinate that is not a number is surface nobody can
    // check — unlike a facet without area, it may have been anything. The
    // rest of the body is checked; the result must not read as a plain clear.
    const model = buildCollisionModel(FLAT, [
      { id: "damaged", group: "frame", positions: join(BELOW, tri(0, 0, 0, 4, 0, 0, NaN, 1, 0)) },
      { id: "plate", group: "xslide", positions: NEAR },
    ]);
    expect(model.unusable).toEqual([]);
    expect(model.damaged).toEqual(["damaged"]);
    expect(model.bodies.map(b => b.id)).toEqual(["damaged", "plate"]);
    const r = sweepCollisions(model, track([[0, 0, 0], [5, 0, 0]]), WCS0, { margin: 2 });
    // single facets close no surface: a part inside them is not found either
    expect(r.uncertified).toBe("damaged: facets with coordinates that are not numbers — partly checked; "
      + "damaged, plate: surface not closed — a part wholly inside them is not found");
  });
});

describe("a body wholly inside another (the inside check, collision-inside.plan.md)", () => {
  // A 1 mm cube on an X-driven head against a 60 mm post on the table: in
  // through the post's face (contact from X = 30.5), wholly inside — at the
  // post's centre the surfaces lie 29.5 apart, past the query's 20 mm
  // horizon — and out again. A distance alone reads the inside as clear.
  const machine = (headX = 0): CollisionMachine => ({
    groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root", translate: [headX, 0, 0] }],
    kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
  });
  const post = (positions = boxPositions(60)): CollisionBody => ({ id: "post", group: "table", positions });
  const nub: CollisionBody = { id: "nub", group: "head", positions: boxPositions(1) };
  const xs = (points: number[]): ScrubTrack => track(points.map(x => [x, 0, 0]));
  const iv = (h: CollisionHit) => h.intervals!.map(([a, b]) => [Number(a.toFixed(2)), Number(b.toFixed(2))]);

  it("in, wholly inside and out: one contact, from the surface crossing in to the crossing out", () => {
    const r = sweepCollisions(buildCollisionModel(machine(), [post(), nub]), xs([60, 0, 60]), WCS0, { margin: 0.1 });
    const onsets = r.hits.filter(h => h.continuation === undefined);
    expect(onsets.map(h => h.line)).toEqual([2]);
    const l3 = r.hits.find(h => h.line === 3)!;
    expect(l3.continuation).toBe(2);
    // refined at the surfaces: in at X 30.5 (cum 29.5), out at X 30.5 (90.5)
    expect(iv(onsets[0]!)).toEqual([[29.5, 60]]);
    expect(iv(l3)).toEqual([[60, 90.5]]);
    expect(r.uncertified).toBeNull();
  });

  it("starting inside, clear at rest: a crash from the first line to the crossing out", () => {
    // The head's base at X 40: at rest the cube sits clear of the post; the
    // program starts with it at the post's centre.
    const r = sweepCollisions(buildCollisionModel(machine(40), [post(), nub]), xs([-40, 0]), WCS0, { margin: 0.1 });
    expect(r.staticContacts).toEqual([]);
    expect(r.hits.map(h => [h.line, h.continuation])).toEqual([[2, undefined]]);
    expect(iv(r.hits[0]!)).toEqual([[0, 30.5]]);
  });

  it("inside at the first pose and at rest: a static contact, never a finding", () => {
    const r = sweepCollisions(buildCollisionModel(machine(), [post(), nub]), xs([0, 2]), WCS0, { margin: 0.1 });
    expect(r.staticContacts.map(c => [c.a, c.b].sort().join("|"))).toEqual(["nub|post"]);
    expect(r.hits).toEqual([]);
  });

  it("a jump into the inside (a relabel break) is asked at once", () => {
    // X 100 → 95 under the first epoch, then the second epoch (X − 95) puts
    // the cube at the post's centre with no move between: the break's
    // segment has no length, and the first query after it must ask.
    const t = { ...track([[100, 0, 0], [95, 0, 0], [95, 0, 0], [96, 0, 0]]),
                wcs: new Uint32Array([0, 0, 1, 1]), brk: new Uint8Array([0, 0, 1, 0]) };
    const zero = { ox: 0, oy: 0, oz: 0, oa: 0, ob: 0, oc: 0, tx: 0, ty: 0, tz: 0, cth: 1, sth: 0 };
    const epochTerms = [zero, { ...zero, ox: -95 }];
    const r = sweepCollisions(buildCollisionModel(machine(), [post(), nub]), t, WCS0, { margin: 0.1, epochTerms });
    expect(r.hits.filter(h => h.continuation === undefined).map(h => h.line)).toEqual([4]);
  });

  it("a tool change that swallows a pin is a contact at once", () => {
    // PLUNGE's tool tip at Z 5; a 0.5 mm pin 3 off the axis at Z 7: clear of
    // the Ø2 tool (1.75 apart), wholly inside the Ø12 one after the change —
    // the tool pair's first query after the change must ask.
    const m = buildCollisionModel(PLUNGE, [
      { id: "pin", group: "table", positions: boxPositions(0.5), translate: [3, 0, 7] },
      { id: "tool", group: "head", positions: toolCylinderPositions(2, 4), tool: true },
    ]);
    const t = track([[0, 0, -45], [0, 1, -45], [0, 2, -45]], undefined, [1, 2, 3]);
    t.tlo = new Uint32Array([TLO_NONE, TLO_NONE, 0]);
    t.tloEvents = [{ seq: 0, xyz: [0, 0, 0], tool: 2 }];
    const r = sweepCollisions(m, t, WCS0, {
      margin: 0.1, tloEvents: t.tloEvents, liveTool: 1,
      toolDims: { 1: { diam: 2, len: 4 }, 2: { diam: 12, len: 4 } },
    });
    expect(r.hits.filter(h => h.continuation === undefined).map(h => [h.line, h.a])).toEqual([[3, "tool"]]);
  });

  it("through a wall inside one contact stride, across a line: the re-sampled stretch is asked too", () => {
    // A 3 mm wall: the cube is wholly inside it for 2 mm, less than the
    // contact cadence (5 mm). Found inside at the start of line 3 (X 0), the
    // next query (X −5) finds it out, and the stretch between is re-sampled
    // (VP-I45) — every sample there a separation decision: inside is still
    // the contact, so line 3 continues line 2's.
    const g = new THREE.BoxGeometry(3, 60, 60).toNonIndexed();
    const wall = new Float32Array(g.getAttribute("position").array as Float32Array);
    g.dispose();
    const r = sweepCollisions(buildCollisionModel(machine(), [post(wall), nub]), xs([10, 0, -10]), WCS0, { margin: 0.1 });
    expect(r.hits.filter(h => h.continuation === undefined).map(h => h.line)).toEqual([2]);
    expect(r.hits.find(h => h.line === 3)?.continuation).toBe(2);
  });

  it("an inside answer holds only while no surface crossing can have come — used up line by line", () => {
    // The cube starts 10 off the post's centre (surfaces 19.5 apart, inside
    // the horizon) and leaves in 2 mm lines. The answer certified at the
    // start must be used up by each line's travel: kept whole per line, it
    // would outlast the crossing out (X 29.5) and the contact would never end.
    const pts = Array.from({ length: 21 }, (_, i) => -30 + 2 * i);   // the cube at 10 … 50
    const r = sweepCollisions(buildCollisionModel(machine(40), [post(), nub]), xs(pts), WCS0, { margin: 0.1 });
    expect(r.hits.filter(h => h.continuation === undefined).map(h => h.line)).toEqual([2]);
    // in contact to the crossing out: the cube at 30.5 (cum 20.5), on line 12
    expect(Math.max(...r.hits.map(h => h.line))).toBe(12);
    expect(Math.max(...r.hits.flatMap(h => h.intervals!.map(iv => iv[1])))).toBeCloseTo(20.5, 2);
  });

  it("an inside answer does not cross a jump", () => {
    // Inside under the first epoch, then a relabel puts the cube 100 away:
    // the line after the break is clear, whatever was certified before it.
    const t = { ...track([[0, 0, 0], [5, 0, 0], [5, 0, 0], [6, 0, 0]]),
                wcs: new Uint32Array([0, 0, 1, 1]), brk: new Uint8Array([0, 0, 1, 0]) };
    const zero = { ox: 0, oy: 0, oz: 0, oa: 0, ob: 0, oc: 0, tx: 0, ty: 0, tz: 0, cth: 1, sth: 0 };
    const r = sweepCollisions(buildCollisionModel(machine(40), [post(), nub]), t, WCS0,
                              { margin: 0.1, epochTerms: [{ ...zero, ox: -40 }, { ...zero, ox: 60 }] });
    expect(r.hits.map(h => h.line)).toEqual([2]);
  });

  it("parked and continued (the worker's snapshots), an inside contact ends as the uninterrupted sweep", () => {
    // In through the face, wholly inside and out again in 0.5 mm lines (240
    // segments: a checkpoint every 16): a snapshot at every checkpoint
    // refines copies — posing the model, asking the rays — while the sweep
    // is suspended; continuing must end exactly as the sweep without them.
    const pts: number[] = [];
    for (let x = 60; x > 0; x -= 0.5) pts.push(x);
    for (let x = 0; x <= 60; x += 0.5) pts.push(x);
    const model = buildCollisionModel(machine(), [post(), nub]);
    const sync = sweepCollisions(model, xs(pts), WCS0, { margin: 0.1 });
    const snap: SnapshotHandle = { take: null, peek: null, records: null };
    const it = sweepCollisionsIter(model, xs(pts), WCS0, { margin: 0.1, snapshot: snap });
    let r = it.next(), parks = 0;
    while (!r.done) { snap.take!("stopped"); snap.peek!(); parks++; r = it.next(); }
    expect(parks).toBeGreaterThan(10);
    const full = r.value as CollisionResult;
    const shape = (x: CollisionResult) => x.hits.map(h => [h.line, h.continuation, h.intervals?.map(iv => iv.map(v => +v.toFixed(3)))]);
    expect(shape(full)).toEqual(shape(sync));
    expect([full.samples, full.notes]).toEqual([sync.samples, sync.notes]);
    expect(sync.hits.filter(h => h.continuation === undefined)).toHaveLength(1);
  });

  it("a crossing narrower than the sampling floor, into the inside across a line boundary", () => {
    // A 0.01 mm cube toward a 20 mm box (+X face at 10), margin 0.01: queried
    // last on line 2 at the margin (cum 4.985), its next sample would be the
    // floor's 0.25 later — by then it has crossed the face (a 0.01 wide touch)
    // and lies 0.2 deep. Line 3 starts at cum 5.225: its first sample finds
    // the surfaces 0.22 apart, past twice the margin, which reads as a
    // separation unless the distance measured on line 2 — used up across the
    // boundary — says a crossing may have come, and the inside is asked.
    const r = sweepCollisions(buildCollisionModel(machine(), [post(boxPositions(20)), { id: "nub", group: "head", positions: boxPositions(0.01) }]),
                              xs([15, 9.775, 5]), WCS0, { margin: 0.01 });
    // one contact from the face to the end, carried onto line 3
    expect(r.hits.filter(h => h.continuation === undefined).map(h => h.line)).toEqual([2]);
    expect(r.hits.find(h => h.line === 3)?.continuation).toBe(2);
    const end = Math.max(...r.hits.flatMap(h => h.intervals?.map(iv => iv[1]) ?? [h.cumEnd]));
    expect(end).toBeCloseTo(10, 2);
  });

  it("a container whose surface is not closed is named once for the model and keeps the surface's guarantee", () => {
    // The post without one facet: no inside to decide. The sweep sees the
    // two surface crossings as two contacts (the surface's reading), asks
    // nothing it can never answer (no undecidable stretch — no contact
    // cadence for good on the 3-axis model's frame), and says what it cannot
    // find.
    const m = buildCollisionModel(machine(), [post(boxPositions(60).slice(0, -9)), nub]);
    expect(m.open).toEqual(["post"]);
    const r = sweepCollisions(m, xs([60, 0, 60]), WCS0, { margin: 0.1 });
    expect(r.notes).toEqual(["post: surface not closed — a part wholly inside it is not found"]);
    expect(r.hits.filter(h => h.continuation === undefined).map(h => h.line)).toEqual([2, 3]);
  });
});

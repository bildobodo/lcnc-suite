// The RANGE sweep (plan „Prüfung im Lauf“ 3b, Codex R112–R115): the
// provisional check during a run sweeps from the machine's presumed point to
// the end — with the PROGRAM's baseline (static exclusions from its first
// pose and the rest pose, VP112-04), every pair queried afresh at the start,
// a pair inside the margin there a BOUNDARY contact (not a collision; its
// kind is the full check's), and nothing before the start swept, refined or
// reported. Synthetic box machines; the shipped models against the oracle in
// collisionRangeOracle.test.ts.
import * as THREE from "three";
import { ContactStore, EP_ORIGIN_MASK, IV_CONTINUES_CUT, NONE, ORIGIN_BOUNDARY } from "./contactStore";
import { describe, expect, it } from "vitest";
import { emptyLineIndex } from "./lineIndex";
import { buildCollisionModel, sweepCollisions, sweepCollisionsIter, type CollisionBody, type CollisionMachine,
  type CollisionModel, type CollisionOptions, type SnapshotHandle } from "./collision";
import type { ScrubTrack } from "../ws/bulkData";

const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 };

function boxPositions(size: number): Float32Array {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  const pos = new Float32Array(g.getAttribute("position").array as Float32Array);
  g.dispose();
  return pos;
}

function track(points: number[][], lines: number[], rapid?: number[]): ScrubTrack {
  const n = points.length;
  const pos = new Float32Array(points.flat());
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const j = i * 3, k = j - 3;
    cum[i] = cum[i - 1]! + Math.hypot(pos[j]! - pos[k]!, pos[j + 1]! - pos[k + 1]!, pos[j + 2]! - pos[k + 2]!);
  }
  return { pos, abc: new Float32Array(n * 3), lines: new Uint32Array(lines),
    rapid: rapid ? new Uint8Array(rapid) : new Uint8Array(n), cum, count: n,
    lineIndex: emptyLineIndex(), timeBased: false };
}

// The head (Z) over an X table. The spindle box's bottom is at 45 + Z, the
// vise's top at 5: contact below Z −40, inside the 2 mm margin below −38, a
// separation verified above −36.
const MILL: CollisionMachine = {
  groups: [
    { id: "table", parent: "root" },
    { id: "platter", parent: "table" },
    { id: "head", parent: "root", translate: [0, 0, 50] },
  ],
  kinematics: [
    { group: "table", joint: 0, type: "translate", direction: "x", sign: 1 },
    { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 },
  ],
  workGroup: "platter", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
};
const crash = () => buildCollisionModel(MILL, [
  { id: "vise", group: "table", positions: boxPositions(10) },
  { id: "spindle", group: "head", positions: boxPositions(10) },
]);
const cutting = () => buildCollisionModel(MILL, [
  { id: "stock", group: "platter", positions: boxPositions(10), stock: true },
  { id: "spindle", group: "head", positions: boxPositions(10), tool: true },
]);
const M = { margin: 2 };
/** A sweep writing the contact tables too (step 4 package 2): the findings —
 *  the touch intervals of every episode not of origin "boundary", by the line
 *  their move begins on, but a cutting contact's later rapid part (one
 *  finding with the part before, as the view counts) —, the boundary
 *  episodes' pairs, every entry. */
function sweepRT(model: CollisionModel, t: ScrubTrack, opts: CollisionOptions) {
  const st = new ContactStore(1, 0);
  const r = sweepCollisions(model, t, WCS0, { ...opts, contacts: { store: st } });
  const E = st.episodes, I = st.intervals;
  const lineFrom = (x: number) => { let i = 1; while (i < t.count - 1 && t.cum[i]! <= x) i++; return t.lines[i]!; };
  const finds: Array<{ pair: string; line: number; enter: number }> = [], boundary = new Set<string>(), enters: number[] = [], endLines: number[] = [];
  const lineAt = (x: number) => { let i = 1; while (i < t.count - 1 && t.cum[i]! < x) i++; return t.lines[i]!; };
  for (let e = 0; e < E.rows; e++) {
    const pair = model.pairs[E.get(e, "pair")]!.map(k => model.bodies[k]!.id).sort().join("/");
    const end = E.get(e, "end");
    endLines.push(Number.isNaN(end) ? t.lines[t.count - 1]! : lineAt(end));
    const atBoundary = (E.get(e, "flags") & EP_ORIGIN_MASK) === ORIGIN_BOUNDARY;
    if (atBoundary) boundary.add(pair);
    for (let iv = E.get(e, "firstIv"); iv !== NONE; iv = I.get(iv, "next")) {
      const enter = I.get(iv, "enter");
      enters.push(enter);
      if (!atBoundary && !(I.get(iv, "flags") & IV_CONTINUES_CUT)) finds.push({ pair, line: lineFrom(enter), enter });
    }
  }
  return [r, { finds, boundary: [...boundary].sort(), enters, rows: E.rows, endLines }] as const;
}
const pairOf = (h: { a: string; b: string }) => [h.a, h.b].sort().join("/");

describe("the range sweep (plan „Prüfung im Lauf“ 3b)", () => {
  it("names the line the operator sees: inside a called routine, its call line", () => {
    // live 2026-10-09: "Checked from L339" in a 60-line program — the point
    // lay in the M600's tool_touch_off.ngc, whose own numbers the track
    // carries; the code panel and the readouts show the call line there
    const base = track([[0, 0, 0], [0, 0, -45], [0, 0, 0], [0, 0, -45], [0, 0, 0]], [1, 2, 339, 340, 5]);
    const t: ScrubTrack = { ...base, lineOk: new Uint8Array([1, 1, 0, 0, 1]),
      sub: new Uint8Array([0xff, 0xff, 0, 0, 0xff]), subNames: ["tool_touch_off"],
      cline: new Uint16Array([0, 0, 7, 7, 0]) };
    const r = sweepCollisions(crash(), t, WCS0, { ...M, range: { from: 2 } });
    expect(r.range?.fromLine).toBe(7);
    // an unknown start inside the routine is named by its call line too
    const u = sweepCollisions(crash(), { ...t, ustart: new Uint8Array([0, 0, 0, 1, 0]) }, WCS0, M);
    expect(u.uncertified).toContain("(L7)");
    expect(u.uncertified).not.toContain("340");
  });

  it("from a clear point: what the full sweep finds after it, nothing before it", () => {
    const model = crash();
    // L2 plunges into the vise, L3 retracts, L4 plunges again
    const t = track([[0, 0, 0], [0, 0, -45], [0, 0, 0], [0, 0, -45], [0, 0, 0]], [1, 2, 3, 4, 5]);
    const [full, TF] = sweepRT(model, t, M);
    expect(TF.finds.map(f => f.line), "the tables").toEqual([2, 4]);
    const [r, T] = sweepRT(model, t, { ...M, range: { from: 2 } });
    expect(T.boundary, "the tables: no boundary episode").toEqual([]);
    expect(T.finds.map(f => f.line), "the tables").toEqual([4]);
    expect(T.finds[0]!.enter).toBeCloseTo(TF.finds[1]!.enter, 2);
    for (const a of T.enters) expect(a, "the tables: nothing before the start").toBeGreaterThanOrEqual(t.cum[2]! - 1e-6);
    expect(r.range).toEqual({ fromCum: t.cum[2], fromLine: 4 });
    expect(r.boundaryContacts).toEqual([]);
    expect(r.staticContacts).toEqual(full.staticContacts);
  });

  it("from inside a contact: a boundary contact, not a collision — an episode of its own origin until it separates", () => {
    const model = crash();
    const t = track([[0, 0, 0], [0, 0, -45], [0, 0, 0], [0, 0, -45], [0, 0, 0]], [1, 2, 3, 4, 5]);
    const [r, T] = sweepRT(model, t, { ...M, range: { from: 1 } });
    expect(T.boundary, "the tables: a boundary episode").toEqual(["spindle/vise"]);
    expect(T.finds.map(f => f.line), "the tables: the next plunge, a collision").toEqual([4]);
    expect(Math.min(...T.enters), "the tables: never before the start").toBeCloseTo(t.cum[1]!, 6);
    expect(r.boundaryContacts?.map(b => [pairOf(b), b.line, b.cutting])).toEqual([["spindle/vise", 3, false]]);
    expect(r.boundaryContacts![0]!.cum).toBeCloseTo(t.cum[1]!, 6);
  });

  it("a range starting inside a line: its contacts begin at the start, never at the line's start", () => {
    const model = crash();
    // L2 is two segments: down into the vise, then on along it; the range
    // starts at the point between them, in the contact
    const t = track([[0, 0, 0], [0, 0, -45], [3, 0, -45], [3, 0, 0]], [1, 2, 2, 3]);
    const [r, T] = sweepRT(model, t, { ...M, range: { from: 1 } });
    expect(T.boundary, "the tables").toEqual(["spindle/vise"]);
    for (const a of T.enters) expect(a, "the tables").toBeGreaterThanOrEqual(t.cum[1]! - 1e-6);
    expect(r.range?.fromLine).toBe(2);
    expect(r.boundaryContacts?.map(b => [pairOf(b), b.line])).toEqual([["spindle/vise", 2]]);
    // and a fresh contact just after a clear start keeps to the start too
    const t2 = track([[0, 0, 0], [0, 0, -45], [0, 0, -30], [0, 0, -45], [0, 0, 0]], [1, 2, 2, 2, 3]);
    const [r2, T2] = sweepRT(model, t2, { ...M, range: { from: 2 } });
    expect(T2.boundary, "the tables").toEqual([]);
    expect(T2.finds.map(f => f.line), "the tables").toEqual([2]);
    for (const a of T2.enters) expect(a, "the tables").toBeGreaterThanOrEqual(t2.cum[2]! - 1e-6);
    expect(r2.boundaryContacts).toEqual([]);
  });

  it("a boundary contact that separates and comes back on its line: the re-entry is a collision of its own", () => {
    const model = crash();
    // L3: up out of the contact, then down into it again
    const t = track([[0, 0, 0], [0, 0, -45], [0, 0, -20], [0, 0, -45], [0, 0, 0]], [1, 2, 3, 3, 4]);
    const [, TF] = sweepRT(model, t, M);
    const [r, T] = sweepRT(model, t, { ...M, range: { from: 1 } });
    // the tables: the boundary episode, and the re-entry a finding of its own on L3 — where the full sweep's is
    expect(T.boundary).toEqual(["spindle/vise"]);
    expect(T.finds.map(f => f.line)).toEqual([3]);
    const tf = TF.finds.filter(f => f.line === 3);
    expect(tf).toHaveLength(1);
    expect(T.finds[0]!.enter).toBeCloseTo(tf[0]!.enter, 2);
    expect(r.boundaryContacts?.map(b => [pairOf(b), b.line])).toEqual([["spindle/vise", 3]]);
  });

  it("cutting — feed in, cut, rapid out: the provisional check names a boundary contact, the full check reports nothing (R114)", () => {
    const model = cutting();
    const t = track([[0, 0, 0], [0, 0, -43], [5, 0, -43], [0, 0, 0]], [1, 2, 3, 4], [0, 0, 0, 1]);
    const [, TF] = sweepRT(model, t, M);
    expect(TF.rows, "the tables").toBe(0);
    const [r, T] = sweepRT(model, t, { ...M, range: { from: 2 } });
    expect(T.rows, "the tables: a cutting boundary contact writes nothing").toBe(0);
    expect(r.boundaryContacts?.map(b => [pairOf(b), b.cutting])).toEqual([["spindle/stock", true]]);
  });

  it("cutting — rapid in, feed, rapid out without separating: the full check reports the gouge, the provisional one names the contact it cannot classify (R114)", () => {
    const model = cutting();
    const t = track([[0, 0, 0], [0, 0, -43], [5, 0, -43], [0, 0, 0]], [1, 2, 3, 4], [0, 1, 0, 1]);
    const [, TF] = sweepRT(model, t, M);
    expect(TF.finds.map(f => f.line), "the tables: the gouge").toEqual([2]);
    expect(TF.endLines, "its contact runs on through the rapid out").toEqual([4]);
    const [r, T] = sweepRT(model, t, { ...M, range: { from: 2 } });
    expect(T.rows, "the tables: nothing it could not classify").toBe(0);
    expect(r.boundaryContacts?.map(b => [pairOf(b), b.cutting])).toEqual([["spindle/stock", true]]);
    // its onset unknown — taken as feed: nothing it could not classify
  });

  it("static exclusions are the program's, never the range start's (VP112-04)", () => {
    // `stop` rides the table into the frame's `post`: touching at rest (X 0)
    // and at the range start, clear at the program's first pose (X 30) — a
    // baseline at the range start would have excluded it as a mount.
    const model = buildCollisionModel(MILL, [
      { id: "post", group: "root", positions: boxPositions(10), translate: [0, 0, -20] },
      { id: "stop", group: "table", positions: boxPositions(10), translate: [0, 0, -20] },
      { id: "spindle", group: "head", positions: boxPositions(10) },
    ] as CollisionBody[]);
    const t = track([[30, 0, 0], [0, 0, 0], [0, 0, 5], [0, 0, 10]], [1, 2, 3, 4]);
    const [full, TF] = sweepRT(model, t, M);
    expect(full.staticContacts).toEqual([]);
    expect(TF.finds.map(f => [f.pair, f.line]), "the tables").toEqual([["post/stop", 2]]);
    const [r, T] = sweepRT(model, t, { ...M, range: { from: 1 } });
    expect(T.boundary, "the tables").toEqual(["post/stop"]);
    expect(r.staticContacts).toEqual(full.staticContacts);
    expect(r.boundaryContacts?.map(pairOf)).toEqual(["post/stop"]);
  });

  it("the first pose's seeds do not reach the range: a contact at the start is queried there, a boundary contact", () => {
    const model = crash();
    // the program starts in the vise (clear at rest: crashed from its first
    // point — the full sweep's seeded onset on L2)
    const t = track([[0, 0, -45], [0, 0, -44], [0, 0, -45], [0, 0, 0]], [1, 2, 3, 4]);
    const [, TF] = sweepRT(model, t, M);
    expect(TF.finds.map(f => f.line), "the tables").toEqual([2]);
    const [r, T] = sweepRT(model, t, { ...M, range: { from: 1 } });
    expect([T.boundary, T.finds], "the tables: a boundary episode, no finding").toEqual([["spindle/vise"], []]);
    expect(r.boundaryContacts?.map(b => [pairOf(b), b.line])).toEqual([["spindle/vise", 3]]);
  });

  it("a body wholly inside another at the start is a boundary contact", () => {
    // a small box rides the table into a closed big one: surfaces 9 apart at
    // X 0, inside — only the inside check sees it
    const model = buildCollisionModel(MILL, [
      { id: "outer", group: "root", positions: boxPositions(20), translate: [0, 0, -30] },
      { id: "inner", group: "table", positions: boxPositions(2), translate: [0, 0, -30] },
      { id: "spindle", group: "head", positions: boxPositions(10) },
    ] as CollisionBody[]);
    const t = track([[50, 0, 0], [0, 0, 0], [1, 0, 0], [2, 0, 0]], [1, 2, 3, 4]);
    const [, TF] = sweepRT(model, t, M);
    expect(TF.finds.map(f => f.pair), "the tables").toContain("inner/outer");
    const [r, T] = sweepRT(model, t, { ...M, range: { from: 1 } });
    expect([T.boundary, T.finds], "the tables: a boundary episode, no finding").toEqual([["inner/outer"], []]);
    expect(r.boundaryContacts?.map(pairOf)).toEqual(["inner/outer"]);
  });

  it("a range with nothing of positive length after its start is said, never clear", () => {
    const model = crash();
    const t = track([[0, 0, 0], [0, 0, -45], [0, 0, -45], [0, 0, -45]], [1, 2, 3, 4]);
    for (const from of [2, 3]) {
      const [r, T] = sweepRT(model, t, { ...M, range: { from } });
      expect(T.rows, "the tables").toBe(0);
      expect(r.range).toEqual({ fromCum: t.cum[from], fromLine: t.lines[Math.min(from + 1, 3)], empty: true });
      expect(r.boundaryContacts).toEqual([]);
    }
  });

  it("progress and a parked sweep's coverage are counted from the start", () => {
    const model = crash();
    const pts: number[][] = [[0, 0, 0]];
    for (let i = 1; i <= 400; i++) pts.push([i % 2 ? 1 : 0, 0, -i * 0.05]);
    const t = track(pts, pts.map((_, i) => i + 1));
    const from = 200, fromFrac = t.cum[from]! / t.cum[t.count - 1]!;
    const snap: SnapshotHandle = { take: null, meta: null };
    const it = sweepCollisionsIter(model, t, WCS0, { ...M, range: { from }, snapshot: snap, yieldMs: 0 });
    const seen: number[] = [];
    let step = it.next();
    while (!step.done) {
      if (step.value > 0) {
        seen.push(step.value);
        // parked before its first sample, and later: covered from the start
        if (seen.length === 1 || seen.length === 20) {
          const parked = snap.take!("stopped");
          expect(parked.truncated!.covered).toBeGreaterThanOrEqual(fromFrac - 1e-9);
          expect(parked.range?.fromCum).toBe(t.cum[from]);
        }
      }
      step = it.next();
    }
    expect(seen.length).toBeGreaterThan(20);
    for (const f of seen) expect(f).toBeGreaterThanOrEqual(fromFrac - 1e-9);
  });
});

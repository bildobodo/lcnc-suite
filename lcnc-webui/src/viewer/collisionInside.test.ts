// The sweep's side of an UNDECIDABLE inside check (collision-inside.plan.md,
// VP96-03): every ray degenerate is rare on real meshes, so the rays are
// made degenerate here — `pointInside` answers "undecidable" wherever the
// test says. What such an answer must never give: a record, a separation, a
// clearance certificate, a static exclusion — and its stretch stays named,
// also through the parallel sweep's merge.
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildCollisionModel, sweepCollisions, type CollisionBody, type CollisionMachine, type CollisionResult } from "./collision";
import { emptyLineIndex } from "./lineIndex";
import { mergeShardResults } from "./sweepShards";
import type { ScrubTrack } from "../ws/bulkData";
import { ContactStore, GAP_UNDECIDABLE, IV_EXIT_DECIDED } from "./contactStore";
import { buildContactView, lineMark, tintAt } from "./contactView";

// undecidable where `when` says (the point in the container's frame)
const ctl = vi.hoisted(() => ({ when: null as ((p: { x: number; y: number; z: number }) => boolean) | null }));
vi.mock("./insideCheck", async orig => {
  const m = await orig<typeof import("./insideCheck")>();
  return {
    ...m,
    pointInside: (...a: Parameters<typeof m.pointInside>) =>
      (ctl.when?.(a[2]) ? "undecidable" as const : m.pointInside(...a)),
  };
});

const WCS0 = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 };
const box = (size: number): Float32Array => {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  const p = new Float32Array(g.getAttribute("position").array as Float32Array);
  g.dispose();
  return p;
};
// The cube and the 60 mm post of collision.test.ts's inside block.
const machine = (headX = 0): CollisionMachine => ({
  groups: [{ id: "table", parent: "root" }, { id: "part", parent: "table" }, { id: "head", parent: "root", translate: [headX, 0, 0] }],
  kinematics: [{ group: "head", joint: 0, type: "translate", direction: "x", sign: 1 }],
  workGroup: "part", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
});
const POST: CollisionBody = { id: "post", group: "table", positions: box(60) };
const nub = (id = "nub", y = 0): CollisionBody => ({ id, group: "head", positions: box(1), translate: [0, y, 0] });
const xs = (points: number[]): ScrubTrack => {
  const n = points.length;
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1]! + Math.abs(points[i]! - points[i - 1]!);
  return { pos: new Float32Array(points.flatMap(x => [x, 0, 0])), abc: new Float32Array(n * 3),
           lines: Uint32Array.from({ length: n }, (_, i) => i + 1), rapid: new Uint8Array(n), cum, count: n,
           lineIndex: emptyLineIndex(), timeBased: false };
};
const onsets = (r: CollisionResult) => r.hits.filter(h => h.continuation === undefined).map(h => h.line);
const iv = (r: CollisionResult, line: number) =>
  r.hits.find(h => h.line === line)!.intervals!.map(([a, b]) => [Number(a.toFixed(2)), Number(b.toFixed(2))]);
/** The contact tables of a sweep (step 4 package 2), rounded to 0.01. */
const tables = (st: ContactStore) => ({
  intervals: Array.from({ length: st.intervals.rows }, (_, k) => [Number(st.intervals.get(k, "enter").toFixed(2)), Number(st.intervals.get(k, "exit").toFixed(2))]),
  gaps: Array.from({ length: st.gaps.rows }, (_, k) => ({ at: [Number(st.gaps.get(k, "start").toFixed(2)), Number(st.gaps.get(k, "end").toFixed(2))], reason: st.gaps.get(k, "reason") })),
  episodes: st.episodes.rows,
});

describe("an undecidable inside check in the sweep", () => {
  it("in the contact store an undecidable answer opens, separates and certifies nothing: one interval through it, the stretch a gap (package 2, Codex VP139-01)", () => {
    ctl.when = () => true;
    try {
      // in through the face (a decided touch), undecidable inside, out through the face
      const store = new ContactStore(1, 0);
      sweepCollisions(buildCollisionModel(machine(), [POST, nub()]), xs([60, 0, 60]), WCS0, { margin: 0.1, contacts: { store } });
      expect(store.intervals.rows, "one contact, never separated inside").toBe(1);
      const gaps = Array.from({ length: store.gaps.rows }, (_, k) => store.gaps.get(k, "reason"));
      expect(gaps.length).toBeGreaterThan(0);
      expect(gaps.every(r => r === GAP_UNDECIDABLE)).toBe(true);
      // starting inside, undecidable: nothing opens until the face is touched
      const start = new ContactStore(1, 0);
      sweepCollisions(buildCollisionModel(machine(), [POST, nub()]), xs([0, 60]), WCS0, { margin: 0.1, contacts: { store: start } });
      const w = start.intervals.rows ? start.intervals.get(0, "witness") : NaN;
      expect(w, "its first interval's witness is the face (X 29.5–30.5), not the undecidable start").toBeGreaterThan(28);
    } finally {
      ctl.when = null;
    }
  });

  it("in the contact store a contact before a jump whose first sample after it is undecidable ends AT the jump, not decided (plan 2.2)", () => {
    // the nub touches the post's face (X 30.5) and the table runs on to X 29
    // (its next probe, 5 later, past the segment's end); a jump (zero width)
    // to X 12, deep inside: undecidable, the contact neither ends nor goes on
    // there; probed at the contact cadence it is next decided free at X −33,
    // past the far face — the exit is the jump, never bisected across it
    // into the undecidable stretch behind it
    ctl.when = () => true;
    try {
      const t = xs([60, 29, 12, -60]);
      t.brk = new Uint8Array([0, 0, 1, 0]);
      t.cum[2] = t.cum[1]!;
      t.cum[3] = t.cum[2]! + 72;
      const store = new ContactStore(1, 0);
      sweepCollisions(buildCollisionModel(machine(), [POST, nub()]), t, WCS0, { margin: 0.1, contacts: { store } });
      expect(store.intervals.rows, "one contact").toBe(1);
      expect(store.intervals.get(0, "exit"), "the jump, cum 31").toBeCloseTo(31, 3);
      expect(store.intervals.get(0, "flags") & IV_EXIT_DECIDED, "a jump is no decided boundary").toBe(0);
      const gaps = Array.from({ length: store.gaps.rows }, (_, k) => store.gaps.get(k, "reason"));
      expect(gaps.length, "the undecidable stretch is a gap").toBeGreaterThan(0);
      expect(gaps.every(r => r === GAP_UNDECIDABLE)).toBe(true);
    } finally {
      ctl.when = null;
    }
  });

  it("a gap the closing refinement cannot write makes the result incomplete from it (Codex R145 VP-I100)", () => {
    // a hollow post (a 40 mm cavity), the nub ending in the cavity: the end
    // pose is decided free, the closing bisection meets an undecidable point
    // near the cavity's wall and writes it as a gap — with no room for gaps
    // that write is refused in finish, after the sweep loop
    const outer = box(60), inner = box(40);
    for (let i = 0; i < inner.length; i += 9) for (let k = 0; k < 3; k++) { const v = inner[i + k]!; inner[i + k] = inner[i + 3 + k]!; inner[i + 3 + k] = v; }
    const hollow: CollisionBody = { ...POST, positions: new Float32Array([...outer, ...inner]) };
    ctl.when = p => p.x > 19.7 && p.x < 19.9;
    try {
      const run = (gaps: number) => {
        const store = new ContactStore(1, 0, { episodes: 100, intervals: 100, gaps });
        const r = sweepCollisions(buildCollisionModel(machine(), [hollow, nub()]), xs([40, 30, 19]), WCS0, { margin: 0.1, contacts: { store } });
        return { store, r };
      };
      const full = run(100), none = run(0);
      expect(full.store.gaps.rows, "the closing refinement's gap").toBeGreaterThan(0);
      expect(full.r.truncated, "complete with room for it").toBeNull();
      const lost = full.store.gaps.get(0, "start");
      expect(none.r.truncated?.reason, "refused in finish: not complete").toBe("budget");
      expect(none.r.incompleteFrom!, `incomplete from ${none.r.incompleteFrom}, the gap at ${lost}`).toBeLessThanOrEqual(lost + 1e-6);
    } finally {
      ctl.when = null;
    }
  });

  it("is no record, no separation, and its stretch is named; the refinement counts it as contact", () => {
    ctl.when = () => true;
    try {
      const st = new ContactStore(1, 0);
      const r = sweepCollisions(buildCollisionModel(machine(), [POST, nub()]), xs([60, 0, 60]), WCS0, { margin: 0.1, contacts: { store: st } });
      // in through the face (decided by the surfaces), never separated
      // inside, out through the face: one contact, line 3 its continuation
      // — in the tables one interval through it, the undecidable stretch a gap
      const t = tables(st);
      expect(t.intervals).toEqual([[29.5, 90.5]]);
      expect(t.gaps.length).toBeGreaterThan(0);
      expect(t.gaps.every(g => g.reason === GAP_UNDECIDABLE && g.at[0]! > 29.5 && g.at[1]! < 90.5), "the undecidable stretch inside it").toBe(true);
      expect(onsets(r)).toEqual([2]);
      expect(r.hits.find(h => h.line === 3)?.continuation).toBe(2);
      expect(iv(r, 2)).toEqual([[29.5, 60]]);
      expect(iv(r, 3)).toEqual([[60, 90.5]]);
      expect(r.notes).toEqual(["inside check undecidable for nub ↔ post (L2–L3) — a part wholly inside the other is not found there"]);
    } finally { ctl.when = null; }
  });

  it("gives no clearance certificate: asked again at the contact cadence until a pose decides it", () => {
    // The cube starts at the post's centre (the rest pose is clear) and moves
    // 20 mm inside it; surfaces 29.5 → 9.5 apart. Undecidable everywhere:
    // no finding is claimed, the stretch is named, and the pair is queried
    // every 5 mm — a certificate would stride the whole move at once.
    ctl.when = () => true;
    try {
      const st = new ContactStore(1, 0);
      const r = sweepCollisions(buildCollisionModel(machine(40), [POST, nub()]), xs([-40, -20]), WCS0, { margin: 0.1, contacts: { store: st } });
      expect(r.hits).toEqual([]);
      // in the tables no finding, the whole move a gap
      expect(tables(st)).toEqual({ intervals: [], gaps: [{ at: [0, 20], reason: GAP_UNDECIDABLE }], episodes: 0 });
      expect(r.staticContacts).toEqual([]);
      expect(r.notes).toEqual(["inside check undecidable for nub ↔ post (L2) — a part wholly inside the other is not found there"]);
      expect(r.samples).toBeGreaterThanOrEqual(5);
    } finally { ctl.when = null; }
    // decided, the same move is a crash from the first line
    const d = sweepCollisions(buildCollisionModel(machine(40), [POST, nub()]), xs([-40, -20]), WCS0, { margin: 0.1 });
    expect(onsets(d)).toEqual([2]);
    expect(d.notes).toEqual([]);
  });

  it("at rest is never a static exclusion", () => {
    // Inside at the first pose (decided) and at rest (undecidable): no
    // answer at rest, so no mechanical neighbour — a crash from the first
    // line, and the rest pose's question named.
    ctl.when = p => Math.abs(p.x) < 1;   // the cube's corner at rest: x ±0.5
    try {
      const st = new ContactStore(1, 0);
      const r = sweepCollisions(buildCollisionModel(machine(), [POST, nub()]), xs([2, 4]), WCS0, { margin: 0.1, contacts: { store: st } });
      expect(r.staticContacts).toEqual([]);
      expect(onsets(r)).toEqual([2]);
      expect(r.notes).toEqual(["inside check undecidable for nub ↔ post (L2) — a part wholly inside the other is not found there"]);
      expect(r.uncertified, "the rest pose's question is the result's caveat").toBe(r.notes![0]);
      // in the tables: the contact from the first point, and NO gap — the rest
      // pose is no point of the program; its caveat lives in the result's
      // notes alone and must stay there (Codex R167 VP167-01)
      expect(tables(st)).toEqual({ intervals: [[0, NaN]], gaps: [], episodes: 1 });
      // ...and through the parallel sweep's merge
      const model = buildCollisionModel(machine(), [POST, nub()]);
      const parts = [0, 1].map(index => sweepCollisions(model, xs([2, 4]), WCS0, { margin: 0.1, shard: { index, of: 2 }, contacts: { store: new ContactStore(1, 0) } }));
      expect(mergeShardResults(parts).notes, "the merge keeps the rest pose's caveat").toEqual(r.notes);
    } finally { ctl.when = null; }
  });

  it("met only by the refinement, it is named too (Codex R101 VP-I58)", () => {
    // A 1 mm cube in a closed post with a 40 mm cavity, from the cavity's
    // centre to its wall (contact from cube X 19.5). Undecidable only where
    // the cube's corner lies between X 18 and 19.5: the refinement walking
    // back from the touch meets it and grows the interval conservatively —
    // and the result must say why.
    const outer = box(60), inner = box(40);
    for (let i = 0; i < inner.length; i += 9) for (let k = 0; k < 3; k++) {   // the cavity's faces point in
      const v = inner[i + k]!; inner[i + k] = inner[i + 3 + k]!; inner[i + 3 + k] = v;
    }
    const hollow: CollisionBody = { ...POST, positions: new Float32Array([...outer, ...inner]) };
    const run = () => sweepCollisions(buildCollisionModel(machine(40), [hollow, nub()]), xs([-40, -20]), WCS0, { margin: 0.1 });
    const control = run();
    expect(control.hits.map(h => +h.cum.toFixed(2))).toEqual([19.5]);
    expect(control.notes).toEqual([]);
    ctl.when = p => p.x > 18 && p.x < 19.5;
    try {
      const r = run();
      expect(r.hits[0]!.cum).toBeLessThan(19);
      expect(r.notes).toEqual(["inside check undecidable for nub ↔ post (L2) — a part wholly inside the other is not found there"]);
    } finally { ctl.when = null; }
  });

  it("is named by the shard that sweeps the pair, and the merge names every one", () => {
    // Two cubes in the post, two pairs, one per shard: each shard names its
    // own pair only, the merge both — as the single sweep does.
    ctl.when = () => true;
    try {
      const model = buildCollisionModel(machine(40), [POST, nub("a", -10), nub("b", 10)]);
      const t = xs([-40, -20]);
      const one = sweepCollisions(model, t, WCS0, { margin: 0.1 });
      const parts = [0, 1].map(index => sweepCollisions(model, t, WCS0, { margin: 0.1, shard: { index, of: 2 } }));
      expect(parts.map(p => p.notes!.length)).toEqual([1, 1]);
      const merged = mergeShardResults(parts);
      expect([...merged.notes!].sort()).toEqual([...one.notes!].sort());
      expect(merged.uncertified).toBe(merged.notes!.join("; "));
      expect(one.notes!.map(n => n.slice(0, 40))).toEqual(["inside check undecidable for a ↔ post (L", "inside check undecidable for b ↔ post (L"]);
    } finally { ctl.when = null; }
  });
});

// Codex R147 VP-I102 A, from a real sweep: the refinement leaves a POINT gap
// (an undecidable answer at one sample inside the cavity) inside the
// contact's interval — the view must not show contact at that point.
describe("a point gap from the sweep's own refinement (Codex R147)", () => {
  it("the undecidable refinement point stays unknown in the contact view", () => {
    const outer = box(60), inner = box(40);
    for (let i = 0; i < inner.length; i += 9) for (let k = 0; k < 3; k++) { const v = inner[i + k]!; inner[i + k] = inner[i + 3 + k]!; inner[i + 3 + k] = v; }
    const hollow: CollisionBody = { ...POST, positions: new Float32Array([...outer, ...inner]) };
    const store = new ContactStore(1, 0, { episodes: 100, intervals: 100, gaps: 100 });
    try {
      ctl.when = p => p.x > 19.7 && p.x < 19.9;
      const model = buildCollisionModel(machine(), [hollow, nub()]);
      sweepCollisions(model, xs([40, 30, 19]), WCS0, { margin: 0.1, contacts: { store } });
      const v = buildContactView({ sources: [{ stores: [store], at: c => c }], coverage: 21,
        pairName: i => ({ a: model.bodies[model.pairs[i]![0]]!.id, b: model.bodies[model.pairs[i]![1]]!.id }) });
      expect(store.gaps.rows).toBe(1);
      const point = store.gaps.get(0, "start");
      expect(store.gaps.get(0, "end"), "a point gap").toBe(point);
      expect(store.intervals.rows, "inside a contact interval").toBe(1);
      expect(store.intervals.get(0, "enter")).toBeLessThan(point);
      expect([...tintAt(v, point)], "unknown at the point: no tint").toEqual([]);
      expect([...tintAt(v, point - 0.01)].length, "lit beside it").toBe(2);
      expect(lineMark(v, 2, [[point, point]]), "no mark for a span lying only there").toBeNull();
    } finally { ctl.when = null; }
  });
});

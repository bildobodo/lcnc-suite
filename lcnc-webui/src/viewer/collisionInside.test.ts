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

describe("an undecidable inside check in the sweep", () => {
  it("is no record, no separation, and its stretch is named; the refinement counts it as contact", () => {
    ctl.when = () => true;
    try {
      const r = sweepCollisions(buildCollisionModel(machine(), [POST, nub()]), xs([60, 0, 60]), WCS0, { margin: 0.1 });
      // in through the face (decided by the surfaces), never separated
      // inside, out through the face: one contact, line 3 its continuation
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
      const r = sweepCollisions(buildCollisionModel(machine(40), [POST, nub()]), xs([-40, -20]), WCS0, { margin: 0.1 });
      expect(r.hits).toEqual([]);
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
      const r = sweepCollisions(buildCollisionModel(machine(), [POST, nub()]), xs([2, 4]), WCS0, { margin: 0.1 });
      expect(r.staticContacts).toEqual([]);
      expect(onsets(r)).toEqual([2]);
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

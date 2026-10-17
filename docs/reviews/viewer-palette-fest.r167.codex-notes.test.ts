// The sweep's side of an UNDECIDABLE inside check (collision-inside.plan.md,
// VP96-03): every ray degenerate is rare on real meshes, so the rays are
// made degenerate here — `pointInside` answers "undecidable" wherever the
// test says. What such an answer must never give: a record, a separation, a
// clearance certificate, a static exclusion — and its stretch stays named,
// also through the parallel sweep's merge.
import { writeFileSync } from "node:fs";
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

describe("R167: gap-only notes do not carry every uncertainty", () => {
  it("the undecidable rest baseline is named, but writes no gap on the program's axis", () => {
    ctl.when = p => Math.abs(p.x) < 1;
    try {
      const store = new ContactStore(1, 0);
      const r = sweepCollisions(buildCollisionModel(machine(), [POST, nub()]), xs([2, 4]), WCS0,
        { margin: 0.1, contacts: { store } });
      const result = { case: "rest undecidable, every swept pose decided", commit: "a53db42e",
        tableRows: { episodes: store.episodes.rows, intervals: store.intervals.rows, gaps: store.gaps.rows },
        notes: r.notes, uncertified: r.uncertified, staticContacts: r.staticContacts,
        meaning: "A gap-only note source has no row from which to preserve this caveat. The rest pose is not a program position." };
      writeFileSync("/tmp/codex-r167-j22yr_df/baseline.json", JSON.stringify(result, null, 2) + "\n");
      expect(store.intervals.rows).toBe(1);
      expect(store.gaps.rows).toBe(0);
      expect(r.staticContacts).toEqual([]);
      expect(r.notes).toEqual(["inside check undecidable for nub ↔ post (L2) — a part wholly inside the other is not found there"]);
      expect(r.uncertified).toBe(r.notes![0]);
    } finally { ctl.when = null; }
  });
});

// The moves after a G43 / an M6, as the REAL parse worker writes them (the
// payloads come from LinuxCNC's native offline interpreter —
// scripts/gen_tool_change_payloads.py) through the client's own decode, the
// scrub track and the collision sweep: the layer the operator's L18 look at
// haus.ngc went wrong in (2026-10-07) and Codex R92 VP-I51 probed.
//
// The machine: a head that moves in Z (joint Z = program Z + the tool offset
// in effect) over a fixed obstacle, both 2 mm cubes.
import * as fs from "node:fs";
import * as path from "node:path";
import * as THREE from "three";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";
import { decodePreviewStreams } from "../previewDecode";
import { buildScrubTrack } from "./scrubTrack";
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from "./collision";

const DIR = path.resolve(__dirname, "../../../scripts/test_fixtures/tool_change_payloads");
const MACHINE: CollisionMachine = {
  groups: [{ id: "table", parent: "root" }, { id: "head", parent: "root" }],
  kinematics: [{ group: "head", joint: 2, type: "translate", direction: "z", sign: 1 }],
  workGroup: "table", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
};
const cube = () => {
  const g = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
  const p = new Float32Array(g.getAttribute("position").array);
  g.dispose();
  return p;
};
const model = (obstacleZ: number) => buildCollisionModel(MACHINE, [
  { id: "obstacle", group: "table", positions: cube(), translate: [0, 0, obstacleZ] },
  { id: "head", group: "head", positions: cube() },
]);

function load(name: string) {
  const raw = msgpackDecode(fs.readFileSync(path.join(DIR, `${name}.msgpack`))) as Record<string, any>;
  const d = decodePreviewStreams(raw);
  const track = buildScrubTrack(d.feed, d.rapid, d.kinsFrames, d.wcsEvents, d.subNames, d.tloEvents)!;
  return { raw, d, track };
}
function sweep(name: string, obstacleZ = 500) {
  const { raw, d, track } = load(name);
  const result = sweepCollisions(model(obstacleZ), track,
    { g5x: [], g92: [], rotationDeg: 0, tool: raw.tlo_start } as any, { margin: 0.1, tloEvents: d.tloEvents });
  return { result, track };
}
const lines = (t: { lines: Uint32Array; count: number }) => Array.from(t.lines.subarray(0, t.count));

describe("the move after a G43 (a relabel, then the real move)", () => {
  it("is timed and swept along its path — an obstacle between two clear ends is found", () => {
    // L5 `G0 Z15` after a G43.1 Z10 under G49: joint Z 40 → 25. The obstacle
    // at Z32 lies only in its middle; L6's feed (25 → 15) never reaches it.
    const { result, track } = sweep("g43_mid", 32);
    expect(lines(track)).toEqual([2, 3, 5, 5, 6]);
    expect(track.brk![2]).toBe(1);
    expect(track.cum[2]).toBe(track.cum[1]);                       // the relabel takes no time
    expect(track.cum[3]! - track.cum[2]!).toBeCloseTo(1.5, 5);     // 15 mm at 10 mm/s
    expect(result.uncertified).toBeNull();
    expect(result.hits.some(h => h.line === 5)).toBe(true);
    // and with the obstacle out of the way, nothing
    expect(sweep("g43_mid").result.hits).toHaveLength(0);
  });
  it("a feed in the G43's block starts at the relabel too", () => {
    // `G43 G1 Z5` (the spindle tool, Z10): joint Z 40 → 15, the obstacle at Z30.
    const { result } = sweep("g43_g1_block", 30);
    expect(result.uncertified).toBeNull();
    expect(result.hits.some(h => h.line === 4)).toBe(true);
  });
});

describe("a move after an M6 the controller moves at (TOOL_CHANGE_POSITION)", () => {
  const NOTE = /^(\d+) moves? after a tool change runs? from a position the preview cannot know — not checked until the position is known again \((.*)\)$/;
  it("is named, never timed or swept as a guessed path — every motion kind", () => {
    for (const [name, n, at] of [["r92_m6_feed", 1, "L4"], ["r92_m6_arc", 1, "L4"], ["r92_m6_g43_feed", 1, "L5"],
                                 ["m6_tc_position", 1, "L4"], ["m6_tc_partial", 2, "L4, L5"]] as const) {
      const { result, track } = sweep(name);
      const m = NOTE.exec(result.uncertified ?? "");
      expect(m, `${name}: ${result.uncertified}`).not.toBeNull();
      expect([Number(m![1]), m![2]], name).toEqual([n, at]);
      for (let i = 1; i < track.count; i++) if (track.ustart?.[i]) expect(track.cum[i], `${name} point ${i}`).toBe(track.cum[i - 1]);
    }
  });
  it("is checked again once the position is known — the rapid after a feed that set every axis", () => {
    const { result, track } = sweep("r92_m6_feed_then_rapid");
    expect(result.uncertified).toMatch(/^1 move after a tool change runs .*\(L4\)$/);
    expect(track.ustart![2]).toBe(0);
    expect(track.cum[2]! - track.cum[1]!).toBeCloseTo(0.5, 5);
  });
  it("an M6 that moves nothing, and the interpreter's own quill-up and G30 moves, stay known", () => {
    for (const name of ["m6_in_place", "r92_m6_quill_g30"]) {
      const { result, track } = sweep(name);
      expect(result.uncertified, name).toBeNull();
      expect(track.cum[track.count - 1]!, name).toBeGreaterThan(0);
    }
  });
});

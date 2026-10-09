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
import { buildEntryTrack, buildScrubTrack } from "./scrubTrack";
import { buildCollisionModel, sweepCollisions, type CollisionMachine } from "./collision";
import { epochTermsFor } from "./wcsEpochs";
import { buildSimRows, limitStopOf } from "./simRows";
import { unknownProgramTools } from "./tloEvents";
import { m600Events, m600ToolNotes, parseProbeStops } from "./probeStop";

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
// The track as the page hands it to the sweep (ThreeViewer's trackCopy): the
// scrub track's per-point WCS epochs travel as `wcs` — without them every
// segment is posed in the first epoch's frame, a rotated one unrotated.
const swept = (track: ReturnType<typeof load>["track"]) => ({ ...track, wcs: track.wcsEpoch });
function sweep(name: string, obstacleZ = 500) {
  const { raw, d, track } = load(name);
  const result = sweepCollisions(model(obstacleZ), swept(track),
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
  it("the mode a block runs in, and a rotated frame, decide what is known again (Codex R93)", () => {
    // A G91 drilling cycle in the block after the change: every one of its
    // moves and the G91 move after it unknown, the lines named once each.
    let r = sweep("r93_inline_g91_cycle");
    expect(r.result.uncertified).toMatch(/^5 moves after a tool change run .*\(L4, L6\)$/);
    for (let i = 1; i < r.track.count; i++) expect(r.track.cum[i]).toBe(r.track.cum[i - 1]);
    // G10 L2 R45, then `X10 Z15`: Y was never commanded — L7 stays unknown.
    r = sweep("r93_rotated_partial");
    expect(r.result.uncertified).toMatch(/^2 moves after a tool change run .*\(L6, L7\)$/);
    // `G90 G0 X10 Y5 Z15` after a G91 move: the next move is known and timed.
    r = sweep("r93_g90_same_block");
    expect(r.result.uncertified).toMatch(/^2 moves after a tool change run .*\(L5, L6\)$/);
    expect(r.track.ustart![3]).toBe(0);
    expect(r.track.cum[3]! - r.track.cum[2]!).toBeCloseTo(1, 5);
  });
  describe("the end of a block decides, and a later rotation counts (Codex R94)", () => {
    // A head that rides X, Y and Z (Codex R94's probe) and a 0.5 mm obstacle
    // in the middle of the path a stale start would invent for the last move.
    const XYZ: CollisionMachine = {
      groups: [{ id: "x", parent: "root" }, { id: "y", parent: "x" }, { id: "head", parent: "y" }, { id: "table", parent: "root" }],
      kinematics: [{ group: "x", joint: 0, type: "translate", direction: "x", sign: 1 },
                   { group: "y", joint: 1, type: "translate", direction: "y", sign: 1 },
                   { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 }],
      workGroup: "table", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
    };
    const small = () => {
      const g = new THREE.BoxGeometry(0.5, 0.5, 0.5).toNonIndexed();
      const p = new Float32Array(g.getAttribute("position").array);
      g.dispose();
      return p;
    };
    function sweepXYZ(name: string, obstacle: [number, number, number]) {
      const { raw, d, track } = load(name);
      const wcs = { g5x: [], g92: [], rotationDeg: 0, tool: raw.tlo_start } as any;
      const result = sweepCollisions(buildCollisionModel(XYZ, [
        { id: "fixed", group: "table", positions: small(), translate: obstacle },
        { id: "head", group: "head", positions: small() },
      ]), swept(track), wcs, { margin: 0.1, tloEvents: d.tloEvents,
        epochTerms: d.wcsEvents?.length ? epochTermsFor(d.wcsEvents, wcs, undefined) : undefined,
        // as the page hands them over (ThreeViewer's sweep options)
        staleOffsetLines: raw.stale_offset_lines, staleOffsetUntracked: raw.stale_offset_untracked });
      return { result, track, last: track.count - 1 };
    }
    it("a G98 cycle returns to the stale height: the next move named, never swept along a guessed path", () => {
      // Believed above R (Codex's case) and below R (the preview retracts to
      // R, the machine to its real height): L6 unknown either way.
      for (const [name, obstacle] of [["r94_g98_cycle", [15, 5, 40]], ["r94_g98_below_r", [15, 5, 2]]] as const) {
        const { result, track, last } = sweepXYZ(name, [...obstacle]);
        expect(result.uncertified, name).toMatch(/^5 moves after a tool change run .*\(L4, L6\)$/);
        expect(track.ustart![last], name).toBe(1);
        expect(track.cum[last], name).toBe(0);
        expect(result.hits, name).toHaveLength(0);
      }
    });
    it("G76 ends on its drive line — the stale X — so the next X move stays unknown", () => {
      const { result, track, last } = sweepXYZ("r94_g76_returns_x", [10, 3, -10]);
      expect(result.uncertified).toMatch(/^23 moves after a tool change run .*\(L5, L6, L7\)$/);
      expect(track.ustart![last]).toBe(1);
      expect(result.hits).toHaveLength(0);
    });
    it("an offset set from the unknown position keeps every later move unknown, and the note says why (Codex R95)", () => {
      // G92 Z10 after the change: the preview's offset is Z30 (from its
      // guessed Z40), the machine's Z20 — L6 would be swept at Z45 against
      // a box the machine never reaches (Codex's obstacle). The absolute L5
      // repairs no offset: L6 stays unknown, the note names L4.
      const END = /not checked to the program's end: the offset set from that position at L4 stays unknown whatever is positioned after/;
      let r = sweepXYZ("r95_g92_from_stale", [15, 5, 45]);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.result.hits).toHaveLength(0);
      expect(r.result.uncertified).toMatch(END);
      // G10 L20 P2 hidden by a G90 (no canon call sees it): it takes effect
      // at G55 — L9 (X20→X30 at Z25, G55's guessed Z30) stays unknown.
      r = sweepXYZ("r95_l20_inactive_hidden", [25, 5, 55]);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.result.hits).toHaveLength(0);
      expect(r.result.uncertified).toMatch(END);
      // An explicit G10 L2 P1 Z30 does not depend on the position: L6 is
      // known, and the box on its real path (Z15 + 30) is a real finding.
      r = sweepXYZ("r95_l2_constant", [15, 5, 45]);
      expect(r.track.ustart![r.last]).toBe(0);
      expect(r.result.hits.some(h => h.line === 6)).toBe(true);
      expect(r.result.uncertified).toMatch(/not checked until the position is known again/);
      // A main file with an o-word loop: the text's order is lost — the G92
      // still reports itself, and the note says what is not tracked.
      r = sweepXYZ("r95_oword_g92", [15, 5, 45]);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.result.uncertified).toMatch(/at L6 stays unknown .*; in subroutines and loops, stored positions \(G28.1 \/ G30.1\) and fixture writes in called files are not tracked$/);
      // A G92 in a called subroutine file: caught by its callback, its line
      // the sub file's — the note names none rather than a wrong one.
      r = sweepXYZ("r95_sub_g92", [15, 5, 45]);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.result.hits).toHaveLength(0);
      expect(r.result.uncertified).toMatch(/not checked to the program's end: an offset set from that position stays unknown whatever is positioned after \(L5, L6\); in subroutines/);
    });
    it("any spelling of the write counts; a branch that never runs writes nothing (Codex R96)", () => {
      // G92.0 is G92: L6 stays unknown, no false hit at Z45, L4 named.
      let r = sweepXYZ("r96_g92_decimal", [15, 5, 45]);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.result.hits).toHaveLength(0);
      expect(r.result.uncertified).toMatch(/the offset set from that position at L4 stays unknown/);
      // `o100 if [0]` around a G92: it never runs — L8 is known and timed
      // again, the note claims no offset line, and says what is untracked.
      r = sweepXYZ("r96_branch_not_run", [100, 100, 100]);
      expect(r.track.ustart![r.last]).toBe(0);
      expect(r.track.cum[r.last]! - r.track.cum[r.last - 1]!).toBeCloseTo(1, 5);
      expect(r.result.uncertified).toMatch(/not checked until the position is known again \(L7\); in subroutines and loops, stored positions \(G28.1 \/ G30.1\) and fixture writes in called files are not tracked$/);
    });
    it("a sign on a number, and a write computed equal to the old value, hide nothing (Codex R97)", () => {
      // G10 L+20 P1 Z10: L6 stays unknown, no false hit at Z45, L4 named.
      let r = sweepXYZ("r97_l_plus_active", [15, 5, 45]);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.result.hits).toHaveLength(0);
      expect(r.result.uncertified).toMatch(/the offset set from that position at L4 stays unknown/);
      // `o100 if [1]` around G92 Z40 at the believed Z40: the old offset again
      // in the preview, -10 on the machine — L8 stays unknown (Codex's box on
      // the preview's Z15 path is not hit), L5 named.
      r = sweepXYZ("r97_branch_same_g92", [15, 5, 15]);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.result.hits).toHaveLength(0);
      expect(r.result.uncertified).toMatch(/the offset set from that position at L5 stays unknown/);
    });
    it("a call into another file is one however it is spelled, and its write names no main-file line (Codex R98)", () => {
      // `o<touch> c a l l` runs touch.ngc's G92 Z40 at the believed Z40: L7
      // stays unknown — Codex's box on the preview's Z15 path is not hit —
      // and the G92 (the sub file's line 2) is named by no main-file line,
      // never by the main file's explicit G10 L2 on line 2 (VP-I56).
      for (const name of ["r98_foreign_plain", "r98_foreign_spaced"]) {
        const r = sweepXYZ(name, [15, 5, 15]);
        expect(r.track.ustart![r.last], name).toBe(1);
        expect(r.result.hits, name).toHaveLength(0);
        expect(r.result.uncertified, name).toMatch(/not checked to the program's end: an offset set from that position stays unknown whatever is positioned after \(L6, L7\); in subroutines/);
        expect(r.result.uncertified, name).not.toMatch(/at L2\b/);
      }
    });
    it("a sign before an expression is a write too (Codex R107 VP-I64)", () => {
      // `G-[-10] L20 P2 Z10` after the change sets the INACTIVE G55 from the
      // unknown position: at G55 every later move stays unknown — no false
      // hit on Codex's box at the preview's L8 path (Z25 + the guessed 30),
      // L4 named; `G-[-28.1]` stores the G28 position from it: the G28 and
      // the move after it (Codex's box at L7) stay unknown, L4 named.
      let r = sweepXYZ("r107_inactive_negative", [25, 5, 55]);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.result.hits).toHaveLength(0);
      expect(r.track.cum[r.last]).toBe(r.track.cum[0]);
      expect(r.result.uncertified).toMatch(/the offset set from that position at L4 stays unknown/);
      r = sweepXYZ("r107_store_negative", [10, 0, 40]);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.result.hits).toHaveLength(0);
      expect(r.result.uncertified).toMatch(/the offset set from that position at L4 stays unknown/);
    });
    it("a main line never excuses its remap body's write (Codex R108 VP-I65)", () => {
      // `G10 L2 P1 X0 M200`: the explicit G10 is no cause, M200's body runs
      // G92 Z10 from the unknown position — L6 stays unknown, no false hit
      // on Codex's box at the preview's Z45 path, L4 named
      // and with a Python remap, whose execute() keeps the main file's name
      // and passes line 0 (Codex R109)
      for (const name of ["r108_explicit_and_remap", "r109_py_explicit_and_remap"]) {
        const r = sweepXYZ(name, [15, 5, 45]);
        expect(r.track.ustart![r.last], name).toBe(1);
        expect(r.result.hits, name).toHaveLength(0);
        expect(r.track.cum[r.last], name).toBe(r.track.cum[0]);
        expect(r.result.uncertified, name).toMatch(/the offset set from that position at L4 stays unknown/);
      }
    });
    it("an o-word whose name is no literal is read as one, never as no o-word (Codex R99)", () => {
      // `o+100 call` runs 100.ngc's G92 Z40: L7 stays unknown, no hit on
      // Codex's box at the preview's Z15, the write named by no main-file line.
      let r = sweepXYZ("r99_o_plus", [15, 5, 15]);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.result.hits).toHaveLength(0);
      expect(r.result.uncertified).toMatch(/an offset set from that position stays unknown whatever is positioned after \(L6, L7\); in subroutines/);
      // `o+100 if [0]` skips its G92: L8 is known and timed again, no offset
      // line claimed (the range scan never ran over the skipped line)
      r = sweepXYZ("r99_plus_skip", [100, 100, 100]);
      expect(r.track.ustart![r.last]).toBe(0);
      expect(r.track.cum[r.last]! - r.track.cum[r.last - 1]!).toBeCloseTo(1, 5);
      expect(r.result.uncertified).toMatch(/not checked until the position is known again \(L7\); in subroutines/);
    });
    it("a rotation after X alone was known keeps the next move unknown; a full target makes it known", () => {
      let r = sweepXYZ("r94_rotated_after_partial", [6.0355339059, 13.1066017178, 15]);
      expect(r.result.uncertified).toMatch(/^3 moves after a tool change run .*\(L4, L6, L7\)$/);
      expect(r.track.ustart![r.last]).toBe(1);
      expect(r.track.cum[r.last]).toBe(0);
      expect(r.result.hits).toHaveLength(0);
      // the full target: L7 known, timed and swept in the rotated frame —
      // an obstacle on its real path R45·(15, 5) is found
      r = sweepXYZ("r94_rotated_complete", [7.0710678, 14.1421356, 15]);
      expect(r.result.uncertified).toMatch(/^2 moves after a tool change run .*\(L4, L6\)$/);
      expect(r.track.ustart![r.last]).toBe(0);
      expect(r.track.cum[r.last]! - r.track.cum[r.last - 1]!).toBeCloseTo(1, 5);
      expect(r.result.hits.some(h => h.line === 7)).toBe(true);
    });
  });
  it("an M6 that moves nothing, and the interpreter's own quill-up and G30 moves, stay known", () => {
    for (const name of ["m6_in_place", "r92_m6_quill_g30"]) {
      const { result, track } = sweep(name);
      expect(result.uncertified, name).toBeNull();
      expect(track.cum[track.count - 1]!, name).toBeGreaterThan(0);
    }
  });
});

describe("the first predicted limit crossing (Codex R96/R97 VP-I55)", () => {
  it("an arc whose ends lie inside the window: the first point beyond it, not the line's start", () => {
    // G2 from Z40 over Z60 back to Z40 under max Z 50, as the native worker
    // writes it: the limit record names L3; the run stops where the arc
    // crosses Z50 — the first point flagged beyond the window, ~9.7 s in.
    const { raw, track } = load("r96_arc_interior_limit");
    expect((raw.violations as { line: number }[]).map(v => v.line)).toEqual([3]);
    const stop = limitStopOf(track)!;
    expect(stop.line).toBe(3);
    expect(stop.cum).toBeGreaterThan(9);
    expect(stop.cum).toBeLessThan(10.5);
    let first = -1;
    for (let i = 0; i < track.count; i++) if (track.lines[i] === 3) { first = i; break; }
    // a contact 1 s into the arc is reached; one past the crossing is not
    const rows = buildSimRows({
      clash: [{ key: "C3|t|w|0", line: 3, cum: 1, cumEnd: 1, a: "tool", b: "w" },
        { key: "C3|t|w|1", line: 3, cum: stop.cum + 1, cumEnd: stop.cum + 1, a: "tool", b: "w", reentry: true }],
      limit: [{ key: "L3", line: 3, cum: track.cum[Math.max(0, first - 1)]!, cumEnd: stop.cum }], tool: [],
      violations: raw.violations, unit: "mm", timeBased: true, axisEnd: track.cum[track.count - 1]!, stop,
    });
    expect(rows.map(r => [r.key, r.note])).toEqual([
      ["L3", "first predicted limit crossing — where the run stops is not determined"],
      ["C3|t|w|0", ""],
      ["C3|t|w|1", "re-entry · after the first limit crossing at L3"],
    ]);
  });
});

describe("a crossing is no stop (Codex R97 VP-I55)", () => {
  it("the same arc at F300: the notes name the crossing and never claim where the run stops", () => {
    // Crossing Z50 at 5 mm/s with 10 mm/s² takes at least 1.25 mm to stop
    // (Codex's bound): a contact just past the crossing may still be run
    // through. The marks say "after the first limit crossing" — a fact —
    // and the crossing row says where the run stops is not determined.
    const { raw, track } = load("r97_arc_braking");
    const stop = limitStopOf(track)!;
    expect(stop.line).toBe(3);
    const rows = buildSimRows({
      clash: [{ key: "C3|t|w|0", line: 3, cum: stop.cum + 0.01, cumEnd: stop.cum + 0.01, a: "tool", b: "w" }],
      limit: [{ key: "L3", line: 3, cum: 0, cumEnd: stop.cum }], tool: [],
      violations: raw.violations, unit: "mm", timeBased: true, axisEnd: track.cum[track.count - 1]!, stop,
    });
    expect(rows.map(r => r.note)).toEqual([
      "first predicted limit crossing — where the run stops is not determined",
      "after the first limit crossing at L3",
    ]);
    for (const r of rows) expect(r.note).not.toMatch(/limit stop|stops (here|in this line) at the latest/);
  });
});

describe("M600 in the preview (docs/reviews/m600-preview.plan.md, Codex R102–R104)", () => {
  // The bundled tool_touch_off.ngc through the M600 remap (native payloads):
  // the setter at X10 Y10 machine Z −180, T2 80 mm long — the fast probe
  // starts at −95 and trips at −100. A head that rides X, Y and Z carrying a
  // cutter (the tool body) and, 5 mm above it, the spindle (a machine body);
  // a 0.5 mm box on the table.
  const XYZ: CollisionMachine = {
    groups: [{ id: "x", parent: "root" }, { id: "y", parent: "x" }, { id: "head", parent: "y" }, { id: "table", parent: "root" }],
    kinematics: [{ group: "x", joint: 0, type: "translate", direction: "x", sign: 1 },
                 { group: "y", joint: 1, type: "translate", direction: "y", sign: 1 },
                 { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 }],
    workGroup: "table", toolGroup: "head", unitScale: 1, axes: ["X", "Y", "Z"],
  };
  const small = () => {
    const g = new THREE.BoxGeometry(0.5, 0.5, 0.5).toNonIndexed();
    const p = new Float32Array(g.getAttribute("position").array);
    g.dispose();
    return p;
  };
  // T2's table row as the gateway's parse_tlos would carry it ([id, xo, yo, zo, diameter])
  function sweepM600(name: string, obstacle: [number, number, number], t2Length: number) {
    const { raw, d, track } = load(name);
    const wcs = { g5x: [], g92: [], rotationDeg: 0, tool: raw.tlo_start } as any;
    const result = sweepCollisions(buildCollisionModel(XYZ, [
      { id: "fixed", group: "table", positions: small(), translate: obstacle },
      { id: "cutter", group: "head", positions: small(), tool: true },
      { id: "spindle", group: "head", positions: small(), translate: [0, 0, 5] },
    ]), swept(track), wcs, { margin: 0.1, tloEvents: d.tloEvents,
      // as the page hands them over (ThreeViewer's sweep options)
      probeStops: parseProbeStops(raw.probe_unpredicted),
      unknownTools: unknownProgramTools(d.tloEvents, [[1, 0, 0, 10, 6], [2, 0, 0, t2Length, 6]]) });
    return { raw, result, track, last: track.count - 1 };
  }
  const pairs = (r: { hits: { a: string; b: string }[] }) => [...new Set(r.hits.map(h => [h.a, h.b].sort().join("×")))].sort();

  it("a predicted measurement is swept along the probe's path, with the new tool", () => {
    // the box at the trip point's height under the setter: the cutter meets
    // it on the fast probe's way down, the spindle 5 mm later never does
    const { result, track } = sweepM600("m600_known", [10, 10, -99], 80);
    expect(result.uncertified).toBeNull();
    expect(track.unpredicted).toBeUndefined();
    expect(pairs(result)).toEqual(["cutter×fixed"]);
    expect(result.hits.every(h => !h.rapid)).toBe(true);
    // the probe moves take their feeds' time: 5 mm at 2000 mm/min
    const zs = Array.from({ length: track.count }, (_, i) => track.pos[i * 3 + 2]!);
    const at = zs.indexOf(-95);
    expect(track.cum[at + 1]! - track.cum[at]!).toBeCloseTo(5 / (2000 / 60), 4);
  });

  it("an unknown length: the machine is checked on the way down, the tool is not — and nothing after the probe's start", () => {
    // the box 15 mm under machine Z0 at the setter: on the way down to the
    // probe start (−30) both bodies pass it — only the spindle is checked
    const { result, track, last } = sweepM600("m600_length_unknown", [10, 10, -15], 0);
    expect(pairs(result)).toEqual(["fixed×spindle"]);
    const notes = result.notes ?? [];
    expect(notes).toContain("Tool measurement not predicted (T2 has no length in the table) — 1 move after it not checked to the program's end (L4)");
    expect(notes.some(n => /^T2 has no length in the table: its own contacts are not checked/.test(n))).toBe(true);
    // the move after the stop: an unknown start, no time, flagged
    expect(track.unpredicted![last]).toBe(1);
    expect(track.ustart![last]).toBe(1);
    expect(track.cum[last]).toBe(track.cum[last - 1]);
    expect(Array.from(track.unpredicted!.subarray(0, last))).toEqual(new Array(last).fill(0));
    // with T2's length known the same descent finds the cutter too
    expect(pairs(sweepM600("m600_length_unknown", [10, 10, -15], 80).result)).toEqual(["cutter×fixed", "fixed×spindle"]);
  });

  it("unknown toolsetter values: the routine is not run in the preview, nothing from its start is checked", () => {
    // the gateway cannot vouch for the values the routine reads: it returns at
    // once (tool_touch_off.ngc -0-) — no tool change, no move of its own —
    // and the program goes on from an unknown position
    const { raw, result, track } = sweepM600("m600_basis_unknown", [10, 10, -15], 80);
    expect(result.hits).toHaveLength(0);
    expect(raw.tool_change_lines).toEqual([]);
    expect(result.notes).toContain(
      "Tool measurement not predicted (the toolsetter values are not confirmed) — 1 move after it not checked to the program's end (L4)");
    for (let i = 1; i < track.count; i++) expect(track.cum[i]).toBe(track.cum[0]);
  });

  it("a move past the limit after the stop is no finding, and takes no time", () => {
    const { raw, track, last } = sweepM600("m600_unknown_then_high", [500, 500, 500], 0);
    expect(raw.violations).toEqual([]);
    expect(track.unpredicted![last]).toBe(1);
    expect(track.cum[last]).toBe(track.cum[last - 1]);
  });

  // Codex R105 VP-I62: the routine before the program's first drawn point
  // (unknown values): that point is already after the stop — the sim's entry
  // move from the live position must not make it a timed, swept rapid.
  it("no entry move to a first point after the stop", () => {
    const entry = (name: string) => {
      const { raw, track } = load(name);
      const wcs = { g5x: [], g92: [], rotationDeg: 0, tool: raw.tlo_start } as any;
      return { track, entry: buildEntryTrack(track, [0, 0, 0], ["X", "Y", "Z"], wcs, undefined, undefined, 0,
                                             { linear: raw.rapid_rate, rotary: raw.rot_rapid_rate }) };
    };
    const { track, entry: e } = entry("m600_unknown_first");
    expect(Array.from(track.unpredicted!.subarray(0, track.count))).toEqual(new Array(track.count).fill(1));
    expect(e).toBeNull();
    // swept as the page does without an entry: Codex's box on the entry's
    // line is no finding, and the program takes no time
    const { result } = sweepM600("m600_unknown_first", [30, 30, -50], 80);
    expect(result.hits).toHaveLength(0);
    expect(track.cum[track.count - 1]).toBe(track.cum[0]);
    // positive control: a first point before the routine gets its entry move
    const known = entry("m600_known");
    expect(known.entry).not.toBeNull();
    expect(known.entry!.count).toBe(known.track.count + 1);
  });

  // Codex R105 VP-I63: a note belongs to its call. The native events carry
  // the call line the interpreter ran (Codex R107): the only M600 line (L3)
  // for m600_known; each call its own where two lines call the routine — the
  // same tool's success and stop never share a row.
  const notesOf = (name: string) => {
    const { raw } = load(name);
    return m600ToolNotes(m600Events(parseProbeStops(raw.probe_unpredicted), raw.toollen_table, "mm"));
  };
  it("binds a measurement's note to its own call, natively", () => {
    const known = notesOf("m600_known");
    expect([...known.byLine]).toEqual([[3, { tool: 2, note: "80.000 mm from the table (assumed)" }]]);
    expect(known.unbound).toEqual([]);
    const rep = notesOf("m600_repeat");
    expect([...rep.byLine.keys()]).toEqual([3, 6]);
    expect(rep.byLine.get(3)).toEqual({ tool: 2, note: "80.000 mm from the table (assumed)" });
    expect(rep.byLine.get(6)!.tool).toBe(2);
    expect(rep.byLine.get(6)!.note).not.toMatch(/80\.000/);
    expect(rep.unbound).toEqual([]);
  });

  // Codex R107 (its `sequence_named_body`): M200's body runs `o<m600> call`
  // at L3 — the note and the tool change are L3's, never the T2 M600 after
  // M2 (L6) the text alone took for the one site.
  it("a routine another remap's body runs is that remap's line", () => {
    const { raw } = load("m600_via_other_remap");
    expect(raw.tool_change_lines).toEqual([[3, 2]]);
    const n = notesOf("m600_via_other_remap");
    expect([...n.byLine.keys()]).toEqual([3]);
    expect(n.unbound).toEqual([]);
  });

  // Codex R107 VP-I61 (its probe, verbatim): M200 → `T2 M600` → a foreign
  // M600 whose `G53 G0 Z0` is on ITS line 2, after the main program's line
  // 2 — the interpreter fired no next_line there, and the body's move was
  // swept: 10 s and a collision at L2 against a box at (50, 50, −50).
  it("a foreign M600 inside another remap: its first move is already unknown", () => {
    const { raw, result, track, last } = sweepM600("foreign_remap_nested", [50, 50, -50], 80);
    expect(result.hits).toHaveLength(0);
    expect(track.cum[last]).toBe(track.cum[0]);
    const zs = Array.from({ length: track.count }, (_, i) => track.pos[i * 3 + 2]!);
    const body = zs.indexOf(0);
    expect(body).toBeGreaterThan(0);
    expect(track.ustart![body]).toBe(1);
    expect(track.unpredicted![body]).toBe(1);
    expect(raw.probe_unpredicted[0][2]).toBe("foreign_remap");
  });
});

// Unit tests for viewer/partFrame.ts — the rotary-aware preview transform.
// The machines under test mirror real machine.json content: the shipped
// 3-axis PM-25MV config and the XYZAC trunnion sim (machine-xyzac).
import { describe, expect, it } from "vitest";
import {
  transformToPartFrame, chainsHaveRotary, buildLineMap,
  type PartFrameMachine, type PartFrameWcs,
} from "./partFrame";

const WCS0: PartFrameWcs = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 };

// Shipped 3-axis default (lcnc-gateway/machine/machine.json).
const MILL3: PartFrameMachine = {
  groups: [
    { id: "x", parent: "root" },
    { id: "y", parent: "root" },
    { id: "z", parent: "y" },
    { id: "tool", parent: "z" },
  ],
  kinematics: [
    { group: "x", joint: 0, direction: "x", sign: -1 },
    { group: "y", joint: 1, direction: "y", sign: 1 },
    { group: "z", joint: 2, direction: "z", sign: 1 },
  ],
  workGroup: "x",
  toolGroup: "tool",
  unitScale: 1,
  axes: ["X", "Y", "Z"],
};

// XYZAC trunnion knee mill (examples/sim_config/machine-xyzac/machine.json).
const TRUNNION: PartFrameMachine = {
  groups: [
    { id: "knee", parent: "root", translate: [0, 0, 200] },
    { id: "saddle", parent: "knee" },
    { id: "table", parent: "saddle" },
    { id: "a_assembly", parent: "table", translate: [0, 20, 10] },
    { id: "c_assembly", parent: "a_assembly", translate: [0, -20, -10] },
    { id: "c_platter", parent: "c_assembly" },
    { id: "tool", parent: "root", translate: [0, 0, 200] },
  ],
  kinematics: [
    { group: "table", joint: 0, type: "translate", direction: "x", sign: -1 },
    { group: "saddle", joint: 1, type: "translate", direction: "y", sign: -1 },
    { group: "knee", joint: 2, type: "translate", direction: "z", sign: -1 },
    { group: "a_assembly", joint: 3, type: "rotate", direction: "x", sign: 1 },
    { group: "c_platter", joint: 4, type: "rotate", direction: "z", sign: 1 },
  ],
  workGroup: "c_platter",
  toolGroup: "tool",
  unitScale: 1,
  // JOINT-ordered letters: on XYZAC, joint 4 is C (canonical axis 5) — the
  // exact joint↔axis divergence the mapping exists for.
  axes: ["X", "Y", "Z", "A", "C"],
};

function poly(points: number[][], abc?: number[][], lines?: number[]) {
  return {
    pos: new Float32Array(points.flat()),
    abc: new Float32Array((abc ?? points.map(() => [0, 0, 0])).flat()),
    lines: lines ? new Uint32Array(lines) : undefined,
  };
}

function vec(out: Float32Array, i: number): [number, number, number] {
  return [out[i * 3]!, out[i * 3 + 1]!, out[i * 3 + 2]!];
}

describe("chainsHaveRotary", () => {
  it("is false for a pure-linear machine and true for the trunnion", () => {
    expect(chainsHaveRotary(MILL3)).toBe(false);
    expect(chainsHaveRotary(TRUNNION)).toBe(true);
  });
});

describe("transformToPartFrame", () => {
  it("is the identity on a linear-chain machine", () => {
    const input = poly([[0, 0, 0], [10, -5, 3], [-80, 40, -20]], undefined, [1, 2, 3]);
    const r = transformToPartFrame(MILL3, WCS0, input);
    expect(Array.from(r.pos)).toEqual(Array.from(input.pos));
    expect(Array.from(r.lines!)).toEqual([1, 2, 3]);
  });

  it("is the identity on the trunnion while rotaries hold still", () => {
    const input = poly([[0, 0, 0], [50, 30, -10], [-100, -60, 40]]);
    const r = transformToPartFrame(TRUNNION, WCS0, input);
    for (let i = 0; i < 3; i++) {
      const [x, y, z] = vec(r.pos, i);
      expect(x).toBeCloseTo(input.pos[i * 3]!, 3);
      expect(y).toBeCloseTo(input.pos[i * 3 + 1]!, 3);
      expect(z).toBeCloseTo(input.pos[i * 3 + 2]!, 3);
    }
  });

  it("collapses a C-tracking circle to a fixed point on the platter", () => {
    // XY circle of radius 40 with C following the angle — the physical path
    // on the rotating platter is a single point at (R, 0, 0). 1° segments so
    // linear-chord interpolation error (40·(1−cos 0.5°) ≈ 0.0015) stays below
    // the assertion tolerance — matching real programs, which tessellate far
    // finer than the subdivision step.
    const pts: number[][] = [];
    const abc: number[][] = [];
    for (let d = 0; d <= 360; d += 1) {
      const r = (d * Math.PI) / 180;
      pts.push([40 * Math.cos(r), 40 * Math.sin(r), 0]);
      abc.push([0, 0, d]);
    }
    const out = transformToPartFrame(TRUNNION, WCS0, poly(pts, abc));
    for (let i = 0; i < out.pos.length / 3; i++) {
      const [x, y, z] = vec(out.pos, i);
      expect(x).toBeCloseTo(40, 2);
      expect(y).toBeCloseTo(0, 2);
      expect(z).toBeCloseTo(0, 2);
    }
  });

  it("rotates a fixed tool point around the platter on a pure C sweep", () => {
    // Tool parked at work X+10 while C turns +90°: in platter coordinates the
    // contact point swings to (0, -10, 0).
    const out = transformToPartFrame(
      TRUNNION, WCS0,
      poly([[10, 0, 0], [10, 0, 0]], [[0, 0, 0], [0, 0, 90]]),
    );
    const last = vec(out.pos, out.pos.length / 3 - 1);
    expect(last[0]).toBeCloseTo(0, 3);
    expect(last[1]).toBeCloseTo(-10, 3);
    expect(last[2]).toBeCloseTo(0, 3);
  });

  it("subdivides by rotary delta and labels samples with the segment's source line", () => {
    const out = transformToPartFrame(
      TRUNNION, WCS0,
      poly([[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 90]], [7, 8]),
      4,
    );
    const n = out.pos.length / 3;
    expect(n).toBe(1 + Math.ceil(90 / 4));  // first vertex + subdivided segment
    expect(out.lines![0]).toBe(7);
    for (let i = 1; i < n; i++) expect(out.lines![i]).toBe(8);
    const map = buildLineMap(out.lines);
    expect(map.get(8)).toEqual({ start: 1, end: n - 1 });
  });

  it("stays finite when the live WCS hasn't arrived yet (empty offset arrays)", () => {
    // Fresh-page-load race: preview can beat the first status tick, so g5x/g92
    // may be empty. Regression: a bare [0]! produced NaN → invisible geometry.
    const out = transformToPartFrame(
      TRUNNION, { g5x: [], g92: [], rotationDeg: 0 },
      poly([[10, 5, -3], [10, 5, -3]], [[0, 0, 0], [0, 0, 90]]),
    );
    for (let i = 0; i < out.pos.length; i++) expect(Number.isFinite(out.pos[i])).toBe(true);
  });

  it("depends on the live WCS origin (pivot position relative to work zero)", () => {
    // Same program, origin shifted +5 in X: with C at 90° the transformed
    // point moves — the part-frame path is WCS-dependent by construction.
    const at0 = transformToPartFrame(TRUNNION, WCS0, poly([[0, 0, 0]], [[0, 0, 90]]));
    const at5 = transformToPartFrame(
      TRUNNION, { g5x: [5, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 },
      poly([[0, 0, 0]], [[0, 0, 90]]),
    );
    expect(vec(at0.pos, 0)).not.toEqual(vec(at5.pos, 0));
    // Regression values (hand-derived): machine X=5 → platter sees the tool at
    // (0,-5) after the +90° turn; peeling the origin gives (-5,-5,0).
    expect(vec(at5.pos, 0)[0]).toBeCloseTo(-5, 3);
    expect(vec(at5.pos, 0)[1]).toBeCloseTo(-5, 3);
    expect(vec(at5.pos, 0)[2]).toBeCloseTo(0, 3);
  });
});

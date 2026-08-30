import { describe, it, expect } from "vitest";
import { activeFixturePose } from "./activeFixtureFrame";
import { twpPlaneForSample } from "./twpPlaneFrame";
import { specFromWire } from "./kins";

// The trsrn spec the plane-overlay tests use (machine-xyzacb-trsrn wire shape).
const SPEC = specFromWire({
  type: "xyzacb-trsrn",
  params: {
    y_pivot: 50, z_pivot: 120, x_offset: 0, y_offset: 0,
    y_rot_axis: -1000, z_rot_axis: -2000, nut_angle: 55,
  },
});

describe("activeFixturePose", () => {
  it("identity: g5x + Rz(θ)·g92, basis Rz(θ) — the applyState anchor formula", () => {
    const p = activeFixturePose({ g5x: [10, 20, 30], g92: [1, 0, 0], rotationDeg: 90, kinsType: 0, g5xIndex: 1 })!;
    expect(p.pos[0]).toBeCloseTo(10, 9);
    expect(p.pos[1]).toBeCloseTo(21, 9);
    expect(p.pos[2]).toBeCloseTo(30, 9);
    expect(p.x[0]).toBeCloseTo(0, 9); expect(p.x[1]).toBeCloseTo(1, 9);
    expect(p.z).toEqual([0, 0, 1]);
  });

  it("no switchable kins (kinsType null) reads as identity", () => {
    const p = activeFixturePose({ g5x: [1, 2, 3], g92: null, kinsType: null, g5xIndex: 1 })!;
    expect(p.pos).toEqual([1, 2, 3]);
  });

  it("TCP with an operator fixture: the numbers are table-frame — drawn as they are", () => {
    const p = activeFixturePose({ g5x: [5, 6, 7], g92: [0, 0, 0], kinsType: 1, g5xIndex: 2 })!;
    expect(p.pos).toEqual([5, 6, 7]);
  });

  it("Plane mode + G59: the plane overlay's origin and basis, not the raw numbers", () => {
    const frame = [0.3, 130.2455, -40.8555];
    const g5x = [1331.13, -1186.21, 74.13];   // the live TOOL-frame numbers
    const p = activeFixturePose({ g5x, g92: [0, 0, 0], kinsType: 2, g5xIndex: 6, frame, a: 0, spec: SPEC })!;
    const ov = twpPlaneForSample({ spec: SPEC, kinstype: 2, frame, g5x, g92: [0, 0, 0], rotationDeg: 0, a: 0 })!;
    for (let i = 0; i < 3; i++) expect(p.pos[i]).toBeCloseTo(ov[i]!, 9);
    for (let i = 0; i < 3; i++) expect(p.z[i]).toBeCloseTo(ov[3 + i]!, 9);
    // …and it is NOT where the raw numbers would have put it.
    expect(Math.hypot(p.pos[0] - g5x[0]!, p.pos[1] - g5x[1]!, p.pos[2] - g5x[2]!)).toBeGreaterThan(1);
    // Orthonormal, right-handed.
    const dot = p.x[0] * p.z[0] + p.x[1] * p.z[1] + p.x[2] * p.z[2];
    expect(Math.abs(dot)).toBeLessThan(1e-9);
    expect(Math.hypot(...p.y)).toBeCloseTo(1, 9);
  });

  it("Plane mode + G59 without a frame trio or spec: null — hide, never guess", () => {
    expect(activeFixturePose({ g5x: [1, 2, 3], g92: null, kinsType: 2, g5xIndex: 6, frame: null, spec: SPEC })).toBeNull();
    expect(activeFixturePose({ g5x: [1, 2, 3], g92: null, kinsType: 2, g5xIndex: 6, frame: [0, 0, 0], spec: null })).toBeNull();
  });

  it("Plane mode with an operator fixture selected draws the numbers as they are", () => {
    // The touch-off policy never routes here; the DRO shows these numbers.
    const p = activeFixturePose({ g5x: [1, 2, 3], g92: null, kinsType: 2, g5xIndex: 1, frame: [0, 0, 0], spec: SPEC })!;
    expect(p.pos).toEqual([1, 2, 3]);
  });

  it("no g5x yet (pre-first-status) → null", () => {
    expect(activeFixturePose({ g5x: null, g92: null })).toBeNull();
  });
});

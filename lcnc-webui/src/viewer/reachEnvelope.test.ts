// Unit tests for viewer/reachEnvelope.ts — the reachable-volume outlines.
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { computeReach, HullSolid, sweepAboutAxis } from "./reachEnvelope";
import type { PartFrameMachine } from "./partFrame";

// Shipped 3-axis default (moving-table X, head Z).
const MILL3: PartFrameMachine = {
  groups: [
    { id: "x", parent: "root" }, { id: "y", parent: "root" }, { id: "z", parent: "y" }, { id: "tool", parent: "z" },
  ],
  kinematics: [
    { group: "x", joint: 0, direction: "x", sign: -1 },
    { group: "y", joint: 1, direction: "y", sign: 1 },
    { group: "z", joint: 2, direction: "z", sign: 1 },
  ],
  workGroup: "x", toolGroup: "tool", unitScale: 1, axes: ["X", "Y", "Z"],
};

// Tool-side B head on a Z ram, work carries X/Y.
const BHEAD: PartFrameMachine = {
  groups: [
    { id: "work", parent: "root" }, { id: "z", parent: "root" }, { id: "b_head", parent: "z" }, { id: "tool", parent: "b_head" },
  ],
  kinematics: [
    { group: "work", joint: 0, type: "translate", direction: "x", sign: -1 },
    { group: "work", joint: 1, type: "translate", direction: "y", sign: -1 },
    { group: "z", joint: 2, type: "translate", direction: "z", sign: 1 },
    { group: "b_head", joint: 3, type: "rotate", direction: "y", sign: 1 },
  ],
  workGroup: "work", toolGroup: "tool", unitScale: 1, axes: ["X", "Y", "Z", "B"],
};

// Table-rotary-tilting: XYZ table, A tilt (about X) carrying a C platter
// (about Z), tool fixed under root; no static offsets so the sweeps turn
// about the frame origin and the expectations stay in the head.
const TRT: PartFrameMachine = {
  groups: [
    { id: "table", parent: "root" }, { id: "a", parent: "table" }, { id: "c", parent: "a" }, { id: "tool", parent: "root" },
  ],
  kinematics: [
    { group: "table", joint: 0, type: "translate", direction: "x", sign: -1 },
    { group: "table", joint: 1, type: "translate", direction: "y", sign: -1 },
    { group: "table", joint: 2, type: "translate", direction: "z", sign: -1 },
    { group: "a", joint: 3, type: "rotate", direction: "x", sign: 1 },
    { group: "c", joint: 4, type: "rotate", direction: "z", sign: 1 },
  ],
  workGroup: "c", toolGroup: "tool", unitScale: 1, axes: ["X", "Y", "Z", "A", "C"],
};

function extents(tris: Float32Array): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) for (let k = 0; k < 3; k++) {
    if (tris[i + k]! < min[k]!) min[k] = tris[i + k]!;
    if (tris[i + k]! > max[k]!) max[k] = tris[i + k]!;
  }
  return { min, max };
}
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe("computeReach — room tip reach", () => {
  it("3-axis: the travel box shifted down by the tool length; no part sweep", () => {
    const r = computeReach(MILL3, [[-100, 100], [-50, 50], [-80, 0]], [0, 0, 20]);
    const e = extents(r.roomTris);
    expect(e.min.map(x => Math.round(x))).toEqual([-100, -50, -100]);
    expect(e.max.map(x => Math.round(x))).toEqual([100, 50, -20]);
    expect(r.partTris).toBeNull();
    expect(r.info.samples).toBe(1);
    expect(r.info.corners).toBe(8);
    expect(r.info.notes).toEqual([]);
    expect(r.room.contains(v(0, 0, -50))).toBe(true);
    expect(r.room.contains(v(0, 0, -10))).toBe(false);   // above the tip ceiling
  });

  it("a tilting head sweeps the tip sideways and up: the box grows by the lever", () => {
    // TLO 30 under a B head at joint z ∈ [-50, 0]: straight down the tip is
    // at z − 30; at B = ±90° it is level with the pivot and 30 mm sideways.
    const r = computeReach(BHEAD, [[-100, 100], [-100, 100], [-50, 0], [-90, 90]], [0, 0, 30]);
    const e = extents(r.roomTris);
    expect(Math.round(e.min[0]!)).toBe(-130);
    expect(Math.round(e.max[0]!)).toBe(130);
    expect(Math.round(e.min[2]!)).toBe(-80);
    expect(e.max[2]!).toBeCloseTo(0, 2);   // the hull input is jittered 1e-3
    expect(r.info.samples).toBeGreaterThan(30);
    expect(r.partTris).toBeNull();
  });

  it("refuses a box without finite limits, loudly", () => {
    expect(() => computeReach(MILL3, [[-100, 100], null, [-80, 0]], [0, 0, 0])).toThrow(/joint 1 has no finite soft limits/);
  });
});

describe("sweepAboutAxis", () => {
  // A slab above the X axis: x ∈ [-10, 10], y ∈ [-1, 1], z ∈ [5, 10].
  const slab = new HullSolid([
    v(-10, -1, 5), v(10, -1, 5), v(-10, 1, 5), v(10, 1, 5), v(-10, -1, 10), v(10, -1, 10), v(-10, 1, 10), v(10, 1, 10),
  ]);
  it("a ±90° sweep about X makes a half annulus (radius 5..10) open toward −Z", () => {
    const s = sweepAboutAxis(slab, v(1, 0, 0), -Math.PI / 2, Math.PI / 2, 16, 180);
    expect(s.contains(v(0, 0, 7))).toBe(true);     // the slab itself
    expect(s.contains(v(0, 8, 0))).toBe(true);     // turned to +Y
    expect(s.contains(v(0, -8, 0))).toBe(true);    // and to −Y
    expect(s.contains(v(0, 0, -8))).toBe(false);   // 180° is outside the window
    expect(s.contains(v(0, 0, 3))).toBe(false);    // inside the hole
    expect(s.contains(v(0, 0, 12))).toBe(false);   // beyond the outer radius
    expect(s.contains(v(11, 0, 7))).toBe(false);   // beyond the axial extent
    expect(s.mesh().length).toBeGreaterThan(0);
  });
  it("a full turn covers every direction", () => {
    const s = sweepAboutAxis(slab, v(1, 0, 0), 0, 2 * Math.PI, 16, 180);
    expect(s.contains(v(0, 0, -8))).toBe(true);
    expect(s.contains(v(0, 0, 3))).toBe(false);
    const [lo, hi] = s.extent(v(0, 0, 1));
    expect(lo).toBeCloseTo(-10, 0);
    expect(hi).toBeCloseTo(10, 0);
  });
});

describe("computeReach — part reach through the table rotaries", () => {
  it("A ±90 then a full C turn: the slab's reach becomes a solid of revolution with the hole kept", () => {
    // Table box: x ∈ [-10, 10], y ∈ [-1, 1], z ∈ [5, 10] (relative motion —
    // the table joints carry the work, so joint signs cancel in the box).
    const lim = [[-10, 10], [-1, 1], [5, 10], [-90, 90], [-360, 360]];
    const r = computeReach(TRT, lim, [0, 0, 0], { slices: 24, rays: 180 });
    expect(r.partTris).not.toBeNull();
    const p = r.part!;
    expect(p.contains(v(0, 0, 7))).toBe(true);     // the identity pose is in the sweep
    expect(p.contains(v(0, 8, 0))).toBe(true);     // A turned the slab to +Y …
    expect(p.contains(v(8, 0, 0))).toBe(true);     // … and C turned that to +X
    expect(p.contains(v(0, 0, -8))).toBe(false);   // never the underside (A stops at ±90)
    expect(p.contains(v(0, 0, 3))).toBe(false);    // the hole survives both sweeps
    expect(r.info.notes).toEqual([]);
    expect(r.partTris!.length).toBeGreaterThan(0);
  });
});

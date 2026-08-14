// Unit tests for viewer/collision.ts — synthetic machines with box bodies.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  buildCollisionModel, sweepCollisions, toolCylinderPositions,
  type CollisionBody, type CollisionMachine,
} from "./collision";
import type { ScrubTrack } from "../ws/bulkData";

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
  };
}

// Plunge mill: tool box rides a Z-driven tool group above a work box on an
// X-driven table. Tool group base z=50, box half-size 5 → tool bottom at
// 40+Z; work box top at +5. Contact at Z=-35, margin 2 breached below Z=-33.
const PLUNGE: CollisionMachine = {
  groups: [
    { id: "table", parent: "root" },
    { id: "head", parent: "root", translate: [0, 0, 50] },
  ],
  kinematics: [
    { group: "table", joint: 0, type: "translate", direction: "x", sign: 1 },
    { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 },
  ],
  workGroup: "table",
  toolGroup: "head",
  unitScale: 1,
  axes: ["X", "Y", "Z"],
};
const PLUNGE_BODIES: CollisionBody[] = [
  { id: "vise", group: "table", positions: boxPositions(10) },
  { id: "spindle", group: "head", positions: boxPositions(10) },
];

describe("buildCollisionModel", () => {
  it("labels sides and builds only tool×work pairs", () => {
    const m = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    expect(m.bodies.map(b => b.side)).toEqual(["work", "tool"]);
    expect(m.pairs).toEqual([[1, 0]]);
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
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -45]], undefined, [7, 8]), WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(1);
    const h = r.hits[0]!;
    expect(h.line).toBe(8);
    expect(h.a).toBe("spindle");
    expect(h.b).toBe("vise");
    // Worst sample is the deepest: penetration → distance 0.
    expect(h.dist).toBeCloseTo(0, 5);
    expect(h.rapid).toBe(false);
  });

  it("marks contacts that happen during a rapid segment", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -45]], undefined, [7, 8], [0, 1]), WCS0, { margin: 2 });
    expect(r.hits[0]!.rapid).toBe(true);
  });

  it("stays silent on a clear traverse", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, track(
      [[-100, 0, 0], [100, 0, 0]]), WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(0);
    expect(r.samples).toBeGreaterThan(10);  // linear subdivision actually ran
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
        { id: "spindle", parent: "root", translate: [0, 20, 0] },
      ],
      kinematics: [{ group: "platter", joint: 0, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "platter",
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
    expect(r.samples).toBe(1);  // only the seed sample before the first segment
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

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
    lineCum: new Map(),
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
  it("derives pairs from relative motion, tool-side body first", () => {
    const m = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    expect(m.bodies.map(b => b.side)).toEqual(["work", "tool"]);
    expect(m.pairs).toEqual([[1, 0]]);
  });

  it("skips rigid pairs (same group / no DOF between) and includes DOF-crossing ones", () => {
    // Two bodies on the head group are rigid to each other; a body on a
    // static frame group still pairs with both movers (DOFs on their side).
    const machine = {
      ...PLUNGE,
      groups: [...PLUNGE.groups, { id: "frame", parent: "root" }],
    };
    const m = buildCollisionModel(machine, [
      ...PLUNGE_BODIES,
      { id: "spindle2", group: "head", positions: boxPositions(4) },
      { id: "column", group: "frame", positions: boxPositions(4) },
    ]);
    const key = (p: [number, number]) => [m.bodies[p[0]]!.id, m.bodies[p[1]]!.id].sort().join("/");
    const pairKeys = m.pairs.map(key).sort();
    // NOT present: spindle/spindle2 (same group).
    expect(pairKeys).toEqual([
      "column/spindle", "column/spindle2", "column/vise",
      "spindle/vise", "spindle2/vise",
    ].sort());
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
    // Plunge to -43: head-box bottom (45+Z) meets vise top (+5) at Z=-40,
    // which falls BETWEEN samples (43/9 ≈ 4.78 mm steps) — the discovering
    // sample sits ~3 mm deep in penetration.
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43]], undefined, [7, 8]), WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(1);
    const h = r.hits[0]!;
    expect(h.line).toBe(8);
    expect(h.a).toBe("spindle");
    expect(h.b).toBe("vise");
    // Worst sample is the deepest: penetration → distance 0.
    expect(h.dist).toBeCloseTo(0, 5);
    expect(h.rapid).toBe(false);
    // Contact refinement: scrub-to-hit lands at FIRST TOUCH (cum 40), not
    // at the sample that discovered the penetration (cum ≈ 43).
    expect(h.cum).toBeCloseTo(40, 2);
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
    expect(r.samples).toBe(1);  // only the baseline pose before the first segment
  });

  it("moves pairs in contact at the first pose to staticContacts instead of flooding lines", () => {
    // A table-mounted body overlapping the head box AT THE START pose plays
    // the role of a mechanical joint (slides/bearings sit inside the margin
    // permanently). Baseline subtraction must report it once and exclude it
    // from the sweep, while the genuine plunge hit still reports per-line.
    const withDrawbar: CollisionBody[] = [
      ...PLUNGE_BODIES,
      { id: "drawbar", group: "table", positions: boxPositions(10), translate: [0, 0, 50] },
    ];
    const model = buildCollisionModel(PLUNGE, withDrawbar);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -45]], undefined, [7, 8]), WCS0, { margin: 2 });
    expect(r.staticContacts.map(c => [c.a, c.b].sort().join("/"))).toContain("drawbar/spindle");
    // No per-line hits for the static pair …
    expect(r.hits.every(h => [h.a, h.b].sort().join("/") !== "drawbar/spindle")).toBe(true);
    // … while the genuine plunge hit is still attributed normally.
    expect(r.hits.some(h => [h.a, h.b].sort().join("/") === "spindle/vise")).toBe(true);
  });

  it("detects collisions with root-attached static frame bodies", () => {
    // Ungrouped machine.json parts (column, base, spindle housing) map to
    // the implicit root node. A frame obstacle in the head's plunge path
    // must be hit — dropping these bodies blinded the sweep to frame
    // collisions the scrub visuals showed plainly.
    const withFrame: CollisionBody[] = [
      ...PLUNGE_BODIES,
      { id: "base_spindle", group: "root", positions: boxPositions(10), translate: [0, 0, 20] },
    ];
    const model = buildCollisionModel(PLUNGE, withFrame);
    // Frame body pairs with both movers (their DOFs sit below the LCA).
    const key = (p: [number, number]) => [model.bodies[p[0]]!.id, model.bodies[p[1]]!.id].sort().join("/");
    expect(model.pairs.map(key).sort()).toContain("base_spindle/spindle");
    // Head box [45+Z, 55+Z] reaches the obstacle top (z=25) at Z=-20.
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43]], undefined, [7, 8]), WCS0, { margin: 2 });
    const frameHit = r.hits.find(h => [h.a, h.b].sort().join("/") === "base_spindle/spindle");
    expect(frameHit).toBeTruthy();
    expect(frameHit!.cum).toBeCloseTo(20, 2);  // refined to first touch
  });

  it("catches a same-side pair that straddles a DOF (v1 scope gap closed)", () => {
    // Pillar on a C platter vs a post on the table it sits on: both "work"
    // side, C DOF between them. The sweep must flag the rotary clash.
    const machine: CollisionMachine = {
      groups: [
        { id: "table", parent: "root" },
        { id: "platter", parent: "table" },
        { id: "head", parent: "root", translate: [0, 0, 500] },  // far away
      ],
      kinematics: [
        { group: "table", joint: 0, type: "translate", direction: "x", sign: 1 },
        { group: "platter", joint: 1, type: "rotate", direction: "z", sign: 1 },
      ],
      workGroup: "platter",
      toolGroup: "head",
      unitScale: 1,
      axes: ["X", "C"],
    };
    const bodies: CollisionBody[] = [
      { id: "pillar", group: "platter", positions: boxPositions(10), translate: [20, 0, 0] },
      { id: "post", group: "table", positions: boxPositions(10), translate: [0, 20, 0] },
    ];
    const model = buildCollisionModel(machine, bodies);
    // C sweeps 0→180°: pillar swings from (20,0) through the post at (0,20).
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 180]], [3, 4]), WCS0, { margin: 1 });
    expect(r.hits).toHaveLength(1);
    expect([r.hits[0]!.a, r.hits[0]!.b].sort()).toEqual(["pillar", "post"]);
    expect(r.hits[0]!.line).toBe(4);
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

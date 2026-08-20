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
    lineCum: new Map(), lineSpan: new Map(), timeBased: false,
  };
}

// Plunge mill: tool box rides a Z-driven tool group above a work box on an
// X-driven table. Tool group base z=50, box half-size 5 → tool bottom at
// 40+Z; work box top at +5. Contact at Z=-35, margin 2 breached below Z=-33.
const PLUNGE: CollisionMachine = {
  groups: [
    { id: "table", parent: "root" },
    // workGroup is a LEAF under the table so the vise (group "table") is a
    // fixture body, not a cutting body — cutting semantics get their own test.
    { id: "platter", parent: "table" },
    { id: "head", parent: "root", translate: [0, 0, 50] },
  ],
  kinematics: [
    { group: "table", joint: 0, type: "translate", direction: "x", sign: 1 },
    { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 },
  ],
  workGroup: "platter",
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

  it("stays silent on a clear traverse — with big advancement strides", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    const r = sweepCollisions(model, track(
      [[-100, 0, 0], [100, 0, 0]]), WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(0);
    // Conservative advancement: distance-driven steps stride through clear
    // space — far fewer samples than the old fixed 5 mm grid (200/5 = 40).
    expect(r.samples).toBeGreaterThan(1);
    expect(r.samples).toBeLessThan(30);
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
        { id: "work", parent: "platter" },
        { id: "spindle", parent: "root", translate: [0, 20, 0] },
      ],
      kinematics: [{ group: "platter", joint: 0, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "work",
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

  it("catches a graze narrower than the old fixed sample step", () => {
    // 1 mm head cube passes a 1 mm plate offset 1.0 mm laterally: the
    // below-margin window is ~2 mm of path — the old 5 mm grid (43/9 ≈
    // 4.78 mm samples at Z ≈ -38.2 and -43) straddled it and reported
    // clear. Conservative advancement must find it.
    const bodies: CollisionBody[] = [
      { id: "plate", group: "table", positions: boxPositions(1), translate: [2, 0, 10] },
      { id: "probe", group: "head", positions: boxPositions(1) },
    ];
    const model = buildCollisionModel(PLUNGE, bodies);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43]], undefined, [7, 8]), WCS0, { margin: 2 });
    const graze = r.hits.find(h => [h.a, h.b].sort().join("/") === "plate/probe");
    expect(graze).toBeTruthy();
    expect(graze!.dist).toBeLessThanOrEqual(2);
  });

  it("adversarial rotary lever: catches a narrow-angle clash at large radius", () => {
    // Pillar at radius 100 sweeping 180°; a small post sits on its circle.
    // The below-margin window is only ~2.3° — under the old fixed 4° rotary
    // step this could fall between samples. The lever-based bound must
    // shrink steps near the post regardless of the radius.
    const rotary: CollisionMachine = {
      groups: [
        { id: "platter", parent: "root" },
        { id: "work", parent: "platter" },
        { id: "frame", parent: "root" },
      ],
      kinematics: [{ group: "platter", joint: 0, type: "rotate", direction: "z", sign: 1 }],
      workGroup: "work",
      toolGroup: "frame",
      unitScale: 1,
      axes: ["C"],
    };
    const bodies: CollisionBody[] = [
      { id: "pillar", group: "platter", positions: boxPositions(2), translate: [100, 0, 0] },
      { id: "post", group: "frame", positions: boxPositions(2), translate: [0, 100, 0] },
    ];
    const model = buildCollisionModel(rotary, bodies);
    const r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 180]], [3, 4]), WCS0, { margin: 1 });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.dist).toBeLessThanOrEqual(1);
    // First contact ≈ 90° minus the small angular half-width of the boxes.
    expect(r.hits[0]!.cum).toBeGreaterThan(85);
    expect(r.hits[0]!.cum).toBeLessThan(91);
  });

  it("cutting semantics: feed contact with an EXPLICIT stock body is machining; rapid onset is a gouge", () => {
    // Only a body flagged `stock` is cuttable — machine parts never are
    // (without stock, the tool may touch nothing). On a FEED into stock:
    // cutting — no report. On a RAPID whose onset enters contact: gouge,
    // reported. A retract rapid leaving feed-begun contact stays benign.
    const bodies: CollisionBody[] = [
      { id: "stock", group: "platter", positions: boxPositions(10), stock: true },
      { id: "spindle", group: "head", positions: boxPositions(10) },
    ];
    const model = buildCollisionModel(PLUNGE, bodies);
    // Feed plunge into the stock, feed retract: pure cutting.
    let r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43], [0, 0, 0]], undefined, [7, 8, 9], [0, 0, 0]), WCS0, { margin: 2 });
    expect(r.hits).toEqual([]);
    expect(r.staticContacts).toEqual([]);   // cutting pairs never go static
    // Same plunge as a RAPID: onset in rapid → gouge.
    r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43]], undefined, [7, 8], [0, 1]), WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.rapid).toBe(true);
    // Feed plunge, then RAPID retract out of contact: benign (onset was feed).
    r = sweepCollisions(model, track(
      [[0, 0, 0], [0, 0, -43], [0, 0, 0]], undefined, [7, 8, 9], [0, 0, 1]), WCS0, { margin: 2 });
    expect(r.hits).toEqual([]);
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

describe("contact-window refinement (glow window)", () => {
  // User-reported scenario 2026-08-16: a line that STARTS inside a
  // collision and separates mid-line — the glow window [cum, cumEnd]
  // must end at the separation point, not run to the line's end.
  it("cumEnd lands at the separation point, not the line end", () => {
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    // Tool bottom = 45+Z, vise top = +5: touch at Z=-40, 5 deep at -45.
    // L25 plunges 0 -> -45; L26 retracts: separation (dist > eps) at
    // Z=-40, i.e. 5 units into the 45-unit line (cum 50 of 45..90).
    const t = track([[0, 0, 0], [0, 0, -45], [0, 0, 0]], undefined, [25, 25, 26]);
    const res = sweepCollisions(model, t, WCS0, { margin: 2 });
    const l26 = res.hits.find(h => h.line === 26 && h.dist < 1e-3)!;
    expect(l26).toBeDefined();
    expect(l26.cum).toBeLessThan(45.5);       // in contact from line start
    expect(l26.cumEnd).toBeGreaterThan(49);   // ends at separation (~50)...
    expect(l26.cumEnd).toBeLessThan(51);      // ...never the line end (90)
  });

  it("intermittent contact on ONE line yields separate refined intervals", () => {
    // The user's line-26 shape: enter contact, leave it, re-enter — all on
    // one source line. One [cum, cumEnd] window would glow across the
    // verified-clear middle; intervals must split it.
    const model = buildCollisionModel(PLUNGE, PLUNGE_BODIES);
    // Touch at Z=-40. L26: -45 (in contact) -> -10 (clear) -> -45 (back in)
    // -> 0 (clear). Line cums: 45..80..115..160; contact ends ~50,
    // resumes ~110, ends ~120.
    const t = track(
      [[0, 0, 0], [0, 0, -45], [0, 0, -10], [0, 0, -45], [0, 0, 0]],
      undefined, [25, 25, 26, 26, 26]);
    const res = sweepCollisions(model, t, WCS0, { margin: 2 });
    const l26 = res.hits.find(h => h.line === 26 && h.dist < 1e-3)!;
    expect(l26).toBeDefined();
    expect(l26.intervals).toHaveLength(2);
    const [a, b] = l26.intervals!;
    expect(a![0]).toBeLessThan(45.5);      // in contact from line start
    expect(a![1]).toBeGreaterThan(49);     // separates at Z=-40 (cum 50)
    expect(a![1]).toBeLessThan(51);
    expect(b![0]).toBeGreaterThan(109);    // re-touches at Z=-40 (cum 110)
    expect(b![0]).toBeLessThan(111);
    expect(b![1]).toBeGreaterThan(119);    // separates again (cum 120)
    expect(b![1]).toBeLessThan(121);
    // compat fields span the whole contact story
    expect(l26.cum).toBe(a![0]);
    expect(l26.cumEnd).toBe(b![1]);
  });

  it("cumEnd lands at separation under world kins (TCP line-26 shape)", () => {
    // XYZAC world segments at fixed world (20,0,-45): jx = 20*cos(C), so
    // the table slides -20 -> +20 as C returns 180 -> 0. Vise rides the
    // table at +20: penetrating at C=180, separating near C=120.
    const M5: CollisionMachine = {
      groups: [{ id: "table", parent: "root" }, { id: "platter", parent: "table" },
               { id: "head", parent: "root", translate: [0, 0, 50] }],
      kinematics: [{ group: "table", joint: 0, type: "translate", direction: "x", sign: 1 },
                   { group: "head", joint: 2, type: "translate", direction: "z", sign: 1 }],
      workGroup: "platter", toolGroup: "head", unitScale: 1,
      axes: ["X", "Y", "Z", "A", "C"],
      kins: { type: "xyzac-trt", identityFirst: true },  // raw type 1 = world
    };
    const B5: CollisionBody[] = [
      { id: "vise", group: "table", positions: boxPositions(10), translate: [20, 0, 0] },
      { id: "spindle", group: "head", positions: boxPositions(10) },
    ];
    const model = buildCollisionModel(M5, B5);
    // p0 clear (C=0, vise at +40) -> L25 sweeps INTO contact (C 0->180)
    // -> L26 returns C 180->0, separating at C~120 (60 of its 180 cum).
    const t = track(
      [[20, 0, -45], [20, 0, -45], [20, 0, -45]],
      [[0, 0, 0], [0, 0, 180], [0, 0, 0]],
      [25, 25, 26]);
    t.mode = new Uint8Array([1, 1, 1]);
    const res = sweepCollisions(model, t, WCS0, { margin: 2 });
    const l26 = res.hits.find(h => h.line === 26 && h.dist < 1e-3)!;
    expect(l26).toBeDefined();
    // L26 spans cum 180..360; contact ends near C=120 -> cum ~240.
    expect(l26.cum).toBeLessThan(185);
    expect(l26.cumEnd).toBeGreaterThan(230);
    expect(l26.cumEnd).toBeLessThan(250);
  });
});

describe("world-kins conservative advancement (sagitta slack)", () => {
  // The review's miss class: a C sweep symmetric about the joint-X
  // extremum. The pair's DOF path is {X} only, so chunk-endpoint joint
  // deltas give V = 0 (jx(±10°) are equal) and no rotary-lever budget
  // applies (C is not on the pair's path) — the pre-fix certificate
  // spanned the whole chunk from a clear starting distance while jx
  // bulged R·(1−cos 10°) ≈ 4.6 into the wall mid-chunk. The sagitta
  // slack seeds V for world-driven linear joints and forces mid-chunk
  // queries.
  const CSWEEP: CollisionMachine = {
    groups: [
      { id: "frame", parent: "root" },
      { id: "xslide", parent: "root" },
    ],
    kinematics: [{ group: "xslide", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "frame",
    toolGroup: "xslide",
    unitScale: 1,
    axes: ["X", "Y", "Z", "A", "C"],
    kins: { type: "xyzac-trt", identityFirst: true, params: {} },  // raw type 1 = world
  };
  const wallBodies = (wallX: number): CollisionBody[] => {
    const wall = boxPositions(10);
    for (let i = 0; i < wall.length; i += 3) wall[i] = wall[i]! + wallX;
    return [
      { id: "wall", group: "frame", positions: wall },
      { id: "mover", group: "xslide", positions: boxPositions(10) },
    ];
  };
  // World X=300 fixed while C sweeps −10°→+10° (one 20° chunk): under
  // xyzac-trt with pivots at origin, jx = 300·cos C — endpoints equal
  // (295.44), peak 300 exactly mid-chunk.
  const sweep = {
    ...track([[300, 0, 0], [300, 0, 0]], [[0, 0, -10], [0, 0, 10]]),
    mode: new Uint8Array([1, 1]),
  };

  it("catches the mid-chunk pivot bulge endpoint deltas cannot see", () => {
    // Wall near face at 303.44: endpoint gap 3.0 (clear of margin 2),
    // peak overlap 1.56 — with V = 0 a certificate from the endpoint
    // distance skips the whole chunk and misses the crossing.
    const model = buildCollisionModel(CSWEEP, wallBodies(308.44));
    const r = sweepCollisions(model, sweep, WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(1);
    expect([r.hits[0]!.a, r.hits[0]!.b].sort()).toEqual(["mover", "wall"]);
  });

  it("adds no false positive when the bulge stays clear", () => {
    // Wall 10 further out: peak gap 8.4 — slack may only shrink steps,
    // never manufacture hits.
    const model = buildCollisionModel(CSWEEP, wallBodies(318.44));
    const r = sweepCollisions(model, sweep, WCS0, { margin: 2 });
    expect(r.hits).toHaveLength(0);
  });
});

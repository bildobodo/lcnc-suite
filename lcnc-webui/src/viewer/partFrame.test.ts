// Unit tests for viewer/partFrame.ts — the rotary-aware preview transform.
// The machines under test mirror real machine.json content: the shipped
// 3-axis PM-25MV config and the XYZAC trunnion sim (machine-xyzac).
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  transformToPartFrame, chainsHaveRotary, buildLineMap, wcsTerms,
  buildChain, tipInWorkFrame, liftToJoints,
  type PartFrameMachine, type PartFrameWcs, } from "./partFrame";
import { anchorTerms } from "./partFrame";
import { makeKins } from "./kins";

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

// Tool-side rotary head (spindle on a Z ram, tilting B head carrying the
// tool) — the chain shape where the TLO subtraction FRAME matters. The
// trunnion above never exercises it: its tool group hangs untilted under
// root, so world-axis and tool-axis TLO subtraction coincide there.
const BHEAD: PartFrameMachine = {
  groups: [
    { id: "work", parent: "root" },
    { id: "z", parent: "root" },
    { id: "b_head", parent: "z" },
    { id: "tool", parent: "b_head" },
  ],
  kinematics: [
    { group: "work", joint: 0, type: "translate", direction: "x", sign: -1 },
    { group: "work", joint: 1, type: "translate", direction: "y", sign: -1 },
    { group: "z", joint: 2, type: "translate", direction: "z", sign: 1 },
    { group: "b_head", joint: 3, type: "rotate", direction: "y", sign: 1 },
  ],
  workGroup: "work",
  toolGroup: "tool",
  unitScale: 1,
  axes: ["X", "Y", "Z", "B"],
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

describe("tipInWorkFrame", () => {
  it("is transformToPartFrame's per-vertex body — one vertex through both agrees", () => {
    const chain = buildChain(TRUNNION);
    const o = wcsTerms(WCS0);
    const mv: number[] = [0, 0, 0, 0, 0, 0];
    liftToJoints(50, 30, -10, 30, 0, 45, o, [], mv);
    const jv: (number | null)[] = [];
    makeKins(TRUNNION.axes).inverse(mv, jv);
    const v = tipInWorkFrame(chain, jv, [], new THREE.Vector3());
    const r = transformToPartFrame(TRUNNION, WCS0, poly([[50, 30, -10]], [[30, 0, 45]]));
    // (transformToPartFrame emits Float32 — 1e-4 is the honest pin.)
    expect(v.x).toBeCloseTo(r.pos[0]!, 4);
    expect(v.y).toBeCloseTo(r.pos[1]!, 4);
    expect(v.z).toBeCloseTo(r.pos[2]!, 4);
    // The joints are what they were lifted to; a rotary pose moves the point.
    expect(Math.hypot(v.x - 50, v.y - 30, v.z + 10)).toBeGreaterThan(1);
  });
});

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

  it("tilts a CONSTANT-abc polyline — no sweep required (W2 P3)", () => {
    // The TWP defect class: the rotaries never move inside the program (the
    // tilt is a held pose), yet the tool-vs-work mapping is rotated the
    // whole time. A constant C=90 must transform every vertex; an
    // implementation that engages only on abc DELTAS draws this flat.
    const out = transformToPartFrame(
      TRUNNION, WCS0,
      poly([[10, 0, 0], [20, 0, 0], [20, 5, 0]],
           [[0, 0, 90], [0, 0, 90], [0, 0, 90]]),
    );
    expect(out.pos.length / 3).toBe(3);          // constant abc: no subdivision
    expect(vec(out.pos, 0)).toEqual([expect.closeTo(0, 3), expect.closeTo(-10, 3), expect.closeTo(0, 3)]);
    expect(vec(out.pos, 1)).toEqual([expect.closeTo(0, 3), expect.closeTo(-20, 3), expect.closeTo(0, 3)]);
    expect(vec(out.pos, 2)).toEqual([expect.closeTo(5, 3), expect.closeTo(-20, 3), expect.closeTo(0, 3)]);
  });

  it("subtracts the TLO along the TILTED tool axis, not world Z (W3 P0)", () => {
    // Operator-caught 12.58 mm rigid-offset class: with the head tilted,
    // the joints hold tip + TLO along the SPINDLE, so the tip is the tool
    // node's origin minus the world-ROTATED TLO — the same rule as
    // applyState phase 3 (local .position shift under the rotated chain)
    // and the collision worker (tool-local cylinder verts). Hand-derived
    // at B=90°, TLO z=22, program (10,5,0):
    //   joints X=10 Y=5 Z=0+22 B=90 → tool node at (0,0,22), rot Ry(90°)
    //   tip = (0,0,22) − Ry(90°)·(0,0,22) = (−22,0,22)
    //   work (moving table) at (−10,−5,0) → tip in work frame (−12,5,22).
    // The world-axis bug instead gives tip (0,0,0) → output = programmed
    // (10,5,0) — flat, hiding the tilt entirely.
    const wcs = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0, tool: [0, 0, 22] };
    const out = transformToPartFrame(
      BHEAD, wcs,
      poly([[10, 5, 0], [10, 5, 0]], [[0, 0, 0], [0, 90, 0]]),
    );
    // B=0 vertex: identity rotation — TLO cancels, output = programmed.
    expect(vec(out.pos, 0)).toEqual(
      [expect.closeTo(10, 3), expect.closeTo(5, 3), expect.closeTo(0, 3)]);
    // B=90 vertex (last subdivided sample = exact endpoint).
    const last = vec(out.pos, out.pos.length / 3 - 1);
    expect(last[0]).toBeCloseTo(-12, 3);
    expect(last[1]).toBeCloseTo(5, 3);
    expect(last[2]).toBeCloseTo(22, 3);
  });

  it("lifts AND peels each vertex with ITS OWN tool offset (schema 8)", () => {
    // Same B=90 fixture, but the offset is per vertex: live tool 0, and a
    // tlo_events row (22) governing only the second vertex. Vertex 0 (B=0,
    // live 0) stays programmed; the B=90 endpoint reproduces the W3 P0
    // numbers — (−12, 5, 22) — which requires the LIFT and the PEEL to use
    // the same per-vertex value (the pre-8 code peeled with the live terms).
    const wcs = { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0, tool: [0, 0, 0] };
    const input = {
      ...poly([[10, 5, 0], [10, 5, 0]], [[0, 0, 0], [0, 90, 0]]),
      tlo: new Uint8Array([0xff, 0]),
      tloEvents: [{ seq: 0, xyz: [0, 0, 22] as [number, number, number], tool: 3 }],
    };
    const out = transformToPartFrame(BHEAD, wcs, input);
    expect(vec(out.pos, 0)).toEqual(
      [expect.closeTo(10, 3), expect.closeTo(5, 3), expect.closeTo(0, 3)]);
    const last = vec(out.pos, out.pos.length / 3 - 1);
    expect(last[0]).toBeCloseTo(-12, 3);
    expect(last[1]).toBeCloseTo(5, 3);
    expect(last[2]).toBeCloseTo(22, 3);
    // Absent channel: the live offset governs every vertex, as before.
    const live22 = transformToPartFrame(
      BHEAD, { ...wcs, tool: [0, 0, 22] }, poly([[10, 5, 0], [10, 5, 0]], [[0, 0, 0], [0, 90, 0]]));
    expect(vec(live22.pos, live22.pos.length / 3 - 1)[0]).toBeCloseTo(-12, 3);
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

describe("transformToPartFrame — section breaks", () => {
  it("never subdivides a break segment and remaps breaks to output indices", () => {
    // Segment 0→1 sweeps C by 90° (subdivides); segment 1→2 is a section
    // break with a large rotary delta that must NOT be subdivided (it is a
    // false connector across a rapid — smoothing it would draw a phantom
    // sweep); segment 2→3 sweeps 8° (subdivides into 2).
    const input = {
      ...poly(
        [[50, 0, 0], [50, 0, 10], [50, 0, 60], [60, 0, 60]],
        [[0, 0, 0], [0, 0, 90], [0, 0, 270], [0, 0, 278]],
        [10, 11, 57, 57],
      ),
      breaks: new Uint32Array([0, 2]),
    };
    const r = transformToPartFrame(TRUNNION, WCS0, input);
    // 1 (first vertex) + 23 (90°/4°) + 1 (break) + 2 (8°/4°) = 27.
    const n = r.pos.length / 3;
    expect(n).toBe(27);
    expect(Array.from(r.breaks!)).toEqual([0, 24]);
    // The break-segment endpoint is the exact input vertex (u=1 lerp), so
    // the section start sits at the true post-rapid position in the work
    // frame — spot-check against a direct 1-vertex transform.
    const direct = transformToPartFrame(TRUNNION, WCS0, {
      ...poly([[50, 0, 60]], [[0, 0, 270]]),
    });
    expect(vec(r.pos, 24)).toEqual(vec(direct.pos, 0));
  });

  it("passes breaks through the unresolvable-chain fallback", () => {
    const broken: PartFrameMachine = { ...TRUNNION, workGroup: "missing" };
    const input = { ...poly([[0, 0, 0], [1, 0, 0]]), breaks: new Uint32Array([0]) };
    const r = transformToPartFrame(broken, WCS0, input);
    expect(Array.from(r.breaks!)).toEqual([0]);
  });
});

describe("kins world routing (phase 2b)", () => {
  // Pivot params match the TRUNNION chain's a_assembly translate [0,20,10]
  // by construction — same pairing as the xyzac sim config (which is
  // sparm=identityfirst: raw type 1 = world, matching the mode arrays).
  const SPEC = { type: "xyzac-trt", identityFirst: true, params: { yOffset: 20, zOffset: 10 } };
  const TCP: PartFrameMachine = { ...TRUNNION, kins: SPEC };

  it("routes world-flagged segments through the declared kins", () => {
    // Constant world XYZ while C sweeps = TCP holding one point on the
    // part: under world routing the part-frame result must COLLAPSE to
    // that single point (TCP program coords are already tip-in-work) —
    // subdivided samples included, since every (40,0,0,c) maps to the
    // same part point exactly.
    const pts: number[][] = [], abc: number[][] = [];
    for (let d = 0; d <= 90; d += 1) { pts.push([40, 0, 0]); abc.push([0, 0, d]); }
    const input = poly(pts, abc);
    const mode = new Uint8Array(pts.length).fill(1);
    const world = transformToPartFrame(TCP, WCS0, { ...input, mode });
    for (let i = 0; i < world.pos.length / 3; i++) {
      const [x, y, z] = vec(world.pos, i);
      expect(x).toBeCloseTo(40, 3);
      expect(y).toBeCloseTo(0, 3);
      expect(z).toBeCloseTo(0, 3);
    }
    // Routing proof: the same polyline untracked (trivkins) fans around
    // the platter instead of collapsing — the star-pattern error class.
    const triv = transformToPartFrame(TCP, WCS0, input);
    const last = vec(triv.pos, triv.pos.length / 3 - 1);
    expect(Math.abs(last[1])).toBeGreaterThan(1);
  });

  it("mode-0 segments in a mode-carrying polyline still derive as trivkins", () => {
    const input = poly([[40, 0, 0], [40, 0, 0]], [[0, 0, 0], [0, 0, 90]]);
    const a = transformToPartFrame(TCP, WCS0, { ...input, mode: new Uint8Array([0, 0]) });
    const b = transformToPartFrame(TCP, WCS0, input);
    expect(Array.from(a.pos)).toEqual(Array.from(b.pos));
  });
});

describe("per-epoch WCS terms (review P2)", () => {
  it("converts each vertex through ITS epoch's basis; peel stays active", () => {
    // MILL3 is an identity chain under one basis; with per-epoch terms the
    // epoch offset survives into the (active-frame) output: out = v + o_e
    // when the active origin is zero. Vertex 0 in the active epoch, vertex
    // 1 in a G59-like epoch at (100, -50, 25).
    const input = { ...poly([[0, 0, 0], [10, 0, 0]], undefined, [1, 2]),
                    wcs: new Uint8Array([0, 1]) };
    const terms = [
      wcsTerms(WCS0),
      wcsTerms({ g5x: [100, -50, 25, 0, 0, 0], g92: [], rotationDeg: 0 }),
    ];
    const r = transformToPartFrame(MILL3, WCS0, input, undefined, terms);
    expect(vec(r.pos, 0)).toEqual([0, 0, 0]);
    const [x, y, z] = vec(r.pos, 1);
    expect(x).toBeCloseTo(110, 3);
    expect(y).toBeCloseTo(-50, 3);
    expect(z).toBeCloseTo(25, 3);
    // Without the epoch data the same input is the plain identity.
    const plain = transformToPartFrame(MILL3, WCS0, poly([[0, 0, 0], [10, 0, 0]]));
    expect(vec(plain.pos, 1)).toEqual([10, 0, 0]);
  });
});

describe("src carry through subdivision (review P3)", () => {
  it("subdivided samples share their segment's src; array stays ascending", () => {
    const input = {
      ...poly([[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 40]], [1, 2]),
      src: new Uint32Array([5, 9]),
    };
    const r = transformToPartFrame(TRUNNION, WCS0, input);
    expect(r.src).toBeDefined();
    expect(r.src!.length).toBe(r.pos.length / 3);
    expect(r.src![0]).toBe(5);
    for (let i = 1; i < r.src!.length; i++) {
      expect(r.src![i]).toBe(9);                       // all subdivided samples
      expect(r.src![i]).toBeGreaterThanOrEqual(r.src![i - 1]!);
    }
  });
});

describe("anchorTerms — the toolpath anchor equals the live work-origin formula", () => {
  it("g5x + Rz(θ)·g92 in XY, plain sum in Z, θ carried in degrees", () => {
    const a = anchorTerms({ g5x: [10, 20, 30], g92: [1, 0, 0.5], rotationDeg: 90 });
    expect(a.ox).toBeCloseTo(10, 9);
    expect(a.oy).toBeCloseTo(21, 9);
    expect(a.oz).toBeCloseTo(30.5, 9);
    expect(a.thetaDeg).toBe(90);
  });
  it("fills a caller-provided scratch object (allocation-free per frame)", () => {
    const out = { ox: 0, oy: 0, oz: 0, thetaDeg: 0 };
    const r = anchorTerms({ g5x: [1, 2, 3], g92: [], rotationDeg: 0 }, out);
    expect(r).toBe(out);
    expect(out).toEqual({ ox: 1, oy: 2, oz: 3, thetaDeg: 0 });
  });
});

describe("room-fixed bake (2026-09-11: decouple the path from an uncommanded table rotary)", () => {
  // TRUNNION: the work chain is table(x) → a_assembly(A) → c_assembly → c_platter(C);
  // the room frame is the `table` node's, with zero static offset here
  // (a_assembly [0,20,10] + c_assembly [0,-20,-10] + c_platter none).
  const pts = [[10, 0, 0], [20, 0, 0], [20, 5, 0]];
  const src = new Uint32Array([0, 1, 2]);
  const tilted = pts.map(() => [30, 0, 40]);    // an INHERITED tilt: seed A30 C40 baked into every vertex

  it("room vertices sit where identity kins sends the tool — the program coords — whatever the table pose", () => {
    const table = transformToPartFrame(TRUNNION, WCS0, { ...poly(pts, tilted), src });
    const room = transformToPartFrame(TRUNNION, WCS0, { ...poly(pts, tilted), src, roomEnd: 3 });
    expect(room.room && Array.from(room.room)).toEqual([1, 1, 1]);
    expect(room.frameFlips).toBe(0);
    for (let i = 0; i < 3; i++) {
      const r = vec(room.pos, i), t = vec(table.pos, i);
      expect(r[0]).toBeCloseTo(pts[i]![0]!, 4);
      expect(r[1]).toBeCloseTo(pts[i]![1]!, 4);
      expect(r[2]).toBeCloseTo(pts[i]![2]!, 4);
      // ...while the part-frame bake of the same vertex is the tilted/rotated point
      expect(Math.hypot(r[0] - t[0], r[1] - t[1], r[2] - t[2])).toBeGreaterThan(1);
    }
  });

  it("a flip inside a section duplicates the previous vertex in the new frame as a break", () => {
    const out = transformToPartFrame(TRUNNION, WCS0, { ...poly(pts, tilted), src, roomEnd: 2 });
    // vertices 0,1 room; 2 table → the duplicate of vertex 1 (table frame) precedes vertex 2
    expect(out.pos.length / 3).toBe(4);
    expect(Array.from(out.room!)).toEqual([1, 1, 0, 0]);
    expect(Array.from(out.breaks!)).toEqual([2]);
    expect(Array.from(out.src!)).toEqual([0, 1, 2, 2]);
    expect(out.frameFlips).toBe(1);
    // the duplicate is vertex 1 evaluated in the TABLE frame = the part-frame bake of vertex 1
    const table = transformToPartFrame(TRUNNION, WCS0, { ...poly(pts, tilted), src });
    const d = vec(out.pos, 2), t1 = vec(table.pos, 1);
    expect(d[0]).toBeCloseTo(t1[0], 4); expect(d[1]).toBeCloseTo(t1[1], 4); expect(d[2]).toBeCloseTo(t1[2], 4);
    // and the room copy of vertex 1 is the program point
    expect(vec(out.pos, 1)[0]).toBeCloseTo(20, 4);
  });

  it("a flip AT a section break needs no duplicate", () => {
    const out = transformToPartFrame(TRUNNION, WCS0, { ...poly(pts, tilted), src, roomEnd: 2, breaks: new Uint32Array([2]) });
    expect(out.pos.length / 3).toBe(3);
    expect(Array.from(out.breaks!)).toEqual([2]);
    expect(out.frameFlips).toBe(0);
  });

  it("a world-kins segment never bakes room-fixed, and subdivided samples carry their segment's frame", () => {
    // mode 1 with no declared kins spec = world (worldModeForSpec) → rides
    const world = transformToPartFrame(TRUNNION, WCS0, { ...poly(pts, tilted), src, roomEnd: 3, mode: new Uint8Array([1, 1, 1]) });
    expect(Array.from(world.room!)).toEqual([0, 0, 0]);
    // a C sweep across a room segment: every sample of it is room
    const sweep = transformToPartFrame(TRUNNION, WCS0, { ...poly(pts, [[0, 0, 0], [0, 0, 40], [0, 0, 40]]), src, roomEnd: 3 });
    expect(sweep.pos.length / 3).toBeGreaterThan(3);
    expect(Array.from(sweep.room!).every(v => v === 1)).toBe(true);
  });

  it("no work-chain rotary (3-axis), no src, or roomEnd 0 → no split", () => {
    expect(transformToPartFrame(MILL3, WCS0, { ...poly(pts), src, roomEnd: 3 }).room).toBeUndefined();
    expect(transformToPartFrame(TRUNNION, WCS0, { ...poly(pts, tilted), roomEnd: 3 }).room).toBeUndefined();
    expect(transformToPartFrame(TRUNNION, WCS0, { ...poly(pts, tilted), src, roomEnd: 0 }).room).toBeUndefined();
    // and buildChain reports the room frame honestly
    expect(buildChain(MILL3).hasRoom).toBe(false);
    const ch = buildChain(TRUNNION);
    expect(ch.hasRoom).toBe(true);
    expect(ch.nodes[ch.linIdx]!.id).toBe("table");
  });

  it("tipInWorkFrame is unchanged by the evalChainTip refactor (BHEAD tilted TLO case)", () => {
    const chain = buildChain(BHEAD);
    const out = new THREE.Vector3();
    tipInWorkFrame(chain, [0, 0, 0, 90], [0, 0, 22], out);
    // B=90 tilts the tool: a TLO of 22 along the tool axis subtracts along the rotated axis
    expect(Math.abs(out.z)).toBeLessThan(1e-6);
    expect(Math.abs(Math.abs(out.x) - 22)).toBeLessThan(1e-6);
  });
});

// L1 display oracle (W2 P8.4) — headless assertion of WHAT THE VIEWER
// DRAWS for a TWP-shaped payload: the pure display decision composed with
// the part-frame transform. The wave-2 flat-TWP defect lived exactly
// between tested units (correct transform, correct-for-its-schema payload,
// silently wrong gate) — either layer regressing turns this file red.
import { describe, expect, it } from "vitest";
import { displayDecision } from "./displayPipeline";
import { transformToPartFrame, type PartFrameMachine } from "./partFrame";

// XYZAC trunnion (mirrors examples/sim_config/machine-xyzac) — the rotary
// machine fixture shared with partFrame.test.ts.
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
  axes: ["X", "Y", "Z", "A", "C"],
};

const MILL3: PartFrameMachine = {
  groups: [
    { id: "x", parent: "root" }, { id: "y", parent: "root" },
    { id: "z", parent: "y" }, { id: "tool", parent: "z" },
  ],
  kinematics: [
    { group: "x", joint: 0, direction: "x", sign: -1 },
    { group: "y", joint: 1, direction: "y", sign: 1 },
    { group: "z", joint: 2, direction: "z", sign: 1 },
  ],
  workGroup: "x", toolGroup: "tool", unitScale: 1, axes: ["X", "Y", "Z"],
};

const TRSRN_WIRE = {
  module: "xyzacb_trsrn", type: "xyzacb-trsrn", identity_first: false,
  params: { x_pivot: 0, y_pivot: 0, z_pivot: 0 },
};

const abc = (vals: number[][]) => new Float32Array(vals.flat());

describe("displayDecision", () => {
  it("TWP-shaped payload (constant abc + non-identity modes) → part", () => {
    // The flat-TWP class: abc never SWEEPS, yet the pose depends on it.
    const facts = {
      feedAbc: abc([[0, -40.9, 130.2], [0, -40.9, 130.2]]),
      feedMode: new Uint8Array([2, 2]),
    };
    expect(displayDecision(facts, TRUNNION, TRSRN_WIRE, "part")).toBe("part");
  });

  it("non-identity modes alone demand the part frame (belt — abc absent)", () => {
    const facts = { feedMode: new Uint8Array([0, 2, 2]) };
    expect(displayDecision(facts, TRUNNION, TRSRN_WIRE, "part")).toBe("part");
    // …even on a rotary-less machine model: the KINS routing poses them.
    expect(displayDecision(facts, MILL3, TRSRN_WIRE, "part")).toBe("part");
  });

  it("constant-abc payload with a rotary machine → part, without → programmed", () => {
    const facts = { rapidAbc: abc([[0, 0, 90], [0, 0, 90]]) };
    expect(displayDecision(facts, TRUNNION, null, "part")).toBe("part");
    expect(displayDecision(facts, MILL3, null, "part")).toBe("programmed");
  });

  it("plain payload → programmed; operator override always wins", () => {
    expect(displayDecision({}, TRUNNION, null, "part")).toBe("programmed");
    const twp = {
      feedAbc: abc([[0, -40.9, 130.2]]), feedMode: new Uint8Array([2]),
    };
    expect(displayDecision(twp, TRUNNION, TRSRN_WIRE, "programmed"))
      .toBe("programmed");
  });

  it("identity-only mode arrays do not force the part frame by themselves", () => {
    const facts = { feedMode: new Uint8Array([0, 0, 0]) };
    expect(displayDecision(facts, MILL3, TRSRN_WIRE, "part")).toBe("programmed");
  });
});

describe("L1 display oracle — decision + transform compose", () => {
  it("a held-tilt program DRAWS tilted (the flat-TWP tripwire)", () => {
    // Constant C=90 the whole program: the decision must engage the part
    // frame, and the transform must rotate every vertex. If EITHER layer
    // regresses (gate silently picks "programmed", or the transform stops
    // engaging on constant abc), the drawn vertices come back untilted
    // and this fails — headless, no scene, no worker.
    const facts = {
      feedAbc: abc([[0, 0, 90], [0, 0, 90], [0, 0, 90]]),
    };
    expect(displayDecision(facts, TRUNNION, null, "part")).toBe("part");
    const out = transformToPartFrame(
      TRUNNION, { g5x: [0, 0, 0, 0, 0, 0], g92: [], rotationDeg: 0 },
      {
        pos: new Float32Array([10, 0, 0, 20, 0, 0, 20, 5, 0]),
        abc: facts.feedAbc!,
      },
    );
    // Hand-derived platter-frame truth (same as partFrame.test.ts):
    // program (x, y) under C=90 lands at (y, -x) on the platter.
    const want = [[0, -10, 0], [0, -20, 0], [5, -20, 0]];
    for (let i = 0; i < 3; i++) {
      expect(out.pos[i * 3 + 0]).toBeCloseTo(want[i]![0]!, 3);
      expect(out.pos[i * 3 + 1]).toBeCloseTo(want[i]![1]!, 3);
      expect(out.pos[i * 3 + 2]).toBeCloseTo(want[i]![2]!, 3);
    }
    // The drawn path must NOT equal the programmed polyline — flat is red.
    expect(out.pos[0]).not.toBeCloseTo(10, 1);
  });
});

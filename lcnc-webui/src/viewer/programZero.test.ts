// Unit tests for viewer/programZero.ts — the program-zero markers.
// Machines: the real machine-xyzacb-trsrn model (TWP demo, XYZ on the head,
// A table), the xyzac trunnion knee mill (MOVING table — the case the old
// counter-transform got wrong), the shipped 3-axis default, and a tool-side
// B head.
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  programZeroPose, workMarkers, chainRotaryLetters, fixtureRidesOnA, identityRotaries,
  markerInputsChanged, newMarkerInputsPrev, resetProgramZeroWarningsForTests, g5xName,
  type ProgramZeroPose,
} from "./programZero";
import { specFromWire } from "./kins";
import { twpPlaneForSample } from "./twpPlaneFrame";
import { TWP_PROV_A_EPS } from "../twpPose";
import type { PartFrameMachine, PartFrameWcs } from "./partFrame";

const DIR = path.resolve(__dirname, "../../../examples/sim_config/machine-xyzacb-trsrn");
const mj = JSON.parse(fs.readFileSync(path.join(DIR, "machine.json"), "utf8"));
const SPEC = specFromWire({
  type: "xyzacb-trsrn",
  params: { y_pivot: 50, z_pivot: 120, x_offset: 0, y_offset: 0, y_rot_axis: -1000, z_rot_axis: -2000, nut_angle: 55 },
});
const TRSRN: PartFrameMachine = {
  groups: mj.groups, kinematics: mj.kinematics, workGroup: mj.workGroup, toolGroup: mj.toolGroup,
  unitScale: 1, axes: ["X", "Y", "Z", "A", "B", "C"], kins: SPEC,
};
// The same trsrn chain WITHOUT a kins declaration (a plain trivkins config).
const TRSRN_TRIV: PartFrameMachine = { ...TRSRN, kins: undefined };

// examples/sim_config/machine-xyzac (mirrors partFrame.test.ts TRUNNION).
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
  workGroup: "c_platter", toolGroup: "tool", unitScale: 1, axes: ["X", "Y", "Z", "A", "C"],
};
const MILL3: PartFrameMachine = {
  groups: [{ id: "x", parent: "root" }, { id: "y", parent: "root" }, { id: "z", parent: "y" }, { id: "tool", parent: "z" }],
  kinematics: [
    { group: "x", joint: 0, direction: "x", sign: -1 },
    { group: "y", joint: 1, direction: "y", sign: 1 },
    { group: "z", joint: 2, direction: "z", sign: 1 },
  ],
  workGroup: "x", toolGroup: "tool", unitScale: 1, axes: ["X", "Y", "Z"],
};
const BHEAD: PartFrameMachine = {
  groups: [{ id: "work", parent: "root" }, { id: "z", parent: "root" }, { id: "b_head", parent: "z" }, { id: "tool", parent: "b_head" }],
  kinematics: [
    { group: "work", joint: 0, type: "translate", direction: "x", sign: -1 },
    { group: "work", joint: 1, type: "translate", direction: "y", sign: -1 },
    { group: "z", joint: 2, type: "translate", direction: "z", sign: 1 },
    { group: "b_head", joint: 3, type: "rotate", direction: "y", sign: 1 },
  ],
  workGroup: "work", toolGroup: "tool", unitScale: 1, axes: ["X", "Y", "Z", "B"],
};

const wcs = (g5x: number[], g92: number[] = [], rotationDeg = 0, tool?: number[]): PartFrameWcs =>
  ({ g5x, g92, rotationDeg, ...(tool ? { tool } : {}) });
const v3 = (p: readonly number[]) => new THREE.Vector3(p[0], p[1], p[2]);
const close = (a: readonly number[], b: readonly number[], d = 6) => {
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(b[i]!, d);
};
const rad = THREE.MathUtils.degToRad;

/** World matrix of the trsrn work group at table angle `a` (joints else 0):
 *  a_table (static base, Rx by joint 3 with the model's sign) → a_work. */
function trsrnWorkWorld(a: number): THREE.Matrix4 {
  const at = mj.groups.find((g: any) => g.id === "a_table");
  const aw = mj.groups.find((g: any) => g.id === "a_work");
  const kin = mj.kinematics.find((k: any) => k.group === "a_table");
  expect(kin.direction).toBe("x");
  const m = new THREE.Matrix4().makeTranslation(...(at.translate as [number, number, number]));
  m.multiply(new THREE.Matrix4().makeRotationX(rad(a * kin.sign)));
  m.multiply(new THREE.Matrix4().makeTranslation(...(aw.translate as [number, number, number])));
  return m;
}
/** World matrix of the trunnion work group (c_platter) at the given joints. */
function trunnionWorkWorld(x: number, y: number, z: number, a: number, c: number): THREE.Matrix4 {
  const m = new THREE.Matrix4().makeTranslation(0, 0, 200 - z);      // knee
  m.multiply(new THREE.Matrix4().makeTranslation(0, -y, 0));         // saddle
  m.multiply(new THREE.Matrix4().makeTranslation(-x, 0, 0));         // table
  m.multiply(new THREE.Matrix4().makeTranslation(0, 20, 10));        // a_assembly base
  m.multiply(new THREE.Matrix4().makeRotationX(rad(a)));
  m.multiply(new THREE.Matrix4().makeTranslation(0, -20, -10));      // c_assembly
  m.multiply(new THREE.Matrix4().makeRotationZ(rad(c)));             // c_platter
  return m;
}

const ID_X = [1, 0, 0], ID_Y = [0, 1, 0], ID_Z = [0, 0, 1];

describe("programZeroPose — identity", () => {
  it("trsrn at A=0: program zero is the fixture numbers, basis identity (peels exactly at zero)", () => {
    const g = [100, -50, -420];
    const p = programZeroPose({ machine: TRSRN, wcs: wcs(g), kinsType: 0, rotary: [0, 0, 0] })!;
    close(p.pos, g); close(p.x, ID_X); close(p.y, ID_Y); close(p.z, ID_Z);
  });
  it("g5x + Rz(θ)·g92 with the basis rotated — the applyState anchor formula", () => {
    const p = programZeroPose({ machine: TRSRN, wcs: wcs([10, 20, 30], [1, 0, 0], 90), kinsType: 0, rotary: [0, 0, 0] })!;
    close(p.pos, [10, 21, 30]); close(p.x, [0, 1, 0]); close(p.y, [-1, 0, 0]); close(p.z, ID_Z);
  });
  it("TLO: the joints are lifted with it and the tip peeled back — pos unchanged", () => {
    const p = programZeroPose({ machine: TRSRN, wcs: wcs([100, -50, -420], [], 0, [0, 0, 22]), kinsType: 0, rotary: [0, 0, 0] })!;
    close(p.pos, [100, -50, -420]);
  });
  it("stamp vs live: the same numbers at A=30 are a table-local point whose world position is the A=0 room point", () => {
    const g = [100, -50, -420];
    const p = programZeroPose({ machine: TRSRN, wcs: wcs(g), kinsType: 0, rotary: [30, 0, 0] })!;
    // Table-local coordinates differ from the numbers (the room point seen from the tilted table)…
    expect(v3(p.pos).distanceTo(v3(g))).toBeGreaterThan(50);
    // …but drawn under the work group at A=30 it is exactly where the numbers sat at A=0.
    const world = v3(p.pos).applyMatrix4(trsrnWorkWorld(30));
    const room = v3(g).applyMatrix4(trsrnWorkWorld(0));
    close([world.x, world.y, world.z], [room.x, room.y, room.z]);
    // Its basis, rotated by the table, is the room's axes.
    const rot = new THREE.Matrix3().setFromMatrix4(trsrnWorkWorld(30));
    const wx = v3(p.x).applyMatrix3(rot), wz = v3(p.z).applyMatrix3(rot);
    close([wx.x, wx.y, wx.z], ID_X); close([wz.x, wz.y, wz.z], ID_Z);
  });
  it("writes into `out` when given", () => {
    const out: ProgramZeroPose = { pos: [9, 9, 9], x: [9, 9, 9], y: [9, 9, 9], z: [9, 9, 9] };
    const r = programZeroPose({ machine: TRSRN, wcs: wcs([1, 2, 3]), kinsType: 0, rotary: [0, 0, 0] }, out);
    expect(r).toBe(out);
    close(out.pos, [1, 2, 3]);
  });
  it("null when the chain cannot be resolved — hide, never guess", () => {
    const broken: PartFrameMachine = { ...TRSRN, workGroup: "nope" };
    expect(programZeroPose({ machine: broken, wcs: wcs([1, 2, 3]), kinsType: 0, rotary: [0, 0, 0] })).toBeNull();
  });
});

describe("programZeroPose — moving table (the removed W⁻¹·W0·P drift)", () => {
  const g = [100, 50, -30];
  it("trunnion at A=30: the table-carriage point that sits under the spindle when the DRO reads 0", () => {
    const p = programZeroPose({ machine: TRUNNION, wcs: wcs(g), kinsType: 0, rotary: [30, 0, 0] })!;
    // Analytic: Piv · Rx(−30) · Piv⁻¹ · g, Piv = the A pivot offset [0,20,10].
    const piv = new THREE.Matrix4().makeTranslation(0, 20, 10)
      .multiply(new THREE.Matrix4().makeRotationX(rad(-30)))
      .multiply(new THREE.Matrix4().makeTranslation(0, -20, -10));
    const e = v3(g).applyMatrix4(piv);
    close(p.pos, [e.x, e.y, e.z]);
    // Scene check at ANY slide position: drawn under the live work group the
    // marker sits at tip + (g − live) — under the tool exactly when the slides read g.
    const live = [200, -100, 50];
    const w = v3(p.pos).applyMatrix4(trunnionWorkWorld(live[0]!, live[1]!, live[2]!, 30, 0));
    close([w.x, w.y, w.z], [g[0]! - live[0]!, g[1]! - live[1]!, 200 + g[2]! - live[2]!]);
    const atG = v3(p.pos).applyMatrix4(trunnionWorkWorld(g[0]!, g[1]!, g[2]!, 30, 0));
    close([atG.x, atG.y, atG.z], [0, 0, 200]);
    // The old formula W_live⁻¹·W0·P differs by the slide travel — the bug class.
    const old = v3(g).applyMatrix4(trunnionWorkWorld(0, 0, 0, 0, 0))
      .applyMatrix4(trunnionWorkWorld(live[0]!, live[1]!, live[2]!, 30, 0).invert());
    expect(old.distanceTo(v3(p.pos))).toBeGreaterThan(100);
  });
  it("3-axis moving table: the numbers themselves", () => {
    const p = programZeroPose({ machine: MILL3, wcs: wcs([12, -7, 3]), kinsType: 0, rotary: [0, 0, 0] })!;
    close(p.pos, [12, -7, 3]); close(p.x, ID_X);
  });
});

describe("programZeroPose — TCP self-check (chain ≡ kins twin)", () => {
  it("trsrn kins 1: the tip lands on the table point for every rotary pose, TLO 22", () => {
    const g = [100, -50, -420];
    for (const a of [0, 30, -75]) for (const b of [0, 40]) for (const c of [0, 130]) {
      const p = programZeroPose({ machine: TRSRN, wcs: wcs(g, [], 0, [0, 0, 22]), kinsType: 1, rotary: [a, b, c] });
      expect(p, `a=${a} b=${b} c=${c}`).not.toBeNull();
      close(p!.pos, g, 5); close(p!.x, ID_X, 5); close(p!.z, ID_Z, 5);
    }
  });
  it("trsrn kins 2 + frame: the plane overlay's origin (twpPlaneForSample twin)", () => {
    const frame = [0.3, 130.2455, -40.8555];
    const g5x = [1331.13, -1186.21, 74.13];
    const ov = twpPlaneForSample({ spec: SPEC, kinstype: 2, frame, g5x, g92: [0, 0, 0], rotationDeg: 0, a: 0 })!;
    // The head SITS at the frame: B = secondary, C = primary (twpPlaneFrame's seed).
    const p = programZeroPose({ machine: TRSRN, wcs: wcs(g5x), kinsType: 2, frame, rotary: [0, frame[2]!, frame[1]!] })!;
    close(p.pos, [ov[0]!, ov[1]!, ov[2]!], 3);
    close(p.z, [ov[3]!, ov[4]!, ov[5]!], 3);
  });
});

describe("chain rotaries + identity rotary selection", () => {
  it("chainRotaryLetters", () => {
    expect(chainRotaryLetters(TRUNNION)).toEqual({ work: ["A", "C"], tool: [] });
    expect(chainRotaryLetters(TRSRN)).toEqual({ work: ["A"], tool: ["C", "B"] });
    expect(chainRotaryLetters(BHEAD)).toEqual({ work: [], tool: ["B"] });
    expect(chainRotaryLetters(MILL3)).toEqual({ work: [], tool: [] });
  });
  it("fixtureRidesOnA: the stamp covers A only", () => {
    expect(fixtureRidesOnA(TRSRN)).toBe(true);
    expect(fixtureRidesOnA(MILL3)).toBe(true);
    expect(fixtureRidesOnA(BHEAD)).toBe(true);
    expect(fixtureRidesOnA(TRUNNION)).toBe(false);
  });
  it("identityRotaries: work-chain rotaries live (A overridable), tool-chain rotaries 0", () => {
    const L = chainRotaryLetters(TRSRN);
    expect(identityRotaries(L, [30, 40, 130], 0, [])).toEqual([0, 0, 0]);
    expect(identityRotaries(L, [30, 40, 130], null, [])).toEqual([30, 0, 0]);
    expect(identityRotaries(L, null, 12, [])).toEqual([12, 0, 0]);
    expect(identityRotaries(chainRotaryLetters(TRUNNION), [30, 0, 90], null, [])).toEqual([30, 0, 90]);
    expect(identityRotaries(chainRotaryLetters(BHEAD), [0, 33, 0], 5, [])).toEqual([0, 0, 0]);
  });
});

describe("workMarkers — the rule table", () => {
  afterEach(() => { vi.restoreAllMocks(); resetProgramZeroWarningsForTests(); });
  const g = [100, -50, -420];
  const base = { machine: TRSRN, wcs: wcs(g), frame: null, scrub: false };

  it("identity, table at the stamp pose: one triad on the numbers, no ghost", () => {
    const m = workMarkers({ ...base, kinsType: 0, g5xIndex: 1, rotaryAbc: [0, 0, 0], provA: [0] });
    expect(m.primary!.label).toBe("G54");
    close(m.primary!.pose.pos, g);
    expect(m.ghost).toBeNull();
  });
  it("identity, table jogged away from the stamp: G54 rides the part, the ghost holds the room point", () => {
    const m = workMarkers({ ...base, kinsType: 0, g5xIndex: 1, rotaryAbc: [30, 0, 0], provA: [0] });
    close(m.primary!.pose.pos, g);                       // table-local = the numbers → rides A
    expect(m.ghost).not.toBeNull();
    const world = v3(m.ghost!.pos).applyMatrix4(trsrnWorkWorld(30));
    const room = v3(g).applyMatrix4(trsrnWorkWorld(0));
    close([world.x, world.y, world.z], [room.x, room.y, room.z]);
  });
  it("a tilted stamp: the triad is the numbers seen from THAT table pose; ghost only when live differs", () => {
    const same = workMarkers({ ...base, kinsType: 0, g5xIndex: 1, rotaryAbc: [30, 0, 0], provA: [30] });
    expect(same.ghost).toBeNull();
    const ref = programZeroPose({ machine: TRSRN, wcs: wcs(g), kinsType: 0, rotary: [30, 0, 0] })!;
    close(same.primary!.pose.pos, ref.pos);
    const near = workMarkers({ ...base, kinsType: 0, g5xIndex: 1, rotaryAbc: [30 + TWP_PROV_A_EPS / 2, 0, 0], provA: [30] });
    expect(near.ghost).toBeNull();
    const off = workMarkers({ ...base, kinsType: 0, g5xIndex: 1, rotaryAbc: [30 + TWP_PROV_A_EPS * 1.5, 0, 0], provA: [30] });
    expect(off.ghost).not.toBeNull();
    const d = v3(off.ghost!.pos).distanceTo(v3(off.primary!.pose.pos));
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(1);
  });
  it("no stamp = the A0 rule (pre-W1 touch-off)", () => {
    const m = workMarkers({ ...base, kinsType: 0, g5xIndex: 1, rotaryAbc: [30, 0, 0], provA: null });
    close(m.primary!.pose.pos, g);
    expect(m.ghost).not.toBeNull();
  });
  it("the active fixture's OWN stamp is used (G55 stamped tilted, G54 not)", () => {
    const m = workMarkers({ ...base, kinsType: 0, g5xIndex: 2, rotaryAbc: [30, 0, 0], provA: [0, 30] });
    expect(m.primary!.label).toBe("G55");
    expect(m.ghost).toBeNull();
  });
  it("no switchable kins (kinsType null) reads as identity", () => {
    const a = workMarkers({ ...base, machine: TRSRN_TRIV, kinsType: null, g5xIndex: 1, rotaryAbc: [30, 0, 0], provA: [0] });
    const b = workMarkers({ ...base, machine: TRSRN_TRIV, kinsType: 0, g5xIndex: 1, rotaryAbc: [30, 0, 0], provA: [0] });
    close(a.primary!.pose.pos, b.primary!.pose.pos);
    close(a.ghost!.pos, b.ghost!.pos);
  });
  it("scrub: the ghost is a claim about the live machine — hidden while a sim pose shows", () => {
    const m = workMarkers({ ...base, kinsType: 0, g5xIndex: 1, rotaryAbc: [30, 0, 0], provA: [0], scrub: true });
    close(m.primary!.pose.pos, g);
    expect(m.ghost).toBeNull();
  });
  it("TCP: the numbers, table frame, no ghost", () => {
    const m = workMarkers({ ...base, kinsType: 1, g5xIndex: 1, rotaryAbc: [30, 0, 0], provA: [0] });
    close(m.primary!.pose.pos, g); close(m.primary!.pose.x, ID_X);
    expect(m.ghost).toBeNull();
  });
  it("Plane mode + G59: the plane compose; without a trio → hidden", () => {
    const frame = [0.3, 130.2455, -40.8555];
    const g5x = [1331.13, -1186.21, 74.13];
    const m = workMarkers({ ...base, wcs: wcs(g5x), kinsType: 2, g5xIndex: 6, frame, rotaryAbc: [0, 0, 0], provA: null });
    const ov = twpPlaneForSample({ spec: SPEC, kinstype: 2, frame, g5x, g92: [], rotationDeg: 0, a: 0 })!;
    expect(m.primary!.label).toBe("G59");
    close(m.primary!.pose.pos, [ov[0]!, ov[1]!, ov[2]!], 6);
    expect(m.ghost).toBeNull();
    const hidden = workMarkers({ ...base, wcs: wcs(g5x), kinsType: 2, g5xIndex: 6, frame: null, rotaryAbc: [0, 0, 0], provA: null });
    expect(hidden.primary).toBeNull();
  });
  it("bound fails (xyzac, work chain A+C): machine placement at the live pose, '· machine' label, one warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m1 = workMarkers({ machine: TRUNNION, wcs: wcs([100, 50, -30]), frame: null, scrub: false,
                             kinsType: null, g5xIndex: 1, rotaryAbc: [30, 0, 45], provA: [0] });
    const m2 = workMarkers({ machine: TRUNNION, wcs: wcs([100, 50, -30]), frame: null, scrub: false,
                             kinsType: null, g5xIndex: 1, rotaryAbc: [30, 0, 45], provA: [0] });
    expect(m1.primary!.label).toBe("G54 · machine");
    expect(m1.ghost).toBeNull();
    const ref = programZeroPose({ machine: TRUNNION, wcs: wcs([100, 50, -30]), kinsType: 0, rotary: [30, 0, 45] })!;
    close(m1.primary!.pose.pos, ref.pos);
    close(m2.primary!.pose.pos, ref.pos);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("A,C");
  });
  it("hides before the first status (no g5x) and on a broken chain", () => {
    expect(workMarkers({ ...base, wcs: wcs([]), kinsType: 0, g5xIndex: 1, rotaryAbc: [0, 0, 0], provA: null }))
      .toEqual({ primary: null, ghost: null });
    const broken: PartFrameMachine = { ...TRSRN, workGroup: "nope" };
    expect(workMarkers({ ...base, machine: broken, kinsType: 0, g5xIndex: 1, rotaryAbc: [0, 0, 0], provA: null }).primary).toBeNull();
  });
  it("uses the scratch poses when given", () => {
    const scratch = { primary: { pos: [0, 0, 0], x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0] } as ProgramZeroPose,
                      ghost: { pos: [0, 0, 0], x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0] } as ProgramZeroPose };
    const m = workMarkers({ ...base, kinsType: 0, g5xIndex: 1, rotaryAbc: [30, 0, 0], provA: [0] }, scratch);
    expect(m.primary!.pose).toBe(scratch.primary);
    expect(m.ghost).toBe(scratch.ghost);
  });
  it("g5xName covers the nine fixtures", () => {
    expect(g5xName(1)).toBe("G54"); expect(g5xName(6)).toBe("G59"); expect(g5xName(9)).toBe("G59.3");
  });
});

describe("markerInputsChanged — the repaint diff", () => {
  const st = { kins_type: 1, g5x_index: 1, kins_pre_rot: 0.1, kins_primary_angle: 10, kins_secondary_angle: 20,
               rotary_abc: [30, 0, 0], wcs_prov_a: [0, null, null, null, null, null, null, null, null] };
  it("an identical tick is not a change", () => {
    const prev = newMarkerInputsPrev();
    expect(markerInputsChanged(prev, st, false)).toBe(true);   // first sight
    expect(markerInputsChanged(prev, { ...st, rotary_abc: [30, 0, 0], wcs_prov_a: [...st.wcs_prov_a] }, false)).toBe(false);
  });
  it("M428 — kins type flips with identical fixture numbers and no motion: a change", () => {
    const prev = newMarkerInputsPrev();
    markerInputsChanged(prev, st, false);
    expect(markerInputsChanged(prev, { ...st, kins_type: 0 }, false)).toBe(true);
    expect(markerInputsChanged(prev, { ...st, kins_type: 0 }, false)).toBe(false);
  });
  it("stamps, the plane trio, the fixture index and the scrub flag are changes", () => {
    const prev = newMarkerInputsPrev();
    markerInputsChanged(prev, st, false);
    expect(markerInputsChanged(prev, { ...st, wcs_prov_a: null }, false)).toBe(true);
    expect(markerInputsChanged(prev, { ...st, wcs_prov_a: [20, null, null, null, null, null, null, null, null] }, false)).toBe(true);
    expect(markerInputsChanged(prev, { ...st, wcs_prov_a: [20, null, null, null, null, null, null, null, null], kins_secondary_angle: 21 }, false)).toBe(true);
    expect(markerInputsChanged(prev, { ...st, wcs_prov_a: [20, null, null, null, null, null, null, null, null], kins_secondary_angle: 21, g5x_index: 2 }, false)).toBe(true);
    expect(markerInputsChanged(prev, { ...st, wcs_prov_a: [20, null, null, null, null, null, null, null, null], kins_secondary_angle: 21, g5x_index: 2 }, true)).toBe(true);
    expect(markerInputsChanged(prev, { ...st, wcs_prov_a: [20, null, null, null, null, null, null, null, null], kins_secondary_angle: 21, g5x_index: 2 }, true)).toBe(false);
  });
});

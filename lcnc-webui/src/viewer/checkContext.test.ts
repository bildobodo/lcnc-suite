import { describe, expect, it } from "vitest";
import { basisFromLive, type CheckBasis } from "./checkBasis";
import { captureCheckContext, checkCard, programToolsOf, type ContextInputs } from "./checkContext";
import type { CollisionResult } from "./collision";

const AXES = ["X", "Y", "Z", "A", "C"];   // XYZAC: C is joint 4, canonical 5
const live = (over: Partial<Parameters<typeof basisFromLive>[0]> = {}): CheckBasis => basisFromLive({
  g5x: [-238.28, 10, -50, 0, 0, 15, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0, 0, 0, 0], rotationXy: 0,
  toolOffset: [0, 0, 65.04], wcsTable: null, toolNum: 3, toolDiam: 6, toolLen: 65.04,
  eoffsetZ: null, eoffsetEnabled: null, ...over }, null);
const runBasis = (joints: number[] | null): CheckBasis => ({ ...live(), kind: "run", runId: 7, startJoints: joints });
const inputs = (over: Partial<ContextInputs> = {}): ContextInputs => ({
  basis: live(), axes: AXES, kins: 1, kinsSwitches: false, rotaryAbc: [61.3, 0, -12.5], fixture: 1, ...over });
const result = (over: Partial<CollisionResult> = {}): CollisionResult => ({
  hits: [], staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 5,
  pairsPrescreened: 0, bvhMs: 0, sweepMs: 0, truncated: null, ...over });
const opts = { stale: false, entry: false, unit: "mm" };
const row = (v: ReturnType<typeof checkCard>, label: string) => v.rows.find(r => r.label === label);

describe("the check basis card (step 4 plan 1c)", () => {
  it("the kinematics the program is posed in; the rotary axes by letter when the check began (A from abc[0], C from abc[2])", () => {
    const v = checkCard(captureCheckContext(inputs()), null, opts);
    expect(row(v, "Kinematics")).toEqual({ label: "Kinematics", value: "TCP" });
    expect(row(v, "Rotary axes")).toEqual({ label: "Rotary axes", value: "A 61.30° C -12.50°" });
    expect(v.notes).toEqual([]);
    expect(row(checkCard(captureCheckContext(inputs({ kinsSwitches: true })), null, opts), "Kinematics")!.value)
      .toBe("TCP · switches in the program");
    // a machine without rotary axes has no such row
    expect(row(checkCard(captureCheckContext(inputs({ axes: ["X", "Y", "Z"] })), null, opts), "Rotary axes")).toBeUndefined();
  });

  it("in a run reads the rotary axes from the run's start joints in JOINT order and names that", () => {
    // joint 4 is C on XYZAC: an index taken as the canonical slot would read A's neighbour
    const ctx = captureCheckContext(inputs({ basis: runBasis([1, 2, 3, 40, 90]), kins: 0, rotaryAbc: [0, 0, 0] }));
    const v = checkCard(ctx, null, opts);
    expect(row(v, "Kinematics")!.value).toBe("Machine frame");
    expect(row(v, "Rotary axes")!.value).toBe("A 40.00° C 90.00°");
    expect(row(v, "Basis")!.value).toBe("The run's start (run 7)");
    expect(v.notes).toEqual(["In a run, the rotary axes are the run's start joints."]);
  });

  it("a run without start joints says the rotary axes were not read (warn)", () => {
    const v = checkCard(captureCheckContext(inputs({ basis: runBasis(null) })), null, opts);
    expect(row(v, "Rotary axes")).toEqual({ label: "Rotary axes", value: "Not read", warn: true });
  });

  it("a label the machine's family does not know is said (warn)", () => {
    expect(row(checkCard(captureCheckContext(inputs({ kins: null })), null, opts), "Kinematics"))
      .toEqual({ label: "Kinematics", value: "Unknown", warn: true });
  });

  it("the work offset with every axis; G92 and the XY rotation only when set", () => {
    let v = checkCard(captureCheckContext(inputs()), null, opts);
    expect(row(v, "Work offset")!.value).toBe("G54 X -238.280 Y 10.000 Z -50.000 A 0.00° C 15.00°");
    expect(row(v, "G92")).toBeUndefined();
    expect(row(v, "XY rotation")).toBeUndefined();
    v = checkCard(captureCheckContext(inputs({ fixture: 2, basis: live({ g92: [0, 0, 1.5, 0, 0, 0, 0, 0, 0], rotationXy: 30 }) })), null, opts);
    expect(row(v, "Work offset")!.value.startsWith("G55 ")).toBe(true);
    expect(row(v, "G92")!.value).toBe("Z 1.500");
    expect(row(v, "XY rotation")!.value).toBe("30.00°");
  });

  it("the tools are the TABLE's values: the start tool, then each program tool once, an M600 length assumed, a tool without a length named", () => {
    const tools = programToolsOf({
      tloEvents: [{ seq: 1, xyz: [0, 0, 0], tool: 1 }, { seq: 5, xyz: [0, 0, 0], tool: 7 }, { seq: 9, xyz: [0, 0, 0], tool: 1 },
                  { seq: 12, xyz: [0, 0, 0], tool: 9 }, { seq: 14, xyz: [0, 0, 0], tool: null }],
      parseTlos: [[1, 0, 0, -50, 6], [7, 0, 0, 65.04, 10]], toollenTable: [[5, 7, 65.04, 12]], unknownTools: [9] });
    expect(tools).toEqual([{ num: 1, len: 50, diam: 6, assumed: false, unknown: false },
      { num: 7, len: 65.04, diam: 10, assumed: true, unknown: false },
      { num: 9, len: null, diam: null, assumed: false, unknown: true }]);
    const v = checkCard({ ...captureCheckContext(inputs()), programTools: tools }, null, opts);
    expect(row(v, "Start tool")!.value).toBe("T3 · L 65.040 · Ø 6.000 mm · tool table");
    const i = v.rows.findIndex(r => r.label === "Program tools");
    expect(v.rows.slice(i, i + 3)).toEqual([
      { label: "Program tools", value: "T1 · L 50.000 · Ø 6.000 mm" },
      { label: "", value: "T7 · L 65.040 · Ø 10.000 mm · table length, assumed at its measurement" },
      { label: "", value: "T9 · no length in the table — its own pairs not checked" }]);
    expect(row(checkCard(captureCheckContext(inputs({ basis: live({ toolNum: 0 }) })), null, opts), "Start tool")!.value)
      .toBe("None — the check uses a stub body");
  });

  it("where the check begins: the first point, the entry move, a run's whole program or its provisional start", () => {
    expect(row(checkCard(captureCheckContext(inputs()), null, opts), "Start")!.value).toBe("The program's first point");
    expect(row(checkCard(captureCheckContext(inputs()), null, { ...opts, entry: true }), "Start")!.value)
      .toBe("The machine's position — the entry move included");
    expect(row(checkCard(captureCheckContext(inputs({ basis: runBasis(null) })), null, opts), "Start")!.value).toBe("The whole program");
    expect(row(checkCard(captureCheckContext(inputs({ basis: runBasis(null), fromLine: 7 })), null, opts), "Start")!.value)
      .toBe("From L7, provisional");
  });

  it("an idle basis that is no longer the machine's state says so; a run's basis is the run's start, never 'changed'", () => {
    expect(row(checkCard(captureCheckContext(inputs()), null, { ...opts, stale: true }), "Basis"))
      .toEqual({ label: "Basis", value: "The machine when the check started — changed since", warn: true });
    expect(row(checkCard(captureCheckContext(inputs({ basis: runBasis(null) })), null, { ...opts, stale: true }), "Basis"))
      .toEqual({ label: "Basis", value: "The run's start (run 7)" });
  });

  it("a status that changes after the check began does not change the card", () => {
    const abc = [61.3, 0, -12.5];
    const b = live();
    const ctx = captureCheckContext(inputs({ basis: b, rotaryAbc: abc }));
    const before = JSON.stringify(checkCard(ctx, null, opts));
    abc[0] = 0;
    expect(JSON.stringify(checkCard(ctx, null, opts))).toBe(before);
  });

  it("what the result left out: each pair at rest once, the pairs out of reach, the bodies by class, a provisional check's boundary contacts", () => {
    const r = result({
      staticContacts: [{ a: "x_slide", b: "y_saddle", dist: 0 }, { a: "y_saddle", b: "x_slide", dist: 0 }, { a: "column", b: "base", dist: 1 }],
      pairsPrescreened: 59, bodies: { unusable: ["broken_part"], damaged: ["chipped_part"], open: ["frame"] },
      boundaryContacts: [{ a: "tool", b: "c_faceplate", line: 7, cum: 0, dist: 0, cutting: false }] });
    const v = checkCard(captureCheckContext(inputs()), r, opts);
    const i = v.rows.findIndex(x => x.label === "In contact at rest — excluded");
    expect(v.rows.slice(i, i + 2)).toEqual([
      { label: "In contact at rest — excluded", value: "X slide ↔ Y saddle" },
      { label: "", value: "Column ↔ Base" }]);
    expect(row(v, "Out of reach — excluded")!.value).toBe("59 pairs");
    expect(row(v, "Not checked")).toEqual({ label: "Not checked", value: "Broken part", warn: true });
    expect(row(v, "Partly checked")).toEqual({ label: "Partly checked", value: "Chipped part", warn: true });
    expect(row(v, "No inside check (open surface)")!.value).toBe("Frame");
    expect(row(v, "In contact at the check's start")).toEqual({ label: "In contact at the check's start", value: "Tool ↔ C faceplate (L7)", warn: true });
    // nothing of the result before it has one
    expect(row(checkCard(captureCheckContext(inputs()), null, opts), "Out of reach — excluded")).toBeUndefined();
  });

  it("no context: the card says no check has run", () => {
    expect(checkCard(null, null, opts)).toEqual({ rows: [], notes: ["No check has run on this program yet."] });
  });
});

import { describe, expect, it } from "vitest";
import { basisFromLive, type CheckBasis } from "./checkBasis";
import { captureCheckContext, checkCard, headerOf, nextHeaderCache, programToolsOf, publicationKey, type ContextInputs } from "./checkContext";
import { scanToolHeader } from "./programToolHeader";
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
  staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 5,
  pairsPrescreened: 0, bvhMs: 0, sweepMs: 0, truncated: null, ...over });
const opts = { stale: false, entry: false, unit: "mm" };
const BODY = "The check's tool body: the table length + 20 mm, at least 40 mm, and the table's diameter (none: a 6 mm stub).";
const row = (v: ReturnType<typeof checkCard>, label: string) => v.rows.find(r => r.label === label);

describe("the check basis card (step 4 plan 1c)", () => {
  it("the kinematics the program is posed in; the rotary axes by letter when the check began (A from abc[0], C from abc[2])", () => {
    const v = checkCard(captureCheckContext(inputs()), null, opts);
    expect(row(v, "Program kinematics")).toEqual({ label: "Program kinematics", value: "TCP" });
    expect(row(v, "Rotary axes")).toEqual({ label: "Rotary axes", value: "A 61.30° C -12.50°" });
    expect(v.notes).toEqual([BODY]);
    expect(row(checkCard(captureCheckContext(inputs({ kinsSwitches: true })), null, opts), "Program kinematics")!.value)
      .toBe("TCP · switches in the program");
    // a machine without rotary axes has no such row
    expect(row(checkCard(captureCheckContext(inputs({ axes: ["X", "Y", "Z"] })), null, opts), "Rotary axes")).toBeUndefined();
  });

  it("in a run reads the rotary axes from the run's start joints in JOINT order and names that", () => {
    // joint 4 is C on XYZAC: an index taken as the canonical slot would read A's neighbour
    const ctx = captureCheckContext(inputs({ basis: runBasis([1, 2, 3, 40, 90]), kins: 0, rotaryAbc: [0, 0, 0] }));
    const v = checkCard(ctx, null, opts);
    expect(row(v, "Program kinematics")!.value).toBe("Machine frame");
    expect(row(v, "Rotary axes")!.value).toBe("A 40.00° C 90.00°");
    expect(row(v, "Basis")!.value).toBe("The run's start (run 7)");
    expect(v.notes).toEqual(["In a run, the rotary axes are the run's start joints.", BODY]);
  });

  it("a run without start joints says the rotary axes were not read (warn)", () => {
    const v = checkCard(captureCheckContext(inputs({ basis: runBasis(null) })), null, opts);
    expect(row(v, "Rotary axes")).toEqual({ label: "Rotary axes", value: "Not read", warn: true });
  });

  it("a label the machine's family does not know is said (warn)", () => {
    expect(row(checkCard(captureCheckContext(inputs({ kins: null })), null, opts), "Program kinematics"))
      .toEqual({ label: "Program kinematics", value: "Unknown", warn: true });
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
    // without a resolver no line — never the sweep's raw 7 (Codex R172 VP-I126)
    expect(row(v, "In contact at the check's start")).toEqual({ label: "In contact at the check's start", value: "Tool ↔ C faceplate (—)", warn: true });
    // with the shown track: its DISPLAY line at the contact's place (C3) — a
    // call line, else the subroutine's name — never the sweep's raw 7
    const call = Object.assign((_p: number) => 4, { nameAt: () => "touch" });
    expect(row(checkCard(captureCheckContext(inputs()), r, { ...opts, lineAt: call }), "In contact at the check's start")!.value).toBe("Tool ↔ C faceplate (L4)");
    const none = Object.assign((_p: number) => null, { nameAt: () => "touch" });
    expect(row(checkCard(captureCheckContext(inputs()), r, { ...opts, lineAt: none }), "In contact at the check's start")!.value).toBe("Tool ↔ C faceplate (touch)");
    // nothing of the result before it has one
    expect(row(checkCard(captureCheckContext(inputs()), null, opts), "Out of reach — excluded")).toBeUndefined();
  });

  it("no context: the card says no check has run", () => {
    expect(checkCard(null, null, opts)).toEqual({ rows: [], notes: ["No check has run on this program yet."] });
  });
});

// ── P6-e: the program header bound to the shown check's OWN publication
// (Codex R461 MT461-01): the text may arrive after the context was taken; its
// arrival adds only the header part; a text of another publication — V+1's,
// though the code panel binds it to the payload on screen — never enriches
// V's card; failed or unproven text never compares.
describe("the program header on the card, bound to the check's publication (P6-e, MT461-01)", () => {
  const HEAD = (d: string) => ["(1001)", `(T13 D=${d} CR=1. - FLAT END MILL)`, "N10 G90 G94 G17", "N15 G21",
                               "N20 G53 G0 Z0.", "N25 T13 M600", "N30 G0 X1 Y2"].join("\n");
  const pub = (version: number, source = "src-a", id = "mock.1") => ({ id, version, source });
  const ctxOf = (program: ContextInputs["program"], unit: string | null = "mm") => captureCheckContext(inputs({
    program, unit, tloEvents: [{ seq: 1, xyz: [0, 0, 0], tool: 13 }], parseTlos: [[13, 0, 0, 63.192, 8]] }));
  const text = (version: number, d: string, source = "src-a", programId = "mock.1") => ({ programId, version, source, text: HEAD(d) });
  const toolRow = (ctx: ReturnType<typeof ctxOf>, cache: Parameters<typeof headerOf>[0]) =>
    row(checkCard(ctx, null, { ...opts, header: headerOf(cache, ctx) }), "Program tools");
  const EMPTY = new Map() as Parameters<typeof headerOf>[0];

  it("captures the publication and its unit; null parts never form a key", () => {
    const c = ctxOf(pub(5));
    expect(c.program).toEqual({ id: "mock.1", version: 5, source: "src-a" });
    expect(c.unit).toBe("mm");
    expect(publicationKey(c)).not.toBeNull();
    for (const p of [{ id: null, version: 5, source: "s" }, { id: "x", version: null, source: "s" }, { id: "x", version: 5, source: null }, null]) {
      expect(publicationKey(ctxOf(p)), JSON.stringify(p)).toBeNull();
    }
    expect(ctxOf(pub(5), "furlong").unit).toBeNull();
  });

  it("text V delivered AFTER the check took its context: the header joins the card (no new context, no sweep)", () => {
    const c = ctxOf(pub(5));
    let cache = nextHeaderCache(EMPTY, [c], null);
    expect(toolRow(c, cache)).toEqual({ label: "Program tools", value: "T13 · L 63.192 · Ø 8.000 mm" });
    cache = nextHeaderCache(cache, [c], text(5, "1.875"));
    expect(toolRow(c, cache)).toEqual({ label: "Program tools", value: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 1.875", warn: true });
  });

  it("text V already proven when the check is asked for: the same header (both orders)", () => {
    const c = ctxOf(pub(5));
    expect(toolRow(c, nextHeaderCache(EMPTY, [c], text(5, "1.875")))!.warn).toBe(true);
    // a header that matches the table: nothing added
    expect(toolRow(c, nextHeaderCache(EMPTY, [c], text(5, "8."))))
      .toEqual({ label: "Program tools", value: "T13 · L 63.192 · Ø 8.000 mm" });
  });

  it("V → V+1: V+1's text never enriches V's card — not by its program, not by its source, not by a bound flag", () => {
    const v = ctxOf(pub(5));
    // V+1 is a re-parse of the same bytes (the same program, the same source):
    // only the version tells them apart
    for (const t of [text(6, "1.875"), text(6, "1.875", "src-b"), text(5, "1.875", "src-b"), text(5, "1.875", "src-a", "mock.2")]) {
      const cache = nextHeaderCache(EMPTY, [v], t);
      expect(headerOf(cache, v), JSON.stringify([t.programId, t.version, t.source])).toBeNull();
      expect(toolRow(v, cache)!.warn).toBeUndefined();
    }
    // V+1's own context takes it
    const v1 = ctxOf(pub(6));
    expect(toolRow(v1, nextHeaderCache(EMPTY, [v, v1], text(6, "1.875")))!.warn).toBe(true);
  });

  it("V's header stays with V's card while V+1's text is on screen; V+1's card gets only its own", () => {
    const v = ctxOf(pub(5));
    let cache = nextHeaderCache(EMPTY, [v], text(5, "8."));          // V's text matches the table
    const v1 = ctxOf(pub(6));
    cache = nextHeaderCache(cache, [v, v1], text(6, "1.875"));       // V+1's differs
    expect(toolRow(v, cache)!.warn).toBeUndefined();
    expect(toolRow(v1, cache)!.warn).toBe(true);
  });

  it("failed or unproven text: nothing to compare (no text, or none for this triple)", () => {
    const c = ctxOf(pub(5));
    expect(headerOf(nextHeaderCache(EMPTY, [c], null), c)).toBeNull();
    expect(headerOf(nextHeaderCache(EMPTY, [c], text(5, "1.875", "other-bytes")), c)).toBeNull();
    // a context without an identity never takes a text
    const anon = ctxOf(null);
    expect(headerOf(nextHeaderCache(EMPTY, [anon], text(5, "1.875")), anon)).toBeNull();
  });

  it("the cache holds only the live contexts' publications, scans once per key, and is the same object when nothing changes", () => {
    let scans = 0;
    const counting = (t: string) => { scans++; return scanToolHeader(t); };
    const a = ctxOf(pub(5)), b = ctxOf(pub(6));
    let cache = nextHeaderCache(EMPTY, [a], text(5, "1.875"), counting);
    const same = nextHeaderCache(cache, [a, a, null, undefined], text(5, "1.875"), counting);
    expect(same).toBe(cache);
    expect(scans).toBe(1);
    // a second context of the same publication shares its scan
    const a2 = ctxOf(pub(5));
    expect(nextHeaderCache(cache, [a, a2], text(5, "1.875"), counting)).toBe(cache);
    expect(headerOf(cache, a2)).toBe(headerOf(cache, a));
    // V's context gone: its scan is dropped
    cache = nextHeaderCache(cache, [b], text(6, "2"), counting);
    expect([...cache.keys()]).toEqual([publicationKey(b)]);
    expect(scans).toBe(2);
    expect(nextHeaderCache(cache, [], null).size).toBe(0);
  });

  it("the comparison uses the context's own unit; only the tool's row changes; a header tool without a row says nothing", () => {
    const c = ctxOf(pub(5), null);
    const cache = nextHeaderCache(EMPTY, [c], text(5, "1.875"));
    const v = checkCard(c, null, { ...opts, header: headerOf(cache, c) });
    expect(row(v, "Program tools")).toEqual({ label: "Program tools",
      value: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 1.875, machine units not read — not compared" });
    // the header's T7 has no row: nothing anywhere
    const other = { ...text(5, "1.875"), text: HEAD("1.875").replace("T13", "T7") };
    const c2 = ctxOf(pub(5));
    const v2 = checkCard(c2, null, { ...opts, header: headerOf(nextHeaderCache(EMPTY, [c2], other), c2) });
    expect(JSON.stringify(v2)).not.toContain("program header");
    // the start tool's row and the notes are untouched by a header
    const plain = checkCard(c2, null, opts);
    const hinted = checkCard(c2, null, { ...opts, header: headerOf(nextHeaderCache(EMPTY, [c2], text(5, "1.875")), c2) });
    expect(hinted.notes).toEqual(plain.notes);
    expect(hinted.rows.filter(r => r.label !== "Program tools")).toEqual(plain.rows.filter(r => r.label !== "Program tools"));
  });

  it("each tool row warns for its own difference only", () => {
    const c = captureCheckContext(inputs({ program: pub(5), unit: "mm",
      tloEvents: [{ seq: 1, xyz: [0, 0, 0], tool: 13 }, { seq: 4, xyz: [0, 0, 0], tool: 2 }],
      parseTlos: [[13, 0, 0, 63.192, 8], [2, 0, 0, 40, 6]] }));
    const t = { programId: "mock.1", version: 5, source: "src-a",
                text: ["(T13 D=8.)", "(T2 D=3.)", "G21", "G0 X0"].join("\n") };
    const v = checkCard(c, null, { ...opts, header: headerOf(nextHeaderCache(EMPTY, [c], t), c) });
    const i = v.rows.findIndex(r => r.label === "Program tools");
    expect(v.rows.slice(i, i + 2)).toEqual([
      { label: "Program tools", value: "T13 · L 63.192 · Ø 8.000 mm" },
      { label: "", value: "T2 · L 40.000 · Ø 6.000 mm · program header Ø 3.", warn: true }]);
  });
});

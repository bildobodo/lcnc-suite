// The program header's tool diameters (P6-e, machine-day F6; Codex R461
// MT461-02 and its tolerance decision): the small straight-line grammar, the
// unit, duplicates by their spread, the tolerance boundaries in mm and inch.
import { describe, expect, it } from "vitest";
import { compareHeaderD, HEADER_D_TOLERANCE_MM, HEADER_MAX_LINES, headerNote, scanToolHeader, type ToolHeaderScan }
  from "./programToolHeader";

const lines = (...l: string[]) => l.join("\n");
// The machine-day head's FORM (a synthetic copy — not the operator's program):
// the name, the tool list, the modal line, `N15 G21`, then `G53 G0 Z0.`
const DAY_FORM = lines(
  "(1001)",
  "(T13 D=1.875 CR=1. TAPER=3.7DEG - ZMIN=-20. - TAPERED MILL)",
  "N10 G90 G94 G17 G91.1",
  "N15 G21",
  "(MACHINE)",
  "(VENDOR SYNTHETIC)",
  "N20 G53 G0 Z0.",
  "(OPERATION 1)",
  "N25 T13 M600",
  "N30 S3000 M3",
  "N50 G0 X10. Y20.",
  "N60 G1 Z-3. F1000.",
);
const head = (unit: string, ...entries: string[]) => lines(...entries, "G90 G94 G17", unit, "G0 X0 Y0", "G1 Z-1 F100");

describe("the scan: a small straight-line header grammar (MT461-02)", () => {
  it("reads the machine-day form: the tool entry and N15 G21 before the first motion", () => {
    expect(scanToolHeader(DAY_FORM)).toEqual({ unit: "mm", unitWhy: null, entries: [{ tool: 13, raw: "1.875", value: 1.875 }] });
  });

  it("simple G20 and G21 heads give the unit; neither is not stated; both is not proven", () => {
    expect(scanToolHeader(head("G20", "(T1 D=0.25)"))).toMatchObject({ unit: "in", unitWhy: null });
    expect(scanToolHeader(head("G21", "(T1 D=6.)"))).toMatchObject({ unit: "mm", unitWhy: null,
      entries: [{ tool: 1, raw: "6.", value: 6 }] });
    expect(scanToolHeader(head("", "(T1 D=6.)"))).toMatchObject({ unit: null, unitWhy: "none" });
    expect(scanToolHeader(lines("(T1 D=6.)", "G20", "G21", "G0 X0"))).toMatchObject({ unit: null, unitWhy: "both" });
    expect(scanToolHeader(lines("G20 G21", "G0 X0"))).toMatchObject({ unit: null, unitWhy: "both" });
  });

  it("a sub DEFINITION's G20 is no unit (Codex R461's case): not proven, nothing compared", () => {
    const s = scanToolHeader(lines("(T13 D=6.0)", "o100 sub", "G20", "o100 endsub", "G0 X1", "M2"));
    expect(s).toEqual({ unit: null, unitWhy: "unproven", entries: [{ tool: 13, raw: "6.0", value: 6 }] });
    expect(compareHeaderD(s, 13, 6, "mm")).toEqual({ kind: "notCompared", raw: "6.0", why: "unitsNotProven" });
  });

  it("control flow, calls and conditionals: not proven, even after a plain G21", () => {
    for (const c of ["o100 call", "o1 if [#1 GT 0]", "o2 while [#1 LT 3]", "O<sub> call", "o3 repeat [2]"]) {
      expect(scanToolHeader(lines("(T1 D=6)", "G21", c, "G0 X0")).unitWhy, c).toBe("unproven");
    }
  });

  it("block delete: `/G20` runs or not with the switch — not proven; a deleted comment is harmless", () => {
    expect(scanToolHeader(lines("(T1 D=6)", "/G20", "G0 X0")).unitWhy).toBe("unproven");
    expect(scanToolHeader(lines("(T1 D=6)", "G21", "/G20", "G0 X0")).unitWhy).toBe("unproven");
    expect(scanToolHeader(lines("(T1 D=6)", "/(a comment)", "G21", "G0 X0")).unit).toBe("mm");
  });

  it("a G-word inside a parameter name is no G-word; parameters and expressions are not plain code", () => {
    expect(scanToolHeader(lines("(T1 D=6)", "#<g20> = 1", "G0 X0")).unitWhy).toBe("unproven");
    expect(scanToolHeader(lines("(T1 D=6)", "G21", "#<g20> = 1", "G0 X0")).unitWhy).toBe("unproven");
    expect(scanToolHeader(lines("(T1 D=6)", "#1 = 20", "G#1", "G0 X0")).unitWhy).toBe("unproven");
    expect(scanToolHeader(lines("(T1 D=6)", "G[20]", "G0 X0")).unitWhy).toBe("unproven");
  });

  it("a comment left open is not plain code; `;` ends the code; spaces and case are the interpreter's", () => {
    expect(scanToolHeader(lines("(T1 D=6)", "G21 (open", "G0 X0")).unitWhy).toBe("unproven");
    expect(scanToolHeader(lines("(T1 D=6)", "G21 ; metric", "G0 X0")).unit).toBe("mm");
    expect(scanToolHeader(lines("(T1 D=6)", "; G20", "G21", "G0 X0")).unit).toBe("mm");
    expect(scanToolHeader(lines("(T1 D=6)", "(G20 in a comment)", "G21", "G0 X0")).unit).toBe("mm");
    expect(scanToolHeader(lines("(T1 D=6)", "g 2 1", "G0 X0")).unit).toBe("mm");
    expect(scanToolHeader(lines("%", "(T1 D=6)", "G21", "G0 X0", "%")).unit).toBe("mm");
    expect(scanToolHeader(lines("(T1 D=6)\r", "G21\r", "G0 X0\r")).unit).toBe("mm");
  });

  it("ends with the first motion's line: a unit on it counts (set before the move), one after it does not", () => {
    expect(scanToolHeader(lines("(T1 D=6)", "G21 G0 X0", "G20")).unit).toBe("mm");
    expect(scanToolHeader(lines("(T1 D=6)", "G0 X0", "G20")).unitWhy).toBe("none");
    expect(scanToolHeader(lines("(T1 D=6)", "G21", "G0 X0", "G20")).unit).toBe("mm");
    // every moving code ends it; G28.1 / G30.1 only store
    for (const m of ["G1 X1", "G2 X1 I1", "G3 X1 I1", "G5.2 X1", "G33 Z-1 K1", "G38.2 Z-1", "G73 Z-1 R1",
                     "G76 Z-1 P1", "G81 Z-1 R1", "G89 Z-1 R1", "G28", "G30", "G53 G0 Z0"]) {
      expect(scanToolHeader(lines("(T1 D=6)", m, "G21")).unitWhy, m).toBe("none");
    }
    expect(scanToolHeader(lines("(T1 D=6)", "G28.1", "G30.1", "G21", "G0 X0")).unit).toBe("mm");
    // an axis word moves in the modal mode — except under G10, G43.1, G52, G92
    expect(scanToolHeader(lines("(T1 D=6)", "X0", "G21")).unitWhy).toBe("none");
    expect(scanToolHeader(lines("(T1 D=6)", "G43 Z15. H1", "G21")).unitWhy).toBe("none");
    expect(scanToolHeader(lines("(T1 D=6)", "G10 L2 P1 X0 Y0", "G92 X0", "G52 X1", "G43.1 Z1", "G21", "G0 X0")).unit).toBe("mm");
    // M-codes and the tool words are plain words (a remap behind one is not followed)
    expect(scanToolHeader(lines("(T1 D=6)", "T1 M6", "S1000 M3", "G21", "G0 X0")).unit).toBe("mm");
  });

  it("entries: only `(T<n> D=<d>` at a line's start, before the motion's end", () => {
    const s = scanToolHeader(lines("(T1 D=6.)", "(T2D=3)", "(T3 D=)", "G21 (T4 D=5)", "( T5 D=5)", "(T6 D=0)",
                                    "(T7 D=.5 BALL)", "(T8 D=12) G90", "G0 X0", "(T9 D=8)"));
    expect(s.entries.map(e => [e.tool, e.raw])).toEqual([[1, "6."], [7, ".5"], [8, "12"]]);
  });

  it("reads at most HEADER_MAX_LINES lines: a unit beyond is not proven; within it counts", () => {
    const pad = (n: number) => Array.from({ length: n }, (_, i) => `(line ${i})`);
    expect(scanToolHeader(lines("(T1 D=6)", ...pad(HEADER_MAX_LINES - 3), "G21", "G0 X0")).unit).toBe("mm");
    expect(scanToolHeader(lines("(T1 D=6)", ...pad(HEADER_MAX_LINES - 1), "G21", "G0 X0")).unitWhy).toBe("unproven");
    expect(scanToolHeader(lines("(T1 D=6)", "G21", ...pad(HEADER_MAX_LINES), "G0 X0")).unitWhy).toBe("unproven");
  });

  it("a whole program after the header is never read: a 2 MB tail scans like its head", () => {
    const tail = Array.from({ length: 120_000 }, (_, i) => `G1 X${i % 97} Y${i % 89} F500`).join("\n");
    expect(scanToolHeader(`${DAY_FORM}\n${tail}`)).toEqual(scanToolHeader(DAY_FORM));
  });
});

// ── The comparison ──
const scan = (unit: "mm" | "in" | null, ...values: string[]): ToolHeaderScan => ({
  unit, unitWhy: unit ? null : "none", entries: values.map(raw => ({ tool: 13, raw, value: Number(raw) })) });
const IN = 25.4;
const T = HEADER_D_TOLERANCE_MM;

describe("the comparison: 0.001 mm physical, converted into the comparison's units (Codex R461)", () => {
  it("mm header on an mm machine: 0.0009 mm within, 0.0011 mm a difference", () => {
    expect(compareHeaderD(scan("mm", "8.0009"), 13, 8, "mm")).toEqual({ kind: "match" });
    expect(compareHeaderD(scan("mm", "8.0011"), 13, 8, "mm")).toMatchObject({ kind: "mismatch", raw: "8.0011" });
    expect(compareHeaderD(scan("mm", "7.9991"), 13, 8, "mm")).toEqual({ kind: "match" });
    expect(compareHeaderD(scan("mm", "7.9989"), 13, 8, "mm")).toMatchObject({ kind: "mismatch" });
    expect(compareHeaderD(scan("mm", "1.875"), 13, 8, "mm")).toEqual({ kind: "mismatch", raw: "1.875", headerUnit: "mm", inMachine: 1.875 });
  });

  it("inch header on an inch machine: the tolerance is 0.001 / 25.4 in", () => {
    const d = 0.315;
    expect(compareHeaderD(scan("in", String(d + 0.0009 / IN)), 13, d, "in")).toEqual({ kind: "match" });
    expect(compareHeaderD(scan("in", String(d + 0.0011 / IN)), 13, d, "in")).toMatchObject({ kind: "mismatch" });
    expect(compareHeaderD(scan("in", String(d - 0.0011 / IN)), 13, d, "in")).toMatchObject({ kind: "mismatch" });
  });

  it("inch header on an mm machine: converted, 0.0009 / 0.0011 mm", () => {
    expect(compareHeaderD(scan("in", "0.315"), 13, 0.315 * IN + 0.0009, "mm")).toEqual({ kind: "match" });
    const m = compareHeaderD(scan("in", "0.315"), 13, 0.315 * IN + 0.0011, "mm");
    expect(m).toMatchObject({ kind: "mismatch", raw: "0.315", headerUnit: "in" });
    expect((m as { inMachine: number }).inMachine).toBeCloseTo(8.001, 9);
    // the plan's earlier "0.00005 in of rounding" is 0.00127 mm — past the
    // decided tolerance: a difference now (R461 retired that no-hint guard)
    expect(compareHeaderD(scan("in", "0.315"), 13, 0.315 * IN + 0.00005 * IN, "mm")).toMatchObject({ kind: "mismatch" });
  });

  it("mm header on an inch machine: converted, the tolerance in inch", () => {
    expect(compareHeaderD(scan("mm", "8"), 13, 8 / IN + 0.0009 / IN, "in")).toEqual({ kind: "match" });
    expect(compareHeaderD(scan("mm", "8"), 13, 8 / IN + 0.0011 / IN, "in")).toMatchObject({ kind: "mismatch", headerUnit: "mm" });
  });

  it("duplicates by the spread of ALL values: within the tolerance one value, beyond it a named conflict", () => {
    expect(compareHeaderD(scan("mm", "8", "8.0009"), 13, 8, "mm")).toEqual({ kind: "match" });
    expect(compareHeaderD(scan("mm", "8", "8.0011"), 13, 8, "mm")).toEqual({ kind: "conflict", lo: "8", hi: "8.0011" });
    // a chain of pairwise near values is no merge — in every order
    for (const order of [["8", "8.0006", "8.0012"], ["8.0012", "8", "8.0006"], ["8.0006", "8.0012", "8"]]) {
      expect(compareHeaderD(scan("mm", ...order), 13, 8, "mm"), order.join(" ")).toEqual({ kind: "conflict", lo: "8", hi: "8.0012" });
    }
    // in inch, judged physically
    expect(compareHeaderD(scan("in", "0.315", String(0.315 + 0.0009 / IN)), 13, 0.315, "in")).toEqual({ kind: "match" });
    expect(compareHeaderD(scan("in", "0.315", String(0.315 + 0.0011 / IN)), 13, 0.315, "in")).toMatchObject({ kind: "conflict" });
    // merged values far from the table: the one farthest from it is named
    expect(compareHeaderD(scan("mm", "1.8755", "1.875"), 13, 8, "mm")).toMatchObject({ kind: "mismatch", raw: "1.875" });
  });

  it("unknown stays unknown: no table diameter is never a substitute; no units, no comparison", () => {
    expect(compareHeaderD(scan("mm", "6"), 13, null, "mm")).toEqual({ kind: "notCompared", raw: "6", why: "noTableD" });
    expect(compareHeaderD(scan("mm", "6"), 13, 0, "mm")).toEqual({ kind: "notCompared", raw: "6", why: "noTableD" });
    expect(compareHeaderD(scan("mm", "6"), 13, 6, null)).toEqual({ kind: "notCompared", raw: "6", why: "machineUnit" });
    expect(compareHeaderD(scan(null, "6"), 13, 8, "mm")).toEqual({ kind: "notCompared", raw: "6", why: "unitsNotStated" });
    expect(compareHeaderD(scan("mm", "6"), 14, 8, "mm")).toBeNull();
    expect(compareHeaderD(null, 13, 8, "mm")).toBeNull();
    expect(T).toBe(0.001);
  });

  it("the card's words (one function)", () => {
    const n = (c: Parameters<typeof headerNote>[0], u = "mm") => headerNote(c, u);
    expect(n(compareHeaderD(scan("mm", "1.875"), 13, 8, "mm"))).toEqual({ text: "program header Ø 1.875", warn: true });
    expect(n(compareHeaderD(scan("in", "0.075"), 13, 8, "mm"))).toEqual({ text: "program header Ø 0.075 in (1.905 mm)", warn: true });
    expect(n(compareHeaderD(scan("mm", "1.875"), 13, 0.315, "in"), "in")).toEqual({ text: "program header Ø 1.875 mm (0.0738 in)", warn: true });
    expect(n(compareHeaderD(scan("mm", "1.875", "2"), 13, 8, "mm"))).toEqual({ text: "program header Ø 1.875 and Ø 2 — not compared", warn: true });
    expect(n(compareHeaderD(scan(null, "1.875"), 13, 8, "mm"))).toEqual({ text: "program header Ø 1.875, units not stated — not compared", warn: false });
    expect(n(compareHeaderD({ ...scan(null, "1.875"), unitWhy: "unproven" }, 13, 8, "mm")))
      .toEqual({ text: "program header Ø 1.875, units not proven — not compared", warn: false });
    expect(n(compareHeaderD(scan("mm", "1.875"), 13, null, "mm"))).toEqual({ text: "program header Ø 1.875, no diameter in the table — not compared", warn: false });
    expect(n(compareHeaderD(scan("mm", "8"), 13, 8, "mm"))).toBeNull();
    expect(n(null)).toBeNull();
  });
});

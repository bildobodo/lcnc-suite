import { describe, it, expect } from "vitest";
import { scanToolchangesBefore, revisionParts } from "./gcodeRfl";

describe("scanToolchangesBefore (RFL × M600 guard)", () => {
  it("finds a same-line T + M600 before the start line", () => {
    const text = "G21 G90\nT5 M600\nG0 X0\nG1 X10\n";
    expect(scanToolchangesBefore(text, 4)).toEqual({ count: 1, lastTool: 5, lastLine: 2 });
  });

  it("uses a T word from an earlier line (modal prepare)", () => {
    const text = "T13\nG4 P1\nM600\nG0 X0\n";
    expect(scanToolchangesBefore(text, 4)).toEqual({ count: 1, lastTool: 13, lastLine: 3 });
  });

  it("excludes a toolchange at or after the start line", () => {
    const text = "G21\nG0 X0\nT5 M600\nG1 X10\n";
    expect(scanToolchangesBefore(text, 3).count).toBe(0);
    expect(scanToolchangesBefore(text, 4).count).toBe(1);
  });

  it("ignores toolchanges inside comments", () => {
    const text = "; T5 M600 in a comment\n(M600 here too)\nG0 X0 (T9 M6)\nG1 X1\n";
    expect(scanToolchangesBefore(text, 5).count).toBe(0);
  });

  it("does not confuse M60/M66/M61 with M6, nor M6000 with M600", () => {
    const text = "M60\nM66 E0 L0\nM61 Q0\nM6000\nG0 X0\n";
    expect(scanToolchangesBefore(text, 6).count).toBe(0);
  });

  it("matches plain M6 and M06 with leading-zero T", () => {
    const text = "T07 M06\nG0 X0\n";
    expect(scanToolchangesBefore(text, 3)).toEqual({ count: 1, lastTool: 7, lastLine: 1 });
  });

  it("counts M601 as a toolchange", () => {
    const text = "T2\nM601\nG0 X0\n";
    expect(scanToolchangesBefore(text, 4)).toEqual({ count: 1, lastTool: 2, lastLine: 2 });
  });

  it("counts multiple toolchanges and reports the LAST tool", () => {
    const text = "T1 M600\nG1 X1\nT2 M600\nG1 X2\nG1 X3\n";
    const r = scanToolchangesBefore(text, 5);
    expect(r.count).toBe(2);
    expect(r.lastTool).toBe(2);
    expect(r.lastLine).toBe(3);
  });

  it("reports unknown tool (null) when M600 has no preceding T", () => {
    const text = "G21\nM600\nG0 X0\n";
    const r = scanToolchangesBefore(text, 4);
    expect(r.count).toBe(1);
    expect(r.lastTool).toBeNull();
  });

  it("returns empty for start line 1 or empty text", () => {
    expect(scanToolchangesBefore("", 10).count).toBe(0);
    expect(scanToolchangesBefore("T5 M600\n", 1).count).toBe(0);
  });

  it("handles T0 M600 (spindle unload) as tool 0", () => {
    const text = "T0 M600\nG0 X0\n";
    const r = scanToolchangesBefore(text, 3);
    expect(r.count).toBe(1);
    expect(r.lastTool).toBe(0);
  });
});

import { scanEntryPositionBefore } from "./gcodeRfl";

describe("scanEntryPositionBefore (RFL position preamble)", () => {
  it("tracks last plain X/Y values, WCS and units", () => {
    const text = "G21 G54 G90\nG0 X10 Y20\nG1 X15.5\nG1 Y-2.25 Z-1\nG1 X30 Z-2\nG1 Y5\n";
    const r = scanEntryPositionBefore(text, 6);
    expect(r).toEqual({ x: 30, y: -2.25, wcs: "G54", units: "G21", blockers: [] });
  });

  it("blocks on G91 incremental mode", () => {
    const r = scanEntryPositionBefore("G91\nG0 X1\n", 3);
    expect(r.blockers).toContain("G91 incremental mode");
  });

  it("does NOT block on G91.1 (arc mode)", () => {
    const r = scanEntryPositionBefore("G91.1\nG0 X1 Y1\n", 3);
    expect(r.blockers).toEqual([]);
    expect(r.x).toBe(1);
  });

  it("blocks on G92, G10, G28 and O-word flow", () => {
    const text = "G92 X0\nG10 L2 P1 X0\nG28\no<sub1> call\nG0 X1\n";
    const r = scanEntryPositionBefore(text, 6);
    expect(r.blockers).toEqual(expect.arrayContaining([
      "G92 offset", "G10 offset/table write", "G28/G30 home move", "O-word subroutine flow",
    ]));
  });

  it("blocks on non-numeric coordinates", () => {
    const r = scanEntryPositionBefore("G0 X#<width> Y[#<h>+2]\n.\n", 3);
    expect(r.blockers).toEqual(expect.arrayContaining([
      "non-numeric X coordinate", "non-numeric Y coordinate",
    ]));
  });

  it("blocks on rotary axis words and TCP (5-axis: preamble is XY-only)", () => {
    const r = scanEntryPositionBefore("G0 A45 X1\nG43.4 H1\n.\n", 4);
    expect(r.blockers).toEqual(expect.arrayContaining([
      "rotary/secondary axis words (preamble is XY-only)", "G43.4 TCP mode",
    ]));
  });

  it("blocks on multiple distinct work offsets", () => {
    const r = scanEntryPositionBefore("G54\nG0 X1\nG55\nG0 X2\n.\n", 6);
    expect(r.blockers.some(b => b.startsWith("multiple work offsets"))).toBe(true);
  });

  it("returns nulls when no X/Y words precede the start line", () => {
    const r = scanEntryPositionBefore("G21 G90\nM3 S1000\nF200\n.\n", 5);
    expect(r.x).toBeNull();
    expect(r.y).toBeNull();
    expect(r.blockers).toEqual([]);
  });

  it("ignores commented coordinates", () => {
    const r = scanEntryPositionBefore("(G0 X99)\n; X88\nG0 X7 Y8\n.\n", 5);
    expect(r.x).toBe(7);
    expect(r.y).toBe(8);
  });
});

describe("revisionParts (Codex R16 XZ-07: Run from line names its program)", () => {
  it("splits the published revision at the LAST #", () => {
    expect(revisionParts("/nc/part.ngc#40")).toEqual({ file: "/nc/part.ngc", version: 40 });
    expect(revisionParts("/nc/a#b.ngc#7")).toEqual({ file: "/nc/a#b.ngc", version: 7 });
  });
  it("names nothing without a published version", () => {
    for (const rev of ["", "/nc/part.ngc", "/nc/part.ngc#-1", "/nc/part.ngc#", "#3", "/nc/p.ngc#1.5"])
      expect(revisionParts(rev), rev).toBeNull();
  });
});

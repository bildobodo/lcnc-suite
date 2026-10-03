import { describe, it, expect } from "vitest";
import { GCODE_REFERENCE } from "./gcodeReference";
import {
  ACTIVE_FILTER, gCodeWords, mCodeWords, normaliseCode, refTargets, naturalCompare, referenceRows, unknownActive,
} from "./gcodeRefView";

// The XYZAC sim's STAT at idle, read 2026-10-03
const GCODES = [9, 800, -1, 170, 400, 210, 900, 940, 540, 490, 980, 640, -1, 970, 911, 80, -1];
const MCODES = [9, -1, 5, -1, 9, -1, 48, -1, 53, 0];
const ACTIVE = [...gCodeWords(GCODES), ...mCodeWords(MCODES)];
const q = (over: Partial<Parameters<typeof referenceRows>[1]> = {}) =>
  ({ search: "", group: "", active: ACTIVE, sortKey: "code" as const, asc: true, ...over });

describe("the active code words", () => {
  it("reads LinuxCNC's arrays as the strip shows them", () => {
    expect(gCodeWords(GCODES).join(" ")).toBe("G80 G17 G40 G21 G90 G94 G54 G49 G98 G64 G97 G91.1 G8");
    expect(mCodeWords(MCODES).join(" ")).toBe("M5 M9 M48 M53 M0");
    expect(gCodeWords(null)).toEqual([]);
    expect(mCodeWords(undefined)).toEqual([]);
  });
});

describe("a code word opens the reference AT its entry", () => {
  it("normalises leading zeros and case", () => {
    expect(normaliseCode("g01")).toBe("G1");
    expect(normaliseCode("M03")).toBe("M3");
    expect(normaliseCode("G00")).toBe("G0");
    expect(normaliseCode("G0")).toBe("G0");
    expect(normaliseCode("G10")).toBe("G10");
  });
  it("its own entry, else every form it heads, else nothing", () => {
    expect(refTargets(GCODE_REFERENCE, "G01")).toEqual(["G1"]);
    expect(refTargets(GCODE_REFERENCE, "G5")).toEqual(["G5"]);                 // exact beats G5.1 …
    expect(refTargets(GCODE_REFERENCE, "G10").sort(naturalCompare)).toEqual(["G10 L1", "G10 L2", "G10 L10", "G10 L11", "G10 L20"]);
    expect(refTargets(GCODE_REFERENCE, "G38").sort(naturalCompare)).toEqual(["G38.2", "G38.3", "G38.4", "G38.5"]);
    expect(refTargets(GCODE_REFERENCE, "G8")).toEqual([]);
    expect(refTargets(GCODE_REFERENCE, "")).toEqual([]);
  });
});

describe("the rows", () => {
  it("sort naturally: G2 before G10, G10 L2 before G10 L10", () => {
    const codes = referenceRows(GCODE_REFERENCE, q()).map(e => e.code);
    expect(codes.indexOf("G2")).toBeLessThan(codes.indexOf("G10 L1"));
    expect(codes.indexOf("G10 L2")).toBeLessThan(codes.indexOf("G10 L10"));
    expect(codes.indexOf("G59.3")).toBeLessThan(codes.indexOf("G61"));
    expect(codes).toHaveLength(GCODE_REFERENCE.length);
    const down = referenceRows(GCODE_REFERENCE, q({ asc: false })).map(e => e.code);
    expect(down).toEqual([...codes].reverse());
  });
  it("\"Active now\" lists exactly the active codes the reference knows", () => {
    const rows = referenceRows(GCODE_REFERENCE, q({ group: ACTIVE_FILTER })).map(e => e.code);
    expect(rows).toEqual(["G17", "G21", "G40", "G49", "G54", "G64", "G80", "G90", "G91.1", "G94", "G97", "G98",
      "M0", "M5", "M9", "M48", "M53"]);
    expect(unknownActive(GCODE_REFERENCE, ACTIVE)).toEqual(["G8"]);
    expect(referenceRows(GCODE_REFERENCE, q({ group: ACTIVE_FILTER, search: "plane" })).map(e => e.code)).toEqual(["G17", "G98"]);
  });
  it("a group and a search narrow as before", () => {
    const rows = referenceRows(GCODE_REFERENCE, q({ group: "Coordinate System" }));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(e => e.group === "Coordinate System")).toBe(true);
    expect(referenceRows(GCODE_REFERENCE, q({ search: "path blending" })).map(e => e.code)).toEqual(["G64"]);
  });
});

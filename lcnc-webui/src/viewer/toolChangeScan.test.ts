import { describe, expect, it } from "vitest";
import { toolChangeLinesFromText } from "./toolChangeScan";

describe("toolChangeLinesFromText", () => {
  it("finds M6 / M600 / M601 lines with the T word on the line or the last one before it", () => {
    const src = "G21 G90\nT13 M600\nG0 X0\nT5\nM6 (change)\n; M6 in a comment\nM60\nM601\n";
    expect(toolChangeLinesFromText(src)).toEqual([[2, 13], [5, 5], [8, 5]]);
  });
  it("M06 counts, M60 / M61 do not, a T inside a word or a comment does not set the tool, empty text gives nothing", () => {
    expect(toolChangeLinesFromText("M06 T2\nM61 Q3\n")).toEqual([[1, 2]]);
    expect(toolChangeLinesFromText("o<tool_touch> call\n#<_t9> = 1\n(T4)\nM6\n")).toEqual([[4, 0]]);
    expect(toolChangeLinesFromText(null)).toEqual([]);
    expect(toolChangeLinesFromText("")).toEqual([]);
  });
});

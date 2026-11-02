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
  // Codex R247 FH-06: a name in angle brackets — a named parameter, an
  // O-word's name — is an identifier, never an M word.
  it("an M6 / M600 / M601 inside a parameter's or an O-word's name is no tool change", () => {
    const src = "G21 G90\n#<m600_count> = 0\n#<m6> = 1\n#<m601_done> = 0\n(T99 M6)\n; M600 in a comment\n"
      + "o<m6_remap> call\n#<_t9> = #<m600>\nG1 X10 F100\nM2\n";
    expect(toolChangeLinesFromText(src)).toEqual([]);
    expect(toolChangeLinesFromText("#<m6> = 1 M6\n")).toEqual([[1, 0]]);
  });
  it("a word follows a number without a space: T13M600, N20M6, X1.M601", () => {
    expect(toolChangeLinesFromText("T13M600\nN20M6\nT4\nX1.M601\n")).toEqual([[1, 13], [2, 13], [4, 4]]);
  });
  it("a T word the text cannot evaluate (T#<n>, T[…]) leaves the tool unknown, never the T before it", () => {
    expect(toolChangeLinesFromText("T5\nT#<next> M600\nT7\nT[#1 + 1]\nM601\n")).toEqual([[2, 0], [5, 0]]);
  });
  // Codex R249 FH-07: a T word is recognized apart from its value — every new
  // one drops the T before it; only a number the scan fully reads names the
  // tool. LinuxCNC drops the spaces outside comments ("T1 3" is T13) and reads
  // the value as a real (a sign, a decimal, a function).
  it("every new T word drops the T before it; a sign, a function or an expression is unknown", () => {
    for (const word of ["T+#<next>", "T+[#1+1]", "TABS[-7]", "T-3", "T7.5", "T[7]"]) {
      expect(toolChangeLinesFromText(`T5\n${word} M600\n`), word).toEqual([[2, 0]]);
      expect(toolChangeLinesFromText(`T5\n${word}\nM601\n`), `${word} on its own line`).toEqual([[3, 0]]);
    }
  });
  it("a number the scan fully reads names the tool: a plus sign, a decimal point, spaces inside", () => {
    expect(toolChangeLinesFromText("T5\nT+7 M600\n")).toEqual([[2, 7]]);
    expect(toolChangeLinesFromText("T5\nT7.0 M600\nT8. M6\n")).toEqual([[2, 7], [3, 8]]);
    expect(toolChangeLinesFromText("T5\nT1 3 M600\n")).toEqual([[2, 13]]);
    expect(toolChangeLinesFromText("T5\nT 0 9\nM601\n")).toEqual([[3, 9]]);
  });
  it("a T inside a function or an operator is no T word: TAN, ATAN, SQRT, EXISTS, GT, LT", () => {
    const src = "T5\nG0 X[TAN[45]] Y[ATAN[1]/[1]]\n#1 = [SQRT[4] GT 1] + EXISTS[#<x>] + [2 LT 3]\nM600\n";
    expect(toolChangeLinesFromText(src)).toEqual([[4, 5]]);
  });
});

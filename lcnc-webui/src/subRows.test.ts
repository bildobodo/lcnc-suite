import { describe, it, expect } from "vitest";
import {
  splitSubLines, expansionAllowed, totalRows, rowAt, rowForMain, rowForSub,
  SUB_EXPANSION_MAX_LINES, type SubExpansion,
} from "./subRows";

// W5 inline sub view — the row mapping is the single source of truth for
// virtual scroll, highlight and click routing; pin every direction.
describe("subRows (W5 inline sub view)", () => {
  // The demo: 12-line main file, o<square> call at line 9, 11-line sub.
  const EXP: SubExpansion = {
    callLine: 9, name: "square",
    lines: Array.from({ length: 11 }, (_, i) => `sub line ${i + 1}`),
  };

  it("splitSubLines keeps content verbatim, drops the trailing empty split", () => {
    expect(splitSubLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitSubLines("a\r\nb")).toEqual(["a", "b"]);
    expect(splitSubLines("a\n\nb\n")).toEqual(["a", "", "b"]);
    expect(splitSubLines("")).toEqual([]);
  });

  it("expansionAllowed: only a literal o<name> call line, size-capped", () => {
    expect(expansionAllowed("o<square> call", "square", 11)).toBe(true);
    expect(expansionAllowed("  O<Square>call (draw it)", "square", 11)).toBe(true);
    // Remap trigger lines and other subs' calls never expand.
    expect(expansionAllowed("g53.3 x0y0z100", "g533remap", 20)).toBe(false);
    expect(expansionAllowed("o<other> call", "square", 11)).toBe(false);
    // Commented-out call is not a call; empty subs and huge files don't expand.
    expect(expansionAllowed(";o<square> call", "square", 11)).toBe(false);
    expect(expansionAllowed("o<square> call", "square", 0)).toBe(false);
    expect(expansionAllowed("o<square> call", "square", SUB_EXPANSION_MAX_LINES + 1)).toBe(false);
  });

  it("rowAt walks main → sub → main", () => {
    expect(rowAt(0, EXP)).toEqual({ kind: "main", lineNum: 1 });
    expect(rowAt(8, EXP)).toEqual({ kind: "main", lineNum: 9 });   // the call line
    expect(rowAt(9, EXP)).toEqual({ kind: "sub", lineNum: 1 });
    expect(rowAt(19, EXP)).toEqual({ kind: "sub", lineNum: 11 });
    expect(rowAt(20, EXP)).toEqual({ kind: "main", lineNum: 10 });
    expect(rowAt(22, EXP)).toEqual({ kind: "main", lineNum: 12 });
    // No expansion: identity.
    expect(rowAt(8, null)).toEqual({ kind: "main", lineNum: 9 });
  });

  it("rowForMain / rowForSub invert rowAt", () => {
    for (let m = 1; m <= 12; m++) {
      expect(rowAt(rowForMain(m, EXP), EXP)).toEqual({ kind: "main", lineNum: m });
    }
    for (let s = 1; s <= 11; s++) {
      expect(rowAt(rowForSub(s, EXP), EXP)).toEqual({ kind: "sub", lineNum: s });
    }
    expect(rowForMain(9, null)).toBe(8);
  });

  it("totalRows", () => {
    expect(totalRows(12, EXP)).toBe(23);
    expect(totalRows(12, null)).toBe(12);
  });
});

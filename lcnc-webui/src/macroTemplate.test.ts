import { describe, it, expect } from "vitest";
import { newMacroText, titleFromName } from "./macroTemplate";

describe("macroTemplate", () => {
  it("a new macro starts with a title from its name, the entry rule and its sub", () => {
    expect(titleFromName("face_top")).toBe("Face top");
    const t = newMacroText("park");
    expect(t.startsWith("(MACRO Park)\n")).toBe(true);
    expect(t).toContain("o<park> sub\n  M73\n  G21 G90 G94\n");
    expect(t.endsWith("o<park> endsub\n")).toBe(true);
  });
});

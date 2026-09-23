import { describe, expect, it } from "vitest";
import { CELLS, codePage, pageKeys, printableAscii, reachableChars, UMLAUTS, PAGE_ORDER } from "./textKeyboardPages";

describe("text keyboard pages (UI-15b)", () => {
  it("covers every printable ASCII character and the umlauts", () => {
    const reach = reachableChars(["X", "Y", "Z"]);
    const missing = [...printableAscii(), ...UMLAUTS].filter(c => !reach.has(c));
    expect(missing).toEqual([]);
  });

  it("every page is exactly CELLS cells (padded), on any axis set", () => {
    for (const axes of [["X", "Y", "Z"], ["X", "Y", "Z", "A", "C"], ["X", "Y", "Z", "A", "B", "C"],
                        ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"]]) {
      for (const page of PAGE_ORDER) {
        expect(pageKeys(page, axes, false)).toHaveLength(CELLS);
        expect(pageKeys(page, axes, true)).toHaveLength(CELLS);
      }
      const code = codePage(axes).filter(Boolean) as string[];
      expect(code.length).toBeLessThanOrEqual(CELLS);
      expect(new Set(code).size).toBe(code.length);   // no duplicate keys
    }
  });

  it("G1 X20 Y10 F1000 needs no page switch, on every machine", () => {
    for (const axes of [["X", "Y", "Z"], ["X", "Y", "Z", "A", "C"], ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"]]) {
      const code = new Set(codePage(axes).filter(Boolean));
      for (const ch of "G1X20Y10F1000") expect(code.has(ch), `${ch} on ${axes.join("")}`).toBe(true);
      for (const ch of [";", "(", ")", "#", ".", "-"]) expect(code.has(ch)).toBe(true);
      for (const a of axes) expect(code.has(a)).toBe(true);
    }
  });

  it("fills spare letter cells from I J K P R Q H D L N O E in order", () => {
    const xyz = codePage(["X", "Y", "Z"]).filter(Boolean) as string[];
    // 12 digits + 5 command letters + the 3 axes precede the fill.
    expect(xyz.slice(20, 26)).toEqual(["I", "J", "K", "P", "R", "Q"]);
    const nine = codePage(["X", "Y", "Z", "A", "B", "C", "U", "V", "W"]).filter(Boolean) as string[];
    expect(nine).not.toContain("I");
  });
});

import { describe, expect, it } from "vitest";
import { CELLS, codeLetters, codePage, pageKeys, printableAscii, reachableChars, UMLAUTS, PAGE_ORDER } from "./textKeyboardPages";

describe("text keyboard pages (UI-15b)", () => {
  it("covers every printable ASCII character and the umlauts", () => {
    const reach = reachableChars(["X", "Y", "Z"]);
    const missing = [...printableAscii(), ...UMLAUTS].filter(c => !reach.has(c));
    expect(missing).toEqual([]);
  });

  it("every page is exactly CELLS cells (padded), on any axis set", () => {
    for (const axes of [["X", "Y", "Z"], ["X", "Y", "Z", "A", "C"], ["X", "Y", "Z", "A", "B", "C"],
                        ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"]]) {
      for (const page of PAGE_ORDER) for (const cols of [6, 5]) {
        expect(pageKeys(page, axes, false, cols)).toHaveLength(CELLS);
        expect(pageKeys(page, axes, true, cols)).toHaveLength(CELLS);
      }
      for (const cols of [6, 5]) {
        const code = codePage(axes, cols).filter(Boolean) as string[];
        expect(code.length).toBe(CELLS);                  // the Code page is full
        expect(new Set(code).size).toBe(code.length);   // no duplicate keys
      }
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

  it("the letter block: commands, the axes, then I J K P R Q H D L N O E in order", () => {
    expect(codeLetters(["X", "Y", "Z"])).toEqual(["G", "M", "T", "F", "S", "X", "Y", "Z", "I", "J", "K", "P", "R", "Q"]);
    expect(codeLetters(["X", "Y", "Z", "A", "B", "C", "U", "V", "W"])).not.toContain("I");
  });

  // Design wave D7: spatial blocks, the same inner (reading) order in both
  // orientations — rows of the grid, 6 wide in landscape, 5 in portrait.
  const rows = (cells: (string | null)[], cols: number) =>
    Array.from({ length: cells.length / cols }, (_, r) => cells.slice(r * cols, (r + 1) * cols).join(" "));
  it("landscape Code page: the digit block left, the letters beside it, ; ( ) under the digits", () => {
    expect(rows(codePage(["X", "Y", "Z"], 6), 6)).toEqual([
      "7 8 9 G M T",
      "4 5 6 F S X",
      "1 2 3 Y Z I",
      "0 . - J K P",
      "; ( ) R Q #",
    ]);
  });
  it("portrait Code page: the same digit block, the letters beside and below it in the same order", () => {
    expect(rows(codePage(["X", "Y", "Z"], 5), 5)).toEqual([
      "7 8 9 G M",
      "4 5 6 T F",
      "1 2 3 S X",
      "0 . - Y Z",
      "I J K P R",
      "Q ; ( ) #",
    ]);
  });
  it("both orientations read the letters and the punctuation in one order", () => {
    for (const axes of [["X", "Y", "Z"], ["X", "Y", "Z", "A", "C"], ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"]]) {
      const order = (cells: (string | null)[]) => cells.filter(k => k && !/[0-9.-]/.test(k));
      expect(order(codePage(axes, 5)), axes.join("")).toEqual([...codeLetters(axes), ";", "(", ")", "#"]);
      // Landscape: ; ( ) sit under the digits, so they come before the last
      // two letters in reading order — the letters alone keep their order.
      const letters = (cells: (string | null)[]) => cells.filter(k => k && /[A-Z]/.test(k));
      expect(letters(codePage(axes, 6))).toEqual(codeLetters(axes));
      expect(letters(codePage(axes, 5))).toEqual(codeLetters(axes));
    }
  });
});

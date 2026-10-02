// Package 5 stage C: new macro files and "Convert to file" — a non-numeric
// default is named, never converted silently (Codex R69).
import { describe, it, expect } from "vitest";
import { convertToFile, nameFromLabel, newMacroText, nonNumericDefaults, titleFromName } from "./macroConvert";

const old = { id: "x", name: "Face Top", command: "G1 Z-{depth} F{Feed}", params: [] };

describe("macroConvert", () => {
  it("names and titles", () => {
    expect(nameFromLabel("Face Top!")).toBe("face_top");
    expect(nameFromLabel("***")).toBe("macro");
    expect(titleFromName("face_top")).toBe("Face top");
    expect(newMacroText("park")).toMatch(/^\(MACRO Park\)\n[\s\S]*o<park> sub\n  M73\n  G21 G90 G94\n[\s\S]*o<park> endsub\n$/);
  });
  it("a default that is no finite number is named, never converted", () => {
    const params = [
      { name: "depth", label: "Depth", unit: "length" as const, defaultText: "2" },
      { name: "Feed", label: "Feed", unit: "feed" as const, defaultText: "[#<_feed>]" },
    ];
    expect(nonNumericDefaults(params)).toEqual(["Feed"]);
    expect(convertToFile(old, "face_top", "mm", params)).toEqual({ error: "Enter a number for Feed" });
    expect(nonNumericDefaults([{ ...params[0]!, defaultText: " " }])).toEqual(["depth"]);
  });
  it("the file: header, the entry rule for the kinds, placeholders become positions", () => {
    const out = convertToFile(old, "face_top", "mm", [
      { name: "depth", label: "Depth", unit: "length", defaultText: "2" },
      { name: "Feed", label: "Feed", unit: "feed", defaultText: "600" },
    ]);
    expect("text" in out && out.text).toBe(`(MACRO Face Top)
(UNITS mm)
(PARAM 1 depth "Depth" length 2)
(PARAM 2 feed "Feed" feed 600)
(Converted from the earlier macro "Face Top".)
o<face_top> sub
  M73
  G21 G90 G94
  G1 Z-#1 F#2
o<face_top> endsub
`);
  });
  it("no length or feed: no UNITS, G90 alone; rpm brings G97", () => {
    const out = convertToFile({ ...old, command: "M3 S{s}" }, "spin", "inch", [{ name: "s", label: "Speed", unit: "rpm", defaultText: "1000" }]);
    expect("text" in out && out.text).toContain("  G90 G97\n");
    expect("text" in out && out.text).not.toContain("UNITS");
  });
});

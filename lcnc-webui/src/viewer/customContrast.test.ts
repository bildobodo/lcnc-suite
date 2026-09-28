import { describe, it, expect } from "vitest";
import { contrastRatio, customContrastRows, customPairRows, parseHex } from "./customContrast";
import type { ViewerPalette } from "./viewerPalette";

const base: ViewerPalette = {
  feed: "#1f5fbf", rapid: "#1e7f3f", backplot: "#a01860", bounds: "#555555", toolpathBounds: "#666666",
  tool: "#999999", cutter: "#c8a040", limit: "#8a5a00", collision: "#c00000", boundsCasing: "#3a3f45",
} as ViewerPalette;

describe("the Custom palette's contrast hint (Codex R25 OP-I05)", () => {
  it("measures like themeTokens.test: WCAG ratio, #rgb and #rrggbb", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(parseHex("rgb(1,2,3)")).toBeNull();
    expect(contrastRatio("red", "#fff")).toBeNull();
  });
  it("a line needs 3 : 1 on the background and on the lit table; 4.5 on the background in high contrast", () => {
    const rows = customContrastRows({ ...base, feed: "#ffff00" }, "#ffffff", false);
    const feed = rows.find(r => r.role === "feed")!;
    expect(feed.bgLow && feed.tableLow).toBe(true);     // yellow on white and on #e0e0e0
    const ok = rows.find(r => r.role === "rapid")!;
    expect(ok.bgLow || ok.tableLow).toBe(false);
    // a 3.5 : 1 line passes a normal theme's background, not a high-contrast one's
    const mid = "#808080";
    expect(contrastRatio(mid, "#ffffff")!).toBeGreaterThan(3);
    expect(contrastRatio(mid, "#ffffff")!).toBeLessThan(4.5);
    expect(customContrastRows({ ...base, rapid: mid }, "#ffffff", false).find(r => r.role === "rapid")!.bgLow).toBe(false);
    expect(customContrastRows({ ...base, rapid: mid }, "#ffffff", true).find(r => r.role === "rapid")!.bgLow).toBe(true);
  });
  it("a box: its core or the dark casing on the background and the table, and the core on the casing", () => {
    const cased = { ...base, boundsCasing: "#3a3f45" } as ViewerPalette;
    // the fixed light core: 1.9 : 1 on white alone, carried by its casing
    const light = customContrastRows({ ...cased, bounds: "#b8bec6" }, "#ffffff", false).find(r => r.role === "bounds")!;
    expect([light.bgLow, light.tableLow]).toEqual([false, false]);
    // a core as dark as its casing is lost on it
    const dark = customContrastRows({ ...cased, toolpathBounds: "#404040" }, "#101418", false).find(r => r.role === "toolpathBounds")!;
    expect(dark.casingLow).toBe(true);
  });
  it("names the failing comparison with its own value: a core like its casing is low ON THE CASING, not on the background (Codex R31 VP-I04)", () => {
    const same = customContrastRows({ ...base, boundsCasing: "#3a3f45", bounds: "#3a3f45" } as ViewerPalette, "#ffffff", false)
      .find(r => r.role === "bounds")!;
    // the casing carries the box on white and on the table — those hold
    expect([same.bgLow, same.tableLow]).toEqual([false, false]);
    expect(same.onBg!).toBeGreaterThan(10);
    // the core on its casing is what fails, told with its own ratio
    expect(same.onCasing).toBeCloseTo(1, 5);
    expect(same.casingLow).toBe(true);
    // a line has no casing: nothing to compare, never low
    const feed = customContrastRows(base, "#ffffff", false).find(r => r.role === "feed")!;
    expect([feed.onCasing, feed.casingLow]).toEqual([null, false]);
  });
  it("tool shaft and cutter are solids — no row; no selection row (the current line is not drawn in 3D)", () => {
    expect(customContrastRows(base, "#ffffff", false).map(r => r.role)).toEqual(
      ["feed", "rapid", "backplot", "bounds", "toolpathBounds"]);
  });
  it("tells the lines apart from each other: normal vision, colour-blind eyes, and the cue that carries a pair", () => {
    const fixed = { ...base, feed: "#0f86ba", rapid: "#ef0197", backplot: "#7c0bfa", limit: "#b06c02" } as ViewerPalette;
    const rows = customPairRows(fixed, false);
    expect(rows.map(r => `${r.a}/${r.b}`)).toEqual(
      ["feed/rapid", "feed/limit", "feed/backplot", "rapid/limit", "rapid/backplot", "limit/backplot"]);
    expect(rows.filter(r => r.normalLow || r.cvdLow), "the fixed palette holds every rule").toEqual([]);
    const fr = rows.find(r => r.a === "feed" && r.b === "rapid")!;
    expect(fr.cvd!).toBeLessThan(0.12);                      // the dash carries it for colour-blind eyes …
    expect([fr.cvdLow, fr.cue]).toEqual([false, "dashed"]);   // … and is named
    // the operator's old Custom set: cyan feed, magenta backplot — close for a deutan eye
    const old = customPairRows({ ...base, feed: "#22b8cf", rapid: "#f5a623", backplot: "#ff00ff", limit: "#b06c02" } as ViewerPalette, false);
    expect(old.find(r => r.a === "feed" && r.b === "backplot")!.cvdLow).toBe(true);
    const same = customPairRows({ ...fixed, backplot: fixed.feed }, false).find(r => r.a === "feed" && r.b === "backplot")!;
    expect([same.normal, same.normalLow]).toEqual([0, true]);
  });
});

import { describe, it, expect } from "vitest";
import { contrastRatio, customContrastRows, customPairRows, parseHex, MODEL_SURFACES, MODEL_MIN } from "./customContrast";
import type { ViewerPalette } from "./viewerPalette";

const base: ViewerPalette = {
  feed: "#1f5fbf", rapid: "#1e7f3f", backplot: "#a01860", bounds: "#555555", toolpathBounds: "#666666",
  tool: "#999999", cutter: "#c8a040", limit: "#8a5a00", collision: "#c00000", boundsAlt: "#f0f2f4",
} as ViewerPalette;

describe("the Custom palette's contrast hint (Codex R25 OP-I05)", () => {
  it("measures like themeTokens.test: WCAG ratio, #rgb and #rrggbb", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(parseHex("rgb(1,2,3)")).toBeNull();
    expect(contrastRatio("red", "#fff")).toBeNull();
  });
  it("a line needs 3 : 1 on the background (4.5 in high contrast) and MODEL_MIN on the machine's grey surfaces", () => {
    const rows = customContrastRows({ ...base, feed: "#ffff00", rapid: "#6a6f74" }, "#ffffff", false);
    const feed = rows.find(r => r.role === "feed")!;
    expect([feed.bgLow, feed.modelLow], "yellow: lost on white, fine on the grey model").toEqual([true, false]);
    const grey = rows.find(r => r.role === "rapid")!;
    expect([grey.bgLow, grey.modelLow], "a mid grey: fine on white, lost on the grey model").toEqual([false, true]);
    expect(grey.onModel!).toBeLessThan(MODEL_MIN);
    // the weakest surface counts
    expect(grey.onModel).toBeCloseTo(Math.min(...MODEL_SURFACES.map(s => contrastRatio("#6a6f74", s)!)), 6);
    // a 3.5 : 1 line passes a normal theme's background, not a high-contrast one's
    const mid = "#808080";
    expect(contrastRatio(mid, "#ffffff")!).toBeGreaterThan(3);
    expect(contrastRatio(mid, "#ffffff")!).toBeLessThan(4.5);
    expect(customContrastRows({ ...base, rapid: mid }, "#ffffff", false).find(r => r.role === "rapid")!.bgLow).toBe(false);
    expect(customContrastRows({ ...base, rapid: mid }, "#ffffff", true).find(r => r.role === "rapid")!.bgLow).toBe(true);
  });
  it("a box is two-tone (operator 2026-09-29): it reads where either tone does", () => {
    // a dark custom box colour on the dark scene: its light dashes carry it
    const dark = customContrastRows({ ...base, bounds: "#15181c" }, "#0b0f14", false).find(r => r.role === "bounds")!;
    expect([dark.bgLow, dark.modelLow]).toEqual([false, false]);
    expect(dark.onBg).toBeCloseTo(contrastRatio("#f0f2f4", "#0b0f14")!, 6);
    // both tones mid grey: lost on the grey model
    const lost = customContrastRows({ ...base, toolpathBounds: "#5a5f63", boundsAlt: "#60656a" } as ViewerPalette, "#ffffff", false)
      .find(r => r.role === "toolpathBounds")!;
    expect(lost.modelLow).toBe(true);
    expect(Object.keys(lost).sort(), "background and machine, nothing else").toEqual(["bgLow", "modelLow", "onBg", "onModel", "role"]);
  });
  it("tool shaft and cutter are solids — no row; no selection row (the current line is not drawn in 3D)", () => {
    expect(customContrastRows(base, "#ffffff", false).map(r => r.role)).toEqual(
      ["feed", "rapid", "backplot", "bounds", "toolpathBounds"]);
  });
  it("tells the lines apart from each other — colour-vision deficiency is no criterion (operator 2026-09-29)", () => {
    const fixed = { ...base, feed: "#00a83c", rapid: "#3d8bff", backplot: "#ff00ff", limit: "#e66b00" } as ViewerPalette;
    const rows = customPairRows(fixed, "light");
    expect(rows.map(r => `${r.a}/${r.b}`)).toEqual(
      ["feed/rapid", "feed/limit", "feed/backplot", "rapid/limit", "rapid/backplot", "limit/backplot"]);
    expect(rows.filter(r => r.normalLow), "the fixed palette holds the rule").toEqual([]);
    expect(Object.keys(rows[0]!).sort(), "no colour-blind column").toEqual(["a", "b", "normal", "normalLow"]);
    // the operator's old Custom set: cyan feed, magenta backplot — apart for a normal eye, nothing else asked
    const old = customPairRows({ ...base, feed: "#22b8cf", rapid: "#f5a623", backplot: "#ff00ff", limit: "#b06c02" } as ViewerPalette, "light");
    expect(old.find(r => r.a === "feed" && r.b === "backplot")!.normalLow).toBe(false);
    const same = customPairRows({ ...fixed, backplot: fixed.feed }, "light").find(r => r.a === "feed" && r.b === "backplot")!;
    expect([same.normal, same.normalLow]).toEqual([0, true]);
  });
});

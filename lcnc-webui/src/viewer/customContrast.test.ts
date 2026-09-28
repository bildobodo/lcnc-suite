import { describe, it, expect } from "vitest";
import { contrastRatio, customContrastRows, parseHex } from "./customContrast";
import type { ViewerPalette } from "./viewerPalette";

const base: ViewerPalette = {
  feed: "#1f5fbf", rapid: "#1e7f3f", backplot: "#a01860", bounds: "#555555", toolpathBounds: "#666666",
  tool: "#999999", cutter: "#c8a040", limit: "#8a5a00", collision: "#c00000",
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
    expect(customContrastRows({ ...base, bounds: mid }, "#ffffff", false).find(r => r.role === "bounds")!.bgLow).toBe(false);
    expect(customContrastRows({ ...base, bounds: mid }, "#ffffff", true).find(r => r.role === "bounds")!.bgLow).toBe(true);
  });
  it("tool shaft and cutter are solids — no row; no selection row (the current line is not drawn in 3D)", () => {
    expect(customContrastRows(base, "#ffffff", false).map(r => r.role)).toEqual(
      ["feed", "rapid", "backplot", "bounds", "toolpathBounds"]);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MACHINE_PALETTE, defaultPartHex, paletteCss, paletteRgb } from "./palette";

// The sim machine.json files carry explicit `color` values (JSON cannot
// import the palette), so they are pinned here: a part's color must be ONE
// of the palette entries, or absent (linear slide → the axis rule).
const MODELS = [
  "../../../examples/sim_config/machine-xyzac/machine.json",
  "../../../examples/sim_config/machine-xyzacb-trsrn/machine.json",
];

describe("machine palette", () => {
  it("css/rgb forms agree with the hex table", () => {
    expect(paletteCss("z")).toBe("#62789a");
    expect(paletteRgb("frame")).toEqual([0.612, 0.612, 0.612]);
    expect(defaultPartHex("x")).toBe(MACHINE_PALETTE.x);
    expect(defaultPartHex(null)).toBe(MACHINE_PALETTE.frame);
    expect(defaultPartHex("rot")).toBe(MACHINE_PALETTE.frame);
  });

  it("every sim machine.json part color is a palette entry", () => {
    const allowed = new Set(
      (Object.keys(MACHINE_PALETTE) as (keyof typeof MACHINE_PALETTE)[]).map(k => paletteRgb(k).join(",")));
    for (const rel of MODELS) {
      const m = JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));
      for (const p of m.parts) {
        if (p.color == null) continue;
        expect(allowed.has(p.color.join(",")), `${rel} part ${p.id} color ${p.color}`).toBe(true);
      }
    }
  });

  it("palette entries are muted (no channel saturated, none vivid)", () => {
    for (const [k, hex] of Object.entries(MACHINE_PALETTE)) {
      const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      // HSV saturation ≤ 0.40 keeps the model behind the overlays (the
      // feed cyan / rapid amber / gizmo hues all sit at 0.8+)
      expect(max === 0 ? 0 : (max - min) / max, k).toBeLessThanOrEqual(0.40);
    }
  });
});

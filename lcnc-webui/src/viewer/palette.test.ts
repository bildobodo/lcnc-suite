import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MACHINE_PALETTE, defaultPartHex, paletteCss, paletteRgb } from "./palette";

// The sim machine.json files carry explicit `color` values (JSON cannot
// import the palette), so they are pinned here: a part's color must be ONE
// of the palette entries, or absent (linear slide → the axis rule).
const MODELS = [
  // the shipped examples (FreeCAD generators, scripts/freecad_*.py COL)
  "../../../examples/sim_config/machine-5axis-xyzac/machine.json",
  "../../../examples/sim_config/machine-xyzacb-gantry/machine.json",
  // the legacy regression fixtures (scripts/vismach_to_stl.py COLORS)
  "../../../scripts/test_fixtures/legacy_sim/machine-xyzac/machine.json",
  "../../../scripts/test_fixtures/legacy_sim/machine-xyzacb-trsrn/machine.json",
];

describe("machine palette", () => {
  it("css/rgb forms agree with the hex table", () => {
    expect(paletteCss("table")).toBe("#2e3235");
    expect(paletteRgb("paint")).toEqual([0.341, 0.353, 0.369]);
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

  // Operator 2026-09-29: muted metal greys, no rainbow — no part carries a
  // hue near the program's line colours; grey STEPS tell the parts apart,
  // and the parts a program lies on sit in the middle of the ladder.
  it("the palette is a grey ladder: every entry neutral, the steps distinct", () => {
    for (const [k, hex] of Object.entries(MACHINE_PALETTE)) {
      const r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff;
      expect(Math.max(r, g, b) - Math.min(r, g, b), `${k}: a grey (a hair of cool bias at most)`).toBeLessThanOrEqual(12);
    }
    const ladder = (["paint", "steel", "stock", "table", "cast", "accent", "dark"] as const).map(k => MACHINE_PALETTE[k]);
    for (let i = 1; i < ladder.length; i++) expect(ladder[i]! & 0xff, "light → dark").toBeLessThan(ladder[i - 1]! & 0xff);
    expect(MACHINE_PALETTE.stock & 0xff, "the stock a hair lighter than the table it sits on").toBeGreaterThan(MACHINE_PALETTE.table & 0xff);
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

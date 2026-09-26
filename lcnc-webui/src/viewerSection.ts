// The viewer settings section as stored → as used. Pure (no DOM, no
// settings cache), so the palette migration is unit-tested
// (viewerSection.test.ts); defaults.ts registers it for the "viewer" section.
import type { ColorDefaults, Layer, ViewerDefaults } from "./defaults";

/** The viewer section as stored → as used (design wave D8c, UI-D05).
 *  Palette migration, no heuristics: a section saved before the mode
 *  existed carried its colours in full on EVERY viewer save (a layer toggle
 *  too), so a stored palette cannot tell a deliberate colour from an
 *  untouched default — it stays exactly as it was, as Custom, and Settings
 *  offers Automatic. No stored section (or one without colours) = Automatic.
 *  From now on the mode is stored explicitly. */
export function mergeViewerSection(saved: any, fb: ViewerDefaults): ViewerDefaults {
  if (!saved) return JSON.parse(JSON.stringify(fb));
  const colors: Partial<ColorDefaults> = { ...(saved.colors ?? {}) };
  const legacy = saved.paletteMode !== "auto" && saved.paletteMode !== "custom";
  return {
    ...fb,
    ...saved,
    layers: { ...fb.layers, ...saved.layers } as Record<Layer, boolean>,
    paletteMode: legacy ? (Object.keys(colors).length > 0 ? "custom" : "auto") : saved.paletteMode,
    colors,
    machineColors: { ...fb.machineColors, ...saved.machineColors },
    hud: { ...fb.hud, ...saved.hud },
  };
}


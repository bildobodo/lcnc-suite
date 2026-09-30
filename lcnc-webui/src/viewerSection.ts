// The viewer settings section as stored → as used. Pure (no DOM, no
// settings cache), so the palette migration is unit-tested
// (viewerSection.test.ts); defaults.ts registers it for the "viewer" section.
import type { ColorDefaults, Layer, PaletteOrigin, ViewerDefaults } from "./defaults";

/** The layers that can be drawn OVER the machine (Settings → Layers' "on
 *  top" column, operator 2026-09-30): lines and markers, never a body. */
export type OnTopLayer = "toolpath" | "rapids" | "backplot" | "workzero" | "workplane" | "toolsetter" | "toolChange" | "toolpathBounds" | "bounds" | "reachRoom" | "reachPart";
export const ON_TOP_LAYERS: readonly OnTopLayer[] = ["toolpath", "rapids", "backplot", "workzero", "workplane", "toolsetter", "toolChange", "toolpathBounds", "bounds", "reachRoom", "reachPart"];
/** The markers are points one wants to find (on top); a box drawn over the
 *  whole machine is noise (not). The path's three follow the old single
 *  "Always on Top" switch (off). */
export const ON_TOP_FALLBACK: Record<OnTopLayer, boolean> = {
  toolpath: false, rapids: false, backplot: false,
  workzero: true, toolsetter: true, toolChange: true,
  workplane: false, toolpathBounds: false, bounds: false, reachRoom: false, reachPart: false,
};

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
  const legacyPalette = legacy && Object.keys(colors).length > 0;
  // The origin (viewer contrast plan, V6): certain only for a palette stored
  // without a mode — "legacy", kept through every later save until the
  // operator chooses; a mode without an origin stays unknown, never guessed.
  const origin: PaletteOrigin | undefined = legacyPalette ? "legacy"
    : saved.paletteOrigin === "legacy" || saved.paletteOrigin === "operator" ? saved.paletteOrigin : undefined;
  const { paletteOrigin: _drop, pathOnTop: oldPathOnTop, ...rest } = saved;
  void _drop;
  // "on top" per layer (operator 2026-09-30). A section from before carried
  // ONE switch for the path — it becomes the path's three rows; every other
  // layer takes its default. A stored value always wins.
  const onTop = { ...fb.onTop } as Record<OnTopLayer, boolean>;
  if (typeof oldPathOnTop === "boolean") onTop.toolpath = onTop.rapids = onTop.backplot = oldPathOnTop;
  for (const k of ON_TOP_LAYERS) if (typeof saved.onTop?.[k] === "boolean") onTop[k] = saved.onTop[k];
  return {
    ...fb,
    ...rest,
    layers: { ...fb.layers, ...saved.layers } as Record<Layer, boolean>,
    paletteMode: legacy ? (legacyPalette ? "custom" : "auto") : saved.paletteMode,
    ...(origin ? { paletteOrigin: origin } : {}),
    colors,
    machineColors: { ...fb.machineColors, ...saved.machineColors },
    hud: { ...fb.hud, ...saved.hud },
    onTop,
  };
}


// Settings › 3D Viewer › Layers in four groups (operator 2026-09-30: "viele
// Layer-Toggles … brauchen ein wenig Gruppierung, z. B. die Bounds zusammen,
// die Werkzeugpfad-Optionen"): what the program draws, the limits it is drawn
// against, the machine, the points of reference. A layer that draws a palette
// role carries its line sample (fixed palette P3, Codex R30: the legend at
// the layer rows) — dashed or two-tone like the line itself. The HUD's
// switch sits in the HUD section (HUD_LAYER), not here. Pure — the Settings
// template renders it, viewerLayerGroups.test.ts holds it to every layer.
import type { Layer } from "./defaults";
import type { ViewerRole } from "./viewer/viewerPalette";

export type TwoTone = "long" | "short";

export interface LayerRow {
  key: Layer;
  label: string;
  role?: ViewerRole;
  dashed?: boolean;
  twoTone?: TwoTone;
  help?: string;
}

export interface LayerGroup {
  id: string;
  label: string;
  rows: LayerRow[];
}

export const LAYER_GROUPS: LayerGroup[] = [
  { id: "program", label: "Program", rows: [
    { key: "toolpath", label: "Toolpath", role: "feed" },
    { key: "rapids", label: "Rapids", role: "rapid", dashed: true },
    { key: "backplot", label: "Backplot", role: "backplot" },
  ] },
  { id: "bounds", label: "Bounds & Reach", rows: [
    { key: "toolpathBounds", label: "Toolpath Bounds", role: "toolpathBounds", twoTone: "short" },
    { key: "bounds", label: "Machine Bounds", role: "bounds", twoTone: "long" },
    { key: "reachRoom", label: "Machine Reach" },
    { key: "reachPart", label: "Part Reach" },
  ] },
  { id: "machine", label: "Machine", rows: [
    { key: "machine", label: "Machine" },
    { key: "tool", label: "Tool" },
    { key: "groundGrid", label: "Ground Grid" },
  ] },
  { id: "references", label: "References & Markers", rows: [
    { key: "workzero", label: "Work Zero" },
    { key: "workplane", label: "Work Plane" },
    { key: "toolsetter", label: "Tool Setter", help: "Where the next tool measurement probes: the pin's point is the contact height. Needs Probing › Toolsetter." },
    { key: "toolChange", label: "Tool Change (G30)", help: "The stored tool-change position (G30), as of the last save of the parameter file." },
    { key: "surface", label: "Surface" },
  ] },
];

/** The layer table's two columns where the Layers section has the width for
 *  them (operator 2026-10-01: the sections stacked, two columns INSIDE each):
 *  what the program draws and the limits it is drawn against left, the
 *  machine and the points of reference right — LAYER_GROUPS read column by
 *  column, so one column (150 % portrait) keeps their order. */
export const LAYER_COLUMNS: LayerGroup[][] = [LAYER_GROUPS.slice(0, 2), LAYER_GROUPS.slice(2)];

/** The layer whose switch is the HUD section's "Show HUD". */
export const HUD_LAYER: Layer = "hud";

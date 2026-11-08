// Probing's procedures in grid order (design wave D3): the 4 × 2 TabNav in
// ProbePanel and the narrow side pane's procedure select read ONE list.
export const PROBE_VIEWS = [
  { id: "outside", label: "Outside" },
  { id: "inside", label: "Inside" },
  { id: "angle", label: "Angle" },
  { id: "boss", label: "Boss/Pocket" },
  { id: "ridge", label: "Ridge/Valley" },
  { id: "surface", label: "Surface" },
  { id: "cal", label: "Calibrate" },
  { id: "toolsetter", label: "Toolsetter" },
] as const;

export type ProbeView = typeof PROBE_VIEWS[number]["id"];

/** Each procedure's switch (settings split package 3): the probe routines
 *  are `probing`, the scan and the compensation `surfaceMap`, the toolsetter
 *  its own — three functions, independent of each other (SS334-02). */
export const PROBE_VIEW_FEATURE: Record<ProbeView, "probing" | "surfaceMap" | "toolsetter"> = {
  outside: "probing", inside: "probing", angle: "probing", boss: "probing", ridge: "probing",
  surface: "surfaceMap", cal: "probing", toolsetter: "toolsetter",
};

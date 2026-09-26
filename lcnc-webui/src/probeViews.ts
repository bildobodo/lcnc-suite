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

// Shared 3D axis colors for viewer helper geometry — the ViewCube's face tints
// and straight-view arrows, the work-zero triad, axis labels,
// and work-plane labels. These are Three.js / WebGL canvas colors, NOT CSS theme
// values, so design tokens don't apply (issue #25, rescoped). Centralized here
// only to avoid duplicating the same X/Y/Z triple across ThreeViewer.vue and
// ProbePanel.vue. `HEX` for APIs taking a numeric color (ArrowHelper, materials);
// `CSS` for troika Text labels (string color).
export const AXIS_HEX = { x: 0xff4444, y: 0x44ff44, z: 0x4488ff } as const;
export const AXIS_CSS = { x: "#ff4444", y: "#44ff44", z: "#4488ff" } as const;

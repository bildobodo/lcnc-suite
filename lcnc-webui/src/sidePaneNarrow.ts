// The side pane's narrow threshold — ONE number for App (which flips the
// navigation to selects and marks `.sidePane.narrow`) and the layout tests.
//
// Measured with the bundled Inter: the main tabs are equal grid columns, so
// the widest name ("Program") sets every column. A width scan of the real
// tab list found the first content width with no clipped name, desktop and
// touch alike: seven tabs (the seventh "Sim", operator 2026-10-05 — named
// like the bar's switch: "Simulation" needed 574 px, past the 522 px pane of
// the desktop and the touch landscape) at 497 px; 498 keeps 1 px for font
// rounding. Before: 432 (six tabs, package 5), 400 (five, design wave DR).
// Probing's 4 × 2 grid (widest "Boss/Pocket" 384 px) fits under it.
// layout.spec checks one px under, at and over it.
export const NARROW_PANE_PX = 498;

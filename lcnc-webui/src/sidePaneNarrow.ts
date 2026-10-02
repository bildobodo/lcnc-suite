// The side pane's narrow threshold — ONE number for App (which flips the
// navigation to selects and marks `.sidePane.narrow`) and the layout tests.
//
// Measured with the bundled Inter (package 5, the sixth tab "Macros"): the
// main tabs are equal grid columns, so the widest name ("Program") sets
// every column. A width scan of the real tab list found the first content
// width with no clipped name at 431 px, desktop and touch alike (a
// text-width estimate said 428 / 422 and was 1 px short per column); 432
// keeps 1 px for font rounding. Probing's 4 × 2 grid (widest "Boss/Pocket"
// 384 px) fits under it. Before the sixth tab: 400 (five tabs; design wave
// DR). layout.spec checks one px under, at and over it.
export const NARROW_PANE_PX = 432;

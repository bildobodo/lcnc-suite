// The viewer palette's pair table (viewer contrast plan R1; fixed palette,
// operator 2026-09-28/29, Codex R29/R30). Lines in a toolpath lie ON and
// BESIDE each other, so two LINE roles are told apart by colour first: an
// OKLab distance of at least LINE_MIN_NORMAL (LINE_MIN_NORMAL_HC in hc-dark
// alone — see there; lineMinFor). Colour-vision deficiency is no criterion
// (operator 2026-09-29); a FORM cue (the dashed rapid, the backplot's width)
// supplements the colour, never replaces it. A line against a BODY (the
// collision tint) or two non-path objects (the boxes, the plane's states)
// are `object` pairs: OBJECT_MIN_NORMAL plus the cue the image shows. The
// two boxes share one neutral by design (`form`: told apart by the dash,
// the width and the size labels).
//
// 0.25 is the search and regression value the palette was chosen by, not a
// proof that every 1 px line is distinguishable (Codex R29 VP29-01). Pure
// data; themeTokens.test.ts checks every theme block against it, the viewer
// specs check that each cue is drawn.

/** Two path LINES, normal vision. */
export const LINE_MIN_NORMAL = 0.25;
/** The same in hc-dark ALONE: 4.5 : 1 on pure black AND 3 : 1 on the lit
 *  table leave it a luminance band of a few hundredths, where the best four
 *  lines found keep 0.244 (docs/reviews/viewer-palette-fest.*) — a named
 *  exception, a search result, not a proven bound. hc-light reaches 0.277
 *  and keeps LINE_MIN_NORMAL (Codex R31, answer 4). */
export const LINE_MIN_NORMAL_HC = 0.24;
/** The line pair floor of a theme (the ThemeMode / theme-block name). */
export function lineMinFor(theme: string): number {
  return theme === "hc-dark" ? LINE_MIN_NORMAL_HC : LINE_MIN_NORMAL;
}
/** A line against a body, or two non-path objects: normal vision. */
export const OBJECT_MIN_NORMAL = 0.12;

/** A visible cue that separates two roles besides their colour. */
export type PairCue =
  | "dashed"   // the rapid (or a stale plane's edge) is dashed
  | "width"    // the width ladder: path 1 px, backplot and machine box wider
  | "object"   // one is a tinted machine body, not a path line
  | "glyph"    // timeline / code panel: ▲ limit, × collision
  | "label";   // a text label on the object (the toolpath box's sizes, the plane's state)

export interface PalettePair {
  a: string;
  b: string;
  /** Where the two meet. */
  where: string;
  /** `line`: two path lines (LINE_MIN_NORMAL); `object`: a body or a
   *  non-path object (OBJECT_MIN_NORMAL); `form`: two objects in one colour
   *  by design, told apart by at least two cues (the boxes). */
  kind: "line" | "object" | "form";
  cues: PairCue[];
}

/** The four path LINES (the collision is a body, the boxes are objects). */
export const LINE_ROLES = ["--viewer-feed", "--viewer-rapid", "--viewer-limit", "--viewer-backplot"] as const;
/** Roles the path is drawn against: every line role and the collision tint
 *  — the table names every pair of them. */
export const PATH_ROLES = [...LINE_ROLES, "--viewer-collision"] as const;

export const PALETTE_PAIRS: PalettePair[] = [
  { a: "--viewer-feed", b: "--viewer-rapid", where: "adjacent path", kind: "line", cues: ["dashed"] },
  { a: "--viewer-feed", b: "--viewer-limit", where: "the overlay lies on the path", kind: "line", cues: [] },
  { a: "--viewer-feed", b: "--viewer-backplot", where: "the backplot lies on the path", kind: "line", cues: ["width"] },
  { a: "--viewer-rapid", b: "--viewer-limit", where: "the overlay on a rapid", kind: "line", cues: ["dashed"] },
  { a: "--viewer-rapid", b: "--viewer-backplot", where: "an executed rapid", kind: "line", cues: ["dashed", "width"] },
  { a: "--viewer-limit", b: "--viewer-backplot", where: "the backplot over a limit violation", kind: "line", cues: ["width"] },
  { a: "--viewer-feed", b: "--viewer-collision", where: "a line against a tinted body", kind: "object", cues: ["object"] },
  { a: "--viewer-rapid", b: "--viewer-collision", where: "a line against a tinted body", kind: "object", cues: ["object", "dashed"] },
  { a: "--viewer-limit", b: "--viewer-collision", where: "3D, timeline, code panel", kind: "object", cues: ["object", "glyph"] },
  { a: "--viewer-backplot", b: "--viewer-collision", where: "a line against a tinted body", kind: "object", cues: ["object"] },
  // The two boxes: one neutral (operator 2026-09-29) — the toolpath box is
  // dashed at the path's width and carries its size labels, the machine box
  // solid and wider.
  { a: "--viewer-bounds", b: "--viewer-toolpath-bounds", where: "two boxes", kind: "form", cues: ["dashed", "width", "label"] },
  // The tilted work plane's states (V4): the label on the object names the
  // state, a stale plane's edge is dashed.
  { a: "--viewer-plane-active", b: "--viewer-plane-defined", where: "the plane", kind: "object", cues: ["label"] },
  { a: "--viewer-plane-active", b: "--viewer-plane-stale", where: "the plane", kind: "object", cues: ["label", "dashed"] },
  { a: "--viewer-plane-defined", b: "--viewer-plane-stale", where: "the plane", kind: "object", cues: ["label", "dashed"] },
];

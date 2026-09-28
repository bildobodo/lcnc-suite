// The viewer palette's pair table (viewer contrast plan R1; fixed palette,
// operator 2026-09-28, Codex R29/R30). Lines in a toolpath lie ON and BESIDE
// each other, so two LINE roles are told apart by colour first:
//  - normal vision: an OKLab distance of at least LINE_MIN_NORMAL
//    (LINE_MIN_NORMAL_HC in the high-contrast themes — see there);
//  - simulated protanopia, deuteranopia and tritanopia (Machado 2009,
//    severity 1): at least CVD_MIN — unless the pair names a FORM cue that
//    carries it there (`cvd: false`), with the cue's own limit spelled out.
// A form cue supplements the colour, never replaces it. A line against a
// BODY (the collision tint) or two non-path objects (the boxes, the plane's
// states) are `object` pairs: OBJECT_MIN_NORMAL under normal vision plus the
// cue the image shows.
//
// 0.25 is the search and regression value the palette was chosen by, not a
// proof that every 1 px line is distinguishable (Codex R29 VP29-01); the
// simulation is a heuristic regression guard, not a proof of accessibility
// — WCAG 1.4.1 asks for the form cues. Pure data; themeTokens.test.ts
// checks every theme block against it, the viewer specs check that each cue
// is drawn.

/** Two path LINES, normal vision. */
export const LINE_MIN_NORMAL = 0.25;
/** The same in the high-contrast themes: 4.5 : 1 on pure black AND 3 : 1 on
 *  the lit table leave hc-dark a luminance band of a few hundredths, where
 *  the best four lines found keep 0.244 (docs/reviews/viewer-palette-fest.*). */
export const LINE_MIN_NORMAL_HC = 0.24;
/** Two path lines under the dichromat simulations (no form cue). */
export const CVD_MIN = 0.12;
/** A line against a body, or two non-path objects: normal vision. */
export const OBJECT_MIN_NORMAL = 0.12;

/** A visible cue that separates two roles besides their colour. */
export type PairCue =
  | "dashed"   // the rapid (or a stale plane's edge) is dashed
  | "width"    // the width ladder: path 1 px, backplot 2 px
  | "object"   // one is a tinted machine body, not a path line
  | "glyph"    // timeline / code panel: ▲ limit, × collision
  | "label";   // a text label on the object (the toolpath box's sizes, the plane's state)

export interface PalettePair {
  a: string;
  b: string;
  /** Where the two meet. */
  where: string;
  /** `line`: two path lines (LINE_MIN_NORMAL); `object`: a body or a
   *  non-path object (OBJECT_MIN_NORMAL). */
  kind: "line" | "object";
  /** A line pair that must hold CVD_MIN under the simulations; false only
   *  where a named cue carries it (`cueLimit` says where the cue fails). */
  cvd: boolean;
  cues: PairCue[];
  cueLimit?: string;
}

/** The four path LINES (the collision is a body, the boxes are objects). */
export const LINE_ROLES = ["--viewer-feed", "--viewer-rapid", "--viewer-limit", "--viewer-backplot"] as const;
/** Roles the path is drawn against: every line role and the collision tint
 *  — the table names every pair of them. */
export const PATH_ROLES = [...LINE_ROLES, "--viewer-collision"] as const;

export const PALETTE_PAIRS: PalettePair[] = [
  { a: "--viewer-feed", b: "--viewer-rapid", where: "adjacent path", kind: "line", cvd: false, cues: ["dashed"],
    cueLimit: "a rapid piece shorter than one dash period shows no dash — there the colour alone tells it" },
  { a: "--viewer-feed", b: "--viewer-limit", where: "the overlay lies on the path", kind: "line", cvd: true, cues: [] },
  { a: "--viewer-feed", b: "--viewer-backplot", where: "the backplot lies on the path", kind: "line", cvd: true, cues: ["width"] },
  { a: "--viewer-rapid", b: "--viewer-limit", where: "the overlay on a rapid", kind: "line", cvd: true, cues: ["dashed"] },
  { a: "--viewer-rapid", b: "--viewer-backplot", where: "an executed rapid", kind: "line", cvd: true, cues: ["dashed", "width"] },
  { a: "--viewer-limit", b: "--viewer-backplot", where: "the backplot over a limit violation", kind: "line", cvd: true, cues: ["width"] },
  { a: "--viewer-feed", b: "--viewer-collision", where: "a line against a tinted body", kind: "object", cvd: false, cues: ["object"] },
  { a: "--viewer-rapid", b: "--viewer-collision", where: "a line against a tinted body", kind: "object", cvd: false, cues: ["object", "dashed"] },
  { a: "--viewer-limit", b: "--viewer-collision", where: "3D, timeline, code panel", kind: "object", cvd: false, cues: ["object", "glyph"] },
  { a: "--viewer-backplot", b: "--viewer-collision", where: "a line against a tinted body", kind: "object", cvd: false, cues: ["object"] },
  { a: "--viewer-bounds", b: "--viewer-toolpath-bounds", where: "two boxes", kind: "object", cvd: false, cues: ["label"] },
  // The tilted work plane's states (V4): the label on the object names the
  // state, a stale plane's edge is dashed.
  { a: "--viewer-plane-active", b: "--viewer-plane-defined", where: "the plane", kind: "object", cvd: false, cues: ["label"] },
  { a: "--viewer-plane-active", b: "--viewer-plane-stale", where: "the plane", kind: "object", cvd: false, cues: ["label", "dashed"] },
  { a: "--viewer-plane-defined", b: "--viewer-plane-stale", where: "the plane", kind: "object", cvd: false, cues: ["label", "dashed"] },
];

// The viewer palette's pair table (viewer contrast plan, R1): every pair of
// roles drawn on the same surface is told apart by COLOUR — an OKLab distance
// of at least PAIR_MIN_DISTANCE under normal vision AND under simulated
// protanopia, deuteranopia and tritanopia (Machado 2009, severity 1) — or by a
// declared FORM cue the rendered image shows (then the colour needs the
// distance under normal vision only, the D8c rule), or by both.
//
// The simulation is a project heuristic and a regression guard, not a proof
// of accessibility: a colour distance alone does not meet WCAG 1.4.1 ("not by
// colour alone") — the form cues do. Pure data; themeTokens.test.ts checks the
// theme blocks against it, the viewer specs check that each cue is drawn.

/** The binding threshold (D8c's path-role rule). */
export const PAIR_MIN_DISTANCE = 0.12;

/** A visible cue that separates two roles without their colour. */
export type PairCue =
  | "dashed"   // the rapid is a dashed line
  | "width"    // the width ladder: path 1 px, backplot 2 px
  | "object"   // one is a tinted machine body (or dashed box edges), not a path line
  | "glyph"    // timeline / code panel: ▲ limit, × collision
  | "label";   // a text label on the object (the toolpath box's sizes)

export interface PalettePair {
  a: string;
  b: string;
  /** Where the two meet. */
  where: string;
  /** Colour-separated: the distance holds under all four views. */
  colour: boolean;
  /** Form cues; empty for a pair told apart by colour alone. */
  cues: PairCue[];
}

/** The five path roles themeTokens.test.ts has checked since D8c — the table
 *  names every pair of them. */
export const PATH_ROLES = ["--viewer-feed", "--viewer-rapid", "--viewer-backplot", "--viewer-limit",
  "--viewer-collision"] as const;

export const PALETTE_PAIRS: PalettePair[] = [
  { a: "--viewer-feed", b: "--viewer-rapid", where: "adjacent path", colour: false, cues: ["dashed"] },
  { a: "--viewer-feed", b: "--viewer-backplot", where: "the backplot lies on the path", colour: true, cues: ["width"] },
  { a: "--viewer-feed", b: "--viewer-limit", where: "the overlay lies on the path", colour: true, cues: [] },
  { a: "--viewer-feed", b: "--viewer-collision", where: "a line against a tinted body", colour: false, cues: ["object"] },
  { a: "--viewer-rapid", b: "--viewer-backplot", where: "an executed rapid", colour: false, cues: ["dashed", "width"] },
  { a: "--viewer-rapid", b: "--viewer-limit", where: "the overlay on a rapid", colour: false, cues: ["dashed"] },
  { a: "--viewer-rapid", b: "--viewer-collision", where: "a line against a tinted body", colour: false, cues: ["object"] },
  { a: "--viewer-backplot", b: "--viewer-limit", where: "adjacent or overlapping in projection", colour: false, cues: ["width"] },
  { a: "--viewer-backplot", b: "--viewer-collision", where: "a line against a tinted body", colour: false, cues: ["object"] },
  { a: "--viewer-limit", b: "--viewer-collision", where: "3D, timeline, code panel", colour: false, cues: ["object", "glyph"] },
  { a: "--viewer-bounds", b: "--viewer-toolpath-bounds", where: "two solid boxes", colour: false, cues: ["label"] },
  // The tilted work plane's states (V4): the label on the object names the
  // state, a stale plane's edge is dashed.
  { a: "--viewer-plane-active", b: "--viewer-plane-defined", where: "the plane", colour: false, cues: ["label"] },
  { a: "--viewer-plane-active", b: "--viewer-plane-stale", where: "the plane", colour: false, cues: ["label", "dashed"] },
  { a: "--viewer-plane-defined", b: "--viewer-plane-stale", where: "the plane", colour: false, cues: ["label", "dashed"] },
];

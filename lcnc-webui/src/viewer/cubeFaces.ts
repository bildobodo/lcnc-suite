// The ViewCube's faces named by AXIS (operator 2026-10-04/05, from renders):
// X+ … Z− — a FRONT/LEFT naming fixed to the world frame read wrong on
// machines whose front is −Y (the 5-axis sim's "LEFT" was its front). Each
// face carries a light tint of its axis colour, and in a STRAIGHT view the
// two in-plane axes show as arrows on the displayed square's border — full
// edge length, the letter outside past the tip — so a straight view still
// says where +X and +Y point (the corner gizmo they replace is gone). Pure.

export type Vec3 = readonly [number, number, number];
export type AxisLetter = "X" | "Y" | "Z";

/** The cube's edge (world units of the cube scene). */
export const CUBE_SIZE = 1;
/** The displayed face square is a little smaller than the cube. */
export const FACE_SIZE = CUBE_SIZE * 0.96;
/** The face texture's resolution and the border it strokes (centre 3 px in). */
export const FACE_TEX_PX = 256;
export const FACE_BORDER_PX = 3;
/** Half the side of the DISPLAYED square's border line — where the arrows
 *  lie (on the cube's own edge they sat ~1.5 px outside the square). */
export const FACE_BORDER_HALF = FACE_SIZE / 2 - FACE_SIZE * FACE_BORDER_PX / FACE_TEX_PX;
/** How far past the arrow tip its letter sits (outside the square). */
export const LABEL_GAP = 0.15;

/** The arrows fade in below FADE_FROM_DEG off the face normal and are whole
 *  below FULL_AT_DEG: only a straight view shows them, an oblique one stays
 *  quiet (at 140 px the letters were too small there). */
export const FADE_FROM_DEG = 16;
export const FULL_AT_DEG = 6;

const AXES: { letter: AxisLetter; v: Vec3 }[] = [
  { letter: "X", v: [1, 0, 0] }, { letter: "Y", v: [0, 1, 0] }, { letter: "Z", v: [0, 0, 1] },
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export interface CubeFace {
  /** "X+", "X−" (U+2212 minus) … */
  label: string;
  axis: AxisLetter;
  normal: Vec3;
  /** The label reads upright when this face is viewed straight on (the
   *  camera's up in that view: world +Z, for the Z faces ±Y). */
  visualUp: Vec3;
}

export const CUBE_FACES: CubeFace[] = [
  { label: "X+", axis: "X", normal: [1, 0, 0], visualUp: [0, 0, 1] },
  { label: "X−", axis: "X", normal: [-1, 0, 0], visualUp: [0, 0, 1] },
  { label: "Y+", axis: "Y", normal: [0, 1, 0], visualUp: [0, 0, 1] },
  { label: "Y−", axis: "Y", normal: [0, -1, 0], visualUp: [0, 0, 1] },
  { label: "Z+", axis: "Z", normal: [0, 0, 1], visualUp: [0, 1, 0] },
  { label: "Z−", axis: "Z", normal: [0, 0, -1], visualUp: [0, -1, 0] },
];

export interface FaceArrow {
  axis: AxisLetter;
  /** World +axis: an arrow always points the axis' positive way. */
  dir: Vec3;
  start: Vec3;
  tip: Vec3;
  /** Where the letter sits: past the tip, outside the square. */
  label: Vec3;
}

/** The face's two in-plane axes as arrows on its displayed border: both
 *  start at the corner from which they run positive across the face (seen
 *  from −X or +Y the horizontal one runs leftwards), each the full side. */
export function faceArrows(face: CubeFace): FaceArrow[] {
  const inPlane = AXES.filter(a => Math.abs(dot(a.v, face.normal)) < 0.5);
  let corner = add([0, 0, 0], face.normal, CUBE_SIZE / 2);
  for (const a of inPlane) corner = add(corner, a.v, -FACE_BORDER_HALF);
  const len = 2 * FACE_BORDER_HALF;
  return inPlane.map(a => ({
    axis: a.letter, dir: a.v, start: corner,
    tip: add(corner, a.v, len), label: add(corner, a.v, len + LABEL_GAP),
  }));
}

/** Opacity of a face's arrows from the cosine between its normal and the
 *  direction towards the camera: 0 beyond FADE_FROM_DEG, 1 within
 *  FULL_AT_DEG, linear in the cosine between. */
export function arrowOpacity(cosToCamera: number): number {
  const from = Math.cos((FADE_FROM_DEG * Math.PI) / 180), full = Math.cos((FULL_AT_DEG * Math.PI) / 180);
  return Math.min(1, Math.max(0, (cosToCamera - from) / (full - from)));
}

/** A letter's side (cube-scene units): the sprite quad it is drawn in. */
export const LETTER_SIZE = 0.22;

/** Keep a letter whole inside the cube canvas (Codex R74 VP-I35): near Z±
 *  the face turns with the azimuth, a letter past a tip lies towards the
 *  square's DIAGONAL and the tilt adds to it — at 5° off Z+ the X ran out
 *  of the top. `ndc` is the letter's centre, `halfNdc` its quad's half side
 *  plus the outline, both in normalised device units (±1 = the canvas
 *  edge): the centre moves in just as far as the quad needs, never out. */
export function keepInCanvas(ndc: readonly [number, number], halfNdc: number): [number, number] {
  const m = 1 - halfNdc;
  return [Math.min(m, Math.max(-m, ndc[0])), Math.min(m, Math.max(-m, ndc[1]))];
}


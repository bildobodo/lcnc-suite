// The PROGRAM's tilted work plane, derived from data already on the wire.
//
// The live overlay draws the plane the MACHINE currently holds, which is
// right during a real run and wrong during simulation: nothing executes
// while scrubbing, so a live-fed overlay freezes on the machine's plane
// while every other viewer surface shows the program. This derives the plane
// the SCRUBBED PROGRAM establishes, so the overlay can come from the same
// authority as the rest of the simulated picture.
//
// No new marker is needed. A TOOL-mode (type 2) segment already carries its
// frame triple (kins_frames) and its WCS epoch, and that is enough:
//
//   joints = TrsrnKins(mode 2, frame).inverse([G59 origin, a, b, c])
//   plane  = TrsrnKins(mode 1, toolOffset 0).forward(joints)
//
// Verified numerically against a committed payload: origin comes out
// [1350, -150, -1450] (= G54 + the program's own 50/50/-50) and both
// direction vectors match the program text exactly.
//
// TLO must appear on NEITHER side. Mode 2 ignores the tool offset by
// upstream design, so the mode-2 inverse of the bare G59 origin yields
// control-point joints, and a mode-1 forward with zero tool offset maps them
// back. Putting it on both sides shifts the origin by exactly the tool
// length (-1428 instead of -1450) — which the tests assert, because a
// symmetric error like that reads as plausible.
//
// Because the mode-1 forward IS the work frame, the result lands directly in
// the TABLE frame — the same frame the plane pins publish and the same frame
// the viewer's work group draws in. Same attach, same frame, live and sim.
import { kinsForSegment, type KinsSpec } from "./kins";

/** Plane as the overlay consumes it: [ox,oy,oz, zx,zy,zz, xx,xy,xz]. */
export type TwpPlane = number[];

export interface TwpPlaneInputs {
  /** Declared kins spec (from viewer_init). */
  spec: KinsSpec | undefined;
  /** RAW switchkins type of the sampled segment. */
  kinstype: number | null;
  /** Governing frame triple [preRot, primary, secondary], or null. */
  frame: readonly number[] | null;
  /** The segment's epoch g5x + g92 (machine units), axis-indexed. */
  g5x: readonly number[] | undefined;
  g92: readonly number[] | undefined;
  /** Machine-frame A (the work table) for the sample, degrees. */
  a: number;
}

/**
 * The plane a TOOL-mode sample is cutting in, in TABLE coordinates, or
 * `null` when this sample does not establish one.
 *
 * Honest absence, never a guess: anything but an xyzacb-trsrn spec, a
 * kinstype other than 2, or a missing frame triple returns null and the
 * caller hides the overlay rather than drawing a plane it cannot know.
 */
export function twpPlaneForSample(i: TwpPlaneInputs): TwpPlane | null {
  const t = i.kinstype;
  if (t !== 2 || !i.frame || i.frame.length < 3) return null;
  if (i.spec?.type !== "xyzacb-trsrn") return null;
  if (!i.g5x) return null;

  const [preRot, primary, secondary] = [
    Number(i.frame[0]), Number(i.frame[1]), Number(i.frame[2])];
  const fr: [number, number, number] = [preRot, primary, secondary];
  // TLO deliberately 0 on BOTH models — see the header.
  const AX = ["X", "Y", "Z", "A", "B", "C"];
  const plane = kinsForSegment(AX, i.spec, 2, fr, 0, "twp plane overlay");
  const work = kinsForSegment(AX, i.spec, 1, null, 0, "twp plane overlay");
  if (!plane || !work) return null;

  // The plane's ORIGIN is the epoch's work origin: G59 carries the
  // TWP-dedicated offsets G53.x wrote, and g92 rides along the same way the
  // rest of the transform chain applies it.
  const ox = Number(i.g5x[0] ?? 0) + Number(i.g92?.[0] ?? 0);
  const oy = Number(i.g5x[1] ?? 0) + Number(i.g92?.[1] ?? 0);
  const oz = Number(i.g5x[2] ?? 0) + Number(i.g92?.[2] ?? 0);

  const out: number[] = [0, 0, 0, 0, 0, 0];
  const j: number[] = [0, 0, 0, 0, 0, 0];

  // One point plus two unit probes: the plane's own axes come out as the
  // difference of their images, so no basis has to be re-derived here.
  //
  // The rotary seed is not free. While TWP is active the head SITS AT the
  // frame it was oriented to, so B is the secondary angle and C the primary
  // — those are exactly the joints the mode-1 forward needs to place the
  // TOOL TIP. Seeding zeros instead lands ~125 mm out (mode 2's inverse
  // returns SLIDE positions, and the head geometry sits between the slides
  // and the tip). A is the live table pose, which is what puts the result in
  // table coordinates.
  const map = (px: number, py: number, pz: number): [number, number, number] => {
    plane.inverse([px, py, pz, i.a, secondary, primary], j);
    work.forward(j, out);
    return [out[0]!, out[1]!, out[2]!];
  };
  const o = map(ox, oy, oz);
  const px = map(ox + 1, oy, oz);
  const pz = map(ox, oy, oz + 1);
  const dir = (p: [number, number, number]) => {
    const v = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const n = Math.hypot(v[0]!, v[1]!, v[2]!);
    return n < 1e-9 ? null : [v[0]! / n, v[1]! / n, v[2]! / n];
  };
  const xDir = dir(px), zDir = dir(pz);
  if (!xDir || !zDir) return null;
  if (![...o, ...xDir, ...zDir].every(Number.isFinite)) return null;
  return [o[0], o[1], o[2], zDir[0]!, zDir[1]!, zDir[2]!,
          xDir[0]!, xDir[1]!, xDir[2]!];
}

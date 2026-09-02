// Where the ACTIVE fixture's origin triad belongs, in the table frame.
//
// The viewer draws one set of work-zero arrows for the active fixture. On
// TCP kinematics the fixture numbers ARE table-frame coordinates (TCP's
// world frame rides the table), and the triad sits at g5x + Rz(θ)·g92
// rotated by θ — the same RS274 rotate_and_translate order applyState uses
// for the toolpath anchor. Identity kins is NOT drawn from here (since
// 2026-09-02): its numbers are joint-space, and viewer/programZero.ts
// evaluates them through the machine chain at the fixture's touch-off
// pose instead. Under TOOL/plane kinematics
// (kins 2) a RESERVED fixture (G59..G59.3) holds the plane frame's origin in
// TOOL coordinates — the `O` g53x_core writes — and drawing those numbers
// as table coordinates put the arrows nowhere physical (operator-caught:
// "the work origin hangs in space"). Here they go through the same
// mode-2-inverse → mode-1-forward compose the plane overlay uses
// (twpPlaneForSample), so the arrows and the overlay's triad coincide by
// construction — a visible self-check. No frame trio = null: HIDE, never
// guess (the gateway's _live_kins_frame_of makes the same call).
//
// This poses the ARROWS only. The toolpath anchor (workOrigin) must keep
// the raw fixture numbers: partFrame peels the live active offset from every
// vertex and the group re-adds it, so the path is right by cancellation and
// moving the anchor would break it (partFrame.ts, "Output peel").

import type { KinsSpec } from "./kins";
import { twpPlaneForSample } from "./twpPlaneFrame";

export interface ActiveFixtureInputs {
  g5x: readonly number[] | null | undefined;
  g92: readonly number[] | null | undefined;
  rotationDeg?: number | null;
  /** Live switchkins type; null/undefined = no switchable kins (identity). */
  kinsType?: number | null;
  /** Active fixture, 1-based (G54 = 1 … G59 = 6 … G59.3 = 9). */
  g5xIndex?: number | null;
  /** Live plane frame trio [preRot(rad), primary(deg), secondary(deg)]. */
  frame?: readonly number[] | null;
  /** Machine-frame table A, degrees. */
  a?: number | null;
  spec?: KinsSpec | null;
}

export interface FixturePose {
  /** Origin, TABLE-frame coordinates. */
  pos: [number, number, number];
  /** Orthonormal basis columns (X, Y, Z), table frame. */
  x: [number, number, number];
  y: [number, number, number];
  z: [number, number, number];
}

export const RESERVED_FIXTURES: ReadonlySet<number> = new Set([6, 7, 8, 9]);

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
}
function norm(v: readonly number[]): [number, number, number] | null {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return l < 1e-9 ? null : [v[0]! / l, v[1]! / l, v[2]! / l];
}

/** The active fixture's origin + basis in the table frame, or null when the
 *  fixture is expressed in a frame this client cannot evaluate (reserved
 *  fixture under kins 2 without a frame trio / spec). */
export function activeFixturePose(i: ActiveFixtureInputs): FixturePose | null {
  const g5x = i.g5x;
  if (!g5x) return null;
  const k = i.kinsType == null ? 0 : Math.round(i.kinsType);
  const idx = i.g5xIndex == null ? 1 : Math.round(i.g5xIndex);
  if (k === 2 && RESERVED_FIXTURES.has(idx)) {
    const plane = twpPlaneForSample({
      spec: i.spec ?? undefined, kinstype: 2, frame: i.frame ?? null,
      g5x, g92: i.g92 ?? undefined, rotationDeg: i.rotationDeg ?? 0, a: i.a ?? 0,
    });
    if (!plane) return null;
    const z = norm(plane.slice(3, 6));
    if (!z) return null;
    const xr = plane.slice(6, 9);
    const d = xr[0]! * z[0] + xr[1]! * z[1] + xr[2]! * z[2];
    const x = norm([xr[0]! - d * z[0], xr[1]! - d * z[1], xr[2]! - d * z[2]]);
    if (!x) return null;
    return { pos: [plane[0]!, plane[1]!, plane[2]!], x, y: cross(z, x), z };
  }
  // TCP (k=1): world IS the table-riding frame — the numbers are the pose.
  // (Identity and a non-reserved fixture under kins 2 are programZero's
  // job; this branch still answers with the numbers for any other caller.)
  const th = ((i.rotationDeg ?? 0) * Math.PI) / 180;
  const c = Math.cos(th), s = Math.sin(th);
  const g92 = i.g92 ?? [];
  const gx = g92[0] ?? 0, gy = g92[1] ?? 0, gz = g92[2] ?? 0;
  return {
    pos: [(g5x[0] ?? 0) + gx * c - gy * s, (g5x[1] ?? 0) + gx * s + gy * c, (g5x[2] ?? 0) + gz],
    x: [c, s, 0], y: [-s, c, 0], z: [0, 0, 1],
  };
}

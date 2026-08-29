import { describe, it, expect } from "vitest";
import { twpPlaneForSample } from "./twpPlaneFrame";
import { specFromWire } from "./kins";

// Two INDEPENDENT halves must agree:
//   left  — the frame triple + G59 row as the parse worker shipped them
//            (values taken from a committed corpus payload);
//   right — the plane the .ngc TEXT asks for, reduced from
//            `g68.2 x50 y50 z-50 q121 i30 j15` by hand.
// Nothing in the derivation under test knows about the second one, which is
// what makes this a check rather than a restatement.

const SPEC = specFromWire({
  type: "xyzacb-trsrn",
  params: {
    y_pivot: 50, z_pivot: 120, x_offset: 0, y_offset: 0,
    y_rot_axis: -1000, z_rot_axis: -2000, nut_angle: 55,
  },
});

// From scripts/parity_corpus/runs/twp_g69_tail.run1.payload.msgpack:
const FRAME = [-1.781761556, 130.245476621, -40.855497803] as const;
const G59 = [1609.597046, -854.903811, -791.098493] as const;
const G92 = [0, 0, 0, 0, 0, 0, 0, 0, 0] as const;

// The program: G54 = (1300, -200, -1400), plane origin (50, 50, -50).
const EXPECT_ORIGIN = [1350, -150, -1450];
// q121 i30 j15 reduces to these (same numbers twp_parity's g682_normal
// derives from the text, and the same ones the .ngc comment documents):
const EXPECT_Z = [0.258819, -0.482963, 0.836516];
const EXPECT_X = [0.965926, 0.129410, -0.224144];

function plane(over: Partial<Parameters<typeof twpPlaneForSample>[0]> = {}) {
  return twpPlaneForSample({
    spec: SPEC, kinstype: 2, frame: FRAME,
    g5x: G59, g92: G92, a: 0, ...over,
  });
}

describe("twpPlaneForSample: the program's plane, from the wire", () => {
  it("reproduces the plane the G-code text asks for", () => {
    const p = plane();
    expect(p).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      expect(p![i]).toBeCloseTo(EXPECT_ORIGIN[i]!, 3);
      expect(p![3 + i]).toBeCloseTo(EXPECT_Z[i]!, 5);
      expect(p![6 + i]).toBeCloseTo(EXPECT_X[i]!, 5);
    }
  });

  it("returns an orthonormal basis", () => {
    const p = plane()!;
    const z = p.slice(3, 6), x = p.slice(6, 9);
    expect(Math.hypot(...z)).toBeCloseTo(1, 9);
    expect(Math.hypot(...x)).toBeCloseTo(1, 9);
    expect(z[0]! * x[0]! + z[1]! * x[1]! + z[2]! * x[2]!).toBeCloseTo(0, 6);
  });

  it("lands in TABLE coordinates, so the drawn plane rides the workpiece", () => {
    // The mode-1 forward IS the work frame, so A enters the result: the same
    // machine-fixed frame produces DIFFERENT table coordinates as the table
    // turns — which is precisely what makes the overlay follow the part
    // rather than hang in machine space.
    const at0 = plane({ a: 0 })!;
    const at20 = plane({ a: 20 })!;
    expect(at0.some((v, i) => Math.abs(v - at20[i]!) > 1e-6)).toBe(true);
    // ...and the frame stays orthonormal through the conversion.
    const z = at20.slice(3, 6);
    expect(Math.hypot(...z)).toBeCloseTo(1, 9);
  });

  it("at A≠0 is exactly the A=0 frame rotated about the table axis line", () => {
    // Pins the a≠0 branch against a known-good value (the live A20
    // acceptance is the only other pin, and it is not CI-runnable). The
    // work frame is Rx(+A) about the axis line through machine
    // (y_rot_axis, z_rot_axis): a table-fixed feature keeps constant table
    // coordinates, so a MACHINE-fixed frame (what the kins pins describe)
    // appears in table coordinates rotated by +A about that line.
    const A = 20, th = (A * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    const py = -1000, pz = -2000;
    const rotPoint = (v: number[]) => {
      const ry = v[1]! - py, rz = v[2]! - pz;
      return [v[0]!, c * ry - s * rz + py, s * ry + c * rz + pz];
    };
    const rotDir = (v: number[]) => [v[0]!, c * v[1]! - s * v[2]!, s * v[1]! + c * v[2]!];
    const at0 = plane({ a: 0 })!;
    const at20 = plane({ a: A })!;
    const wantO = rotPoint(at0.slice(0, 3));
    const wantZ = rotDir(at0.slice(3, 6));
    const wantX = rotDir(at0.slice(6, 9));
    for (let i = 0; i < 3; i++) {
      expect(at20[i]).toBeCloseTo(wantO[i]!, 4);
      expect(at20[3 + i]).toBeCloseTo(wantZ[i]!, 6);
      expect(at20[6 + i]).toBeCloseTo(wantX[i]!, 6);
    }
  });

  it("applies a G10 R rotation to g92 before summing (rs274 order)", () => {
    // o = g5x + Rz(θ)·g92: with g92 = (10, 0, 0) and R = 90 the origin
    // moves by (0, 10, 0) in the epoch frame, not by (10, 0, 0). The plane
    // frame then carries that displacement; assert its LENGTH and that a
    // plain-sum origin would differ — the same invariant style as the TLO
    // guard, for the same frame reason.
    const base = plane()!;
    const rot = plane({ g92: [10, 0, 0, 0, 0, 0, 0, 0, 0], rotationDeg: 90 })!;
    const sum = plane({ g92: [10, 0, 0, 0, 0, 0, 0, 0, 0], rotationDeg: 0 })!;
    const d = (p: number[]) => Math.hypot(p[0]! - base[0]!, p[1]! - base[1]!, p[2]! - base[2]!);
    expect(d(rot)).toBeCloseTo(10, 6);
    expect(d(sum)).toBeCloseTo(10, 6);
    expect(Math.hypot(rot[0]! - sum[0]!, rot[1]! - sum[1]!, rot[2]! - sum[2]!))
      .toBeCloseTo(10 * Math.SQRT2, 6);
  });

  it("makes no claim where it cannot know one", () => {
    expect(plane({ kinstype: 0 })).toBeNull();     // identity: no plane
    expect(plane({ kinstype: 1 })).toBeNull();     // TCP: not a plane mode
    expect(plane({ kinstype: null })).toBeNull();  // untracked
    expect(plane({ frame: null })).toBeNull();     // TOOL without a frame
    expect(plane({ g5x: undefined })).toBeNull();  // no epoch origin
    expect(plane({ spec: specFromWire({ type: "trivkins", params: {} }) })).toBeNull();
  });

  it("guards the TLO double-count that would look plausible", () => {
    // Mode 2 ignores the tool offset by upstream design, so the derivation
    // must apply TLO on NEITHER side. Adding it to the origin (the obvious
    // mistake) moves Z by exactly the tool length — 22 here — which is
    // small enough to pass for a rounding artefact if nobody checks.
    const base = plane()!;
    const shifted = plane({ g5x: [G59[0], G59[1], G59[2] + 22] })!;
    // The displacement is a pure ROTATION of (0,0,22) through the plane
    // frame, so it does not stay in Z — its LENGTH is the invariant, and
    // that length is exactly the tool offset. (Asserting a Z shift of 22
    // would be wrong for the same frame reason the bug itself is subtle.)
    const d = Math.hypot(shifted[0]! - base[0]!, shifted[1]! - base[1]!,
                         shifted[2]! - base[2]!);
    expect(d).toBeCloseTo(22, 6);
    // ...and the orientation is untouched: only the origin moves.
    for (let i = 3; i < 9; i++) expect(shifted[i]!).toBeCloseTo(base[i]!, 9);
  });
});

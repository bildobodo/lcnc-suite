import { describe, it, expect } from "vitest";
import { twpPoseStale, twpDatumStale, TWP_POSE_EPS_DEG, TWP_POSE_NONE_BELOW, TWP_DATUM_EPS } from "./twpPose";

describe("twpPoseStale", () => {
  it("makes no claim when no plane is defined", () => {
    expect(twpPoseStale(0, 30, false)).toBe(false);
    expect(twpPoseStale(0, 30, null)).toBe(false);
    expect(twpPoseStale(0, 30, undefined)).toBe(false);
  });

  it("treats the sentinel as no pose, not as a huge deviation", () => {
    expect(twpPoseStale(-1e9, 0, true)).toBe(false);
    expect(twpPoseStale(TWP_POSE_NONE_BELOW - 1, 0, true)).toBe(false);
  });

  it("makes no claim without both readings", () => {
    expect(twpPoseStale(null, 30, true)).toBe(false);
    expect(twpPoseStale(0, null, true)).toBe(false);
    expect(twpPoseStale(undefined, undefined, true)).toBe(false);
    expect(twpPoseStale(NaN, 0, true)).toBe(false);
    expect(twpPoseStale(0, NaN, true)).toBe(false);
  });

  it("is quiet at and below the epsilon, stale above it", () => {
    expect(twpPoseStale(0, TWP_POSE_EPS_DEG, true)).toBe(false);
    expect(twpPoseStale(0, TWP_POSE_EPS_DEG * 1.5, true)).toBe(true);
    expect(twpPoseStale(0, -TWP_POSE_EPS_DEG * 1.5, true)).toBe(true);
  });

  it("compares magnitudes around a nonzero definition pose", () => {
    expect(twpPoseStale(20, 20, true)).toBe(false);
    expect(twpPoseStale(20, 40, true)).toBe(true);
    expect(twpPoseStale(-33.25, -33.25, true)).toBe(false);
  });
});

describe("twpDatumStale", () => {
  const row = { x: 10, y: 20, z: 30 };
  it("stale when the live G54 row leaves the snapshot", () => {
    expect(twpDatumStale({ ...row, z: 30.5 }, [10, 20, 30], true)).toBe(true);
  });
  it("clean when they agree", () => {
    expect(twpDatumStale(row, [10, 20, 30], true)).toBe(false);
  });
  it("epsilon boundary: exactly at eps is not stale, just over is", () => {
    expect(twpDatumStale({ ...row, x: 10 + TWP_DATUM_EPS }, [10, 20, 30], true)).toBe(false);
    expect(twpDatumStale({ ...row, x: 10 + TWP_DATUM_EPS * 2 }, [10, 20, 30], true)).toBe(true);
  });
  it("unknown is not stale: no plane / no datum / unreadable row", () => {
    expect(twpDatumStale(row, [10, 20, 30], false)).toBe(false);
    expect(twpDatumStale(row, null, true)).toBe(false);
    expect(twpDatumStale(null, [10, 20, 30], true)).toBe(false);
    expect(twpDatumStale({ x: 10, y: 20 }, [10, 20, 30], true)).toBe(false);
    expect(twpDatumStale({ x: NaN, y: 20, z: 30 }, [10, 20, 30], true)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { twpPoseStale, TWP_POSE_EPS_DEG, TWP_POSE_NONE_BELOW } from "./twpPose";

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

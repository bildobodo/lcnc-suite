import { describe, expect, it } from "vitest";
import { DEFAULT_FRAME_DIR, ENVELOPE_FACTOR, MODEL_MARGIN, frameDistance, frameNearFar, framePose, minOrbitDistance } from "./cameraFraming";

describe("cameraFraming", () => {
  it("keeps the travel-box rule when the model fits inside it", () => {
    const { near } = frameNearFar(400, 100);
    expect(frameDistance(400, 100, near)).toBeCloseTo(ENVELOPE_FACTOR * 400, 9);
  });

  it("switches to the model sphere when the model dwarfs the travel box (XYZAC class)", () => {
    // 0.4 m travel inside a 2.2 m machine: the old rule put the eye 938 mm
    // out with a 1.4 m base under it.
    const { near } = frameNearFar(400, 1400);
    expect(frameDistance(400, 1400, near)).toBeCloseTo(MODEL_MARGIN * 1400 + near, 9);
    expect(frameDistance(400, 1400, near)).toBeGreaterThan(ENVELOPE_FACTOR * 400);
  });

  it("is monotonic in both the envelope and the model radius", () => {
    const near = 0.4;
    let prev = 0;
    for (const m of [10, 100, 400, 1000, 5000]) {
      const d = frameDistance(m, 0, near);
      expect(d).toBeGreaterThan(prev); prev = d;
    }
    prev = 0;
    for (const r of [10, 500, 1000, 2000, 9000]) {
      const d = frameDistance(400, r, near);
      expect(d).toBeGreaterThanOrEqual(prev); prev = d;
    }
  });

  it("near/far scale with the larger of envelope and model", () => {
    expect(frameNearFar(400, 0)).toEqual({ near: 0.4, far: 200000 });
    expect(frameNearFar(50000, 0).far).toBe(1_000_000);
    expect(frameNearFar(400, 20000).far).toBe(400_000);
    expect(frameNearFar(1, 0).near).toBe(0.1);
  });

  it("minOrbitDistance is 20 × near", () => {
    expect(minOrbitDistance(0.4)).toBeCloseTo(8, 9);
  });

  it("framePose places the eye along the unit default direction at the distance", () => {
    const p = framePose([10, 20, 30], 400, 1400);
    const dx = p.position[0] - 10, dy = p.position[1] - 20, dz = p.position[2] - 30;
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(p.distance, 6);
    expect(Math.hypot(...DEFAULT_FRAME_DIR)).toBeCloseTo(1, 12);
    expect(dx).toBeGreaterThan(0); expect(dy).toBeLessThan(0); expect(dz).toBeGreaterThan(0);
    expect(p.minDistance).toBeCloseTo(minOrbitDistance(p.near), 12);
  });
});

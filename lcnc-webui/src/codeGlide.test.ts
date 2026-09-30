import { describe, it, expect } from "vitest";
import { GLIDE, glideAt, planGlide } from "./codeGlide";

describe("codeGlide", () => {
  it("glides a step over the last packet gap, evenly, and arrives", () => {
    const g = planGlide(1000, 1069, 0, 33, 400, false)!;
    expect(g).toEqual({ from: 1000, to: 1069, t0: 0, dur: 33 });
    expect(glideAt(g, 0).pos).toBe(1000);
    expect(glideAt(g, 16.5).pos).toBeCloseTo(1034.5, 6);
    expect(glideAt(g, 33)).toEqual({ pos: 1069, done: true });
    expect(glideAt(g, 60)).toEqual({ pos: 1069, done: true });
  });

  it("holds the duration to its bounds", () => {
    expect(planGlide(0, 23, 0, 5, 400, false)!.dur).toBe(GLIDE.minMs);
    expect(planGlide(0, 23, 0, 400, 400, false)!.dur).toBe(GLIDE.maxMs);
  });

  it("glides from rest too — over the longest duration, never a jump", () => {
    expect(planGlide(0, 23, 0, 600, 400, false)!.dur, "after a pause").toBe(GLIDE.maxMs);
    expect(planGlide(0, 23, 0, Infinity, 400, false)!.dur, "the first target").toBe(GLIDE.maxMs);
  });

  it("snaps a far jump, reduced motion and no step", () => {
    expect(planGlide(0, 801, 0, 33, 400, false), "further than two views").toBeNull();
    expect(planGlide(0, 799, 0, 33, 400, false), "within two views").not.toBeNull();
    expect(planGlide(0, 23, 0, 33, 400, true), "reduced motion").toBeNull();
    expect(planGlide(5, 5, 0, 33, 400, false), "nothing to do").toBeNull();
    expect(planGlide(0, 23, 0, 33, 0, false), "no viewport yet").toBeNull();
  });

  it("goes backwards too (a loop, a sub's return)", () => {
    const g = planGlide(500, 431, 10, 33, 400, false)!;
    expect(glideAt(g, 10 + 33).pos).toBe(431);
    expect(glideAt(g, 10 + 16.5).pos).toBeCloseTo(465.5, 6);
  });
});

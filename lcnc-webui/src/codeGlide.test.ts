import { describe, it, expect } from "vitest";
import { GLIDE, glideAt, planGlide, stepDelay } from "./codeGlide";

describe("codeGlide", () => {
  it("steps to the line over stepMs, slowing into it, and arrives exactly", () => {
    const g = planGlide(1000, 1069, 0, 400, 23, false)!;
    expect(g).toEqual({ from: 1000, to: 1069, t0: 0, dur: GLIDE.stepMs });
    expect(glideAt(g, 0)).toEqual({ pos: 1000, done: false });
    // ease-out: past the even pace at the half, then slower
    const half = glideAt(g, GLIDE.stepMs / 2).pos;
    expect(half).toBeCloseTo(1000 + 69 * 0.875, 6);
    let last = 1000;
    for (let t = 0; t <= GLIDE.stepMs; t += 4) {
      const p = glideAt(g, t).pos;
      expect(p, `monotone at ${t} ms`).toBeGreaterThanOrEqual(last);
      last = p;
    }
    expect(glideAt(g, GLIDE.stepMs)).toEqual({ pos: 1069, done: true });
    expect(glideAt(g, 500)).toEqual({ pos: 1069, done: true });
  });

  it("takes stepMs whatever the packets do — the wait, not the duration, follows their pace", () => {
    expect(planGlide(0, 23, 0, 400, 23, false)!.dur).toBe(GLIDE.stepMs);
    expect(planGlide(0, 700, 0, 400, 23, false)!.dur, "many lines: one step too").toBe(GLIDE.stepMs);
    expect(GLIDE.stepMs).toBeLessThan(GLIDE.intervalMs);   // a step ends before the next may begin
  });

  it("a line waits until intervalMs after the last step began — at any distance", () => {
    expect(stepDelay(-Infinity, 0, false), "the first step").toBe(0);
    expect(stepDelay(1000, 1000 + GLIDE.intervalMs, false), "a whole interval later").toBe(0);
    expect(stepDelay(1000, 1033, false), "a packet later: the rest").toBe(GLIDE.intervalMs - 33);
    expect(stepDelay(1000, 1033, true), "reduced motion snaps at once").toBe(0);
  });

  it("snaps a far jump, a view under three lines, reduced motion and no step", () => {
    expect(planGlide(0, 801, 0, 400, 23, false), "further than two views").toBeNull();
    expect(planGlide(0, 799, 0, 400, 23, false), "within two views").not.toBeNull();
    expect(planGlide(0, 23, 0, 68, 23, false), "a view of less than three lines").toBeNull();
    expect(planGlide(0, 23, 0, 69, 23, false), "three lines").not.toBeNull();
    expect(planGlide(0, 23, 0, 400, 23, true), "reduced motion").toBeNull();
    expect(planGlide(5, 5, 0, 400, 23, false), "nothing to do").toBeNull();
    expect(planGlide(0, 23, 0, 0, 23, false), "no viewport yet").toBeNull();
  });

  it("goes backwards too (a loop, a sub's return)", () => {
    const g = planGlide(500, 431, 10, 400, 23, false)!;
    expect(glideAt(g, 10 + GLIDE.stepMs).pos).toBe(431);
    expect(glideAt(g, 10 + GLIDE.stepMs / 2).pos).toBeCloseTo(500 - 69 * 0.875, 6);
  });
});

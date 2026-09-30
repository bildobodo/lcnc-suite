import { describe, it, expect } from "vitest";
import { GLIDE, glideAt, planGlide, visibleBand } from "./codeGlide";

const ANY: [number, number] = [-Infinity, Infinity];

describe("codeGlide", () => {
  it("glides a step over the last packet gap, evenly, and arrives", () => {
    const g = planGlide(1000, 1069, 0, 33, 400, false, ANY)!;
    expect(g).toEqual({ from: 1000, to: 1069, t0: 0, dur: 33 });
    expect(glideAt(g, 0).pos).toBe(1000);
    expect(glideAt(g, 16.5).pos).toBeCloseTo(1034.5, 6);
    expect(glideAt(g, 33)).toEqual({ pos: 1069, done: true });
    expect(glideAt(g, 60)).toEqual({ pos: 1069, done: true });
  });

  it("holds the duration to its bounds", () => {
    expect(planGlide(0, 23, 0, 5, 400, false, ANY)!.dur).toBe(GLIDE.minMs);
    expect(planGlide(0, 23, 0, 400, 400, false, ANY)!.dur).toBe(GLIDE.maxMs);
  });

  it("glides from rest too — over the longest duration, never a jump", () => {
    expect(planGlide(0, 23, 0, 600, 400, false, ANY)!.dur, "after a pause").toBe(GLIDE.maxMs);
    expect(planGlide(0, 23, 0, Infinity, 400, false, ANY)!.dur, "the first target").toBe(GLIDE.maxMs);
  });

  it("snaps a far jump, reduced motion and no step", () => {
    expect(planGlide(0, 801, 0, 33, 400, false, ANY), "further than two views").toBeNull();
    expect(planGlide(0, 799, 0, 33, 400, false, ANY), "within two views").not.toBeNull();
    expect(planGlide(0, 23, 0, 33, 400, true, ANY), "reduced motion").toBeNull();
    expect(planGlide(5, 5, 0, 33, 400, false, ANY), "nothing to do").toBeNull();
    expect(planGlide(0, 23, 0, 33, 0, false, ANY), "no viewport yet").toBeNull();
  });

  it("goes backwards too (a loop, a sub's return)", () => {
    const g = planGlide(500, 431, 10, 33, 400, false, ANY)!;
    expect(glideAt(g, 10 + 33).pos).toBe(431);
    expect(glideAt(g, 10 + 16.5).pos).toBeCloseTo(465.5, 6);
  });

  it("starts inside the running line's visible band — a step past it jumps to the edge (Codex R52 VP-I21)", () => {
    // 23 px lines, 400 px view: row 60 → the band of scroll tops
    const band = visibleBand(60 * 23, 23, 400, y => y)!;
    expect(band).toEqual([60 * 23 + 46 - 400, 60 * 23 - 23]);
    // a 20-line packet from the previous centre: the start is the band's edge
    const to = 60 * 23 - 200 + 11.5, prev = 40 * 23 - 200 + 11.5;
    const g = planGlide(prev, to, 0, 33, 400, false, band)!;
    expect(g.from).toBe(band[0]);
    expect(glideAt(g, 33).pos).toBe(to);
    // backwards the same, from the other edge
    const back = planGlide(80 * 23 - 200 + 11.5, to, 0, 33, 400, false, band)!;
    expect(back.from).toBe(band[1]);
    // a small step starts where it is
    expect(planGlide(to - 69, to, 0, 33, 400, false, band)!.from).toBe(to - 69);
  });

  it("maps the band through the scaled scroll space and snaps where a line and its margins do not fit", () => {
    const half = (y: number) => y / 2;   // a spacer at half the content height
    expect(visibleBand(1000, 23, 400, half)).toEqual([(1000 + 46 - 400) / 2, (1000 - 23) / 2]);
    expect(visibleBand(1000, 23, 60, y => y), "a view of less than three lines").toBeNull();
    expect(planGlide(0, 23, 0, 33, 60, false, null), "no band: snap").toBeNull();
  });
});

// The speed-bound history of a near stretch (nearHistory.ts; Codex R174
// VP-I127): what the search back from a margin exit may rely on.
import { describe, expect, it } from "vitest";
import { NEAR_HIST, backTo, pushBound } from "./nearHistory";
import { rng } from "./collisionFixtures";

const make = () => ({ start: new Float64Array(NEAR_HIST), bound: new Float64Array(NEAR_HIST), n: 0 });
type H = ReturnType<typeof make>;
const push = (h: H, at: number, v: number) => { h.n = pushBound(h.start, h.bound, 0, h.n, at, v); };
/** The bound the history holds at `x` (the entry it lies in). */
const boundAt = (h: H, x: number) => { let k = h.n - 1; while (k > 0 && h.start[k]! > x) k--; return h.bound[k]!; };
/** The history's bound integrated over [a, b] (the first entry reaching back without end). */
const integral = (h: H, a: number, b: number) => {
  let sum = 0;
  for (let k = 0; k < h.n; k++) {
    const lo = Math.max(a, k > 0 ? h.start[k]! : -Infinity), hi = Math.min(b, k + 1 < h.n ? h.start[k + 1]! : Infinity);
    if (hi > lo) sum += h.bound[k]! * (hi - lo);
  }
  return sum;
};

describe("the speed-bound history of a near stretch (Codex R174 VP-I127)", () => {
  it("keeps every change of the bound; an unchanged bound extends its entry", () => {
    const h = make();
    push(h, 0, 1); push(h, 10, 0.5); push(h, 20, 0.5); push(h, 30, 0.2);
    expect(h.n).toBe(3);
    expect(Array.from(h.start.slice(0, 3))).toEqual([0, 10, 30]);
    expect(Array.from(h.bound.slice(0, 3))).toEqual([1, 0.5, 0.2]);
  });

  it("past its size, still bounds every chunk from above (merged at the larger bound)", () => {
    const rand = rng(20261019);
    for (let t = 0; t < 200; t++) {
      const h = make(), chunks: Array<[number, number]> = [];
      let at = rand() * 10;
      for (let c = 0; c < 20 + Math.floor(rand() * 60); c++) {
        const v = Math.exp(Math.log(1e-4) + rand() * Math.log(2e4));   // 1e-4 … 2
        chunks.push([at, v]); push(h, at, v);
        at += 0.1 + rand() * 50;
        expect(h.n, "at most its size").toBeLessThanOrEqual(NEAR_HIST);
      }
      for (let c = 0; c < chunks.length; c++) {
        const [a, v] = chunks[c]!, b = c + 1 < chunks.length ? chunks[c + 1]![0] : a + 10;
        for (const x of [a, (a + b) / 2, b - 1e-9])
          expect(boundAt(h, x), `case ${t}: chunk ${c} at ${x.toFixed(3)}`).toBeGreaterThanOrEqual(v);
      }
    }
  });

  it("past its size, merges where the least is added: a fast chunk stays where it was among long slow ones", () => {
    // one fast chunk (0.2 long), then 30 slow ones 22.5 long whose bounds differ by a hair
    const h = make(), chunks: Array<[number, number]> = [[0, 1]];
    push(h, 0, 1);
    for (let c = 0; c < 30; c++) { const at = 0.2 + 22.5 * c, v = 5e-4 * (1 + 1e-6 * c); chunks.push([at, v]); push(h, at, v); }
    const end = 0.2 + 22.5 * 30;
    let truth = 0;
    for (let c = 0; c < chunks.length; c++) truth += chunks[c]![1] * ((c + 1 < chunks.length ? chunks[c + 1]![0] : end) - chunks[c]![0]);
    expect(integral(h, 0, end) - truth, "what the merges added to the bound's integral").toBeLessThan(0.01);
    expect(boundAt(h, 100), "a slow stretch keeps its slow bound").toBeLessThan(1e-3);
  });

  it("the search back uses up exactly the room, never more", () => {
    const rand = rng(20261021);
    for (let t = 0; t < 500; t++) {
      const h = make();
      let at = rand() * 10;
      const first = at;
      for (let c = 0; c < 1 + Math.floor(rand() * 30); c++) { push(h, at, Math.exp(Math.log(1e-4) + rand() * Math.log(2e4))); at += 0.1 + rand() * 20; }
      const x = first + rand() * (at - first + 10), room = rand() * 3;
      const y = backTo(h.start, h.bound, 0, h.n, x, room);
      expect(y, `case ${t}`).toBeLessThanOrEqual(x);
      expect(integral(h, y, x), `case ${t}: the bound over [${y.toFixed(4)}, ${x.toFixed(4)}]`).toBeCloseTo(room, 9);
    }
  });
});

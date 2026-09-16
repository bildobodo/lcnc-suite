// Unit tests for viewer/lineChunks.ts — the chunked-draw index arithmetic.
import { describe, expect, it } from "vitest";
import { binPairs, buildFrameIndex, buildLodLevels, chunkBounds, chunkGrid, chunkPlan, cumulativeDistances, decimatePairs, envelopeDiagonal, LOD_TOL_FRAC, spatialChunks, splitPairsByFrame, unionBounds } from "./lineChunks";

describe("buildFrameIndex", () => {
  it("pairs every consecutive vertex when there are no breaks", () => {
    const fi = buildFrameIndex(4);
    expect(Array.from(fi.table)).toEqual([0, 1, 1, 2, 2, 3]);
    expect(fi.room.length).toBe(0);
    expect(fi.mixed).toBe(0);
  });
  it("index-skips the connector INTO a section-start vertex", () => {
    const fi = buildFrameIndex(5, new Uint32Array([2]));
    expect(Array.from(fi.table)).toEqual([0, 1, 2, 3, 3, 4]);
  });
  it("ignores out-of-range breaks and handles n < 2", () => {
    expect(buildFrameIndex(1, new Uint32Array([7])).table.length).toBe(0);
    expect(buildFrameIndex(0).table.length).toBe(0);
  });
  it("splits pairs by the frame of BOTH endpoints and drops mixed ones", () => {
    // frames: 1 1 0 0 0 ; segment (1,2) crosses frames → dropped + counted
    const room = new Uint8Array([1, 1, 0, 0, 0]);
    const fi = buildFrameIndex(5, undefined, room);
    expect(Array.from(fi.room)).toEqual([0, 1]);
    expect(Array.from(fi.table)).toEqual([2, 3, 3, 4]);
    expect(fi.mixed).toBe(1);
  });
  it("a break at the flip means no mixed segment (the duplicated-vertex contract)", () => {
    const room = new Uint8Array([1, 1, 0, 0]);
    const fi = buildFrameIndex(4, new Uint32Array([2]), room);
    expect(fi.mixed).toBe(0);
    expect(Array.from(fi.room)).toEqual([0, 1]);
    expect(Array.from(fi.table)).toEqual([2, 3]);
  });
});

describe("chunkPlan", () => {
  it("one chunk for a small buffer, exact partition, never splits a pair", () => {
    expect(chunkPlan(6)).toEqual([{ start: 0, count: 6 }]);
    const plan = chunkPlan(2 * 10, 4);   // 10 pairs, 4 per chunk → 3 chunks
    expect(plan).toEqual([{ start: 0, count: 8 }, { start: 8, count: 8 }, { start: 16, count: 4 }]);
    for (const r of plan) { expect(r.start % 2).toBe(0); expect(r.count % 2).toBe(0); }
    expect(plan.reduce((s, r) => s + r.count, 0)).toBe(20);
  });
  it("clamps to the chunk cap and to at least one chunk", () => {
    expect(chunkPlan(2 * 1_000_000, 1000, 64)).toHaveLength(64);
    expect(chunkPlan(2, 40000)).toHaveLength(1);
    expect(chunkPlan(0)).toEqual([]);
  });
});

describe("chunkBounds / unionBounds", () => {
  const pos = new Float32Array([
    0, 0, 0,   10, 0, 0,   10, 10, 0,   // section A
    50, 50, 5,  60, 50, 5,               // section B (vertex 3 is a break start)
  ]);
  const fi = buildFrameIndex(5, new Uint32Array([3]));
  it("boxes contain every referenced vertex of the chunk and nothing else", () => {
    const plan = chunkPlan(fi.table.length, 2);   // 3 pairs → 2 chunks: [(0,1),(1,2)], [(3,4)]
    const b = chunkBounds(fi.table, pos, plan);
    expect(Array.from(b.subarray(0, 6))).toEqual([0, 0, 0, 10, 10, 0]);
    expect(Array.from(b.subarray(6, 12))).toEqual([50, 50, 5, 60, 50, 5]);
    expect(Array.from(unionBounds(b))).toEqual([0, 0, 0, 60, 50, 5]);
  });
  it("an empty plan yields an inverted union box", () => {
    const u = unionBounds(new Float32Array(0));
    expect(u[0]).toBe(Infinity);
    expect(u[3]).toBe(-Infinity);
  });
});

describe("cumulativeDistances", () => {
  it("is the running polyline length per vertex", () => {
    const d = cumulativeDistances(new Float32Array([0, 0, 0, 3, 4, 0, 3, 4, 2]));
    expect(Array.from(d)).toEqual([0, 5, 7]);
    expect(cumulativeDistances(new Float32Array(0)).length).toBe(0);
  });
});

describe("spatialChunks", () => {
  // A zig-zag facing pass: 40 passes across x 0..100 stepping y — every
  // contiguous run of the program spans the whole part.
  const pts: number[] = [];
  for (let row = 0; row < 40; row++) {
    const y = row * 2.5;
    const xs = row % 2 ? [100, 0] : [0, 100];
    for (const x0 of xs) pts.push(x0, y, 0);
  }
  const pos = new Float32Array(pts);
  const n = pos.length / 3;
  const fi = buildFrameIndex(n);
  it("reorders pairs into compact cells that partition the buffer and keep every pair exactly once", () => {
    const { index, plan } = spatialChunks(fi.table, pos, 16);
    expect(index.length).toBe(fi.table.length);
    expect(plan.reduce((s, r) => s + r.count, 0)).toBe(index.length);
    expect(plan.length).toBeGreaterThan(1);
    expect(plan.length).toBeLessThanOrEqual(24);       // rounding may exceed the target slightly
    const seen = new Set<string>();
    for (let k = 0; k < index.length; k += 2) seen.add(`${index[k]},${index[k + 1]}`);
    for (let k = 0; k < fi.table.length; k += 2) expect(seen.has(`${fi.table[k]},${fi.table[k + 1]}`)).toBe(true);
    expect(seen.size).toBe(fi.table.length / 2);
    // a compact chunk: no cell box spans the full x AND full y extent
    const b = chunkBounds(index, pos, plan);
    for (let c = 0; c < plan.length; c++) {
      const w = b[c * 6 + 3]! - b[c * 6]!, h = b[c * 6 + 4]! - b[c * 6 + 1]!;
      expect(w >= 100 && h >= 97.5).toBe(false);
    }
    // whereas program-order ranges are as big as the part
    const contiguous = chunkBounds(fi.table, pos, chunkPlan(fi.table.length, 10));
    expect(contiguous[3]! - contiguous[0]!).toBe(100);
  });
  it("a flat part gets a 2-D grid (no z divisions) and a single segment one chunk", () => {
    const { plan } = spatialChunks(fi.table, pos, 64);
    expect(plan.length).toBeLessThanOrEqual(64 + 16);
    const one = spatialChunks(new Uint32Array([0, 1]), new Float32Array([0, 0, 0, 1, 1, 1]));
    expect(one.plan).toEqual([{ start: 0, count: 2 }]);
    expect(Array.from(one.index)).toEqual([0, 1]);
  });
  it("two far-apart clusters land in different chunks", () => {
    const p2 = new Float32Array([0, 0, 0, 1, 0, 0, 1000, 0, 0, 1001, 0, 0]);
    const { index, plan } = spatialChunks(buildFrameIndex(4, new Uint32Array([2])).table, p2, 8);
    expect(plan).toHaveLength(2);
    const b = chunkBounds(index, p2, plan);
    expect(b[3]).toBeLessThan(2);
    expect(b[6]).toBeGreaterThan(999);
  });
});

describe("decimatePairs (display LOD)", () => {
  const pairsOf = (idx: Uint32Array) => { const o: number[][] = []; for (let k = 0; k < idx.length; k += 2) o.push([idx[k]!, idx[k + 1]!]); return o; };
  it("collapses a straight run to one pair and keeps an L's corner", () => {
    // straight: 5 collinear points; L: 3 more turning 90°
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 4, 1, 0, 4, 2, 0]);
    const fi = buildFrameIndex(7);
    expect(pairsOf(decimatePairs(pos, fi.table, 0.01))).toEqual([[0, 4], [4, 6]]);
    // a tiny wobble within tolerance is dropped, above it is kept
    const wob = pos.slice(); wob[1 * 3 + 1] = 0.005;
    expect(pairsOf(decimatePairs(wob, fi.table, 0.01))).toEqual([[0, 4], [4, 6]]);
    wob[1 * 3 + 1] = 0.05;
    // the kept wobble vertex tilts the chord 1→4 by 0.05/3, which lifts
    // vertex 2 0.033 off it (> tol) — Douglas–Peucker keeps it too
    expect(pairsOf(decimatePairs(wob, fi.table, 0.01))).toEqual([[0, 1], [1, 2], [2, 4], [4, 6]]);
  });
  it("never crosses a break or a frame flip (runs are decimated separately)", () => {
    // two collinear runs separated by a break at vertex 3
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 5, 0, 0, 6, 0, 0, 7, 0, 0]);
    const fi = buildFrameIndex(6, new Uint32Array([3]));
    expect(pairsOf(decimatePairs(pos, fi.table, 1))).toEqual([[0, 2], [3, 5]]);
    const room = new Uint8Array([1, 1, 0, 0, 0, 0]);
    const fr = buildFrameIndex(6, new Uint32Array([2]), room);   // flip at 2 with its duplicate break
    expect(pairsOf(decimatePairs(pos, fr.room, 1))).toEqual([[0, 1]]);
    expect(pairsOf(decimatePairs(pos, fr.table, 1))).toEqual([[2, 5]]);
  });
  it("tolerance 0 keeps everything; empty input stays empty; coarse-from-fine chains", () => {
    const pos = new Float32Array([0, 0, 0, 1, 0.1, 0, 2, 0, 0, 3, 0.5, 0, 4, 0, 0]);
    const fi = buildFrameIndex(5);
    expect(decimatePairs(pos, fi.table, 0)).toEqual(fi.table);
    expect(decimatePairs(pos, new Uint32Array(0), 1).length).toBe(0);
    const l1 = decimatePairs(pos, fi.table, 0.2);
    const l2 = decimatePairs(pos, l1, 0.6);
    expect(pairsOf(l1)).toEqual([[0, 2], [2, 3], [3, 4]]);
    expect(pairsOf(l2)).toEqual([[0, 4]]);
  });
  it("envelopeDiagonal", () => {
    expect(envelopeDiagonal(new Float32Array([0, 0, 0, 3, 4, 0]))).toBe(5);
    expect(envelopeDiagonal(new Float32Array([1, 1, 1]))).toBe(0);
  });
  it("a 20 k-vertex zig-zag decimates in bounded time and keeps every turn", () => {
    const pts: number[] = [];
    for (let i = 0; i < 20000; i++) pts.push(i * 0.01, (i % 2) * 0.001, 0);   // tiny 1 µm zig-zag on a line
    const pos = new Float32Array(pts);
    const fi = buildFrameIndex(20000);
    const t0 = performance.now();
    const l = decimatePairs(pos, fi.table, 0.01);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(l.length).toBe(2);                     // collapses to one segment
    const l2 = decimatePairs(pos, fi.table, 0.0005);
    expect(l2.length).toBe(fi.table.length);      // below the wobble: nothing dropped
  });
});

describe("chunkGrid + binPairs (one grid for every LOD level)", () => {
  it("bins a decimated level into the SAME cells as level 0, empty cells kept in place", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 100; i++) pts.push(i, (i % 2) * 0.001, 0);   // a straight wobble along x
    const pos = new Float32Array(pts);
    const l0 = buildFrameIndex(101).table;
    const g = chunkGrid(l0, pos, 8);
    expect(g.dx).toBeGreaterThan(1);
    expect(g.dy).toBe(1);
    const b0 = binPairs(l0, pos, g);
    expect(b0.plan).toHaveLength(g.cells);
    expect(b0.plan.reduce((s, r) => s + r.count, 0)).toBe(l0.length);
    const l1 = decimatePairs(pos, l0, 0.01);           // collapses to one long pair
    const b1 = binPairs(l1, pos, g);
    expect(b1.plan).toHaveLength(g.cells);
    expect(b1.plan.filter(r => r.count > 0)).toHaveLength(1);   // the single pair sits in the middle cell
    const midCell = b1.plan.findIndex(r => r.count > 0);
    expect(midCell).toBeGreaterThan(0);
    expect(midCell).toBeLessThan(g.cells - 1);
    // a pair outside the grid's envelope clamps into the border cell
    const far = new Uint32Array([0, 1]);
    const posFar = new Float32Array([-50, 0, 0, -49, 0, 0]);
    expect(binPairs(far, posFar, g).plan[0]!.count).toBe(2);
  });
  it("an empty index yields a one-cell grid and an empty plan entry", () => {
    const g = chunkGrid(new Uint32Array(0), new Float32Array(0));
    expect(g.cells).toBe(1);
    expect(binPairs(new Uint32Array(0), new Float32Array(0), g).plan).toEqual([{ start: 0, count: 0 }]);
  });
});

describe("splitPairsByFrame + buildLodLevels", () => {
  it("splits a level's pairs by frame and drops a pair spanning frames", () => {
    const room = new Uint8Array([1, 1, 0, 0]);
    const sp = splitPairsByFrame(new Uint32Array([0, 1, 2, 3, 1, 2]), room);
    expect(Array.from(sp.room)).toEqual([0, 1]);
    expect(Array.from(sp.table)).toEqual([2, 3]);
    expect(sp.mixed).toBe(1);
    const all = splitPairsByFrame(new Uint32Array([0, 1, 1, 2]), null);
    expect(Array.from(all.table)).toEqual([0, 1, 1, 2]);
    expect(all.room.length).toBe(0);
  });
  it("cuts one level per LOD_TOL_FRAC at that fraction of the joint envelope diagonal", () => {
    const feed = new Float32Array([0, 0, 0, 50, 0, 0, 100, 0, 0]);       // straight 100 mm
    const rapid = new Float32Array([0, 0, 0, 0, 0, 30]);
    const { feedLod, rapidLod, lodTols } = buildLodLevels(feed, undefined, rapid, undefined);
    expect(lodTols).toHaveLength(LOD_TOL_FRAC.length);
    const diag = Math.sqrt(100 * 100 + 30 * 30);
    expect(lodTols[0]).toBeCloseTo(LOD_TOL_FRAC[0]! * diag, 9);
    expect(feedLod).toHaveLength(LOD_TOL_FRAC.length);
    expect(Array.from(feedLod[0]!)).toEqual([0, 2]);                        // collinear → one pair
    expect(Array.from(rapidLod[0]!)).toEqual([0, 1]);
    // a room mask ends the run at the flip's duplicate break
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]);
    const rm = new Uint8Array([1, 1, 0, 0]);
    const lv = buildLodLevels(pos, new Uint32Array([2]), new Float32Array(0), undefined, rm, null);
    expect(Array.from(lv.feedLod[0]!).sort()).toEqual([0, 1, 2, 3]);
    expect(lv.rapidLod[0]!.length).toBe(0);
  });
});

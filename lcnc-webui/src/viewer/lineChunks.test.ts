// Unit tests for viewer/lineChunks.ts — the chunked-draw index arithmetic.
import { describe, expect, it } from "vitest";
import { boxInsideBounds, buildFrameIndex, chunkBounds, chunkPlan, cumulativeDistances, spatialChunks, unionBounds } from "./lineChunks";
import * as THREE from "three";

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

describe("boxInsideBounds", () => {
  const bounds = new Float32Array([0, 0, 0, 10, 10, 10]);
  const I = new THREE.Matrix4().elements;
  it("inside, straddling and outside with an identity transform", () => {
    expect(boxInsideBounds(bounds, 0, I, [-1, -1, -1], [20, 20, 20])).toBe(true);
    expect(boxInsideBounds(bounds, 0, I, [5, -1, -1], [20, 20, 20])).toBe(false);
    expect(boxInsideBounds(bounds, 0, I, [50, 50, 50], [20, 20, 20])).toBe(false);
  });
  it("a rotated chunk is judged by its transformed corners", () => {
    // Box [0,10]³ rotated 90° about Z lands in x ∈ [-10, 0]: outside a
    // machine box starting at x = 0, inside one starting at x = -10.
    const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2).elements;
    expect(boxInsideBounds(bounds, 0, m, [0, 0, 0], [20, 20, 20])).toBe(false);
    expect(boxInsideBounds(bounds, 0, m, [-10, 0, 0], [20, 20, 20])).toBe(true);
  });
  it("an empty chunk is inside (nothing to draw); the epsilon absorbs float noise", () => {
    expect(boxInsideBounds(new Float32Array([1, 1, 1, 0, 0, 0]), 0, I, [5, 5, 5], [1, 1, 1])).toBe(true);
    expect(boxInsideBounds(bounds, 0, I, [0, 0, 0], [10 - 1e-9, 10, 10])).toBe(true);
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

// Package 4 (plan Fassungen 2–3.1, Codex R62–R65): the cell choice with
// hysteresis, the visible parameter interval, the stable reach chains.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildChains, chooseCells, clipParam, GEO_CELLS_MAX, GEO_CELLS_MIN } from "./geoDash";

describe("chooseCells", () => {
  it("puts the mean cell in 6 … 12 px from scratch, a power of two", () => {
    expect(chooseCells(96, 0)).toBe(8);                 // 12 px
    expect(chooseCells(96.01, 0)).toBe(16);             // 6.0006 px
    expect(chooseCells(80, 0)).toBe(8);                 // 10 px
    for (const px of [30, 77, 300, 4000]) {
      const n = chooseCells(px, 0);
      expect(Math.log2(n) % 1).toBe(0);
      expect(px / n).toBeGreaterThan(6);
      expect(px / n).toBeLessThanOrEqual(12);
    }
  });

  it("holds its step across the 96 px threshold — no pendulum (Codex R62)", () => {
    let n = chooseCells(95.99, 0);
    const seen = new Set<number>();
    for (const px of [96.01, 95.99, 96.01, 95.99, 96.01]) { n = chooseCells(px, n); seen.add(n); }
    expect([...seen]).toEqual([8]);
  });

  it("moves only past the band: up beyond 15 px, down below 4.8 px — and halving keeps every second boundary", () => {
    let n = chooseCells(80, 0);                 // 8, 10 px
    n = chooseCells(119, n); expect(n).toBe(8); // 14.9 px: kept
    n = chooseCells(125, n); expect(n).toBe(16); // 15.6 px → 7.8 px
    n = chooseCells(80, n); expect(n).toBe(16); // 5 px: kept
    n = chooseCells(70, n); expect(n).toBe(8);  // 4.4 px → 8.75 px
    // nested: every boundary of N = 8 is one of N = 16
    for (let k = 0; k <= 8; k++) expect(Number.isInteger((k / 8) * 16)).toBe(true);
  });

  it("never below two cells, never above the cap; an invisible unit keeps its step", () => {
    expect(chooseCells(3, 0)).toBe(GEO_CELLS_MIN);
    expect(chooseCells(3, 2)).toBe(2);
    expect(chooseCells(1e12, 0)).toBe(GEO_CELLS_MAX);
    expect(chooseCells(0, 64)).toBe(64);
    expect(chooseCells(Number.NaN, 64)).toBe(64);
  });

  it("Codex R63's clipped edge: 100 px visible over Δt = 1/51 takes N = 512, 9.96 px nominal", () => {
    const n = chooseCells(100 * 51, 0);
    expect(n).toBe(512);
    expect(100 / (n / 51)).toBeCloseTo(9.96, 2);
  });

  it("Fassung 3.1: a governing piece longer than 15 px below the cap holds an inner boundary (N · Δt > 1)", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    let prev = 0;
    for (let i = 0; i < 2000; i++) {
      const L = 15.001 + rnd() * 2000, dt = 1e-3 + rnd() * (1 - 1e-3);
      prev = chooseCells(L / dt, prev);
      if (prev === GEO_CELLS_MAX) continue;
      expect(prev * dt, `L ${L} Δt ${dt} N ${prev}`).toBeGreaterThan(1);
    }
  });
});

describe("clipParam", () => {
  const out = new Float64Array(2);
  // a camera at the origin looking down −Z, 500 CSS px focal length in a 500 px high view
  const cam = new THREE.PerspectiveCamera(2 * Math.atan(0.5) * 180 / Math.PI, 1, 1, 1e5);
  cam.updateProjectionMatrix();
  const clip = (x: number, y: number, z: number) => new THREE.Vector4(x, y, z, 1).applyMatrix4(cam.projectionMatrix).toArray();

  it("a segment in view is visible whole", () => {
    expect(clipParam(clip(-1, 0, -10), clip(1, 0, -10), out)).toBe(true);
    expect([...out]).toEqual([0, 1]);
  });

  it("Codex R63: the near plane cuts the edge at t = 50/51", () => {
    expect(clipParam(clip(10.2, 0, 49), clip(0, 0, -2), out)).toBe(true);
    expect(out[0]).toBeCloseTo(50 / 51, 9);
    expect(out[1]).toBeCloseTo(1, 9);
  });

  it("a segment behind the camera or off to the side is not visible", () => {
    expect(clipParam(clip(0, 0, 5), clip(1, 0, 3), out)).toBe(false);
    expect(clipParam(clip(100, 0, -10), clip(200, 0, -10), out)).toBe(false);
  });
});

describe("buildChains", () => {
  // two open chains and a square ring
  const segs: number[][] = [
    [0, 0, 0, 1, 0, 0], [1, 0, 0, 2, 0, 0], [2, 0, 0, 3, 0, 0],      // chain A, length 3
    [10, 5, 0, 10, 6, 0], [10, 6, 0, 10, 8, 0],                        // chain B, length 3
    [20, 0, 0, 21, 0, 0], [21, 0, 0, 21, 1, 0], [21, 1, 0, 20, 1, 0], [20, 1, 0, 20, 0, 0], // ring
  ];
  /** t at every stored vertex, keyed by its position. */
  const tByVertex = (list: number[][]) => {
    const c = buildChains(list.flat());
    const m = new Map<string, number>();
    list.forEach((s, i) => {
      m.set(`${c.chainOf[i]}?${s.slice(0, 3)}`, c.t[i * 2]!);
      m.set(`${c.chainOf[i]}?${s.slice(3)}`, c.t[i * 2 + 1]!);
    });
    // chain ids differ between permutations: key by the chain's start vertex instead
    const out = new Map<string, number>();
    for (const [k, v] of m) {
      const [ci, pos] = k.split("?");
      const ch = Number(ci);
      const startSeg = c.order[c.starts[ch]!]!;
      const startT0 = c.t[startSeg * 2]! === 0 ? list[startSeg]!.slice(0, 3) : list[startSeg]!.slice(3);
      out.set(`${startT0}|${pos}`, Math.round(v * 1e6) / 1e6);
    }
    return { c, out };
  };

  it("finds three chains; an open chain starts at its lexicographically smaller end, t runs 0 … 1 by length", () => {
    const { c, out } = tByVertex(segs);
    expect(c.count).toBe(3);
    expect(out.get("0,0,0|0,0,0")).toBe(0);
    expect(out.get("0,0,0|3,0,0")).toBe(1);
    expect(out.get("0,0,0|1,0,0")).toBeCloseTo(1 / 3, 5);
    expect(out.get("10,5,0|10,6,0")).toBeCloseTo(1 / 3, 5);
    // the ring starts at (20,0,0), towards the smaller neighbour (20,1,0)
    expect(out.get("20,0,0|20,1,0")).toBeCloseTo(0.25, 5);
    expect(out.get("20,0,0|21,1,0")).toBeCloseTo(0.5, 5);
  });

  it("Codex R66 VP-I27: contours that RETURN to a junction keep their phase when storage is reversed or flipped", () => {
    // two squares sharing one vertex (degree four): each contour runs from
    // the junction back to it — both ends at the same position
    const loops: number[][] = [
      [0, 0, 0, 1, 0, 0], [1, 0, 0, 1, 1, 0], [1, 1, 0, 0, 1, 0], [0, 1, 0, 0, 0, 0],
      [0, 0, 0, -1, 0, 0], [-1, 0, 0, -1, -1, 0], [-1, -1, 0, 0, -1, 0], [0, -1, 0, 0, 0, 0],
    ];
    /** t at a fixed WORLD point of every edge (37 % from its smaller end). */
    const phases = (list: number[][]) => {
      const c = buildChains(list.flat());
      return list.map((sg, i) => {
        const a = sg.slice(0, 3), b = sg.slice(3), fwd = a.join(",") < b.join(",");
        const ta = c.t[2 * i + (fwd ? 0 : 1)]!, tb = c.t[2 * i + (fwd ? 1 : 0)]!;
        return { edge: JSON.stringify(fwd ? [a, b] : [b, a]), t: Math.round((ta + (tb - ta) * 0.37) * 1e6) / 1e6 };
      }).sort((x, y) => x.edge.localeCompare(y.edge));
    };
    const base = phases(loops);
    expect(phases(loops.slice().reverse())).toEqual(base);
    expect(phases(loops.map((sg, i) => (i % 3 ? sg : [...sg.slice(3), ...sg.slice(0, 3)])))).toEqual(base);
    expect(phases([loops[5], loops[0], loops[7], loops[2], loops[4], loops[1], loops[6], loops[3]] as number[][])).toEqual(base);
  });

  it("is independent of the storage order and of each segment's stored direction (Codex R62/R63)", () => {
    const shuffled = [segs[7], segs[3], segs[0], segs[5], segs[2], segs[8], segs[4], segs[1], segs[6]] as number[][];
    const flipped = shuffled.map((s, i) => (i % 2 ? [...s.slice(3), ...s.slice(0, 3)] : s));
    const a = tByVertex(segs).out, b = tByVertex(flipped).out;
    expect([...b.entries()].sort()).toEqual([...a.entries()].sort());
  });
});

// The path build allocates through viewer/allocMeter.ts only (Codex R48
// VP-I17): the toolpath ledger's peak bound is held-at-start + what the
// meter counted, and fatPaths.test.ts proves it EXACT against a spy on the
// typed-array constructors for every build path it drives. This
// source-shape guard covers the paths no fixture drives: no typed array is
// constructed in the build-path files except inside the meter.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { allocatedBytes, counted, countedGeometry, f32, f32Of, u32, u8 } from "./allocMeter";

// Vite's glob rather than node:fs — this suite typechecks under the browser
// tsconfig, which has no node types.
const SOURCES = import.meta.glob(["./lineChunks.ts", "./fatPaths.ts", "./boxLines.ts", "./toolpathController.ts"], {
  query: "?raw", import: "default", eager: true,
}) as Record<string, string>;

const TYPED = "(?:Float32|Float64|Uint32|Uint16|Uint8|Uint8Clamped|Int32|Int16|Int8)Array";

describe("allocMeter", () => {
  it("the build-path files construct no typed array outside the meter", () => {
    expect(Object.keys(SOURCES)).toHaveLength(4);
    const raw: string[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
      for (const m of src.matchAll(new RegExp(`new ${TYPED}\\(|\\b${TYPED}\\.(?:from|of)\\(`, "g"))) {
        raw.push(`${file}:${src.slice(0, m.index).split("\n").length}: ${m[0]}`);
      }
    }
    expect(raw).toEqual([]);
  });

  it("counts every allocation at its capacity, and three's own arrays once each", () => {
    const a0 = allocatedBytes();
    f32(3); u32(2); u8(5); f32Of([1, 2]);
    expect(allocatedBytes() - a0).toBe(12 + 8 + 5 + 8);
    const big = new Float32Array(64);
    counted(big.subarray(0, 2));   // a view keeps its whole buffer alive
    expect(allocatedBytes() - a0).toBe(33 + 256);
    const g = new THREE.BufferGeometry();
    const inter = new THREE.InterleavedBuffer(new Float32Array(12), 6);
    g.setAttribute("a", new THREE.InterleavedBufferAttribute(inter, 3, 0));
    g.setAttribute("b", new THREE.InterleavedBufferAttribute(inter, 3, 3));   // the same buffer
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(4), 1));
    const a1 = allocatedBytes();
    countedGeometry(g);
    expect(allocatedBytes() - a1).toBe(48 + 8);
  });
});

// The path lines at 2 CSS px (operator 2026-09-29, Codex R38/R39 — part B):
// WebGL draws GL lines one DEVICE pixel wide whatever `linewidth` says, so a
// wider path is a screen-space line (three's LineSegments2): per segment one
// instance of a shared quad, the endpoints packed as six floats. The chunk /
// LOD structure stays (viewer/lineChunks.ts): each chunk's pair range of each
// level is PACKED into its own instance buffer here — the shared position
// attribute and the level index lists stay the source for scrub, sweep,
// findings, overlays and the reveal.
//
// Dash distances come from the ORIGINAL stream (the worker's lineDistance per
// vertex): a pair (a, b) gets dist[a], dist[b] — never re-summed over the
// spatially sorted pairs, or the dashes would change with the LOD level
// (Codex R38). A pair whose endpoints coincide is dropped (a zero-length quad
// has no direction; it draws nothing either way).
import * as THREE from "three";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { countedGeometry, f32 } from "./allocMeter";

/** Every path line (feed, rapid, limit overlay, backplot), CSS px. */
export const PATH_PX = 2;

export interface PackedPairs {
  /** Six floats per kept pair: start xyz, end xyz. */
  positions: Float32Array;
  /** Two floats per kept pair (start, end distance); null without `dist`. */
  distances: Float32Array | null;
  /** Kept pairs (degenerate ones dropped). */
  pairs: number;
}

/** The pairs of index[start .. start+count) whose endpoints differ — what
 *  packPairs keeps. */
export function packedPairCount(pos: Float32Array, index: ArrayLike<number>, start: number, count: number): number {
  let w = 0;
  for (let q = start; q + 1 < start + count; q += 2) {
    const a = index[q]! * 3, b = index[q + 1]! * 3;
    if (pos[a] !== pos[b] || pos[a + 1] !== pos[b + 1] || pos[a + 2] !== pos[b + 2]) w++;
  }
  return w;
}

/** Pack the pairs index[start .. start+count) (vertex ids, two per pair) over
 *  `pos` (xyz per vertex). Counted first, allocated exactly (through the
 *  meter — no full-size scratch cut down afterwards, Codex R48 VP-I17). */
export function packPairs(pos: Float32Array, index: ArrayLike<number>, start: number, count: number,
  dist: Float32Array | null = null): PackedPairs {
  const kept = packedPairCount(pos, index, start, count);
  const positions = f32(kept * 6);
  const distances = dist ? f32(kept * 2) : null;
  let w = 0;
  for (let q = start; q + 1 < start + count; q += 2) {
    const a = index[q]! * 3, b = index[q + 1]! * 3;
    const ax = pos[a]!, ay = pos[a + 1]!, az = pos[a + 2]!;
    const bx = pos[b]!, by = pos[b + 1]!, bz = pos[b + 2]!;
    if (ax === bx && ay === by && az === bz) continue;
    const o = w * 6;
    positions[o] = ax; positions[o + 1] = ay; positions[o + 2] = az;
    positions[o + 3] = bx; positions[o + 4] = by; positions[o + 5] = bz;
    if (distances) { distances[w * 2] = dist![index[q]!]!; distances[w * 2 + 1] = dist![index[q + 1]!]!; }
    w++;
  }
  return { positions, distances, pairs: w };
}

/** Bytes three allocates for one LineSegmentsGeometry's own quad mesh
 *  (position, uv, index — per geometry, whatever it draws), measured once
 *  from three itself. */
export const FAT_MESH_BYTES = (() => {
  const g = new LineSegmentsGeometry();
  const seen = new Set<ArrayBufferLike>();
  let n = 0;
  for (const a of [g.getAttribute("position"), g.getAttribute("uv"), g.index] as (THREE.BufferAttribute | null)[]) {
    const arr = a?.array as ArrayBufferView | undefined;
    if (arr && !seen.has(arr.buffer)) { seen.add(arr.buffer); n += arr.buffer.byteLength; }
  }
  g.dispose();
  return n;
})();

/** What fatGeometry + packPairs allocate for `pairs` pairs (an upper bound:
 *  degenerate pairs are dropped at packing) — the eager estimate's unit. */
export function fatBytes(pairs: number, dashed: boolean): number {
  return FAT_MESH_BYTES + (pairs > 0 ? pairs * (24 + (dashed ? 8 : 0)) : 24);
}

/** A LineSegmentsGeometry over packed pairs, with the dash distances as the
 *  instance attributes LineMaterial's dash reads, and the caller's bounding
 *  sphere (the chunk's — `setPositions` computes one from the points, which
 *  the chunk sphere replaces so culling and LOD agree). An empty pack draws
 *  nothing (`instanceCount` 0). */
export function fatGeometry(p: PackedPairs, sphere: THREE.Sphere | null = null): LineSegmentsGeometry {
  const g = new LineSegmentsGeometry();
  countedGeometry(g);   // three's own quad mesh, before the packed arrays attach
  if (p.pairs === 0) {
    g.setPositions(f32(6));
    g.instanceCount = 0;
  } else {
    g.setPositions(p.positions);
    if (p.distances) {
      const buf = new THREE.InstancedInterleavedBuffer(p.distances, 2, 1);
      g.setAttribute("instanceDistanceStart", new THREE.InterleavedBufferAttribute(buf, 1, 0));
      g.setAttribute("instanceDistanceEnd", new THREE.InterleavedBufferAttribute(buf, 1, 1));
    }
    // three's InstancedBufferGeometry defaults to Infinity: say what is drawn
    g.instanceCount = p.pairs;
  }
  if (sphere) g.boundingSphere = sphere;
  return g;
}

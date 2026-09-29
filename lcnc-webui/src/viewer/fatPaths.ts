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

/** Pack the pairs index[start .. start+count) (vertex ids, two per pair) over
 *  `pos` (xyz per vertex). */
export function packPairs(pos: Float32Array, index: ArrayLike<number>, start: number, count: number,
  dist: Float32Array | null = null): PackedPairs {
  const n = count >> 1;
  const positions = new Float32Array(n * 6);
  const distances = dist ? new Float32Array(n * 2) : null;
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
  return {
    positions: w === n ? positions : positions.slice(0, w * 6),
    distances: distances ? (w === n ? distances : distances.slice(0, w * 2)) : null,
    pairs: w,
  };
}

/** A LineSegmentsGeometry over packed pairs, with the dash distances as the
 *  instance attributes LineMaterial's dash reads, and the caller's bounding
 *  sphere (the chunk's — `setPositions` computes one from the points, which
 *  the chunk sphere replaces so culling and LOD agree). An empty pack draws
 *  nothing (`instanceCount` 0). */
export function fatGeometry(p: PackedPairs, sphere: THREE.Sphere | null = null): LineSegmentsGeometry {
  const g = new LineSegmentsGeometry();
  if (p.pairs === 0) {
    g.setPositions(new Float32Array(6));
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

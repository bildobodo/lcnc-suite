// Pure helpers for the chunked toolpath draw (2026-09-11 headroom wave).
//
// The whole program used to be ONE LineSegments with ONE bounding sphere, so
// Three's frustum culling never fired (the sphere covers the entire part) and
// every frame drew all 2 × 1.18 M segments twice (base line + the clipped
// outside-bounds overlay) — the ~18 ms/frame GPU floor with no headroom. The
// draw is now split into a few dozen contiguous index-range chunks over ONE
// shared position attribute (binned SPATIALLY — see spatialChunks): each chunk
// is its own object with an explicit bounding box/sphere, so off-screen
// chunks are culled when zoomed in, and the
// overlay object of a chunk that cannot be outside the machine bounds is not
// drawn at all (the common case: 4 full-path draws → 2).
//
// Everything here is index arithmetic over typed arrays — no THREE objects —
// so the same code serves the programmed path (main thread) and the baked
// path, and is unit-tested headlessly.

/** Target segments per chunk. Three's per-object cost (projectObject, VAO
 *  bind, draw call) is ~5–15 µs, so hundreds of chunks would eat the ≤ 2 ms
 *  CPU submit the probe measured; ~30 chunks on the big program, 1 on small
 *  ones — no regression for the common case. */
export const CHUNK_TARGET_SEGS = 40_000;
export const CHUNK_MAX = 64;

export interface FrameIndex {
  /** Segment pairs (i-1, i) drawn in the table/part frame. */
  table: Uint32Array;
  /** Segment pairs drawn room-fixed (machine frame). Empty until the
   *  rotary-boundary wave ships a `room` mask. */
  room: Uint32Array;
  /** Segments whose two vertices lie in different frames. They cannot be
   *  drawn honestly in either frame and are DROPPED; the part-frame bake
   *  emits a duplicated vertex + break at every flip precisely so this reads
   *  0 — a non-zero count in telemetry is a bug upstream, never hidden. */
  mixed: number;
}

/** Index buffer(s) of the REAL segments of a vertex stream: pair (i-1, i)
 *  for every i that does not OPEN a section (`breaks` lists section-start
 *  vertices — the connector into them would be a false move skipping the
 *  other stream's motion). With a `room` mask (1 = room frame) the pairs
 *  are split by the frame of BOTH endpoints. */
export function buildFrameIndex(n: number, breaks?: Uint32Array | null, room?: Uint8Array | null): FrameIndex {
  const isBreak = new Uint8Array(Math.max(n, 0));
  if (breaks) for (const b of breaks) if (b < n) isBreak[b] = 1;
  const cap = Math.max(0, n - 1) * 2;
  const table = new Uint32Array(cap);
  const roomIdx = room ? new Uint32Array(cap) : null;
  let t = 0, r = 0, mixed = 0;
  for (let i = 1; i < n; i++) {
    if (isBreak[i]) continue;
    if (roomIdx) {
      const f = room![i]!, fp = room![i - 1]!;
      if ((f !== 0) !== (fp !== 0)) { mixed++; continue; }
      if (f) { roomIdx[r++] = i - 1; roomIdx[r++] = i; continue; }
    }
    table[t++] = i - 1; table[t++] = i;
  }
  return {
    table: table.subarray(0, t).slice(),
    room: roomIdx ? roomIdx.subarray(0, r).slice() : new Uint32Array(0),
    mixed,
  };
}

/** Contiguous range of an index buffer, in INDEX units (pairs × 2). */
export interface ChunkRange { start: number; count: number }

/** Split an index buffer of `indexLen` entries into ≤ `maxChunks` chunks of
 *  about `targetSegs` segments each. Ranges partition the buffer exactly and
 *  never split a pair. */
export function chunkPlan(indexLen: number, targetSegs = CHUNK_TARGET_SEGS, maxChunks = CHUNK_MAX): ChunkRange[] {
  const pairs = Math.floor(indexLen / 2);
  if (pairs <= 0) return [];
  const k = Math.min(Math.max(1, maxChunks), Math.max(1, Math.ceil(pairs / Math.max(1, targetSegs))));
  const per = Math.ceil(pairs / k);
  const out: ChunkRange[] = [];
  for (let p = 0; p < pairs; p += per) out.push({ start: p * 2, count: Math.min(per, pairs - p) * 2 });
  return out;
}

/** Axis-aligned bounds of the vertices each chunk REFERENCES (6 floats per
 *  chunk: minx, miny, minz, maxx, maxy, maxz), in the stream's own
 *  coordinates. Unreferenced vertices (a section's last vertex is still
 *  referenced by its own segment; only a lone break vertex is not) are
 *  excluded, so the boxes are tight around what is drawn. An empty chunk
 *  reads as an inverted box (min > max). */
export function chunkBounds(idx: Uint32Array, pos: Float32Array, plan: readonly ChunkRange[]): Float32Array {
  const out = new Float32Array(plan.length * 6);
  for (let c = 0; c < plan.length; c++) {
    const { start, count } = plan[c]!;
    let minx = Infinity, miny = Infinity, minz = Infinity;
    let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    const end = Math.min(start + count, idx.length);
    for (let k = start; k < end; k++) {
      const v = idx[k]! * 3;
      const x = pos[v]!, y = pos[v + 1]!, z = pos[v + 2]!;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
      if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    const o = c * 6;
    out[o] = minx; out[o + 1] = miny; out[o + 2] = minz;
    out[o + 3] = maxx; out[o + 4] = maxy; out[o + 5] = maxz;
  }
  return out;
}

/** Spatially binned chunks: REORDERS the segment pairs of `idx` so that each
 *  chunk is a compact region — a cell of an extent-proportional grid over the
 *  drawn envelope — instead of a contiguous run of the program. A pocketing
 *  or facing pass sweeps the whole part in every 40 k segments, so program-
 *  order ranges are as big as the part and neither frustum culling nor the
 *  overlay gate would ever fire (live reading 2026-09-11: 31 chunks, 31
 *  overlays drawn). Pairs stay pairs; the VERTEX order — the highlight's
 *  and the source map's address space — is untouched, only the index buffer
 *  is permuted (a counting sort by cell, O(n)). Grid divisions per axis are
 *  `round(maxChunks ^ (extent share))`, so a flat part gets a 2-D grid and a
 *  long part a 1-D one; only non-empty cells become chunks. */
export function spatialChunks(idx: Uint32Array, pos: Float32Array, maxChunks = CHUNK_MAX): { index: Uint32Array; plan: ChunkRange[] } {
  const pairs = idx.length >> 1;
  if (pairs === 0) return { index: new Uint32Array(0), plan: [] };
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let k = 0; k < pairs * 2; k++) {
    const v = idx[k]! * 3;
    const x = pos[v]!, y = pos[v + 1]!, z = pos[v + 2]!;
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  const ex = maxx - minx, ey = maxy - miny, ez = maxz - minz;
  const sum = ex + ey + ez;
  const div = (e: number) => (sum > 0 && e > 0) ? Math.max(1, Math.round(Math.pow(Math.max(1, maxChunks), e / sum))) : 1;
  const dx = div(ex), dy = div(ey), dz = div(ez);
  const cells = dx * dy * dz;
  const sx = ex > 0 ? dx / ex : 0, sy = ey > 0 ? dy / ey : 0, sz = ez > 0 ? dz / ez : 0;
  const cell = new Uint32Array(pairs);
  const counts = new Uint32Array(cells + 1);
  for (let p = 0; p < pairs; p++) {
    const a = idx[p * 2]! * 3, b = idx[p * 2 + 1]! * 3;
    const mx = (pos[a]! + pos[b]!) * 0.5, my = (pos[a + 1]! + pos[b + 1]!) * 0.5, mz = (pos[a + 2]! + pos[b + 2]!) * 0.5;
    const cx = Math.min(dx - 1, Math.floor((mx - minx) * sx));
    const cy = Math.min(dy - 1, Math.floor((my - miny) * sy));
    const cz = Math.min(dz - 1, Math.floor((mz - minz) * sz));
    const id = (cz * dy + cy) * dx + cx;
    cell[p] = id;
    counts[id + 1]!++;
  }
  for (let i = 1; i <= cells; i++) counts[i]! += counts[i - 1]!;   // counts[i] = first pair slot of cell i
  const cursor = counts.slice(0, cells);
  const out = new Uint32Array(pairs * 2);
  for (let p = 0; p < pairs; p++) {
    const w = cursor[cell[p]!]!++;
    out[w * 2] = idx[p * 2]!; out[w * 2 + 1] = idx[p * 2 + 1]!;
  }
  const plan: ChunkRange[] = [];
  for (let i = 0; i < cells; i++) {
    const n = counts[i + 1]! - counts[i]!;
    if (n > 0) plan.push({ start: counts[i]! * 2, count: n * 2 });
  }
  return { index: out, plan };
}

/** Cumulative polyline distance per vertex (the dashed rapid material's
 *  `lineDistance` attribute) for the legacy/WS path that carries no
 *  worker-precomputed array. Three's own computeLineDistances refuses
 *  indexed geometry, and every chunk is indexed now. */
export function cumulativeDistances(pos: Float32Array): Float32Array {
  const n = Math.floor(pos.length / 3);
  const out = new Float32Array(n);
  let d = 0;
  for (let i = 1; i < n; i++) {
    const a = (i - 1) * 3, b = i * 3;
    const dx = pos[b]! - pos[a]!, dy = pos[b + 1]! - pos[a + 1]!, dz = pos[b + 2]! - pos[a + 2]!;
    d += Math.sqrt(dx * dx + dy * dy + dz * dz);
    out[i] = d;
  }
  return out;
}

/** Union of the chunk boxes (same 6-float layout); inverted when empty. */
export function unionBounds(bounds: Float32Array): Float32Array {
  const out = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let o = 0; o + 5 < bounds.length; o += 6) {
    if (bounds[o]! > bounds[o + 3]!) continue;   // empty chunk
    for (let k = 0; k < 3; k++) {
      if (bounds[o + k]! < out[k]!) out[k] = bounds[o + k]!;
      if (bounds[o + 3 + k]! > out[3 + k]!) out[3 + k] = bounds[o + 3 + k]!;
    }
  }
  return out;
}

/** Whether a local box (6 floats at `o` in `bounds`), transformed by the
 *  column-major 4×4 `m` (THREE.Matrix4.elements layout), lies entirely
 *  inside the axis-aligned box [origin, origin + size]. Transforms the 8
 *  corners — exact for the rotated case and conservative for the overlay
 *  gate: "inside" means the chunk can show NO outside-bounds segment. An
 *  empty chunk is inside (nothing to draw). */
export function boxInsideBounds(
  bounds: Float32Array, o: number, m: ArrayLike<number>,
  origin: ArrayLike<number>, size: ArrayLike<number>, eps = 1e-6,
): boolean {
  const minx = bounds[o]!, miny = bounds[o + 1]!, minz = bounds[o + 2]!;
  const maxx = bounds[o + 3]!, maxy = bounds[o + 4]!, maxz = bounds[o + 5]!;
  if (minx > maxx) return true;
  const lox = origin[0]! - eps, loy = origin[1]! - eps, loz = origin[2]! - eps;
  const hix = origin[0]! + size[0]! + eps, hiy = origin[1]! + size[1]! + eps, hiz = origin[2]! + size[2]! + eps;
  for (let c = 0; c < 8; c++) {
    const x = (c & 1) ? maxx : minx, y = (c & 2) ? maxy : miny, z = (c & 4) ? maxz : minz;
    const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    if (wx < lox || wx > hix || wy < loy || wy > hiy || wz < loz || wz > hiz) return false;
  }
  return true;
}

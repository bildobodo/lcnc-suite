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

/** The spatial grid one stream's chunks are binned into (spatialChunks):
 *  the envelope of the referenced vertices and extent-proportional
 *  divisions. Built ONCE from the level-0 pairs and reused for every LOD
 *  level, so chunk c means the same cell at every level. */
export interface ChunkGrid {
  minx: number; miny: number; minz: number;
  sx: number; sy: number; sz: number;      // cells per unit (0 = one cell on that axis)
  dx: number; dy: number; dz: number;
  cells: number;
}

export function chunkGrid(idx: Uint32Array, pos: Float32Array, maxChunks = CHUNK_MAX): ChunkGrid {
  let minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  for (let k = 0; k < idx.length; k++) {
    const v = idx[k]! * 3;
    const x = pos[v]!, y = pos[v + 1]!, z = pos[v + 2]!;
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
    if (z < minz) minz = z; if (z > maxz) maxz = z;
  }
  if (!(minx <= maxx)) return { minx: 0, miny: 0, minz: 0, sx: 0, sy: 0, sz: 0, dx: 1, dy: 1, dz: 1, cells: 1 };
  const ex = maxx - minx, ey = maxy - miny, ez = maxz - minz;
  const sum = ex + ey + ez;
  const div = (e: number) => (sum > 0 && e > 0) ? Math.max(1, Math.round(Math.pow(Math.max(1, maxChunks), e / sum))) : 1;
  const dx = div(ex), dy = div(ey), dz = div(ez);
  return {
    minx, miny, minz,
    sx: ex > 0 ? dx / ex : 0, sy: ey > 0 ? dy / ey : 0, sz: ez > 0 ? dz / ez : 0,
    dx, dy, dz, cells: dx * dy * dz,
  };
}

/** Bin `idx`'s pairs into the grid's cells by segment midpoint (a counting
 *  sort, O(n)): the pairs are REORDERED so each cell is contiguous. Returns
 *  the permuted buffer and one range per cell — EVERY cell, empty ones
 *  with count 0, so ranges line up across LOD levels. */
export function binPairs(idx: Uint32Array, pos: Float32Array, g: ChunkGrid): { index: Uint32Array; plan: ChunkRange[] } {
  const pairs = idx.length >> 1;
  const cell = new Uint32Array(pairs);
  const counts = new Uint32Array(g.cells + 1);
  for (let p = 0; p < pairs; p++) {
    const a = idx[p * 2]! * 3, b = idx[p * 2 + 1]! * 3;
    const mx = (pos[a]! + pos[b]!) * 0.5, my = (pos[a + 1]! + pos[b + 1]!) * 0.5, mz = (pos[a + 2]! + pos[b + 2]!) * 0.5;
    const cx = Math.min(g.dx - 1, Math.max(0, Math.floor((mx - g.minx) * g.sx)));
    const cy = Math.min(g.dy - 1, Math.max(0, Math.floor((my - g.miny) * g.sy)));
    const cz = Math.min(g.dz - 1, Math.max(0, Math.floor((mz - g.minz) * g.sz)));
    const id = (cz * g.dy + cy) * g.dx + cx;
    cell[p] = id;
    counts[id + 1]!++;
  }
  for (let i = 1; i <= g.cells; i++) counts[i]! += counts[i - 1]!;
  const cursor = counts.slice(0, g.cells);
  const out = new Uint32Array(pairs * 2);
  for (let p = 0; p < pairs; p++) {
    const w = cursor[cell[p]!]!++;
    out[w * 2] = idx[p * 2]!; out[w * 2 + 1] = idx[p * 2 + 1]!;
  }
  const plan: ChunkRange[] = [];
  for (let i = 0; i < g.cells; i++) plan.push({ start: counts[i]! * 2, count: (counts[i + 1]! - counts[i]!) * 2 });
  return { index: out, plan };
}

/** Spatially binned chunks: REORDERS the segment pairs of `idx` so that each
 *  chunk is a compact region — a cell of an extent-proportional grid over the
 *  drawn envelope — instead of a contiguous run of the program. A pocketing
 *  or facing pass sweeps the whole part in every 40 k segments, so program-
 *  order ranges are as big as the part and neither frustum culling nor the
 *  overlay gate would ever fire (live reading 2026-09-11: 31 chunks, 31
 *  overlays drawn). Pairs stay pairs; the VERTEX order — the highlight's
 *  and the source map's address space — is untouched, only the index buffer
 *  is permuted. Only non-empty cells become chunks (chunkGrid + binPairs
 *  are the multi-level form). */
export function spatialChunks(idx: Uint32Array, pos: Float32Array, maxChunks = CHUNK_MAX): { index: Uint32Array; plan: ChunkRange[] } {
  const pairs = idx.length >> 1;
  if (pairs === 0) return { index: new Uint32Array(0), plan: [] };
  const { index, plan } = binPairs(idx, pos, chunkGrid(idx, pos, maxChunks));
  return { index, plan: plan.filter(r => r.count > 0) };
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

/** Display LOD (2026-09-11 headroom wave, step 3): the 0.005 mm parse-time
 *  RDP keeps every 0.09 mm chord of a fine CAM post; at fit-to-view a
 *  Retina pixel is ~0.3 mm, so most of the 1.18 M segments are sub-pixel
 *  and cost their vertices for nothing visible. A LEVEL is a decimated
 *  PAIR list over the SAME vertex buffer (a decimated segment joins two
 *  kept vertices), so the highlight, the scrub and the sweep keep
 *  addressing the full-resolution vertices; only what the GPU is handed
 *  shrinks. Runs (chains of consecutive pairs) are decimated separately,
 *  so a section break or a room/table flip is never crossed. Tolerances
 *  are scale-free from the drawn envelope's diagonal; the renderer picks
 *  per chunk the coarsest level whose tolerance is under half a pixel. */
export const LOD_TOL_FRAC: readonly number[] = [1e-4, 5e-4];   // per level ≥ 1, × envelope diagonal

/** Axis-aligned envelope of `pos` accumulated into `out` (6 floats, min
 *  then max; start it inverted to union several streams). */
export function envelopeInto(pos: Float32Array, out: Float32Array): Float32Array {
  for (let i = 0; i + 2 < pos.length; i += 3) {
    const x = pos[i]!, y = pos[i + 1]!, z = pos[i + 2]!;
    if (x < out[0]!) out[0] = x; if (x > out[3]!) out[3] = x;
    if (y < out[1]!) out[1] = y; if (y > out[4]!) out[4] = y;
    if (z < out[2]!) out[2] = z; if (z > out[5]!) out[5] = z;
  }
  return out;
}

/** Diagonal of the axis-aligned envelope of `pos` (0 for < 2 vertices). */
export function envelopeDiagonal(pos: Float32Array): number {
  if (pos.length < 6) return 0;
  const e = envelopeInto(pos, new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]));
  return Math.sqrt((e[3]! - e[0]!) ** 2 + (e[4]! - e[1]!) ** 2 + (e[5]! - e[2]!) ** 2);
}

/** Douglas–Peucker over each run of `pairs` (vertex-ordered chains, as
 *  buildFrameIndex emits them): returns the pairs joining the vertices kept
 *  within `tol` (3D perpendicular distance to the chord). Coarse-from-fine
 *  is valid: decimating a level's output with a larger tolerance keeps the
 *  error ≤ the sum. tol ≤ 0 returns a copy. Pure, allocation-bounded. */
export function decimatePairs(pos: Float32Array, pairs: Uint32Array, tol: number): Uint32Array {
  const np = pairs.length >> 1;
  if (np === 0 || !(tol > 0)) return pairs.slice(0, np * 2);
  const tol2 = tol * tol;
  const out = new Uint32Array(np * 2);
  let w = 0;
  // Run vertex list (indices into pos), reused across runs.
  let run = new Uint32Array(1024);
  const keep = { buf: new Uint8Array(1024) };
  const stack: number[] = [];
  let p = 0;
  while (p < np) {
    // Collect one run: pairs chained end-to-start.
    let m = 0;
    if (run.length < 2) run = new Uint32Array(2);
    run[m++] = pairs[p * 2]!;
    run[m++] = pairs[p * 2 + 1]!;
    p++;
    while (p < np && pairs[p * 2] === run[m - 1]) {
      if (m >= run.length) { const g = new Uint32Array(run.length * 2); g.set(run); run = g; }
      run[m++] = pairs[p * 2 + 1]!;
      p++;
    }
    if (keep.buf.length < m) keep.buf = new Uint8Array(Math.max(m, keep.buf.length * 2));
    const kp = keep.buf;
    kp.fill(0, 0, m);
    kp[0] = 1; kp[m - 1] = 1;
    stack.length = 0;
    stack.push(0, m - 1);
    while (stack.length) {
      const i1 = stack.pop()!, i0 = stack.pop()!;
      if (i1 - i0 < 2) continue;
      const a = run[i0]! * 3, b = run[i1]! * 3;
      const ax = pos[a]!, ay = pos[a + 1]!, az = pos[a + 2]!;
      const dx = pos[b]! - ax, dy = pos[b + 1]! - ay, dz = pos[b + 2]! - az;
      const len2 = dx * dx + dy * dy + dz * dz;
      let best = -1, bestD = tol2;
      for (let i = i0 + 1; i < i1; i++) {
        const v = run[i]! * 3;
        const px = pos[v]! - ax, py = pos[v + 1]! - ay, pz = pos[v + 2]! - az;
        let d2: number;
        if (len2 > 0) {
          let t = (px * dx + py * dy + pz * dz) / len2;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          const ex = px - t * dx, ey = py - t * dy, ez = pz - t * dz;
          d2 = ex * ex + ey * ey + ez * ez;
        } else {
          d2 = px * px + py * py + pz * pz;
        }
        if (d2 > bestD) { bestD = d2; best = i; }
      }
      if (best >= 0) {
        kp[best] = 1;
        stack.push(i0, best, best, i1);
      }
    }
    let prev = -1;
    for (let i = 0; i < m; i++) {
      if (!kp[i]) continue;
      if (prev >= 0) { out[w++] = run[prev]!; out[w++] = run[i]!; }
      prev = i;
    }
  }
  return out.subarray(0, w).slice();
}

/** The LOD levels of both drawn streams (the worker-side entry point):
 *  level k ≥ 1 = decimatePairs at LOD_TOL_FRAC[k-1] × the diagonal of the
 *  two streams' joint envelope, coarse-from-fine. Level-0 pairs come from
 *  buildFrameIndex with the same breaks (and room masks when known, so a
 *  flip's duplicate break ends the run); table and room pairs are cut
 *  together — runs never cross frames. Streams with < 2 vertices get
 *  empty levels. */
export function buildLodLevels(
  feedPos: Float32Array, feedBreaks: Uint32Array | undefined,
  rapidPos: Float32Array, rapidBreaks: Uint32Array | undefined,
  feedRoom?: Uint8Array | null, rapidRoom?: Uint8Array | null,
): { feedLod: Uint32Array[]; rapidLod: Uint32Array[]; lodTols: number[] } {
  const env = new Float32Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  envelopeInto(feedPos, env); envelopeInto(rapidPos, env);
  const diag = env[0]! <= env[3]! ? Math.sqrt((env[3]! - env[0]!) ** 2 + (env[4]! - env[1]!) ** 2 + (env[5]! - env[2]!) ** 2) : 0;
  const lodTols = LOD_TOL_FRAC.map(f => f * diag);
  const levelsOf = (pos: Float32Array, breaks: Uint32Array | undefined, room?: Uint8Array | null): Uint32Array[] => {
    const n = Math.floor(pos.length / 3);
    const out: Uint32Array[] = [];
    if (n < 2 || diag <= 0) { for (const _ of lodTols) out.push(new Uint32Array(0)); return out; }
    const fi = buildFrameIndex(n, breaks ?? null, room ?? null);
    let cur = fi.room.length ? concatU32(fi.table, fi.room) : fi.table;
    for (const tol of lodTols) {
      cur = decimatePairs(pos, cur, tol);
      out.push(cur);
    }
    return out;
  };
  return { feedLod: levelsOf(feedPos, feedBreaks, feedRoom), rapidLod: levelsOf(rapidPos, rapidBreaks, rapidRoom), lodTols };
}

function concatU32(a: Uint32Array, b: Uint32Array): Uint32Array {
  const out = new Uint32Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}

/** Split a level's pairs by the frame of their endpoints (both endpoints
 *  share a frame by construction of the runs; a pair whose endpoints differ
 *  — a level cut without knowing the flips, the programmed path — is
 *  dropped and counted, never drawn across frames). No mask = all table. */
export function splitPairsByFrame(pairs: Uint32Array, room: Uint8Array | null | undefined): FrameIndex {
  if (!room) return { table: pairs, room: new Uint32Array(0), mixed: 0 };
  const np = pairs.length >> 1;
  const t = new Uint32Array(np * 2), r = new Uint32Array(np * 2);
  let tw = 0, rw = 0, mixed = 0;
  for (let k = 0; k < np; k++) {
    const a = pairs[k * 2]!, b = pairs[k * 2 + 1]!;
    const fa = room[a] ? 1 : 0, fb = room[b] ? 1 : 0;
    if (fa !== fb) { mixed++; continue; }
    if (fa) { r[rw++] = a; r[rw++] = b; } else { t[tw++] = a; t[tw++] = b; }
  }
  return { table: t.subarray(0, tw).slice(), room: r.subarray(0, rw).slice(), mixed };
}

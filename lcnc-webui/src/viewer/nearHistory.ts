// A pair's speed bounds since its last sample inside the margin without a
// touch (collision.ts, step 4 package 2 B8; Codex R174 VP-I127): the stretch
// to that pair's next sample is searched BACK for its last pose inside the
// margin, and the pair's distance changes no faster than the chunks' bounds
// over it. One largest bound since the sample walked a long slow stretch at a
// fast chunk's pace (66 656 samples in one iterator call), so the bounds are
// kept as a short HISTORY: entry j holds from start[j] on at bound[j], the
// last entry to the stretch's end. Pure, on typed-array slices (`base`, `n`)
// so the sweep keeps every pair's history in two flat arrays.

/** At most this many entries a pair. */
export const NEAR_HIST = 16;

/** Add a chunk's bound `v` from `at` on; returns the new entry count. An
 *  unchanged bound extends the last entry. A full history first merges the
 *  two neighbours whose LARGER bound adds the least to the bound's integral,
 *  at that larger bound — never a fast chunk spread over a long slow stretch
 *  (merging by the least span did: a fast entry over 200 slow units). */
export function pushBound(start: Float64Array, bound: Float64Array, base: number, n: number, at: number, v: number): number {
  if (n > 0 && bound[base + n - 1] === v) return n;
  if (n === NEAR_HIST) {
    let j = 0, least = Infinity;
    for (let k = 0; k + 1 < n; k++) {
      const v0 = bound[base + k]!, v1 = bound[base + k + 1]!, vm = Math.max(v0, v1);
      const l0 = start[base + k + 1]! - start[base + k]!, l1 = (k + 2 < n ? start[base + k + 2]! : at) - start[base + k + 1]!;
      const added = (vm - v0) * l0 + (vm - v1) * l1;
      if (added < least) { least = added; j = k; }
    }
    bound[base + j] = Math.max(bound[base + j]!, bound[base + j + 1]!);
    start.copyWithin(base + j + 1, base + j + 2, base + n);
    bound.copyWithin(base + j + 1, base + j + 2, base + n);
    n--;
  }
  start[base + n] = at; bound[base + n] = v;
  return n + 1;
}

/** From `x` back to where the bounds use up `room` (the distance's margin
 *  from the margin's edge): over [result, x] the pair's distance changes by
 *  at most `room`. Before the first entry its bound holds on (the search
 *  stops at the stretch's start anyway). A bound below 1e-9 counts as 1e-9. */
export function backTo(start: Float64Array, bound: Float64Array, base: number, n: number, x: number, room: number): number {
  let k = n - 1;
  while (k > 0 && start[base + k]! > x) k--;
  let y = x;
  for (; ; k--) {
    const v = Math.max(bound[base + k]!, 1e-9), from = k > 0 ? start[base + k]! : -Infinity;
    if (y - room / v >= from) return y - room / v;
    room -= v * (y - from); y = from;
  }
}

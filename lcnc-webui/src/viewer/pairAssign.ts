// Pairs onto shards by cost (the parallel sweep, sweepShards.ts): kept free of
// imports so collision.ts — whose sweep assigns its own shard — and the merge
// module can both use it.

/** Split pairs into `k` masks balanced by `cost` (longest-processing-time
 *  first: the costliest pair goes to the least-loaded shard). Ties break by
 *  pair index, so every shard computes the same split. */
export function assignPairs(cost: ArrayLike<number>, k: number): Uint8Array[] {
  const n = cost.length;
  const masks = Array.from({ length: Math.max(1, k) }, () => new Uint8Array(n));
  const load = new Float64Array(masks.length);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => (cost[b]! - cost[a]!) || (a - b));
  for (const pi of order) {
    let best = 0;
    for (let s = 1; s < load.length; s++) if (load[s]! < load[best]!) best = s;
    masks[best]![pi] = 1;
    load[best] = load[best]! + Math.max(cost[pi]!, 0);
  }
  return masks;
}

// The parallel sweep's partition and merge (operator 2026-10-07: "konnte
// schon etwas parallelisiert werden?"). The unit of work is the PAIR, not a
// stretch of the track: every pair carries its own clearance certificates,
// contact state, cutting origin and records (collision.ts), so shards over
// disjoint pair sets need no stitching at any boundary — their results merge
// by concatenation and the one global cap. A track split would have to carry
// contact state, the cutting onset and the re-sampling after a touch across
// every cut (the places where the horizon and VP-I45 bugs lived).
//
// What a shard changes is WHERE a pair is sampled: the sweep steps to the
// nearest certificate expiry over the pairs it checks, so with fewer pairs a
// pair's queries land at its own expiries, not at points another pair forced.
// The guarantee is per pair and does not depend on it; a near-miss distance
// (the minimum over the samples taken) and a refined boundary (bisected to
// 1e-3) may differ in the last digits. sweepShards.test.ts holds the merged
// result to the single sweep under exactly that relation.
import { MAX_HITS, type CollisionHit, type CollisionResult } from "./collision";

/** Split pairs into `k` masks balanced by `cost` (longest-processing-time
 *  first: the costliest pair goes to the least-loaded shard). Ties break by
 *  pair index, so the split is deterministic. */
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

/** One result from the shards' results — what a single sweep over the union
 *  of their pairs reports: the hits concatenated and capped the single
 *  sweep's way (onsets first, then continuations, each by position; the
 *  report re-sorted by position), static contacts concatenated (each pair
 *  belongs to one shard), samples and prescreened pairs summed. A sweep is
 *  only as covered as its least covered shard. */
export function mergeShardResults(results: readonly CollisionResult[]): CollisionResult {
  if (results.length === 1) return results[0]!;
  const all = results.flatMap(r => r.hits);
  const onsets = all.filter(h => h.continuation === undefined).sort((x, y) => x.cum - y.cum);
  const conts = all.filter(h => h.continuation !== undefined).sort((x, y) => x.cum - y.cum);
  const hits: CollisionHit[] = [...onsets, ...conts].slice(0, MAX_HITS).sort((x, y) => x.cum - y.cum);
  let truncated: CollisionResult["truncated"] = null;
  for (const r of results) {
    if (r.truncated && (!truncated || r.truncated.covered < truncated.covered)) truncated = r.truncated;
  }
  const first = results[0]!;
  return {
    hits,
    staticContacts: results.flatMap(r => r.staticContacts),
    samples: results.reduce((s, r) => s + r.samples, 0),
    coarsened: results.some(r => r.coarsened),
    // Every shard sweeps the same model along the same track: the same note.
    uncertified: first.uncertified,
    pairCount: first.pairCount,
    pairsPrescreened: results.reduce((s, r) => s + r.pairsPrescreened, 0),
    bvhMs: Math.max(...results.map(r => r.bvhMs)),
    sweepMs: Math.max(...results.map(r => r.sweepMs)),
    truncated,
  };
}

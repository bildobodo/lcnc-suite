// The parallel sweep's partition and merge (operator 2026-10-07: "konnte
// schon etwas parallelisiert werden?"). The unit of work is the PAIR, not a
// stretch of the track: every pair carries its own clearance certificates,
// contact state, cutting origin and contact tables (collision.ts), so shards
// over disjoint pair sets need no stitching at any boundary — their tables
// are the request's, their results' metadata merges here. A track split would have to carry
// contact state, the cutting onset and the re-sampling after a touch across
// every cut (the places where the horizon and VP-I45 bugs lived).
//
// What a shard changes is WHERE a pair is sampled: the sweep steps to the
// nearest certificate expiry over the pairs it checks, so with fewer pairs a
// pair's queries land at its own expiries, not at points another pair forced.
// The guarantee is per pair and does not depend on it; a near-miss distance
// (the minimum over the samples taken) and a refined boundary (bisected to
// 1e-3) may differ in the last digits. sweepShards.test.ts holds the shards'
// tables to the single sweep's under exactly that relation.
import { unitedNotes, type CollisionResult } from "./collision";
export { assignPairs } from "./pairAssign";

/** One result from the shards' results — the metadata a single sweep over
 *  the union of their pairs reports (what they found is their contact
 *  tables'): static contacts concatenated (each pair
 *  belongs to one shard), samples and prescreened pairs summed. A sweep is
 *  only as covered as its least covered shard. A range sweep's start is
 *  every shard's, its boundary contacts their union. */
export function mergeShardResults(results: readonly CollisionResult[]): CollisionResult {
  if (results.length === 1) return results[0]!;
  let truncated: CollisionResult["truncated"] = null;
  for (const r of results) {
    if (r.truncated && (!truncated || r.truncated.covered < truncated.covered)) truncated = r.truncated;
  }
  // a contact store whose budget ran out: complete only before the earliest
  // point any shard stopped writing (step 4 package 2, plan 2.4; Codex R144
  // VP-I100 — the pool's result lost it)
  const from = results.reduce((m, r) => (r.incompleteFrom === undefined ? m : Math.min(m, r.incompleteFrom)), Infinity);
  const first = results[0]!;
  return {
    staticContacts: results.flatMap(r => r.staticContacts),
    samples: results.reduce((s, r) => s + r.samples, 0),
    coarsened: results.some(r => r.coarsened),
    // The same model along the same track gives every shard the same
    // statements — but a pair's own (an undecidable inside check) only the
    // shard that sweeps it: their union.
    ...unitedNotes(results),
    // the same track for every shard: the same start-dependent beginning
    ...(first.startDependent ? { startDependent: first.startDependent } : {}),
    // one model for every shard: the same bodies
    ...(first.bodies ? { bodies: first.bodies } : {}),
    pairCount: first.pairCount,
    pairsPrescreened: results.reduce((s, r) => s + r.pairsPrescreened, 0),
    bvhMs: Math.max(...results.map(r => r.bvhMs)),
    sweepMs: Math.max(...results.map(r => r.sweepMs)),
    truncated,
    ...(from < Infinity ? { incompleteFrom: from } : {}),
    shards: results.length,
    // a range sweep: every shard starts at the same point; each reports the
    // boundary contacts of its own pairs
    ...(first.range ? { range: first.range } : {}),
    ...(results.some(r => r.boundaryContacts) ? { boundaryContacts: results.flatMap(r => r.boundaryContacts ?? []) } : {}),
  };
}

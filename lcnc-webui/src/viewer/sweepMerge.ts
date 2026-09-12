// Merge a sweep of the ENTRY SEGMENT (the rapid from the machine's live
// position to the program's first point, swept as its own two-point track)
// with the program's own sweep (2026-09-12). Sim entry used to re-sweep the
// whole program for that one new segment.
//
// Two baselines, stated rather than hidden: the entry sweep's static
// contacts are the pairs already touching at the LIVE pose, the base
// sweep's those touching at the program's first point. Both lists are
// reported (union by pair). Hit cums of the base result shift by the entry
// segment's length (`shift` = the entry track's cum at the first point) so
// every cum lives on the ENTRY track's axis. Pure.
import type { CollisionHit, CollisionResult } from "./collision";

export function mergeEntryResult(entry: CollisionResult, base: CollisionResult, shift: number): CollisionResult {
  const shifted: CollisionHit[] = base.hits.map(h => ({
    ...h,
    cum: h.cum + shift,
    cumEnd: h.cumEnd + shift,
    intervals: h.intervals?.map(iv => [iv[0] + shift, iv[1] + shift] as [number, number]),
  }));
  const hits = [...entry.hits, ...shifted].sort((x, y) => x.cum - y.cum);
  const seen = new Set<string>();
  const staticContacts: CollisionResult["staticContacts"] = [];
  for (const c of [...entry.staticContacts, ...base.staticContacts]) {
    const key = `${c.a}/${c.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    staticContacts.push(c);
  }
  return {
    hits,
    staticContacts,
    samples: entry.samples + base.samples,
    coarsened: entry.coarsened || base.coarsened,
    uncertified: entry.uncertified ?? base.uncertified,
    pairCount: base.pairCount,
    bvhMs: entry.bvhMs + base.bvhMs,
    sweepMs: entry.sweepMs + base.sweepMs,
    // The entry segment is always swept whole; only the base can be partial.
    truncated: base.truncated,
  };
}

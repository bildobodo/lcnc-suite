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

export function mergeEntryResult(entry: CollisionResult, base: CollisionResult, shift: number, baseLen: number): CollisionResult {
  const shifted: CollisionHit[] = base.hits.map(h => ({
    ...h,
    cum: h.cum + shift,
    cumEnd: h.cumEnd + shift,
    intervals: h.intervals?.map(iv => [iv[0] + shift, iv[1] + shift] as [number, number]),
    ...(h.spanCumEnd !== undefined ? { spanCumEnd: h.spanCumEnd + shift } : {}),
  }));
  // ONE contact seen by both sweeps (operator-caught 2026-09-12 as "two
  // clashes"): an entry onset still in contact at the entry's end and a base
  // onset for the same pair from the program's first point (the base seeds
  // a pair clear at rest but touching at the first pose) are the same
  // contact. The entry record stays the onset and takes the base's span; the
  // base's first-line record becomes its continuation (line 0 = the entry
  // move), so the count reads one clash while every line keeps its record
  // for the tint and the code-panel marks.
  const CONTACT = 1e-3;
  const tol = 1e-3 * Math.max(1, shift);
  const entryHits: CollisionHit[] = entry.hits.map(h => ({ ...h }));
  for (const e of entryHits) {
    if (e.continuation !== undefined || e.dist > CONTACT || e.cumEnd < shift - tol) continue;
    const bi = shifted.findIndex(b => b.continuation === undefined && b.dist <= CONTACT
      && b.a === e.a && b.b === e.b && b.cum - shift <= tol);
    if (bi < 0) continue;
    const b = shifted[bi]!;
    const end = b.spanCumEnd ?? b.cumEnd;
    if (end > e.cumEnd) e.spanCumEnd = end;
    e.spanEndLine = b.spanEndLine ?? b.line;
    shifted[bi] = { ...b, continuation: e.line };
  }
  const hits = [...entryHits, ...shifted].sort((x, y) => x.cum - y.cum);
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
    pairsPrescreened: base.pairsPrescreened,
    bvhMs: entry.bvhMs + base.bvhMs,
    sweepMs: entry.sweepMs + base.sweepMs,
    truncated: mergedTruncated(entry.truncated, base.truncated, shift, baseLen),
  };
}

/** The merged result's `truncated`, as a conservative checked PREFIX of the
 *  merged axis (entry length `shift` + base length `baseLen`) — the shape
 *  the timeline band and the "N % swept" wording consume (TWP-12, review
 *  2026-09-14: the entry's own truncation was dropped, and a base fraction
 *  was reported on the wrong axis). A partial entry ends the prefix inside
 *  the entry move (the base's coverage is NOT credited past a gap — the
 *  checked region [0, covered·shift] ∪ [shift, …] is not a prefix); a
 *  complete entry followed by a partial base rescales the base fraction
 *  onto the merged axis. Both complete → null. Pure. */
export function mergedTruncated(
  entry: CollisionResult["truncated"], base: CollisionResult["truncated"],
  shift: number, baseLen: number,
): CollisionResult["truncated"] {
  const total = Math.max(0, shift) + Math.max(0, baseLen);
  if (entry) {
    const covered = total > 0 ? (Math.min(1, Math.max(0, entry.covered)) * Math.max(0, shift)) / total : 0;
    return { covered, reason: entry.reason };
  }
  if (base) {
    const covered = total > 0 ? (Math.max(0, shift) + Math.min(1, Math.max(0, base.covered)) * Math.max(0, baseLen)) / total : 0;
    return { covered, reason: base.reason };
  }
  return null;
}

/** The timeline's swept-band fraction on the DISPLAYED track. Sweep values
 *  are BASE-relative (the running progress, the parked `covered`) unless
 *  they were already merged onto the entry axis (a merged result's
 *  `truncated`, see mergedTruncated). `shift`/`baseMax` re-base the former;
 *  `cumMax` is the displayed track's length. Pure. */
export function mergedSweptFraction(
  f: number, alreadyMerged: boolean, shift: number, baseMax: number, cumMax: number,
): number {
  if (!(cumMax > 0)) return 0;
  const out = alreadyMerged ? f : (shift + f * baseMax) / cumMax;
  return Math.min(1, Math.max(0, out));
}

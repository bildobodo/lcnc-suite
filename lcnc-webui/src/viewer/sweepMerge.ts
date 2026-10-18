// Merge a sweep of the ENTRY SEGMENT (the rapid from the machine's live
// position to the program's first point, swept as its own two-point track)
// with the program's own sweep (2026-09-12). Sim entry used to re-sweep the
// whole program for that one new segment.
//
// What the two sweeps FOUND is their contact tables' — one contact seen by
// both is joined there (contactMerge.ts, step 4 package 2). Their results'
// METADATA merges here. Two baselines, stated rather than hidden: the entry
// sweep's static contacts are the pairs already touching at the LIVE pose,
// the base sweep's those touching at the program's first point. Both lists
// are reported (union by pair). Pure.
import { unitedNotes, type CollisionResult } from "./collision";

export function mergeEntryResult(entry: CollisionResult, base: CollisionResult, shift: number, baseLen: number): CollisionResult {
  const seen = new Set<string>();
  const staticContacts: CollisionResult["staticContacts"] = [];
  for (const c of [...entry.staticContacts, ...base.staticContacts]) {
    const key = `${c.a}/${c.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    staticContacts.push(c);
  }
  return {
    staticContacts,
    samples: entry.samples + base.samples,
    coarsened: entry.coarsened || base.coarsened,
    // Both sweeps' statements: the entry move's never hide the program's.
    ...unitedNotes([entry, base]),
    pairCount: base.pairCount,
    pairsPrescreened: base.pairsPrescreened,
    // one model for both sweeps
    ...((base.bodies ?? entry.bodies) ? { bodies: base.bodies ?? entry.bodies } : {}),
    bvhMs: entry.bvhMs + base.bvhMs,
    sweepMs: entry.sweepMs + base.sweepMs,
    truncated: mergedTruncated(entry.truncated, base.truncated, shift, baseLen),
  };
}

/** A run check's bound beginning (docs/reviews/parity-ef.plan.md E5/E7)
 *  merged onto the BASE track's axis: the run is displayed on the base,
 *  where the beginning has no duration (its contacts fold onto the base's 0
 *  in the contact view). The side sweep `side` covers the entry move and the
 *  beginning bound to the run's start joints (axis of the bound track, the
 *  base's point K at `shift`). The base result's `startDependent` is
 *  answered by it and dropped. Pure. */
export function mergeBeginningOntoBase(side: CollisionResult, base: CollisionResult, shift: number, baseLen: number): CollisionResult {
  const m = mergeEntryResult(side, base, shift, baseLen);
  return {
    ...m,
    // a side sweep cut short leaves the beginning partly unchecked: nothing
    // on the base axis is a checked prefix then
    truncated: side.truncated ? { covered: 0, reason: side.truncated.reason } : base.truncated,
    // the base's range and boundary contacts are on the base axis already
    // and stay what they were (Codex R133 VP-I87): a bound beginning checks
    // [0, K], never the stretch between K and a range that starts later
    ...(base.range ? { range: base.range } : {}),
    ...(base.boundaryContacts ? { boundaryContacts: base.boundaryContacts } : {}),
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

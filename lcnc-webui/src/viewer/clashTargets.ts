import type { CollisionHit } from "./collision";

/** One navigation/mark target of the scrub bar's clash surface. */
export interface ClashTarget {
  cum: number;
  line: number;
  rapid?: boolean;
  dist?: number;
  spanEndLine?: number;
  /** A second (or later) contact interval on the SAME line/pair — a real
   *  re-entry, flagged so two stops on one line read as intended. */
  reentry?: boolean;
}

/**
 * ONE derivation for the scrub bar's clash COUNT, timeline MARKS and prev/next
 * NAVIGATION. 2026-09-03: the count read onset RECORDS while marks and nav read
 * per-INTERVAL targets — "one clash reported, two marks on the timeline".
 * Onset records only (a continuation is the same contact carried across
 * lines); one target per refined contact interval; a near-miss (no intervals)
 * once at its closest approach. Cum-sorted. Pure; unit-tested.
 */
export function clashTargets(hits: readonly CollisionHit[]): ClashTarget[] {
  const out: ClashTarget[] = [];
  for (const h of hits) {
    if (h.continuation !== undefined) continue;
    const ivs = h.intervals ?? [[h.cum, h.cumEnd] as [number, number]];
    for (let k = 0; k < ivs.length; k++) {
      const t: ClashTarget = { cum: ivs[k]![0], line: h.line, rapid: h.rapid, dist: h.dist, spanEndLine: h.spanEndLine };
      if (k > 0) t.reentry = true;
      out.push(t);
    }
  }
  return out.sort((a, b) => a.cum - b.cum);
}

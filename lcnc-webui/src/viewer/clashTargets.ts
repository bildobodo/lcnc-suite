import type { CollisionHit } from "./collision";

/** One navigation/mark target of the scrub bar's clash surface. */
export interface ClashTarget {
  cum: number;
  /** Where this contact interval ends (a near-miss: its closest approach) —
   *  a jump samples inside [cum, cumEnd] (viewer/findingNav.ts). */
  cumEnd: number;
  /** Names the interval for prev/next: origin, line, pair, interval — the
   *  entry move's contacts (`E`) apart from the program's (`C`), whose keys
   *  stay the same when the entry result is merged in (Codex R33 VP-I07). */
  key: string;
  /** A contact on the ENTRY MOVE (the simulation's rapid to the first
   *  point), not on a program line. */
  entry?: boolean;
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
 * lines, and so is an onset's `carried` first interval); one target per
 * refined contact interval; a near-miss (no intervals)
 * once at its closest approach. Cum-sorted. Pure; unit-tested.
 */
export function clashTargets(hits: readonly CollisionHit[]): ClashTarget[] {
  const out: ClashTarget[] = [];
  for (const h of hits) {
    if (h.continuation !== undefined) continue;
    const ivs = h.intervals ?? [[h.cum, h.cumEnd] as [number, number]];
    // A carried first interval is an earlier finding's contact (Codex R34
    // VP-I09); the later intervals keep their index, so their keys are the
    // same with and without the entry result merged in.
    for (let k = h.carried ? 1 : 0; k < ivs.length; k++) {
      const t: ClashTarget = { cum: ivs[k]![0], cumEnd: ivs[k]![1],
        key: `${h.entry ? "E" : "C"}${h.line}|${h.a}|${h.b}|${k}`,
        line: h.line, rapid: h.rapid, dist: h.dist, spanEndLine: h.spanEndLine };
      if (h.entry) t.entry = true;
      if (k > 0) t.reentry = true;
      out.push(t);
    }
  }
  return out.sort((a, b) => a.cum - b.cum);
}

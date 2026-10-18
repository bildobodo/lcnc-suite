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
  /** …and began on the entry move itself (not on the bound beginning). */
  entryMove?: boolean;
  /** Its DISPLAY line (plan 1.3); 0 with `noLine` when it has none. */
  line: number;
  /** No line to show (plan 1.3, C3): untrusted and outside any call span —
   *  never its raw line; no code mark. `subName` names its subroutine. */
  noLine?: boolean;
  subName?: string;
  rapid?: boolean;
  dist?: number;
  /** A near miss by the sweep's own class (contactView: a stay inside the
   *  margin without a touch interval — plan 4.1: one class, the sweep's).
   *  Absent on a target built by hand: the 1e-3 distance test decides
   *  (`isNearMiss`). */
  near?: boolean;
  /** The onset of a contact the program STARTS in (the view's T_AT_START). */
  atStart?: boolean;
  spanEndLine?: number;
  /** A second (or later) contact interval on the SAME line/pair — a real
   *  re-entry, flagged so two stops on one line read as intended. */
  reentry?: boolean;
  /** The body pair (tool side, work side) — the Simulation tab names it. */
  a: string;
  b: string;
  /** On a probe's braking range (the view's T_POSSIBLE): the contact MAY
   *  happen — never a certain one. */
  possible?: boolean;
  /** A near miss of the check's earlier run (a pool that fell back to one
   *  core, plan 3.5) the run since did not find again: "from the earlier run". */
  earlier?: boolean;
}

/** A near miss: by the sweep's class where the target carries it (every
 *  target of the contact view), else the distance test. */
export const isNearMiss = (t: ClashTarget): boolean =>
  t.near ?? (t.dist ?? 0) > 1e-3;


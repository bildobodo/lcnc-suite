// Where a soft-limit record stands on the timeline (Codex R177 VP-I130).
//
// The gateway reports a violation by the RAW line number of the file the move
// ran in — a called file's own numbering — so a line number names no place:
// a subroutine's L5 and the main program's L5 are one number. Each record
// carries its origin (`sub` / `site`, absent = the main program) and its
// violating stretches as seq runs; the place, the line and the bands come
// from those moves:
//
// - a run is found on the BASE track by seq (the canon's seq of the segment
//   ending at a point) and read on the DISPLAYED one (cumReader: the entry
//   move only prepends points — Codex R33 VP-I05);
// - its extent runs from the point before its first segment (where that move
//   STARTS) to the end of its last;
// - the line is the DISPLAY line at the first violating point (displayLineOf,
//   C3 — the one rule for findings): a called file's move reads its call line,
//   an untrusted move without one its subroutine's name, else none;
// - a record without runs (a payload from before them), or whose runs this
//   track does not hold, has NO place: listed without a jump, a band or a
//   mark (Codex R177 answer 1).
import type { LimitViolation, ScrubTrack } from "../ws/bulkData";
import { cumReader, displayLineForPoint } from "./scrubTrack";

/** One row of limit violations: the records of one origin and raw line (its
 *  axes together), placed at its earliest violating move. */
export interface LimitTarget {
  key: string;
  /** The display line at its place; 0 = no line of the program shows it. */
  line: number;
  /** The first violating move's extent on the displayed track. */
  cum: number;
  cumEnd: number;
  recs: LimitViolation[];
  /** No line of the program shows the move (`line` 0): its subroutine's
   *  name where it has one. */
  noLine?: boolean;
  subName?: string;
}

export interface LimitPlaces {
  /** By position. */
  targets: LimitTarget[];
  /** The violating stretches on the displayed track's axis, [start, end]. */
  bands: Array<[number, number]>;
  /** Groups with no place (see the head). */
  placeless: LimitViolation[][];
}

/** The line of THIS program a record's move ran under, for the code panel's
 *  mark: the main program's own line, a marked subroutine's verified call
 *  line, else none — never a called file's raw number. */
export function limitRecordLine(v: LimitViolation): number | null {
  const line = v.sub != null ? v.site ?? 0 : v.line;
  return line > 0 ? line : null;
}

const groupKey = (v: LimitViolation) => `${v.sub ?? ""}\u0000${v.sub != null ? v.site ?? 0 : 0}\u0000${v.line}`;

/** The first index whose seq is >= q (count when none). */
function lowerBound(seq: Uint32Array, q: number): number {
  let lo = 0, hi = seq.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (seq[mid]! < q) lo = mid + 1; else hi = mid; }
  return lo;
}

/** The records' places on `on`, found on `base` (the track `on` was built
 *  from by prepending). `trusted` = the payload's lines are trusted wholesale
 *  (not `lines_untrusted`). Pure. */
export function limitPlaces(violations: readonly LimitViolation[] | null | undefined, base: ScrubTrack | null,
                            on: ScrubTrack | null, trusted: boolean): LimitPlaces {
  const out: LimitPlaces = { targets: [], bands: [], placeless: [] };
  if (!violations?.length) return out;
  const groups = new Map<string, LimitViolation[]>();
  for (const v of violations) {
    const k = groupKey(v), g = groups.get(k);
    if (g) g.push(v); else groups.set(k, [v]);
  }
  const at = base && on ? cumReader(base, on) : null;
  const seq = base?.seq;
  for (const recs of groups.values()) {
    let first: { i: number; q: number } | null = null;
    if (at && seq && base) {
      for (const v of recs) {
        for (const [r0, r1] of v.runs ?? []) {
          const i0 = lowerBound(seq, r0);
          if (i0 >= seq.length || seq[i0]! > r1) continue;   // not on this track
          const i1 = lowerBound(seq, r1 + 1) - 1;
          const a = at(Math.max(0, i0 - 1)), b = at(i1);
          if (b > a) out.bands.push([a, b]);
          if (!first || r0 < first.q) first = { i: i0, q: r0 };
        }
      }
    }
    if (!first || !at || !base) { out.placeless.push(recs); continue; }
    const { i } = first;
    const shown = displayLineForPoint(base, i, trusted);
    const t: LimitTarget = { key: `L${shown.line ?? 0}@${first.q}`, line: shown.line ?? 0,
                             cum: at(Math.max(0, i - 1)), cumEnd: at(i), recs };
    if (shown.line == null) {
      t.noLine = true;
      if (shown.subName) t.subName = shown.subName;
    }
    out.targets.push(t);
  }
  out.targets.sort((a, b) => a.cum - b.cum);
  out.bands.sort((a, b) => a[0] - b[0]);
  return out;
}

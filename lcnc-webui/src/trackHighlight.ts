// Track-index highlight channel (review P3).
//
// The 3D toolpath highlight used to follow `motion_line`, which is
// sub/remap-relative and collides with the main file's numbering — the
// highlight parked on unrelated stretches of path. The positional playhead
// (ScrubBar) knows the TRACK segment the machine is actually on; this
// module-scope ref carries that answer to ThreeViewer without prop
// drilling (same pattern as simMode.ts — client-local shared state).
//
// Value: [startIdx, endIdx] — the contiguous same-line run of track
// segments around the live/scrub position (scrubTrack.lineRunAround), or
// null when nothing positional is active (idle, legacy track) — consumers
// then fall back to the line-number path, suppressed when the payload's
// line attribution is untrusted.
import { shallowRef } from "vue";
import { lineMaskHas } from "./viewer/lineIndex";

export const trackHighlightRange = shallowRef<[number, number] | null>(null);

/** Text-panel line state from the positional run playhead (W2 P6): what
 *  the playhead's matched track point says about the CURRENT line.
 *  `trusted` = the point's line number belongs to this file and may be
 *  highlighted (per-point wire trust; legacy tracks fall back to the
 *  wholesale lines_untrusted flag); `subName` = the marked subroutine the
 *  point sits in (the UI shows "in subroutine (name)" instead of a
 *  colliding line). OFF-PATH publishes { line: 0, trusted: false } — the
 *  highlight must suppress, never fall back to motion_line's colliding
 *  numbers. Null only when no positional playhead is active at all (idle;
 *  sim drives GcodePanel via scrubLine) — App.vue then falls back to the
 *  motion_line path gated by the wholesale untrusted flag. `atEnd` (W3
 *  P4): the playhead sits pinned at the track's terminal vertex — the
 *  readout says "end" instead of freezing on the last attributable line
 *  (trailing non-motion lines like M2 are unknowable, never guessed —
 *  except the W5 unique program-end line, which the atEnd publication
 *  carries in `line`). `line` is always the GATED display line — W4:
 *  inside an attributed sub span it is the sub's CALL/trigger line
 *  (`viaCall: true`), never the raw colliding sub-file number. `offPath`
 *  (W5) marks the frozen-playhead publication so resolveCurrentLine can
 *  apply the text-trusted motion_line rescue; `subLine` (W5) is the RAW
 *  sub-file lineno while inside a marked span — the indented sub view's
 *  highlight, meaningless against the main file. */
export interface RunLineState {
  line: number; trusted: boolean; subName: string | null;
  atEnd?: boolean; viaCall?: boolean; offPath?: boolean;
  subLine?: number | null;
}
export const runLineState = shallowRef<RunLineState | null>(null);

/** Marked-subroutine execution state for the inline indent view (W5):
 *  published by BOTH the run playhead and the sim scrub whenever the
 *  matched point sits in a marked span with an attributed call line;
 *  null otherwise (and on run end / sim exit). GcodePanel expands the
 *  sub's source under `callLine` and highlights its own `subLine`. */
export const subExecState = shallowRef<{
  name: string; subLine: number; callLine: number;
} | null>(null);

/** THE text-panel line precedence chain (W5 — the display spec's single
 *  implementation; see docs/decisions.md wave 5 for the table):
 *  1. a trusted positional playhead state wins (own line / W4 call line /
 *     W5 end line);
 *  2. OFF-PATH while running: the live motion_line displays iff the
 *     track's per-point trust vouches for that main-file line (the
 *     approach executing "line 4" park→first-vertex — the interp names
 *     the line, the text verifies it). Known bounded residual: a marked
 *     sub executing off-path reports ITS file's linenos, which display
 *     iff they collide with a trusted main line;
 *  3. any other positional state (on-path untrusted span) suppresses —
 *     the chip/indent view carries the information instead;
 *  4. no positional playhead while running: per-line gate when the track
 *     carries trust, else the legacy wholesale flag;
 *  5. NOT running: never display — motion_line is a stale motion-queue id
 *     after a program ends (LinuxCNC keeps the last executed segment's id
 *     until a state transition resets it; the observed stale blank-line-8
 *     highlight was square.ngc's own line 8). */
export function resolveCurrentLine(o: {
  rls: RunLineState | null;
  running: boolean;
  motionLine: number | null | undefined;
  linesUntrusted: boolean;
  /** Bitmap over line numbers (viewer/lineIndex.ts lineMaskHas) — one
   *  byte per line instead of a Set entry per trusted line. */
  trustedLines: Uint8Array | null;
}): number | null {
  const ml = o.motionLine ?? 0;
  if (o.rls) {
    if (o.rls.trusted) return o.rls.line;
    if (o.rls.offPath && o.running && ml > 0 && lineMaskHas(o.trustedLines, ml)) return ml;
    return null;
  }
  if (!o.running || ml <= 0) return null;
  if (o.trustedLines) return lineMaskHas(o.trustedLines, ml) ? ml : null;
  return o.linesUntrusted ? null : ml;   // legacy track — wholesale gate
}

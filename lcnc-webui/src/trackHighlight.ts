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
 *  (trailing non-motion lines like M2 are unknowable, never guessed).
 *  `line` is always the GATED display line — W4: inside an attributed sub
 *  span it is the sub's CALL/trigger line (`viaCall: true`), never the
 *  raw colliding sub-file number. */
export const runLineState = shallowRef<{
  line: number; trusted: boolean; subName: string | null;
  atEnd?: boolean; viaCall?: boolean;
} | null>(null);

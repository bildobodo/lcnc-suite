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

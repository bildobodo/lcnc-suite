// The code panel's tool-change marks (operator 2026-11-01: "wie schaut das
// mit dem punkt für die werkzeugwechsel aus? … in der spalte im
// programmcode"): the lines of the timeline's tool-change targets — the
// wire's canon M6 lines and the text's M6 / M600 / M601 lines the track
// places (ScrubBar's toolTargets) — the same that carry a ● on the timeline
// and a row in the Sim tab; each with the tool it loads (0 = not named). The
// bar publishes; GcodePanel reads.
import { shallowRef } from "vue";

export type ToolMarks = ReadonlyMap<number, number>;
export const NO_TOOL_MARKS: ToolMarks = new Map();
export const toolMarks = shallowRef<ToolMarks>(NO_TOOL_MARKS);

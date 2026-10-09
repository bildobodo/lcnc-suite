// Where the run stands on the displayed track (plan „Prüfung im Lauf“ 3b):
// ScrubBar's run watcher publishes the segment it projected the machine onto
// while it is ATTACHED; the check during a run reads it ONCE, when it plans,
// as the provisional check's start (the hint). A hint, never a proof: it
// excludes nothing — the full check from the program's start follows.
import { shallowRef } from "vue";
import type { ScrubTrack } from "../ws/bulkData";

/** The track the position was projected onto and the index of the segment
 *  (the vertex it ends at); null off path, at idle or while simulating. */
export const runPlayhead = shallowRef<{ track: ScrubTrack; index: number } | null>(null);

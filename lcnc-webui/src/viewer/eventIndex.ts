// Seq-keyed event resolution shared by the three per-vertex event channels
// (TWP frames, WCS epochs, TLO/tool events): an event at seq N governs
// vertices with seq > N (STRICT); same-seq ties resolve to the LAST recorded
// event; vertices before any event take the channel's fill value.
//
// 32-bit indices (TWP-05, review 2026-09-14): the u8 arrays capped every
// index at 0xfe, so a program with more than 254 events on a channel — a
// multi-fixture program alternating G54..G57 per operation crosses it in
// about 64 operations, a long multi-tool program with its G43/M6 rows — posed
// everything after the cap with event 254's frame / fixture / tool, silently.
// Widened by construction (Uint32Array, one sentinel) rather than given a
// second, larger overflow branch. Same precedent as lineIndex.ts NO_LINE.

/** "No event governs this vertex" fill for the frame and TLO channels (the
 *  WCS channel fills 0: epoch 0 is a real epoch, the parse-time basis). */
export const EVENT_NONE = 0xffffffff;

/** Per-vertex index of the governing event, or `none`. O(V + E): per-stream
 *  `seq` is ascending by construction (gcode_canon's global counter; relabel
 *  inserts and RDP keep the order), so one forward pointer over the events
 *  sorted by seq resolves every vertex. A vertex that arrives out of order
 *  (a foreign or legacy stream) is resolved on its own by binary search —
 *  correct either way, never silently wrong. */
export function eventIdxFor(
  seq: Uint32Array | undefined, eventSeqs: readonly number[] | undefined, none: number,
): Uint32Array | undefined {
  if (!eventSeqs?.length || !seq) return undefined;
  // Stable sort on seq alone keeps recorded order among equal seqs, so the
  // last of a tie is the last recorded.
  const evs = eventSeqs.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Uint32Array(seq.length).fill(none);
  let p = 0;            // evs[p] is the first event not yet known to govern
  let last = none;      // index of the last event with es < the current seq
  let prevSeq = -1;
  for (let v = 0; v < seq.length; v++) {
    const sv = seq[v]!;
    if (sv < prevSeq) {
      let lo = 0, hi = evs.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (evs[mid]![0] < sv) lo = mid + 1; else hi = mid; }
      out[v] = lo > 0 ? evs[lo - 1]![1] : none;
      continue;
    }
    while (p < evs.length && evs[p]![0] < sv) { last = evs[p]![1]; p++; }
    out[v] = last;
    prevSeq = sv;
  }
  return out;
}

// The scrub track as the collision worker gets it (VP188-02 N1, plan
// basiswechsel-last 4): every column is COPIED — the viewer and the scrub bar
// keep reading the originals, so those are never transferred — and every
// copy is TRANSFERRED: a copy left out of the transfer list was cloned a
// second time by postMessage (up to ~14 MB twice on a 600 000-point track,
// at every restart of the check). Each buffer once: a buffer listed twice
// makes postMessage throw (DataCloneError).
import type { ScrubTrack } from "./scrubTrack";

export function copyTrackForWorker(track: ScrubTrack) {
  const trackCopy = {
    pos: track.pos.slice(), abc: track.abc.slice(), lines: track.lines.slice(),
    rapid: track.rapid.slice(), cum: track.cum.slice(), count: track.count,
    mode: track.mode?.slice(),  // raw switchkins types — the sweep poses per segment
    frame: track.frame?.slice(),  // TWP frame indices (+ triplets below)
    frames: track.frames,         // small list — structured-cloned, not transferred
    brk: track.brk?.slice(),      // kins-flip relabel flags — excluded from the sweep
    ustart: track.ustart?.slice(), // unknown starts — named in the result, never assumed swept
    depEnd: track.depEnd,          // the start-dependent beginning: baseline at K, named (plan E7)
    startUnbound: track.startUnbound,   // ...and named not checkable when no start binds (VP-I84)
    dep: track.dep?.slice(),       // ...and where it lies on a bound track
    wcs: track.wcsEpoch?.slice(), // per-segment WCS epoch (terms in options below)
    tlo: track.tlo?.slice(),      // per-segment TLO/tool event (events in options below)
    unpredicted: track.unpredicted?.slice(),  // after an unpredicted tool measurement (M600)
    band: track.band?.slice(),    // a probe's braking range: contacts there only `possible`
    cond: track.cond?.slice(),    // after a predicted measurement: the path is conditional
    lineOk: track.lineOk?.slice(), sub: track.sub?.slice(), cline: track.cline?.slice(),  // the lines a note names
  };
  const own = [trackCopy.pos, trackCopy.abc, trackCopy.lines, trackCopy.rapid, trackCopy.cum, trackCopy.mode,
               trackCopy.frame, trackCopy.brk, trackCopy.ustart, trackCopy.dep, trackCopy.wcs, trackCopy.tlo,
               trackCopy.unpredicted, trackCopy.band, trackCopy.cond, trackCopy.lineOk, trackCopy.sub, trackCopy.cline];
  // ArrayBuffer[] (not Transferable[]): every entry is a buffer
  const transfer = [...new Set(own.flatMap(a => (a ? [a.buffer as ArrayBuffer] : [])))];
  return { trackCopy, transfer, copies: own.filter(a => a).length };
}

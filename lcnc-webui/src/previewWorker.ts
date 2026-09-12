// Off-main-thread G-code preview loader (P4.1 / handoff step 6).
//
// Loading a heavy program used to fetch + msgpack-decode the multi-MB preview AND
// flatten its nested point arrays on the MAIN thread, blocking it for seconds —
// which starved the heartbeat worker and tripped a client-heartbeat disarm on
// load. This worker does the fetch, the decode, and the nested→flat conversion
// off-thread, then transfers the resulting typed arrays back zero-copy. The main
// thread (ThreeViewer) builds BufferAttributes directly from them — no decode, no
// points.flat(), no per-point allocation on the UI thread.
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { buildScrubTrack, splitTrackStreams } from "./viewer/scrubTrack";
import { buildLodLevels } from "./viewer/lineChunks";
import { decodePreviewStreams } from "./previewDecode";
import { buildLineIndex, lineIndexTransferables } from "./viewer/lineIndex";

interface Req { version: number; url: string }

// Newest-version-wins: abort any in-flight fetch when a newer preview arrives, so a
// superseded version no longer burns network + decode CPU (review #2). The main
// thread already discards stale *results* via a version guard; this stops the *work*.
let _currentAbort: AbortController | null = null;

self.onmessage = async (e: MessageEvent<Req>) => {
  const { version, url } = e.data;
  if (_currentAbort) _currentAbort.abort();
  const ac = new AbortController();
  _currentAbort = ac;
  try {
    const resp = await fetch(url, { signal: ac.signal });
    if (!resp.ok) {
      self.postMessage({ version, error: `HTTP ${resp.status}` });
      return;
    }
    const buf = await resp.arrayBuffer();
    if (ac.signal.aborted) return;  // superseded during the read — skip the decode
    const g = msgpackDecode(new Uint8Array(buf)) as Record<string, any>;

    // Payload → typed stream inputs: ONE decode source (previewDecode.ts),
    // shared with the sim-vs-actual gate harness (W6). Scrub track (stage
    // 2): merge feed+rapid into execution order off-thread — O(points),
    // exactly the class of work that starved the heartbeat on the UI
    // thread. null = unbuildable (empty / stale pre-seq cached payload)
    // and the scrub bar simply doesn't offer itself.
    const d = decodePreviewStreams(g);
    let { feedPos, rapidPos, feedLines, feedAbc, rapidAbc } = d;
    const { kinsFrames, wcsEvents, tloEvents } = d;
    const scrubTrack = buildScrubTrack(d.feed, d.rapid, kinsFrames, wcsEvents, d.subNames, tloEvents, d.rotaryCmd);

    // Drawn-preview streams re-derived from the merged track (sectioned, with
    // break indices) — the raw endpoint strips draw FALSE connectors across
    // stream interleaves (a feed after a G0 lift appeared to start pre-lift;
    // the lift itself was never drawn). Track-less legacy payloads keep the
    // old strips: no seq → no honest interleaving, degrade like the scrub bar.
    let feedBreaks: Uint32Array | undefined;
    let rapidBreaks: Uint32Array | undefined;
    let feedMode: Uint8Array | undefined;
    let rapidMode: Uint8Array | undefined;
    let feedFrame: Uint8Array | undefined;
    let rapidFrame: Uint8Array | undefined;
    let feedWcs: Uint8Array | undefined;
    let rapidWcs: Uint8Array | undefined;
    let feedTlo: Uint8Array | undefined;
    let rapidTlo: Uint8Array | undefined;
    // Outside-limits flags (2026-09-12): through the track split when there
    // is a track, else the wire arrays as they are (legacy strips).
    let feedOutside: Uint8Array | undefined = d.feed.outside;
    let rapidOutside: Uint8Array | undefined = d.rapid.outside;
    let feedSrc: Uint32Array | undefined;
    let rapidSrc: Uint32Array | undefined;
    if (scrubTrack) {
      const hadAbc = feedAbc != null || rapidAbc != null;
      const split = splitTrackStreams(scrubTrack);
      feedPos = split.feedPos; feedLines = split.feedLines; feedBreaks = split.feedBreaks;
      rapidPos = split.rapidPos; rapidBreaks = split.rapidBreaks;
      // Section starts inherit the other stream's abc, so both rebuilt
      // streams carry abc whenever either original did.
      feedAbc = hadAbc ? split.feedAbc : undefined;
      rapidAbc = hadAbc ? split.rapidAbc : undefined;
      feedMode = split.feedMode; rapidMode = split.rapidMode;
      feedFrame = split.feedFrame; rapidFrame = split.rapidFrame;
      feedWcs = split.feedWcs; rapidWcs = split.rapidWcs;
      feedTlo = split.feedTlo; rapidTlo = split.rapidTlo;
      feedOutside = split.feedOutside; rapidOutside = split.rapidOutside;
      feedSrc = split.feedSrc;
      rapidSrc = split.rapidSrc;
    }
    // Typed line index instead of a Map (viewer/lineIndex.ts): transferred,
    // not cloned — the Map clone alone was 0.9 s per publish on 1.18 M lines.
    const feedLineIndex = buildLineIndex(feedLines ?? g.feed_lines);
    const rapidDist = _lineDistances(rapidPos);  // dashed rapid line's lineDistance (P4.1)
    // Display LOD levels over the drawn vertices (viewer/lineChunks.ts): the
    // programmed path draws these arrays as they are, so its levels are cut
    // here. Runs break at the section breaks; a room/table flip (decided on
    // the main thread) is not known here — the renderer drops any level pair
    // whose endpoints differ in frame.
    const _tLod = performance.now();
    const { feedLod, rapidLod, lodTols } = buildLodLevels(feedPos, feedBreaks, rapidPos, rapidBreaks);
    const lodMs = Math.round(performance.now() - _tLod);

    // Drop the nested arrays from the passthrough; the flat typed arrays replace
    // them. Everything else (file, stats fields) is small and cloned as-is.
    const { feed: _f, rapid: _r, feed_lines: _fl, feed_abc: _fa, rapid_abc: _ra,
            feed_seq: _fs, rapid_seq: _rs, rapid_lines: _rl,
            feed_tcum: _ft, rapid_tcum: _rt,
            feed_kinstype: _fm, rapid_kinstype: _rm, rapid_brk: _rb,
            rapid_ustart: _ru,
            feed_lineok: _fo, rapid_lineok: _ro, feed_sub: _fsb, rapid_sub: _rsb,
            feed_outside: _fou, rapid_outside: _rou,
            feed_cline: _fc, rapid_cline: _rc,
            ...rest } = g;

    const transfer: Transferable[] = [
      feedPos.buffer as ArrayBuffer,
      rapidPos.buffer as ArrayBuffer,
      rapidDist.buffer as ArrayBuffer,
    ];
    if (feedLines) transfer.push(feedLines.buffer as ArrayBuffer);
    if (feedAbc) transfer.push(feedAbc.buffer as ArrayBuffer);
    if (rapidAbc) transfer.push(rapidAbc.buffer as ArrayBuffer);
    if (feedBreaks) transfer.push(feedBreaks.buffer as ArrayBuffer);
    if (rapidBreaks) transfer.push(rapidBreaks.buffer as ArrayBuffer);
    transfer.push(...lineIndexTransferables(feedLineIndex));
    if (scrubTrack) {
      transfer.push(
        scrubTrack.pos.buffer as ArrayBuffer, scrubTrack.abc.buffer as ArrayBuffer,
        scrubTrack.lines.buffer as ArrayBuffer, scrubTrack.rapid.buffer as ArrayBuffer,
        scrubTrack.cum.buffer as ArrayBuffer,
        ...lineIndexTransferables(scrubTrack.lineIndex),
      );
      if (scrubTrack.mode) transfer.push(scrubTrack.mode.buffer as ArrayBuffer);
      if (scrubTrack.frame) transfer.push(scrubTrack.frame.buffer as ArrayBuffer);
      if (scrubTrack.brk) transfer.push(scrubTrack.brk.buffer as ArrayBuffer);
      if (scrubTrack.wcsEpoch) transfer.push(scrubTrack.wcsEpoch.buffer as ArrayBuffer);
      if (scrubTrack.tlo) transfer.push(scrubTrack.tlo.buffer as ArrayBuffer);
      if (scrubTrack.lineOk) transfer.push(scrubTrack.lineOk.buffer as ArrayBuffer);
      if (scrubTrack.sub) transfer.push(scrubTrack.sub.buffer as ArrayBuffer);
      if (scrubTrack.cline) transfer.push(scrubTrack.cline.buffer as ArrayBuffer);
      if (scrubTrack.ustart) transfer.push(scrubTrack.ustart.buffer as ArrayBuffer);
    }
    if (feedMode) transfer.push(feedMode.buffer as ArrayBuffer);
    if (rapidMode) transfer.push(rapidMode.buffer as ArrayBuffer);
    if (feedFrame) transfer.push(feedFrame.buffer as ArrayBuffer);
    if (rapidFrame) transfer.push(rapidFrame.buffer as ArrayBuffer);
    if (feedWcs) transfer.push(feedWcs.buffer as ArrayBuffer);
    if (rapidWcs) transfer.push(rapidWcs.buffer as ArrayBuffer);
    if (feedTlo) transfer.push(feedTlo.buffer as ArrayBuffer);
    if (rapidTlo) transfer.push(rapidTlo.buffer as ArrayBuffer);
    if (feedOutside) transfer.push(feedOutside.buffer as ArrayBuffer);
    if (rapidOutside) transfer.push(rapidOutside.buffer as ArrayBuffer);
    if (feedSrc) transfer.push(feedSrc.buffer as ArrayBuffer);
    if (rapidSrc) transfer.push(rapidSrc.buffer as ArrayBuffer);
    for (const a of [...feedLod, ...rapidLod]) transfer.push(a.buffer as ArrayBuffer);

    self.postMessage(
      { version, gcode: { ...rest, feedPos, rapidPos, feed_lines: feedLines, feedLineIndex, rapidDist, feedAbc, rapidAbc, feedBreaks, rapidBreaks, feedMode, rapidMode, feedFrame, rapidFrame, feedWcs, rapidWcs, feedTlo, rapidTlo, feedOutside, rapidOutside, feedSrc, rapidSrc, feedLod, rapidLod, lodTols, lodMs, kinsFrames, wcsEvents, tloEvents, scrubTrack } },
      { transfer },
    );
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;  // expected on supersede — silent
    self.postMessage({ version, error: String((err as Error)?.message ?? err) });
  }
};

// Typed-array decode helpers moved to previewDecode.ts (W6 P1) — one
// decode source for this worker and the sim-vs-actual gate harness.

// Cumulative polyline distances for the dashed rapid line, so LineDashedMaterial's
// `lineDistance` attribute is ready off-thread instead of Three.computeLineDistances()
// scanning every point on the main thread (P4.1). Matches Three's Line algorithm:
// d[0]=0, d[i]=d[i-1]+|p[i]-p[i-1]|.
function _lineDistances(pos: Float32Array): Float32Array {
  const n = pos.length / 3;
  const d = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const dx = pos[i * 3]! - pos[(i - 1) * 3]!;
    const dy = pos[i * 3 + 1]! - pos[(i - 1) * 3 + 1]!;
    const dz = pos[i * 3 + 2]! - pos[(i - 1) * 3 + 2]!;
    d[i] = d[i - 1]! + Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return d;
}


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
import { parseWcsFrames } from "./viewer/wcsEpochs";

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

    let feedPos = _toF32(g.feed);
    let rapidPos = _toF32(g.rapid);
    let feedLines = _toU32(g.feed_lines);
    // Rotary-aware preview: per-vertex abc, present only when a rotary sweeps.
    let feedAbc = g.feed_abc != null ? _toF32(g.feed_abc) : undefined;
    let rapidAbc = g.rapid_abc != null ? _toF32(g.rapid_abc) : undefined;

    // Scrub track (stage 2): merge feed+rapid into execution order off-thread —
    // O(points), exactly the class of work that starved the heartbeat when it
    // ran on the UI thread. null = unbuildable (empty, or a stale pre-seq
    // cached payload) and the scrub bar simply doesn't offer itself.
    // Kins mode (phase 2a, RAW switchkins types since phase 3): u8 wire
    // bytes are already the typed view. Consumers map type → world per
    // the declared kins family (worldModeForSpec).
    const feedModeWire = g.feed_kinstype != null ? new Uint8Array(g.feed_kinstype as Uint8Array) : undefined;
    const rapidModeWire = g.rapid_kinstype != null ? new Uint8Array(g.rapid_kinstype as Uint8Array) : undefined;
    // Kins-flip relabel flags (P1): brk[i]=1 ⇒ the segment INTO rapid point
    // i is a frame relabel at a stationary pose, not motion. Absent on a
    // legacy payload → the track carries no brk and flip segments keep the
    // raw phantom (honest degradation — the reparse machinery refreshes it).
    const rapidBrkWire = g.rapid_brk != null ? new Uint8Array(g.rapid_brk as Uint8Array) : undefined;
    const feedSeq = _toU32(g.feed_seq);
    const rapidSeq = _toU32(g.rapid_seq);

    // Seq-keyed event resolution, shared by TWP frames and WCS epochs: an
    // event at seq N governs segments with seq > N; same-seq ties: last
    // recorded wins (stable sort on seq alone). `none` is the fill value
    // for "no event governs yet".
    const eventIdxFor = (
      seq: Uint32Array | undefined, eventSeqs: number[] | undefined, none: number,
    ): Uint8Array | undefined => {
      if (!eventSeqs?.length || !seq) return undefined;
      const evs = eventSeqs.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
      const out = new Uint8Array(seq.length).fill(none);
      for (let v = 0; v < seq.length; v++) {
        let idx = none;
        for (const [es, ei] of evs) {
          if (es < seq[v]!) idx = Math.min(ei, 0xfe);
          else break;
        }
        out[v] = idx;
      }
      return out;
    };
    // TWP frames (phase 3): wire kins_frames = [seq, preRot, primary, secondary].
    const wireFrames = (g.kins_frames as [number, number, number, number][] | undefined);
    const kinsFrames = wireFrames?.length
      ? wireFrames.map((f) => [f[1], f[2], f[3]] as [number, number, number])
      : undefined;
    const frameSeqs = kinsFrames ? wireFrames!.map(f => f[0]) : undefined;
    const feedFrameWire = eventIdxFor(feedSeq, frameSeqs, 0xff);
    const rapidFrameWire = eventIdxFor(rapidSeq, frameSeqs, 0xff);
    // WCS epochs (review P2): wire wcs_frames rows → per-vertex epoch index.
    // Every recorded segment has a governing epoch by construction (the
    // first event precedes the first motion), so fill 0 is unreachable in
    // practice and harmless if a malformed payload proves otherwise.
    const wcsEvents = parseWcsFrames(g.wcs_frames as number[][] | undefined);
    const epochSeqs = wcsEvents?.map(e => e.seq);
    const feedWcsWire = eventIdxFor(feedSeq, epochSeqs, 0);
    const rapidWcsWire = eventIdxFor(rapidSeq, epochSeqs, 0);

    const scrubTrack = buildScrubTrack(
      { pos: feedPos, abc: feedAbc, lines: feedLines, seq: feedSeq, tcum: g.feed_tcum != null && (g.feed_tcum as Uint8Array).length ? _toF32(g.feed_tcum) : undefined, mode: feedModeWire, frame: feedFrameWire, wcs: feedWcsWire },
      { pos: rapidPos, abc: rapidAbc, lines: _toU32(g.rapid_lines), seq: rapidSeq, tcum: g.rapid_tcum != null && (g.rapid_tcum as Uint8Array).length ? _toF32(g.rapid_tcum) : undefined, mode: rapidModeWire, frame: rapidFrameWire, brk: rapidBrkWire, wcs: rapidWcsWire },
      kinsFrames,
      wcsEvents,
    );

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
    let feedSrc: Uint32Array | undefined;
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
      feedSrc = split.feedSrc;
    }
    const feedLineMap = _buildFeedLineMap(feedLines ?? g.feed_lines);
    const rapidDist = _lineDistances(rapidPos);  // dashed rapid line's lineDistance (P4.1)

    // Drop the nested arrays from the passthrough; the flat typed arrays replace
    // them. Everything else (file, stats fields) is small and cloned as-is.
    const { feed: _f, rapid: _r, feed_lines: _fl, feed_abc: _fa, rapid_abc: _ra,
            feed_seq: _fs, rapid_seq: _rs, rapid_lines: _rl,
            feed_tcum: _ft, rapid_tcum: _rt,
            feed_kinstype: _fm, rapid_kinstype: _rm, rapid_brk: _rb, ...rest } = g;

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
    if (scrubTrack) {
      transfer.push(
        scrubTrack.pos.buffer as ArrayBuffer, scrubTrack.abc.buffer as ArrayBuffer,
        scrubTrack.lines.buffer as ArrayBuffer, scrubTrack.rapid.buffer as ArrayBuffer,
        scrubTrack.cum.buffer as ArrayBuffer,
      );
      if (scrubTrack.mode) transfer.push(scrubTrack.mode.buffer as ArrayBuffer);
      if (scrubTrack.frame) transfer.push(scrubTrack.frame.buffer as ArrayBuffer);
      if (scrubTrack.brk) transfer.push(scrubTrack.brk.buffer as ArrayBuffer);
      if (scrubTrack.wcsEpoch) transfer.push(scrubTrack.wcsEpoch.buffer as ArrayBuffer);
    }
    if (feedMode) transfer.push(feedMode.buffer as ArrayBuffer);
    if (rapidMode) transfer.push(rapidMode.buffer as ArrayBuffer);
    if (feedFrame) transfer.push(feedFrame.buffer as ArrayBuffer);
    if (rapidFrame) transfer.push(rapidFrame.buffer as ArrayBuffer);
    if (feedWcs) transfer.push(feedWcs.buffer as ArrayBuffer);
    if (rapidWcs) transfer.push(rapidWcs.buffer as ArrayBuffer);
    if (feedSrc) transfer.push(feedSrc.buffer as ArrayBuffer);

    self.postMessage(
      { version, gcode: { ...rest, feedPos, rapidPos, feed_lines: feedLines, feedLineMap, rapidDist, feedAbc, rapidAbc, feedBreaks, rapidBreaks, feedMode, rapidMode, feedFrame, rapidFrame, feedWcs, rapidWcs, feedSrc, kinsFrames, wcsEvents, scrubTrack } },
      { transfer },
    );
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;  // expected on supersede — silent
    self.postMessage({ version, error: String((err as Error)?.message ?? err) });
  }
};

// Preferred wire shape: little-endian float32 bytes from the parse worker (msgpack
// bin → Uint8Array VIEW into the fetch buffer). One buffer.slice gives an aligned,
// independently-transferable Float32Array — a single memcpy instead of flattening
// 1M+ per-point JS arrays. Legacy nested [[x,y,z],...] lists still fall back to
// _flatten (old payloads / WS path).
function _toF32(v: unknown): Float32Array {
  if (v instanceof Uint8Array) {
    return new Float32Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
  }
  return _flatten(v);
}

// nested [[x,y,z],...] → flat Float32Array [x,y,z,x,y,z,...]. Point index i maps
// to offset i*3, so feed_lines (one entry per point) stays index-aligned.
function _flatten(pts: unknown): Float32Array {
  if (!Array.isArray(pts) || pts.length === 0) return new Float32Array(0);
  const out = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    out[i * 3] = p[0]; out[i * 3 + 1] = p[1]; out[i * 3 + 2] = p[2];
  }
  return out;
}

function _toU32(a: unknown): Uint32Array | undefined {
  if (a instanceof Uint8Array) {
    return new Uint32Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
  }
  if (!Array.isArray(a)) return undefined;
  const out = new Uint32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i];
  return out;
}

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

// Build the source-line → point-index range map off the main thread (P4.1). A Map
// survives structured clone, and it has one entry per source line (far fewer than
// points), so cloning it is cheap while the O(points) build moves off the UI thread.
function _buildFeedLineMap(feed_lines: unknown): Map<number, { start: number; end: number }> {
  const m = new Map<number, { start: number; end: number }>();
  if (!Array.isArray(feed_lines) && !(feed_lines instanceof Uint32Array)) return m;
  for (let i = 0; i < feed_lines.length; i++) {
    const ln = feed_lines[i]!;
    const entry = m.get(ln);
    if (entry) entry.end = i;
    else m.set(ln, { start: i, end: i });
  }
  return m;
}

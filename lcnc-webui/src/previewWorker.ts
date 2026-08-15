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
import { buildScrubTrack } from "./viewer/scrubTrack";

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

    const feedPos = _toF32(g.feed);
    const rapidPos = _toF32(g.rapid);
    const feedLines = _toU32(g.feed_lines);
    const feedLineMap = _buildFeedLineMap(feedLines ?? g.feed_lines);
    const rapidDist = _lineDistances(rapidPos);  // dashed rapid line's lineDistance (P4.1)
    // Rotary-aware preview: per-vertex abc, present only when a rotary sweeps.
    const feedAbc = g.feed_abc != null ? _toF32(g.feed_abc) : undefined;
    const rapidAbc = g.rapid_abc != null ? _toF32(g.rapid_abc) : undefined;

    // Scrub track (stage 2): merge feed+rapid into execution order off-thread —
    // O(points), exactly the class of work that starved the heartbeat when it
    // ran on the UI thread. null = unbuildable (empty, or a stale pre-seq
    // cached payload) and the scrub bar simply doesn't offer itself.
    const scrubTrack = buildScrubTrack(
      { pos: feedPos, abc: feedAbc, lines: feedLines, seq: _toU32(g.feed_seq), tcum: g.feed_tcum != null && (g.feed_tcum as Uint8Array).length ? _toF32(g.feed_tcum) : undefined },
      { pos: rapidPos, abc: rapidAbc, lines: _toU32(g.rapid_lines), seq: _toU32(g.rapid_seq), tcum: g.rapid_tcum != null && (g.rapid_tcum as Uint8Array).length ? _toF32(g.rapid_tcum) : undefined },
    );

    // Drop the nested arrays from the passthrough; the flat typed arrays replace
    // them. Everything else (file, stats fields) is small and cloned as-is.
    const { feed: _f, rapid: _r, feed_lines: _fl, feed_abc: _fa, rapid_abc: _ra,
            feed_seq: _fs, rapid_seq: _rs, rapid_lines: _rl,
            feed_tcum: _ft, rapid_tcum: _rt, ...rest } = g;

    const transfer: Transferable[] = [
      feedPos.buffer as ArrayBuffer,
      rapidPos.buffer as ArrayBuffer,
      rapidDist.buffer as ArrayBuffer,
    ];
    if (feedLines) transfer.push(feedLines.buffer as ArrayBuffer);
    if (feedAbc) transfer.push(feedAbc.buffer as ArrayBuffer);
    if (rapidAbc) transfer.push(rapidAbc.buffer as ArrayBuffer);
    if (scrubTrack) {
      transfer.push(
        scrubTrack.pos.buffer as ArrayBuffer, scrubTrack.abc.buffer as ArrayBuffer,
        scrubTrack.lines.buffer as ArrayBuffer, scrubTrack.rapid.buffer as ArrayBuffer,
        scrubTrack.cum.buffer as ArrayBuffer,
      );
    }

    self.postMessage(
      { version, gcode: { ...rest, feedPos, rapidPos, feed_lines: feedLines, feedLineMap, rapidDist, feedAbc, rapidAbc, scrubTrack } },
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

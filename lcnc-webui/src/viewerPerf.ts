// Rolling frame/status-timing probe for the 3D viewer → gateway trace bus.
//
// Purpose: localize a "hiccup" symptom on large programs — and say WHICH side
// of the browser owns it. The status datastream is fixed-size regardless of
// g-code file size (the payload is pre-encoded once and spliced verbatim per
// client; the preview polylines never touch the WS — see gateway.py), so a
// stutter has to be one of these, which this probe separates:
//
//   statusGap — wall gap between consecutive applyState() calls, i.e. STATUS
//               frames applied (30 Hz active, 5 Hz at the gateway's idle poll)
//               — the `frames`/`gap_*` fields. NOT the render loop: a 200 ms
//               p50 here after a manual jog is the idle poll, not lag. Bursty
//               under motion = WS/stream jitter (the "datastream" hypothesis).
//   rafGap    — wall gap between consecutive animation-frame ticks: the render
//               loop's real cadence (`raf_*`). Long gaps here with the two
//               main-thread probes below clean = the compositor/GPU held the
//               frame, not our JS.
//   applyMs   — CPU time inside applyState() (backplot append, highlight
//               drawRange, render-on-demand signature). Spikes = main-thread
//               work in the status path.
//   renderMs  — CPU time SUBMITTING the WebGL frame (`render_*`). Firefox and
//               Chromium run WebGL out of process, so this is queueing cost
//               only — a GPU-bound draw does not show here.
//   mtLate    — a self-rescheduling MT_PROBE_MS timer (Firefox has no Long
//               Tasks API): it fires late by exactly the time the main thread
//               was busy past its due time — GC, a long task, a synchronous
//               WebGL stall — and stays ON TIME when the render loop is merely
//               throttled by the compositor (`mt_*`). The discriminator.
//   gpuBehind — a WebGL2 fence after every rendered frame, polled on each
//               tick: how many ticks (and ms) the GPU trails submission
//               (`gpu_*`). 1 tick is the floor (the first poll is the next
//               tick); 2+ = the GPU is behind = the draw itself is the cost.
//               Absent (not zero) without a WebGL2 context.
//
//   statusAge — from the WS worker's socket receipt of a status frame to the
//               end of the applyState() that shows it or a newer frame
//               (`age_*`). The receipt TRAVELS with the buffered status
//               (Codex R182 VP182-01): the store keeps the oldest receipt
//               of the frames it folds into one flush (`statusReceiptOf`),
//               the viewer the oldest of the flushes it folds into one
//               apply (`notePendingReceipt`) — a frame still waiting in the
//               store keeps its receipt past an apply of an older one.
//               The receipt is the WS worker's stamp, put on THIS page's
//               clock by a two-way exchange (Codex R186 VP186-01: the two
//               contexts' timeOrigin + now may stand apart — a context made
//               after a host sleep reads ahead): each exchange — the page's
//               send p0, the worker's stamp w, the page's receipt p1 — bounds
//               θ = worker − page to [w − p1, w − p0] (± CLK_SLACK_MS for the
//               coarsened stamps); their intersection holds for the worker
//               instance, an empty one is a contradiction and starts anew,
//               a new worker starts with none. A receipt is taken at its
//               EARLIEST possible page time (rx − U), so an age is a
//               conservative UPPER bound; without a relation it is not
//               taken (`age_unbound`). Not in it: the network, the viewer's
//               first build, the render after the apply. The gateway →
//               socket leg is bounded by the
//               heartbeat round trip timed IN THE WORKER (send and the
//               answering frame's receipt) less the gateway's hold
//               (`rt_net_*`, both legs), paired by the heartbeat's own number
//               the gateway's timing echoes (`hb_seq`, Codex R183 VP182-02);
//               an answer naming no heartbeat sent here is no bound
//               (`rt_invalid`) — one context's clock, no relation needed.
//               Each paired heartbeat also rides the row (`hb_pairs`) with
//               `g`, the gateway's monotonic clock between the heartbeat's
//               receipt and the answer's send (a parse's own bounds read the
//               same clock), the witness tick the page issued after handling
//               the answer (`ta`), and the highest witness word the WS worker
//               had been handed when it SENT that heartbeat (`dt` tick, `dn`
//               its number): a run check's real slice that began after tick
//               `ta` of answer A and whose word reached the worker before
//               heartbeat B left lies between them by causality alone
//               (Codex R186) — no clock of any browser context compared.
//   inputDelay — a key or pointer press until its first listener runs
//               (`in_delay_*`, the event's own timeStamp — the queueing a
//               busy main thread adds); with the Event Timing API also the
//               presses that took ≥ 16 ms to their next paint (`ev_*`).
//
// The distributions ride as fixed-bin HISTOGRAMS (`*_h`, sparse {lower edge
// ms: count}, `binOf`) next to the window's percentiles: a phase's quantile
// is read from the pooled histograms — the windows' p95s do not pool (Codex
// R181 VP181-01).
//
// Plus a jank counter (status frames whose gap exceeds JANK_MS) and a context
// snapshot (toolpath segment counts, backplot ring fill, JS heap) so a summary
// line can be correlated against file size and the backplot-full regime.
//
// Emission rides the existing telemetry batcher (POST /telemetry, off the WS
// status path), tagged `browser.viewer.perf` in trace.ndjson. One summary per
// WINDOW_MS, and only when there was activity — idle machines stay silent.

import { emitTelemetry } from './ws/telemetry';

const WINDOW_MS = 3000;   // one summary per 3 s of activity
const JANK_MS = 50;       // a status-frame gap over this counts as a hiccup
const SAMPLE_CAP = 1200;  // bound per-window sample memory (~20 s of 60 Hz ticks)
const RAF_PAUSE_MS = 5000; // a RAF gap past this is a paused loop (hidden/inactive tab), not a stall
const MT_PROBE_MS = 8;    // main-thread probe period (browsers clamp nested timers to >= 4 ms)
const MT_LATE_MS = 20;    // lateness counted as a block (timer jitter is 1–4 ms; one 16 ms frame fits)
const FENCE_CAP = 8;      // pending GPU fences kept; past this the oldest already say "far behind"
const FENCE_STALE_MS = 10000; // a fence unsignaled this long = lost context; dropped, counted
const INPUT_ODD_MS = 60000; // a press "older" than this (or from the future) is a clock oddity, counted apart

/** The histograms' bin: its lower edge in ms — 1 ms wide below 20, 2 below
 *  100, 10 below 500, 50 below 2000, then 500. A quantile read from the
 *  pooled bins is exact to the bin's width (report the bin's upper edge). */
export function binOf(ms: number): number {
  if (ms < 20) return Math.floor(ms);
  if (ms < 100) return Math.floor(ms / 2) * 2;
  if (ms < 500) return Math.floor(ms / 10) * 10;
  if (ms < 2000) return Math.floor(ms / 50) * 50;
  return Math.floor(ms / 500) * 500;
}

function _histAdd(h: Map<number, number>, ms: number): void {
  const b = binOf(ms);
  h.set(b, (h.get(b) ?? 0) + 1);
}

function _histOut(h: Map<number, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of [...h.keys()].sort((x, y) => x - y)) out[String(b)] = h.get(b)!;
  return out;
}

/** The global clock both the worker and the page read (HR-Time: timeOrigin
 *  + now is comparable across a page and its workers). */
function _epochNow(now: number): number {
  return (typeof performance !== 'undefined' ? performance.timeOrigin : 0) + now;
}

let _enabled = true;
// The window's ACTUAL start on the global clock (Codex R185: the nominal
// WINDOW_MS is only the timer's period — under load a window runs longer):
// the last emitted row's end, the module's load before the first.
let _winStart = _epochNow(typeof performance !== 'undefined' ? performance.now() : 0);

// Stable per-page-load client identity, so summaries from different browsers/
// tabs can be told apart in the trace (the telemetry POST `peer` is a fresh
// ephemeral port each batch and is useless for this). `host` distinguishes the
// local viewer (localhost/127.0.0.1) from a remote LAN browser (the VM's IP).
const _clientId =
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
const _host = typeof location !== "undefined" ? location.hostname : "?";

// Per-window accumulators (reset on each emit).
let _frames = 0;                  // applyState invocations this window
const _gaps: number[] = [];       // statusGap samples (ms) for percentiles
let _gapMax = 0;
let _jank = 0;
let _applySum = 0, _applyMax = 0;
let _renderSum = 0, _renderCount = 0, _renderMax = 0;
let _lastApplyTs = 0;             // performance.now() of previous applyState
const _gapH = new Map<number, number>();
const _applyH = new Map<number, number>();

// Status age: the socket receipt (global clock) of the oldest frame handed to
// the viewer and not yet applied — 0 when none waits.
let _pendingRx = 0;
// the last visibility change (global clock): a frame received before it
// waited through a hidden page — policy, not lag
let _visChangedAt = 0;
const _ageH = new Map<number, number>();
let _ageN = 0, _ageMax = 0, _ageNeg = 0, _ageVisSkip = 0;
let _visChanges = 0;        // visibility changes in the window: a row with one spans hidden time

// Heartbeat round trip in the worker less the gateway's hold: both network legs.
const HB_KEEP = 16;                           // sends remembered (≈ 16 s at 1 Hz)
// heartbeat number → the worker's send stamp (its clock) and the witness word
// it had been handed by then
const _hbSent = new Map<number, { at: number; dt: number | null; dn: number | null }>();
const _rtNetH = new Map<number, number>();
let _rtN = 0, _rtNetMax = 0, _rtInvalid = 0;
// The window's paired heartbeats with the gateway's monotonic stamp (1 Hz:
// three a window; the cap is a bound, never reached at that rate).
const HB_PAIRS_MAX = 32;
interface HbPair { seq: number; hs: number; hr: number; g: number; pid: number; ta: number; dt: number | null; dn: number | null }
const _hbPairs: HbPair[] = [];
let _hbPairsDropped = 0;
// The witness ticks (Codex R186): one after each valid answer, handed to the
// sink (the viewer posts it to a check during a run).
let _tick = 0;
let _tickSink: ((tick: number) => void) | null = null;
export function setWitnessTickSink(fn: ((tick: number) => void) | null): void { _tickSink = fn; }

// Main-thread SPANS (VP188-02 step 0, plan basiswechsel-last 2): the
// synchronous work a change of the work offsets sets off, by a FIXED list of
// names, per window {n, sum, max}; a span inside another one counts as
// nested (nested_n / nested_sum) and never into the outer CPU sum, an
// unknown name only into span_unknown. Closed in `finally` — an error path
// is timed too.
const SPAN_NAMES = ["col_copy", "col_post", "col_cancel", "path_reply", "path_programmed", "pf_load", "entry_track"] as const;
export type SpanName = typeof SPAN_NAMES[number];
interface SpanAcc { n: number; sum: number; max: number; nested_n: number; nested_sum: number }
const _spans = new Map<string, SpanAcc>();
let _spanDepth = 0, _spanUnknown = 0;
export function noteSpan(name: string, ms: number, nested = false): void {
  if (!_enabled) return;
  if (!(SPAN_NAMES as readonly string[]).includes(name)) { _spanUnknown++; return; }
  let a = _spans.get(name);
  if (!a) { a = { n: 0, sum: 0, max: 0, nested_n: 0, nested_sum: 0 }; _spans.set(name, a); }
  if (nested) { a.nested_n++; a.nested_sum += ms; } else { a.n++; a.sum += ms; }
  if (ms > a.max) a.max = ms;
}
/** `fn` timed as span `name` (performance.now() around it, this context). */
export function timeSpan<T>(name: SpanName, fn: () => T): T {
  const nested = _spanDepth > 0;
  const t0 = performance.now();
  _spanDepth++;
  try {
    return fn();
  } finally {
    _spanDepth--;
    noteSpan(name, performance.now() - t0, nested);
  }
}
function _spanFields(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, a] of _spans) {
    out[`span_${k}`] = { n: a.n, sum: +a.sum.toFixed(2), max: +a.max.toFixed(2),
                         ...(a.nested_n ? { nested_n: a.nested_n, nested_sum: +a.nested_sum.toFixed(2) } : {}) };
  }
  if (_spanUnknown) out.span_unknown = _spanUnknown;
  return out;
}

// The page ↔ WS worker clock relation θ = worker − page ∈ [_clkL, _clkU]
// (see the header); none until the first exchange of the worker instance.
const CLK_SLACK_MS = 4;    // two coarsened stamps (timeOrigin and now, ≤ 1 ms each) on either side
let _clkL = -Infinity, _clkU = Infinity, _clkValid = false;
let _clkN = 0, _clkConflicts = 0, _ageUnbound = 0;

// Input delay.
const _inDelayH = new Map<number, number>();
let _inN = 0, _inDelayMax = 0, _inOdd = 0;
const _evDurH = new Map<number, number>();
const _evDelayH = new Map<number, number>();
let _evN = 0, _evDurMax = 0;
let _evSupported = false;

// Render-loop cadence.
let _rafTicks = 0;                // ticks this window
let _rafSeq = 0;                  // monotonic tick number (fence bookkeeping; never reset)
const _rafGaps: number[] = [];
let _rafGapMax = 0, _rafPauses = 0;
let _lastRafTs = 0;

// Main-thread occupancy probe.
let _mtDue = 0;                   // when the running probe timer is due (0 = no anchor)
const _mtLate: number[] = [];     // lateness samples > 0 (ms)
let _mtLateMax = 0, _mtBlocks = 0, _mtProbes = 0;
let _mtTimer: number | null = null;

// GPU completion fences (WebGL2).
interface GpuFence { sync: WebGLSync; at: number; tick: number }
let _gl: WebGL2RenderingContext | null = null;
const _fences: GpuFence[] = [];
const _gpuBehind: number[] = [];
const _gpuMs: number[] = [];
let _gpuBehindMax = 0, _gpuMsMax = 0, _gpuFences = 0, _gpuDropped = 0;

// Optional context provider, registered by the viewer. Invoked once per emit
// (not per frame) so it can read live geometry/buffer state cheaply.
let _context: (() => Record<string, unknown>) | null = null;

export function setViewerPerfContext(fn: (() => Record<string, unknown>) | null): void {
  _context = fn;
}

export function setViewerPerfEnabled(on: boolean): void {
  _enabled = on;
}

/** Hand the collector the renderer's context. WebGL2 only (fences); anything
 *  else disables the GPU probe — the `gpu_*` fields then stay absent, not
 *  zero. Pass null on teardown. */
export function setViewerPerfGl(gl: unknown): void {
  _dropFences();
  _gl = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)
    ? gl : null;
}

/** Record one applyState() invocation: its CPU duration plus the wall gap
 *  since the previous one (status-arrival cadence as seen by the client). */
export function recordApply(applyMs: number, now: number = performance.now()): void {
  if (!_enabled) return;
  // the viewer's first apply: its frames waited for its build, not the path
  const built = _lastApplyTs > 0;
  if (_lastApplyTs > 0) {
    const gap = now - _lastApplyTs;
    if (_gaps.length < SAMPLE_CAP) _gaps.push(gap);
    _histAdd(_gapH, gap);
    if (gap > _gapMax) _gapMax = gap;
    if (gap > JANK_MS) _jank++;
  }
  _lastApplyTs = now;
  _frames++;
  _applySum += applyMs;
  _histAdd(_applyH, applyMs);
  if (applyMs > _applyMax) _applyMax = applyMs;
  const rx = _pendingRx;
  _pendingRx = 0;
  if (rx > 0 && built) {
    const age = _epochNow(now) - rx;
    if (rx < _visChangedAt) _ageVisSkip++;
    else if (age < 0) _ageNeg++;
    else {
      _ageN++;
      _histAdd(_ageH, age);
      if (age > _ageMax) _ageMax = age;
    }
  }
}

/** The viewer took a status flush (`statusReceiptOf` — the oldest socket
 *  receipt folded into it) as its next state: the oldest such receipt
 *  waits for the next applyState(). The viewer's status watcher calls it;
 *  a local re-apply of the last state never does. */
export function notePendingReceipt(rxEpochMs: unknown): void {
  if (!_enabled || typeof rxEpochMs !== 'number' || !(rxEpochMs > 0)) return;
  if (_pendingRx === 0 || rxEpochMs < _pendingRx) _pendingRx = rxEpochMs;
}

/** The page's visibility changed at `atEpochMs` (global clock). */
export function noteVisibilityChanged(atEpochMs: number = _epochNow(performance.now())): void {
  _visChangedAt = atEpochMs;
  _visChanges++;
}

/** The WS worker sent heartbeat number `seq` at `atEpochMs` (global clock,
 *  the worker's stamp — never the main thread's handling of the post). */
export function noteHeartbeatSentAt(atEpochMs: unknown, seq: unknown, doneTick?: unknown, doneN?: unknown): void {
  if (!_enabled || typeof seq !== 'number' || !(typeof atEpochMs === 'number' && atEpochMs > 0)) return;
  _hbSent.set(seq, { at: atEpochMs, dt: typeof doneTick === 'number' ? doneTick : null,
                     dn: typeof doneN === 'number' ? doneN : null });
  if (_hbSent.size > HB_KEEP) _hbSent.delete(_hbSent.keys().next().value as number);
}

/** A status frame that answers heartbeat `hbSeq` (the gateway's timing names
 *  it and its hold, `server_ms`), received by the worker at `rxEpochMs`. Both
 *  legs = receipt − that heartbeat's send − hold. An answer naming no
 *  heartbeat remembered here, unstamped or negative is no bound — counted
 *  apart, never 0 ms. Its number and every older one are forgotten: a
 *  heartbeat is answered once. A valid pair with the gateway's monotonic
 *  stamp `gMonoMs` and its pid is kept for the row (`hb_pairs`). */
export function noteHeartbeatReply(rxEpochMs: unknown, serverMs: unknown, hbSeq?: unknown,
                                   gMonoMs?: unknown, gPid?: unknown): void {
  if (!_enabled) return;
  const sent = typeof hbSeq === 'number' ? _hbSent.get(hbSeq) : undefined;
  const sentAt = sent?.at;
  if (typeof hbSeq === 'number') for (const k of [..._hbSent.keys()]) if (k <= hbSeq) _hbSent.delete(k);
  const ok = sentAt !== undefined && typeof rxEpochMs === 'number' && rxEpochMs > 0
    && typeof serverMs === 'number' && Number.isFinite(serverMs);
  const net = ok ? (rxEpochMs as number) - (sentAt as number) - (serverMs as number) : -1;
  if (!(net >= 0)) { _rtInvalid++; return; }
  _rtN++;
  _histAdd(_rtNetH, net);
  if (net > _rtNetMax) _rtNetMax = net;
  // the tick goes out after this answer was handled — whatever computes after
  // it computes after the answer's g was stamped
  const ta = ++_tick;
  _tickSink?.(ta);
  if (typeof gMonoMs === 'number' && Number.isFinite(gMonoMs) && typeof gPid === 'number') {
    if (_hbPairs.length < HB_PAIRS_MAX) {
      _hbPairs.push({ seq: hbSeq as number, hs: sentAt as number, hr: rxEpochMs as number, g: gMonoMs, pid: gPid,
                      ta, dt: sent!.dt, dn: sent!.dn });
    } else _hbPairsDropped++;
  }
}

/** A new WS worker: no clock relation to it yet. */
export function resetClockRelation(): void {
  _clkL = -Infinity; _clkU = Infinity; _clkValid = false;
}

/** One exchange: the page sent at `p0` (its clock), the worker stamped `w`
 *  (its clock), the page received at `p1`. θ = worker − page ∈ [w − p1, w − p0]
 *  widened by CLK_SLACK_MS; intersected with the relation so far. An empty
 *  intersection contradicts a constant relation: counted, and this exchange
 *  starts it anew. */
export function noteClockExchange(p0: unknown, w: unknown, p1: number): void {
  if (!_enabled || typeof p0 !== 'number' || typeof w !== 'number' || !(p1 >= p0)) return;
  const lo = w - p1 - CLK_SLACK_MS, hi = w - p0 + CLK_SLACK_MS;
  _clkN++;
  if (_clkValid && (lo > _clkU || hi < _clkL)) { _clkConflicts++; _clkValid = false; }
  if (!_clkValid) { _clkL = lo; _clkU = hi; _clkValid = true; return; }
  _clkL = Math.max(_clkL, lo); _clkU = Math.min(_clkU, hi);
}

/** A WS-worker receipt stamp at its EARLIEST possible time on this page's
 *  clock (rx − U): an age from it is an upper bound. Undefined — and counted —
 *  while no relation holds. */
export function receiptOnPage(rxWorker: unknown): number | undefined {
  if (typeof rxWorker !== 'number' || !(rxWorker > 0)) return undefined;
  if (!_clkValid) { if (_enabled) _ageUnbound++; return undefined; }
  return rxWorker - _clkU;
}

/** A key or pointer press: its first listener ran `now − timeStamp` after
 *  the browser stamped it. Exported for tests; the listeners below feed it. */
export function noteInput(timeStamp: number, now: number = performance.now()): void {
  if (!_enabled) return;
  const d = now - timeStamp;
  if (!(d >= 0) || d > INPUT_ODD_MS) { _inOdd++; return; }
  _inN++;
  _histAdd(_inDelayH, d);
  if (d > _inDelayMax) _inDelayMax = d;
}

/** An Event Timing entry of a key or pointer press that took ≥ 16 ms to its
 *  next paint (duration) and waited `delay` for its handlers. */
export function noteSlowInput(duration: number, delay: number): void {
  if (!_enabled) return;
  _evN++;
  _histAdd(_evDurH, duration);
  _histAdd(_evDelayH, Math.max(0, delay));
  if (duration > _evDurMax) _evDurMax = duration;
}

/** Record one animation-frame tick (top of the viewer's RAF callback, whether
 *  or not it renders): the render loop's own cadence, and the poll point for
 *  the GPU fences. */
export function recordRafTick(now: number = performance.now()): void {
  if (!_enabled) return;
  if (_lastRafTs > 0) {
    const gap = now - _lastRafTs;
    if (gap > RAF_PAUSE_MS) {
      _rafPauses++;   // the loop was paused (hidden tab, inactive Vue tab) — not a stall
    } else {
      if (_rafGaps.length < SAMPLE_CAP) _rafGaps.push(gap);
      if (gap > _rafGapMax) _rafGapMax = gap;
    }
  }
  _lastRafTs = now;
  _rafTicks++;
  _rafSeq++;
  _pollFences(now);
}

/** Record CPU time submitting one rendered WebGL frame, and fence it. */
export function recordRender(renderMs: number, now: number = performance.now()): void {
  if (!_enabled) return;
  _renderSum += renderMs;
  _renderCount++;
  if (renderMs > _renderMax) _renderMax = renderMs;
  _insertFence(now);
}

/** One main-thread probe sample: `now` against the due time of the timer
 *  that just fired. Lateness past MT_LATE_MS is a block. Hidden documents
 *  are skipped (browsers clamp their timers to 1 s) but still re-anchor.
 *  Exported for tests; the timer below feeds it. */
export function noteMainThreadProbe(now: number, hidden: boolean): void {
  if (_mtDue > 0 && _enabled && !hidden) {
    const late = now - _mtDue;
    _mtProbes++;
    if (late > 0) {
      if (_mtLate.length < SAMPLE_CAP) _mtLate.push(late);
      if (late > _mtLateMax) _mtLateMax = late;
      if (late > MT_LATE_MS) _mtBlocks++;
    }
  }
  _mtDue = now + MT_PROBE_MS;
}

function _mtTick(): void {
  noteMainThreadProbe(performance.now(), typeof document !== 'undefined' && document.hidden);
  _mtTimer = window.setTimeout(_mtTick, MT_PROBE_MS);
}

function _startMainThreadProbe(): void {
  if (typeof window === 'undefined' || _mtTimer !== null) return;
  _mtDue = 0;
  _mtTimer = window.setTimeout(_mtTick, MT_PROBE_MS);
}

function _stopMainThreadProbe(): void {
  if (_mtTimer !== null) { clearTimeout(_mtTimer); _mtTimer = null; }
  _mtDue = 0;
}

function _dropFences(): void {
  if (_gl) {
    for (const f of _fences) {
      try { _gl.deleteSync(f.sync); } catch { /* context gone */ }
    }
  }
  _fences.length = 0;
}

function _insertFence(now: number): void {
  if (!_gl) return;
  if (_fences.length >= FENCE_CAP) { _gpuDropped++; return; }
  let sync: WebGLSync | null;
  try {
    sync = _gl.fenceSync(_gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    _gl.flush();
  } catch { sync = null; }
  if (!sync) return;   // context lost
  _fences.push({ sync, at: now, tick: _rafSeq });
}

function _pollFences(now: number): void {
  if (!_gl || _fences.length === 0) return;
  // Fences signal in submission order: walk the oldest, stop at the first
  // still pending. One getSyncParameter per tick in the common case.
  while (_fences.length) {
    const f = _fences[0]!;
    let done: boolean;
    try { done = _gl.getSyncParameter(f.sync, _gl.SYNC_STATUS) === _gl.SIGNALED; } catch { done = false; }
    if (!done) {
      if (now - f.at <= FENCE_STALE_MS) break;
      // A fence this old never signals (context lost): drop it, say so.
      try { _gl.deleteSync(f.sync); } catch { /* context gone */ }
      _fences.shift();
      _gpuDropped++;
      continue;
    }
    try { _gl.deleteSync(f.sync); } catch { /* context gone */ }
    _fences.shift();
    const behind = _rafSeq - f.tick;
    const ms = now - f.at;
    _gpuFences++;
    if (_gpuBehind.length < SAMPLE_CAP) { _gpuBehind.push(behind); _gpuMs.push(ms); }
    if (behind > _gpuBehindMax) _gpuBehindMax = behind;
    if (ms > _gpuMsMax) _gpuMsMax = ms;
  }
}

function _percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

function _sorted(xs: number[]): number[] {
  return xs.slice().sort((a, b) => a - b);
}

interface ChromiumMemory { usedJSHeapSize: number; jsHeapSizeLimit: number }
function _heapUsedMb(): number | null {
  const mem = (performance as unknown as { memory?: ChromiumMemory }).memory;
  if (!mem) return null;
  return +(mem.usedJSHeapSize / (1024 * 1024)).toFixed(1);
}

/** Emit the window summary if it saw status frames or renders, and reset.
 *  Driven by the interval below; exported for tests. */
export function flushViewerPerf(): void {
  if (_frames === 0 && _renderCount === 0 && _inN === 0 && _inOdd === 0) return; // idle window — stay quiet
  const sorted = _sorted(_gaps);
  const raf = _sorted(_rafGaps);
  const mt = _sorted(_mtLate);
  const gpuB = _sorted(_gpuBehind);
  const gpuM = _sorted(_gpuMs);
  const winEnd = _epochNow(performance.now());
  emitTelemetry('viewer.perf', {
    cid: _clientId,                // stable per-page-load id (separates tabs)
    host: _host,                   // localhost = local VM browser, IP = remote
    vis: typeof document !== 'undefined' ? document.visibilityState : '?',
    window_ms: WINDOW_MS,          // the nominal period; the row's own span is win_*
    win_start: +_winStart.toFixed(1),   // global clock: the previous row's end
    win_end: +winEnd.toFixed(1),
    win_ms: +(winEnd - _winStart).toFixed(1),
    // STATUS frames applied (30 Hz active / 5 Hz idle poll) — not the render loop
    frames: _frames,
    gap_p50_ms: +_percentile(sorted, 50).toFixed(1),
    gap_p95_ms: +_percentile(sorted, 95).toFixed(1),
    gap_max_ms: +_gapMax.toFixed(1),
    jank_frames: _jank,            // status gaps > JANK_MS
    jank_ms: JANK_MS,
    gap_h: _histOut(_gapH),        // the gaps, binned (binOf) — pools across windows
    // applyState CPU (main-thread work in the status path)
    apply_mean_ms: _frames ? +(_applySum / _frames).toFixed(2) : 0,
    apply_max_ms: +_applyMax.toFixed(2),
    apply_h: _histOut(_applyH),
    // status age: socket receipt (worker) → applied, per apply
    age_n: _ageN,
    age_max_ms: +_ageMax.toFixed(1),
    age_h: _histOut(_ageH),
    age_neg: _ageNeg,              // a receipt after its apply: clock oddity, not binned
    age_vis_skip: _ageVisSkip,     // received before a visibility change: not aged
    vis_changes: _visChanges,      // visibility changes in this window (the row spans hidden time)
    // heartbeat round trip less the gateway's hold (both legs): bounds gateway → socket
    rt_n: _rtN,
    rt_invalid: _rtInvalid,        // answers not paired with exactly one stamped heartbeat, or negative
    rt_net_max_ms: +_rtNetMax.toFixed(1),
    rt_net_h: _histOut(_rtNetH),
    hb_pairs: _hbPairs.slice(),    // {seq, hs, hr (worker clock), g (gateway monotonic ms), pid, ta, dt, dn}
    ...(_hbPairsDropped ? { hb_pairs_dropped: _hbPairsDropped } : {}),
    // the page ↔ WS worker clock relation at the window's end (θ = worker − page)
    clk_n: _clkN,
    clk_l: _clkValid ? +_clkL.toFixed(3) : null,
    clk_u: _clkValid ? +_clkU.toFixed(3) : null,
    clk_conflicts: _clkConflicts,
    age_unbound: _ageUnbound,      // receipts not put on the page's clock (no relation yet): not aged
    ..._spanFields(),              // main-thread spans of an offset change (span_<name>: {n, sum, max})
    // input: press → first listener (and, Event Timing, the presses ≥ 16 ms to the next paint)
    in_n: _inN,
    in_delay_max_ms: +_inDelayMax.toFixed(1),
    in_delay_h: _histOut(_inDelayH),
    in_odd: _inOdd,
    ...(_evSupported ? {
      ev_n: _evN,
      ev_dur_max_ms: +_evDurMax.toFixed(1),
      ev_dur_h: _histOut(_evDurH),
      ev_delay_h: _histOut(_evDelayH),
    } : {}),
    // WebGL submit CPU (queueing cost only — out-of-process WebGL)
    render_mean_ms: _renderCount ? +(_renderSum / _renderCount).toFixed(2) : 0,
    render_max_ms: +_renderMax.toFixed(2),
    renders: _renderCount,
    // render-loop cadence (every tick, rendered or not)
    raf_ticks: _rafTicks,
    raf_gap_p50_ms: +_percentile(raf, 50).toFixed(1),
    raf_gap_p95_ms: +_percentile(raf, 95).toFixed(1),
    raf_gap_max_ms: +_rafGapMax.toFixed(1),
    raf_pauses: _rafPauses,        // gaps > RAF_PAUSE_MS (loop paused, not stalled)
    // main-thread occupancy: timer lateness (late = the thread was busy)
    mt_probes: _mtProbes,
    mt_late_p95_ms: +_percentile(mt, 95).toFixed(1),
    mt_late_max_ms: +_mtLateMax.toFixed(1),
    mt_blocks: _mtBlocks,          // samples later than MT_LATE_MS
    mt_block_ms: MT_LATE_MS,
    // GPU completion (WebGL2 fences; absent without a WebGL2 context)
    ...(_gl ? {
      gpu_fences: _gpuFences,
      gpu_behind_p95: _percentile(gpuB, 95),   // ticks from submit to first seen done (1 = floor)
      gpu_behind_max: _gpuBehindMax,
      gpu_done_p95_ms: +_percentile(gpuM, 95).toFixed(1),
      gpu_done_max_ms: +_gpuMsMax.toFixed(1),
      gpu_dropped: _gpuDropped,    // renders not fenced (cap) + fences abandoned (lost context)
    } : {}),
    heap_used_mb: _heapUsedMb(),   // null on non-Chromium
    ...(_context?.() ?? {}),
  });
  _winStart = winEnd;
  _frames = 0;
  _gaps.length = 0;
  _gapMax = 0;
  _jank = 0;
  _applySum = _applyMax = 0;
  _resetHistograms();
  _renderSum = _renderMax = 0;
  _renderCount = 0;
  _rafTicks = 0;
  _rafGaps.length = 0;
  _rafGapMax = _rafPauses = 0;
  _mtLate.length = 0;
  _mtLateMax = _mtBlocks = _mtProbes = 0;
  _gpuBehind.length = 0;
  _gpuMs.length = 0;
  _gpuBehindMax = _gpuMsMax = _gpuFences = _gpuDropped = 0;
}

function _resetHistograms(): void {
  _gapH.clear(); _applyH.clear();
  _ageH.clear(); _ageN = _ageMax = _ageNeg = _ageVisSkip = _visChanges = 0;
  _rtNetH.clear(); _rtN = _rtNetMax = _rtInvalid = 0;
  _hbPairs.length = 0; _hbPairsDropped = 0;
  _clkN = _clkConflicts = _ageUnbound = 0;
  _spans.clear(); _spanUnknown = 0;
  _inDelayH.clear(); _inN = _inDelayMax = _inOdd = 0;
  _evDurH.clear(); _evDelayH.clear(); _evN = _evDurMax = 0;
}

/** Test/HMR helper: forget every sample and clock anchor. */
export function resetViewerPerf(): void {
  _dropFences();
  _winStart = _epochNow(performance.now());
  _frames = _gapMax = _jank = _applySum = _applyMax = 0;
  _resetHistograms();
  _pendingRx = 0;
  _visChangedAt = 0;
  _hbSent.clear();
  resetClockRelation();
  _tick = 0;
  _gaps.length = 0;
  _renderSum = _renderMax = _renderCount = 0;
  _lastApplyTs = 0;
  _rafTicks = _rafGapMax = _rafPauses = 0;
  _rafGaps.length = 0;
  _lastRafTs = 0;
  _mtDue = 0;
  _mtLate.length = 0;
  _mtLateMax = _mtBlocks = _mtProbes = 0;
  _gpuBehind.length = 0;
  _gpuMs.length = 0;
  _gpuBehindMax = _gpuMsMax = _gpuFences = _gpuDropped = 0;
}

// A tab switch pauses RAF and clamps timers: re-anchor both clocks so the
// first tick back is not booked as a stall / a block.
function _onVisibility(): void {
  _lastRafTs = 0;
  _mtDue = 0;
  noteVisibilityChanged();   // a hidden page applies nothing: its frames' wait is policy, not lag
}

// Presses: passive capture listeners that only read the event's stamp (the
// E-Stop key's own capture listener is untouched — nothing here stops or
// prevents anything).
function _onInput(e: Event): void {
  noteInput(e.timeStamp);
}

interface EventTimingEntry extends PerformanceEntry { processingStart: number }
let _evObserver: PerformanceObserver | null = null;
function _startEventTiming(): void {
  if (typeof PerformanceObserver === 'undefined' || _evObserver) return;
  if (!(PerformanceObserver.supportedEntryTypes ?? []).includes('event')) return;
  try {
    _evObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries() as EventTimingEntry[]) {
        if (e.name === 'keydown' || e.name === 'pointerdown') noteSlowInput(e.duration, e.processingStart - e.startTime);
      }
    });
    _evObserver.observe({ type: 'event', durationThreshold: 16 } as PerformanceObserverInit);
    _evSupported = true;
  } catch { _evObserver = null; }
}

// One self-quieting timer: flushes only when the window saw activity, so an
// idle viewer produces no trace volume. Survives across jobs without toggling.
let _flushTimer: number | null = null;
if (typeof window !== 'undefined') {
  _flushTimer = window.setInterval(flushViewerPerf, WINDOW_MS);
  _startMainThreadProbe();
  document.addEventListener('visibilitychange', _onVisibility);
  window.addEventListener('keydown', _onInput, { capture: true, passive: true });
  window.addEventListener('pointerdown', _onInput, { capture: true, passive: true });
  _startEventTiming();
}

// Clear the timers on HMR dispose so reloads don't stack duplicates (#32).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_flushTimer !== null) { clearInterval(_flushTimer); _flushTimer = null; }
    _stopMainThreadProbe();
    document.removeEventListener('visibilitychange', _onVisibility);
    window.removeEventListener('keydown', _onInput, { capture: true });
    window.removeEventListener('pointerdown', _onInput, { capture: true });
    _evObserver?.disconnect();
    _evObserver = null;
    _dropFences();
  });
}

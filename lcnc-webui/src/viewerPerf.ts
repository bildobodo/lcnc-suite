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
//               end of the applyState() that shows it (or a newer frame):
//               the oldest frame received since the last apply, per apply
//               (`age_*`). Both ends read the global clock (timeOrigin +
//               now), so the worker's receipt and the main thread's apply
//               compare. The gateway → socket leg is NOT in it: bounded by
//               the heartbeat round trip less the gateway's hold
//               (`rt_net_*` — both legs, so an upper bound of the one).
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

// Status age: the socket receipt (global clock) of the oldest frame not yet
// applied — 0 when every received frame is shown.
let _rxOldest = 0;
const _ageH = new Map<number, number>();
let _ageN = 0, _ageMax = 0, _ageNeg = 0;

// Heartbeat round trip less the gateway's hold: both network legs.
const _rtNetH = new Map<number, number>();
let _rtN = 0, _rtNetMax = 0;

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
  if (_rxOldest > 0) {
    const age = _epochNow(now) - _rxOldest;
    if (age < 0) _ageNeg++;
    else {
      _ageN++;
      _histAdd(_ageH, age);
      if (age > _ageMax) _ageMax = age;
    }
    _rxOldest = 0;
  }
}

/** A status frame left the WS worker's socket at `rxEpochMs` (global clock;
 *  the worker stamps it). The oldest one not yet applied is what the next
 *  applyState() is late against. Only once the viewer has applied a frame:
 *  before that the frames wait for the viewer's build (1.4 s at a loaded
 *  page start in the gate) — a start, not the status path. */
export function noteStatusReceived(rxEpochMs: unknown): void {
  if (!_enabled || _lastApplyTs === 0 || typeof rxEpochMs !== 'number' || !(rxEpochMs > 0)) return;
  if (_rxOldest === 0) _rxOldest = rxEpochMs;
}

/** One heartbeat round trip (the heartbeat's send to the status that answers
 *  it, at the main thread) and the gateway's hold inside it: what is left is
 *  both network legs plus the relay to the main thread. */
export function noteRoundTrip(rtMs: number, serverMs: unknown): void {
  if (!_enabled || typeof serverMs !== 'number' || !Number.isFinite(rtMs)) return;
  const net = Math.max(0, rtMs - serverMs);
  _rtN++;
  _histAdd(_rtNetH, net);
  if (net > _rtNetMax) _rtNetMax = net;
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
  emitTelemetry('viewer.perf', {
    cid: _clientId,                // stable per-page-load id (separates tabs)
    host: _host,                   // localhost = local VM browser, IP = remote
    vis: typeof document !== 'undefined' ? document.visibilityState : '?',
    window_ms: WINDOW_MS,
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
    // heartbeat round trip less the gateway's hold (both legs): bounds gateway → socket
    rt_n: _rtN,
    rt_net_max_ms: +_rtNetMax.toFixed(1),
    rt_net_h: _histOut(_rtNetH),
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
  _ageH.clear(); _ageN = _ageMax = _ageNeg = 0;
  _rtNetH.clear(); _rtN = _rtNetMax = 0;
  _inDelayH.clear(); _inN = _inDelayMax = _inOdd = 0;
  _evDurH.clear(); _evDelayH.clear(); _evN = _evDurMax = 0;
}

/** Test/HMR helper: forget every sample and clock anchor. */
export function resetViewerPerf(): void {
  _dropFences();
  _frames = _gapMax = _jank = _applySum = _applyMax = 0;
  _resetHistograms();
  _rxOldest = 0;
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
  _rxOldest = 0;   // a hidden page applies nothing: its frames' wait is policy, not lag
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

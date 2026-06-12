import { ref, shallowRef } from "vue";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { type WsCommand, OPERATOR_ERROR, OPERATOR_DISPLAY, isQueueSafe } from "./lcnc";
import { updateServerCache, loadDisplayDefaults, registerSettingsSaver } from "./defaults";
import { enableWakeLock, disableWakeLock } from "./wakeLock";
import { applyHalshowSnapshot, applyHalshowUpdate, resetHalshow } from "./ws/halshowStore";
import { emitTelemetry } from "./ws/telemetry";
import {
  buildWsUrl, captureArmedForResume, connectTransport,
  postWorkerConfig, sendCommand, terminateTransport,
} from "./ws/wsTransport";
import {
  fetchCompGrid, fetchSurfacePoints,
  handleToolTableChanged, handleViewerGcode, handleViewerGcodeReady, handleViewerInit,
} from "./ws/bulkData";

export interface LcncMessage {
  id: number;
  kind: number;     // See NML_ERROR..OPERATOR_DISPLAY constants in lcnc.ts
  text: string;
  ts: number;       // Date.now() when received
}

export const connected = ref(false);

export interface WsStatus {
  data?: Record<string, any>;
  clients?: { ip: string; armed: boolean }[];
  surface_points?: [number, number, number][];
  comp_grid?: any;
  probe_results?: Record<string, number>;
  type?: string;
  timing?: any;
  // Sibling of `data` — gateway injects on tool change / library edit.
  // Lives at envelope top-level so the shared msgpack encode of `data` stays
  // valid every tick (delta-off path).
  tool_meta?: Record<string, any> | null;
}
export const status = shallowRef<WsStatus | null>(null);
export const lastReply = ref<any>(null);
export const lcncError = ref<string | null>(null);
export const armed = ref(false);        // server-authoritative — driven by gateway messages
// Sticky safety trip: populated when the gateway includes a `safety_trip`
// field in a status message, cleared when the operator acknowledges. Survives
// reload + multi-tab because the gateway re-broadcasts it on every status
// until acknowledged. While non-null, the server rejects {cmd:"arm",armed:true}.
export const safetyTrip = ref<{ reason: string } | null>(null);
// HAL reader staleness: gateway sets `reader_stale: true` on status messages
// when no snapshot has arrived from hal_reader.py within ~2 s. Auto-clears
// when snapshots resume — distinct from safety_trip which requires operator
// ack. UI surfaces this as a non-blocking banner so display values that
// depend on the reader (spindle RPM, eoffset, probe input, comp state) are
// known to be stale rather than silently frozen.
export const readerStale = ref(false);

// Config fallback (issue #21): gateway sets `config_warning` on status messages
// when it falls back to a default unit system or default machine geometry —
// both unit-ambiguous and unsafe to apply silently. Latches server-side until a
// subsequent successful read; surfaced as a non-blocking banner.
export const configWarning = ref<{ reason: string; units: boolean } | null>(null);

// Server is mid-shutdown (FastAPI lifespan teardown). Set when the gateway
// broadcasts `{type: "server_shutdown"}` immediately before closing WS
// connections. Distinguishes a planned shutdown from a network blip so the
// UI can show "Server shutting down" instead of the generic reconnect state.
// Cleared on the next successful WS open.
export const serverShuttingDown = ref(false);
// ---------- Bulk-data channels (split out, A1.2) ----------
// Viewer payloads, preview worker, gcode text and surface/comp-grid fetches
// live in ws/bulkData.ts; consumers keep importing the refs/types from here
// via the barrel re-export. previewLoadError is surfaced in App.vue's status
// banner so the operator sees "preview is stale" rather than viewing a
// possibly outdated toolpath without warning.
export {
  viewerInit, viewerGcode, toolTableVersion, gcodeContent, previewLoadError,
  type ViewerPart, type KinematicsList, type ViewerInit, type ViewerGcode,
} from "./ws/bulkData";
// ---------- Browser → server telemetry batcher (split out, A1.3) ----------
// Queue/caps/flush/beacon/longtask-observer and the pagehide/beforeunload/
// error/unhandledrejection listeners live in ws/telemetry.ts. The
// visibilitychange handler STAYS here: it drives the WS worker too, and
// orchestrating across modules is lcncWs's job.
export { emitTelemetry } from "./ws/telemetry";

// Tab visibility changes — the known storm trigger.
//   1. Emit a telemetry event for the trace bus (off-band signal).
//   2. Send a `tab_visibility` WS command so the gateway can skip status
//      fan-out to this client while hidden — backgrounded tabs stop draining
//      the WS, fill the kernel TCP buffer, and stall the gateway's asyncio
//      loop. Suppressing fan-out at the source eliminates the feedback loop.
const _onVisibility = () => {
  const hidden = document.hidden;
  emitTelemetry("tab.visibility", {
    visibilityState: document.visibilityState,
    hidden,
  });
  // Relay to the worker, which owns the socket. When becoming visible, also
  // request an immediate heartbeat so the gateway's last_hb is fresh at once.
  postWorkerConfig({ hidden, fireHeartbeat: !hidden });
};
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", _onVisibility);
}


// Message history is intentionally per-tab (localStorage, not server-synced).
// Rationale: different tabs/browsers represent different user sessions;
// federating error/status messages across sessions would cause confusing
// cross-talk (notifications from one operator's arm-reject showing up for
// another's read-only session). Keep this local.
const MSG_STORAGE_KEY = "lcnc-messages";
const MSG_MAX = 200;

function loadStoredMessages(): LcncMessage[] {
  try {
    const raw = localStorage.getItem(MSG_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("[messages] localStorage parse failed", e);
  }
  return [];
}

function persistMessages(msgs: LcncMessage[]) {
  const trimmed = msgs.slice(-MSG_MAX);
  try {
    localStorage.setItem(MSG_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn("[messages] localStorage write failed", e);
  }
}

const _stored = loadStoredMessages();
export const messages = ref<LcncMessage[]>(_stored);
export const unreadCount = ref(_stored.length);

export const latency = ref<number | null>(null);        // round-trip: heartbeat → next status
export const networkLatency = ref<number | null>(null);  // pure network: heartbeat → pong

export interface TimingComponentStats {
  last: number; min: number; max: number; mean: number; std: number;
}

export interface TimingStats {
  rt: TimingComponentStats;
  network: TimingComponentStats;
  server: TimingComponentStats;
  cycle: TimingComponentStats;
  poll: TimingComponentStats;
  errors: TimingComponentStats;
  parse: TimingComponentStats;
  overhead: TimingComponentStats;
  encode: TimingComponentStats;   // server: wire-format encode time per status msg
  sharedEncode: TimingComponentStats; // server: one-per-tick shared msgpack encode (fan-out optimization)
  decode: TimingComponentStats;   // client: JSON.parse / msgpack.decode per message
  ws_bytes: TimingComponentStats; // server: encoded payload size (bytes)
  count: number;
}

export const timingStats = ref<TimingStats | null>(null);

// ---------- Halshow live state (split out, A1.1) ----------
// State + frame appliers live in ws/halshowStore.ts; consumers keep importing
// the refs/types from here via the barrel re-export.
export {
  halPins, halSignals, halParams, halInitialized,
  type HalPin, type HalSignalPin, type HalSignal, type HalParam,
} from "./ws/halshowStore";

const TIMING_MAX_SAMPLES = 300;

type TimingKey = "rt" | "network" | "server" | "cycle" | "poll" | "errors" | "parse" | "overhead" | "encode" | "sharedEncode" | "decode" | "ws_bytes";
const _timingSamples: Record<TimingKey, number[]> = {
  rt: [], network: [], server: [], cycle: [], poll: [], errors: [], parse: [], overhead: [],
  encode: [], sharedEncode: [], decode: [], ws_bytes: [],
};

function _computeComponentStats(arr: number[]): TimingComponentStats {
  if (arr.length === 0) return { last: 0, min: 0, max: 0, mean: 0, std: 0 };
  const last = arr[arr.length - 1]!;
  let min = Infinity, max = -Infinity, sum = 0, sumSq = 0;
  for (const v of arr) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / arr.length;
  const variance = sumSq / arr.length - mean * mean;
  const std = Math.sqrt(Math.max(0, variance));
  return {
    last: Math.round(last * 10) / 10,
    min: Math.round(min * 10) / 10,
    max: Math.round(max * 10) / 10,
    mean: Math.round(mean * 10) / 10,
    std: Math.round(std * 10) / 10,
  };
}

function _pushSample(key: TimingKey, value: number) {
  const arr = _timingSamples[key];
  arr.push(value);
  if (arr.length > TIMING_MAX_SAMPLES) arr.shift();
}

function _recomputeTimingStats() {
  const keys: TimingKey[] = ["rt", "network", "server", "cycle", "poll", "errors", "parse", "overhead", "encode", "sharedEncode", "decode", "ws_bytes"];
  const stats = {} as Record<TimingKey, TimingComponentStats>;
  for (const k of keys) stats[k] = _computeComponentStats(_timingSamples[k]);
  timingStats.value = { ...stats, count: _timingSamples.rt.length };
}

export function resetTimingStats() {
  for (const k of Object.keys(_timingSamples) as TimingKey[]) _timingSamples[k] = [];
  timingStats.value = null;
}

export function getTimingCsv(): string {
  const keys: TimingKey[] = ["rt", "network", "server", "cycle", "poll", "errors", "parse", "overhead", "encode", "sharedEncode", "decode", "ws_bytes"];
  const maxLen = Math.max(...keys.map(k => _timingSamples[k].length));
  const lines = [keys.join(",")];
  for (let i = 0; i < maxLen; i++) {
    lines.push(keys.map(k => _timingSamples[k][i] ?? "").join(","));
  }
  return lines.join("\n");
}

let _nextMsgId = _stored.length > 0 ? Math.max(..._stored.map(m => m.id)) + 1 : 1;


// The WS worker plumbing lives in ws/wsTransport.ts (split out, A1.4); all
// message interpretation + reactive state stay here in the orchestrator,
// fed through onWorkerMessage.
let _heartbeatSentAt = 0;   // used for network latency (pong)
let _rtSentAt = 0;           // used for round-trip latency (next status)

// Status batching + one-shot tool_meta carry-over. Module scope so they
// persist across the relay (previously closure-locals inside connectWs).
let _pendingStatus: any = null;
let _lastRflTs = 0;   // dedupe for rfl_status frames (same phase repeats per tick)
let _flushScheduled = false;
let _lastToolMeta: { num: number; meta: any } | null = null;

export function connectWs() {
  // The worker owns reconnect; connectWs is only called for the initial
  // connection and on HMR (connectTransport tears down any prior worker).
  const wsUrl = buildWsUrl();
  // Identify the browser engine in the trace: WS-delivery behavior differs per
  // engine (WebKit proxies worker WebSocket I/O via the main thread; Chromium
  // uses a separate network process), which matters for hb-stall attribution.
  // Host only — the URL may carry the auth token, which must not hit the trace.
  emitTelemetry("ws.client_env", { ua: navigator.userAgent, ws_host: new URL(wsUrl).host });
  connectTransport(wsUrl, onWorkerMessage);
}

// Relay of worker → main events. Reactive ref updates that used to live in
// ws.onopen / ws.onclose / ws.onmessage stay here on the main thread.
function onWorkerMessage(m: any) {
  switch (m?.type) {
    case "open":
      emitTelemetry("ws.open", { dt_ms: m.dtMs, attempt: m.attempt });
      connected.value = true;
      serverShuttingDown.value = false;
      // Acquire screen wake-lock if enabled (not gated on armed, so passive
      // viewer tabs stay awake too). Released on close.
      try {
        if (loadDisplayDefaults().keepAwake) void enableWakeLock();
      } catch { /* defaults may be unavailable pre-init; fine */ }
      break;

    case "close":
      emitTelemetry("ws.close", {
        code: m.code, reason: m.reason, clean: m.wasClean, since_attempt_ms: m.sinceAttemptMs,
      });
      connected.value = false;
      // Capture armed state so the worker's NEXT reconnect hello can ask the
      // gateway to restore armed=true via a still-valid armed-resume hold.
      captureArmedForResume(armed.value);
      armed.value = false;     // new connection starts disarmed
      try { disableWakeLock(); } catch { /* ignored */ }
      latency.value = null;
      networkLatency.value = null;
      _heartbeatSentAt = _rtSentAt = 0;
      // Server forgets per-client halshow subscription on disconnect — clear
      // so the panel honestly shows "no data" (see halshowStore.resetHalshow).
      resetHalshow();
      break;

    case "attempt":
      emitTelemetry("ws.connect.attempt", {
        attempt: m.attempt, last_close_code: m.lastCloseCode, gap_ms: m.gapMs,
      });
      break;

    case "reconnecting":
      // No-op: the subsequent "attempt" carries the telemetry on actual retry.
      break;

    case "hbsent":
      // Anchor RTT timing on the main thread. This is the arrival time of the
      // worker's post (a sub-ms hop after the real send); under heavy main jank
      // the latency readout may slightly overstate RTT, but the heartbeat
      // itself went out on time on the worker thread. Diagnostic only.
      _heartbeatSentAt = _rtSentAt = performance.now();
      break;

    case "hbslip":
      // The worker's own 1 Hz heartbeat timer fired late → the worker thread was
      // starved. This is the browser side of a gateway client-heartbeat stall
      // (safety.hb_stall_disarmed) — emit so stalls are visible end-to-end
      // (browser → gateway → HAL). framesRelayed tells busy-relaying from
      // CPU-starved (#35).
      emitTelemetry("ws.hb_slip", { gap_ms: m.gapMs, frames_relayed: m.framesRelayed });
      break;

    case "hbdeliv":
      // The worker's timer fired ON TIME but delivery looks stalled: last tick's
      // 19-byte heartbeat is still in the socket buffer after a full second
      // (buffered > 0 — send path frozen) and/or nothing has been received from
      // the gateway despite 5–30 Hz status flow (rxGapMs — inbound stalled too).
      // Distinguishes browser-send-path stalls (e.g. WebKit routing worker WS
      // through a jammed main thread) from network/VM-link stalls.
      emitTelemetry("ws.hb_delivery_stall", { buffered: m.buffered, rx_gap_ms: m.rxGapMs });
      break;

    case "bufferpressure":
      // State-transition event (start | sustained | recover), not a per-second
      // sample — see wsWorker startBufferSampler (P0).
      emitTelemetry("ws.send_buffer_pressure", {
        phase: m.phase, buffered_bytes: m.buffered,
        peak_bytes: m.peak, duration_ms: m.durationMs,
      });
      break;

    case "error":
      if (m.kind === "hello_send_failed") {
        // Hello is the foundation of session-id resume — surface loudly rather
        // than swallow, per [[no-silent-fallbacks]].
        emitTelemetry("ws.hello_send_failed", { error: m.msg });
      } else if (m.kind === "ws_error") {
        emitTelemetry("ws.error", { type: m.msg });
      } else if (m.kind === "dropped_command") {
        // A mutating command was dropped because the socket was closed
        // (issue #18). Surface to the operator and the telemetry timeline.
        emitTelemetry("ws.dropped_command", { cmd: m.msg });
        messages.value = [...messages.value, { id: _nextMsgId++, kind: OPERATOR_ERROR, text: `Command dropped — not connected: ${m.msg}`, ts: Date.now() }];
        unreadCount.value++;
        persistMessages(messages.value);
      } else {
        emitTelemetry("ws.worker_error", { kind: m.kind, msg: m.msg });
      }
      break;

    case "message":
      onFrame(m.data);
      break;
  }
}

// Decode + dispatch one relayed frame. Body is the former ws.onmessage handler;
// `data` is a string (JSON) or ArrayBuffer (msgpack), transferred from the
// worker. msgpack decode stays on the main thread by design.
function onFrame(data: string | ArrayBuffer) {
    let msg: any;
    const _t0 = performance.now();
    try {
      if (typeof data === "string") {
        msg = JSON.parse(data);
        _pushSample("ws_bytes", data.length);
      } else {
        // Binary frame (msgpack). ArrayBuffer because binaryType = "arraybuffer".
        const buf = data;
        msg = msgpackDecode(new Uint8Array(buf));
        _pushSample("ws_bytes", buf.byteLength);
      }
    } catch (e) {
      console.error("WS: decode failed", e);
      return;
    }
    _pushSample("decode", performance.now() - _t0);

    // Server-authoritative armed state — update from every message that carries it
    if (msg.armed !== undefined) armed.value = msg.armed;

    if (msg.type === "server_shutdown") {
      // Lifespan broadcast immediately before WS close. Mark explicit so the
      // UI can distinguish from a network blip during the brief window
      // before onclose fires.
      serverShuttingDown.value = true;
      return;
    }

    if (msg.type === "pong") {
      // Pure network latency: heartbeat → immediate pong reply (diagnostic only)
      if (_heartbeatSentAt > 0) {
        networkLatency.value = Math.round(performance.now() - _heartbeatSentAt);
        _heartbeatSentAt = 0;
      }
      return;
    }

    // Experiment 2: server-side status deltas. Merge incoming changed fields
    // onto the most recent known data, then fall through as a normal status.
    // Server forces a full snapshot every N cycles and on reconnect, so any
    // drift self-heals within a few seconds.
    if (msg.type === "status_delta") {
      const base = _pendingStatus?.data ?? status.value?.data ?? {};
      msg.data = { ...base, ...(msg.data ?? {}) };
      msg.type = "status";
    }

    if (msg.type === "status") {
      // Only act on status messages that carry timing (heartbeat-triggered).
      // Plain status messages arrive first and must NOT consume _rtSentAt.
      if (msg.timing) {
        if (_rtSentAt > 0) {
          const rtMs = performance.now() - _rtSentAt;
          latency.value = Math.round(rtMs);
          _rtSentAt = 0;
          _pushSample("rt", rtMs);
          _pushSample("server", msg.timing.server_ms);
          _pushSample("network", rtMs - msg.timing.server_ms);
        }
        const t = msg.timing;
        if (t.cycle_ms != null) _pushSample("cycle", t.cycle_ms);
        if (t.poll_ms != null) _pushSample("poll", t.poll_ms);
        if (t.errors_ms != null) _pushSample("errors", t.errors_ms);
        if (t.parse_ms != null) _pushSample("parse", t.parse_ms);
        if (t.overhead_ms != null) _pushSample("overhead", t.overhead_ms);
        if (t.encode_ms != null) _pushSample("encode", t.encode_ms);
        if (t.shared_encode_ms != null) _pushSample("sharedEncode", t.shared_encode_ms);
        _recomputeTimingStats();
      }

      // Extract errors BEFORE rAF buffer to prevent message loss when
      // a newer status overwrites _pendingStatus before the frame fires.
      const errs: [number, string][] = msg.errors;
      if (Array.isArray(errs) && errs.length > 0) {
        for (const [kind, text] of errs) {
          messages.value = [...messages.value, { id: _nextMsgId++, kind, text, ts: Date.now() }];
          unreadCount.value++;
        }
        persistMessages(messages.value);
      }

      // Preserve tool_meta across batched messages — gateway sends it only
      // once per tool change, so if a second status overwrites _pendingStatus
      // before the rAF fires, the one-shot tool_meta would be lost forever.
      // tool_meta lives at top level; tool_number stays inside data (it comes
      // from linuxcnc.stat).
      if (msg.tool_meta && msg.data?.tool_number != null) {
        _lastToolMeta = { num: msg.data.tool_number, meta: msg.tool_meta };
      } else if (_lastToolMeta && msg.data?.tool_number === _lastToolMeta.num && !msg.tool_meta) {
        msg.tool_meta = _lastToolMeta.meta;
      }

      // Sync sticky safety-trip state from every status message. Gateway
      // includes the field while _unacked_trip is set; absence = no trip.
      // Update synchronously (not via the rAF buffer) so the dialog opens
      // on the first status after a trip without a frame of delay.
      // Only reassign when the value actually changes (P4.3) — reassigning the ref
      // each status allocated a fresh object AND re-triggered every watcher, even
      // when the trip reason was identical.
      if (msg.safety_trip) {
        if (safetyTrip.value?.reason !== msg.safety_trip.reason) {
          safetyTrip.value = { reason: msg.safety_trip.reason };
        }
      } else if (safetyTrip.value !== null) {
        safetyTrip.value = null;
      }
      // Reader staleness — set when gateway flag present, clear otherwise.
      const stale = msg.reader_stale === true;
      if (readerStale.value !== stale) readerStale.value = stale;

      // RFL guard progress (rfl_status rides the status fanout; ts dedupes —
      // the same phase repeats on every frame until the next one). Failures →
      // operator error; key progress phases → display message, so the operator
      // sees what the machine is doing during the pre-measure sequence.
      const rfl = msg.rfl_status;
      if (rfl && rfl.ts !== _lastRflTs) {
        _lastRflTs = rfl.ts;
        const phaseText: Record<string, string> = {
          measuring: "Run-from-line: measuring tool via MDI…",
          safe_z: "Run-from-line: retracting to safe Z…",
          starting: "Run-from-line: starting program…",
        };
        if (rfl.ok === false) {
          messages.value = [...messages.value, { id: _nextMsgId++, kind: OPERATOR_ERROR,
            text: `Run-from-line ${rfl.phase}: ${rfl.error || "failed"}`, ts: Date.now() }];
          unreadCount.value++;
          persistMessages(messages.value);
        } else if (phaseText[rfl.phase]) {
          messages.value = [...messages.value, { id: _nextMsgId++, kind: OPERATOR_DISPLAY,
            text: phaseText[rfl.phase]!, ts: Date.now() }];
          persistMessages(messages.value);
        }
      }

      const cw = msg.config_warning;
      if (cw) {
        const units = cw.units === true;
        if (configWarning.value?.reason !== cw.reason || configWarning.value?.units !== units) {
          configWarning.value = { reason: cw.reason, units };
        }
      } else if (configWarning.value !== null) {
        configWarning.value = null;
      }

      // Buffer status as plain data — flush to reactive ref once per rAF.
      // When messages queue up, only the latest triggers Vue reactivity.
      _pendingStatus = msg;
      lcncError.value = null;
      if (!_flushScheduled) {
        _flushScheduled = true;
        requestAnimationFrame(() => {
          _flushScheduled = false;
          if (_pendingStatus) {
            status.value = _pendingStatus;
            _pendingStatus = null;
          }
        });
      }
    } else if (msg.type === "status_error") {
      lcncError.value = msg.error;
      if (msg.clients != null) {
        status.value = { ...(status.value ?? {}), clients: msg.clients };
      }
    } else if (msg.type === "reply") {
      lastReply.value = msg;
      if (msg.ok === false && msg.error) {
        messages.value = [...messages.value, { id: _nextMsgId++, kind: OPERATOR_ERROR, text: `Command: ${msg.error}`, ts: Date.now() }];
        unreadCount.value++;
        persistMessages(messages.value);
      }
    } else if (msg.type === "viewer_init") {
      handleViewerInit(msg);
    } else if (msg.type === "viewer_gcode") {
      handleViewerGcode(msg);
    } else if (msg.type === "viewer_gcode_ready") {
      handleViewerGcodeReady(msg);
    } else if (msg.type === "surface_points_ready") {
      // The sink writes the status ref (stays here until the statusStore
      // extraction) — bulkData owns versioning/abort/decode, not the sink.
      fetchSurfacePoints(msg.version ?? 0,
        data => { status.value = { ...(status.value ?? {}), surface_points: data }; });
    } else if (msg.type === "comp_grid_ready") {
      fetchCompGrid(msg.version ?? 0,
        data => { status.value = { ...(status.value ?? {}), comp_grid: data }; });
    } else if (msg.type === "tool_table_changed") {
      handleToolTableChanged(msg);
    } else if (msg.type === "settings_changed" || msg.type === "settings_init") {
      updateServerCache(msg.settings);
    } else if (msg.type === "halshow_snapshot") {
      applyHalshowSnapshot(msg);
    } else if (msg.type === "halshow_update") {
      applyHalshowUpdate(msg);
    }
}

export function send(obj: WsCommand) {
  // Classify here (main thread) where the structured command is visible.
  // Mutating/motion commands must not be queued+replayed across a reconnect
  // (issue #18); the worker drops them if the socket is closed.
  sendCommand(JSON.stringify(obj), obj.cmd, !isQueueSafe(obj.cmd));
}

export function saveSettings(section: string, data: any) {
  send({ cmd: "save_settings", section, data });
}
// Let defaults.ts flush settings through us without importing this module (P6).
registerSettingsSaver(saveSettings);

export function acknowledgeSafetyTrip() {
  // Optimistic clear — gateway will also stop broadcasting safety_trip on the
  // next status cycle, so status-driven sync backs this up. If the send fails
  // (WS closed), the local value will repopulate from the next status.
  safetyTrip.value = null;
  send({ cmd: "safety_trip_ack" });
}

export function dismissMessage(id: number) {
  messages.value = messages.value.filter(m => m.id !== id);
  persistMessages(messages.value);
}

export function clearAllMessages() {
  messages.value = [];
  unreadCount.value = 0;
  persistMessages(messages.value);
}

export function markMessagesRead() {
  unreadCount.value = 0;
}

// Note: becoming-visible fires an immediate heartbeat via the worker — the
// `fireHeartbeat` flag in the visibilitychange handler above (updateConfig) —
// so last_hb is fresh right away without waiting up to 1 s for the timer.

// Clean up the WS worker on Vite HMR to prevent ghost clients.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    terminateTransport();
    // Remove module-level listeners so a hot reload doesn't stack them (#32).
    // ws/telemetry.ts disposes its own four lifecycle/error listeners.
    if (typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", _onVisibility);
    }
  });
}

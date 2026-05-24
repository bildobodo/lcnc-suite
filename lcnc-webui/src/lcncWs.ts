import { ref, shallowRef } from "vue";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { type WsCommand, OPERATOR_ERROR } from "./lcnc";
import { updateServerCache, loadDisplayDefaults, type Vec3 } from "./defaults";
import { enableWakeLock, disableWakeLock } from "./wakeLock";

// ---- Session id (per-tab, for armed-resume across brief reconnects) ----
// Persisted in sessionStorage so Ctrl-R keeps the same id; tab close clears
// it (intentional: a new tab means a fresh arming session). The gateway
// matches this id against an armed-resume hold registered on disconnect;
// if it matches within ~10 s, the new connection silently inherits
// armed=true. See gateway.py _armed_resume_holds.
const SESSION_STORAGE_KEY = "lcnc-session-id";
function _initSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const fresh = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(SESSION_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage unavailable (Safari private mode etc.) — generate a
    // per-page-load id; resume won't survive a reconnect but everything
    // else still works.
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
const _sessionId = _initSessionId();
// Tracks whether this tab was armed at the time its WS last closed. On the
// next WS open, we send {resume_armed: _prevArmed} so the gateway can decide
// whether to inherit armed state from the prior connection. Reset after use.
let _prevArmed = false;

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
export const safetyTrip = ref<{ ts: number; reason: string } | null>(null);
// HAL reader staleness: gateway sets `reader_stale: true` on status messages
// when no snapshot has arrived from hal_reader.py within ~2 s. Auto-clears
// when snapshots resume — distinct from safety_trip which requires operator
// ack. UI surfaces this as a non-blocking banner so display values that
// depend on the reader (spindle RPM, eoffset, probe input, comp state) are
// known to be stale rather than silently frozen.
export const readerStale = ref(false);

// Server is mid-shutdown (FastAPI lifespan teardown). Set when the gateway
// broadcasts `{type: "server_shutdown"}` immediately before closing WS
// connections. Distinguishes a planned shutdown from a network blip so the
// UI can show "Server shutting down" instead of the generic reconnect state.
// Cleared on the next successful WS open.
export const serverShuttingDown = ref(false);
// Most recent failure from the bulk-data fetches that feed the 3D viewer
// (preview, surface points, comp grid). Set in the fetch catch handlers,
// cleared on the next successful fetch. Surfaced in App.vue's status banner
// so the operator sees "preview is stale" rather than viewing a possibly
// outdated toolpath without warning.
export const previewLoadError = ref<string | null>(null);
// ---------- Browser → server telemetry batcher ----------
// Posts NDJSON batches to POST /telemetry where the gateway forwards each
// event to the suite-wide trace bus tagged `browser.<kind>`. Catches the
// signals we can't see from the server side: tab visibility (the known
// 12-tab-storm trigger), WS reconnect attempt cadence, send-buffer
// pressure, JS errors. Batched to keep request rate low.
const _telemetryQueue: Array<Record<string, any>> = [];
const _TELEMETRY_MAX_QUEUE = 200;
const _TELEMETRY_FLUSH_MS = 250;
const _TELEMETRY_BATCH_MAX = 32;
let _telemetryFlushScheduled = false;

export function emitTelemetry(kind: string, fields: Record<string, any> = {}): void {
  // performance.timing isn't valid for our wall-aligned ms but Date.now is;
  // include both so the bundler can correlate against gateway events.
  const evt = {
    kind,
    t_wall_ms: Date.now(),
    t_perf_ms: Math.round(performance.now()),
    ...fields,
  };
  _telemetryQueue.push(evt);
  if (_telemetryQueue.length > _TELEMETRY_MAX_QUEUE) {
    _telemetryQueue.splice(0, _telemetryQueue.length - _TELEMETRY_MAX_QUEUE);
  }
  if (!_telemetryFlushScheduled) {
    _telemetryFlushScheduled = true;
    setTimeout(_flushTelemetry, _TELEMETRY_FLUSH_MS);
  } else if (_telemetryQueue.length >= _TELEMETRY_BATCH_MAX) {
    // Hit the size threshold mid-window — flush early.
    _flushTelemetry();
  }
}

function _telemetryBody(events: Array<Record<string, any>>): string {
  return events.map(e => JSON.stringify(e)).join("\n");
}

function _flushTelemetry(): void {
  _telemetryFlushScheduled = false;
  if (_telemetryQueue.length === 0) return;
  // Take ownership of the current batch; new events queue up for next flush.
  const batch = _telemetryQueue.splice(0, _telemetryQueue.length);
  const body = _telemetryBody(batch);
  // Use fetch keepalive so the request can complete after navigation in
  // most modern browsers. sendBeacon is reserved for unload paths.
  try {
    fetch("/telemetry", {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body,
      keepalive: true,
    }).catch(() => { /* swallow — telemetry is best-effort */ });
  } catch {
    /* networking unavailable; drop silently */
  }
}

function _flushTelemetryViaBeacon(): void {
  if (_telemetryQueue.length === 0) return;
  try {
    const batch = _telemetryQueue.splice(0, _telemetryQueue.length);
    const body = _telemetryBody(batch);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/x-ndjson" });
      navigator.sendBeacon("/telemetry", blob);
    } else {
      // Last-ditch synchronous fetch (rarely needed; keepalive covers most).
      fetch("/telemetry", { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch { /* drop */ }
}

if (typeof window !== "undefined") {
  // Flush on tab close / navigation. Both events fire across browsers;
  // pagehide is the modern signal for bfcache, beforeunload for legacy.
  window.addEventListener("pagehide", () => {
    emitTelemetry("tab.pagehide", {});
    _flushTelemetryViaBeacon();
  });
  window.addEventListener("beforeunload", () => {
    emitTelemetry("tab.beforeunload", {});
    _flushTelemetryViaBeacon();
  });
  // Tab visibility changes — the known storm trigger.
  // Two effects:
  //   1. Emit a telemetry event for the trace bus (off-band signal).
  //   2. Send a `tab_visibility` WS command so the gateway can skip status
  //      fan-out to this client while hidden — backgrounded tabs stop
  //      draining the WS, fill the kernel TCP buffer, and stall the
  //      gateway's asyncio loop. Suppressing fan-out at the source
  //      eliminates the slow-consumer feedback loop.
  document.addEventListener("visibilitychange", () => {
    const hidden = document.hidden;
    emitTelemetry("tab.visibility", {
      visibilityState: document.visibilityState,
      hidden,
    });
    if (ws?.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ cmd: "tab_visibility", hidden }));
      } catch { /* WS may have closed mid-send; ignored */ }
    }
  });
  // Global error reporters → trace bus.
  window.addEventListener("error", (ev) => {
    emitTelemetry("error.console", {
      msg: String(ev.message ?? ""),
      filename: String(ev.filename ?? ""),
      lineno: Number(ev.lineno ?? 0),
      colno: Number(ev.colno ?? 0),
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    emitTelemetry("error.unhandled_rejection", {
      reason: String((ev as PromiseRejectionEvent).reason ?? ""),
    });
  });
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

// ---------- Halshow live state ----------
export interface HalPin {
  comp: string;
  type: string;
  dir: string;
  value: string;
  name: string;
  signal?: string;
  arrow?: string;
}

export interface HalSignalPin {
  arrow: string;
  pin: string;
}

export interface HalSignal {
  type: string;
  value: string;
  name: string;
  pins: HalSignalPin[];
}

export interface HalParam {
  comp: string;
  type: string;
  dir: string;
  value: string;
  name: string;
}

export const halPins = ref<HalPin[]>([]);
export const halSignals = ref<HalSignal[]>([]);
export const halParams = ref<HalParam[]>([]);
export const halInitialized = ref(false);

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

// Viewer payloads. Static `viewer_init` (machine description, INI config,
// kinematics, parts list) is delivered once per WS connection; dynamic
// `viewer_gcode` is delivered on every program load and carries the parsed
// preview polylines. Types live here so consumers (App.vue, ThreeViewer.vue)
// share one shape — no per-callsite `as any` / `as ViewerInit | null`.
export interface ViewerPart {
  id: string;
  file: string;
  group?: string | null;
  translate?: Vec3;
  rotate?: Vec3;
  // Legacy field names kept for backward compatibility with older payloads.
  parent?: string | null;
  t?: Vec3;
  r?: Vec3;
}
export type KinematicsList =
  | Array<{
      group: string;
      joint: number;
      type?: "translate" | "rotate";
      direction?: "x" | "y" | "z";
      axis?: [number, number, number];
      sign: number;
    }>
  | Record<string, { axis: number; sign: number }>;
export interface ViewerInit {
  units?: "mm" | "inch" | string;
  stl_base_url: string;
  groups?: Array<{ id: string; parent: string; translate?: Vec3 }>;
  parts: ViewerPart[];
  kinematics: KinematicsList;
  workGroup?: string;
  toolGroup?: string;
  machine_bounds?: { origin: Vec3; size: Vec3 };
  axes?: string[];
  ini_config?: Record<string, any>;
  [key: string]: any;  // gateway adds occasional extras (e.g. timestamp, git_sha)
}
export interface ViewerGcode {
  file?: string | null;
  feed?: number[][];
  feed_lines?: number[];
  rapid?: number[][];
  [key: string]: any;  // stats fields are folded in by GcodePanel watcher
}

export const viewerInit = ref<ViewerInit | null>(null);
export const viewerGcode = ref<ViewerGcode | null>(null);
// Tool-table version pinged by gateway after every save/add/delete/import.
// Components watch this ref and re-fetch via the existing get_tool_table RPC,
// so a remote edit propagates without manual refresh.
export const toolTableVersion = ref(0);
// File text for the currently loaded program. Fetched over HTTP (not WS) from
// GET /gcode when viewer_gcode arrives with a new file — keeps multi-MB bodies
// off the WS writer so the gateway's heartbeat loop isn't delayed by N-way
// broadcasts. Null when no program is loaded or the fetch failed.
export const gcodeContent = ref<string | null>(null);
let _gcodeContentFile: string | null = null;
let _gcodeFetchAbort: AbortController | null = null;

// Fetched preview state (polylines, stats, line numbers) for the currently
// loaded file. Fetched over HTTP on viewer_gcode_ready.
let _previewFetchAbort: AbortController | null = null;
let _previewLastVersion = -1;

// Surface-scan / comp-grid fetch guards. Same pattern as preview: per-channel
// AbortController so a newer version cancels an in-flight older fetch, and a
// "last version" sentinel to skip duplicate pings.
let _surfaceFetchAbort: AbortController | null = null;
let _surfaceLastVersion = -1;
let _compGridFetchAbort: AbortController | null = null;
let _compGridLastVersion = -1;

function _fetchBulk(
  url: string,
  version: number,
  getLast: () => number,
  setLast: (v: number) => void,
  getAbort: () => AbortController | null,
  setAbort: (ac: AbortController | null) => void,
  apply: (data: any) => void,
) {
  if (version === getLast()) return;
  setLast(version);
  const prev = getAbort();
  if (prev) { prev.abort(); }
  const ac = new AbortController();
  setAbort(ac);
  fetch(`${url}?v=${version}`, { signal: ac.signal })
    .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(buf => {
      if (getLast() !== version) return;  // newer version already won
      const data = msgpackDecode(new Uint8Array(buf));
      apply(data);
      previewLoadError.value = null;
    })
    .catch(err => {
      if (err?.name !== "AbortError") {
        console.error(`GET ${url} failed`, err);
        previewLoadError.value = `${url} failed: ${err?.message ?? err}`;
        if (getLast() === version) setLast(-1);  // let next bump retry
      }
    });
}

function _applyGcodeFile(nextFile: string | null) {
  if (nextFile === _gcodeContentFile) return;
  _gcodeContentFile = nextFile;
  if (_gcodeFetchAbort) { _gcodeFetchAbort.abort(); _gcodeFetchAbort = null; }
  if (!nextFile) {
    gcodeContent.value = null;
    return;
  }
  const ac = new AbortController();
  _gcodeFetchAbort = ac;
  const target = nextFile;
  fetch(`/gcode?path=${encodeURIComponent(target)}`, { signal: ac.signal })
    .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(text => {
      if (_gcodeContentFile === target) gcodeContent.value = text;
    })
    .catch(err => {
      if (err?.name !== "AbortError") {
        console.error("GET /gcode failed", err);
        if (_gcodeContentFile === target) gcodeContent.value = null;
      }
    });
}

function _fetchPreview(version: number) {
  if (version === _previewLastVersion) return;
  _previewLastVersion = version;
  if (_previewFetchAbort) { _previewFetchAbort.abort(); _previewFetchAbort = null; }
  const ac = new AbortController();
  _previewFetchAbort = ac;
  const url = `/preview?v=${version}`;
  fetch(url, { signal: ac.signal })
    .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(buf => {
      if (_previewLastVersion !== version) return;
      // msgpack decode returns `unknown`; we trust the gateway-side encoder
      // to produce a ViewerGcode-shaped payload.
      viewerGcode.value = msgpackDecode(new Uint8Array(buf)) as ViewerGcode;
      previewLoadError.value = null;
    })
    .catch(err => {
      if (err?.name !== "AbortError") {
        console.error("GET /preview failed", err);
        previewLoadError.value = `/preview failed: ${err?.message ?? err}`;
        // Let next version_bump retry; clear sentinel so retry fires.
        if (_previewLastVersion === version) _previewLastVersion = -1;
      }
    });
}

let _nextMsgId = _stored.length > 0 ? Math.max(..._stored.map(m => m.id)) + 1 : 1;


let ws: WebSocket | null = null;
// Heartbeat runs inside a dedicated Worker so its interval isn't throttled
// when the tab is backgrounded (Firefox/Chrome throttle main-thread
// setInterval to ~1/min after ~5min hidden; Worker timers are exempt).
let _hbWorker: Worker | null = null;
let _heartbeatSentAt = 0;   // used for network latency (pong)
let _rtSentAt = 0;           // used for round-trip latency (next status)

function _stopHeartbeatWorker() {
  if (_hbWorker) {
    try { _hbWorker.postMessage({ cmd: "stop" }); } catch (e) { console.warn("[ws] heartbeat worker stop postMessage failed", e); }
    _hbWorker.terminate();
    _hbWorker = null;
  }
}

let _wsLastConnectAttemptAt = 0;
let _wsAttemptCount = 0;
let _wsLastCloseAt = 0;
let _wsLastCloseCode = 0;
let _wsBufferPressureTimer: ReturnType<typeof setInterval> | null = null;

export function connectWs() {
  // Close previous connection if any (prevents leaks during HMR)
  if (ws) {
    ws.onclose = null; // prevent auto-reconnect from the old socket
    ws.close();
  }
  _stopHeartbeatWorker();

  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProto}//${location.host}/ws`;
  _wsAttemptCount++;
  _wsLastConnectAttemptAt = performance.now();
  emitTelemetry("ws.connect.attempt", {
    attempt: _wsAttemptCount,
    last_close_code: _wsLastCloseCode,
    gap_ms: _wsLastCloseAt ? Math.round(performance.now() - _wsLastCloseAt) : 0,
  });
  ws = new WebSocket(wsUrl);
  // Required so msgpack frames arrive as ArrayBuffer, not Blob (Blob decode
  // is async and would need an extra await). JSON text frames are unaffected.
  ws.binaryType = "arraybuffer";

  // Connect-attempt timeout. Vite's WS proxy holds upstream upgrades open
  // indefinitely while the gateway is down (browser sees a pending
  // CONNECTING state with no error). Probe data on 2026-05-01 caught a
  // single attempt sitting in CONNECTING for 272 s. We force-close after
  // 3 s so onclose fires and the normal 2 s setTimeout reconnect cadence
  // takes over — worst-case 5 s/cycle instead of "however long Vite
  // waits." This is the load-bearing mitigation; the surrounding _wsProbe
  // diagnostic that originally lived alongside it has been removed.
  const _connectTimer = setTimeout(() => {
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      try { ws.close(); } catch {}
    }
  }, 3000);

  ws.onopen = () => {
    clearTimeout(_connectTimer);
    const dt = Math.round(performance.now() - _wsLastConnectAttemptAt);
    emitTelemetry("ws.open", { dt_ms: dt, attempt: _wsAttemptCount });
    _wsAttemptCount = 0;
    connected.value = true;
    serverShuttingDown.value = false;
    // Tab handshake — must precede other commands so the gateway can
    // associate this connection with the prior tab's armed state (if any)
    // before the first heartbeat / fan-out arrives. `_prevArmed` captures
    // whether this tab was armed when its previous WS closed; on a brief
    // disconnect (Ctrl-R, Wi-Fi blip) the gateway may have a matching
    // armed-resume hold and will silently re-arm us. Reset after use so a
    // *future* close→open cycle starts from a fresh observation.
    if (ws) {
      try {
        ws.send(JSON.stringify({
          cmd: "hello",
          session: _sessionId,
          resume_armed: _prevArmed,
        }));
      } catch (e) {
        // Hello is the foundation of session-id resume — losing it means
        // the gateway never associates this connection with the prior
        // tab's armed-resume hold. Surface to telemetry rather than
        // swallowing, per [[no-silent-fallbacks]]. (Phase 2 / E5.)
        emitTelemetry("ws.hello_send_failed", {
          error: String((e as Error)?.message ?? e),
        });
      }
      _prevArmed = false;
    }
    // Acquire screen wake-lock if the user has it enabled. Releases on
    // ws.onclose. Per the architecture cleanup: kept here (not gated on
    // `armed`) so passive viewer tabs also stay awake while connected.
    try {
      if (loadDisplayDefaults().keepAwake) {
        void enableWakeLock();
      }
    } catch { /* defaults may be unavailable pre-init; fine */ }
    // Send initial tab visibility state to the gateway. Without this, a
    // tab that connected while already hidden would receive full fan-out
    // until the next visibilitychange event — which may never fire if the
    // user opens 12 tabs at once and only the front one becomes visible.
    if (ws) {
      try {
        ws.send(JSON.stringify({ cmd: "tab_visibility", hidden: document.hidden }));
      } catch { /* ignored */ }
    }
    // Buffer-pressure sampler: peek at ws.bufferedAmount once a second
    // while connected. Non-zero means the kernel/socket isn't draining
    // our writes — the symmetric problem to gateway-side TCP back-pressure.
    if (_wsBufferPressureTimer !== null) clearInterval(_wsBufferPressureTimer);
    _wsBufferPressureTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const buf = ws.bufferedAmount;
      if (buf > 0) {
        emitTelemetry("ws.send_buffer_pressure", { buffered_bytes: buf });
      }
    }, 1000);
    _hbWorker = new Worker(new URL("./heartbeatWorker.ts", import.meta.url), { type: "module" });
    _hbWorker.onmessage = () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Timestamp on the main thread — worker performance.now() is on a
        // different time origin and would mis-measure RTT by seconds.
        _heartbeatSentAt = _rtSentAt = performance.now();
        ws.send('{"cmd":"heartbeat"}');
      }
    };
    _hbWorker.postMessage({ cmd: "start" });
  };

  ws.onerror = (e) => {
    const dtAttempt = Math.round(performance.now() - _wsLastConnectAttemptAt);
    emitTelemetry("ws.error", { dt_ms: dtAttempt, type: (e as Event).type ?? "?" });
  };

  ws.onclose = (ev) => {
    clearTimeout(_connectTimer);
    const dtAttempt = Math.round(performance.now() - _wsLastConnectAttemptAt);
    _wsLastCloseAt = performance.now();
    _wsLastCloseCode = ev.code;
    emitTelemetry("ws.close", {
      code: ev.code,
      reason: String(ev.reason ?? ""),
      clean: ev.wasClean,
      since_attempt_ms: dtAttempt,
    });
    if (_wsBufferPressureTimer !== null) {
      clearInterval(_wsBufferPressureTimer);
      _wsBufferPressureTimer = null;
    }
    connected.value = false;
    // Capture armed state for the next reconnect's hello, then reset.
    // Lets the gateway match a still-valid armed-resume hold and silently
    // restore armed=true on a brief blip (Ctrl-R, Wi-Fi handoff).
    _prevArmed = armed.value;
    armed.value = false;     // new connection starts disarmed
    // Release the screen wake-lock when the WS drops. Re-acquired on the
    // next ws.onopen if the user setting is still on.
    try { disableWakeLock(); } catch { /* ignored */ }
    latency.value = null;
    networkLatency.value = null;
    _heartbeatSentAt = _rtSentAt = 0;
    _stopHeartbeatWorker();
    // The server forgets per-client halshow subscription on disconnect, so
    // any cached pin/signal/param values are stale snapshots that can shadow
    // real values until the operator switches tabs. Clear them here so the
    // halshow panel honestly shows "no data" until the next snapshot arrives.
    halPins.value = [];
    halSignals.value = [];
    halParams.value = [];
    halInitialized.value = false;
    setTimeout(() => connectWs(), 2000);
  };

  let _pendingStatus: any = null;
  let _flushScheduled = false;
  let _lastToolMeta: { num: number; meta: any } | null = null;

  ws.onmessage = (ev) => {
    let msg: any;
    const _t0 = performance.now();
    try {
      if (typeof ev.data === "string") {
        msg = JSON.parse(ev.data);
        _pushSample("ws_bytes", ev.data.length);
      } else {
        // Binary frame (msgpack). ArrayBuffer because binaryType = "arraybuffer".
        const buf = ev.data as ArrayBuffer;
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
      if (msg.safety_trip) {
        safetyTrip.value = { ts: msg.safety_trip.ts, reason: msg.safety_trip.reason };
      } else if (safetyTrip.value !== null) {
        safetyTrip.value = null;
      }
      // Reader staleness — set when gateway flag present, clear otherwise.
      const stale = msg.reader_stale === true;
      if (readerStale.value !== stale) readerStale.value = stale;

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
      viewerInit.value = msg.data;
    } else if (msg.type === "viewer_gcode") {
      // Empty-state path (file unloaded): gateway sends a plain viewer_gcode
      // with data.file = null. The "has data" case uses viewer_gcode_ready.
      viewerGcode.value = msg.data;
      _applyGcodeFile(msg.data?.file ?? null);
    } else if (msg.type === "viewer_gcode_ready") {
      // Full preview lives on the server; fetch the cached msgpack bytes
      // via HTTP so multi-MB polylines don't ride the single-threaded WS
      // writer and stall the heartbeat loop. `version` is a cache-buster.
      const version: number = msg.version ?? 0;
      const file: string | null = msg.file ?? null;
      _fetchPreview(version);
      _applyGcodeFile(file);
    } else if (msg.type === "surface_points_ready") {
      _fetchBulk(
        "/surface_points", msg.version ?? 0,
        () => _surfaceLastVersion, v => { _surfaceLastVersion = v; },
        () => _surfaceFetchAbort, ac => { _surfaceFetchAbort = ac; },
        data => { status.value = { ...(status.value ?? {}), surface_points: data }; },
      );
    } else if (msg.type === "comp_grid_ready") {
      _fetchBulk(
        "/comp_grid", msg.version ?? 0,
        () => _compGridLastVersion, v => { _compGridLastVersion = v; },
        () => _compGridFetchAbort, ac => { _compGridFetchAbort = ac; },
        data => { status.value = { ...(status.value ?? {}), comp_grid: data }; },
      );
    } else if (msg.type === "tool_table_changed") {
      toolTableVersion.value = msg.version ?? 0;
    } else if (msg.type === "settings_changed" || msg.type === "settings_init") {
      updateServerCache(msg.settings);
    } else if (msg.type === "halshow_snapshot") {
      halPins.value = msg.pins ?? [];
      halSignals.value = msg.signals ?? [];
      halParams.value = msg.params ?? [];
      halInitialized.value = true;
    } else if (msg.type === "halshow_update") {
      const pinDelta = msg.pins ?? {};
      const sigDelta = msg.signals ?? {};
      const paramDelta = msg.params ?? {};
      const knownPins = new Set(halPins.value.map(p => p.name));
      const knownSigs = new Set(halSignals.value.map(s => s.name));
      const knownParams = new Set(halParams.value.map(p => p.name));
      let unknownCount = 0;
      for (const p of halPins.value) {
        const v = pinDelta[p.name];
        if (v !== undefined) p.value = v;
      }
      for (const s of halSignals.value) {
        const v = sigDelta[s.name];
        if (v !== undefined) s.value = v;
      }
      for (const p of halParams.value) {
        const v = paramDelta[p.name];
        if (v !== undefined) p.value = v;
      }
      for (const k of Object.keys(pinDelta)) if (!knownPins.has(k)) unknownCount++;
      for (const k of Object.keys(sigDelta)) if (!knownSigs.has(k)) unknownCount++;
      for (const k of Object.keys(paramDelta)) if (!knownParams.has(k)) unknownCount++;
      // Unknown keys mean the local snapshot is out of sync with the server
      // (HAL graph rebuilt, or we missed a snapshot). Mark uninitialised so
      // the panel can ask the user to reload — silent shadowing would let the
      // user act on values that no longer match reality.
      if (unknownCount > 0 && halInitialized.value) {
        console.warn(`halshow_update: ${unknownCount} unknown key(s); snapshot is stale`);
        halInitialized.value = false;
      }
    }
  };
}

export function send(obj: WsCommand) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

export function saveSettings(section: string, data: any) {
  send({ cmd: "save_settings", section, data });
}

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

// Fire a heartbeat immediately when the tab becomes visible again — avoids
// waiting up to 1s for the next Worker tick so last_hb is fresh right away.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && ws?.readyState === WebSocket.OPEN) {
      _heartbeatSentAt = _rtSentAt = performance.now();
      ws.send('{"cmd":"heartbeat"}');
    }
  });
}

// Clean up WebSocket on Vite HMR to prevent ghost clients
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    _stopHeartbeatWorker();
  });
}

import { ref, shallowRef, computed, markRaw } from "vue";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { type WsCommand, OPERATOR_ERROR, OPERATOR_DISPLAY, isQueueSafe } from "./lcnc";
import { updateServerCache, loadDisplayDefaults, registerSettingsSaver, type Vec3 } from "./defaults";
import { enableWakeLock, disableWakeLock } from "./wakeLock";
import { withToken } from "./auth";

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
  disable_reason?: Record<string, any>;
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
// Most recent failure from the bulk-data fetches that feed the 3D viewer
// (preview, surface points, comp grid). Set in the fetch catch handlers,
// cleared on the next successful fetch. Surfaced in App.vue's status banner
// so the operator sees "preview is stale" rather than viewing a possibly
// outdated toolpath without warning.
// Per-channel load errors so a success on one fetch channel can't clear a real
// error on another (the three channels are independent HTTP fetches). The
// banner shows the union — first non-null wins.
const _previewErr = ref<string | null>(null);
const _surfaceErr = ref<string | null>(null);
const _compGridErr = ref<string | null>(null);
export const previewLoadError = computed<string | null>(
  () => _previewErr.value ?? _surfaceErr.value ?? _compGridErr.value,
);

type StatusSummary = {
  enabled: boolean;
  estop: boolean;
  homed: boolean;
  emcEnableIn: boolean | null;
  taskMode: number | null;
  motionMode: number | null;
  interpState: number | null;
  jointDiagnostics: Array<Record<string, any>>;
};

let _lastStatusSummary: StatusSummary | null = null;
let _lastSentCommand: { cmd: string; ts: number } | null = null;

function _pushMessage(kind: number, text: string, unread = true): void {
  messages.value = [...messages.value, { id: _nextMsgId++, kind, text, ts: Date.now() }];
  if (unread) unreadCount.value++;
  persistMessages(messages.value);
}

function _numericOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function _summarizeStatusData(data: Record<string, any> | undefined): StatusSummary {
  const safeData = data ?? {};
  return {
    enabled: Boolean(safeData.is_enabled ?? safeData.enabled),
    estop: Boolean(safeData.is_estop ?? safeData.estop),
    homed: Boolean(safeData.homed),
    emcEnableIn: safeData.emc_enable_in == null ? null : Boolean(safeData.emc_enable_in),
    taskMode: Number.isInteger(safeData.task_mode) ? safeData.task_mode : null,
    motionMode: Number.isInteger(safeData.motion_mode) ? safeData.motion_mode : null,
    interpState: Number.isInteger(safeData.interp_state) ? safeData.interp_state : null,
    jointDiagnostics: Array.isArray(safeData.joint_diagnostics) ? safeData.joint_diagnostics : [],
  };
}

function _jointName(index: number): string {
  return `joint${index}`;
}

function _followingErrorMessages(jointDiagnostics: Array<Record<string, any>>): string[] {
  const messages: string[] = [];
  for (const joint of jointDiagnostics) {
    const index = Number.isInteger(joint?.index) ? joint.index : 0;
    const current = _numericOrNull(joint?.ferror_current);
    const highmark = _numericOrNull(joint?.ferror_highmark);
    const limit = _numericOrNull(joint?.max_ferror);
    if (limit == null || !(limit > 0)) {
      continue;
    }
    if (current != null && Math.abs(current) >= limit) {
      messages.push(`${_jointName(index)} following error ${current.toFixed(4)} (limit ${limit.toFixed(4)})`);
      continue;
    }
    if (highmark != null && Math.abs(highmark) >= limit) {
      messages.push(`${_jointName(index)} following error peak ${highmark.toFixed(4)} (limit ${limit.toFixed(4)})`);
    }
  }
  return messages;
}

function _recentCommandWas(cmd: string, withinMs: number): boolean {
  return _lastSentCommand?.cmd === cmd && (Date.now() - _lastSentCommand.ts) < withinMs;
}

function _emitTransitionMessages(next: StatusSummary, msgErrors: Array<[number, string]> | undefined): void {
  const prev = _lastStatusSummary;
  if (!prev) {
    _lastStatusSummary = next;
    return;
  }

  const errorTexts = Array.isArray(msgErrors)
    ? msgErrors.map((entry) => Array.isArray(entry) ? String(entry[1] ?? "") : "").filter(Boolean)
    : [];
  const followingErrors = _followingErrorMessages(next.jointDiagnostics);
  const followingText = followingErrors[0] ?? "";
  const disabledTransition = prev.enabled && !next.enabled && !_recentCommandWas("machine_off", 2000);
  const estopTransition = !prev.estop && next.estop && !_recentCommandWas("estop", 2000);

  if (disabledTransition) {
    const detail = followingText || errorTexts[0] || "Machine disabled unexpectedly.";
    _pushMessage(OPERATOR_ERROR, `Machine disabled unexpectedly: ${detail}`);
  }

  if (estopTransition) {
    const detail = followingText || errorTexts[0] || "E-stop asserted by LinuxCNC or the safety chain.";
    _pushMessage(OPERATOR_ERROR, `E-stop asserted: ${detail}`);
  }

  if (prev.homed && !next.homed) {
    _pushMessage(OPERATOR_ERROR, "Machine lost homed state.");
  }

  if (followingErrors.length > 0 && !disabledTransition && !estopTransition) {
    const newErrors = followingErrors.filter((text) => !_followingErrorMessages(prev.jointDiagnostics).includes(text));
    for (const text of newErrors) {
      _pushMessage(OPERATOR_ERROR, text);
    }
  }

  _lastStatusSummary = next;
}

function _disableReasonMessage(disableReason: Record<string, any> | undefined): string | null {
  if (!disableReason || disableReason.kind !== "machine_disabled") {
    return null;
  }
  const currentErrors = Array.isArray(disableReason.recent_errors) ? disableReason.recent_errors : [];
  const previousErrors = Array.isArray(disableReason.previous_recent_errors) ? disableReason.previous_recent_errors : [];
  const firstError = [...currentErrors, ...previousErrors].find((entry: any) => Array.isArray(entry) && entry[1]);
  if (firstError) {
    return `Machine disabled unexpectedly: ${String(firstError[1])}`;
  }
  const currentCauses = Array.isArray(disableReason.likely_causes) ? disableReason.likely_causes : [];
  const previousCauses = Array.isArray(disableReason.previous_likely_causes) ? disableReason.previous_likely_causes : [];
  const firstCause = [...currentCauses, ...previousCauses].find(Boolean);
  if (firstCause) {
    return `Machine disabled unexpectedly: ${String(firstCause)}`;
  }
  return null;
}
// ---------- Browser → server telemetry batcher ----------
// Posts NDJSON batches to POST /telemetry where the gateway forwards each
// event to the suite-wide trace bus tagged `browser.<kind>`. Catches the
// signals we can't see from the server side: tab visibility (the known
// 12-tab-storm trigger), WS reconnect attempt cadence, send-buffer
// pressure, JS errors. Batched to keep request rate low.
const _telemetryQueue: Array<Record<string, any>> = [];
const _TELEMETRY_MAX_QUEUE = 200;
// 2 s flush window (was 250 ms): telemetry is best-effort diagnostics, so batch
// it into ~one POST every couple seconds instead of several per second (P0).
// A burst still flushes early on the _TELEMETRY_BATCH_MAX size trigger, and
// unload still flushes immediately via sendBeacon — only the steady trickle is
// coalesced, cutting /telemetry request rate (and its event-loop cost) sharply.
const _TELEMETRY_FLUSH_MS = 2000;
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

// Long-task observer (permanent diagnostic — quiet by design): report any main-thread task that blocks
// > 500 ms — on a contended box that can starve the heartbeat worker and disarm the
// client. The longtask API gives duration + start, not the JS culprit, so per-op timing
// (GcodePanel edit.seed_blocked / edit.split_blocked) pins the cause.
if (typeof PerformanceObserver !== "undefined") {
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration > 500) emitTelemetry("longtask", { ms: Math.round(e.duration), start_ms: Math.round(e.startTime) });
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch { /* longtask not supported (Safari/Firefox) — per-op timing still covers it */ }
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

// Named handlers (issue #32) so HMR dispose can remove them — anonymous
// listeners would otherwise stack one set per hot reload. Bodies unchanged.
const _onPagehide = () => {
  // Flush on tab close / navigation. Both events fire across browsers;
  // pagehide is the modern signal for bfcache, beforeunload for legacy.
  emitTelemetry("tab.pagehide", {});
  _flushTelemetryViaBeacon();
};
const _onBeforeunload = () => {
  emitTelemetry("tab.beforeunload", {});
  _flushTelemetryViaBeacon();
};
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
  if (wsWorker) {
    try {
      wsWorker.postMessage({ type: "updateConfig", hidden, fireHeartbeat: !hidden });
    } catch { /* ignored */ }
  }
};
const _onError = (ev: ErrorEvent) => {
  emitTelemetry("error.console", {
    msg: String(ev.message ?? ""),
    filename: String(ev.filename ?? ""),
    lineno: Number(ev.lineno ?? 0),
    colno: Number(ev.colno ?? 0),
  });
};
const _onRejection = (ev: PromiseRejectionEvent) => {
  emitTelemetry("error.unhandled_rejection", {
    reason: String(ev.reason ?? ""),
  });
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", _onPagehide);
  window.addEventListener("beforeunload", _onBeforeunload);
  document.addEventListener("visibilitychange", _onVisibility);
  window.addEventListener("error", _onError);
  window.addEventListener("unhandledrejection", _onRejection);
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

// HALshow: persistent name→index maps, rebuilt only when a snapshot arrives (review #7).
// Avoids allocating three Sets + scanning every pin/signal/param on every 5 Hz value
// update — each update then applies only its (few) delta keys via O(1) lookups.
let _halPinIdx = new Map<string, number>();
let _halSigIdx = new Map<string, number>();
let _halParamIdx = new Map<string, number>();

function _buildHalIndex(arr: Array<{ name: string }>): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < arr.length; i++) m.set(arr[i]!.name, i);
  return m;
}

function _applyHalDelta(
  delta: Record<string, string>,
  arr: Array<{ value: string }>,
  idx: Map<string, number>,
): number {
  let unknown = 0;
  for (const k in delta) {
    const i = idx.get(k);
    if (i === undefined) { unknown++; continue; }  // key not in the snapshot → stale
    arr[i]!.value = delta[k]!;
  }
  return unknown;
}

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
  feed?: number[][] | Uint8Array;  // wire: LE float32 bin (preferred) | legacy nested
  rapid?: number[][] | Uint8Array;
  feed_lines?: number[] | Uint32Array | Uint8Array;  // wire: LE uint32 bin | legacy list
  // P4.1: flat position buffers produced off-thread by previewWorker (preferred
  // over the nested arrays — ThreeViewer builds BufferAttributes directly).
  feedPos?: Float32Array;          // flat [x,y,z, ...]
  rapidPos?: Float32Array;
  // P4.1: bounding box of the rendered polyline, computed in the parse worker so
  // ThreeViewer skips an O(n) main-thread scan per load.
  bounds?: { min: number[]; max: number[] } | null;
  // P4.1: source-line → point-index range map, built off-thread by previewWorker
  // (Maps survive structured clone) so ThreeViewer skips the O(points) build.
  feedLineMap?: Map<number, { start: number; end: number }>;
  // P4.1: cumulative lineDistance for the dashed rapid line, computed off-thread so
  // ThreeViewer sets the attribute directly instead of Three.computeLineDistances().
  rapidDist?: Float32Array;
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
// Preview version of the currently-fetched text. An in-place edit (web Save or
// external edit) keeps the path constant but bumps the version, so we must
// refetch on a version change too — otherwise the text panel shows stale code
// even though the file on disk (and the 3D preview) changed.
let _gcodeContentVersion = -1;
let _gcodeFetchAbort: AbortController | null = null;

// Fetched preview state (polylines, stats, line numbers) for the currently
// loaded file. Loaded off-thread by previewWorker on viewer_gcode_ready;
// staleness handled by the _previewLastVersion guard on the worker reply.
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
  setError: (e: string | null) => void,
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
      setError(null);  // clear only THIS channel's error
    })
    .catch(err => {
      if (err?.name !== "AbortError") {
        console.error(`GET ${url} failed`, err);
        setError(`${url} failed: ${err?.message ?? err}`);
        if (getLast() === version) setLast(-1);  // let next bump retry
      }
    });
}

function _applyGcodeFile(nextFile: string | null, version = -1) {
  // Refetch when the path OR the preview version changed. Same-path edits keep
  // the path but bump the version (see _gcodeContentVersion).
  if (nextFile === _gcodeContentFile && version === _gcodeContentVersion) return;
  _gcodeContentFile = nextFile;
  _gcodeContentVersion = version;
  if (_gcodeFetchAbort) { _gcodeFetchAbort.abort(); _gcodeFetchAbort = null; }
  if (!nextFile) {
    gcodeContent.value = null;
    return;
  }
  const ac = new AbortController();
  _gcodeFetchAbort = ac;
  const target = nextFile;
  const ver = version;
  // `v` is a cache-buster: FileResponse sets an mtime ETag but no immutable
  // header, so a same-path refetch could otherwise be served from cache. The
  // gateway ignores the unknown query param.
  fetch(`/gcode?path=${encodeURIComponent(target)}&v=${ver}`, { signal: ac.signal })
    .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
    .then(text => {
      if (_gcodeContentFile === target && _gcodeContentVersion === ver) gcodeContent.value = text;
    })
    .catch(err => {
      if (err?.name !== "AbortError") {
        console.error("GET /gcode failed", err);
        if (_gcodeContentFile === target && _gcodeContentVersion === ver) gcodeContent.value = null;
      }
    });
}

// Off-main-thread preview loader (P4.1). The fetch + multi-MB msgpack decode +
// nested→flat conversion run in previewWorker so they don't block the UI thread
// (which starved the heartbeat worker → disarm-on-load). Staleness is handled by
// the version guard on the reply rather than an AbortController across the worker
// boundary; a superseded decode still completes off-thread but its result is
// dropped.
let _previewWorker: Worker | null = null;

function _ensurePreviewWorker(): Worker {
  if (_previewWorker) return _previewWorker;
  _previewWorker = new Worker(new URL("./previewWorker.ts", import.meta.url), { type: "module" });
  _previewWorker.onmessage = (ev: MessageEvent) => {
    const m = ev.data as { version: number; gcode?: ViewerGcode; error?: string };
    if (m.version !== _previewLastVersion) return;  // stale — newer load in flight
    if (m.error) {
      console.error("preview load failed", m.error);
      _previewErr.value = `/preview failed: ${m.error}`;
      if (_previewLastVersion === m.version) _previewLastVersion = -1;  // allow retry
      return;
    }
    // markRaw: the payload holds transferred Float32Array/Uint32Array buffers;
    // letting Vue deep-proxy them would wrap the typed arrays in a Proxy, which
    // breaks/slows THREE.BufferAttribute's GPU upload. Consumers only react to
    // the ref reassignment, not deep mutation, so raw is correct here.
    viewerGcode.value = m.gcode ? markRaw(m.gcode) : null;
    _previewErr.value = null;
  };
  _previewWorker.onerror = (ev) => {
    console.error("previewWorker error", ev.message);
    _previewErr.value = `preview worker error: ${ev.message}`;
    _previewLastVersion = -1;
  };
  return _previewWorker;
}

function _fetchPreview(version: number) {
  if (version === _previewLastVersion) return;
  _previewLastVersion = version;
  _ensurePreviewWorker().postMessage({ version, url: `/preview?v=${version}` });
}

let _nextMsgId = _stored.length > 0 ? Math.max(..._stored.map(m => m.id)) + 1 : 1;


// The WebSocket now lives inside a dedicated Worker (wsWorker.ts) so the 1 Hz
// heartbeat is generated AND sent off the main thread — immune to main-thread
// jank (fast editor typing, heavy 30 Hz reactive updates) that previously
// starved the send and caused spurious disarms. The worker is a transparent
// transport proxy; all message interpretation + reactive state stay here.
let wsWorker: Worker | null = null;
let _heartbeatSentAt = 0;   // used for network latency (pong)
let _rtSentAt = 0;           // used for round-trip latency (next status)

// Status batching + one-shot tool_meta carry-over. Module scope so they
// persist across the relay (previously closure-locals inside connectWs).
let _pendingStatus: any = null;
let _lastRflTs = 0;   // dedupe for rfl_status frames (same phase repeats per tick)
let _flushScheduled = false;
let _lastToolMeta: { num: number; meta: any } | null = null;

function _terminateWsWorker() {
  if (wsWorker) {
    try { wsWorker.postMessage({ type: "close" }); } catch { /* ignore */ }
    wsWorker.terminate();
    wsWorker = null;
  }
}

export function connectWs() {
  // The worker owns reconnect; connectWs is only called for the initial
  // connection and on HMR. Tear down any prior worker first (HMR safety).
  _terminateWsWorker();

  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  // In dev the page is served by Vite (:5173), and a proxied /ws would relay the
  // client heartbeat through the single-threaded node dev server. That proxy hop
  // caused false disarms: a page-reload transform storm delayed relayed WS frames
  // > 3 s while browser AND gateway were demonstrably healthy (worker hb_slip=0,
  // no buffer pressure, no gateway HB-WAKE — the frames sat in node). The deadman
  // heartbeat must not ride a dev-only proxy: connect the WS straight to the
  // gateway. The gateway's dev origin rule explicitly admits :5173 origins for
  // this. Production builds (import.meta.env.DEV=false) keep location.host —
  // there the gateway serves the page itself and there is no proxy.
  const wsHost = import.meta.env.DEV
    ? `${location.hostname}:${import.meta.env.VITE_GATEWAY_PORT ?? 8000}`
    : location.host;
  // Token rides in the URL so the worker replays it for free on every
  // reconnect (browsers can't set WS headers). Empty token ⇒ unchanged URL.
  const wsUrl = withToken(`${wsProto}//${wsHost}/ws`);
  // Identify the browser engine in the trace: WS-delivery behavior differs per
  // engine (WebKit proxies worker WebSocket I/O via the main thread; Chromium
  // uses a separate network process), which matters for hb-stall attribution.
  emitTelemetry("ws.client_env", { ua: navigator.userAgent, ws_host: wsHost });
  wsWorker = new Worker(new URL("./wsWorker.ts", import.meta.url), { type: "module" });
  wsWorker.onmessage = (ev: MessageEvent) => onWorkerMessage(ev.data);
  wsWorker.postMessage({
    type: "connect",
    url: wsUrl,
    session: _sessionId,
    resumeArmed: _prevArmed,
    hidden: typeof document !== "undefined" ? document.hidden : false,
  });
  _prevArmed = false; // handed to the worker; reset for the next close→open
}

// Relay of worker → main events. Reactive ref updates that used to live in
// ws.onopen / ws.onclose / ws.onmessage stay here on the main thread.
function onWorkerMessage(m: any) {
  switch (m?.type) {
    case "open":
      emitTelemetry("ws.open", { dt_ms: m.dtMs, attempt: m.attempt });
      connected.value = true;
      serverShuttingDown.value = false;
      _lastStatusSummary = null;
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
      _lastStatusSummary = null;
      connected.value = false;
      // Capture armed state so the worker's NEXT reconnect hello can ask the
      // gateway to restore armed=true via a still-valid armed-resume hold.
      _prevArmed = armed.value;
      armed.value = false;     // new connection starts disarmed
      try { disableWakeLock(); } catch { /* ignored */ }
      latency.value = null;
      networkLatency.value = null;
      _heartbeatSentAt = _rtSentAt = 0;
      // The server forgets per-client halshow subscription on disconnect, so
      // cached pin/signal/param values are stale snapshots that could shadow
      // real values. Clear them so the panel honestly shows "no data".
      halPins.value = [];
      halSignals.value = [];
      halParams.value = [];
      halInitialized.value = false;
      // Hand the freshly-captured armed state to the worker for its reconnect.
      if (wsWorker) {
        try { wsWorker.postMessage({ type: "updateConfig", resumeArmed: _prevArmed }); } catch { /* ignore */ }
      }
      _prevArmed = false;
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
      const latchedDisableMessage = _disableReasonMessage(msg.disable_reason);
      if (latchedDisableMessage) {
        _pushMessage(OPERATOR_ERROR, latchedDisableMessage);
      }

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
          _pushMessage(kind, text);
        }
      }

      if (!latchedDisableMessage) {
        _emitTransitionMessages(_summarizeStatusData(msg.data), errs);
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
          _pushMessage(OPERATOR_ERROR, `Run-from-line ${rfl.phase}: ${rfl.error || "failed"}`);
        } else if (phaseText[rfl.phase]) {
          _pushMessage(OPERATOR_DISPLAY, phaseText[rfl.phase]!, false);
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
        _pushMessage(OPERATOR_ERROR, `Command: ${msg.error}`);
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
      _applyGcodeFile(file, version);
    } else if (msg.type === "surface_points_ready") {
      _fetchBulk(
        "/surface_points", msg.version ?? 0,
        () => _surfaceLastVersion, v => { _surfaceLastVersion = v; },
        () => _surfaceFetchAbort, ac => { _surfaceFetchAbort = ac; },
        data => { status.value = { ...(status.value ?? {}), surface_points: data }; },
        e => { _surfaceErr.value = e; },
      );
    } else if (msg.type === "comp_grid_ready") {
      _fetchBulk(
        "/comp_grid", msg.version ?? 0,
        () => _compGridLastVersion, v => { _compGridLastVersion = v; },
        () => _compGridFetchAbort, ac => { _compGridFetchAbort = ac; },
        data => { status.value = { ...(status.value ?? {}), comp_grid: data }; },
        e => { _compGridErr.value = e; },
      );
    } else if (msg.type === "tool_table_changed") {
      toolTableVersion.value = msg.version ?? 0;
    } else if (msg.type === "settings_changed" || msg.type === "settings_init") {
      updateServerCache(msg.settings);
    } else if (msg.type === "halshow_snapshot") {
      halPins.value = msg.pins ?? [];
      halSignals.value = msg.signals ?? [];
      halParams.value = msg.params ?? [];
      _halPinIdx = _buildHalIndex(halPins.value);
      _halSigIdx = _buildHalIndex(halSignals.value);
      _halParamIdx = _buildHalIndex(halParams.value);
      halInitialized.value = true;
    } else if (msg.type === "halshow_update") {
      // Apply only the delta keys via the persistent index maps (review #7) — no
      // per-update Set allocation, no full-array scans.
      const unknownCount =
        _applyHalDelta(msg.pins ?? {}, halPins.value, _halPinIdx)
        + _applyHalDelta(msg.signals ?? {}, halSignals.value, _halSigIdx)
        + _applyHalDelta(msg.params ?? {}, halParams.value, _halParamIdx);
      // Unknown keys mean the local snapshot is out of sync with the server
      // (HAL graph rebuilt, or we missed a snapshot). Mark uninitialised so
      // the panel can ask the user to reload — silent shadowing would let the
      // user act on values that no longer match reality.
      if (unknownCount > 0 && halInitialized.value) {
        console.warn(`halshow_update: ${unknownCount} unknown key(s); snapshot is stale`);
        halInitialized.value = false;
      }
    }
}

export function send(obj: WsCommand) {
  _lastSentCommand = { cmd: obj.cmd, ts: Date.now() };
  if (wsWorker) {
    // Classify here (main thread) where the structured command is visible.
    // Mutating/motion commands must not be queued+replayed across a reconnect
    // (issue #18); the worker drops them if the socket is closed.
    wsWorker.postMessage({
      type: "send",
      payload: JSON.stringify(obj),
      cmd: obj.cmd,
      dropIfClosed: !isQueueSafe(obj.cmd),
    });
  }
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
    _terminateWsWorker();
    // Remove module-level listeners so a hot reload doesn't stack them (#32).
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", _onPagehide);
      window.removeEventListener("beforeunload", _onBeforeunload);
      document.removeEventListener("visibilitychange", _onVisibility);
      window.removeEventListener("error", _onError);
      window.removeEventListener("unhandledrejection", _onRejection);
    }
  });
}

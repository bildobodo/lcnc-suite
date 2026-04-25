import { ref, shallowRef } from "vue";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { type WsCommand, OPERATOR_ERROR } from "./lcnc";
import { updateServerCache } from "./defaults";

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
  } catch { /* ignore */ }
  return [];
}

function persistMessages(msgs: LcncMessage[]) {
  const trimmed = msgs.slice(-MSG_MAX);
  try { localStorage.setItem(MSG_STORAGE_KEY, JSON.stringify(trimmed)); } catch { /* ignore */ }
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

export const viewerInit = ref<any>(null);
export const viewerGcode = ref<any>(null);
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
    })
    .catch(err => {
      if (err?.name !== "AbortError") {
        console.error(`GET ${url} failed`, err);
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
      viewerGcode.value = msgpackDecode(new Uint8Array(buf)) as any;
    })
    .catch(err => {
      if (err?.name !== "AbortError") {
        console.error("GET /preview failed", err);
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
    try { _hbWorker.postMessage({ cmd: "stop" }); } catch { /* ignore */ }
    _hbWorker.terminate();
    _hbWorker = null;
  }
}

export function connectWs() {
  // Close previous connection if any (prevents leaks during HMR)
  if (ws) {
    ws.onclose = null; // prevent auto-reconnect from the old socket
    ws.close();
  }
  _stopHeartbeatWorker();

  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProto}//${location.host}/ws`;
  ws = new WebSocket(wsUrl);
  // Required so msgpack frames arrive as ArrayBuffer, not Blob (Blob decode
  // is async and would need an extra await). JSON text frames are unaffected.
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    connected.value = true;
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

  ws.onclose = () => {
    connected.value = false;
    armed.value = false;     // new connection starts disarmed
    latency.value = null;
    networkLatency.value = null;
    _heartbeatSentAt = _rtSentAt = 0;
    _stopHeartbeatWorker();
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
      if (msg.data?.tool_meta && msg.data?.tool_number != null) {
        _lastToolMeta = { num: msg.data.tool_number, meta: msg.data.tool_meta };
      } else if (_lastToolMeta && msg.data?.tool_number === _lastToolMeta.num && !msg.data?.tool_meta) {
        msg.data.tool_meta = _lastToolMeta.meta;
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
    }
  };


  ws.onerror = (e) => {
    console.error("WS error", e);
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

import { ref, shallowRef } from "vue";
import { type WsCommand, OPERATOR_ERROR } from "./lcnc";
import { updateServerCache } from "./defaults";

export interface LcncMessage {
  id: number;
  kind: number;     // See NML_ERROR..OPERATOR_DISPLAY constants in lcnc.ts
  text: string;
  ts: number;       // Date.now() when received
}

export const connected = ref(false);
export const status = shallowRef<any>(null);
export const lastReply = ref<any>(null);
export const lcncError = ref<string | null>(null);
export const armed = ref(false);        // server-authoritative — driven by gateway messages
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
  count: number;
}

export const timingStats = ref<TimingStats | null>(null);

const TIMING_MAX_SAMPLES = 300;

type TimingKey = "rt" | "network" | "server" | "cycle" | "poll" | "errors" | "parse" | "overhead";
const _timingSamples: Record<TimingKey, number[]> = {
  rt: [], network: [], server: [], cycle: [], poll: [], errors: [], parse: [], overhead: [],
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
  const keys: TimingKey[] = ["rt", "network", "server", "cycle", "poll", "errors", "parse", "overhead"];
  const stats = {} as Record<TimingKey, TimingComponentStats>;
  for (const k of keys) stats[k] = _computeComponentStats(_timingSamples[k]);
  timingStats.value = { ...stats, count: _timingSamples.rt.length };
}

export function resetTimingStats() {
  for (const k of Object.keys(_timingSamples) as TimingKey[]) _timingSamples[k] = [];
  timingStats.value = null;
}

export function getTimingCsv(): string {
  const keys: TimingKey[] = ["rt", "network", "server", "cycle", "poll", "errors", "parse", "overhead"];
  const maxLen = Math.max(...keys.map(k => _timingSamples[k].length));
  const lines = [keys.join(",")];
  for (let i = 0; i < maxLen; i++) {
    lines.push(keys.map(k => _timingSamples[k][i] ?? "").join(","));
  }
  return lines.join("\n");
}

export const viewerInit = ref<any>(null);
export const viewerGcode = ref<any>(null);

let _nextMsgId = _stored.length > 0 ? Math.max(..._stored.map(m => m.id)) + 1 : 1;


let ws: WebSocket | null = null;
let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let _heartbeatSentAt = 0;   // used for network latency (pong)
let _rtSentAt = 0;           // used for round-trip latency (next status)

export function connectWs() {
  // Close previous connection if any (prevents leaks during HMR)
  if (ws) {
    ws.onclose = null; // prevent auto-reconnect from the old socket
    ws.close();
  }
  if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }

  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProto}//${location.host}/ws`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connected.value = true;
    _heartbeatInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        _heartbeatSentAt = _rtSentAt = performance.now();
        ws.send('{"cmd":"heartbeat"}');
      }
    }, 1000);
  };

  ws.onclose = () => {
    connected.value = false;
    armed.value = false;     // new connection starts disarmed
    latency.value = null;
    networkLatency.value = null;
    _heartbeatSentAt = _rtSentAt = 0;
    if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
    setTimeout(() => connectWs(), 2000);
  };

  let _pendingStatus: any = null;
  let _flushScheduled = false;
  let _lastToolMeta: { num: number; meta: any } | null = null;

  ws.onmessage = (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      console.error("WS: invalid JSON", ev.data);
      return;
    }

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
      viewerGcode.value = msg.data;
    } else if (msg.type === "settings_changed" || msg.type === "settings_init") {
      updateServerCache(msg.settings);
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

// Clean up WebSocket on Vite HMR to prevent ghost clients
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (ws) { ws.onclose = null; ws.close(); ws = null; }
    if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
  });
}

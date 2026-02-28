import { ref, shallowRef } from "vue";
import { type WsCommand, OPERATOR_ERROR } from "./lcnc";

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
      // Pure network latency: heartbeat → immediate pong reply
      if (_heartbeatSentAt > 0) {
        networkLatency.value = Math.round(performance.now() - _heartbeatSentAt);
        _heartbeatSentAt = 0;
      }
      return;
    }

    if (msg.type === "status") {
      // Round-trip latency: heartbeat → next status (includes poll wait)
      if (_rtSentAt > 0) {
        latency.value = Math.round(performance.now() - _rtSentAt);
        _rtSentAt = 0;
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
      console.log("viewer_init", msg.data);
      viewerInit.value = msg.data;
    } else if (msg.type === "viewer_gcode") {
      viewerGcode.value = msg.data;
    } else {
      console.debug("WS msg", msg);
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

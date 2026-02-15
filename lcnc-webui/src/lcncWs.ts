import { ref, shallowRef } from "vue";

export interface LcncMessage {
  id: number;
  kind: number;     // 1=NML_ERROR, 2=OPERATOR_ERROR, 3=NML_TEXT, 4=OPERATOR_TEXT, 5=NML_DISPLAY, 6=OPERATOR_DISPLAY
  text: string;
  ts: number;       // Date.now() when received
}

export const connected = ref(false);
export const status = shallowRef<any>(null);
export const lastReply = ref<any>(null);
export const lcncError = ref<string | null>(null);
export const messages = ref<LcncMessage[]>([]);
export const unreadCount = ref(0);

export const latency = ref<number | null>(null);

export const viewerInit = ref<any>(null);
export const viewerGcode = ref<any>(null);

let _nextMsgId = 1;


let ws: WebSocket | null = null;
let _heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let _heartbeatSentAt = 0;

export function connectWs() {
  // Close previous connection if any (prevents leaks during HMR)
  if (ws) {
    ws.onclose = null; // prevent auto-reconnect from the old socket
    ws.close();
  }
  if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }

  const host = (location.hostname === "localhost") ? "127.0.0.1" : location.hostname;
  const wsUrl = `ws://${host}:8000/ws`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    connected.value = true;
    _heartbeatInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        _heartbeatSentAt = performance.now();
        ws.send('{"cmd":"heartbeat"}');
      }
    }, 1000);
  };

  ws.onclose = () => {
    connected.value = false;
    latency.value = null;
    _heartbeatSentAt = 0;
    if (_heartbeatInterval) { clearInterval(_heartbeatInterval); _heartbeatInterval = null; }
    setTimeout(() => connectWs(), 2000);
  };

  let _pendingStatus: any = null;
  let _flushScheduled = false;

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "status") {
      // Measure heartbeat round-trip latency
      if (_heartbeatSentAt > 0) {
        latency.value = Math.round(performance.now() - _heartbeatSentAt);
        _heartbeatSentAt = 0;
      }

      // Extract errors BEFORE rAF buffer to prevent message loss when
      // a newer status overwrites _pendingStatus before the frame fires.
      const errs: [number, string][] = msg.errors;
      if (Array.isArray(errs) && errs.length > 0) {
        for (const [kind, text] of errs) {
          messages.value = [...messages.value, { id: _nextMsgId++, kind, text, ts: Date.now() }];
          unreadCount.value++;
        }
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
        messages.value = [...messages.value, { id: _nextMsgId++, kind: 2, text: `Command: ${msg.error}`, ts: Date.now() }];
        unreadCount.value++;
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

export function send(obj: any) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

export function dismissMessage(id: number) {
  messages.value = messages.value.filter(m => m.id !== id);
}

export function clearAllMessages() {
  messages.value = [];
  unreadCount.value = 0;
}

export function markMessagesRead() {
  unreadCount.value = 0;
}

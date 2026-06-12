// WS worker transport (frontend split, A1.4 — extracted from lcncWs.ts).
//
// The WebSocket lives inside a dedicated Worker (wsWorker.ts) so the 1 Hz
// heartbeat is generated AND sent off the main thread — immune to main-thread
// jank (fast editor typing, heavy 30 Hz reactive updates) that previously
// starved the send and caused spurious disarms. The worker is a transparent
// transport proxy; all message interpretation + reactive state stay in lcncWs
// (the orchestrator), which receives every worker event via the onEvent
// callback handed to connectTransport.
//
// Leaf module: imports ../auth only; never imports lcncWs or its peers. No
// telemetry from here — the orchestrator emits around the calls. Reassigned
// scalars (worker handle, resume flag) are private by design (A1 rule).
import { withToken } from "../auth";

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
// next WS open, the worker sends {resume_armed: _prevArmed} so the gateway
// can decide whether to inherit armed state from the prior connection.
// Reset after use.
let _prevArmed = false;

let wsWorker: Worker | null = null;

/**
 * Compute the WS endpoint URL. In dev the page is served by Vite (:5173), and
 * a proxied /ws would relay the client heartbeat through the single-threaded
 * node dev server. That proxy hop caused false disarms: a page-reload
 * transform storm delayed relayed WS frames > 3 s while browser AND gateway
 * were demonstrably healthy (worker hb_slip=0, no buffer pressure, no gateway
 * HB-WAKE — the frames sat in node). The deadman heartbeat must not ride a
 * dev-only proxy: connect the WS straight to the gateway. The gateway's dev
 * origin rule explicitly admits :5173 origins for this. Production builds
 * (import.meta.env.DEV=false) keep location.host — there the gateway serves
 * the page itself and there is no proxy.
 *
 * The token rides in the URL so the worker replays it for free on every
 * reconnect (browsers can't set WS headers). Empty token ⇒ unchanged URL.
 */
export function buildWsUrl(): string {
  const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsHost = import.meta.env.DEV
    ? `${location.hostname}:${import.meta.env.VITE_GATEWAY_PORT ?? 8000}`
    : location.host;
  return withToken(`${wsProto}//${wsHost}/ws`);
}

/**
 * Spawn the WS worker and connect. The worker owns reconnect; this is only
 * called for the initial connection and on HMR (any prior worker is torn
 * down first — HMR safety). Every worker event is relayed to onEvent.
 */
export function connectTransport(url: string, onEvent: (m: any) => void): void {
  terminateTransport();
  wsWorker = new Worker(new URL("../wsWorker.ts", import.meta.url), { type: "module" });
  wsWorker.onmessage = (ev: MessageEvent) => onEvent(ev.data);
  wsWorker.postMessage({
    type: "connect",
    url,
    session: _sessionId,
    resumeArmed: _prevArmed,
    hidden: typeof document !== "undefined" ? document.hidden : false,
  });
  _prevArmed = false; // handed to the worker; reset for the next close→open
}

/**
 * Post a structured command for the socket. Mutating/motion commands must not
 * be queued+replayed across a reconnect (issue #18); the caller classifies
 * (it sees the structured command) and the worker drops dropIfClosed sends
 * when the socket is closed. No-op when no worker exists.
 */
export function sendCommand(payload: string, cmd: string, dropIfClosed: boolean): void {
  if (wsWorker) {
    wsWorker.postMessage({ type: "send", payload, cmd, dropIfClosed });
  }
}

/** Relay config to the worker (hidden state, immediate heartbeat, resume). */
export function postWorkerConfig(cfg: Record<string, unknown>): void {
  if (wsWorker) {
    try { wsWorker.postMessage({ type: "updateConfig", ...cfg }); } catch { /* ignored */ }
  }
}

/**
 * WS close: capture whether the tab was armed so the worker's NEXT reconnect
 * hello can ask the gateway to restore armed=true via a still-valid
 * armed-resume hold.
 */
export function captureArmedForResume(armedNow: boolean): void {
  _prevArmed = armedNow;
  postWorkerConfig({ resumeArmed: _prevArmed });
  _prevArmed = false;
}

/** Tear down the worker (HMR dispose, reconnect-from-scratch). */
export function terminateTransport(): void {
  if (wsWorker) {
    try { wsWorker.postMessage({ type: "close" }); } catch { /* ignore */ }
    wsWorker.terminate();
    wsWorker = null;
  }
}

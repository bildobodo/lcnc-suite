// Dedicated Worker that OWNS the WebSocket connection.
//
// Why: the client heartbeat (1 Hz) keeps the gateway from disarming this client
// after 3 s of silence. Previously the heartbeat *timer* lived in a worker but
// the actual `ws.send` ran on the main thread, so any main-thread jank (fast
// typing in a large editor, heavy 30 Hz reactive updates) could starve the send
// past 3 s and trigger a spurious disarm. Moving the socket itself into the
// worker means the heartbeat is generated AND sent off the main thread, immune
// to main-thread stalls.
//
// The worker is a transparent transport proxy: it never decodes msgpack and
// only originates the three frames it must (`hello`, `tab_visibility`,
// `heartbeat`). Every other frame is relayed verbatim to the main thread, which
// keeps all message interpretation and reactive state. The gateway is unaware
// anything changed — same single socket, same client_id, byte-identical frames.

type Cfg = { url: string; session: string; resumeArmed: boolean; hidden: boolean };

type MainMsg =
  | { type: "connect"; url: string; session: string; resumeArmed: boolean; hidden: boolean }
  | { type: "send"; payload: string; cmd?: string; dropIfClosed?: boolean }
  | { type: "updateConfig"; resumeArmed?: boolean; hidden?: boolean; fireHeartbeat?: boolean }
  | { type: "close" };

const post = (m: unknown, transfer?: Transferable[]) =>
  (self as unknown as Worker).postMessage(m, transfer ?? []);

let ws: WebSocket | null = null;
let cfg: Cfg | null = null;
let wantConnected = false;

let hbTimer: ReturnType<typeof setInterval> | null = null;
let bufferTimer: ReturnType<typeof setInterval> | null = null;
let connectTimer: ReturnType<typeof setTimeout> | null = null;
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let probeAbort: AbortController | null = null;

// Commands that arrive before the socket is OPEN are queued and flushed after
// the handshake (hello/tab_visibility) so hello is always the first frame.
const preOpenQueue: string[] = [];
const QUEUE_MAX = 64;

let attempt = 0;
let lastAttemptAt = 0;
let lastCloseAt = 0;
let lastCloseCode = 0;

// Reconnect gate (2026-09-23). A WebSocket attempt against a gateway that is
// down is not free: Firefox remembers every failed WS connection per IP:port
// in the BROWSER process (200 ms × 1.5ⁿ, capped at 60 s, survives page
// reloads, cleared only by a successful connection) and holds the next
// attempt for that long; it also lets only ONE WebSocket per IP ADDRESS —
// across ports — be connecting or held at a time. Retrying the socket every
// few seconds through an outage therefore ran the hold up to 60 s, and after
// the restart the old 3 s connect timeout cancelled every held attempt before
// it reached the network: tabs sat 35–58 s on "reconnecting" (trace
// 2026-09-19/23), reloads included. After a close we now ask the gateway over
// plain HTTP (`GET /ready`, which the WS backoff never sees) and open the
// socket only once it answers.
const CONNECT_TIMEOUT_MS = 10_000;
const PROBE_AFTER_DROP_MS = 500;      // an established connection dropped
const PROBE_AFTER_FAIL_MS = 2000;     // an attempt never opened (old cadence)
const PROBE_INTERVAL_MS = 1000;
const PROBE_TIMEOUT_MS = 2000;
const PROBE_DOWN_REPORT_MS = 60_000;  // "still down" at most once a minute
let probes = 0;                       // probes in the current outage
let downSince = 0;                    // first failed probe of this outage, 0 = none failed
let lastDownReport = 0;
let probeGen = 0;                     // invalidates a probe answered after teardown

/** `ws(s)://host:port/ws?token=…` → `http(s)://host:port/ready` (no token: no preflight). */
export function readyUrlFor(wsUrl: string): string {
  const u = new URL(wsUrl);
  u.protocol = u.protocol === "wss:" ? "https:" : "http:";
  u.pathname = "/ready";
  u.search = "";
  u.hash = "";
  return u.href;
}

// End-to-end stall visibility (#35): the heartbeat timer lives in this worker so
// it's decoupled from the main thread — but the worker still shares CPU cores
// with it. If the timer fires late, the worker thread itself was starved (CPU
// contention from a busy main thread, or heavy frame-relay work). That is the
// *browser* side of a gateway-observed client-heartbeat stall (safety.hb_stall_
// disarmed). Report the slip + how many frames we relayed in the window so we can
// tell "CPU-starved" from "busy relaying" — correlated with the gateway trace.
const HB_SLIP_THRESHOLD_MS = 1500;   // 1 s cadence + 0.5 s slack
let lastHbFireAt = 0;
let framesRelayedSinceHb = 0;
let lastFrameRxAt = 0;               // when we last RECEIVED any frame from the gateway

function startHeartbeat() {
  stopHeartbeat();
  lastHbFireAt = performance.now();
  framesRelayedSinceHb = 0;
  lastFrameRxAt = performance.now();
  hbTimer = setInterval(() => {
    const now = performance.now();
    const gap = now - lastHbFireAt;
    lastHbFireAt = now;
    if (gap > HB_SLIP_THRESHOLD_MS) {
      post({ type: "hbslip", gapMs: Math.round(gap), framesRelayed: framesRelayedSinceHb });
    }
    framesRelayedSinceHb = 0;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Delivery probe (hb-stall forensics): the gateway saw metronome-perfect
      // arrivals then a >3 s cliff while this timer kept firing — so the loss is
      // BETWEEN ws.send() and the gateway. A 19-byte heartbeat must flush within
      // milliseconds: if last tick's frame is still buffered a full second later,
      // the browser's send path is frozen (e.g. WebKit proxies worker WS through
      // the busy main thread). rxGap covers the inbound half: status flows at
      // 5–30 Hz, so a silent receive side means the whole pipe stalled.
      const buffered = ws.bufferedAmount;
      const rxGap = now - lastFrameRxAt;
      if (buffered > 0 || rxGap > HB_SLIP_THRESHOLD_MS) {
        post({ type: "hbdeliv", buffered, rxGapMs: Math.round(rxGap) });
      }
      // hbsent only on a send that didn't throw — posting it after a swallowed
      // exception recorded heartbeats as sent that never left (silent fallback).
      try {
        ws.send('{"cmd":"heartbeat"}');
        post({ type: "hbsent" });
      } catch (e) {
        post({ type: "error", kind: "hb_send_failed", msg: String((e as Error)?.message ?? e) });
      }
    }
  }, 1000);
}
function stopHeartbeat() {
  if (hbTimer !== null) { clearInterval(hbTimer); hbTimer = null; }
}

// Send-buffer pressure is reported as a STATE TRANSITION, not a per-second
// sample (P0). The old code posted every second whenever bufferedAmount > 0 —
// even a normal 19-byte in-flight write — producing ~1 telemetry POST/sec/tab
// (tens of thousands of events + gateway POSTs that themselves loaded the event
// loop). Now: emit once when buffered crosses the 64 KiB threshold (real
// backpressure), once when it drains, plus a periodic summary while sustained.
const BUFFER_PRESSURE_THRESHOLD = 64 * 1024;
const BUFFER_PRESSURE_SUMMARY_MS = 10_000;
let bufferPressureActive = false;
let bufferPressurePeak = 0;
let bufferPressureSince = 0;
let bufferPressureLastSummary = 0;

function startBufferSampler() {
  stopBufferSampler();
  bufferPressureActive = false;
  bufferPressurePeak = 0;
  bufferTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const buffered = ws.bufferedAmount;
    const now = performance.now();
    if (!bufferPressureActive) {
      if (buffered >= BUFFER_PRESSURE_THRESHOLD) {
        bufferPressureActive = true;
        bufferPressurePeak = buffered;
        bufferPressureSince = now;
        bufferPressureLastSummary = now;
        post({ type: "bufferpressure", phase: "start", buffered });
      }
    } else {
      if (buffered > bufferPressurePeak) bufferPressurePeak = buffered;
      if (buffered === 0) {
        bufferPressureActive = false;
        post({ type: "bufferpressure", phase: "recover", buffered: 0,
               peak: bufferPressurePeak,
               durationMs: Math.round(now - bufferPressureSince) });
      } else if (now - bufferPressureLastSummary >= BUFFER_PRESSURE_SUMMARY_MS) {
        bufferPressureLastSummary = now;
        post({ type: "bufferpressure", phase: "sustained", buffered,
               peak: bufferPressurePeak,
               durationMs: Math.round(now - bufferPressureSince) });
      }
    }
  }, 1000);
}
function stopBufferSampler() {
  if (bufferTimer !== null) { clearInterval(bufferTimer); bufferTimer = null; }
}

function clearConnectTimer() {
  if (connectTimer !== null) { clearTimeout(connectTimer); connectTimer = null; }
}

function stopProbe() {
  probeGen++;
  if (probeTimer !== null) { clearTimeout(probeTimer); probeTimer = null; }
  if (probeAbort) { probeAbort.abort(); probeAbort = null; }
}

function scheduleProbe(delayMs: number) {
  if (probeTimer !== null) clearTimeout(probeTimer);
  probeTimer = setTimeout(runProbe, delayMs);
}

function runProbe() {
  probeTimer = null;
  if (!wantConnected || !cfg) return;
  const gen = probeGen;
  probes++;
  const ctl = new AbortController();
  probeAbort = ctl;
  const timeout = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  // Any HTTP answer means the gateway's port is serving — the WS attempt will
  // not be a refused connection. Only a network error / timeout is "down".
  fetch(readyUrlFor(cfg.url), { cache: "no-store", credentials: "omit", signal: ctl.signal })
    .then(() => true, () => false)
    .then((up) => {
      clearTimeout(timeout);
      if (gen !== probeGen || !wantConnected) return;   // torn down meanwhile
      probeAbort = null;
      const now = performance.now();
      if (up) {
        if (downSince) post({ type: "probe", phase: "up", probes, downMs: Math.round(now - downSince) });
        probes = 0;
        downSince = 0;
        openSocket(true);
        return;
      }
      if (!downSince) {
        downSince = now;
        lastDownReport = now;
        post({ type: "probe", phase: "down", probes, downMs: 0 });
      } else if (now - lastDownReport >= PROBE_DOWN_REPORT_MS) {
        // Reaches the trace only when telemetry can reach the gateway — i.e.
        // exactly when the probe itself is what fails (the unreported case).
        lastDownReport = now;
        post({ type: "probe", phase: "still_down", probes, downMs: Math.round(now - downSince) });
      }
      scheduleProbe(PROBE_INTERVAL_MS);
    });
}

function openSocket(probed = false) {
  if (!cfg) return;
  attempt++;
  lastAttemptAt = performance.now();
  post({
    type: "attempt",
    attempt,
    lastCloseCode,
    gapMs: lastCloseAt ? Math.round(performance.now() - lastCloseAt) : 0,
    probed,
  });

  ws = new WebSocket(cfg.url);
  ws.binaryType = "arraybuffer";
  let opened = false;

  // Connect-attempt backstop for a path that swallows the SYN. Deliberately
  // long: the browser may legitimately HOLD a CONNECTING socket — its failure
  // backoff, or its one-connecting-WebSocket-per-IP queue behind another
  // socket to the same host (Vite's HMR on :5173 in dev) — and closing a held
  // socket only restarts the wait (the old 3 s value never let one through).
  connectTimer = setTimeout(() => {
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }, CONNECT_TIMEOUT_MS);

  ws.onopen = () => {
    opened = true;
    clearConnectTimer();
    post({ type: "open", attempt, dtMs: Math.round(performance.now() - lastAttemptAt) });
    attempt = 0;
    // hello MUST be the first frame so the gateway can associate this
    // connection with the prior tab's armed-resume hold before anything else.
    try {
      ws!.send(JSON.stringify({ cmd: "hello", session: cfg!.session, resume_armed: cfg!.resumeArmed }));
    } catch (e) {
      post({ type: "error", kind: "hello_send_failed", msg: String((e as Error)?.message ?? e) });
    }
    cfg!.resumeArmed = false; // consumed
    try {
      ws!.send(JSON.stringify({ cmd: "tab_visibility", hidden: cfg!.hidden }));
    } catch { /* safe-silent: advisory hint; a throw means the socket is dying and onclose recovers */ }
    // Flush queued user commands AFTER the handshake.
    while (preOpenQueue.length) {
      const p = preOpenQueue.shift()!;
      try {
        ws!.send(p);
      } catch (e) {
        // Socket died mid-flush: this command is lost — surface it, keep the
        // rest queued for the next connection (onclose → reconnect refires).
        post({ type: "error", kind: "queued_send_failed", msg: String((e as Error)?.message ?? e) });
        break;
      }
    }
    startHeartbeat();
    startBufferSampler();
  };

  ws.onmessage = (ev: MessageEvent) => {
    framesRelayedSinceHb++;   // for hb-slip attribution (busy-relaying vs starved)
    lastFrameRxAt = performance.now();  // inbound-stall detection (hbdeliv probe)
    if (typeof ev.data === "string") {
      post({ type: "message", data: ev.data });
    } else {
      // Transfer the ArrayBuffer (zero-copy); the worker doesn't touch it again.
      post({ type: "message", data: ev.data }, [ev.data as ArrayBuffer]);
    }
  };

  ws.onerror = (e: Event) => {
    post({ type: "error", kind: "ws_error", msg: (e as Event)?.type ?? "?" });
  };

  ws.onclose = (ev: CloseEvent) => {
    clearConnectTimer();
    stopHeartbeat();
    stopBufferSampler();
    lastCloseAt = performance.now();
    lastCloseCode = ev.code;
    ws = null;
    post({
      type: "close",
      code: ev.code,
      reason: String(ev.reason ?? ""),
      wasClean: ev.wasClean,
      sinceAttemptMs: Math.round(performance.now() - lastAttemptAt),
    });
    if (wantConnected) {
      // Reconnect through the HTTP gate, never by another blind WS attempt.
      const gapMs = opened ? PROBE_AFTER_DROP_MS : PROBE_AFTER_FAIL_MS;
      post({ type: "reconnecting", attempt: attempt + 1, gapMs });
      scheduleProbe(gapMs);
    }
  };
}

function teardown() {
  wantConnected = false;
  stopHeartbeat();
  stopBufferSampler();
  clearConnectTimer();
  stopProbe();
  probes = 0;
  downSince = 0;
  preOpenQueue.length = 0;
  if (ws) {
    ws.onclose = null; // prevent the reconnect path from firing on our own close
    try { ws.close(); } catch { /* ignore */ }
    ws = null;
  }
}

self.onmessage = (ev: MessageEvent<MainMsg>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "connect":
      teardown();
      cfg = { url: msg.url, session: msg.session, resumeArmed: msg.resumeArmed, hidden: msg.hidden };
      wantConnected = true;
      openSocket();
      break;

    case "send":
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(msg.payload);
        } catch {
          // Socket died between the OPEN check and the send — the command is
          // lost. Surface it like dropped_command; onclose drives reconnect.
          post({ type: "error", kind: "send_failed", msg: String(msg.cmd ?? "?") });
        }
      } else if (msg.dropIfClosed) {
        // Mutating/motion command issued while the socket is closed — DROP it
        // rather than replay a stale operator action into a fresh connection
        // after reconnect (issue #18). Surface it so the operator knows.
        post({ type: "error", kind: "dropped_command", msg: String(msg.cmd ?? "?") });
      } else {
        // Read-only/telemetry — safe to queue across a brief blip.
        if (preOpenQueue.length >= QUEUE_MAX) {
          preOpenQueue.shift();
          post({ type: "error", kind: "send_queue_overflow", msg: String(QUEUE_MAX) });
        }
        preOpenQueue.push(msg.payload);
      }
      break;

    case "updateConfig":
      if (cfg) {
        if (msg.resumeArmed !== undefined) cfg.resumeArmed = msg.resumeArmed;
        if (msg.hidden !== undefined) {
          cfg.hidden = msg.hidden;
          if (ws && ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ cmd: "tab_visibility", hidden: cfg.hidden })); } catch { /* safe-silent: advisory hint; a throw means the socket is dying and onclose recovers */ }
          }
        }
      }
      // Fire one immediate heartbeat (e.g. tab just became visible) so the
      // gateway's last_hb is fresh without waiting up to 1 s for the timer.
      if (msg.fireHeartbeat && ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send('{"cmd":"heartbeat"}');
          post({ type: "hbsent" });
        } catch (e) {
          post({ type: "error", kind: "hb_send_failed", msg: String((e as Error)?.message ?? e) });
        }
      }
      break;

    case "close":
      teardown();
      break;
  }
};

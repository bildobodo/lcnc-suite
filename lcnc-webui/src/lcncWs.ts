// lcncWs — WS orchestrator (frontend split program, A1).
//
// The former 1,100-line monolith is now five leaf modules under src/ws/
// (halshowStore, bulkData, telemetry, wsTransport, statusStore) with this
// file as the single orchestrator: it owns the connection-level reactive
// state (connected/armed/serverShuttingDown/lastReply), relays worker events,
// decodes frames and dispatches them to the owning store. Consumers keep
// importing EVERYTHING from "./lcncWs" — the barrel re-exports below are the
// stable surface (pinned by lcncWs.exports.test.ts).
//
// Layering rules (ledger): ws/* modules are leaves and never import this
// file or each other; reassigned scalars stay private to their owning module
// (eslint bans `export let`); cross-module signals travel via function calls
// (noteHeartbeatSent), never shared mutable state.
import { ref } from "vue";
import { decode as msgpackDecode } from "@msgpack/msgpack";
import { type WsCommand, OPERATOR_ERROR, isQueueSafe } from "./lcnc";
import { updateServerCache, loadDisplayDefaults, registerSettingsSaver } from "./defaults";
import { enableWakeLock, disableWakeLock } from "./wakeLock";
import { applyHalshowSnapshot, applyHalshowUpdate, resetHalshow } from "./ws/halshowStore";
import { emitTelemetry } from "./ws/telemetry";
import {
  buildWsUrl, captureArmedForResume, connectTransport,
  persistArmedForReload, postWorkerConfig, sendCommand, terminateTransport,
} from "./ws/wsTransport";
import {
  fetchCompGrid, fetchSurfacePoints, resetBulkVersionsOnClose,
  handleToolTableChanged, handleViewerGcode, handleViewerGcodeReady, handleViewerInit,
} from "./ws/bulkData";
import {
  handleStatusError, handleStatusMessage, noteBulkData,
  noteFrameSample, noteHeartbeatSent, notePong, pushMessage,
  rebaseStatusDelta, resetOnClose, safetyTrip,
} from "./ws/statusStore";

// ---------- Connection-level state (owned here) ----------
export const connected = ref(false);
export const armed = ref(false);        // server-authoritative — driven by gateway messages
export const lastReply = ref<any>(null);
// Server is mid-shutdown (FastAPI lifespan teardown). Set when the gateway
// broadcasts `{type: "server_shutdown"}` immediately before closing WS
// connections. Distinguishes a planned shutdown from a network blip so the
// UI can show "Server shutting down" instead of the generic reconnect state.
// Cleared on the next successful WS open.
export const serverShuttingDown = ref(false);

// ---------- Barrel re-exports (the stable consumer surface) ----------
// Status stream, message center, timing stats (split out, A1.5).
export {
  status, lcncError, safetyTrip, readerStale, safetyChainIncomplete, configWarning,
  previewRefresh, previewRefreshElapsedMs, previewRefreshLabel, previewRefreshPct, type PreviewRefresh,
  latency, networkLatency, timingStats, messages, unreadCount,
  resetTimingStats, getTimingCsv, dismissMessage, clearAllMessages, markMessagesRead,
  pushMessage,
  type LcncMessage, type WsStatus, type TimingComponentStats, type TimingStats,
} from "./ws/statusStore";
// Viewer payloads, preview worker, gcode text, surface/comp-grid (A1.2).
// previewLoadError is surfaced in App.vue's status banner so the operator
// sees "preview is stale" rather than a possibly outdated toolpath.
export {
  viewerInit, viewerGcode, toolTableVersion, gcodeContent, previewLoadError, previewParseError,
  previewRefusal,
  type ViewerPart, type KinematicsList, type ViewerInit, type ViewerGcode,
} from "./ws/bulkData";
// Browser → server telemetry batcher (A1.3). Its four lifecycle/error
// listeners live with it; the visibilitychange handler stays HERE because it
// also drives the WS worker — cross-module orchestration is this file's job.
export { emitTelemetry } from "./ws/telemetry";
// HALshow live state (A1.1).
export {
  halPins, halSignals, halParams, halInitialized,
  type HalPin, type HalSignalPin, type HalSignal, type HalParam,
} from "./ws/halshowStore";

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
      // Server-going-away close codes double as a shutdown signal: the
      // gateway closes 1001 on lifespan teardown, uvicorn closes 1012 on
      // graceful restart. The explicit server_shutdown frame is the richer
      // path, but it cannot arrive when uvicorn cancels WS tasks before
      // lifespan runs (A1 smoke: browser saw the close with no frame) —
      // the code is then the only signal that does. 1006 (process died
      // mid-flight) is indistinguishable from a network blip by design.
      if (m.code === 1001 || m.code === 1012) serverShuttingDown.value = true;
      // Capture armed state so the worker's NEXT reconnect hello can ask the
      // gateway to restore armed=true via a still-valid armed-resume hold.
      captureArmedForResume(armed.value);
      armed.value = false;     // new connection starts disarmed
      try { disableWakeLock(); } catch { /* ignored */ }
      resetOnClose();          // latency readouts + RTT anchors are connection-scoped
      // Bulk version sentinels are connection-scoped too: the gateway re-pings
      // versions per connection, and those pings are the only fetch trigger.
      resetBulkVersionsOnClose();
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
      noteHeartbeatSent();   // RTT anchor crossed by function call only (A1 rule)
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
        pushMessage(OPERATOR_ERROR, `Command dropped — not connected: ${m.msg}`);
      } else if (m.kind === "send_failed") {
        // send() threw on an OPEN socket (died mid-send) — the command is
        // as lost as a dropped one; give it the same operator visibility.
        emitTelemetry("ws.send_failed", { cmd: m.msg });
        pushMessage(OPERATOR_ERROR, `Command send failed — connection lost: ${m.msg}`);
      } else {
        emitTelemetry("ws.worker_error", { kind: m.kind, msg: m.msg });
      }
      break;

    case "message":
      onFrame(m.data);
      break;
  }
}

// Decode + dispatch one relayed frame. `data` is a string (JSON) or
// ArrayBuffer (msgpack), transferred from the worker. msgpack decode stays
// on the main thread by design. Every frame type dispatches into its owning
// module — the e2e liveness specs (frames.spec.ts) pin each path through to
// the rendered DOM, so a dead case here cannot pass the gate.
function onFrame(data: string | ArrayBuffer) {
    let msg: any;
    const _t0 = performance.now();
    try {
      if (typeof data === "string") {
        msg = JSON.parse(data);
        noteFrameSample("ws_bytes", data.length);
      } else {
        // Binary frame (msgpack). ArrayBuffer because binaryType = "arraybuffer".
        const buf = data;
        msg = msgpackDecode(new Uint8Array(buf));
        noteFrameSample("ws_bytes", buf.byteLength);
      }
    } catch (e) {
      // A frame the gateway sent but we can't decode is a protocol fault,
      // not a display concern — put it on the trace bus, not just the console.
      console.error("WS: decode failed", e);
      emitTelemetry("ws.decode_failed", {
        error: String(e),
        binary: typeof data !== "string",
        bytes: typeof data === "string" ? data.length : data.byteLength,
      });
      return;
    }
    noteFrameSample("decode", performance.now() - _t0);

    // Server-authoritative armed state — update from every message that carries
    // it, and mirror to sessionStorage (change-only) so a page reload can
    // request armed-resume against the gateway's hold.
    if (msg.armed !== undefined) {
      armed.value = msg.armed;
      persistArmedForReload(msg.armed === true);
    }

    if (msg.type === "server_shutdown") {
      // Lifespan broadcast immediately before WS close. Mark explicit so the
      // UI can distinguish from a network blip during the brief window
      // before onclose fires.
      serverShuttingDown.value = true;
      return;
    }

    if (msg.type === "pong") {
      notePong();
      return;
    }

    // Server-side status deltas: rebase onto the latest known data, then fall
    // through as a normal status (rebaseStatusDelta rewrites msg.type).
    if (msg.type === "status_delta") {
      rebaseStatusDelta(msg);
    }

    if (msg.type === "status") {
      handleStatusMessage(msg);
    } else if (msg.type === "status_error") {
      handleStatusError(msg);
    } else if (msg.type === "reply") {
      lastReply.value = msg;
      if (msg.ok === false && msg.error) {
        pushMessage(OPERATOR_ERROR, `Command: ${msg.error}`);
      }
    } else if (msg.type === "viewer_init") {
      handleViewerInit(msg);
    } else if (msg.type === "viewer_gcode") {
      handleViewerGcode(msg);
    } else if (msg.type === "viewer_gcode_ready") {
      handleViewerGcodeReady(msg);
    } else if (msg.type === "surface_points_ready") {
      // bulkData owns versioning/abort/decode; the sink hands the value to the
      // status carry, keyed by the version the ping carried, so it survives
      // every subsequent status frame (ledger F1 — it used to last one rAF).
      const sv = msg.version ?? 0;
      fetchSurfacePoints(sv, data => noteBulkData("surface_points", sv, data));
    } else if (msg.type === "comp_grid_ready") {
      const gv = msg.version ?? 0;
      fetchCompGrid(gv, data => noteBulkData("comp_grid", gv, data));
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

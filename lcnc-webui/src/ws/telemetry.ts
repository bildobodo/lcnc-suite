// Browser → server telemetry batcher (frontend split, A1.3 — extracted from
// lcncWs.ts).
//
// Posts NDJSON batches to POST /telemetry where the gateway forwards each
// event to the suite-wide trace bus tagged `browser.<kind>`. Catches the
// signals we can't see from the server side: tab visibility (the known
// 12-tab-storm trigger), WS reconnect attempt cadence, send-buffer
// pressure, JS errors. Batched to keep request rate low.
//
// Leaf module: imports nothing from the app; never imports lcncWs or its
// peers. Owns the page-lifecycle flush listeners (pagehide/beforeunload) and
// the global error listeners — the visibilitychange handler stays in lcncWs
// because it also drives the WS worker (orchestrator's job).

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
  window.addEventListener("error", _onError);
  window.addEventListener("unhandledrejection", _onRejection);
}

// Remove module-level listeners on Vite HMR so a hot reload doesn't stack
// them (#32). lcncWs disposes its own (visibilitychange + WS worker).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", _onPagehide);
      window.removeEventListener("beforeunload", _onBeforeunload);
      window.removeEventListener("error", _onError);
      window.removeEventListener("unhandledrejection", _onRejection);
    }
  });
}

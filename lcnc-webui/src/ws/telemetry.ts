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
// One id per document, on every event: the trace tells tabs apart without
// guessing from t_wall_ms - t_perf_ms — two tabs reloaded by the same Vite
// restart on two machines' clocks can start within milliseconds of each other
// (scripts/ws_reconnect_report.py, 2026-09-24).
const _PAGE_ID = Math.random().toString(36).slice(2, 10);

export function emitTelemetry(kind: string, fields: Record<string, any> = {}): void {
  // performance.timing isn't valid for our wall-aligned ms but Date.now is;
  // include both so the bundler can correlate against gateway events.
  const evt = {
    kind,
    t_wall_ms: Date.now(),
    t_perf_ms: Math.round(performance.now()),
    page: _PAGE_ID,
    ...fields,
  };
  _telemetryQueue.push(evt);
  if (_telemetryQueue.length > _TELEMETRY_MAX_QUEUE) {
    const over = _telemetryQueue.length - _TELEMETRY_MAX_QUEUE;
    _telemetryQueue.splice(0, over);
    _countDrop("overflow", over);
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

// (The long-task observer moved to viewerPerf.ts with the stall rows, P3.)

// ── What the transport lost (P3, machine day F20, Codex R425 MT425-04) ──
// Telemetry stays best effort, but a loss is COUNTED, never swallowed: a
// queue overflow, a POST the browser refused (a network error, the keepalive
// quota), a non-2xx answer, the gateway's own refusal or rejected lines, a
// beacon the browser did not take. The next batch carries
// `telemetry.dropped {events, batches, why, since_ms}` in front; the counts
// are cleared only once a batch carrying them was delivered (a 2xx — a body
// the gateway answers with `ok: false` is no delivery). A record of a
// delivered batch is there exactly once; anything else is a counted loss.
interface DropCounts { events: number; batches: number; why: Record<string, number>; since_ms: number }
let _dropped: DropCounts | null = null;

function _countDrop(why: string, events: number): void {
  if (events <= 0) return;
  if (!_dropped) _dropped = { events: 0, batches: 0, why: {}, since_ms: Date.now() };
  _dropped.events += events;
  _dropped.batches += 1;
  _dropped.why[why] = (_dropped.why[why] ?? 0) + events;
}

/** What is counted and not yet delivered (tests read it). */
export function telemetryDropped(): DropCounts | null {
  return _dropped ? { ..._dropped, why: { ..._dropped.why } } : null;
}

/** The batch to send: the pending drop report first (its own record, never
 *  counted as a loss itself), and what it reports — to clear on delivery. */
function _withDropReport(batch: Array<Record<string, any>>): { events: Array<Record<string, any>>; reported: DropCounts | null } {
  if (!_dropped) return { events: batch, reported: null };
  const reported = { ..._dropped, why: { ..._dropped.why } };
  const rec = { kind: "telemetry.dropped", t_wall_ms: Date.now(), t_perf_ms: Math.round(performance.now()),
                page: _PAGE_ID, ...reported };
  return { events: [rec, ...batch], reported };
}

function _delivered(reported: DropCounts | null): void {
  if (!reported || !_dropped) return;
  // subtract what the delivered batch said: drops counted meanwhile stay
  _dropped.events -= reported.events;
  _dropped.batches -= reported.batches;
  for (const [k, v] of Object.entries(reported.why)) {
    const left = (_dropped.why[k] ?? 0) - v;
    if (left > 0) _dropped.why[k] = left; else delete _dropped.why[k];
  }
  if (_dropped.events <= 0) _dropped = null;
}

async function _judgeAnswer(r: Response, n: number, reported: DropCounts | null): Promise<void> {
  if (!r.ok) { _countDrop(`status_${r.status}`, n); return; }
  // the gateway answers JSON; a 2xx without it (a test route's 204) is delivered
  if ((r.headers.get("content-type") ?? "").includes("json")) {
    let j: any = null;
    try { j = await r.json(); } catch { /* a 2xx with an unreadable body: delivered, not judged */ }
    if (j && j.ok === false) { _countDrop(`refused_${String(j.error ?? "unknown").slice(0, 40)}`, n); return; }
    if (j && typeof j.rejected === "number" && j.rejected > 0) _countDrop("rejected_lines", j.rejected);
  }
  _delivered(reported);
}

function _flushTelemetry(): void {
  _telemetryFlushScheduled = false;
  if (_telemetryQueue.length === 0 && !_dropped) return;
  // Take ownership of the current batch; new events queue up for next flush.
  const { events, reported } = _withDropReport(_telemetryQueue.splice(0, _telemetryQueue.length));
  const n = events.length - (reported ? 1 : 0);
  const body = _telemetryBody(events);
  // Use fetch keepalive so the request can complete after navigation in
  // most modern browsers. sendBeacon is reserved for unload paths.
  try {
    fetch("/telemetry", {
      method: "POST",
      headers: { "content-type": "application/x-ndjson" },
      body,
      keepalive: true,
    }).then(r => _judgeAnswer(r, n, reported), () => _countDrop("network", n));
  } catch {
    _countDrop("fetch_threw", n);
  }
}

function _flushTelemetryViaBeacon(): void {
  if (_telemetryQueue.length === 0 && !_dropped) return;
  const { events, reported } = _withDropReport(_telemetryQueue.splice(0, _telemetryQueue.length));
  const n = events.length - (reported ? 1 : 0);
  try {
    const body = _telemetryBody(events);
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: "application/x-ndjson" });
      // taken = queued by the browser (no answer comes back): the page is
      // leaving — a refusal is counted for a page that may still stay (bfcache)
      if (navigator.sendBeacon("/telemetry", blob)) _delivered(reported);
      else _countDrop("beacon_refused", n);
    } else {
      // Last-ditch fetch (rarely needed; keepalive covers most).
      fetch("/telemetry", { method: "POST", body, keepalive: true })
        .then(r => _judgeAnswer(r, n, reported), () => _countDrop("network", n));
    }
  } catch { _countDrop("beacon_threw", n); }
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

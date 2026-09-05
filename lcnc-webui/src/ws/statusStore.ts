// Status stream store (frontend split, A1.5 — extracted from lcncWs.ts).
//
// Owns everything the gateway's status fan-out feeds: the rAF-batched status
// ref, sticky safety-trip / reader-stale / config-warning sync, the message
// center (+ localStorage persistence), latency anchors and the timing-stats
// ring buffers. lcncWs (the orchestrator) decodes frames and dispatches into
// the handlers here; consumers keep importing the refs from "./lcncWs" via
// the barrel re-export.
//
// Leaf module: imports vue + the lcnc constants leaf only; never imports
// lcncWs or its ws/ peers. All reassigned scalars (rAF buffer, RTT anchors,
// dedupe sentinels) are private by design (A1 rule) — cross-module access is
// function-call only (noteHeartbeatSent/notePong/...), never shared state.
import { ref, shallowRef } from "vue";
import { OPERATOR_DISPLAY, OPERATOR_ERROR } from "../lcnc";

export interface LcncMessage {
  id: number;
  kind: number;     // See NML_ERROR..OPERATOR_DISPLAY constants in lcnc.ts
  text: string;
  ts: number;       // Date.now() when received
}

export interface WsStatus {
  data?: Record<string, any>;
  clients?: { ip: string; armed: boolean }[];
  surface_points?: [number, number, number][];
  comp_grid?: any;
  probe_results?: Record<string, number>;
  type?: string;
  timing?: any;
  // Sibling of `data` — gateway injects on tool change / library edit.
  // Lives at envelope top-level so the shared msgpack encode of `data` stays
  // valid every tick (delta-off path).
  tool_meta?: Record<string, any> | null;
  // Versions of the HTTP-fetched bulk channels folded in by the carry
  // (noteBulkData), keyed by field name. Consumers react on the version EDGE:
  // the values themselves are on every frame, so presence means nothing.
  bulk_versions?: Record<string, number>;
}

export const status = shallowRef<WsStatus | null>(null);
export const lcncError = ref<string | null>(null);
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
// Safety-chain completeness (review B1): gateway sets `safety_chain_incomplete`
// (a reason string) when the suite's advertised safety components aren't in
// place — watchdog socket down, trip latch (webui-hb-latch) absent from a
// fresh reader snapshot, or the estop-loop signal has no writer. Auto-clears
// when the flag stops riding the frames. Distinct from safety_trip (a chain
// that EXISTS and fired) — this is the chain not existing at all.
export const safetyChainIncomplete = ref<string | null>(null);
// Config fallback (issue #21): gateway sets `config_warning` on status messages
// when it falls back to a default unit system or default machine geometry —
// both unit-ambiguous and unsafe to apply silently. Latches server-side until a
// subsequent successful read; surfaced as a non-blocking banner.
export const configWarning = ref<{ reason: string; units: boolean } | null>(null);
// A preview re-parse is RUNNING (2026-09-05): the gateway rides
// `preview_refresh` on every status frame while its parse worker runs —
// reason (the edge that scheduled it), file, expected duration (its last
// measured publish for that file, else size-based), whether a restart is
// already queued behind it, and how many parses this one superseded.
// Absent = nothing running. `seenAt` is THIS client's clock at first sight
// of the parse (started_ms identity) — elapsed time is measured locally,
// never from the gateway's wall clock (VM clock steps).
export interface PreviewRefresh {
  reason: string;
  file: string;
  expected_ms: number | null;
  started_ms: number | null;
  queued: boolean;
  superseded: number;
  seenAt: number;
}
export const previewRefresh = ref<PreviewRefresh | null>(null);
// Elapsed ms of the running re-parse, ticked here (one timer, shared by the
// banner and the viewer HUD); 0 when nothing runs.
export const previewRefreshElapsedMs = ref(0);
let _previewRefreshTimer: ReturnType<typeof setInterval> | null = null;
function _syncPreviewRefreshTimer(): void {
  const pr = previewRefresh.value;
  if (pr && _previewRefreshTimer === null) {
    _previewRefreshTimer = setInterval(() => {
      const cur = previewRefresh.value;
      previewRefreshElapsedMs.value = cur ? Math.max(0, performance.now() - cur.seenAt) : 0;
    }, 250);
  } else if (!pr && _previewRefreshTimer !== null) {
    clearInterval(_previewRefreshTimer);
    _previewRefreshTimer = null;
    previewRefreshElapsedMs.value = 0;
  }
}

/** Operator wording for a re-parse reason (the gateway's edge names). Pure. */
export function previewRefreshLabel(reason: string | null | undefined): string {
  const r = String(reason ?? "");
  if (r.startsWith("wcsoff:")) {
    const [, row, key] = r.split(":");
    return `touch-off (${row ?? "fixture"}${key ? " " + key.toUpperCase() : ""})`;
  }
  if (r.startsWith("rotary:")) return `rotary pose (${r.slice(7) || "moved"})`;
  if (r === "kins:type") return "kinematics mode change";
  if (r === "kins:frame") return "plane change";
  if (r.startsWith("tlo")) return "tool length change";
  if (r === "file") return "program load";
  if (r === "reparse") return "operator reparse";
  if (r === "schema") return "suite upgrade";
  if (r === "drift") return "machine state change";
  return r || "machine state change";
}

export const latency = ref<number | null>(null);        // round-trip: heartbeat → next status
export const networkLatency = ref<number | null>(null);  // pure network: heartbeat → pong

// ---------- Message center (per-tab by design) ----------
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
let _nextMsgId = _stored.length > 0 ? Math.max(..._stored.map(m => m.id)) + 1 : 1;

/**
 * Append to the message center. countUnread=false is the RFL-progress case:
 * informational display lines that must not light the unread badge.
 */
export function pushMessage(kind: number, text: string, countUnread = true): void {
  messages.value = [...messages.value, { id: _nextMsgId++, kind, text, ts: Date.now() }];
  if (countUnread) unreadCount.value++;
  persistMessages(messages.value);
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

// ---------- Timing stats ----------
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

/** Frame-level samples pushed by the orchestrator's decode path. */
export function noteFrameSample(key: "ws_bytes" | "decode", value: number): void {
  _pushSample(key, value);
}

// ---------- RTT anchors ----------
let _heartbeatSentAt = 0;   // used for network latency (pong)
let _rtSentAt = 0;           // used for round-trip latency (next status)

/**
 * Heartbeat left the worker ("hbsent"). This is the arrival time of the
 * worker's post (a sub-ms hop after the real send); under heavy main jank
 * the latency readout may slightly overstate RTT, but the heartbeat itself
 * went out on time on the worker thread. Diagnostic only.
 */
export function noteHeartbeatSent(): void {
  _heartbeatSentAt = _rtSentAt = performance.now();
}

/** Pure network latency: heartbeat → immediate pong reply (diagnostic only). */
export function notePong(): void {
  if (_heartbeatSentAt > 0) {
    networkLatency.value = Math.round(performance.now() - _heartbeatSentAt);
    _heartbeatSentAt = 0;
  }
}

// ---------- Status stream ----------
// Status batching + one-shot tool_meta carry-over. Module scope so they
// persist across the relay (previously closure-locals inside connectWs).
let _pendingStatus: any = null;
let _lastRflTs = 0;   // dedupe for rfl_status frames (same phase repeats per tick)
let _flushScheduled = false;
let _lastToolMeta: { num: number; meta: any } | null = null;

/**
 * status_delta frame: merge incoming changed fields onto the most recent
 * known data, then the caller falls through as a normal status. Server
 * forces a full snapshot every N cycles and on reconnect, so any drift
 * self-heals within a few seconds. (Mutates msg in place — same object then
 * flows into handleStatusMessage.)
 */
export function rebaseStatusDelta(msg: any): void {
  const base = _pendingStatus?.data ?? status.value?.data ?? {};
  msg.data = { ...base, ...(msg.data ?? {}) };
  msg.type = "status";
}

/** The full former `status` branch of onFrame — behavior preserved verbatim. */
export function handleStatusMessage(msg: any): void {
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
  // tool_meta lives at top level; tool_number stays inside data (it comes
  // from linuxcnc.stat).
  if (msg.tool_meta && msg.data?.tool_number != null) {
    _lastToolMeta = { num: msg.data.tool_number, meta: msg.tool_meta };
  } else if (_lastToolMeta && msg.data?.tool_number === _lastToolMeta.num && !msg.tool_meta) {
    msg.tool_meta = _lastToolMeta.meta;
  }

  // NOTE: the HTTP-fetched bulk channels are folded in at FLUSH time, not
  // here — see _flushPending. Stamping on arrival would freeze whatever the
  // carry held when the frame arrived, so a fetch that resolved while this
  // frame sat in the rAF buffer would be overwritten by the older value.

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
  // Preview re-parse in flight — present while the gateway's worker runs.
  const pr = msg.preview_refresh;
  if (pr && typeof pr === "object") {
    const cur = previewRefresh.value;
    const sameParse = !!cur && cur.started_ms === (pr.started_ms ?? null) && cur.file === String(pr.file ?? "");
    if (!sameParse || cur!.reason !== String(pr.reason ?? "") || cur!.queued !== !!pr.queued
        || cur!.superseded !== Number(pr.superseded ?? 0)) {
      previewRefresh.value = {
        reason: String(pr.reason ?? ""), file: String(pr.file ?? ""),
        expected_ms: typeof pr.expected_ms === "number" ? pr.expected_ms : null,
        started_ms: typeof pr.started_ms === "number" ? pr.started_ms : null,
        queued: !!pr.queued, superseded: Number(pr.superseded ?? 0),
        seenAt: sameParse ? cur!.seenAt : performance.now(),
      };
      _syncPreviewRefreshTimer();
    }
  } else if (previewRefresh.value !== null) {
    previewRefresh.value = null;
    _syncPreviewRefreshTimer();
  }
  // Reader staleness — set when gateway flag present, clear otherwise.
  const stale = msg.reader_stale === true;
  if (readerStale.value !== stale) readerStale.value = stale;

  // Safety-chain completeness — reason string when present, null otherwise.
  const sci = typeof msg.safety_chain_incomplete === "string" ? msg.safety_chain_incomplete : null;
  if (safetyChainIncomplete.value !== sci) safetyChainIncomplete.value = sci;

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
      pushMessage(OPERATOR_ERROR, `Run-from-line ${rfl.phase}: ${rfl.error || "failed"}`);
    } else if (phaseText[rfl.phase]) {
      pushMessage(OPERATOR_DISPLAY, phaseText[rfl.phase]!, false);
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
    requestAnimationFrame(_flushPending);
  }
}

// Hoisted rAF callback (WS-E): one module-level function instead of a fresh
// closure per scheduled flush on the 30 Hz status path.
function _flushPending(): void {
  _flushScheduled = false;
  if (_pendingStatus) {
    // Fold the bulk carry in HERE — the last moment before the object becomes
    // `status.value`, so it always carries the freshest fetched value even if
    // that fetch resolved while this frame was sitting in the buffer.
    _applyBulkCarry(_pendingStatus);
    status.value = _pendingStatus;
    _pendingStatus = null;
  }
}

/** status_error frame: surface the error; clients list still updates. */
export function handleStatusError(msg: any): void {
  lcncError.value = msg.error;
  if (msg.clients != null) {
    mergeStatusPatch({ clients: msg.clients });
  }
}

/**
 * Merge fields into the CURRENT status object.
 *
 * Only for values the SERVER re-sends on every status envelope (the
 * status_error clients list), because the next full status frame replaces the
 * whole object and anything not re-sent is gone. Bulk channels that are
 * fetched over HTTP — surface points, comp grid — must use noteBulkData()
 * instead, or they survive at most one animation frame (ledger F1).
 */
export function mergeStatusPatch(patch: Record<string, any>): void {
  status.value = { ...(status.value ?? {}), ...patch };
}

/**
 * HTTP-fetched bulk channels, carried across status frames.
 *
 * These arrive out of band: the gateway pings a version over the socket and
 * the client fetches the payload separately, so the value is NOT part of any
 * status envelope. Writing it into `status.value` alone lasted at most one rAF
 * — the next frame replaced the whole object — which left
 * `status.value.surface_points` permanently `undefined` for any consumer that
 * was not already latching it in a watcher.
 *
 * Same shape as the `tool_meta` carry above: the value is folded into the
 * INCOMING message before it becomes `_pendingStatus`, so it is part of the
 * object that survives the flush. The stored value is reused BY REFERENCE —
 * consumers watch these arrays by identity, and a fresh copy per tick would
 * rebuild an InstancedMesh 30 times a second. The version rides alongside so
 * consumers can act on the EDGE rather than on every frame.
 */
const _bulkCarry = new Map<string, { version: number; value: any }>();

export function noteBulkData(key: string, version: number, value: any): void {
  _bulkCarry.set(key, { version, value });
  // Land it on the current object too, so a consumer watching status.value
  // sees it in this tick rather than waiting for the next status frame.
  status.value = {
    ...(status.value ?? {}),
    [key]: value,
    bulk_versions: _bulkVersions(),
  };
}

/**
 * Drop every carried bulk value.
 *
 * Test isolation only — the carry is module-level and deliberately outlives a
 * reconnect (resetOnClose does NOT touch it), so without this a suite's tests
 * would leak values into each other. Production has no caller.
 */
export function clearBulkCarry(): void {
  _bulkCarry.clear();
}

function _bulkVersions(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of _bulkCarry) out[k] = v.version;
  return out;
}

function _applyBulkCarry(msg: any): void {
  if (_bulkCarry.size === 0) return;
  for (const [k, v] of _bulkCarry) {
    if (msg[k] === undefined) msg[k] = v.value;   // by reference, see above
  }
  msg.bulk_versions = _bulkVersions();
}

/** WS close: latency readouts and RTT anchors are connection-scoped. */
export function resetOnClose(): void {
  latency.value = null;
  networkLatency.value = null;
  _heartbeatSentAt = _rtSentAt = 0;
  // The carry deliberately SURVIVES a reconnect: the surface map on screen did
  // not stop being true because the socket blipped, and the gateway re-pings
  // its version on the new connection anyway.
}

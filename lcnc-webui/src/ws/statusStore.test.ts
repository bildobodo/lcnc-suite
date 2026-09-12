// Unit tests for ws/statusStore.ts (A1.5) — the hardest extraction of the
// lcncWs split. Every behavior here is pinned BYTE-FOR-BYTE from the monolith,
// including the carry contracts that replaced ledger oddity F1.
//
// rAF in this suite is the testGlobals stub: setTimeout(cb, 16). Tests use
// fake timers and advance 16 ms to flush the status buffer deterministically.
import "../testGlobals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_DISPLAY, OPERATOR_ERROR } from "../lcnc";
import {
  clearAllMessages, clearBulkCarry, configWarning, dismissMessage, getTimingCsv,
  handleStatusError, handleStatusMessage, latency, lcncError,
  markMessagesRead, mergeStatusPatch, messages, networkLatency, noteBulkData,
  noteFrameSample, noteHeartbeatSent, notePong, pushMessage,
  previewRefresh, previewRefreshElapsedMs, previewRefreshLabel, previewRefreshPct,
  readerStale, rebaseStatusDelta, resetOnClose, resetTimingStats, safetyChainIncomplete,
  safetyTrip, status, timingStats, unreadCount,
} from "./statusStore";

function flushRaf() {
  vi.advanceTimersByTime(16);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Connection-scoped + per-test reset using only the public API.
  resetOnClose();
  clearBulkCarry();   // module-level and survives reconnect by design
  resetTimingStats();
  clearAllMessages();
  status.value = null;
  lcncError.value = null;
  safetyTrip.value = null;
  readerStale.value = false;
  safetyChainIncomplete.value = null;
  configWarning.value = null;
  previewRefresh.value = null;
});

afterEach(() => {
  // Drain any scheduled rAF flush BEFORE dropping the fake clock — tearing
  // down fake timers destroys pending callbacks but leaves the module's
  // private _flushScheduled flag true, deadlocking every later flush.
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("status rAF batcher", () => {
  it("buffers the status and flushes once per rAF; only the latest wins", () => {
    handleStatusMessage({ type: "status", data: { n: 1 } });
    expect(status.value).toBeNull();              // buffered, not yet flushed
    handleStatusMessage({ type: "status", data: { n: 2 } });
    flushRaf();
    expect(status.value?.data).toEqual({ n: 2 }); // latest only — one reactive hit
    expect(lcncError.value).toBeNull();
  });

  it("clears lcncError synchronously on every status", () => {
    lcncError.value = "boom";
    handleStatusMessage({ type: "status", data: {} });
    expect(lcncError.value).toBeNull();
  });

  it("extracts gateway errors BEFORE the buffer so an overwrite cannot lose them", () => {
    handleStatusMessage({ type: "status", data: {}, errors: [[OPERATOR_ERROR, "first"]] });
    handleStatusMessage({ type: "status", data: {} });  // overwrites the pending buffer
    expect(messages.value.map(m => m.text)).toEqual(["first"]);
    expect(unreadCount.value).toBe(1);
  });
});

describe("status_delta rebase", () => {
  it("merges onto the PENDING (unflushed) status first", () => {
    handleStatusMessage({ type: "status", data: { x: 1, y: 1 } });  // still pending
    const delta: any = { type: "status_delta", data: { y: 2 } };
    rebaseStatusDelta(delta);
    expect(delta.type).toBe("status");
    expect(delta.data).toEqual({ x: 1, y: 2 });
  });

  it("falls back to the flushed status, then to {}", () => {
    handleStatusMessage({ type: "status", data: { a: 1 } });
    flushRaf();                                   // pending drained → flushed base
    const d1: any = { type: "status_delta", data: { b: 2 } };
    rebaseStatusDelta(d1);
    expect(d1.data).toEqual({ a: 1, b: 2 });

    status.value = null;                          // no base at all
    const d2: any = { type: "status_delta", data: { z: 9 } };
    rebaseStatusDelta(d2);
    expect(d2.data).toEqual({ z: 9 });
  });
});

describe("tool_meta one-shot carry", () => {
  it("re-attaches tool_meta when a later same-tool status would have dropped it", () => {
    handleStatusMessage({ type: "status", data: { tool_number: 3 }, tool_meta: { d: 6.35 } });
    // Second status for the SAME tool arrives without tool_meta before flush.
    handleStatusMessage({ type: "status", data: { tool_number: 3 } });
    flushRaf();
    expect(status.value?.tool_meta).toEqual({ d: 6.35 });
  });

  it("does not leak tool_meta onto a different tool", () => {
    handleStatusMessage({ type: "status", data: { tool_number: 3 }, tool_meta: { d: 6.35 } });
    handleStatusMessage({ type: "status", data: { tool_number: 4 } });
    flushRaf();
    expect(status.value?.tool_meta).toBeUndefined();
  });
});

describe("safety_trip / reader_stale / config_warning sync", () => {
  it("safety_trip keeps object identity while the reason is unchanged (P4.3)", () => {
    handleStatusMessage({ type: "status", data: {}, safety_trip: { reason: "hb" } });
    const first = safetyTrip.value;
    expect(first).toEqual({ reason: "hb" });
    handleStatusMessage({ type: "status", data: {}, safety_trip: { reason: "hb" } });
    expect(safetyTrip.value).toBe(first);          // SAME object — no watcher storm
    handleStatusMessage({ type: "status", data: {}, safety_trip: { reason: "estop" } });
    expect(safetyTrip.value).toEqual({ reason: "estop" });
    handleStatusMessage({ type: "status", data: {} });
    expect(safetyTrip.value).toBeNull();           // absence = no trip
  });

  it("reader_stale mirrors the flag; config_warning latches value-compared", () => {
    handleStatusMessage({ type: "status", data: {}, reader_stale: true });
    expect(readerStale.value).toBe(true);
    handleStatusMessage({ type: "status", data: {} });
    expect(readerStale.value).toBe(false);

    handleStatusMessage({ type: "status", data: {}, config_warning: { reason: "units", units: true } });
    const cw = configWarning.value;
    handleStatusMessage({ type: "status", data: {}, config_warning: { reason: "units", units: true } });
    expect(configWarning.value).toBe(cw);          // unchanged → same object
    handleStatusMessage({ type: "status", data: {} });
    expect(configWarning.value).toBeNull();
  });

  it("safety_chain_incomplete mirrors the reason string; absence clears", () => {
    handleStatusMessage({ type: "status", data: {}, safety_chain_incomplete: "watchdog down" });
    expect(safetyChainIncomplete.value).toBe("watchdog down");
    handleStatusMessage({ type: "status", data: {}, safety_chain_incomplete: "watchdog down" });
    expect(safetyChainIncomplete.value).toBe("watchdog down");
    handleStatusMessage({ type: "status", data: {} });
    expect(safetyChainIncomplete.value).toBeNull();
  });
});

describe("preview_refresh sync (re-parse in flight)", () => {
  const PR = { reason: "wcsoff:G54:x", file: "big.ngc", expected_ms: 30000, started_ms: 1000, queued: false, superseded: 1 };

  it("mirrors the field while present, keeps identity for the same parse, clears on absence", () => {
    handleStatusMessage({ type: "status", data: {}, preview_refresh: PR });
    const first = previewRefresh.value;
    expect(first).toMatchObject({ reason: "wcsoff:G54:x", file: "big.ngc", expected_ms: 30000, queued: false, superseded: 1 });
    expect(typeof first!.seenAt).toBe("number");
    handleStatusMessage({ type: "status", data: {}, preview_refresh: PR });
    expect(previewRefresh.value).toBe(first);       // same parse, same object — no watcher storm
    handleStatusMessage({ type: "status", data: {}, preview_refresh: { ...PR, queued: true } });
    expect(previewRefresh.value).not.toBe(first);
    expect(previewRefresh.value!.queued).toBe(true);
    expect(previewRefresh.value!.seenAt).toBe(first!.seenAt);   // still the same parse: elapsed keeps counting
    handleStatusMessage({ type: "status", data: {}, preview_refresh: { ...PR, started_ms: 2000, reason: "rotary:A" } });
    expect(previewRefresh.value!.reason).toBe("rotary:A");
    handleStatusMessage({ type: "status", data: {} });
    expect(previewRefresh.value).toBeNull();
    expect(previewRefreshElapsedMs.value).toBe(0);
  });

  it("previewRefreshPct: elapsed over expected, capped at 97 % (only the publish completes it), 0 without an expectation", () => {
    handleStatusMessage({ type: "status", data: {}, preview_refresh: PR });
    previewRefreshElapsedMs.value = 15000;
    expect(previewRefreshPct.value).toBeCloseTo(50, 6);
    previewRefreshElapsedMs.value = 60000;
    expect(previewRefreshPct.value).toBe(97);
    handleStatusMessage({ type: "status", data: {}, preview_refresh: { ...PR, started_ms: 3000, expected_ms: null } });
    previewRefreshElapsedMs.value = 15000;
    expect(previewRefreshPct.value).toBe(0);
    handleStatusMessage({ type: "status", data: {} });
    expect(previewRefreshPct.value).toBe(0);
  });

  it("ticks the elapsed clock locally while a parse runs and stops when it lands", () => {
    handleStatusMessage({ type: "status", data: {}, preview_refresh: PR });
    vi.advanceTimersByTime(1100);
    expect(previewRefreshElapsedMs.value).toBeGreaterThan(0);
    handleStatusMessage({ type: "status", data: {} });
    vi.advanceTimersByTime(600);
    expect(previewRefreshElapsedMs.value).toBe(0);
  });

  it("labels the gateway's edge names for the operator", () => {
    expect(previewRefreshLabel("wcsoff:G54:x")).toBe("touch-off (G54 X)");
    expect(previewRefreshLabel("wcsoff:g92:z")).toBe("touch-off (g92 Z)");
    expect(previewRefreshLabel("rotary:AC")).toBe("rotary pose (AC)");
    expect(previewRefreshLabel("kins:type")).toBe("kinematics mode change");
    expect(previewRefreshLabel("kins:frame")).toBe("plane change");
    expect(previewRefreshLabel("tlo:3")).toBe("tool length change");
    expect(previewRefreshLabel("file")).toBe("program load");
    expect(previewRefreshLabel("reparse")).toBe("operator reparse");
    expect(previewRefreshLabel("schema")).toBe("suite upgrade");
    expect(previewRefreshLabel(null)).toBe("machine state change");
  });
});

describe("rfl_status messages", () => {
  it("dedupes by ts; failures count unread, progress lines do not", () => {
    const rfl = { phase: "measuring", ts: 100 };
    handleStatusMessage({ type: "status", data: {}, rfl_status: rfl });
    handleStatusMessage({ type: "status", data: {}, rfl_status: rfl });  // same ts → ignored
    expect(messages.value).toHaveLength(1);
    expect(messages.value[0]!.kind).toBe(OPERATOR_DISPLAY);
    expect(unreadCount.value).toBe(0);             // progress: no unread badge

    handleStatusMessage({ type: "status", data: {}, rfl_status: { phase: "safe_z", ts: 101, ok: false, error: "probe open" } });
    expect(messages.value).toHaveLength(2);
    expect(messages.value[1]!.kind).toBe(OPERATOR_ERROR);
    expect(messages.value[1]!.text).toContain("probe open");
    expect(unreadCount.value).toBe(1);
  });
});

describe("RTT anchors (function-call crossing only)", () => {
  it("a status WITHOUT timing must not consume the anchor; one WITH timing does", () => {
    // The anchor guard is `> 0` — advance the fake clock so performance.now()
    // is non-zero when the anchor is set.
    vi.advanceTimersByTime(100);
    noteHeartbeatSent();
    handleStatusMessage({ type: "status", data: {} });          // plain status first
    expect(latency.value).toBeNull();                            // anchor intact
    handleStatusMessage({ type: "status", data: {}, timing: { server_ms: 2 } });
    expect(latency.value).not.toBeNull();                        // consumed now
    const first = latency.value;
    handleStatusMessage({ type: "status", data: {}, timing: { server_ms: 2 } });
    expect(latency.value).toBe(first);                           // anchor spent — no rewrite
  });

  it("pong consumes the heartbeat anchor once", () => {
    vi.advanceTimersByTime(100);
    noteHeartbeatSent();
    notePong();
    expect(networkLatency.value).not.toBeNull();
    const v = networkLatency.value;
    notePong();                                                  // anchor spent
    expect(networkLatency.value).toBe(v);
  });

  it("resetOnClose nulls the readouts and burns the anchors", () => {
    noteHeartbeatSent();
    resetOnClose();
    expect(latency.value).toBeNull();
    expect(networkLatency.value).toBeNull();
    notePong();                                                  // burned anchor → no-op
    expect(networkLatency.value).toBeNull();
  });
});

describe("mergeStatusPatch", () => {
  it("patches the current status object", () => {
    handleStatusMessage({ type: "status", data: { a: 1 } });
    flushRaf();
    mergeStatusPatch({ clients: [{ ip: "1.1.1.1", armed: false }] });
    expect(status.value?.clients).toEqual([{ ip: "1.1.1.1", armed: false }]);
    expect(status.value?.data).toEqual({ a: 1 });                // rest preserved
  });

  it("is only safe for fields the server re-sends every frame", () => {
    // The next full status replaces the whole object, so anything patched in
    // and NOT re-sent is gone. `clients` self-heals because the gateway puts
    // it on every envelope; HTTP-fetched bulk data does not, which is why it
    // uses noteBulkData instead (see below).
    mergeStatusPatch({ surface_points: [[1, 2, 3]] as any });
    expect(status.value?.surface_points).toEqual([[1, 2, 3]]);
    handleStatusMessage({ type: "status", data: { b: 2 } });
    flushRaf();
    expect(status.value?.surface_points).toBeUndefined();
  });

  it("noteBulkData survives arbitrarily many status frames (F1 fixed)", () => {
    const pts = [[1, 2, 3]] as any;
    noteBulkData("surface_points", 7, pts);
    for (let i = 0; i < 5; i++) {
      handleStatusMessage({ type: "status", data: { tick: i } });
      flushRaf();
      expect(status.value?.surface_points, `frame ${i}`).toEqual([[1, 2, 3]]);
    }
    expect(status.value?.bulk_versions?.surface_points).toBe(7);
  });

  it("a fetch resolving AFTER its status frame was buffered is not overwritten", () => {
    // The narrow version of the same wipe: the frame is already in the rAF
    // buffer when the HTTP fetch lands, so the carry must be re-applied at
    // flush time, not only on arrival.
    handleStatusMessage({ type: "status", data: { n: 1 } });   // buffered
    noteBulkData("surface_points", 4, [[4, 4, 4]] as any);      // fetch resolves
    flushRaf();
    expect(status.value?.surface_points).toEqual([[4, 4, 4]]);
  });

  it("carries the SAME array reference, not a copy", () => {
    // Consumers watch these by identity; a fresh array per tick would rebuild
    // the surface InstancedMesh ~30 times a second.
    const pts = [[1, 2, 3]] as any;
    noteBulkData("surface_points", 1, pts);
    handleStatusMessage({ type: "status", data: {} });
    flushRaf();
    const a = status.value?.surface_points;
    handleStatusMessage({ type: "status", data: {} });
    flushRaf();
    expect(status.value?.surface_points).toBe(a);
    expect(a).toBe(pts);
  });

  it("a newer version replaces the carried value and bumps the version", () => {
    noteBulkData("surface_points", 1, [[1, 1, 1]] as any);
    noteBulkData("surface_points", 2, [[9, 9, 9]] as any);
    handleStatusMessage({ type: "status", data: {} });
    flushRaf();
    expect(status.value?.surface_points).toEqual([[9, 9, 9]]);
    expect(status.value?.bulk_versions?.surface_points).toBe(2);
  });

  it("an EMPTY result is carried too, so a cleared map can clear the display", () => {
    noteBulkData("surface_points", 1, [[1, 1, 1]] as any);
    noteBulkData("surface_points", 2, [] as any);
    handleStatusMessage({ type: "status", data: {} });
    flushRaf();
    expect(status.value?.surface_points).toEqual([]);
    expect(status.value?.bulk_versions?.surface_points).toBe(2);
  });

  it("a server-sent field of the same name still wins", () => {
    noteBulkData("surface_points", 1, [[1, 1, 1]] as any);
    handleStatusMessage({ type: "status", data: {}, surface_points: [[5, 5, 5]] });
    flushRaf();
    expect(status.value?.surface_points).toEqual([[5, 5, 5]]);
  });

  it("survives a reconnect — the map on screen did not stop being true", () => {
    noteBulkData("comp_grid", 3, { x: [1], y: [1], zi: [[0]], method: 2 } as any);
    resetOnClose();
    handleStatusMessage({ type: "status", data: {} });
    flushRaf();
    expect(status.value?.comp_grid).toBeTruthy();
  });

  it("status_error surfaces the error and patches the clients list in", () => {
    handleStatusError({ type: "status_error", error: "stat read failed", clients: [{ ip: "1.2.3.4", armed: false }] });
    expect(lcncError.value).toBe("stat read failed");
    expect(status.value?.clients).toEqual([{ ip: "1.2.3.4", armed: false }]);
    handleStatusError({ type: "status_error", error: "again" });  // no clients field
    expect(status.value?.clients).toEqual([{ ip: "1.2.3.4", armed: false }]);
  });
});

describe("message center", () => {
  it("push/dismiss/clear/markRead drive the refs and persist to localStorage", () => {
    pushMessage(OPERATOR_ERROR, "one");
    pushMessage(OPERATOR_DISPLAY, "two", false);
    expect(messages.value.map(m => m.text)).toEqual(["one", "two"]);
    expect(unreadCount.value).toBe(1);
    expect(JSON.parse(localStorage.getItem("lcnc-messages")!)).toHaveLength(2);

    markMessagesRead();
    expect(unreadCount.value).toBe(0);
    dismissMessage(messages.value[0]!.id);
    expect(messages.value.map(m => m.text)).toEqual(["two"]);
    clearAllMessages();
    expect(messages.value).toEqual([]);
    expect(JSON.parse(localStorage.getItem("lcnc-messages")!)).toEqual([]);
  });
});

describe("timing stats", () => {
  it("timing-bearing statuses recompute stats; CSV includes frame samples", () => {
    noteFrameSample("ws_bytes", 512);
    noteFrameSample("decode", 1.5);
    expect(timingStats.value).toBeNull();          // frame samples alone don't recompute
    handleStatusMessage({ type: "status", data: {}, timing: { server_ms: 3, cycle_ms: 33 } });
    expect(timingStats.value).not.toBeNull();
    expect(timingStats.value!.cycle.last).toBe(33);
    const csv = getTimingCsv();
    expect(csv.split("\n")[0]).toContain("ws_bytes");
    expect(csv).toContain("512");
    resetTimingStats();
    expect(timingStats.value).toBeNull();
  });
});

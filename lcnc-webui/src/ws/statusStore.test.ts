// Unit tests for ws/statusStore.ts (A1.5) — the hardest extraction of the
// lcncWs split. Every behavior here is pinned BYTE-FOR-BYTE from the monolith,
// including ledger oddity F1 (mergeStatusPatch wiped by the next full status).
//
// rAF in this suite is the testGlobals stub: setTimeout(cb, 16). Tests use
// fake timers and advance 16 ms to flush the status buffer deterministically.
import "../testGlobals";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPERATOR_DISPLAY, OPERATOR_ERROR } from "../lcnc";
import {
  clearAllMessages, configWarning, dismissMessage, getTimingCsv,
  handleStatusError, handleStatusMessage, latency, lcncError,
  markMessagesRead, mergeStatusPatch, messages, networkLatency,
  noteFrameSample, noteHeartbeatSent, notePong, pushMessage,
  readerStale, rebaseStatusDelta, resetOnClose, resetTimingStats,
  safetyTrip, status, timingStats, unreadCount,
} from "./statusStore";

function flushRaf() {
  vi.advanceTimersByTime(16);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Connection-scoped + per-test reset using only the public API.
  resetOnClose();
  resetTimingStats();
  clearAllMessages();
  status.value = null;
  lcncError.value = null;
  safetyTrip.value = null;
  readerStale.value = false;
  configWarning.value = null;
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

describe("mergeStatusPatch — ledger oddity F1 pinned", () => {
  it("patches the current status object", () => {
    handleStatusMessage({ type: "status", data: { a: 1 } });
    flushRaf();
    mergeStatusPatch({ surface_points: [[0, 0, 0]] });
    expect(status.value?.surface_points).toEqual([[0, 0, 0]]);
    expect(status.value?.data).toEqual({ a: 1 });                // rest preserved
  });

  it("F1: the NEXT full status replaces the object and the patch is gone", () => {
    mergeStatusPatch({ surface_points: [[1, 2, 3]] });
    expect(status.value?.surface_points).toEqual([[1, 2, 3]]);
    handleStatusMessage({ type: "status", data: { b: 2 } });
    flushRaf();
    // CURRENT (odd) behavior, preserved verbatim from the monolith: the
    // surface points vanish until the next surface_points_ready ping.
    expect(status.value?.surface_points).toBeUndefined();
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

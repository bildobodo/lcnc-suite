// Unit tests for ws/telemetry.ts (A1.3) — batching windows pinned at
// extraction time from the lcncWs.ts monolith.
//
// Note on the 200-event cap: it is a DEFENSIVE invariant, not reachable via
// the public API under normal timer semantics — the >=32 early flush is
// synchronous, so the queue can never grow past one batch between flushes.
// Pinned in the ledger as oddity F3 (flag-don't-fix).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitTelemetry } from "./telemetry";

let posted: string[];

beforeEach(() => {
  vi.useFakeTimers();
  posted = [];
  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => {
    posted.push(String(init?.body ?? ""));
    return Promise.resolve(new Response(null, { status: 204 }));
  });
});

afterEach(() => {
  vi.runAllTimers();   // drain any scheduled flush so state can't leak across tests
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function lines(body: string): Array<Record<string, any>> {
  return body.split("\n").map(l => JSON.parse(l));
}

describe("telemetry batcher", () => {
  it("coalesces events into one NDJSON POST after the 2 s window", () => {
    emitTelemetry("a", { n: 1 });
    emitTelemetry("b", { n: 2 });
    expect(posted).toHaveLength(0);          // nothing before the window closes
    vi.advanceTimersByTime(2000);
    expect(posted).toHaveLength(1);
    const evts = lines(posted[0]!);
    expect(evts.map(e => e.kind)).toEqual(["a", "b"]);
    expect(evts[0]).toMatchObject({ kind: "a", n: 1 });
    expect(evts[0]!.t_wall_ms).toBeTypeOf("number");
  });

  it("flushes early when the queue hits the 32-event batch size", () => {
    for (let i = 0; i < 32; i++) emitTelemetry("burst", { i });
    expect(posted).toHaveLength(1);          // size trigger, no timer needed
    expect(lines(posted[0]!)).toHaveLength(32);
    // The 33rd event starts a fresh window and rides the next timer flush.
    emitTelemetry("tail", {});
    expect(posted).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(posted).toHaveLength(2);
    expect(lines(posted[1]!).map(e => e.kind)).toEqual(["tail"]);
  });

  it("drains fully — no event is posted twice across flushes", () => {
    emitTelemetry("x", {});
    vi.advanceTimersByTime(2000);
    emitTelemetry("y", {});
    vi.advanceTimersByTime(2000);
    expect(posted).toHaveLength(2);
    expect(lines(posted[0]!).map(e => e.kind)).toEqual(["x"]);
    expect(lines(posted[1]!).map(e => e.kind)).toEqual(["y"]);
  });

  it("is best-effort: a rejecting fetch neither throws nor wedges the queue", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    emitTelemetry("doomed", {});
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    await Promise.resolve();                 // let the .catch handler run
    // Queue was spliced before the POST — the next event flushes cleanly.
    vi.stubGlobal("fetch", (_u: string, init?: RequestInit) => {
      posted.push(String(init?.body ?? ""));
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    emitTelemetry("alive", {});
    vi.advanceTimersByTime(2000);
    expect(posted.flatMap(p => lines(p).map(e => e.kind))).toEqual(["alive"]);
  });
});

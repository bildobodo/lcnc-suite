// Unit tests for ws/telemetry.ts (A1.3) — batching windows pinned at
// extraction time from the lcncWs.ts monolith.
//
// Note on the 200-event cap: it is a DEFENSIVE invariant, not reachable via
// the public API under normal timer semantics — the >=32 early flush is
// synchronous, so the queue can never grow past one batch between flushes.
// Pinned in the ledger as oddity F3 (flag-don't-fix).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitTelemetry, telemetryDropped } from "./telemetry";

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
    // One page id per document, identical on every event.
    expect(evts[0]!.page).toMatch(/^[a-z0-9]+$/);
    expect(evts[1]!.page).toBe(evts[0]!.page);
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

  it("is best-effort: a rejecting fetch neither throws nor wedges the queue — and its loss is counted", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    emitTelemetry("doomed", {});
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    await settle();                          // let the rejection handler run
    expect(telemetryDropped()).toMatchObject({ events: 1, batches: 1, why: { network: 1 } });
    // Queue was spliced before the POST — the next event flushes cleanly,
    // the loss report in front of it (P3: never swallowed)
    vi.stubGlobal("fetch", (_u: string, init?: RequestInit) => {
      posted.push(String(init?.body ?? ""));
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    emitTelemetry("alive", {});
    vi.advanceTimersByTime(2000);
    const sent = posted.flatMap(p => lines(p));
    expect(sent.map(e => e.kind)).toEqual(["telemetry.dropped", "alive"]);
    expect(sent[0]).toMatchObject({ events: 1, batches: 1, why: { network: 1 } });
    await settle();
    expect(telemetryDropped()).toBeNull();   // cleared only by the delivery
  });
});

async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await Promise.resolve();   // a JSON body is read in several turns
}

describe("the transport's losses (P3, F20)", () => {
  function answer(res: () => Response) {
    vi.stubGlobal("fetch", (_u: string, init?: RequestInit) => {
      posted.push(String(init?.body ?? ""));
      return Promise.resolve(res());
    });
  }
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });

  it("a non-2xx answer is a counted loss; the report rides the next batch and clears on its delivery", async () => {
    answer(() => new Response("no", { status: 500 }));
    emitTelemetry("a", {}); emitTelemetry("b", {});
    vi.advanceTimersByTime(2000);
    await settle();
    expect(telemetryDropped()).toMatchObject({ events: 2, batches: 1, why: { status_500: 2 } });
    answer(() => json({ ok: true, events: 2, rejected: 0 }));
    emitTelemetry("c", {});
    vi.advanceTimersByTime(2000);
    await settle();
    const last = lines(posted[posted.length - 1]!);
    expect(last.map(e => e.kind)).toEqual(["telemetry.dropped", "c"]);
    expect(last[0]).toMatchObject({ events: 2, why: { status_500: 2 } });
    expect(telemetryDropped()).toBeNull();
  });

  it("the gateway's refusal and its rejected lines are losses too; a failed report keeps its count", async () => {
    answer(() => json({ ok: false, error: "body_too_large" }));
    emitTelemetry("a", {});
    vi.advanceTimersByTime(2000);
    await settle();
    expect(telemetryDropped()).toMatchObject({ events: 1, why: { refused_body_too_large: 1 } });
    // the report's own batch fails: nothing cleared, its events added
    answer(() => new Response("", { status: 503 }));
    emitTelemetry("b", {});
    vi.advanceTimersByTime(2000);
    await settle();
    expect(telemetryDropped()).toMatchObject({ events: 2, batches: 2, why: { refused_body_too_large: 1, status_503: 1 } });
    answer(() => json({ ok: true, events: 2, rejected: 1 }));
    emitTelemetry("c", {});
    vi.advanceTimersByTime(2000);
    await settle();
    // delivered: the two reported are cleared, the one line the gateway rejected stays counted
    expect(telemetryDropped()).toMatchObject({ events: 1, batches: 1, why: { rejected_lines: 1 } });
    answer(() => new Response(null, { status: 204 }));
    emitTelemetry("d", {});
    vi.advanceTimersByTime(2000);
    await settle();
    expect(telemetryDropped()).toBeNull();
  });
});

// Unit tests for ws/wsTransport.ts (A1.4) — worker lifecycle, message shapes
// and URL building pinned at extraction time from the lcncWs.ts monolith.
import "../testGlobals";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

class FakeWorker {
  static instances: FakeWorker[] = [];
  url: URL;
  posted: any[] = [];
  terminated = false;
  onmessage: ((ev: { data: any }) => void) | null = null;
  constructor(url: URL) {
    this.url = url;
    FakeWorker.instances.push(this);
  }
  postMessage(m: any) {
    if (this.terminated) throw new Error("post after terminate");
    this.posted.push(m);
  }
  terminate() { this.terminated = true; }
}
(globalThis as any).Worker = FakeWorker;
// buildWsUrl reads location at call time (none exists in node).
(globalThis as any).location = { protocol: "http:", hostname: "box.local", host: "box.local:8000" };

const {
  buildWsUrl, captureArmedForResume, connectTransport,
  postWorkerConfig, sendCommand, terminateTransport,
} = await import("./wsTransport");

function lastWorker(): FakeWorker {
  return FakeWorker.instances[FakeWorker.instances.length - 1]!;
}

beforeEach(() => {
  terminateTransport();
  FakeWorker.instances = [];
});

afterEach(() => {
  terminateTransport();
});

describe("buildWsUrl", () => {
  it("targets the gateway directly in dev (no Vite proxy hop) and ends in /ws", () => {
    // vitest sets import.meta.env.DEV = true; VITE_GATEWAY_PORT is unset → 8000.
    expect(buildWsUrl()).toBe("ws://box.local:8000/ws");
  });
});

describe("transport lifecycle", () => {
  it("connect spawns the wsWorker with a connect message carrying the session id", () => {
    const events: any[] = [];
    connectTransport("ws://x/ws", (m) => events.push(m));
    const w = lastWorker();
    expect(String(w.url)).toContain("wsWorker");
    expect(w.posted).toHaveLength(1);
    const connect = w.posted[0];
    expect(connect).toMatchObject({ type: "connect", url: "ws://x/ws", resumeArmed: false, hidden: false });
    expect(connect.session).toBeTypeOf("string");
    expect(connect.session.length).toBeGreaterThan(0);

    // Worker events are relayed verbatim to the orchestrator callback.
    w.onmessage!({ data: { type: "open", attempt: 1 } });
    expect(events).toEqual([{ type: "open", attempt: 1 }]);
  });

  it("session id is stable across reconnects (sessionStorage-backed)", () => {
    connectTransport("ws://x/ws", () => {});
    const first = lastWorker().posted[0].session;
    connectTransport("ws://x/ws", () => {});
    expect(lastWorker().posted[0].session).toBe(first);
  });

  it("reconnect tears the previous worker down (no ghost clients)", () => {
    connectTransport("ws://x/ws", () => {});
    const w1 = lastWorker();
    connectTransport("ws://x/ws", () => {});
    expect(w1.terminated).toBe(true);
    expect(w1.posted.some((m: any) => m.type === "close")).toBe(true);
    expect(lastWorker()).not.toBe(w1);
  });

  it("sendCommand posts the classified send message; no-op without a worker", () => {
    sendCommand('{"cmd":"jog"}', "jog", true);  // no worker — must not throw
    connectTransport("ws://x/ws", () => {});
    sendCommand('{"cmd":"jog"}', "jog", true);
    expect(lastWorker().posted[1]).toEqual({
      type: "send", payload: '{"cmd":"jog"}', cmd: "jog", dropIfClosed: true,
    });
  });

  it("postWorkerConfig wraps updateConfig; captureArmedForResume hands armed to the worker", () => {
    connectTransport("ws://x/ws", () => {});
    postWorkerConfig({ hidden: true, fireHeartbeat: false });
    captureArmedForResume(true);
    const w = lastWorker();
    expect(w.posted[1]).toEqual({ type: "updateConfig", hidden: true, fireHeartbeat: false });
    expect(w.posted[2]).toEqual({ type: "updateConfig", resumeArmed: true });
  });

  it("terminate posts close, terminates, and later sends are no-ops", () => {
    connectTransport("ws://x/ws", () => {});
    const w = lastWorker();
    terminateTransport();
    expect(w.terminated).toBe(true);
    expect(w.posted.some((m: any) => m.type === "close")).toBe(true);
    expect(() => sendCommand("{}", "heartbeat", false)).not.toThrow();
  });
});

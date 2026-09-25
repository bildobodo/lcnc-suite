// Unit tests for wsWorker.ts's reconnect gate (2026-09-23): after a close the
// worker asks the gateway over HTTP (GET /ready) and opens a WebSocket only
// once it answers — a failed WebSocket attempt feeds the browser's own
// reconnect backoff (Firefox: up to 60 s per IP:port, surviving reloads), and
// the old 3 s connect timeout cancelled every attempt the browser held.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  binaryType = "blob";
  bufferedAmount = 0;
  sent: string[] = [];
  closeCalls = 0;
  onopen: (() => void) | null = null;
  onclose: ((ev: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { type: string }) => void) | null = null;
  url: string;
  constructor(url: string) { this.url = url; FakeWebSocket.instances.push(this); }
  send(p: string) { this.sent.push(p); }
  close() {
    this.closeCalls++;
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.drop(1006);
  }
  // Test drivers.
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  drop(code = 1006) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason: "", wasClean: false });
  }
}

const posted: any[] = [];
const fakeSelf: any = { postMessage: (m: unknown) => posted.push(m), onmessage: null };
(globalThis as any).self = fakeSelf;
(globalThis as any).WebSocket = FakeWebSocket;

let gatewayUp = false;
const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
  gatewayUp ? Promise.resolve({ status: 204 }) : Promise.reject(new TypeError("NetworkError")));
(globalThis as any).fetch = fetchMock;

const { readyUrlFor } = await import("./wsWorker");

const URL_WS = "ws://192.168.64.4:8000/ws?token=secret";
const send = (m: unknown) => fakeSelf.onmessage({ data: m });
const sockets = () => FakeWebSocket.instances;
const lastSocket = () => sockets()[sockets().length - 1]!;
const ofType = (t: string) => posted.filter((m) => m?.type === t);
const lastOf = <T>(a: T[]): T | undefined => a[a.length - 1];

function connect() {
  send({ type: "connect", url: URL_WS, session: "s-test", resumeArmed: false, hidden: false });
}

beforeEach(() => {
  vi.useFakeTimers();
  send({ type: "close" });
  FakeWebSocket.instances = [];
  posted.length = 0;
  fetchMock.mockClear();
  gatewayUp = false;
});

afterEach(() => {
  send({ type: "close" });
  vi.useRealTimers();
});

describe("readyUrlFor", () => {
  it("maps the socket URL to the gateway's /ready without the token", () => {
    expect(readyUrlFor(URL_WS)).toBe("http://192.168.64.4:8000/ready");
    expect(readyUrlFor("wss://cnc.example/ws")).toBe("https://cnc.example/ready");
  });
});

describe("first connection", () => {
  it("opens the socket at once, without a probe", () => {
    connect();
    expect(sockets()).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ofType("attempt")[0]).toMatchObject({ probed: false });
  });
});

describe("reconnect through the HTTP gate", () => {
  it("never opens another socket while the gateway does not answer", async () => {
    connect();
    lastSocket().open();
    lastSocket().drop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sockets()).toHaveLength(1);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(25);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://192.168.64.4:8000/ready");
    expect(ofType("probe").map((m) => m.phase)).toEqual(["down"]);
  });

  it("opens the socket as soon as a probe answers, and says how long it waited", async () => {
    connect();
    lastSocket().open();
    lastSocket().drop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets()).toHaveLength(1);
    gatewayUp = true;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets()).toHaveLength(2);
    expect(lastOf(ofType("attempt"))).toMatchObject({ probed: true });
    const up = ofType("probe").find((m) => m.phase === "up");
    expect(up?.probes).toBeGreaterThan(1);
    expect(up?.downMs).toBeGreaterThan(0);
  });

  it("probes 500 ms after a dropped connection, 2 s after an attempt that never opened", async () => {
    connect();
    lastSocket().open();
    lastSocket().drop();
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    send({ type: "close" });
    fetchMock.mockClear();
    connect();
    lastSocket().drop();          // refused before it ever opened
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a gateway that is up on the first probe reconnects without a down report", async () => {
    connect();
    lastSocket().open();
    gatewayUp = true;
    lastSocket().drop();
    await vi.advanceTimersByTimeAsync(500);
    expect(sockets()).toHaveLength(2);
    expect(ofType("probe")).toEqual([]);
  });

  it("reports a long outage at most once a minute", async () => {
    connect();
    lastSocket().open();
    lastSocket().drop();
    await vi.advanceTimersByTimeAsync(130_000);
    expect(ofType("probe").map((m) => m.phase)).toEqual(["down", "still_down", "still_down"]);
  });
});

describe("a held CONNECTING socket", () => {
  it("is not cancelled at 3 s — only by the 10 s backstop", async () => {
    connect();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(lastSocket().closeCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(7_000);
    expect(lastSocket().closeCalls).toBe(1);
  });
});

describe("teardown", () => {
  it("stops the probe loop, and a probe answered afterwards opens nothing", async () => {
    let answer: (v: { status: number }) => void = () => {};
    connect();
    lastSocket().open();
    lastSocket().drop();
    fetchMock.mockImplementationOnce(() => new Promise<{ status: number }>((res) => { answer = res; }));
    await vi.advanceTimersByTimeAsync(500);   // probe in flight
    send({ type: "close" });
    answer({ status: 204 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

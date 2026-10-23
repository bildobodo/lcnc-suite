// The client's half of the browser-PC instruments (Codex R186 VP186-01): a
// frame's receipt stamp is the WS worker's — another context's clock — and
// reaches the status store only through the two-way exchange each sent
// heartbeat starts, at its EARLIEST time on this page's clock; none before an
// exchange or after a new worker. A witness word goes on to the worker.
import "./testGlobals";
import { beforeEach, expect, it, vi } from "vitest";

const probes: Array<Record<string, any>> = [];
let onEvent: ((m: any) => void) | null = null;
vi.mock("./ws/wsTransport", async (orig) => ({
  ...(await orig<typeof import("./ws/wsTransport")>()),
  buildWsUrl: () => "ws://x/ws",
  connectTransport: (_url: string, cb: (m: any) => void) => { onEvent = cb; },
  postWorkerProbe: (m: Record<string, any>) => { probes.push(m); },
}));
const handled: Array<number | undefined> = [];
vi.mock("./ws/statusStore", async (orig) => ({
  ...(await orig<typeof import("./ws/statusStore")>()),
  handleStatusMessage: (_msg: unknown, rx?: number) => { handled.push(rx); },
}));

import { connectWs, noteWitnessDone } from "./lcncWs";
import { resetViewerPerf } from "./viewerPerf";

const T0 = performance.timeOrigin;
const frame = (rx: number) => onEvent!({ type: "message", data: JSON.stringify({ type: "status", data: {} }), rx });

beforeEach(() => { probes.length = 0; handled.length = 0; resetViewerPerf(); connectWs(); onEvent!({ type: "spawned" }); });

it("puts a frame's receipt on the page's clock through the exchange a heartbeat starts — none before it, none after a respawn", () => {
  frame(T0 + 5_000);                                   // no exchange yet: no receipt
  onEvent!({ type: "hbsent", at: T0 + 10, seq: 1, dt: 0, dn: 0 });
  const ping = probes[probes.length - 1]!;
  expect(ping.type).toBe("clock");
  // the worker reads 2000 ms ahead of this page
  onEvent!({ type: "clock", p0: ping.p0, w: ping.p0 + 2_000 });
  frame(T0 + 9_000);
  onEvent!({ type: "spawned" });                       // a new worker: a new relation
  frame(T0 + 9_500);
  expect(handled[0]).toBeUndefined();
  // at its earliest page time: the worker's stamp less the relation's upper end (2000 + 4 ms slack)
  expect(handled[1]).toBe(T0 + 9_000 - 2_004);
  expect(handled[2]).toBeUndefined();
});

it("hands a witness word to the WebSocket worker", () => {
  noteWitnessDone(4, 9);
  expect(probes[probes.length - 1]).toEqual({ type: "witness", tick: 4, n: 9 });
});

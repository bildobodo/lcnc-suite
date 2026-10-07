// The parallel sweep's coordinator (collisionWorker.ts) — the messages it
// owes its owner, driven through fake sub-workers (Codex R90's probe, made a
// test): every shard's latest word in a partial (VP-I47), a side request
// answered when the pool fails (VP-I48), the owner's pause, park, stop and
// cancel kept through the fall back to this core (VP-I49), the side id −1
// (VP-I50) — and the bodies the coordinator keeps for its shards never wear
// a tool pushed by a run on this core. The local runs are real sweeps on a
// two-triangle model that never comes near (the result is clear).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CollisionResult } from "./collision";

type Msg = Record<string, any>;
const hit = (line = 7) => ({ line, cum: 2, cumEnd: 3, a: "moving", b: "fixed", dist: 0, rapid: true, intervals: [[2, 3] as [number, number]] });
const result = (hits: ReturnType<typeof hit>[] = [], covered?: number, reason: "running" | "stopped" = "running"): CollisionResult => ({
  hits, staticContacts: [], samples: 20, coarsened: false, uncertified: null, pairCount: 2, pairsPrescreened: 0,
  bvhMs: 1, sweepMs: 20, truncated: covered === undefined ? null : { covered, reason } });
const machine = { groups: [{ id: "fixed", parent: "root" }, { id: "moving", parent: "root" }],
  kinematics: [{ group: "moving", joint: 0, type: "translate", direction: "x", sign: 1 }],
  workGroup: "fixed", toolGroup: "moving", unitScale: 1, axes: ["X", "Y", "Z"] };
const triangle = () => new Float32Array([0, 0, 0, 0, 10, 0, 0, 0, 10]);
const req = (id: number, o: { side?: boolean; maxShards?: number; bodies?: boolean; tool?: boolean } = {}) => ({
  id, side: !!o.side, modelKey: "simple" + (o.tool ? "+tool" : ""), machine,
  bodies: o.bodies === false ? undefined : [{ id: "fixed", group: "fixed", positions: triangle() }, { id: "moving", group: "moving", positions: triangle() }],
  tool: o.tool ? { diam: 1, len: 2 } : null,
  track: { pos: new Float32Array([10, 0, 0, 20, 0, 0]), abc: new Float32Array(6), cum: new Float32Array([0, 10]),
           rapid: new Uint8Array([1, 1]), lines: new Uint32Array([1, 2]), count: 2 },
  wcs: { g5x: [], g92: [], rotationDeg: 0 }, options: { margin: 2 }, maxShards: o.maxShards ?? 2 });

async function setup(cores = 4) {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const sent: Msg[] = [], workers: FakeWorker[] = [];
  class FakeWorker {
    onmessage: ((e: { data: Msg }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    messages: Msg[] = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(v: Msg) { this.messages.push(structuredClone(v)); }
    terminate() { this.terminated = true; }
    emit(v: Msg) { this.onmessage?.({ data: structuredClone(v) }); }
    /** An error the sub-worker did not handle; says whether it was handled. */
    fail(): boolean {
      let prevented = false;
      this.onerror?.({ message: "synthetic failure", preventDefault: () => { prevented = true; } });
      return prevented;
    }
  }
  const scope = { onmessage: null as ((e: { data: Msg }) => void) | null, postMessage: (m: Msg) => sent.push(structuredClone(m)),
    navigator: { hardwareConcurrency: cores }, location: { href: "https://test.invalid/collisionWorker.js" } };
  vi.stubGlobal("self", scope);
  vi.stubGlobal("Worker", FakeWorker);
  await import("./collisionWorker");
  return { sent, workers, send: (data: Msg) => scope.onmessage!({ data }) };
}
const last = (a: Msg[]) => a[a.length - 1]!;
const terminal = (m: Msg) => !!(m.result || m.error || m.cancelled || m.needBodies);

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("./sweepPump"); });

describe("how many shards", () => {
  it("leaves two cores to the page and the browser", async () => {
    for (const [cores, k] of [[3, 0], [4, 2], [6, 4], [16, 8]] as const) {
      const { workers, send } = await setup(cores);
      send(req(1, { maxShards: 8 }));
      expect(workers, `${cores} cores`).toHaveLength(k);
    }
  });
});

describe("a partial is every shard's latest word (VP-I47)", () => {
  it("a finished shard's findings show at once, and stay while the others run", async () => {
    const { sent, workers, send } = await setup();
    send(req(1));
    workers[0]!.emit({ id: 1, result: result([hit()]) });
    expect(last(sent).partial.hits.map((h: Msg) => h.line), "at once").toEqual([7]);
    vi.advanceTimersByTime(600);
    workers[1]!.emit({ id: 1, progress: 0.3, partial: result([], 0.3) });
    expect(last(sent).partial.hits.map((h: Msg) => h.line), "after the other's partial").toEqual([7]);
    expect(last(sent).progress).toBe(0.3);
  });
  it("a shard not heard from counts as swept 0, and the partial names the whole pool", async () => {
    const { sent, workers, send } = await setup();
    send(req(2));
    workers[0]!.emit({ id: 2, progress: 0.8, partial: result([hit()], 0.8) });
    const m = last(sent);
    expect([m.progress, m.partial.truncated.covered, m.partial.shards]).toEqual([0, 0, 2]);
  });
  it("a shard stopped at its sample backstop counts with what it swept", async () => {
    // Codex R91 VP-I47: a shard's result set its progress to 1 whatever it
    // covered — the pool read 80 % swept where every pair was swept to 20 %.
    const { sent, workers, send } = await setup();
    send(req(5));
    workers[0]!.emit({ id: 5, result: { ...result([hit()], 0.2), truncated: { covered: 0.2, reason: "samples" }, coarsened: true } });
    workers[1]!.emit({ id: 5, progress: 0.8 });
    expect(last(sent).progress).toBe(0.2);
    workers[1]!.emit({ id: 5, result: result() });
    expect(last(sent).result.truncated).toEqual({ covered: 0.2, reason: "samples" });
  });
  it("shard partials go out at most every PEEK_MS; the next progress carries a held one", async () => {
    const { sent, workers, send } = await setup();
    send(req(3));
    workers[0]!.emit({ id: 3, progress: 0.1, partial: result([hit(5)], 0.1) });
    workers[1]!.emit({ id: 3, progress: 0.1, partial: result([hit(9)], 0.1) });
    expect(sent.filter(m => m.partial)).toHaveLength(1);
    vi.advanceTimersByTime(600);
    workers[0]!.emit({ id: 3, progress: 0.2 });
    expect(last(sent).partial.hits.map((h: Msg) => h.line)).toEqual([5, 9]);
  });
  it("after continue a parked shard's snapshot stays in the view until it says more", async () => {
    const { sent, workers, send } = await setup();
    send(req(4));
    send({ stop: 4 });
    workers[0]!.emit({ id: 4, stopped: true, result: result([hit()], 0.4, "stopped") });
    workers[1]!.emit({ id: 4, stopped: true, result: result([], 0.2, "stopped") });
    expect(last(sent).stopped).toBe(true);
    send({ continue: 4 });
    vi.advanceTimersByTime(600);
    workers[1]!.emit({ id: 4, progress: 0.3, partial: result([], 0.3) });
    expect(last(sent).partial.hits.map((h: Msg) => h.line)).toEqual([7]);
  });
});

describe("a failing sub-worker (VP-I48, VP-I49)", () => {
  it("is handled where it happens — it never reaches the page's onerror", async () => {
    const { workers, send } = await setup();
    send(req(10));
    expect(workers[1]!.fail()).toBe(true);
  });
  it("a running sweep starts again on this core and answers", async () => {
    const { sent, workers, send } = await setup();
    send(req(11));
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    expect(workers.every(w => w.terminated)).toBe(true);
    expect(sent.filter(m => m.id === 11 && m.result)).toHaveLength(1);
  });
  it("the side request on shard 0 is answered", async () => {
    const { sent, workers, send } = await setup();
    send(req(12));
    send(req(-12, { side: true }));
    expect(workers[0]!.messages.some(m => m.id === -12)).toBe(true);
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    expect(sent.filter(m => m.id === -12 && terminal(m)).map(m => !!m.result)).toEqual([true]);
  });
  it("a side request cancelled before is acknowledged, not run", async () => {
    const { sent, workers, send } = await setup();
    send(req(13));
    send(req(-13, { side: true }));
    send({ cancel: -13 });
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    expect(sent.filter(m => m.id === -13 && terminal(m))).toEqual([{ id: -13, cancelled: true }]);
  });
  it("a hidden-tab pause holds the run here until resume", async () => {
    const { sent, workers, send } = await setup();
    send(req(14));
    send({ pause: 14, why: "hidden" });
    workers[1]!.fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent.some(m => m.id === 14 && m.result), "paused").toBe(false);
    send({ resume: 14, why: "hidden" });
    await vi.runAllTimersAsync();
    expect(sent.filter(m => m.id === 14 && m.result)).toHaveLength(1);
  });
  it("a parked sweep computes nothing until continue — then from the beginning", async () => {
    const { sent, workers, send } = await setup();
    send(req(15));
    send({ stop: 15 });
    for (const w of workers) w.emit({ id: 15, stopped: true, result: result([], 0.2, "stopped") });
    expect(last(sent).stopped).toBe(true);
    sent.length = 0;
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    expect(sent, "nothing while parked").toEqual([]);
    send({ continue: 15 });
    await vi.runAllTimersAsync();
    expect(sent.filter(m => m.id === 15 && m.result && !m.stopped)).toHaveLength(1);
  });
  it("a parked sweep is cancelled with an acknowledgement", async () => {
    const { sent, workers, send } = await setup();
    send(req(16));
    send({ stop: 16 });
    for (const w of workers) w.emit({ id: 16, stopped: true, result: result([], 0.2, "stopped") });
    workers[0]!.fail();
    sent.length = 0;
    send({ cancel: 16 });
    await vi.runAllTimersAsync();
    expect(sent).toEqual([{ id: 16, cancelled: true }]);
  });
  it("an unanswered stop gets what the shards swept as the parked result", async () => {
    const { sent, workers, send } = await setup();
    send(req(17));
    workers[0]!.emit({ id: 17, progress: 0.4, partial: result([hit()], 0.4) });
    send({ stop: 17 });
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    const parked = sent.filter(m => m.id === 17 && m.stopped);
    expect(parked).toHaveLength(1);
    expect(parked[0]!.result.hits.map((h: Msg) => h.line)).toEqual([7]);
    expect(parked[0]!.result.truncated).toEqual({ covered: 0, reason: "stopped" });
    expect(sent.some(m => m.id === 17 && m.result && !m.stopped), "parked, not run").toBe(false);
  });
  it("an unanswered stop with nothing swept yet is answered at once as the end — paused or not", async () => {
    // Codex R91 VP-I49: the run started here for it waited under a hidden
    // pause for a resume that never came, and the owner's stop stayed open.
    for (const paused of [false, true]) {
      const { sent, workers, send } = await setup();
      send(req(18));
      if (paused) send({ pause: 18, why: "hidden" });
      send({ stop: 18 });
      workers[1]!.fail();
      await vi.advanceTimersByTimeAsync(60_000);
      const answers = sent.filter(m => m.id === 18 && terminal(m) || m.id === 18 && m.stopped);
      expect(answers.map(m => Object.keys(m).filter(k => k !== "id").sort()), `paused=${paused}`).toEqual([["error"]]);
      expect(vi.getTimerCount(), `paused=${paused}: nothing left running`).toBe(0);
      send({ continue: 18 });
      await vi.runAllTimersAsync();
      expect(sent.filter(m => m.id === 18 && m.result), "an error is the end").toHaveLength(0);
    }
  });
  it("a cancelled sweep is acknowledged, not run again", async () => {
    const { sent, workers, send } = await setup();
    send(req(19));
    send({ cancel: 19 });
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    expect(sent.filter(m => m.id === 19)).toEqual([{ id: 19, cancelled: true }]);
  });
});

describe("the regular flow", () => {
  it("stop, continue, finish and a shard's error reach the owner", async () => {
    const { sent, workers, send } = await setup();
    send(req(20));
    workers[0]!.emit({ id: 20, result: result([hit()]) });
    send({ stop: 20 });
    workers[1]!.emit({ id: 20, stopped: true, result: result([], 0.2, "stopped") });
    expect(last(sent).stopped).toBe(true);
    expect(last(sent).result.hits).toHaveLength(1);
    send({ continue: 20 });
    workers[1]!.emit({ id: 20, result: result() });
    expect(last(sent).result.hits).toHaveLength(1);
    expect(last(sent).result.shards).toBe(2);
    send(req(21));
    workers[0]!.emit({ id: 21, error: "deliberate shard error" });
    expect(last(sent)).toEqual({ id: 21, error: "deliberate shard error" });
    expect(last(workers[1]!.messages)).toEqual({ cancel: 21 });
  });
  it("the bodies kept for the shards never wear a tool a local run added", async () => {
    const { sent, workers, send } = await setup();
    send(req(22, { tool: true, maxShards: 1 }));
    await vi.runAllTimersAsync();
    expect(sent.filter(m => m.id === 22 && m.result)).toHaveLength(1);
    send(req(23, { tool: true, bodies: false }));
    expect(workers).toHaveLength(2);
    for (const w of workers) expect(w.messages[0]!.bodies.map((b: Msg) => b.id)).toEqual(["fixed", "moving"]);
  });
});

describe("the side id −1 (VP-I50)", () => {
  it("the first local side request can be cancelled", async () => {
    // Hold the local sweep at its first slice boundary; the worker still owns
    // the cancel flag, routes the message and pumps.
    vi.doMock("./sweepPump", () => ({ runSweepSlice: (_it: unknown, _ms: number, cancelled: () => boolean) => {
      const c = cancelled();
      return { done: c, cancelled: c, result: null, progress: 0, checkpoints: 1 };
    } }));
    const { sent, workers, send } = await setup();
    send(req(-1, { side: true }));
    expect(workers).toHaveLength(0);
    send({ cancel: -1 });
    await vi.advanceTimersToNextTimerAsync();
    expect(sent.some(m => m.id === -1 && m.cancelled)).toBe(true);
  });
});

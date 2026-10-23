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
import { ContactStore, NONE, type StoreDelta } from "./contactStore";
import { boxPositions } from "./collisionFixtures";

type Msg = Record<string, any>;
/** A shard's word: its metadata — what it found is its tables' (C2); a note
 *  stands for what the word says. */
const result = (notes: string[] = [], covered?: number, reason: "running" | "stopped" = "running"): CollisionResult => ({
  staticContacts: [], samples: 20, coarsened: false, ...(notes.length ? { notes, uncertified: notes.join("; ") } : { uncertified: null }),
  pairCount: 2, pairsPrescreened: 0, bvhMs: 1, sweepMs: 20, truncated: covered === undefined ? null : { covered, reason } });
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
  it("a finished shard's word shows at once, and stays while the others run", async () => {
    const { sent, workers, send } = await setup();
    send(req(1));
    workers[0]!.emit({ id: 1, result: result(["n7"]) });
    expect(last(sent).partial.notes, "at once").toEqual(["n7"]);
    vi.advanceTimersByTime(600);
    workers[1]!.emit({ id: 1, progress: 0.3, partial: result([], 0.3) });
    expect(last(sent).partial.notes, "after the other's partial").toEqual(["n7"]);
    expect(last(sent).progress).toBe(0.3);
  });
  it("a shard not heard from counts as swept 0, and the partial names the whole pool", async () => {
    const { sent, workers, send } = await setup();
    send(req(2));
    workers[0]!.emit({ id: 2, progress: 0.8, partial: result(["n7"], 0.8) });
    const m = last(sent);
    expect([m.progress, m.partial.truncated.covered, m.partial.shards]).toEqual([0, 0, 2]);
  });
  it("a shard stopped at its sample backstop counts with what it swept", async () => {
    // Codex R91 VP-I47: a shard's result set its progress to 1 whatever it
    // covered — the pool read 80 % swept where every pair was swept to 20 %.
    const { sent, workers, send } = await setup();
    send(req(5));
    workers[0]!.emit({ id: 5, result: { ...result(["n7"], 0.2), truncated: { covered: 0.2, reason: "samples" }, coarsened: true } });
    workers[1]!.emit({ id: 5, progress: 0.8 });
    expect(last(sent).progress).toBe(0.2);
    workers[1]!.emit({ id: 5, result: result() });
    expect(last(sent).result.truncated).toEqual({ covered: 0.2, reason: "samples" });
  });
  it("shard partials go out at most every META_MS; the next progress carries a held one", async () => {
    const { sent, workers, send } = await setup();
    send(req(3));
    workers[0]!.emit({ id: 3, progress: 0.1, partial: result(["n5"], 0.1) });
    workers[1]!.emit({ id: 3, progress: 0.1, partial: result(["n9"], 0.1) });
    expect(sent.filter(m => m.partial)).toHaveLength(1);
    vi.advanceTimersByTime(600);
    workers[0]!.emit({ id: 3, progress: 0.2 });
    expect(last(sent).partial.notes).toEqual(["n5", "n9"]);
  });
  it("after continue a parked shard's snapshot stays in the view until it says more", async () => {
    const { sent, workers, send } = await setup();
    send(req(4));
    send({ stop: 4 });
    workers[0]!.emit({ id: 4, stopped: true, result: result(["n7"], 0.4, "stopped") });
    workers[1]!.emit({ id: 4, stopped: true, result: result([], 0.2, "stopped") });
    expect(last(sent).stopped).toBe(true);
    send({ continue: 4 });
    vi.advanceTimersByTime(600);
    workers[1]!.emit({ id: 4, progress: 0.3, partial: result([], 0.3) });
    expect(last(sent).partial.notes).toEqual(["n7"]);
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
  it("a decode pause holds the run here until its own resume — apart from the hidden-tab hold (plan „Prüfung im Lauf“ 4)", async () => {
    const { sent, workers, send } = await setup();
    send(req(19));
    send({ pause: 19, why: "decode" });
    send({ pause: 19, why: "hidden" });
    workers[1]!.fail();
    send({ resume: 19, why: "hidden" });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent.some(m => m.id === 19 && m.result), "still decoding").toBe(false);
    send({ resume: 19, why: "decode" });
    await vi.runAllTimersAsync();
    expect(sent.filter(m => m.id === 19 && m.result)).toHaveLength(1);
  });
  it("a decode pause released while the pool ran holds nothing after the fall back", async () => {
    const { sent, workers, send } = await setup();
    send(req(22));
    send({ pause: 22, why: "decode" });
    send({ resume: 22, why: "decode" });
    workers[1]!.fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sent.filter(m => m.id === 22 && m.result)).toHaveLength(1);
  });
  it("a request's slice length reaches the shards", async () => {
    const { workers, send } = await setup();
    send({ ...req(21), sliceMs: 20 });
    expect(workers.map(w => w.messages.find(m => m.id === 21)?.sliceMs)).toEqual([20, 20]);
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
    workers[0]!.emit({ id: 17, progress: 0.4, partial: result(["n7"], 0.4) });
    send({ stop: 17 });
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    const parked = sent.filter(m => m.id === 17 && m.stopped);
    expect(parked).toHaveLength(1);
    expect(parked[0]!.result.notes).toEqual(["n7"]);
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
    workers[0]!.emit({ id: 20, result: result(["n7"]) });
    send({ stop: 20 });
    workers[1]!.emit({ id: 20, stopped: true, result: result([], 0.2, "stopped") });
    expect(last(sent).stopped).toBe(true);
    expect(last(sent).result.notes).toEqual(["n7"]);
    send({ continue: 20 });
    workers[1]!.emit({ id: 20, result: result() });
    expect(last(sent).result.notes).toEqual(["n7"]);
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

describe("a check during a run stamps its real slices (the browser-PC witness, Codex R185)", () => {
  /** Slices of `ms` on the worker's clock, one iterator checkpoint each. */
  async function localRun(ms: number, o: { witness: boolean; cancelAt?: number }) {
    let clock = 1000;
    vi.doMock("./sweepPump", () => ({ runSweepSlice: (it: Iterator<number | undefined, CollisionResult>, _ms: number, cancelled: () => boolean) => {
      clock += ms;
      const cancel = cancelled();
      const r = it.next(cancel);
      if (cancel) { for (let g = 0; g < 4 && !it.next(true).done; g++); return { done: true, cancelled: true, result: null, progress: 0, checkpoints: 1 }; }
      return r.done ? { done: true, cancelled: false, result: r.value, progress: 1, checkpoints: 1 }
                    : { done: false, cancelled: false, result: null, progress: r.value ?? 0, checkpoints: 1 };
    } }));
    const { sent, send } = await setup(2);   // one core: the local path
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const n = 201, pos = new Float32Array(n * 3), cum = new Float32Array(n), lines = new Uint32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = 10 - i * 0.1; cum[i] = i * 0.1; lines[i] = i + 1; }
    send({ ...req(31), ...(o.witness ? { witness: true } : {}), contacts: { generation: 2 },
           track: { pos, abc: new Float32Array(n * 3), cum, rapid: new Uint8Array(n).fill(1), lines, count: n } });
    for (let i = 0; i < 2000 && !sent.some(terminal); i++) {
      if (o.cancelAt !== undefined && sent.filter(m => m.progress != null).length === o.cancelAt) send({ cancel: 31 });
      await vi.advanceTimersToNextTimerAsync();
      const ack = sent.filter(m => m.contacts).length;
      if (ack) send({ contactsAck: 31, generation: 2 });
    }
    return sent;
  }

  it("keeps the first slice of each 250 ms, as its start and end, and says them before the result", async () => {
    const sent = await localRun(100, { witness: true });
    const words = sent.filter(m => m.witness);
    const end = sent.findIndex(m => m.result);
    expect(end).toBeGreaterThan(0);
    expect(words.length).toBeGreaterThan(1);
    expect(sent.findIndex(m => m === words[words.length - 1])).toBeLessThan(end);
    for (const m of words) expect([m.id, m.witness.shard, m.witness.gen]).toEqual([31, null, 2]);
    // each word carries the computing context's clock as it leaves
    for (const m of words) expect(m.witness.at - performance.timeOrigin).toBeGreaterThanOrEqual(m.witness.s[m.witness.s.length - 1] - performance.timeOrigin);
    const s = words.flatMap(m => m.witness.s as number[]).map(t => t - performance.timeOrigin);
    const slices = sent.filter(m => m.progress != null).length + 1;
    expect(s[0]).toBe(1000);                                     // the first slice: right before and after it
    expect(s[1]).toBe(1100);
    for (let i = 0; i < s.length; i += 2) expect(s[i + 1]! - s[i]!).toBe(100);
    const buckets = s.filter((_, i) => i % 2 === 0).map(t => Math.floor((t + performance.timeOrigin) / 250));
    expect(new Set(buckets).size, "one a bucket").toBe(buckets.length);
    expect(s.length / 2).toBeLessThan(slices);                   // sampled, not every slice
    expect(s.length / 2).toBeGreaterThanOrEqual(Math.floor(slices * 100 / 250) - 1);
    // at most one word every 2 s of the worker's clock while it runs, the last at its end
    expect(words.length).toBeLessThanOrEqual(Math.ceil(slices * 100 / 2000) + 1);
  });

  it("a cancelled check says its slices before the acknowledgement", async () => {
    const sent = await localRun(100, { witness: true, cancelAt: 10 });
    const ack = sent.findIndex(m => m.cancelled);
    expect(ack).toBeGreaterThan(0);
    const words = sent.map((m, i) => [m, i] as const).filter(([m]) => m.witness);
    expect(words.length).toBeGreaterThan(0);
    expect(words[words.length - 1]![1]).toBeLessThan(ack);
    expect(sent.some(m => m.result), "cancelled, not finished").toBe(false);
    expect(words.flatMap(([m]) => m.witness.s).length / 2).toBeGreaterThanOrEqual(4);   // 1 s of 100 ms slices, 4 a second
  });

  it("a check that is not asked says nothing", async () => {
    const sent = await localRun(100, { witness: false });
    expect(sent.some(m => m.result)).toBe(true);
    expect(sent.some(m => m.witness)).toBe(false);
  });

  it("the pool asks each shard and passes its slices on named by the shard, even after the run ended", async () => {
    const { sent, workers, send } = await setup();
    send({ ...req(40), witness: true });
    expect(workers).toHaveLength(2);
    for (const w of workers) expect(w.messages[0]!.witness).toBe(true);
    // a shard sweeps without a shard option when the pool is one — the
    // coordinator names it
    workers[1]!.emit({ id: 40, witness: { shard: null, gen: null, s: [5, 25] } });
    send({ cancel: 40 });
    for (const w of workers) w.emit({ id: 40, cancelled: true });
    expect(sent.some(m => m.cancelled)).toBe(true);
    workers[0]!.emit({ id: 40, witness: { shard: null, gen: null, s: [7, 27, 300, 320] } });
    expect(sent.filter(m => m.witness)).toEqual([
      { id: 40, witness: { shard: 1, gen: null, s: [5, 25] } },
      { id: 40, witness: { shard: 0, gen: null, s: [7, 27, 300, 320] } }]);
  });
});

describe("the side id −1 (VP-I50)", () => {
  it("a local sweep posts its METADATA after its first slice, then only when it changes — no records (step 4 package 2, C2)", async () => {
    // one iterator checkpoint per slice: the real sweep, observable between;
    // each slice 600 ms on the worker's clock — more than META_MS, so a post
    // per slice would show
    let clock = 0;
    vi.doMock("./sweepPump", () => ({ runSweepSlice: (it: Iterator<number | undefined, CollisionResult>) => {
      clock += 600;
      const r = it.next();
      return r.done ? { done: true, cancelled: false, result: r.value, progress: 1, checkpoints: 1 }
                    : { done: false, cancelled: false, result: null, progress: r.value ?? 0, checkpoints: 1 };
    } }));
    const { sent, send } = await setup(2);   // one core for the sweep: the local path
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    // the moving triangle crosses the fixed one's plane: near misses inside
    // the 2 mm margin first, then the touch at X 0
    const n = 201, pos = new Float32Array(n * 3), cum = new Float32Array(n), lines = new Uint32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = 10 - i * 0.1; cum[i] = i * 0.1; lines[i] = i + 1; }
    send({ ...req(11), track: { pos, abc: new Float32Array(n * 3), cum, rapid: new Uint8Array(n).fill(1), lines, count: n } });
    for (let i = 0; i < 400 && !sent.some(terminal); i++) await vi.advanceTimersToNextTimerAsync();
    expect(sent.some(m => m.result)).toBe(true);
    const progress = sent.filter(m => m.progress != null);
    expect(progress.length, "slices more than META_MS apart").toBeGreaterThanOrEqual(3);
    expect(progress[0]!.partial, "the first slice's progress carries it").toBeDefined();
    const partials = sent.filter(m => m.partial).map(m => m.partial as Msg);
    // nothing in it changed while it swept: one
    expect(partials).toHaveLength(1);
    expect(partials[0]!.truncated.reason).toBe("running");
    expect(partials[0]!.pairCount).toBe(1);
    expect("hits" in partials[0]!, "no records").toBe(false);
    expect(sent.some(m => m.first), "no first-contact message").toBe(false);
  });
  it("no moving pair: the result still names the bodies by class (step 4 plan 1c)", async () => {
    const { sent, send } = await setup(2);
    // both bodies on the fixed group: nothing moves against anything; one has no facet with area
    send({ ...req(13), bodies: [{ id: "fixed", group: "fixed", positions: triangle() },
                                { id: "line", group: "fixed", positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]) }] });
    for (let i = 0; i < 50 && !sent.some(terminal); i++) await vi.advanceTimersToNextTimerAsync();
    const r = sent.find(m => m.result)!.result as CollisionResult;
    expect(r.pairCount).toBe(0);
    expect(r.bodies?.unusable).toEqual(["line"]);
  });
  it("a SIDE run's contacts reach the owner as deltas before its result — no partials (Codex R136 VP-I93, C2)", async () => {
    vi.doMock("./sweepPump", () => ({ runSweepSlice: (it: Iterator<number | undefined, CollisionResult>) => {
      const r = it.next();
      return r.done ? { done: true, cancelled: false, result: r.value, progress: 1, checkpoints: 1 }
                    : { done: false, cancelled: false, result: null, progress: r.value ?? 0, checkpoints: 1 };
    } }));
    const { sent, send } = await setup(2);
    // the entry move and a long start-dependent beginning: the side request
    const n = 401, pos = new Float32Array(n * 3), cum = new Float32Array(n), lines = new Uint32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = 10 - i * 0.05; cum[i] = i * 0.05; lines[i] = i + 1; }
    send({ ...req(-1, { side: true }), contacts: { generation: 0 },
           track: { pos, abc: new Float32Array(n * 3), cum, rapid: new Uint8Array(n).fill(1), lines, count: n } });
    // the owner acknowledges every delta as it comes
    let acked = 0;
    for (let i = 0; i < 800 && !sent.some(terminal); i++) {
      await vi.advanceTimersToNextTimerAsync();
      for (; acked < sent.filter(m => m.contacts).length; acked++) send({ contactsAck: -1, generation: 0 });
    }
    const at = sent.findIndex(m => m.result);
    expect(at).toBeGreaterThan(0);
    const touch = sent.findIndex(m => (m.contacts as StoreDelta[] | undefined)?.some(d => d.intervals.count > 0));
    expect(touch, "its first touch interval in a delta").toBeGreaterThanOrEqual(0);
    expect(touch, "before the result").toBeLessThan(at);
    expect(sent[touch]!.id).toBe(-1);
    expect(sent.filter(m => m.partial), "a side run posts no partials").toHaveLength(0);
  });
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

// Step 4 package 2, round A6: the contact deltas (plan Fassung 5, 3.1/3.2,
// Codex VP139-03) — at most one unacknowledged per path, the shards never held
// up by a slow owner, a run's last delta with its result, a fall back the next
// generation.
describe("contact deltas: one unacknowledged per path (package 2, VP139-03)", () => {
  // two boxes the track drives through each other: a real contact on this core
  const boxReq = (id: number, maxShards = 1) => ({
    ...req(id, { maxShards }), modelKey: "boxes",
    bodies: [{ id: "fixed", group: "fixed", positions: boxPositions(10, 10, 10) }, { id: "moving", group: "moving", positions: boxPositions(10, 10, 10) }],
    track: { pos: new Float32Array([-40, 0, 0, 40, 0, 0]), abc: new Float32Array(6), cum: new Float32Array([0, 80]),
             rapid: new Uint8Array([1, 1]), lines: new Uint32Array([1, 2]), count: 2 },
    contacts: { generation: 0 } });
  const drain = () => { for (let k = 0; k < 200; k++) vi.advanceTimersByTime(50); };

  it("this core: deltas while it sweeps, one at a time; the result waits for the acknowledgement of the delta before it", async () => {
    // one checkpoint per slice, so deltas go out while it sweeps
    vi.doMock("./sweepPump", () => ({ runSweepSlice: (it: Iterator<number | undefined, CollisionResult>) => {
      const r = it.next();
      return r.done ? { done: true, cancelled: false, result: r.value, progress: 1, checkpoints: 1 }
                    : { done: false, cancelled: false, result: null, progress: r.value ?? 0, checkpoints: 1 };
    } }));
    const { sent, send } = await setup(3);   // one core for sweeps: no pool
    const n = 161, pos = new Float32Array(n * 3), cum = new Float32Array(n), lines = new Uint32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = -40 + i * 0.5; cum[i] = i * 0.5; lines[i] = i + 1; }
    send({ ...boxReq(1), track: { pos, abc: new Float32Array(n * 3), cum, rapid: new Uint8Array(n).fill(1), lines, count: n } });
    for (let i = 0; i < 600; i++) await vi.advanceTimersToNextTimerAsync();
    expect(sent.filter(m => m.contacts).length, "one delta out, the rest waits").toBe(1);
    expect(sent.some(m => m.result), "no result before the acknowledgement").toBe(false);
    send({ contactsAck: 1, generation: 0 });
    for (let i = 0; i < 10 && !sent.some(m => m.result); i++) await vi.advanceTimersToNextTimerAsync();
    const fin = sent.find(m => m.result)!;
    expect(fin.contacts, "the last delta rides with the result").toHaveLength(1);
    expect(sent.filter(m => m.contacts).map(m => !!m.contactPairs), "the pairs named once, with the first delta").toEqual([true, false]);
    // the receiver's tables equal what was found: one stay, one touch interval
    const r = new ContactStore(1, 0);
    for (const m of sent.filter(x => x.contacts)) for (const d of m.contacts as StoreDelta[]) expect(r.apply(d)).toBe(true);
    expect([r.episodes.rows, r.intervals.rows]).toEqual([1, 1]);
    expect(r.intervals.get(0, "enter")).toBeLessThan(r.intervals.get(0, "exit"));
    expect(Number.isNaN(r.intervals.get(0, "exit")), "closed, its exit in the last delta").toBe(false);
  });

  it("the pairs' body ids go once per generation with its first delta — on this core and through the pool (round B2)", async () => {
    const { sent, workers, send } = await setup();
    send({ ...req(41), contacts: { generation: 0 } });
    const a = new ContactStore(41, 0), b = new ContactStore(41, 0);
    a.episodes.append({ pair: 0, ordinal: 0, onset: 0, end: NaN, closeAt: 0, closeDist: 1, firstIv: NONE });
    workers[0]!.emit({ id: 41, contacts: [a.takeDelta()!], contactPairs: [["moving", "fixed"]] }); a.ack();
    expect(sent.filter(m => m.contacts).map(m => m.contactPairs), "the coordinator's first forward names them").toEqual([[["moving", "fixed"]]]);
    send({ contactsAck: 41, generation: 0 });
    workers[1]!.emit({ id: 41, result: result(), contacts: [b.takeDelta(true)!] });
    workers[0]!.emit({ id: 41, result: result(), contacts: [a.takeDelta(true)!] });
    expect(sent.filter(m => m.contacts).map(m => m.contactPairs), "once").toEqual([[["moving", "fixed"]], undefined]);
    // this core: a run's first delta names its model's pairs
    const solo = await setup(3);
    solo.send({ ...req(42), contacts: { generation: 0 } });
    for (let i = 0; i < 50 && !solo.sent.some(m => m.result); i++) await vi.advanceTimersToNextTimerAsync();
    const first = solo.sent.find(m => m.contacts)!;
    expect(first.contactPairs, "the tool side and the work side by body id").toEqual([["moving", "fixed"]]);
  });

  it("the pool: a shard's delta is applied and acknowledged at once; the owner gets one message, then nothing until it acknowledges", async () => {
    const { sent, workers, send } = await setup();
    send({ ...req(2), contacts: { generation: 0 } });
    const shard0 = new ContactStore(2, 0), shard1 = new ContactStore(2, 0);
    const ep = (st: ContactStore, pair: number) => st.episodes.append({ pair, ordinal: 0, onset: pair, end: NaN, closeAt: pair, closeDist: 1, firstIv: NONE });
    const a = ep(shard0, 1);
    workers[0]!.emit({ id: 2, progress: 0.1, contacts: [shard0.takeDelta()!] });
    expect(workers[0]!.messages.some(m => m.contactsAck === 2 && m.generation === 0), "the shard acknowledged at once, in its generation").toBe(true);
    shard0.ack();
    const first = sent.filter(m => m.contacts);
    expect(first).toHaveLength(1);
    expect((first[0]!.contacts as StoreDelta[]).map(d => d.episodes.count), "one delta per shard").toEqual([1, 0]);
    // the owner is slow: the shards go on, their deltas are applied and acknowledged here
    ep(shard1, 7);
    workers[1]!.emit({ id: 2, progress: 0.2, contacts: [shard1.takeDelta()!] });
    shard1.ack();
    for (let k = 0; k < 500; k++) {
      shard0.episodes.set(a, "end", k);   // the same open episode, again and again
      workers[0]!.emit({ id: 2, progress: 0.2, contacts: [shard0.takeDelta()!] });
      shard0.ack();
    }
    expect(workers[1]!.messages.filter(m => m.contactsAck === 2)).toHaveLength(1);
    expect(sent.filter(m => m.contacts), "nothing more to the owner before its acknowledgement").toHaveLength(1);
    send({ contactsAck: 2, generation: 0 });
    const second = last(sent.filter(m => m.contacts)).contacts as StoreDelta[];
    expect(second.map(d => [d.episodes.count, d.episodes.updates.length]), "coalesced: one update for the 500").toEqual([[0, 1], [1, 0]]);
    expect(second[0]!.episodes.updated["end"]![0]).toBe(499);
  });

  // C2 (Codex R167): with the first touch carried by the tables alone, an
  // acknowledgement held behind a near miss's delta held the touch back by
  // its whole hold (measured in the browser: +395 ms at a 300 ms hold).
  const ivOut = (sent: Record<string, any>[], id: number) =>
    sent.filter(m => m.id === id && m.contacts).map(m => (m.contacts as StoreDelta[]).reduce((n, d) => n + d.intervals.count, 0));
  const addIv = (st: ContactStore, episode: number, at: number) => st.intervals.append({ episode, enter: at, exit: NaN, next: NONE, witness: at, freeAt: NaN });

  it("this core: the delta with the first interval goes beside a near miss's delta still unacknowledged — once (C2, Codex R167)", async () => {
    vi.doMock("./sweepPump", () => ({ runSweepSlice: (it: Iterator<number | undefined, CollisionResult>) => {
      const r = it.next();
      return r.done ? { done: true, cancelled: false, result: r.value, progress: 1, checkpoints: 1 }
                    : { done: false, cancelled: false, result: null, progress: r.value ?? 0, checkpoints: 1 };
    } }));
    const { sent, send } = await setup(3);   // one core for sweeps: no pool
    // 1 mm short of the fixed box and back (a near miss), then through it
    const xs: number[] = [];
    for (let x = -40; x <= -11; x += 0.5) xs.push(x);
    for (let x = -11.5; x >= -40; x -= 0.5) xs.push(x);
    for (let x = -39.5; x <= 40; x += 0.5) xs.push(x);
    const n = xs.length, pos = new Float32Array(n * 3), cum = new Float32Array(n), lines = new Uint32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = xs[i]!; cum[i] = i * 0.5; lines[i] = i + 1; }
    send({ ...boxReq(11), track: { pos, abc: new Float32Array(n * 3), cum, rapid: new Uint8Array(n).fill(1), lines, count: n } });
    for (let i = 0; i < 2000 && ivOut(sent, 11).length < 2; i++) await vi.advanceTimersToNextTimerAsync();
    for (let i = 0; i < 200; i++) await vi.advanceTimersToNextTimerAsync();
    expect(ivOut(sent, 11), "the near miss out, unacknowledged; the touch beside it; then nothing").toEqual([0, 1]);
    expect(sent.some(m => m.result), "no result before the acknowledgements").toBe(false);
    send({ contactsAck: 11, generation: 0 });
    for (let i = 0; i < 200; i++) await vi.advanceTimersToNextTimerAsync();
    expect(sent.some(m => m.result), "one still out").toBe(false);
    send({ contactsAck: 11, generation: 0 });
    for (let i = 0; i < 50 && !sent.some(m => m.result); i++) await vi.advanceTimersToNextTimerAsync();
    expect(sent.some(m => m.result)).toBe(true);
    const r = new ContactStore(11, 0);
    for (const m of sent.filter(x => x.contacts)) for (const d of m.contacts as StoreDelta[]) expect(r.apply(d)).toBe(true);
    expect([r.episodes.rows, r.intervals.rows], "the near miss's stay, the touch's stay and interval").toEqual([2, 1]);
  });

  it("the pool: the request's first interval goes to the owner beside a message still unacknowledged — once (C2, Codex R167)", async () => {
    const { sent, workers, send } = await setup();
    send({ ...req(5), contacts: { generation: 0 } });
    const s0 = new ContactStore(5, 0), s1 = new ContactStore(5, 0);
    addEp(s0, 1);   // a near miss
    workers[0]!.emit({ id: 5, progress: 0.1, contacts: [s0.takeDelta()!] }); s0.ack();
    expect(ivOut(sent, 5), "the near miss out, not acknowledged").toEqual([0]);
    addEp(s1, 2); addIv(s1, 0, 2);
    workers[1]!.emit({ id: 5, progress: 0.2, contacts: [s1.takeDelta()!] }); s1.ack();
    expect(ivOut(sent, 5), "the first interval at once, beside it").toEqual([0, 1]);
    addEp(s0, 3); addIv(s0, 1, 3);
    workers[0]!.emit({ id: 5, progress: 0.3, contacts: [s0.takeDelta()!] }); s0.ack();
    expect(ivOut(sent, 5), "two out: the next waits").toEqual([0, 1]);
    send({ contactsAck: 5, generation: 0 });
    expect(ivOut(sent, 5), "one still out").toEqual([0, 1]);
    send({ contactsAck: 5, generation: 0 });
    expect(ivOut(sent, 5), "then the next").toEqual([0, 1, 1]);
    send({ contactsAck: 5, generation: 0 }); send({ contactsAck: 5, generation: 0 });   // its own and a late one
    addEp(s1, 4); workers[1]!.emit({ id: 5, progress: 0.4, contacts: [s1.takeDelta()!] }); s1.ack();
    addEp(s1, 5); workers[1]!.emit({ id: 5, progress: 0.5, contacts: [s1.takeDelta()!] }); s1.ack();
    expect(ivOut(sent, 5).length, "one out, never below none").toBe(4);
  });

  it("the pool's result waits for the owner's acknowledgement and carries every shard's last delta", async () => {
    const { sent, workers, send } = await setup();
    send({ ...req(3), contacts: { generation: 0 } });
    const s0 = new ContactStore(3, 0), s1 = new ContactStore(3, 0);
    s0.episodes.append({ pair: 1, ordinal: 0, onset: 1, end: NaN, closeAt: 1, closeDist: 1, firstIv: NONE });
    workers[0]!.emit({ id: 3, progress: 0.5, contacts: [s0.takeDelta()!] }); s0.ack();
    s0.episodes.set(0, "end", 2);
    workers[0]!.emit({ id: 3, result: result(), contacts: [s0.takeDelta(true)!] });
    s1.episodes.append({ pair: 2, ordinal: 0, onset: 3, end: 4, closeAt: 3, closeDist: 1, firstIv: NONE });
    workers[1]!.emit({ id: 3, result: result(), contacts: [s1.takeDelta(true)!] });
    expect(sent.some(m => m.result), "held: the owner has not acknowledged").toBe(false);
    send({ contactsAck: 3, generation: 0 });
    const fin = sent.find(m => m.result)!;
    expect((fin.contacts as StoreDelta[]).map(d => [d.episodes.count, d.episodes.updates.length])).toEqual([[0, 1], [1, 0]]);
  });

  it("a fall back to this core is the request's next generation", async () => {
    const { sent, workers, send } = await setup();
    send({ ...boxReq(4, 2), contacts: { generation: 0 } });
    workers[0]!.emit({ id: 4, progress: 0.25 });
    workers[1]!.emit({ id: 4, progress: 0.5 });
    workers[1]!.fail();
    drain();
    // first: how far each shard of generation 0 swept (Codex R150 VP150-02), before any word of generation 1
    const cov = sent.findIndex(x => x.heldCoverage);
    expect(sent[cov]!.heldCoverage).toEqual({ generation: 0, covered: [0.25, 0.5] });
    expect(sent.findIndex(x => x.contacts && (x.contacts as StoreDelta[])[0]!.generation === 1), "after it").toBeGreaterThan(cov);
    const m = sent.find(x => x.contacts)!;
    expect((m.contacts as StoreDelta[])[0]!.generation, "generation 1 on this core").toBe(1);
    expect(new ContactStore(4, 0).apply((m.contacts as StoreDelta[])[0]!), "the old generation's table refuses it").toBe(false);
  });

  // Codex R144 VP-I98/I99/I100: the reviewer's probes on the coordinator, made tests.
  const addEp = (st: ContactStore, pair: number) => st.episodes.append({ pair, ordinal: 0, onset: pair, end: NaN, closeAt: pair, closeDist: 1, firstIv: NONE });
  const deltas = (sent: Record<string, any>[], id: number) => sent.filter(m => m.id === id && m.contacts).flatMap(m => m.contacts as StoreDelta[]);
  const rowsOf = (ds: StoreDelta[], g: number) => ds.filter(d => d.generation === g).reduce((n, d) => n + d.episodes.count, 0);

  it("a pool failure still delivers, in its generation, what the coordinator took over and had not forwarded (VP-I98)", async () => {
    const { sent, workers, send } = await setup();
    send({ ...req(81), contacts: { generation: 0 } });
    const a = new ContactStore(81, 0), b = new ContactStore(81, 0);
    addEp(a, 1); addEp(b, 2);
    workers[0]!.emit({ id: 81, contacts: [a.takeDelta()!] });   // forwarded: the owner has not acknowledged it
    workers[1]!.emit({ id: 81, contacts: [b.takeDelta()!] });   // taken over here, held behind it
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    expect(rowsOf(deltas(sent, 81), 0), "one generation-0 delta out, the other held").toBe(1);
    send({ contactsAck: 81, generation: 1 });   // this core's run's: releases nothing of generation 0
    await vi.runAllTimersAsync();
    expect(rowsOf(deltas(sent, 81), 0), "still held").toBe(1);
    send({ contactsAck: 81, generation: 0 });
    await vi.runAllTimersAsync();
    expect(rowsOf(deltas(sent, 81), 0), "both shards' rows reach the owner").toBe(2);
  });

  it("a pool failure with two messages out (the first interval beside a near miss): the drain says nothing until both are acknowledged (C2)", async () => {
    const { sent, workers, send } = await setup();
    send({ ...req(83), contacts: { generation: 0 } });
    const a = new ContactStore(83, 0), b = new ContactStore(83, 0);
    addEp(a, 1);
    workers[0]!.emit({ id: 83, contacts: [a.takeDelta()!] }); a.ack();   // out
    addEp(b, 2); b.intervals.append({ episode: 0, enter: 2, exit: NaN, next: NONE, witness: 2, freeAt: NaN });
    workers[1]!.emit({ id: 83, contacts: [b.takeDelta()!] }); b.ack();   // the first interval, beside it
    addEp(a, 3);
    workers[0]!.emit({ id: 83, contacts: [a.takeDelta()!] }); a.ack();   // taken over, held
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    const gens = () => deltas(sent, 83).map(d => d.generation);
    expect(rowsOf(deltas(sent, 83), 0), "two out, the third row held").toBe(2);
    send({ contactsAck: 83, generation: 0 });
    await vi.runAllTimersAsync();
    expect(rowsOf(deltas(sent, 83), 0), "one still out: held").toBe(2);
    send({ contactsAck: 83, generation: 0 });
    await vi.runAllTimersAsync();
    expect(rowsOf(deltas(sent, 83), 0), "then delivered").toBe(3);
    expect(gens().includes(1), "generation 1 waits for its acknowledgement").toBe(false);
    send({ contactsAck: 83, generation: 0 });
    await vi.runAllTimersAsync();
    expect(gens().indexOf(1), "generation 1 only after generation 0's last word").toBeGreaterThan(gens().lastIndexOf(0));
  });

  it("the older generation is delivered whole before the newer one says a word on the path, one delta outstanding at a time (Codex R145 VP-I98)", async () => {
    const { sent, workers, send } = await setup();
    send({ ...req(181), contacts: { generation: 0 } });
    const a = new ContactStore(181, 0), b = new ContactStore(181, 0);
    addEp(a, 1); addEp(b, 2);
    workers[0]!.emit({ id: 181, contacts: [a.takeDelta()!] });   // out, not acknowledged
    workers[1]!.emit({ id: 181, contacts: [b.takeDelta()!] });   // taken over, held
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    const gens = () => sent.filter(m => m.id === 181 && m.contacts).map(m => (m.contacts as StoreDelta[])[0]!.generation);
    expect(gens(), "one delta outstanding: this core's run computes, its rows wait").toEqual([0]);
    send({ contactsAck: 181, generation: 0 });
    await vi.runAllTimersAsync();
    expect(gens(), "the held row of generation 0, still alone on the path").toEqual([0, 0]);
    expect(sent.some(m => m.id === 181 && m.result), "no result of generation 1 yet").toBe(false);
    send({ contactsAck: 181, generation: 0 });
    await vi.runAllTimersAsync();
    expect(gens(), "only then generation 1").toEqual([0, 0, 1]);
    expect(rowsOf(deltas(sent, 181), 0), "a receiver dropping an older generation after the switch keeps both rows").toBe(2);
    expect(sent.find(m => m.id === 181 && m.result)?.contacts, "generation 1's result with its last delta").toBeTruthy();
  });

  it("a result computed and held for the acknowledgement survives a worker's failure: delivered once, not run again (VP-I98)", async () => {
    const { sent, workers, send } = await setup();
    send({ ...req(84), contacts: { generation: 0 } });
    const a = new ContactStore(84, 0), b = new ContactStore(84, 0);
    addEp(a, 1);
    workers[0]!.emit({ id: 84, contacts: [a.takeDelta()!] }); a.ack();
    workers[0]!.emit({ id: 84, result: result(), contacts: [a.takeDelta(true)!] });
    workers[1]!.emit({ id: 84, result: result(), contacts: [b.takeDelta(true)!] });
    expect(sent.some(m => m.result), "held for the owner's acknowledgement").toBe(false);
    workers[1]!.fail();
    send({ contactsAck: 84, generation: 0 });
    await vi.runAllTimersAsync();
    const ends = sent.filter(m => m.id === 84 && (m.result || m.error || m.cancelled || m.needBodies));
    expect(ends, JSON.stringify(ends.map(m => Object.keys(m)))).toHaveLength(1);
    expect(ends[0]!.result, "the computed result").toBeTruthy();
    expect(deltas(sent, 84).every(d => d.generation === 0), "nothing run again").toBe(true);
  });

  it("an acknowledgement names its generation: an older one releases nothing of the newer run (VP-I99)", async () => {
    vi.doMock("./sweepPump", () => ({ runSweepSlice: (it: Iterator<number | undefined, CollisionResult>) => {
      const r = it.next();
      return r.done ? { done: true, cancelled: false, result: r.value, progress: 1, checkpoints: 1 }
                    : { done: false, cancelled: false, result: null, progress: r.value ?? 0, checkpoints: 1 };
    } }));
    const { sent, workers, send } = await setup();
    const n = 161, pos = new Float32Array(n * 3), cum = new Float32Array(n), lines = new Uint32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = -40 + i * 0.5; cum[i] = i * 0.5; lines[i] = i + 1; }
    send({ ...boxReq(82, 2), track: { pos, abc: new Float32Array(n * 3), cum, rapid: new Uint8Array(n).fill(1), lines, count: n } });
    const s0 = new ContactStore(82, 0);
    addEp(s0, 1);
    workers[0]!.emit({ id: 82, contacts: [s0.takeDelta()!] });
    workers[1]!.fail();
    // a few slices of the run on this core — mid-sweep, its rows held
    const step = async (k: number) => { for (let i = 0; i < k; i++) await vi.advanceTimersToNextTimerAsync(); };
    await step(6);
    const gen1 = () => sent.filter(m => m.id === 82 && (m.contacts as StoreDelta[] | undefined)?.[0]?.generation === 1).length;
    const done = () => sent.some(m => m.id === 82 && m.result);
    expect(done(), "this core's run is still sweeping").toBe(false);
    expect(gen1(), "generation 1 waits while generation 0's delta is out").toBe(0);
    send({ contactsAck: 82, generation: 1 });   // nothing of generation 1 is out: releases nothing
    expect(gen1(), "still waiting").toBe(0);
    send({ contactsAck: 82, generation: 0 });   // generation 0 delivered: the path is generation 1's
    expect(gen1(), "generation 1's first delta, mid-sweep").toBe(1);
    expect(done(), "not its result").toBe(false);
    send({ contactsAck: 82, generation: 0 });   // late again — only this core's run could take it now
    await vi.runAllTimersAsync();
    expect(gen1(), "the old generation's acknowledgement releases nothing of generation 1").toBe(1);
    expect(done(), "no result before generation 1 is acknowledged").toBe(false);
    for (let k = 0; k < 400 && !done(); k++) {
      send({ contactsAck: 82, generation: 1 });
      await vi.runAllTimersAsync();
    }
    expect(sent.some(m => m.id === 82 && m.result), "its own acknowledgements carry it to its result").toBe(true);
  });

  it("a side run started again after a pool failure is its request's next generation (VP-I99)", async () => {
    const { sent, workers, send } = await setup();
    send(req(83));
    send({ ...req(-83, { side: true }), contacts: { generation: 7 } });
    const old = new ContactStore(-83, 7);
    addEp(old, 1);
    workers[0]!.emit({ id: -83, contacts: [old.takeDelta()!] });
    workers[0]!.emit({ id: -83, progress: 0.4 });
    workers[1]!.fail();
    await vi.runAllTimersAsync();
    expect(deltas(sent, -83).map(d => d.generation)).toEqual([7, 8]);
    // how far shard 0 had swept it, with its generation, before the rerun's word (Codex R150 VP150-02)
    const cov = sent.findIndex(m => m.id === -83 && m.heldCoverage);
    expect(sent[cov]!.heldCoverage).toEqual({ generation: 7, covered: [0.4] });
    expect(sent.findIndex(m => m.id === -83 && m.contacts && (m.contacts as StoreDelta[])[0]!.generation === 8)).toBeGreaterThan(cov);
  });

  it("the pool's result keeps the earliest point a shard's store stopped writing (VP-I100)", async () => {
    const { sent, workers, send } = await setup();
    send({ ...req(85), contacts: { generation: 0 } });
    workers[0]!.emit({ id: 85, result: { ...result([], 0.2), truncated: { covered: 0.2, reason: "budget" }, incompleteFrom: 4 },
                       contacts: [new ContactStore(85, 0).takeDelta(true)!] });
    send({ contactsAck: 85, generation: 0 });
    workers[1]!.emit({ id: 85, result: result(), contacts: [new ContactStore(85, 0).takeDelta(true)!] });
    send({ contactsAck: 85, generation: 0 });
    const fin = sent.find(m => m.id === 85 && m.result)!.result;
    expect([fin.incompleteFrom, fin.truncated]).toEqual([4, { covered: 0.2, reason: "budget" }]);
  });
});

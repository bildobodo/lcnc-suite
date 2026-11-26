// The stock rule on the paths its tables travel (stock-mute plan v2 §4's
// merge conditions, Codex R490): the range sweep against the full one, the
// union of two generations with different shard counts, the entry move joined
// to a program that begins in the stock, and the worker's own run — several
// stock pairs, the same tables as the direct sweep, at most 4 own-hole asks
// between two checkpoints, an abort landing within them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOLE_ASKS_PER_YIELD, buildCollisionModel, sweepCollisions, sweepCollisionsIter, toolCylinderPositions, type CollisionOptions, type HoleWork } from "./collision";
import { ContactStore } from "./contactStore";
import { buildContactView, T_EARLIER, T_NEAR, T_RAPID, targetAt, targetEnd, targetKey, targetKind, targetPos, type ContactView } from "./contactView";
import type { ShownContacts } from "./shownContacts";
import { entryJoins } from "./contactMerge";
import { assignPairs } from "./pairAssign";
import { BLOCK, MACHINE, MARGIN, Prog, WCS, box, digest, findings, modelOf, pathsProgram, start } from "./stockMuteHarness";
import type { CollisionModel } from "./collision";
import type { ScrubTrack } from "../ws/bulkData";

const lineOf = (s: string) => Number(s.split(" L")[1]);
const hw = (): HoleWork => ({ questions: 0, asks: 0, steps: 0, checks: [0, 0, 0, 0], belowFloor: 0, sites: [0, 0, 0, 0], maxBetweenYields: 0 });

describe("the range sweep against the full sweep", { timeout: 120_000 }, () => {
  it("from every clear rapid point: the full sweep's findings after it, nothing before it", () => {
    const p = pathsProgram(), t = p.track(), full = findings(t).list;
    expect(full).toEqual(["near rapid L23", "collision rapid L25", "collision rapid L29"]);
    let starts = 0;
    for (let i = 1; i < t.count - 1; i++) {
      if (!p.pts[i]!.rapid || p.pts[i]!.z < 3) continue;
      starts++;
      // the segment after point i carries line i + 2
      expect(findings(t, { opts: { range: { from: i } } }).list, `from point ${i}`).toEqual(full.filter(s => lineOf(s) >= i + 2));
    }
    expect(starts).toBeGreaterThan(10);
  });
});

describe("two generations with different shard counts (the fallback union)", { timeout: 120_000 }, () => {
  const model = modelOf({ stocks: 4 }), t = pathsProgram().track(), end = t.cum[t.count - 1]!;
  const pairName = (pi: number) => ({ a: model.bodies[model.pairs[pi]![0]]!.id, b: model.bodies[model.pairs[pi]![1]]!.id });
  const shards = (of: number, generation: number) => assignPairs(new Float64Array(model.pairs.length).fill(1), of).map(mask => {
    const st = new ContactStore(1, generation);
    sweepCollisions(model, t, WCS as never, { margin: MARGIN, contacts: { store: st }, pairMask: mask });
    return st;
  });
  // the events with their keys, places, ends and kinds — pairs at one place in key order (the view's
  // order among equal places follows its stores: the shards')
  const list = (v: ContactView) => Array.from({ length: v.n }, (_, i) => [targetKey(v, i), targetPos(v, i), targetEnd(v, i), targetKind(v, i) & ~T_EARLIER] as const)
    .sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));

  it.each([[1, 3], [2, 4], [3, 2]] as const)("%i shards, then %i: an identical rerun and an empty one list the earlier events, keys kept", (a, b) => {
    const old = shards(a, 0), cur = shards(b, 1), at = (x: number) => x;
    const plain = buildContactView({ sources: [{ stores: old, at, ownCoverage: end }], coverage: end, pairName } as never);
    const same = buildContactView({ sources: [{ stores: cur, held: old, heldCoverage: old.map(() => end), at, ownCoverage: end }], coverage: end, pairName } as never);
    const empty = buildContactView({ sources: [{ stores: [new ContactStore(1, 1)], held: old, heldCoverage: old.map(() => end), at, ownCoverage: 0 }],
                                     coverage: end, pairName } as never);
    // four stock pairs, each: the near miss and the two findings
    expect(plain.n).toBe(12);
    expect(list(same)).toEqual(list(plain));
    expect(list(empty)).toEqual(list(plain));
  });
});

describe("the entry move joined to a program that begins in the stock", { timeout: 120_000 }, () => {
  // the entry: the machine's rapid from above into the stock, to the program's first point
  const entryTrack = (): ScrubTrack => new Prog().g0({ x: 50, y: 30, z: 15 }).g0({ z: -5 }).track();
  const sweep = (t: ScrubTrack) => { const st = new ContactStore(1, 0); sweepCollisions(modelOf(), t, WCS as never, { margin: MARGIN, contacts: { store: st } }); return st; };

  it("a first rapid: the entry's contact and the program's first one are ONE (joined); a first feed machines — the entry's contact alone", () => {
    const entry = sweep(entryTrack());
    expect(findings(entryTrack()).list, "the entry is a rapid into the stock").toEqual(["collision rapid L2"]);
    // the program from the first point: a rapid first (a finding), a feed first (machining)
    const rapidFirst = new Prog().g0({ x: 50, y: 30, z: -5 }).g0({ z: 15 }).track();
    const feedFirst = new Prog().g0({ x: 50, y: 30, z: -5 }).g1({ x: 60 }).g0({ z: 15 }).track();
    expect([findings(rapidFirst).list, findings(feedFirst).list]).toEqual([["collision rapid L2"], []]);
    expect([...entryJoins(entry, sweep(rapidFirst)).entries()]).toEqual([[0, 0]]);
    const fed = sweep(feedFirst);
    expect([fed.episodes.rows, entryJoins(entry, fed).size]).toEqual([0, 0]);
  });
});

describe("the worker's own run (collisionWorker.ts, one core)", { timeout: 120_000 }, () => {
  type Msg = Record<string, any>;
  async function setup() {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const sent: Msg[] = [];
    const scope = { onmessage: null as ((e: { data: Msg }) => void) | null, postMessage: (m: Msg) => sent.push(m),
      navigator: { hardwareConcurrency: 2 }, location: { href: "https://test.invalid/collisionWorker.js" } };
    vi.stubGlobal("self", scope);
    vi.stubGlobal("Worker", class { constructor() { throw new Error("no pool on one core"); } });
    await import("./collisionWorker");
    return { sent, send: (data: Msg) => scope.onmessage!({ data }) };
  }
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("./sweepPump"); });
  /** The worker's pump replaced by one checkpoint per slice, measuring from
   *  OUTSIDE the sweep the own-hole asks each resume made (the largest one). */
  const probe = { w: null as HoleWork | null, max: 0, slices: 0 };
  const onePerSlice = () => vi.doMock("./sweepPump", () => ({ runSweepSlice: (it: Iterator<number | undefined, unknown>, _ms: number, cancelled: () => boolean) => {
    probe.slices++;
    const cancel = cancelled(), before = probe.w?.asks ?? 0;
    const r = it.next(cancel);
    probe.max = Math.max(probe.max, (probe.w?.asks ?? 0) - before);
    if (cancel) { for (let g = 0; g < 4 && !it.next(true).done; g++); return { done: true, cancelled: true, result: null, progress: 0, checkpoints: 1 }; }
    return r.done ? { done: true, cancelled: false, result: r.value, progress: 1, checkpoints: 1 }
                  : { done: false, cancelled: false, result: null, progress: r.value ?? 0, checkpoints: 1 };
  } }));
  const request = (id: number, stocks: number, track: ScrubTrack, options: Partial<CollisionOptions>) => ({
    id, side: false, modelKey: `stock×${stocks}`, machine: MACHINE, tool: { diam: 6, len: 60 }, track, wcs: WCS, maxShards: 1,
    bodies: Array.from({ length: stocks }, (_, k) => ({ id: k ? `stock${k}` : "stock", group: "table", positions: box(...BLOCK), stock: true })),
    options: { margin: MARGIN, ...options }, contacts: { generation: 1 } });
  async function drain(sent: Msg[], send: (d: Msg) => void, id: number) {
    for (let i = 0; i < 100000 && !sent.some(m => m.id === id && (m.result || m.error || m.cancelled)); i++) {
      await vi.advanceTimersToNextTimerAsync();
      if (sent.some(m => m.contacts)) send({ contactsAck: id, generation: 1 });
    }
    expect(sent.find(m => m.error)?.error).toBeUndefined();
  }

  it.each([4, 16])("%i stock pairs through the worker's own run: the tables the direct sweep writes, at most 4 asks between two checkpoints", async pairs => {
    onePerSlice();
    const { sent, send } = await setup();
    const t = pathsProgram().track(), w = hw();
    Object.assign(probe, { w, max: 0, slices: 0 });
    send(request(40, pairs, t, { yieldMs: 1e9, holeWork: w }));
    await drain(sent, send, 40);
    expect(sent.some(m => m.result)).toBe(true);
    const got = new ContactStore(40, 1);
    for (const m of sent) for (const d of m.contacts ?? []) expect(got.apply(d)).toBe(true);
    const direct = new ContactStore(40, 1), model: CollisionModel = modelOf({ stocks: pairs });
    sweepCollisions(model, t, WCS as never, { margin: MARGIN, contacts: { store: direct } });
    expect(digest(got)).toBe(digest(direct));
    expect(w.asks).toBeGreaterThan(4);
    expect(probe.max, "asks of one resume, measured outside").toBeGreaterThan(0);
    expect(probe.max, "asks of one resume, measured outside").toBeLessThanOrEqual(HOLE_ASKS_PER_YIELD);
    expect(w.maxBetweenYields).toBeLessThanOrEqual(HOLE_ASKS_PER_YIELD);
  });

  it("an abort sent after the first ask lands within 4 asks — 16 stock pairs, one checkpoint per slice", async () => {
    onePerSlice();
    const { sent, send } = await setup();
    // the own hole asked many times late in the program: a G83 after 1100 feeds
    const p = start().g0({ z: 30 });
    for (let i = 0; i < 1100; i++) p.g1({ z: 30 + (i % 2) });
    const w = hw();
    Object.assign(probe, { w, max: 0, slices: 0 });
    send(request(41, 16, p.g0({ z: 3 }).g1({ z: -3 }).g0({ z: 3 }).g0({ z: -2.5 }).g1({ z: -6 }).g0({ z: 15 }).track(), { yieldMs: 1e9, holeWork: w }));
    let at = -1;
    for (let i = 0; i < 100000 && !sent.some(m => m.id === 41 && (m.result || m.cancelled)); i++) {
      if (at < 0 && w.asks > 0) { at = w.asks; send({ cancel: 41 }); }
      await vi.advanceTimersToNextTimerAsync();
      if (sent.some(m => m.contacts)) send({ contactsAck: 41, generation: 1 });
    }
    expect(sent.some(m => m.id === 41 && m.cancelled), "cancelled").toBe(true);
    expect(sent.some(m => m.id === 41 && m.result), "never finished").toBe(false);
    // the cancel went out before the first resume after the first ask: what
    // was asked in all is what that one resume asked
    expect(at).toBeGreaterThan(0);
    expect(w.asks, "asks in all").toBeLessThanOrEqual(HOLE_ASKS_PER_YIELD);
  });
});

describe("the pool, its fallback generation and the publication (Codex R497 MT-I53 B)", { timeout: 120_000 }, () => {
  // The coordinator (collisionWorker.ts) pools two shards; each shard is a
  // real sweep of its pairs, stepped by the test as a sub-worker would (its
  // words, its deltas with its first pairs, its result) — a sub-worker IS
  // this module in shard mode, its own run is the one-core test above. The
  // owner is the real ContactPublisher building the real shown view
  // (buildShownSteps). Shard 1 fails while the pool runs: the coordinator
  // hands the pool's coverage and its last word over in generation 0 and runs
  // the request again here as generation 1, on one core.
  type Msg = Record<string, any>;
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  class Shard {
    onmessage: ((e: { data: Msg }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    bodies: Msg[] | null = null;
    run: { id: number; model: CollisionModel; store: ContactStore; it: Generator<number, unknown, boolean | undefined>; pairsSent: boolean;
           progress: number; done: boolean; cancelled: boolean } | null = null;
    constructor(all: Shard[]) { all.push(this); }
    postMessage(m: Msg) {
      if (m.track) {
        if (m.bodies) this.bodies = m.bodies;
        const model = buildCollisionModel(m.machine, [...this.bodies!, { id: "tool", group: m.machine.toolGroup,
          positions: toolCylinderPositions(m.tool.diam / m.machine.unitScale, m.tool.len / m.machine.unitScale), tool: true }] as never);
        const store = new ContactStore(m.id, m.contacts.generation);
        this.run = { id: m.id, model, store, pairsSent: false, progress: 0, done: false, cancelled: false,
                     it: sweepCollisionsIter(model, m.track, m.wcs, { ...m.options, yieldMs: 0, clock: () => 0, contacts: { store } }) as never };
      } else if ("cancel" in m && this.run && !this.run.done) { this.run.cancelled = true; this.emit({ id: m.cancel, cancelled: true }); }
    }
    terminate() { this.run = null; }
    emit(d: Msg) { this.onmessage?.({ data: structuredClone(d) }); }
    /** `n` checkpoints of its sweep, then its word as a shard says it. */
    step(n: number) {
      const r = this.run;
      if (!r || r.done || r.cancelled) return;
      let result: unknown = null;
      for (let i = 0; i < n; i++) { const x = r.it.next(); if (x.done) { result = x.value; break; } r.progress = x.value; }
      const delta = r.store.takeDelta(!!result);
      const pairs = r.pairsSent ? null : r.model.pairs.map(([a, b]) => [r.model.bodies[a]!.id, r.model.bodies[b]!.id]);
      if (delta) { r.store.ack(); r.pairsSent = true; this.emit({ id: r.id, contacts: [delta], ...(pairs ? { contactPairs: pairs } : {}), ...(result ? { result } : {}) }); }
      else if (result) this.emit({ id: r.id, result });
      if (!result) this.emit({ id: r.id, progress: r.progress });
      if (result) r.done = true;
    }
    fail() { this.onerror?.({ message: "a failing shard (test)", preventDefault: () => {} }); }
  }

  async function scenario() {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const shards: Shard[] = [], sent: Msg[] = [];
    const scope = { onmessage: null as ((e: { data: Msg }) => void) | null, postMessage: (m: Msg) => { sent.push(m); owner(m); },
      navigator: { hardwareConcurrency: 4 }, location: { href: "https://test.invalid/collisionWorker.js" } };
    vi.stubGlobal("self", scope);
    vi.stubGlobal("Worker", class extends Shard { constructor() { super(shards); } });
    await import("./collisionWorker");
    const { ContactPublisher } = await import("./contactPublisher");
    const { buildShownSteps } = await import("./shownContacts");
    const { trackLineAt } = await import("./contactView");
    const t = pathsProgram().track(), end = t.cum[t.count - 1]!, id = 60, lineAt = trackLineAt(t);
    // the owner's state: how far the check swept, its result
    let covered = 0, result: Msg | null = null;
    const queue: Array<() => void> = [];
    let shown: ShownContacts | null = null;
    const p = new ContactPublisher<ScrubTrack, ShownContacts, number>({
      tracks: () => [t],
      specOf: () => ({ key: `${covered}`, ids: [id], spec: { base: { id, map: null, coverage: covered * end, ownEnd: end }, side: null, axisEnd: end } }),
      *build(_t, spec, tables, held) { return yield* buildShownSteps(tables, spec as never, held, lineAt, 100, end); },
      effect: m => {
        if (m.result) { result = m.result as Msg; covered = (m.result as Msg).truncated ? (m.result as Msg).truncated.covered : 1; }
        else if (typeof m.progress === "number") covered = m.progress as number;
      },
      stage: () => covered,
      publish: () => { shown = p.viewOf(t); },
      retire: () => {}, viewBytes: () => 0,
      ack: a => scope.onmessage!({ data: a }),
      owners: () => new Set([id]),
      schedule: f => queue.push(f), sliceMs: 0, now: () => 0,
    });
    function owner(m: Msg) { if (m.id === id) { p.receive(m as never); p.kick(true); } }
    const settle = () => { for (let k = 0; k < 200_000 && queue.length; k++) queue.shift()!(); };
    const events = () => {
      const v = (shown as ShownContacts | null)?.view;
      return v ? Array.from({ length: v.n }, (_, i) => ({ key: targetKey(v, i), line: (targetAt(v, i, lineAt) as unknown as { line: number }).line,
                                                           kind: targetKind(v, i) })) : [];
    };
    // generation 0 over two shards: four stock pairs, two each
    scope.onmessage!({ data: { id, side: false, modelKey: "paths×4", machine: MACHINE, tool: { diam: 6, len: 60 }, track: t, wcs: WCS, maxShards: 2,
      bodies: Array.from({ length: 4 }, (_, k) => ({ id: k ? `stock${k}` : "stock", group: "table", positions: box(...BLOCK), stock: true })),
      options: { margin: MARGIN }, contacts: { generation: 0 } } });
    expect(shards.length).toBe(2);
    // both shards sweep until the pool has published a finding, then on, both still running
    for (let k = 0; k < 400 && !events().some(e => e.kind & T_RAPID && !(e.kind & T_NEAR)); k++) { for (const s of shards) s.step(8); settle(); }
    for (const s of shards) s.step(8);
    settle();
    const before = events();
    expect(shards.every(s => s.run && !s.run.done), "the pool still running").toBe(true);
    // shard 1 fails: generation 0's coverage and last word, then generation 1 here
    shards[1]!.fail();
    settle();
    for (let k = 0; k < 20_000 && !result; k++) { await vi.advanceTimersToNextTimerAsync(); settle(); }
    settle();
    return { before, after: events(), result: result as unknown as Msg | null, sent, t, p, id };
  }

  it("the earlier keys stay, the rest is found, the hole stays silent, the check is complete", async () => {
    const { before, after, result, sent, t, p, id } = await scenario();
    expect(sent.some(m => m.heldCoverage?.generation === 0), "generation 0's coverage handed over").toBe(true);
    expect(result, "the rerun's result").not.toBeNull();
    expect(result?.truncated ?? null, "swept whole").toBeNull();
    expect(p.tablesOf(id)?.held?.generation, "generation 0 held beside generation 1").toBe(0);
    // what the pool had published stays, under its keys
    expect(before.length).toBeGreaterThan(0);
    for (const e of before) expect(after.map(x => x.key), `kept: ${e.key}`).toContain(e.key);
    // complete: the published events are the single sweep's findings
    const single = findings(t, { stocks: 4 }).list.slice().sort();
    const shownList = after.map(e => `${e.kind & T_NEAR ? "near" : "collision"} ${e.kind & T_RAPID ? "rapid" : "feed"} L${e.line}`).sort();
    expect(shownList).toEqual(single);
    expect(after.length).toBeGreaterThan(before.length);
    // the G83 (lines 3 … 19) silent
    expect(after.filter(e => e.line >= 3 && e.line <= 19)).toEqual([]);
  });
});

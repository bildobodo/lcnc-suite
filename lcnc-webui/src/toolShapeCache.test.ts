// The drawings of library shapes, bounded and owned (P6-c plan v8 §1.6, Codex
// R477 MT477-04, R480, R482 MT482-01). A hand-driven scheduler: what finishes
// when is the test's.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { drawingBytes, LATHE_VERTICES_MAX, withHeldMeter } from "./toolDrawing";
import { buildToolGeometries, toolDrawing, type ToolMeta } from "./toolGeometry";
import { formMeta, formSteps, type FormRecord } from "./toolForm";
import { buffersOf, ENTRIES_MAX, IDLE_BYTES_MAX, shapeSteps, ToolShapeCache, type ShapeHandle, type ShapeKey, type ShapeSource } from "./toolShapeCache";
import { runToEnd, type StepRun, type Steps } from "./viewer/steps";

class Jobs {
  jobs: Array<{ job: Steps<void>; done: () => void; cancelled: boolean; ended: boolean }> = [];
  run = (job: Steps<void>, done: () => void): StepRun<void> => {
    const j = { job, done, cancelled: false, ended: false };
    this.jobs.push(j);
    return { promise: new Promise(() => {}), cancel() { j.cancelled = true; job.return(); }, get running() { return !j.ended && !j.cancelled; } };
  };
  get live() { return this.jobs.filter(j => !j.cancelled && !j.ended); }
  step(n = 1): void { for (let i = 0; i < n; i++) { const j = this.live[0]; if (!j) return; if (j.job.next().done) { j.ended = true; j.done(); } } }
  all(): void { while (this.live.length) this.step(); }
  /** Runs the live job's generator to its end WITHOUT the runner's cancel: a
   *  result that lands late. */
  late(i: number): void { runToEnd(this.jobs[i]!.job); }
}
const form = (row: any): FormRecord => runToEnd(formSteps(row, row, 1, 1e9));
const key = (T: number, over: Partial<ShapeKey> = {}): ShapeKey => ({ path: "/t", instance: "1", units: 1, rev: "r", T, D: 6, len: 80, ...over });
const ENDMILL = form({ type: "endmill", flute_length: 20, shaft_diameter: 8, oal: 60 });
const src = (f: FormRecord = ENDMILL, D = 6): ShapeSource => ({ form: f, diam: D, len: 80, units: 1 });
/** A profile of `n` points at 48 columns. */
const profile = (n: number, r = 3) => form({ native_profile: Array.from({ length: n }, (_, i) => [r, i]) });
const world = () => { const jobs = new Jobs(), traces: any[] = []; return { jobs, traces, cache: new ToolShapeCache({ run: jobs.run, trace: (e, f) => traces.push([e, f]) }) }; };
const disposals = (h: ShapeHandle) => { const n = { n: 0 }; for (const g of [h.shape?.cutter, h.shape?.shaft]) g?.addEventListener("dispose", () => { n.n++; }); return n; };

describe("an entry and its owners", () => {
  it("is built once a key, shared, and its geometry is the drawing's own", () => {
    const { cache, jobs } = world();
    const a = cache.acquire(key(1), src()), b = cache.acquire(key(1), src());
    let told = 0;
    a.onSettled(() => { told++; });
    expect([a.state, a.shape, jobs.jobs.length]).toEqual(["building", null, 1]);
    jobs.all();
    expect([a.state, b.shape === a.shape, told, jobs.jobs.length]).toEqual(["ready", true, 1, 1]);
    b.onSettled(() => { told++; });
    expect(told).toBe(2);
    const want = buildToolGeometries(6, 80, formMeta(ENDMILL.scalars, ENDMILL) as ToolMeta);
    expect(Array.from(a.shape!.cutter!.getAttribute("position").array)).toEqual(Array.from(want.cutter!.getAttribute("position").array));
    expect([a.shape!.cutter!.userData._shared, a.shape!.shaft!.getAttribute("uv")]).toEqual([true, undefined]);
  });
  it("another diameter, length, library, table, instance or unit is another drawing", () => {
    const { cache, jobs } = world();
    const ks = [key(1), key(1, { D: 7 }), key(1, { len: 81 }), key(1, { rev: "s" }), key(1, { path: "/u" }), key(1, { instance: "2" }), key(1, { units: 2 })];
    ks.forEach(k => cache.acquire(k, src()));
    jobs.all();
    expect([cache.size, jobs.jobs.length]).toEqual([7, 7]);
  });
  it("is never evicted while owned; released it is the first to go, disposed once", () => {
    const { cache, jobs } = world();
    const held = cache.acquire(key(0), src()), first = cache.acquire(key(1), src());
    jobs.all();
    const n = disposals(first), m = disposals(held);
    first.release();
    first.release();                                              // a second release is none
    for (let i = 2; i <= ENTRIES_MAX; i++) cache.acquire(key(i), src()).release();
    jobs.all();
    expect([cache.size, n.n, first.shape, m.n, held.shape !== null]).toEqual([ENTRIES_MAX, 2, null, 0, true]);
  });
  it("one job at a time, the one just asked for before the warm ones", () => {
    const { cache, jobs, traces } = world();
    cache.warm(key(1), src());
    cache.warm(key(2), src());
    cache.warm(key(3), src());
    cache.acquire(key(9), src());
    cache.acquire(key(3), src());                                 // already waiting: now first
    expect(jobs.live.length).toBe(1);
    jobs.all();
    expect(traces.filter(([e]) => e === "viewer.shape_build").map(([, f]) => f.tool)).toEqual([1, 3, 9, 2]);
  });
});

describe("the 33rd", () => {
  it("is a private entry: it COMPLETES, is disposed at its release, and evicts no owner", () => {
    const { cache, jobs, traces } = world();
    const all = Array.from({ length: ENTRIES_MAX }, (_, i) => cache.acquire(key(i), src()));
    const extra = cache.acquire(key(99), src());
    expect(traces.filter(([e]) => e === "viewer.shape_cache_full").length).toBe(1);
    jobs.all();
    expect([cache.size, extra.state, all.every(h => h.state === "ready" && h.shape)]).toEqual([ENTRIES_MAX, "ready", true]);
    const n = disposals(extra);
    extra.release();
    expect([n.n, extra.shape]).toEqual([2, null]);
  });
  it("released before it is done: its late result is published nowhere", () => {
    const { cache, jobs } = world();
    const all = Array.from({ length: ENTRIES_MAX }, (_, i) => cache.acquire(key(i), src()));
    jobs.all();
    const extra = cache.acquire(key(99), src());
    let told = 0;
    extra.onSettled(() => { told++; });
    jobs.step();
    extra.release();
    expect(jobs.jobs[ENTRIES_MAX]!.cancelled).toBe(true);
    expect([extra.state, extra.shape, told, all.length]).toEqual(["building", null, 0, ENTRIES_MAX]);
  });
});

describe("a late result", () => {
  // the runner's cancel takes effect at a yield; a result that lands all the
  // same must find its entry dead
  const lateWorld = () => {
    const jobs: Steps<void>[] = [], cache = new ToolShapeCache({ run: job => { jobs.push(job); return { promise: new Promise(() => {}), cancel() {}, running: true }; } });
    return { jobs, cache };
  };
  for (const [name, end] of [
    ["of an ended scene", (c: ToolShapeCache) => c.endScene()],
    ["of another binding", (c: ToolShapeCache) => c.retain(() => false)],
  ] as const) it(`${name} is not published`, () => {
    const { jobs, cache } = lateWorld();
    const h = cache.acquire(key(1), src());
    let told = 0;
    h.onSettled(() => { told++; });
    jobs[0]!.next();
    end(cache);
    runToEnd(jobs[0]!);
    expect([h.shape, h.state, told, cache.size, cache.bytes]).toEqual([null, "building", 0, 0, 0]);
  });
  it("lands only in its own entry: the same key asked again has its own", () => {
    const { jobs, cache } = lateWorld();
    const a = cache.acquire(key(1), src());
    cache.retain(() => false);
    const b = cache.acquire(key(1), src());
    runToEnd(jobs[0]!);
    expect([a.shape, b.state]).toEqual([null, "building"]);
    runToEnd(jobs[1]!);
    expect([a.shape, b.state]).toEqual([null, "ready"]);
  });
});

describe("another binding, another scene", () => {
  it("what no visible decision names goes at once, a held drawing with its last owner, waiting jobs are dropped", () => {
    const { cache, jobs } = world();
    const held = cache.acquire(key(1), src()), shown = cache.acquire(key(2), src());
    cache.acquire(key(3), src()).release();
    jobs.all();
    cache.warm(key(4), src());
    cache.warm(key(5), src());
    const n = disposals(held);
    cache.retain(k => k.T === 2);
    expect([cache.size, cache.waiting, jobs.live.length, held.shape !== null, n.n]).toEqual([1, 0, 0, true, 0]);
    held.release();
    expect([n.n, held.shape, shown.shape !== null]).toEqual([2, null, true]);
  });
  it("an ended scene ends every entry, owned or private, and its jobs", () => {
    const { cache, jobs } = world();
    const all = Array.from({ length: ENTRIES_MAX + 1 }, (_, i) => cache.acquire(key(i), src()));
    jobs.all();
    const n = all.map(disposals);
    cache.endScene();
    expect([cache.size, cache.bytes, all.every(h => h.shape === null), n.every(x => x.n === 2)]).toEqual([0, 0, true, true]);
    all.forEach(h => h.release());
    expect(n.every(x => x.n === 2)).toBe(true);                   // once
  });
});

// R485-H1: `dispose()` frees the renderer's copy only, and an aborted generator
// is suspended with its arrays in hand. Found by a full collection, with the
// handle, the job and the cache still referenced here.
describe("what an end lets go of", () => {
  // WeakRef through globalThis: the browser tsconfig names ES2020
  type Weak = { deref(): object | undefined };
  const WeakRefOf = (globalThis as unknown as { WeakRef: new (t: object) => Weak }).WeakRef;
  const gc = (globalThis as { gc?: () => void }).gc, tick = () => new Promise(r => setTimeout(r, 0));
  const alive = async (refs: Weak[]) => { await tick(); gc!(); await tick(); gc!(); return refs.filter(r => r.deref()).length; };
  /** The arrays the live job makes in `n` steps, weakly. */
  const made = (jobs: Jobs, n: number): Weak[] => {
    const m = { bytes: 0, peak: 0, arrays: [] as ArrayBufferView[] };
    withHeldMeter(m, () => jobs.step(n));
    return m.arrays.map(a => new WeakRefOf(a));
  };
  it.each([
    ["its last owner released it (a private one)", (c: ToolShapeCache, h: ShapeHandle) => { void c; h.release(); }, true],
    ["the scene ended", (c: ToolShapeCache) => c.endScene(), false],
    ["the binding changed", (c: ToolShapeCache) => c.retain(() => false), false],
  ] as const)("a build in hand when %s: its arrays are collected", async (_n, end, full) => {
    const { cache, jobs } = world();
    const others = full ? Array.from({ length: ENTRIES_MAX }, (_, i) => cache.acquire(key(i), src())) : [];
    jobs.all();
    const h = cache.acquire(key(99), src(profile(2000)));
    const refs = made(jobs, 6);
    expect([gc !== undefined, refs.length > 0, await alive(refs) === refs.length, h.state]).toEqual([true, true, true, "building"]);
    end(cache, h);
    expect(await alive(refs)).toBe(0);
    expect([h.shape, h.state, jobs.jobs.length > 0, others.length]).toEqual([null, "building", true, full ? ENTRIES_MAX : 0]);
  });
  it("a finished drawing that is let go: its arrays go too, with the handle still held", async () => {
    const { cache, jobs } = world();
    const h = cache.acquire(key(1), src(profile(400)));
    const refs = made(jobs, 1e6);
    expect([h.state, await alive(refs) > 0]).toEqual(["ready", true]);
    cache.endScene();
    expect([await alive(refs), h.shape]).toEqual([0, null]);
  });
});

describe("its bytes are the real buffers' (MT482-01)", () => {
  it("counts every attribute and the index, a shared ArrayBuffer once", () => {
    const buf = new ArrayBuffer(72), g = new THREE.BufferGeometry(), h = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf, 0, 9), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(buf, 36, 9), 3));
    h.setAttribute("position", new THREE.BufferAttribute(new Float32Array(buf, 0, 9), 3));
    h.setIndex(new THREE.BufferAttribute(new Uint16Array(6), 1));
    expect([buffersOf([g]), buffersOf([g, h, null])]).toEqual([72, 84]);
  });
  it("what idle entries hold, exactly — and drops by exactly an entry's bytes when it goes", () => {
    const { cache, jobs } = world();
    const a = cache.acquire(key(1), src()), b = cache.acquire(key(2), src(profile(600, 2)));
    jobs.all();
    const bytes = (h: ShapeHandle) => buffersOf([h.shape!.cutter, h.shape!.shaft]);
    const A = bytes(a), BB = bytes(b);
    expect(A).toBe(drawingBytes(toolDrawing(6, 80, formMeta(ENDMILL.scalars, ENDMILL) as ToolMeta)));
    expect([cache.bytes, cache.idleBytes]).toEqual([A + BB, 0]);
    b.release();
    expect(cache.idleBytes).toBe(BB);
    cache.retain(k => k.T === 1);
    expect([cache.bytes, cache.idleBytes]).toEqual([A, 0]);
  });
  it("keeps 64 MB of idle drawings, the least recently used out first; an owned one is never counted out", () => {
    const { cache, jobs } = world();
    const big = profile(2000, 2), one = drawingBytes(toolDrawing(6, 80, formMeta(big.scalars, big) as ToolMeta));
    const fit = Math.floor(IDLE_BYTES_MAX / one);
    const held = cache.acquire(key(0), src(big));
    for (let i = 1; i <= fit + 3; i++) { cache.acquire(key(i), src(big)).release(); jobs.all(); }
    expect(fit).toBeLessThan(ENTRIES_MAX - 4);
    expect([cache.idleBytes <= IDLE_BYTES_MAX, cache.idleBytes, held.shape !== null]).toEqual([true, fit * one, true]);
    cache.warm(key(1), src(big));                                 // the first one went: it is built again
    expect(jobs.live.length).toBe(1);
  });
  it("Codex's 600-point lathe is drawn: 14 747 712 bytes counted, over the old 14.4 MB", () => {
    const { cache, jobs } = world();
    const f = form({ native_profile: Array.from({ length: 600 }, (_, i) => [i === 0 || i === 599 ? 0 : 1000, i]) });
    const h = cache.acquire(key(1), src(f));
    jobs.all();
    expect([h.state, cache.bytes]).toEqual(["ready", 14_747_712]);
  });
});

describe("what is not drawn is named", () => {
  it("a refused form, more points or more vertices than the bounds, a coordinate float32 cannot hold", () => {
    const { cache, jobs } = world();
    const cases: Array<[FormRecord, number, string]> = [
      [form({ native_profile: Array.from({ length: 4096 }, () => [1, 1]) }), 6, "shape too detailed"],
      [form({ type: "threadmill", thread_pitch: 0.01, thread_profile_angle: 60, number_of_teeth: 9000, thread_tip_type: "round", thread_tip_radius: 0.001, flute_length: 90 }), 6, "shape too detailed"],
      [form({ type: "ball", oal: 1e300 }), 6, "shape not usable"],
    ];
    cases.forEach(([f, D, why], i) => {
      const h = cache.acquire(key(i), src(f, D));
      jobs.all();
      expect([h.state, h.why, h.shape]).toEqual(["refused", why, null]);
    });
    expect([cache.bytes, cache.size]).toEqual([0, 3]);
    expect(LATHE_VERTICES_MAX).toBe(400_000);
  });
  it("the points are asked before the profile is built: a shape both too detailed and not usable is too detailed", () => {
    const teeth = { type: "threadmill", thread_pitch: 0.01, thread_profile_angle: 60, number_of_teeth: 9000, thread_tip_type: "round", thread_tip_radius: 0.001, flute_length: 90 };
    expect(runToEnd(shapeSteps(src(form({ ...teeth, oal: 1e300 }))))).toEqual({ why: "shape too detailed" });
    expect(runToEnd(shapeSteps(src(form({ ...teeth, number_of_teeth: 3, oal: 1e300 }))))).toEqual({ why: "shape not usable" });
  });
});

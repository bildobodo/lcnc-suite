// Bounded steps (plan 3.6): the sort in steps against the engine's stable sort,
// the work between two yields counted (never timed), and the runner's slices.
import { describe, expect, it } from "vitest";
import { STARVED_MS, STEP_OPS, copySteps, macrotaskSchedule, runSteps, runToEnd, sortSteps, type Steps } from "./steps";
import { vi } from "vitest";

let seed = 3601;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

/** Runs a job and returns its result and the most comparisons between two yields. */
function counted(n: number, keys: number[], budget: number): { order: number[]; most: number; yields: number } {
  let calls = 0, most = 0, yields = 0;
  const job = sortSteps(n, (x, y) => { calls++; return keys[x]! - keys[y]!; }, budget);
  for (;;) {
    const r = job.next();
    most = Math.max(most, calls);
    calls = 0;
    if (r.done) return { order: Array.from(r.value), most, yields };
    yields++;
  }
}

describe("a sort in bounded steps (plan 3.6)", () => {
  it("is the stable sort: random keys with ties, runs already in order, reversed, all equal", () => {
    let cases = 0, withYields = 0;
    for (let c = 0; c < 400; c++) {
      const n = Math.floor(rnd() * (c % 10 === 0 ? 6000 : 300));
      const shape = c % 5;
      const keys = Array.from({ length: n }, (_, i) =>
        shape === 0 ? Math.floor(rnd() * 20)                       // many ties
        : shape === 1 ? (i % 97) + Math.floor(i / 97) * 1000        // ascending runs of 97
        : shape === 2 ? n - i                                       // reversed
        : shape === 3 ? 7                                           // all equal
        : rnd());
      const want = Array.from({ length: n }, (_, i) => i).sort((x, y) => keys[x]! - keys[y]!);
      const budget = 1 + Math.floor(rnd() * 64);
      const got = counted(n, keys, budget);
      expect(got.order, `case ${c} (shape ${shape}, n ${n})`).toEqual(want);
      expect(got.most, "comparisons between two yields").toBeLessThanOrEqual(budget + 1);
      cases++;
      if (got.yields > 10) withYields++;
    }
    expect([cases, withYields > 150], "most cases yield many times").toEqual([400, true]);
  });

  it("runs already in order cost a pass and the merges, not a full sort", () => {
    // a pair's rows come in order: 64 runs of 1000 ascending keys, interleaved
    const n = 64_000, keys = Array.from({ length: n }, (_, i) => (i % 1000) * 64 + Math.floor(i / 1000));
    let calls = 0;
    const order = runToEnd(sortSteps(n, (x, y) => { calls++; return keys[x]! - keys[y]!; }));
    expect(order.every((v, i) => !i || keys[order[i - 1]!]! <= keys[v]!)).toBe(true);
    // a pass over the runs, then log2(64) = 6 merge levels: about 7·n comparisons, not n·log2(n) ≈ 16·n
    expect(calls).toBeLessThan(8 * n);
  });
});

describe("the runner: slices, a macrotask between them, cancel", () => {
  it("drives a job in slices of about sliceMs and settles with its result", async () => {
    const queue: Array<() => void> = [];
    let clock = 0;
    const seen = { steps: 0 };
    function* timed(): Steps<string> { for (let i = 0; i < 100; i++) { seen.steps++; clock += 1; yield; } return "done"; }
    const run = runSteps(timed(), { sliceMs: 10, schedule: f => queue.push(f), now: () => clock });
    const perSlice: number[] = [];
    while (queue.length) { const before = seen.steps; queue.shift()!(); perSlice.push(seen.steps - before); }
    expect(await run.promise).toBe("done");
    expect(run.running).toBe(false);
    expect(perSlice.slice(0, -1).every(k => k === 10), "ten 1-ms steps a 10-ms slice").toBe(true);
    expect(perSlice.length).toBe(11);
  });

  it("a slice ends when its time is up; the rest waits for the next macrotask", () => {
    const queue: Array<() => void> = [];
    let clock = 0;
    const seen = { steps: 0 };
    function* timed(): Steps<number> { for (let i = 0; i < 50; i++) { seen.steps++; clock += 2; yield; } return 7; }
    runSteps(timed(), { sliceMs: 10, schedule: f => queue.push(f), now: () => clock });
    queue.shift()!();
    expect(seen.steps, "five steps of 2 ms fill a 10 ms slice").toBe(5);
    expect(queue.length, "the next slice is scheduled").toBe(1);
  });

  it("a step can end its slice (endSlice): the next step begins the next macrotask", () => {
    const queue: Array<() => void> = [];
    const seen = { steps: 0 };
    let end = false;
    function* job(): Steps<number> { for (let i = 0; i < 10; i++) { seen.steps++; end = i === 3; yield; } return 1; }
    runSteps(job(), { sliceMs: 1e9, now: () => 0, schedule: f => queue.push(f), endSlice: ms => { const e = end && ms >= 0; end = false; return e; } });
    queue.shift()!();
    expect(seen.steps, "the fourth step ended the slice").toBe(4);
    queue.shift()!();
    expect(seen.steps, "the rest in the next").toBe(10);
  });

  it("cancel ends the job at its next yield; nothing settles", async () => {
    const queue: Array<() => void> = [];
    const seen = { steps: 0 };
    let clock = 0;
    function* timed(): Steps<number> { try { for (let i = 0; i < 50; i++) { seen.steps++; clock += 2; yield; } return 1; } finally { seen.steps += 1000; } }
    const run = runSteps(timed(), { sliceMs: 10, schedule: f => queue.push(f), now: () => clock });
    queue.shift()!();
    run.cancel();
    expect(seen.steps, "its finally ran: the generator was closed").toBeGreaterThan(1000);
    while (queue.length) queue.shift()!();
    expect(run.running).toBe(false);
    let settled = false;
    run.promise.then(() => { settled = true; }, () => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
  });
});

describe("a copy in bounded steps (plan 3.6)", () => {
  it("copies every element, at most STEP_OPS between two yields, the work counted in the caller's count", () => {
    const src = Array.from({ length: 3 * STEP_OPS + 17 }, (_, i) => i * 1.5);
    const c = { n: 100 };
    const job = copySteps(new Float64Array(src.length), src, c);
    let yields = 0, r = job.next();
    while (!r.done) { yields++; r = job.next(); }
    expect(Array.from(r.value)).toEqual(src);
    expect(yields, "one yield per STEP_OPS elements, the count it began with included").toBe(3);
    expect(c.n).toBe((100 + src.length) % STEP_OPS);
  });
});

describe("the macrotask between slices (R163: Chromium held a pass's posted messages back under key input)", () => {
  /** A MessageChannel whose messages arrive only when `deliver` is called, counting the ones out. */
  function heldChannel() {
    const box = { out: 0, most: 0, handler: null as null | (() => void) };
    class Ch {
      port1 = { set onmessage(f: () => void) { box.handler = f; } };
      port2 = { postMessage: () => { box.out++; box.most = Math.max(box.most, box.out); } };
    }
    const deliver = () => { if (box.out > 0) { box.out--; box.handler!(); } };
    return { box, Ch, deliver };
  }
  it("one message out at a time, one slice a message — held-back messages never run slices back to back", () => {
    const g = globalThis as unknown as Record<string, unknown>, saved = g.MessageChannel;
    const { box, Ch, deliver } = heldChannel();
    g.MessageChannel = Ch;
    try {
      const sched = macrotaskSchedule(), ran: number[] = [];
      for (let i = 0; i < 3; i++) sched(() => ran.push(i));
      expect(box.most, "one message out").toBe(1);
      deliver();
      expect(ran, "one slice a message").toEqual([0]);
      deliver(); deliver();
      expect(ran).toEqual([0, 1, 2]);
      expect(box.most).toBe(1);
    } finally { g.MessageChannel = saved; }
  });
  it("a frame takes a slice over once its message has waited STARVED_MS — one frame asked at a time", () => {
    const g = globalThis as unknown as Record<string, unknown>, saved = { mc: g.MessageChannel, raf: g.requestAnimationFrame };
    const { Ch } = heldChannel();
    const frames: Array<() => void> = [];
    let t = 1000;
    const now = vi.spyOn(performance, "now").mockImplementation(() => t);
    g.MessageChannel = Ch;
    g.requestAnimationFrame = (f: () => void) => { frames.push(f); return frames.length; };
    try {
      const sched = macrotaskSchedule(), ran: string[] = [];
      sched(() => ran.push("a"));
      sched(() => ran.push("b"));
      expect(frames.length, "one frame asked").toBe(1);
      t += STARVED_MS - 1;
      frames.shift()!();
      expect(ran, "not starved yet: the message's turn").toEqual([]);
      expect(frames.length, "asked again while a slice waits").toBe(1);
      t += 1;
      frames.shift()!();
      expect(ran, "starved: the frame runs one slice").toEqual(["a"]);
      frames.shift()!();
      expect(ran, "the next has waited as long").toEqual(["a", "b"]);
      expect(frames.length, "nothing waits: no frame asked").toBe(0);
    } finally { g.MessageChannel = saved.mc; g.requestAnimationFrame = saved.raf; now.mockRestore(); }
  });
});

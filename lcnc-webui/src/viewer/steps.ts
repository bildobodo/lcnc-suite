// Work in bounded steps (step 4 package 2, plan 3.6): the contact view's build
// runs on the page's main thread, where a long task also holds the handlers of
// Escape and the E-Stop button. A job is a generator that yields after a
// bounded number of operations; the runner drives it in slices of a few
// milliseconds and lets the page run between them. Pure apart from the
// scheduler it is given.

/** Operations between two yields — a comparison, an element moved, a row read.
 *  About a tenth of a millisecond of work; the runner's slice holds many. */
export const STEP_OPS = 4096;

/** A job: yields between bounded pieces of work, returns its result. */
export type Steps<T> = Generator<void, T, void>;

// ---- what a build allocates (plan 3.6, Codex R158 VP-I118) ----------------------------------------

/** The bytes a running build has allocated so far: every typed array of the
 *  view and every build buffer from the moment it is made — counted where it
 *  is MADE, never read off the result (a buffer dropped before the end is
 *  counted all the same: an upper bound on what the build holds, the toolpath
 *  ledger's rule). Growth counts the new capacity. */
export interface AllocMeter { bytes: number }
let meter: AllocMeter | null = null;
/** Runs `f` with every allocation through the helpers below counted into `m`
 *  — the publisher wraps each step of a build (a step is synchronous: nothing
 *  else allocates in it). */
export function withMeter<R>(m: AllocMeter | null, f: () => R): R {
  const prev = meter;
  meter = m;
  try { return f(); } finally { meter = prev; }
}
/** An array made elsewhere, counted. */
export function metered<A extends ArrayBufferView>(a: A): A {
  if (meter) meter.bytes += a.byteLength;
  return a;
}
export const allocF64 = (n: number): Float64Array => metered(new Float64Array(n));
export const allocU32 = (n: number): Uint32Array => metered(new Uint32Array(n));
export const allocI32 = (n: number): Int32Array => metered(new Int32Array(n));
export const allocU8 = (n: number): Uint8Array => metered(new Uint8Array(n));

type Typed = Float64Array | Uint32Array | Int32Array;
/** Elements of a `Grow` block: one step's operations. */
const GROW_BLOCK = STEP_OPS, GROW_SHIFT = 12;
/** A list of numbers in typed BLOCKS — the build's per-row buffers (a JS
 *  array's backing store is no count; plan 3.6). Its first block grows by
 *  doubling up to GROW_BLOCK elements (a copy of at most that many, counted
 *  into `c`); past it a push starts a new block and never copies (a growing
 *  array's copy of its whole buffer was one step, Codex R159 VP-I115). `done`
 *  makes it one array of its length, a block a counted step. */
export class Grow<A extends Typed> {
  private blocks: A[];
  n = 0;
  private readonly make: (n: number) => A;
  constructor(make: (n: number) => A, cap = 16) { this.make = make; this.blocks = [make(Math.min(Math.max(1, cap), GROW_BLOCK))]; }
  push(x: number, c?: { n: number }): void {
    const k = this.blocks.length - 1, last = this.blocks[k]!, i = this.n - k * GROW_BLOCK;
    if (i < last.length) { last[i] = x; this.n++; return; }
    if (last.length < GROW_BLOCK) {
      // the first block, doubled (k = 0 here): a copy of fewer than GROW_BLOCK elements
      const b = this.make(Math.min(GROW_BLOCK, 2 * last.length));
      b.set(last);
      if (c) c.n += i;
      this.blocks[k] = b;
      b[i] = x;
    } else {
      const b = this.make(GROW_BLOCK);
      this.blocks.push(b);
      b[0] = x;
    }
    this.n++;
  }
  get length(): number { return this.n; }
  /** Element i. */
  at(i: number): number { return this.blocks[i >>> GROW_SHIFT]![i & (GROW_BLOCK - 1)]!; }
  /** The list as one array of its length — a block copied a counted step. */
  *done(c: { n: number }): Steps<A> {
    const out = this.make(this.n);
    for (let b = 0; b * GROW_BLOCK < this.n; b++) {
      const m = Math.min(GROW_BLOCK, this.n - b * GROW_BLOCK), blk = this.blocks[b]!;
      out.set(m === blk.length ? blk : blk.subarray(0, m), b * GROW_BLOCK);
      if ((c.n += m) >= STEP_OPS) { c.n = 0; yield; }
    }
    return out;
  }
}
export const growF64 = (cap?: number) => new Grow<Float64Array>(allocF64, cap);
export const growU32 = (cap?: number) => new Grow<Uint32Array>(allocU32, cap);
export const growI32 = (cap?: number) => new Grow<Int32Array>(allocI32, cap);

/** Runs a job to its end at once (the build without a page: tests, Node). */
export function runToEnd<T>(job: Steps<T>): T {
  for (;;) {
    const r = job.next();
    if (r.done) return r.value;
  }
}

/** A running job. `cancel` ends it at the next yield; its promise then never
 *  settles (whoever cancelled has moved on). */
export interface StepRun<T> { readonly promise: Promise<T>; cancel(): void; readonly running: boolean }

/** A macrotask between slices: the page handles its input and paints in
 *  between (a MessageChannel, not a timer — timers are clamped to 4 ms, and
 *  Chromium holds back a timer task it expects to be long while input is
 *  expected: under continuous key input a pass's slices sat idle for 46 s,
 *  R163). */
export function macrotaskSchedule(): (f: () => void) => void {
  if (typeof MessageChannel === "undefined") return f => { setTimeout(f, 0); };
  const ch = new MessageChannel(), queue: Array<() => void> = [], at: number[] = [];
  const next = () => { at.shift(); queue.shift()?.(); };
  // one message out at a time, one slice a message: held-back messages piled
  // up and then ran a slice each, back to back
  let posted = false;
  const post = () => { if (!posted && queue.length) { posted = true; ch.port2.postMessage(0); } };
  ch.port1.onmessage = () => { posted = false; next(); post(); };
  // A frame takes a slice over once its message has waited STARVED_MS: under
  // continuous key input Chromium held the page's posted messages back behind
  // input and frames — a pass's slices waited up to 20 s each with the main
  // thread idle (R163). Frames still run then; in a hidden tab (no frames) the
  // message does. Only a starved slice: a slice in every frame delayed the
  // pointer up to 123 ms; one frame asked at a time — a request a slice piled
  // up and one frame ran them all (332 ms); one message out at a time, below.
  const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : null;
  let asked = false;
  const ask = () => { if (frame && !asked && queue.length) { asked = true; frame(onFrame); } };
  const onFrame = () => {
    asked = false;
    if (queue.length && performance.now() - at[0]! >= STARVED_MS) next();
    ask();
  };
  return f => { queue.push(f); at.push(performance.now()); post(); ask(); };
}
/** How long a slice's message may wait before a frame runs it. */
export const STARVED_MS = 32;

/** Drives `job` in slices of about `sliceMs`, a macrotask between them. */
export function runSteps<T>(job: Steps<T>, o: { sliceMs?: number; schedule?: (f: () => void) => void; now?: () => number;
                                                /** Asked after each step with the slice's time so far: true ends the slice
                                                 *  there (the next step begins a task of its own). */
                                                endSlice?: (elapsedMs: number) => boolean;
                                                /** Called in the task the job ends in (the promise settles a microtask later). */
                                                onDone?: (value: T) => void; onError?: (e: unknown) => void } = {}): StepRun<T> {
  const sliceMs = o.sliceMs ?? 8, schedule = o.schedule ?? macrotaskSchedule(), now = o.now ?? (() => performance.now());
  let cancelled = false, running = true;
  const promise = new Promise<T>((resolve, reject) => {
    const slice = () => {
      if (cancelled) { running = false; return; }
      const t0 = now();
      try {
        for (;;) {
          const r = job.next();
          if (r.done) { running = false; o.onDone?.(r.value); resolve(r.value); return; }
          if (cancelled) { running = false; return; }
          const dt = now() - t0;
          if (dt >= sliceMs || o.endSlice?.(dt)) break;
        }
      } catch (e) { running = false; o.onError?.(e); reject(e); return; }
      schedule(slice);
    };
    schedule(slice);
  });
  return {
    promise,
    cancel() { cancelled = true; try { job.return(undefined as never); } catch { /* ended */ } },
    get running() { return running && !cancelled; },
  };
}

/** `src` copied into `out` (a typed array of its length), a bounded piece at
 *  a time, the work counted in `c`: a budget's targets copied at once was one
 *  step of ~20 ms in the browser (plan 3.6). */
export function* copySteps<A extends { [i: number]: number; readonly length: number }>(out: A, src: ArrayLike<number>, c: { n: number }): Steps<A> {
  for (let i = 0; i < src.length; i++) {
    out[i] = src[i]!;
    if (++c.n >= STEP_OPS) { c.n = 0; yield; }
  }
  return out;
}

/** The permutation of 0..n−1 that sorts by `cmp`, STABLE (equal elements keep
 *  their order), yielding after about `budget` operations: a natural merge
 *  sort — runs already in order (a sweep writes a pair's rows in order) are
 *  taken as they are, short ones grown by insertion to MIN_RUN, then merged
 *  pairwise. Two u32 arrays of n — the temporary sort buffer plan 3.6 names —
 *  and two of the runs' starts (n / 32 each). */
export function* sortSteps(n: number, cmp: (a: number, b: number) => number, budget = STEP_OPS): Steps<Uint32Array> {
  let a = allocU32(n), ops = 0;
  for (let i = 0; i < n; i++) {
    a[i] = i;
    if (++ops >= budget) { ops = 0; yield; }
  }
  if (n < 2) return a;
  const MIN_RUN = 32;
  // the runs: each ascending (a descending stretch is not reversed — that
  // would break stability for equal neighbours; it becomes short runs) —
  // their starts, then n (one at most per MIN_RUN elements)
  const cap = Math.ceil(n / MIN_RUN) + 2;
  let runs = allocU32(cap), nr = 0, next = allocU32(cap);
  runs[nr++] = 0;
  let s = 0;
  while (s < n) {
    let e = s + 1;
    while (e < n && cmp(a[e - 1]!, a[e]!) <= 0) { e++; if (++ops >= budget) { ops = 0; yield; } }
    if (e - s < MIN_RUN && e < n) {
      // grow it by insertion (stable: an element moves past greater ones only)
      const end = Math.min(n, s + MIN_RUN);
      for (let i = e; i < end; i++) {
        const v = a[i]!;
        let j = i - 1;
        while (j >= s && cmp(a[j]!, v) > 0) { a[j + 1] = a[j]!; j--; if (++ops >= budget) { ops = 0; yield; } }
        a[j + 1] = v;
        if (++ops >= budget) { ops = 0; yield; }
      }
      e = end;
    }
    s = e;
    if (s < n) runs[nr++] = s;
  }
  runs[nr++] = n;
  let b = allocU32(n);
  while (nr > 2) {
    let nn = 0;
    next[nn++] = 0;
    for (let r = 0; r + 1 < nr; r += 2) {
      const lo = runs[r]!, mid = runs[r + 1]!, hi = r + 2 < nr ? runs[r + 2]! : mid;
      let i = lo, j = mid, k = lo;
      // the left one first on a tie: stable
      while (i < mid && j < hi) {
        b[k++] = cmp(a[j]!, a[i]!) < 0 ? a[j++]! : a[i++]!;
        if (++ops >= budget) { ops = 0; yield; }
      }
      while (i < mid) { b[k++] = a[i++]!; if (++ops >= budget) { ops = 0; yield; } }
      while (j < hi) { b[k++] = a[j++]!; if (++ops >= budget) { ops = 0; yield; } }
      next[nn++] = hi;
    }
    if (next[nn - 1] !== n) next[nn++] = n;
    [runs, next] = [next, runs];
    nr = nn;
    [a, b] = [b, a];
  }
  return a;
}

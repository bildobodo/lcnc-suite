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
/** A list of numbers in a typed array that grows by doubling — the build's
 *  per-row buffers (a JS array's backing store is no count; plan 3.6). A
 *  growth's copy is counted into `c` like any other step's work. */
export class Grow<A extends Typed> {
  a: A;
  n = 0;
  private readonly make: (n: number) => A;
  constructor(make: (n: number) => A, cap = 16) { this.make = make; this.a = make(cap); }
  push(x: number, c?: { n: number }): void {
    if (this.n === this.a.length) {
      const b = this.make(2 * this.a.length);
      b.set(this.a);
      if (c) c.n += this.n;
      this.a = b;
    }
    this.a[this.n++] = x;
  }
  get length(): number { return this.n; }
  /** The numbers so far (a view, no copy). */
  view(): A { return this.a.subarray(0, this.n) as A; }
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
 *  between (a MessageChannel, not a timer — timers are clamped to 4 ms). */
function defaultSchedule(): (f: () => void) => void {
  if (typeof MessageChannel === "undefined") return f => { setTimeout(f, 0); };
  const ch = new MessageChannel(), queue: Array<() => void> = [];
  ch.port1.onmessage = () => { queue.shift()?.(); };
  return f => { queue.push(f); ch.port2.postMessage(0); };
}

/** Drives `job` in slices of about `sliceMs`, a macrotask between them. */
export function runSteps<T>(job: Steps<T>, o: { sliceMs?: number; schedule?: (f: () => void) => void; now?: () => number;
                                                /** Called in the task the job ends in (the promise settles a microtask later). */
                                                onDone?: (value: T) => void; onError?: (e: unknown) => void } = {}): StepRun<T> {
  const sliceMs = o.sliceMs ?? 8, schedule = o.schedule ?? defaultSchedule(), now = o.now ?? (() => performance.now());
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
          if (now() - t0 >= sliceMs) break;
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

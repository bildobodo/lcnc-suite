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
 *  pairwise. Two u32 arrays of n — the temporary sort buffer plan 3.6 names. */
export function* sortSteps(n: number, cmp: (a: number, b: number) => number, budget = STEP_OPS): Steps<Uint32Array> {
  let a = new Uint32Array(n), ops = 0;
  for (let i = 0; i < n; i++) {
    a[i] = i;
    if (++ops >= budget) { ops = 0; yield; }
  }
  if (n < 2) return a;
  const MIN_RUN = 32;
  // the runs: each ascending (a descending stretch is not reversed — that
  // would break stability for equal neighbours; it becomes short runs)
  const starts: number[] = [0];
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
    if (s < n) starts.push(s);
  }
  let runs = starts.concat(n);
  let b = new Uint32Array(n);
  while (runs.length > 2) {
    const next: number[] = [0];
    for (let r = 0; r + 1 < runs.length; r += 2) {
      const lo = runs[r]!, mid = runs[r + 1]!, hi = r + 2 < runs.length ? runs[r + 2]! : mid;
      let i = lo, j = mid, k = lo;
      // the left one first on a tie: stable
      while (i < mid && j < hi) {
        b[k++] = cmp(a[j]!, a[i]!) < 0 ? a[j++]! : a[i++]!;
        if (++ops >= budget) { ops = 0; yield; }
      }
      while (i < mid) { b[k++] = a[i++]!; if (++ops >= budget) { ops = 0; yield; } }
      while (j < hi) { b[k++] = a[j++]!; if (++ops >= budget) { ops = 0; yield; } }
      next.push(hi);
    }
    if (next[next.length - 1] !== n) next.push(n);
    runs = next;
    [a, b] = [b, a];
  }
  return a;
}

// Mergeable frame-time histograms for the part-B A/B measurement (Codex R39
// VP39-03: never average percentiles — viewerPerf's 3 s windows report
// quantiles, not samples, and the p95 of two windows is not their mean).
//
// Bins: 1 ms up to FINE_MS, then COARSE_MS up to MAX_MS, then one overflow
// bin. A quantile is the UPPER edge of the bin in which the cumulative count
// first reaches ceil(q · n) — conservative, it never reads a time below the
// sample it stands for. scripts/viewer_ab_report.py is the Python twin; both
// are pinned by scripts/test_fixtures/ab_histogram_cases.json.

export const FINE_MS = 200;
export const COARSE_MS = 10;
export const MAX_MS = 1000;
export const BINS = FINE_MS + (MAX_MS - FINE_MS) / COARSE_MS + 1;   // 281: the last one is the overflow
/** The window the "highest window p95" is taken over (viewerPerf's). */
export const WINDOW_MS = 3000;

/** The bin a sample (ms) falls in. */
export function binOf(ms: number): number {
  if (!(ms > 0)) return 0;
  if (ms < FINE_MS) return Math.floor(ms);
  if (ms < MAX_MS) return FINE_MS + Math.floor((ms - FINE_MS) / COARSE_MS);
  return BINS - 1;
}

/** A bin's upper edge in ms (the overflow bin: Infinity). */
export function binHigh(b: number): number {
  if (b < FINE_MS) return b + 1;
  if (b < BINS - 1) return FINE_MS + (b - FINE_MS + 1) * COARSE_MS;
  return Infinity;
}

/** A bin's lower edge in ms. */
export function binLow(b: number): number {
  if (b < FINE_MS) return b;
  return FINE_MS + (b - FINE_MS) * COARSE_MS;
}

export class Histogram {
  readonly counts = new Uint32Array(BINS);
  n = 0;
  /** The largest sample seen (exact, not binned). */
  max = 0;

  add(ms: number): void {
    this.counts[binOf(ms)]!++;
    this.n++;
    if (ms > this.max) this.max = ms;
  }

  merge(o: Histogram): void {
    for (let b = 0; b < BINS; b++) this.counts[b]! += o.counts[b]!;
    this.n += o.n;
    if (o.max > this.max) this.max = o.max;
  }

  /** The q-quantile (0..1): the upper edge of the bin holding the
   *  ceil(q·n)-th sample; null without samples. */
  quantile(q: number): number | null {
    if (this.n === 0) return null;
    const rank = Math.max(1, Math.ceil(q * this.n));
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      acc += this.counts[b]!;
      if (acc >= rank) return binHigh(b);
    }
    return binHigh(BINS - 1);
  }

  /** Samples at or above `ms` (a bin edge: exact). */
  atLeast(ms: number): number {
    let c = 0;
    for (let b = binOf(ms); b < BINS; b++) if (binLow(b) >= ms) c += this.counts[b]!;
    return c;
  }

  /** Sparse form for the wire: [bin, count, bin, count, …]. */
  sparse(): number[] {
    const out: number[] = [];
    for (let b = 0; b < BINS; b++) if (this.counts[b]) out.push(b, this.counts[b]!);
    return out;
  }

  static fromSparse(pairs: number[], max = 0): Histogram {
    const h = new Histogram();
    for (let i = 0; i + 1 < pairs.length; i += 2) { h.counts[pairs[i]!]! += pairs[i + 1]!; h.n += pairs[i + 1]!; }
    h.max = max;
    return h;
  }
}

/** A phase's samples: the whole phase in one histogram, and the p95 of
 *  every WINDOW_MS window (the highest is reported next to the merged p95). */
export class PhaseHistogram {
  readonly total = new Histogram();
  private win = new Histogram();
  private winStart = -1;
  readonly windowP95s: number[] = [];

  add(ms: number, now: number): void {
    if (this.winStart < 0) this.winStart = now;
    else if (now - this.winStart >= WINDOW_MS) this.closeWindow(now);
    this.total.add(ms);
    this.win.add(ms);
  }

  private closeWindow(now: number): void {
    const p = this.win.quantile(0.95);
    if (p !== null) this.windowP95s.push(p);
    this.win = new Histogram();
    this.winStart = now;
  }

  /** Close the running window (a partial one counts when it has samples). */
  finish(): void {
    const p = this.win.quantile(0.95);
    if (p !== null) this.windowP95s.push(p);
    this.win = new Histogram();
    this.winStart = -1;
  }

  get windowP95Max(): number | null {
    return this.windowP95s.length ? Math.max(...this.windowP95s) : null;
  }
}

/** Split a sparse histogram into parts whose JSON stays under `maxChars`
 *  (the trace bus replaces a line over PIPE_BUF with a truncation marker —
 *  a histogram must never lose bins silently). */
export function splitSparse(pairs: number[], maxChars: number): number[][] {
  const parts: number[][] = [];
  let cur: number[] = [];
  let len = 2;
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    const add = String(pairs[i]).length + String(pairs[i + 1]).length + 2;
    if (cur.length && len + add > maxChars) { parts.push(cur); cur = []; len = 2; }
    cur.push(pairs[i]!, pairs[i + 1]!);
    len += add;
  }
  parts.push(cur);
  return parts;
}

// The page's stalls as the hold guard sees them, per telemetry window
// (`browser.stall`; P3, machine day F18/F20, Codex R425 MT425-04).
//
// A STALL is a gap in the TIMER OBSERVATION longer than HOLD_STALL_MS — the
// quantity and the limit the hold guard decides on (holdGesture.ts: a gap
// between two observations of a held press past 150 ms ends the hold). The
// observations here are viewerPerf's main-thread probe (a timer chain every
// 8 ms, one chain for both: no second timer on a weak panel PC); its gap is
// the time between two firings. A long task is a DIFFERENT quantity (the
// Long Tasks API — absent in Firefox): counted apart (`lt_*`), absent when
// the browser does not report it, never reported as 0. A hold refusal
// carries its OWN gap (holdGesture's `gapMs`) — this histogram is no
// evidence for one hold (another timer, another phase, R426).
//
// Hidden time is no stall: browsers clamp a hidden page's timers to 1 s.
// Hiding stops the counting, showing re-anchors (`anchor_resets`) and the
// hidden time is reported (`hidden_ms`).
//
// Rows: one per window with a stall, else one per STALL_IDLE_WINDOW_MS —
// each row spans [win_start, win_end] on the global clock and carries its
// page sequence number, so a missing row (a page frozen, a batch lost) is a
// GAP between two rows, never read as "no stall".
//
// Pure: the clock is the caller's; viewerPerf.ts feeds and flushes it.

import { HOLD_STALL_MS } from "./holdGesture";

/** The histogram's lower edges, ms: 150–250, 250–500, 500–1000, > 1000. */
export const STALL_BINS = [HOLD_STALL_MS, 250, 500, 1000] as const;
/** A window without a stall is reported at the latest after this long. */
export const STALL_IDLE_WINDOW_MS = 30000;

export function stallBin(gapMs: number): number {
  let bin: number = STALL_BINS[0];
  for (const b of STALL_BINS) if (gapMs >= b) bin = b;
  return bin;
}

export interface StallRow {
  seq: number;
  win_start: number;
  win_end: number;
  win_ms: number;
  limit_ms: number;
  observed: number;           // timer observations counted (visible page)
  n: number;                  // gaps past limit_ms
  max_ms: number;             // the largest gap observed (any, not only stalls)
  h: Record<string, number>;  // the stalls by STALL_BINS lower edge
  hidden_ms: number;
  anchor_resets: number;
  lt_n?: number;              // long tasks (≥ 50 ms, the API's own floor), when supported
  lt_max_ms?: number;
}

export class StallWindow {
  private prev = 0;            // the last observation (page clock); 0 = no anchor
  private hiddenSince = 0;
  private winStart: number;    // global clock
  private seq = 0;
  private observed = 0;
  private n = 0;
  private maxGap = 0;
  private readonly hist = new Map<number, number>();
  private hiddenMs = 0;
  private anchorResets = 0;
  private ltSupported = false;
  private ltN = 0;
  private ltMax = 0;

  constructor(winStartEpoch: number) {
    this.winStart = winStartEpoch;
  }

  /** One timer observation at `now` (page clock). A hidden page re-anchors. */
  observe(now: number, hidden: boolean): void {
    if (hidden) { this.prev = 0; return; }
    if (this.prev > 0) {
      const gap = now - this.prev;
      this.observed++;
      if (gap > this.maxGap) this.maxGap = gap;
      if (gap > HOLD_STALL_MS) {
        this.n++;
        const b = stallBin(gap);
        this.hist.set(b, (this.hist.get(b) ?? 0) + 1);
      }
    }
    this.prev = now;
  }

  hide(now: number): void {
    if (this.hiddenSince === 0) this.hiddenSince = now;
    this.prev = 0;
  }

  show(now: number): void {
    if (this.hiddenSince > 0) {
      this.hiddenMs += Math.max(0, now - this.hiddenSince);
      this.hiddenSince = 0;
    }
    this.prev = 0;
    this.anchorResets++;
  }

  setLongTaskSupported(on: boolean): void { this.ltSupported = on; }

  noteLongTask(ms: number): void {
    this.ltN++;
    if (ms > this.ltMax) this.ltMax = ms;
  }

  /** A row is due: a stall in this window, or the idle window is over. */
  due(nowEpoch: number): boolean {
    return this.n > 0 || nowEpoch - this.winStart >= STALL_IDLE_WINDOW_MS;
  }

  /** The window's row (hidden time up to `now` included), and a new window. */
  take(nowEpoch: number, nowPage: number): StallRow {
    if (this.hiddenSince > 0) {
      this.hiddenMs += Math.max(0, nowPage - this.hiddenSince);
      this.hiddenSince = nowPage;
    }
    const h: Record<string, number> = {};
    for (const b of STALL_BINS) { const c = this.hist.get(b); if (c) h[String(b)] = c; }
    const row: StallRow = {
      seq: ++this.seq,
      win_start: +this.winStart.toFixed(1),
      win_end: +nowEpoch.toFixed(1),
      win_ms: +(nowEpoch - this.winStart).toFixed(1),
      limit_ms: HOLD_STALL_MS,
      observed: this.observed,
      n: this.n,
      max_ms: +this.maxGap.toFixed(1),
      h,
      hidden_ms: +this.hiddenMs.toFixed(1),
      anchor_resets: this.anchorResets,
      ...(this.ltSupported ? { lt_n: this.ltN, lt_max_ms: +this.ltMax.toFixed(1) } : {}),
    };
    this.winStart = nowEpoch;
    this.observed = this.n = this.maxGap = this.hiddenMs = this.anchorResets = this.ltN = this.ltMax = 0;
    this.hist.clear();
    return row;
  }
}

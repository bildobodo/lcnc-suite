// A hold-to-fire gesture (MachineBtn, ButtonDef.hold) as a pure state
// machine: the clock and the scheduler are injected, so its rules hold
// deterministically in a unit test (Codex R397 VM397-03) — the browser's own
// race stays a real-time probe beside it.
//
// The rules (operator Q397-1, Codex R397 VM397-01 / VM397-02):
//  - ONE gesture per press: every timer it schedules is its own;
//    a release, a cancel, a slide-off, a gate or target change, a hidden page,
//    a lost focus or the unmount END it for good — a continuation of an ended
//    gesture does nothing, even when a new press has begun.
//  - The page is WATCHED while the finger is down: a timer every WATCH_MS
//    (not frames — a GPU-bound viewer draws below 10 fps with the main thread
//    free) and the due timer note the time since the last observation. A gap longer than
//    STALL_MS means the main thread was blocked — a release in that gap may
//    still be queued, so the hold is no longer provable: it ends with
//    "Page delayed — hold again" and nothing is sent (never a later fire).
//  - The action runs only at the due time with an unbroken watch.
// What stays open (named): a release in the last STALL_MS before the hold
// time, queued behind a task shorter than STALL_MS that spans the due time,
// can still read as a full hold — a press of at least HOLD_FIRE_MS − STALL_MS.

/** How often a held press is observed, ms. */
export const HOLD_WATCH_MS = 20;
/** The longest gap between two observations of a held press that still
 *  counts as an unbroken watch, ms: the watch's own period plus the long
 *  tasks measured under the gate's load (50–83 ms) and some room. */
export const HOLD_STALL_MS = 150;

export type HoldEnd =
  | "released" | "moved" | "left" | "cancelled" | "hidden" | "blur" | "gate" | "target" | "unmount" | "stalled";

export interface HoldScheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export interface HoldCallbacks {
  /** The hold time is over with an unbroken watch: act. */
  fire(): void;
  /** The gesture ended without acting (`why` — the reason, for its hint). */
  ended(why: HoldEnd, heldMs: number): void;
}

/** One gesture: made at the press (its timers start), ended by `end` on any
 *  release or cancel — or by itself at the action or a stall. */
export class HoldGesture {
  private alive = true;
  private timer = 0;
  private watcher = 0;
  private readonly s: HoldScheduler;
  private readonly cb: HoldCallbacks;
  private readonly stallMs: number;
  private readonly startedAt: number;
  private lastSeen: number;

  constructor(s: HoldScheduler, holdMs: number, cb: HoldCallbacks, stallMs = HOLD_STALL_MS) {
    this.s = s;
    this.cb = cb;
    this.stallMs = stallMs;
    this.startedAt = s.now();
    this.lastSeen = this.startedAt;
    this.timer = s.setTimeout(() => this.due(), holdMs);
    this.watcher = s.setTimeout(() => this.watch(), HOLD_WATCH_MS);
  }

  get active(): boolean { return this.alive; }

  /** The time since the last observation, and the observation itself. A gap
   *  past the limit ends the gesture: the press is no longer provable. */
  private observe(): boolean {
    const t = this.s.now();
    const gap = t - this.lastSeen;
    this.lastSeen = t;
    if (gap > this.stallMs) {
      this.finish("stalled");
      return false;
    }
    return true;
  }

  private watch(): void {
    if (!this.alive) return;
    if (!this.observe()) return;
    this.watcher = this.s.setTimeout(() => this.watch(), HOLD_WATCH_MS);
  }

  private due(): void {
    if (!this.alive) return;
    if (!this.observe()) return;
    this.alive = false;
    this.s.clearTimeout(this.watcher);
    this.cb.fire();
  }

  /** The press ended before the action (release, cancel, gate …). */
  end(why: Exclude<HoldEnd, "stalled">): void { this.finish(why); }

  private finish(why: HoldEnd): void {
    if (!this.alive) return;
    this.alive = false;
    this.s.clearTimeout(this.timer);
    this.s.clearTimeout(this.watcher);
    this.cb.ended(why, this.s.now() - this.startedAt);
  }
}

/** The browser's scheduler. */
export const BROWSER_SCHEDULER: HoldScheduler = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

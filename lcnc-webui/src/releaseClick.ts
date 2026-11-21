// A control acts on the RELEASE of its press, however long the press was
// (machine day 2026-11-21, F12; operator decision P1a): Chromium on the
// machine's touch panel turns a long press into a long-press gesture — it
// ends with `contextmenu` (refused, touchDetect.ts) and dispatches NO click.
// Pause, Abort and the UI E-Stop did nothing on a long press, and so did
// every other control that acts on `click` (Reset, Arm, Acknowledge, tabs).
// Only the E-Stop acts on the press itself (SafetyStrip.vue); a control that
// owns its press (a hold, the jog pad, the E-Stop) carries `data-press-owned`
// and is left alone here.
//
// The rule, per touch/pen pointer (a mouse press always ends in a click):
//   - the press began and ended on the SAME actionable control, within the
//     slop, and was not cancelled (a swipe or a browser pan ends it);
//   - a press that saw the long-press `contextmenu` gets its click at the
//     release; a press long enough for one (≥ minPressMs) waits waitMs for the
//     browser's own click and gets one only if none came;
//   - once a click was given, a trusted click on that control before the next
//     press (within lateClickMs) is the browser's late one and is swallowed —
//     a press acts ONCE.
// A shorter press is the browser's ordinary tap: nothing here touches it.

export interface ReleaseClickOptions {
  /** Below this press time the browser always delivers its own click. */
  minPressMs: number;
  /** How long a long press waits for the browser's own click. */
  waitMs: number;
  /** Movement that turns a press into a swipe (CSS px, like a hold's slop). */
  slopPx: number;
  /** How long after a given click a trusted click on the same control is the browser's late duplicate. */
  lateClickMs: number;
}

export const RELEASE_CLICK_DEFAULTS: ReleaseClickOptions = { minPressMs: 400, waitMs: 120, slopPx: 10, lateClickMs: 1000 };

interface Press<T> { target: T; t0: number; x0: number; y0: number; menu: boolean; moved: boolean }
interface Waiting<T> { target: T; due: number }

export type ReleaseDecision = "none" | "now" | "wait";

/** The pure bookkeeping: events in, decisions out (unit-tested without a DOM). */
export class ReleaseTracker<T> {
  private presses = new Map<number, Press<T>>();
  private waiting = new Map<number, Waiting<T>>();
  private given: { target: T; until: number } | null = null;

  private readonly opt: ReleaseClickOptions;

  constructor(opt: ReleaseClickOptions = RELEASE_CLICK_DEFAULTS) { this.opt = opt; }

  /** A touch/pen press began; `target` null = not an actionable control. */
  down(id: number, target: T | null, t: number, x: number, y: number): void {
    this.given = null;            // a new press: no late click of an earlier one can follow it
    if (target == null) { this.presses.delete(id); return; }
    this.presses.set(id, { target, t0: t, x0: x, y0: y, menu: false, moved: false });
  }

  move(id: number, x: number, y: number): void {
    const p = this.presses.get(id);
    if (p && (Math.abs(x - p.x0) > this.opt.slopPx || Math.abs(y - p.y0) > this.opt.slopPx)) p.moved = true;
  }

  /** The long-press `contextmenu`: by its pointer when the browser names it, else the one press on `target`. */
  contextmenu(id: number | undefined, target: T | null): void {
    if (id != null && this.presses.has(id)) { this.presses.get(id)!.menu = true; return; }
    for (const p of this.presses.values()) if (target != null && p.target === target) p.menu = true;
  }

  cancel(id: number): void { this.presses.delete(id); this.waiting.delete(id); }

  /** The release: give the click now, wait for the browser's own, or nothing. */
  up(id: number, target: T | null, t: number, x: number, y: number): ReleaseDecision {
    const p = this.presses.get(id);
    this.presses.delete(id);
    if (!p) return "none";
    if (Math.abs(x - p.x0) > this.opt.slopPx || Math.abs(y - p.y0) > this.opt.slopPx) p.moved = true;
    if (p.moved || target !== p.target) return "none";
    if (p.menu) { this.give(p.target, t); return "now"; }
    if (t - p.t0 < this.opt.minPressMs) return "none";
    this.waiting.set(id, { target: p.target, due: t + this.opt.waitMs });
    return "wait";
  }

  /** The wait ended: the target to click, or null when the browser's click came. */
  expire(id: number, t: number): T | null {
    const w = this.waiting.get(id);
    if (!w) return null;
    this.waiting.delete(id);
    this.give(w.target, t);
    return w.target;
  }

  /** A click reached the page. "swallow" = the browser's late duplicate of a click already given. */
  click(target: T | null, trusted: boolean, t: number): "pass" | "swallow" {
    if (!trusted) return "pass";                       // our own click (or a script's)
    for (const [id, w] of this.waiting) {
      if (w.target === target) { this.waiting.delete(id); return "pass"; }   // the browser delivered it
    }
    if (this.given && this.given.target === target && t <= this.given.until) {
      this.given = null;
      return "swallow";
    }
    return "pass";
  }

  private give(target: T, t: number): void { this.given = { target, until: t + this.opt.lateClickMs }; }
}

/** What a release can click: the controls that act on `click`. */
const ACTIONABLE = [
  "button", "a[href]", "summary", "label",
  'input[type="checkbox"]', 'input[type="radio"]',
  '[role="button"]', '[role="tab"]', '[role="radio"]', '[role="checkbox"]', '[role="switch"]',
  '[role="option"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
].join(", ");

export function releaseTarget(t: EventTarget | null): HTMLElement | null {
  const el = t instanceof Element ? t.closest(ACTIONABLE) : null;
  if (!(el instanceof HTMLElement)) return null;
  if (el.closest("[data-press-owned]")) return null;   // a hold, the jog pad, the E-Stop: they own the press
  return el;
}

let installed = false;

/** Installs the release click on `doc` (once). */
export function installReleaseClick(doc: Document = document, opt: ReleaseClickOptions = RELEASE_CLICK_DEFAULTS): void {
  if (installed) return;
  installed = true;
  const tracker = new ReleaseTracker<HTMLElement>(opt);
  const timers = new Map<number, number>();
  const pen = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";
  const at = (e: PointerEvent) => releaseTarget(doc.elementFromPoint(e.clientX, e.clientY) ?? e.target);
  const clearTimer = (id: number) => { const h = timers.get(id); if (h != null) { clearTimeout(h); timers.delete(id); } };

  doc.addEventListener("pointerdown", (e) => {
    if (!pen(e)) { tracker.down(e.pointerId, null, e.timeStamp, e.clientX, e.clientY); return; }
    clearTimer(e.pointerId);
    tracker.down(e.pointerId, releaseTarget(e.target), e.timeStamp, e.clientX, e.clientY);
  }, true);
  doc.addEventListener("pointermove", (e) => { if (pen(e)) tracker.move(e.pointerId, e.clientX, e.clientY); }, true);
  doc.addEventListener("pointercancel", (e) => { clearTimer(e.pointerId); tracker.cancel(e.pointerId); }, true);
  doc.addEventListener("contextmenu", (e) => {
    const id = (e as PointerEvent).pointerId;
    tracker.contextmenu(typeof id === "number" && id >= 0 ? id : undefined, releaseTarget(e.target));
  }, true);
  // The click a release gives is the one the browser would have dispatched:
  // a PointerEvent "click" from that pointer at the release point (detail 1 —
  // a pointer activation, never read as a keyboard one).
  const give = (target: HTMLElement, e: { pointerId: number; pointerType: string; isPrimary: boolean; clientX: number; clientY: number }) => {
    if (!target.isConnected) return;
    target.dispatchEvent(new PointerEvent("click", {
      bubbles: true, cancelable: true, composed: true, detail: 1, view: doc.defaultView,
      pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, clientX: e.clientX, clientY: e.clientY,
    }));
  };
  doc.addEventListener("pointerup", (e) => {
    if (!pen(e)) return;
    const id = e.pointerId;
    const target = at(e);
    const d = tracker.up(id, target, e.timeStamp, e.clientX, e.clientY);
    const from = { pointerId: id, pointerType: e.pointerType, isPrimary: e.isPrimary, clientX: e.clientX, clientY: e.clientY };
    if (d === "now" && target) {
      // after this release's own listeners: the click follows the release, as the browser's would
      setTimeout(() => give(target, from), 0);
    } else if (d === "wait") {
      timers.set(id, window.setTimeout(() => {
        timers.delete(id);
        const t = tracker.expire(id, performance.now());
        if (t) give(t, from);
      }, opt.waitMs));
    }
  }, true);
  doc.addEventListener("click", (e) => {
    if (tracker.click(releaseTarget(e.target), e.isTrusted, e.timeStamp) === "swallow") {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
}

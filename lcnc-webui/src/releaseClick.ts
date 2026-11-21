// A control acts on the RELEASE of its press, however long the press was
// (machine day 2026-11-21, F12; operator decision for plan P1a): Chromium on
// the machine's touch panel turns a long press into a long-press gesture — it
// ends with `contextmenu` (refused, touchDetect.ts) and dispatches NO click.
// Pause, Abort and the UI E-Stop did nothing on a long press, and so did
// every other control that acts on `click` (Reset, Arm, Acknowledge, tabs,
// Jog Stop). Only the E-Stop acts on the press itself (SafetyStrip.vue); a
// control that owns its press (a hold, a jog direction, the E-Stop) carries
// `data-press-owned` and is left alone here.
//
// The rule is kept PER POINTER, each press its own gesture (Codex R420):
//   - a touch/pen press that began and ended on the SAME click control —
//     within the slop, not cancelled, never turned into a scroll — gets its
//     click: at the release when the long-press `contextmenu` came, else after
//     waitMs when the browser's own click (of that pointer) did not come —
//     whatever its length: a second finger's tap while another touch is down
//     gets no browser click either (the jog pad's Stop beside a held jog);
//   - a native control that is :disabled gets no click (a dispatched click
//     would bypass the disabled state) — its explanation wrapper takes the
//     press instead; the state is judged at the press and again at the click;
//   - the browser's late click OF THAT POINTER before its next press is a
//     duplicate and is swallowed: a press acts once. A keyboard activation
//     (detail 0) and another pointer's click are never taken for one;
//   - a press the scroll owner took over (dragScroll.ts: `noteScrollGesture`
//     at its threshold) acts nowhere: no click is given, and the browser's own
//     click of that pointer is swallowed too — Chromium still clicked the
//     control under the finger after a 6 px strip drag.

export interface ReleaseClickOptions {
  /** Below this press time the release relies on the browser's own click
   *  (0: every press waits for it — a second finger's tap gets none). */
  minPressMs: number;
  /** How long a long press waits for the browser's own click. */
  waitMs: number;
  /** Movement that turns a press outside a scroll owner into a swipe (CSS px). */
  slopPx: number;
  /** How long after its release a press's late browser click is still that press's. */
  lateClickMs: number;
}

export const RELEASE_CLICK_DEFAULTS: ReleaseClickOptions = { minPressMs: 0, waitMs: 120, slopPx: 10, lateClickMs: 1000 };

interface Press<T> { target: T; t0: number; x0: number; y0: number; menu: boolean; moved: boolean }

export type ReleaseDecision = "none" | "now" | "wait";

/** The pure bookkeeping, per pointer: events in, decisions out (unit-tested without a DOM). */
export class ReleaseTracker<T> {
  private readonly opt: ReleaseClickOptions;
  private presses = new Map<number, Press<T>>();
  /** A long press waiting for the browser's own click. */
  private waiting = new Map<number, T>();
  /** A click this pointer was given: its late browser duplicate is swallowed until then. */
  private given = new Map<number, number>();
  /** A press that became a scroll: its browser click is swallowed until then. */
  private scrolled = new Map<number, number>();

  constructor(opt: ReleaseClickOptions = RELEASE_CLICK_DEFAULTS) { this.opt = opt; }

  /** A press began; `target` null = not a click control (or not a touch/pen press). */
  down(id: number, target: T | null, t: number, x: number, y: number): void {
    // a new press of this pointer: whatever its last one left is over
    this.given.delete(id);
    this.waiting.delete(id);
    this.scrolled.delete(id);
    if (target == null) { this.presses.delete(id); return; }
    this.presses.set(id, { target, t0: t, x0: x, y0: y, menu: false, moved: false });
  }

  move(id: number, x: number, y: number): void {
    const p = this.presses.get(id);
    if (p && (Math.abs(x - p.x0) > this.opt.slopPx || Math.abs(y - p.y0) > this.opt.slopPx)) p.moved = true;
  }

  /** The scroll owner took this press over: it acts nowhere, its click included. */
  scroll(id: number): void {
    const p = this.presses.get(id);
    if (p) p.moved = true;
    this.scrolled.set(id, Number.POSITIVE_INFINITY);
  }

  /** The long-press `contextmenu`: by its pointer when the browser names it, else the one press on `target`. */
  contextmenu(id: number | undefined, target: T | null): void {
    if (id != null && this.presses.has(id)) { this.presses.get(id)!.menu = true; return; }
    for (const p of this.presses.values()) if (target != null && p.target === target) p.menu = true;
  }

  cancel(id: number): void { this.presses.delete(id); this.waiting.delete(id); }

  /** The release: give the click now, wait for the browser's own, or nothing. */
  up(id: number, target: T | null, t: number, x: number, y: number): ReleaseDecision {
    if (this.scrolled.has(id)) this.scrolled.set(id, t + this.opt.lateClickMs);
    const p = this.presses.get(id);
    this.presses.delete(id);
    if (!p || this.scrolled.has(id)) return "none";
    if (Math.abs(x - p.x0) > this.opt.slopPx || Math.abs(y - p.y0) > this.opt.slopPx) p.moved = true;
    if (p.moved || target !== p.target) return "none";
    if (p.menu) { this.given.set(id, t + this.opt.lateClickMs); return "now"; }
    if (t - p.t0 < this.opt.minPressMs) return "none";
    this.waiting.set(id, p.target);
    return "wait";
  }

  /** The wait ended: the target to click, or null when the browser's click came. */
  expire(id: number, t: number): T | null {
    const target = this.waiting.get(id);
    if (target === undefined) return null;
    this.waiting.delete(id);
    this.given.set(id, t + this.opt.lateClickMs);
    return target;
  }

  /** A click reached the page. "swallow" = a scrolled press's click, or the late duplicate of a click given. */
  click(target: T | null, trusted: boolean, t: number, pointerId: number | undefined, detail: number): "pass" | "swallow" {
    if (!trusted) return "pass";                       // our own click (or a script's)
    if (detail === 0) return "pass";                   // a keyboard or assistive activation: no pointer's
    if (pointerId == null || pointerId < 0) {
      // a pointer click that names no pointer: nothing here can be sure it is a duplicate
      for (const [id, w] of this.waiting) if (w === target) { this.waiting.delete(id); break; }
      return "pass";
    }
    const s = this.scrolled.get(pointerId);
    if (s !== undefined && t <= s) { this.scrolled.delete(pointerId); return "swallow"; }
    if (this.waiting.has(pointerId)) { this.waiting.delete(pointerId); return "pass"; }   // the browser delivered it
    const g = this.given.get(pointerId);
    if (g !== undefined && t <= g) { this.given.delete(pointerId); return "swallow"; }
    return "pass";
  }
}

/** What a release can click: the controls that act on `click`. */
const ACTIONABLE = [
  "button", "a[href]", "summary", "label",
  'input[type="checkbox"]', 'input[type="radio"]',
  '[role="button"]', '[role="tab"]', '[role="radio"]', '[role="checkbox"]', '[role="switch"]',
  '[role="option"]', '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
].join(", ");

/** The click control a press on `t` addresses, or null. A :disabled native control
 *  passes the press to the control around it (its explanation wrapper, MachineBtn's
 *  `.btnTip`) — never a click to itself. Editable text keeps its own long press
 *  (selection, touchDetect.ts): a text field is no click control here. */
function inert(el: Element): boolean {
  // a disabled control, or the label of one (its activation would click it)
  if (el.matches(":disabled")) return true;
  return el instanceof HTMLLabelElement && el.control != null && el.control.matches(":disabled");
}

export function releaseTarget(t: EventTarget | null): HTMLElement | null {
  let el: Element | null = t instanceof Element ? t.closest(ACTIONABLE) : null;
  while (el && inert(el)) el = el.parentElement?.closest(ACTIONABLE) ?? null;
  if (!(el instanceof HTMLElement)) return null;
  if (el.closest("[data-press-owned]")) return null;   // a hold, a jog direction, the E-Stop: they own the press
  return el;
}

let active: ReleaseTracker<HTMLElement> | null = null;

/** The scroll owner (dragScroll.ts) took the press of `pointerId` over at its threshold. */
export function noteScrollGesture(pointerId: number): void { active?.scroll(pointerId); }

/** Installs the release click on `doc` (once). */
export function installReleaseClick(doc: Document = document, opt: ReleaseClickOptions = RELEASE_CLICK_DEFAULTS): void {
  if (active) return;
  const tracker = new ReleaseTracker<HTMLElement>(opt);
  active = tracker;
  const timers = new Map<number, number>();
  const pen = (e: PointerEvent) => e.pointerType === "touch" || e.pointerType === "pen";
  const at = (e: PointerEvent) => releaseTarget(doc.elementFromPoint(e.clientX, e.clientY) ?? e.target);
  const clearTimer = (id: number) => { const h = timers.get(id); if (h != null) { clearTimeout(h); timers.delete(id); } };
  // The click a release gives is the one the browser would have dispatched:
  // a PointerEvent "click" from that pointer at the release point (detail 1 —
  // a pointer activation, never read as a keyboard one). A control that became
  // :disabled meanwhile (a gate closed after the release) gets none.
  const give = (target: HTMLElement, e: { pointerId: number; pointerType: string; isPrimary: boolean; clientX: number; clientY: number }) => {
    if (!target.isConnected || inert(target)) return;
    target.dispatchEvent(new PointerEvent("click", {
      bubbles: true, cancelable: true, composed: true, detail: 1, view: doc.defaultView,
      pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary, clientX: e.clientX, clientY: e.clientY,
    }));
  };

  doc.addEventListener("pointerdown", (e) => {
    clearTimer(e.pointerId);
    tracker.down(e.pointerId, pen(e) ? releaseTarget(e.target) : null, e.timeStamp, e.clientX, e.clientY);
  }, true);
  doc.addEventListener("pointermove", (e) => { if (pen(e)) tracker.move(e.pointerId, e.clientX, e.clientY); }, true);
  doc.addEventListener("pointercancel", (e) => { clearTimer(e.pointerId); tracker.cancel(e.pointerId); }, true);
  doc.addEventListener("contextmenu", (e) => {
    const id = (e as PointerEvent).pointerId;
    tracker.contextmenu(typeof id === "number" && id >= 0 ? id : undefined, releaseTarget(e.target));
  }, true);
  doc.addEventListener("pointerup", (e) => {
    const id = e.pointerId;
    const target = pen(e) ? at(e) : null;
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
    const pid = (e as PointerEvent).pointerId;
    if (tracker.click(releaseTarget(e.target), e.isTrusted, e.timeStamp, typeof pid === "number" ? pid : undefined, e.detail) === "swallow") {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
}

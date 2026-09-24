// The transient control hint (WP6, review "Hold verständlich"): "Hold to
// activate" after a short tap on a hold-to-fire button, "Busy — try again"
// when the busy latch drops a click, and — design wave D1, UI-K18 — the
// REASON a dimmed control is unavailable, told at the control that was
// touched. ONE hint at a time, rendered ONCE by FloatingOverlays.vue (App):
// a per-button Teleport made MachineBtn a fragment root, which strips the
// parent's scoped-CSS id from the rendered button — every `.nkKey` /
// `.tkKey` / `.safetyBtn` rule stopped applying (implementation review
// UI-I07).
//
// Placement (UI-D08): FloatingOverlays measures the hint AS RENDERED and
// places it through helpPlacement's `placePopover` — above the control when
// it fits (the finger covers the control from below), else below, clamped
// to every viewport edge, its width capped by the viewport; viewport px are
// divided by the CSS zoom for the hint's own left/top. It wraps, shows a
// little longer for a longer text, and closes on the next pointer or key
// anywhere, on a scroll, or when its control leaves the document.
import { reactive } from "vue";

export const HINT_MS = 1500;
const HINT_MS_PER_CHAR = 60;
const HINT_MS_MAX = 4000;

/** How long a hint stays unless the next touch or key closes it first
 *  (FloatingOverlays): short hints the classic 1.5 s, a longer reason about
 *  60 ms per character, never more than 4 s — a hint must not linger over
 *  the controls (operator, D1 live look). */
export function hintDuration(text: string): number {
  return Math.min(HINT_MS_MAX, Math.max(HINT_MS, text.length * HINT_MS_PER_CHAR));
}

export const btnHint = reactive({ text: "", seq: 0 });
/** The control the current hint speaks for (placement anchor): an element,
 *  or a getter resolved at PLACEMENT time — a gate closing under the finger
 *  re-renders MachineBtn into its .btnTip wrapper, and an element captured
 *  before that render has left the document by the time the hint is placed
 *  (the hint then hid at once). */
let _anchor: HTMLElement | (() => unknown) | null = null;
let timer = 0;

export function hintAnchor(): HTMLElement | null {
  const el = typeof _anchor === "function" ? _anchor() : _anchor;
  return el instanceof HTMLElement && el.isConnected ? el : null;
}

/** Show `text` at `anchor` (an element or a getter for one); a new hint
 *  replaces the old. */
export function showBtnHint(anchor: unknown, text: string): void {
  _anchor = typeof anchor === "function" ? anchor as () => unknown
    : anchor instanceof HTMLElement ? anchor : null;
  btnHint.text = text;
  btnHint.seq++;
  clearTimeout(timer);
  timer = window.setTimeout(hideBtnHint, hintDuration(text));
}

export function hideBtnHint(): void {
  clearTimeout(timer);
  btnHint.text = "";
  _anchor = null;
}

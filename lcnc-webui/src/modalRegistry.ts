// Modal registry — the ONE answer to "is a dialog open?" for the global
// keyboard shortcut map (WP0, UI-03).
//
// Every component that renders a `.dialogOverlay` registers its open state
// here (registerModal). While anything is registered open — or the number
// keypad is up — the shortcut map lets only E-Stop through: a dialog is not
// an operating position, so Space (Cycle Start), Backspace (Abort) and the
// jog keys must not reach the machine from behind it. Abort stays reachable
// by button and banner.
//
// Registration is explicit and per component so the guard spec can compare
// the DOM's `.dialogOverlay` count with `modalCount` (self-test): a dialog
// that forgot to register shows up as a mismatch, never as a silent gap.
import { computed, getCurrentInstance, onUnmounted, ref, shallowReactive, watch, type Ref } from "vue";
import { focusReturn, helperOpen, setFocusFallback } from "./inputSession";

const openCount = ref(0);

/** Number of registered dialogs currently open (keypad excluded). */
export const modalCount = computed(() => openCount.value);

/** True while any registered dialog or an input helper (number keypad or
 *  text keyboard) is open. */
export const modalOpen = computed(() => openCount.value > 0 || helperOpen.value);

/**
 * Register a dialog's open state. Call from a component's setup; the entry
 * is counted while the source is truthy and released when it turns false
 * or the component unmounts (a dialog component that IS the overlay passes
 * `() => true`).
 */
export function registerModal(isOpen: Ref<boolean> | (() => boolean)): void {
  let counted = false;
  const release = () => { if (counted) { openCount.value--; counted = false; } };
  const stop = watch(isOpen, (open) => {
    if (open && !counted) { openCount.value++; counted = true; }
    else if (!open) release();
  }, { immediate: true });
  if (getCurrentInstance()) onUnmounted(() => { stop(); release(); });
}

// ── Dialog stack + focus scope (design wave D2, UI-D01, UI-D06) ──
// DialogFrame pushes itself here; only the TOPMOST dialog is an operating
// position. Tab and Shift+Tab walk ONE ordered set while a dialog is open:
// the topmost dialog, its own input helper (the keypad strip / keyboard of a
// field inside it — same `data-input-area`), the safety strip (Arm, E-Stop,
// Power) and the banner's Abort / Acknowledge (`data-dialog-reachable`).
// Nothing else: not Home All, not the strips, not the panels behind the
// scrim. No `inert` and no native <dialog>: both would make the safety strip
// unreachable, and a modal <dialog> turns Escape (E-Stop) into a cancel. A
// pointer still reaches the strips below the content area by design.
export type DialogKind = "info" | "confirm" | "form" | "host" | "flow";
export interface DialogEntry {
  id: string;
  kind: DialogKind;
  el: () => HTMLElement | null;
  /** Where focus goes when this dialog becomes the operating position
   *  without a return target of its own (its initial focus, Anhang B). */
  initial: () => HTMLElement | null;
  /** The control focus returns to when this dialog closes. A LOWER dialog
   *  that closes first re-points it when it lay inside that dialog. */
  opener: HTMLElement | null;
}
const stack = shallowReactive<DialogEntry[]>([]);

// ONE order decides everything a stack decides — the visible layer, the
// operating position (initial focus, Tab scope, the helper pause, the focus
// fallback) and where focus returns (implementation review UI-DI01): a
// machine flow (kind "flow" — the `.safetyDialog` tier, --z-modal-top, is
// bound to the same kind in DialogFrame) stays above every other dialog, so
// a dialog opened while a flow is up (the header stays reachable by
// pointer) is inserted BELOW the flows. Within a tier the order is the
// mount order, which is also the DOM order the Teleport appends in — the
// later overlay paints on top at an equal z-index.
export function pushDialog(entry: DialogEntry): void {
  const firstFlow = stack.findIndex(e => e.kind === "flow");
  stack.splice(entry.kind === "flow" || firstFlow < 0 ? stack.length : firstFlow, 0, entry);
}

/** Remove a dialog; `wasTop` tells whether it was the operating position.
 *  A LOWER dialog closing hands its opener to every dialog above it whose
 *  own opener lay inside it (that control goes with it): the stack's
 *  eventual return still lands on the control that opened the bottom of
 *  what is left, whichever of two siblings Vue unmounts first. */
export function popDialog(id: string): { wasTop: boolean } {
  const i = stack.findIndex(e => e.id === id);
  if (i < 0) return { wasTop: false };
  const [gone] = stack.splice(i, 1);
  const wasTop = i === stack.length;
  const box = gone!.el();
  if (!wasTop && box) {
    for (let k = i; k < stack.length; k++) {
      const o = stack[k]!.opener;
      if (o && box.contains(o)) stack[k]!.opener = gone!.opener;
    }
  }
  return { wasTop };
}

/** The topmost open dialog, or null. */
export const topDialog = computed(() => stack[stack.length - 1] ?? null);

/** The element of the dialog directly beneath `id` (whose input helper
 *  pauses when `id` opens over it), or null. */
export function dialogBelowEl(id: string): HTMLElement | null {
  const i = stack.findIndex(e => e.id === id);
  return i > 0 ? stack[i - 1]!.el() : null;
}

/** True when `el` is inside the topmost dialog's focus scope: the dialog,
 *  its own input helper, the safety strip, the banner's Abort / Acknowledge. */
export function inDialogScope(el: Element | null): boolean {
  const top = topDialog.value?.el();
  if (!top || !el) return false;
  if (top.contains(el) || el.closest(".safetyStrip, [data-dialog-reachable]")) return true;
  const area = el.closest("[data-input-area]")?.getAttribute("data-input-area");
  return !!area && !!top.querySelector(`[data-input-area="${CSS.escape(area)}"]`);
}

// The control that opened a dialog: the focused element, else the control
// under the last pointer press (Safari and Firefox on macOS do not focus a
// button on click). There a dialog CONTAINER keeps focus through a click on
// a control (its X, a header button): a press within the last second is the
// opener then, not the container that merely held focus.
let lastPressed: HTMLElement | null = null;
let lastPressedAt = 0;
const OPENER_PRESS_MS = 1000;
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
export function takeOpener(): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  const pressed = lastPressed?.isConnected ? lastPressed : null;
  if (a && a !== document.body && a !== document.documentElement) {
    if (a.getAttribute("role") === "dialog" && pressed && performance.now() - lastPressedAt < OPENER_PRESS_MS) return pressed;
    return a;
  }
  return pressed;
}

function tabbable(root: Element): HTMLElement[] {
  const out: HTMLElement[] = [];
  const radioSeen = new Set<string>();
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (el.tabIndex < 0 || el.matches(":disabled") || !el.getClientRects().length) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    // A radio group is ONE stop (its checked radio), as the browser tabs it.
    if (el instanceof HTMLInputElement && el.type === "radio" && el.name) {
      if (radioSeen.has(el.name)) continue;
      radioSeen.add(el.name);
      const group = [...root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(el.name)}"]`)];
      out.push(group.find(r => r.checked && !r.disabled) ?? el);
      continue;
    }
    out.push(el);
  }
  return out;
}

/** The focus scope of the topmost dialog, in Tab order; null without one. */
export function focusScope(): HTMLElement[] | null {
  const top = topDialog.value?.el();
  if (!top) return null;
  const areas = new Set([...top.querySelectorAll("[data-input-area]")].map(e => e.getAttribute("data-input-area")));
  const helpers = [...document.querySelectorAll<HTMLElement>("[data-input-area]")]
    .filter(el => !top.contains(el) && areas.has(el.getAttribute("data-input-area")));
  const roots: Element[] = [top, ...helpers, ...document.querySelectorAll(".safetyStrip, [data-dialog-reachable]")];
  const seen = new Set<HTMLElement>();
  const list: HTMLElement[] = [];
  for (const r of roots) {
    const own = r !== top && r.matches(FOCUSABLE) && !(r as HTMLElement).matches(":disabled") ? [r as HTMLElement] : [];
    for (const el of [...own, ...tabbable(r)]) if (!seen.has(el)) { seen.add(el); list.push(el); }
  }
  return list;
}

function onTabKey(e: KeyboardEvent): void {
  if (e.key !== "Tab" || stack.length === 0) return;   // the hot path: one compare
  if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  const scope = focusScope();
  if (!scope) return;
  e.preventDefault();
  const top = topDialog.value!.el()!;
  if (!scope.length) { top.focus(); return; }
  const active = document.activeElement;
  const at = scope.findIndex(el => el === active || el.contains(active));
  const next = at < 0 ? (e.shiftKey ? scope.length - 1 : 0)
    : (at + (e.shiftKey ? -1 : 1) + scope.length) % scope.length;
  scope[next]!.focus();
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", (e) => {
    const t = e.target as Element | null;
    lastPressed = (t?.closest?.(FOCUSABLE) as HTMLElement | null) ?? null;
    lastPressedAt = performance.now();
  }, { capture: true, passive: true });
  document.addEventListener("keydown", onTabKey, true);
  // Focus that falls to `body` while a dialog is open goes back to the
  // topmost dialog's CONTAINER — a neutral spot, nothing under Space or
  // Enter (review UI-DI04). The case: a disarm disables the focused field
  // through the content Gate; Chromium then moves focus to body and fires
  // a focusout without a relatedTarget (verified). Firefox and Safari may
  // leave focus on the disabled control — there the next Tab recovers
  // (onTabKey starts at the scope's first stop). Focus that moved to a
  // control (a strip button by pointer — allowed) is left alone, and a
  // focus return in flight (a dialog closing) owns the landing.
  document.addEventListener("focusout", (e) => {
    if (stack.length === 0 || (e as FocusEvent).relatedTarget) return;
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (stack.length === 0 || focusReturn.pending) return;
      if (a && a !== document.body && a !== document.documentElement) return;
      topDialog.value?.el()?.focus({ preventScroll: true });
    });
  }, true);
  // A focus return that cannot land on its control lands on the topmost
  // dialog's initial focus, never outside its scope (inputSession's
  // fallback reads this).
  setFocusFallback(() => topDialog.value?.initial() ?? null);
}

// Diagnostics hook for the guard spec's DOM-vs-registry self-test and the
// dialog scan (which dialog is on top).
if (typeof window !== "undefined") {
  (window as any).__modalRegistry = {
    count: () => openCount.value, open: () => modalOpen.value, top: () => topDialog.value?.id ?? null,
  };
}

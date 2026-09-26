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
import { helperOpen, setFocusFallback } from "./inputSession";

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
interface DialogEntry { id: string; kind: DialogKind; el: () => HTMLElement | null }
const stack = shallowReactive<DialogEntry[]>([]);

/** The topmost open dialog, or null. */
export const topDialog = computed(() => stack[stack.length - 1] ?? null);

export function pushDialog(entry: DialogEntry): () => void {
  stack.push(entry);
  return () => { const i = stack.findIndex(e => e.id === entry.id); if (i >= 0) stack.splice(i, 1); };
}

/** The element of the topmost dialog other than `exceptId` (the one below a
 *  dialog that is opening), or null. */
export function topDialogEl(exceptId: string): HTMLElement | null {
  for (let i = stack.length - 1; i >= 0; i--) if (stack[i]!.id !== exceptId) return stack[i]!.el();
  return null;
}

// The control that opened a dialog: the focused element, else the control
// under the last pointer press (Safari and Firefox on macOS do not focus a
// button on click).
let lastPressed: HTMLElement | null = null;
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
export function takeOpener(): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== document.body && a !== document.documentElement) return a;
  return lastPressed?.isConnected ? lastPressed : null;
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
  }, { capture: true, passive: true });
  document.addEventListener("keydown", onTabKey, true);
  // A focus return that cannot land on its control lands on the topmost
  // dialog, never outside its scope (inputSession's fallback reads this).
  setFocusFallback(() => topDialog.value?.el() ?? null);
}

// Diagnostics hook for the guard spec's DOM-vs-registry self-test and the
// dialog scan (which dialog is on top).
if (typeof window !== "undefined") {
  (window as any).__modalRegistry = {
    count: () => openCount.value, open: () => modalOpen.value, top: () => topDialog.value?.id ?? null,
  };
}

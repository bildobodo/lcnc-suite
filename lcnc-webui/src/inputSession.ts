// The unified INPUT SESSION (WP8, UI-15): exactly one on-screen helper at a
// time — the number keypad (useNumberKeypad.ts, kept as the number facade)
// or the text/code keyboard (TextKeypadStrip.vue) — owned by ONE target.
//
// Rules (review table, all adopted):
//   • Selecting a field opens the layout for ITS kind; the field is the
//     owner and its name + unit are visible in the strip title.
//   • Text ↔ number: owner and layout switch directly; no old mode stays
//     behind. Number A → number B (or → text): A is NOT confirmed, its
//     draft stays with A and comes back marked "draft" when A is re-opened.
//   • Operating the keys is not leaving (pointerdown.prevent). Leaving =
//     pointerdown outside the FOCUS AREA (field + glyph + strip section,
//     all tagged data-input-area="<ownerId>") or focus moving out of it —
//     from the field OR from one of the helper's keys — or Close: hide,
//     confirm nothing, send nothing. Both helpers follow the same rule. A
//     bare DOM blur is not a close criterion, and opening is NEVER bound to
//     focus (UI-15a).
//   • Owner unmounted / gate closed → the session ends; a hidden-but-mounted
//     owner (tab switch) LOCKS it: the helper hides, the draft stays. The
//     owner's visibility is polled here for BOTH kinds (a number owner
//     through its trigger element, a text owner through target.isVisible).
//   • Confirmation stays target-specific: number → Apply/valid Enter; MDI →
//     Apply sends the line; editor → Enter is a newline, Save saves; a
//     search field's Enter never reaches the machine. Both keyboards' confirm
//     key READS "Apply" (operator 2026-10-01). Escape stays E-Stop everywhere.
import { computed, reactive, watch } from "vue";
import { keypadState, closeKeypad, closeKeypadIf, hideKeypad, onKeypadOpen } from "./useNumberKeypad";

export { saveDraft, takeDraft, dropDraft, dropDrafts, clearDrafts } from "./useNumberKeypad";

export type SessionKind = "number" | "code" | "text";
/** The G-code editor's fixed owner id (App locks it with the tab). */
export const EDITOR_OWNER = "gcode-editor";
export type { KeyPage } from "./textKeyboardPages";

/** What the text keyboard can ask its owner to do. Optional entries mean
 *  the key is not offered (the rail cell stays, disabled). */
export interface TextTarget {
  insert(text: string): void;
  backspace(): void;
  /** Enter: send (MDI), newline (editor), close (plain text). */
  enter(): void;
  clear?(): void;
  moveCursor?(delta: -1 | 1): void;
  undo?(): void;
  redo?(): void;
  tab?(): void;
  /** Owner still connected, visible and writable. */
  canConfirm(): boolean;
  /** Owner mounted but hidden (tab switch)? false LOCKS the session. */
  isVisible?(): boolean;
  /** The element that takes focus back after an EXPLICIT close (the X key,
   *  Enter = done): the field, the editor's content — read before the
   *  session ends. Absent → the strip fallback of `returnFocusTo`. */
  focusEl?(): HTMLElement | null;
  /** The session ended (close, outside tap, owner gone) — no value passes. */
  onClose?(): void;
}

export interface TextSessionOpts {
  ownerId: string;
  kind: "code" | "text";
  /** Strip title: "MDI", "Editor · prog.ngc", "Description", … */
  context: string;
  target: TextTarget;
  /** The Enter key: "Apply" (MDI sends, a text field closes — one word in
   *  both keyboards, operator 2026-10-01) or "newline" (the editor's icon). */
  enterLabel?: "Apply" | "newline";
}

export const inputSession = reactive({
  kind: null as "code" | "text" | null,
  ownerId: "",
  context: "",
  page: "code" as import("./textKeyboardPages").KeyPage,
  shift: false,
  /** Owner hidden but mounted (tab switch): helper hidden, session kept. */
  locked: false,
  enterLabel: "Apply" as "Apply" | "newline",
  target: null as TextTarget | null,
  /** Bumped per open so the strip re-inits even for the same owner. */
  seq: 0,
  /** Test marker (UI-15a): the last owner whose helper the operator closed. */
  closedByUser: "",
});

/** Which helper the strip shows right now, if any. */
export const activeKind = computed<SessionKind | null>(() => {
  if (keypadState.open && !keypadState.locked) return "number";
  if (inputSession.kind && !inputSession.locked) return inputSession.kind;
  return null;
});

// ── Focus return after OK / Cancel (UI-I06) ──
// The number keypad hands focus back to the field that opened it. The
// field's OWN confirm closes its gate for fire()'s busy latch: the DOM
// `disabled` lands a render later and drops the focus the field just took
// (a disabled element cannot hold focus), so for the latch's duration the
// document has NO focused element — and the shortcut map reads an
// unfocused document as an operating position where Space is Cycle Start
// (review round 2: `touchoff` followed by `cycle_start`, 3 of 3, in the
// window between the latch's end and a fixed re-focus delay). The return
// is therefore a guarded TRANSITION: `focusReturn.pending` keeps the modal
// guard up (modalRegistry → nothing but E-Stop passes) from the close
// until focus has LANDED — on the field as soon as it can hold it again,
// on whatever the operator focused meanwhile (another owner is never
// robbed), or on the strip (tabindex -1) when the field is gone or not
// focusable (an offset cell) — decided per animation frame against the
// live DOM, never by a fixed delay, with a 2 s backstop.
export const focusReturn = reactive({ pending: false });
let _returnSeq = 0;
const FOCUS_RETURN_MAX_MS = 2000;
// Where a return that cannot land goes: the topmost dialog while one is open
// (modalRegistry registers it — this module never imports the registry),
// else the strip. Never `body`: an unfocused document is where Space is
// Cycle Start.
let _focusFallback: (() => HTMLElement | null) | null = null;
export function setFocusFallback(fn: () => HTMLElement | null): void { _focusFallback = fn; }
// A focus() call on a control that cannot take focus (disabled by its Gate)
// is silently ignored: only a verified landing counts (review UI-DI04).
function fallbackFocus(): void {
  const el = _focusFallback?.();
  if (el?.isConnected) { el.focus(); if (document.activeElement === el) return; }
  document.querySelector<HTMLElement>(".strip")?.focus();
}
function canHold(t: HTMLElement): boolean {
  return t.isConnected && t.offsetParent !== null && !t.matches(":disabled");
}
export function returnFocusTo(target: HTMLElement | null): void {
  const seq = ++_returnSeq;
  const started = performance.now();
  focusReturn.pending = true;
  const end = () => { if (seq === _returnSeq) focusReturn.pending = false; };
  // Take it at once when the field can hold it — the render that disables
  // it (busy latch) has not happened yet; the frame loop sees the drop.
  if (target && canHold(target)) target.focus();
  const tick = () => {
    if (seq !== _returnSeq) return;                        // a newer return took over
    const active = document.activeElement;
    const unfocused = !active || active === document.body || active === document.documentElement;
    if (!unfocused && active !== target) { end(); return; }   // the operator moved on
    if (!target || !target.isConnected) { if (unfocused) fallbackFocus(); end(); return; }
    if (canHold(target)) {
      if (active !== target) target.focus();
      if (document.activeElement !== target) fallbackFocus();  // not focusable (a table cell)
      end(); return;
    }
    if (performance.now() - started > FOCUS_RETURN_MAX_MS) { if (unfocused) fallbackFocus(); end(); return; }
    requestAnimationFrame(tick);                           // still settling (disabled / hidden)
  };
  requestAnimationFrame(tick);
}

/** True while ANY helper is up (number or text) or a focus return is in
 *  flight — the shortcut map lets nothing but E-Stop through then
 *  (modalRegistry). */
export const helperOpen = computed(() => activeKind.value !== null || focusReturn.pending);

function endText(reason?: string): void {
  const t = inputSession.target;
  inputSession.kind = null;
  inputSession.ownerId = "";
  inputSession.context = "";
  inputSession.target = null;
  inputSession.locked = false;
  inputSession.shift = false;
  if (reason) console.warn(`[input-session] closed: ${reason}`);
  t?.onClose?.();
}

export function openTextSession(opts: TextSessionOpts): void {
  // Exactly one helper: a number keypad gives way — its unconfirmed
  // expression is filed as its owner's draft (keepDraft) while the strip
  // unmounts, and comes back when that field is re-opened.
  if (keypadState.open) closeKeypad(true);
  if (inputSession.kind && inputSession.ownerId !== opts.ownerId) endText();
  inputSession.kind = opts.kind;
  inputSession.ownerId = opts.ownerId;
  inputSession.context = opts.context;
  inputSession.target = opts.target;
  inputSession.enterLabel = opts.enterLabel ?? "Apply";
  inputSession.page = opts.kind === "code" ? "code" : "abc";
  inputSession.shift = false;
  inputSession.locked = false;
  inputSession.seq++;
}

/** Close the text helper without confirming anything — the LEAVE paths
 *  (pointerdown outside, focus arriving outside, a switch): focus stays
 *  wherever the operator put it, never pulled back. */
export function closeTextSession(reason?: string, byUser = false): void {
  if (!inputSession.kind) return;
  if (byUser) inputSession.closedByUser = inputSession.ownerId;
  endText(reason);
}

/** The operator's EXPLICIT close (the X key). Activated by Tab + Enter/Space
 *  the key holds focus and unmounts with the strip: focus fell to `body`,
 *  the helper's modal guard fell with the session, and the next Space was
 *  Cycle Start (implementation review round 4, UI-I10). The owner's focus
 *  element is read BEFORE the session ends and handed to the same guarded
 *  transition the number keypad uses — a pointer close already holds focus
 *  on the field and ends at the first frame. */
export function closeTextSessionByOperator(reason?: string): void {
  if (!inputSession.kind) return;
  const el = inputSession.target?.focusEl?.() ?? null;
  inputSession.closedByUser = inputSession.ownerId;
  endText(reason);
  returnFocusTo(el);
}

/** Close only when `ownerId` owns the session (unmount, gate closed). */
export function closeTextSessionIf(ownerId: string, reason?: string): boolean {
  if (!inputSession.kind || inputSession.ownerId !== ownerId) return false;
  endText(reason);
  return true;
}

/** A dialog opened over `parent` (the dialog below it, or the panels): the
 *  input helper of a field INSIDE it PAUSES — never an owner end (design
 *  wave D2, UI-D06). The number keypad hides and files its entry as the
 *  owner's draft, the empty one included (`hideKeypad` = `closeKeypad(true)`,
 *  its onCancel runs, nothing is applied); a text session leaves the way an
 *  outside tap does (the text stays in the field's model, focus is not pulled
 *  back). `closeKeypadIf` / `closeTextSessionIf` stay reserved for a real
 *  context end — `closeKeypadIf` drops the draft even without an open
 *  session. Other owners' helpers are untouched, and the covered field is
 *  unreachable meanwhile through the topmost dialog's focus scope and its
 *  scrim, not through `locked` (the visibility poll rewrites that every
 *  300 ms). */
export function pauseInputIn(parent: Element | null, reason: string): void {
  if (!parent) return;
  if (keypadState.open && keypadState.trigger && parent.contains(keypadState.trigger)) hideKeypad(reason);
  const el = inputSession.target?.focusEl?.() ?? null;
  if (inputSession.kind && el && parent.contains(el)) closeTextSession(reason);
}

/** Hidden-but-mounted owner: keep the session, hide the helper. */
export function lockTextSessionIf(ownerId: string, locked: boolean): void {
  if (inputSession.kind && inputSession.ownerId === ownerId) inputSession.locked = locked;
}

export function isSessionOwner(ownerId: string): boolean {
  return (keypadState.open && keypadState.ownerId === ownerId)
    || (inputSession.kind !== null && inputSession.ownerId === ownerId);
}

// A number keypad opening ends any text session (one helper at a time).
onKeypadOpen(() => { if (inputSession.kind) endText(); });

// ── Keyboard glyph (non-touch opener, UI-15a) ──
// The focused text field's "Open keyboard" button, rendered ONCE by
// FloatingOverlays.vue at the field's right edge (fixed) — never inside
// MachineInput, which must stay a single-root component (UI-I07). It
// belongs to the owner's focus area (data-input-area).
export const inputGlyph = reactive({ ownerId: "", left: 0, top: 0, open: null as (() => void) | null });
export function placeInputGlyph(ownerId: string, anchor: HTMLElement): void {
  if (inputGlyph.ownerId !== ownerId) return;
  const r = anchor.getBoundingClientRect();
  inputGlyph.left = r.right - 2;
  inputGlyph.top = r.top + r.height / 2;
}
export function showInputGlyph(ownerId: string, anchor: HTMLElement, open: () => void): void {
  inputGlyph.ownerId = ownerId;
  inputGlyph.open = open;
  placeInputGlyph(ownerId, anchor);
}
export function hideInputGlyph(ownerId: string): void {
  if (inputGlyph.ownerId !== ownerId) return;
  inputGlyph.ownerId = "";
  inputGlyph.open = null;
}

// ── Focus area (UI-15a) ──
// Field, glyph and helper section carry data-input-area="<ownerId>".
// Leaving = a pointerdown OUTSIDE every input area (the generalised MDI
// outside handler — number keypad and text keyboard alike), or focus
// ARRIVING on an element outside the owner's area (a Tab out of the field
// or out of one of the keys, in either direction, including past the end of
// the document). Neither confirms anything.
//
// A pointerdown on ANOTHER owner's area is a SWITCH, not a leave: the click
// that follows opens the new session, which replaces the old one (its draft
// filed). Hiding on the pointerdown instead re-flowed the strip between
// finger-down and finger-up — the number keypad's owner section moves when
// the other sections come back — so the click landed on a different control.
// A pointer-driven focus move inside an input area is left to that rule too.
export function inArea(node: EventTarget | null, ownerId: string): boolean {
  const el = node as Element | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest(`[data-input-area="${CSS.escape(ownerId)}"]`);
}
function inAnyArea(node: EventTarget | null): boolean {
  const el = node as Element | null;
  return !!el && typeof el.closest === "function" && !!el.closest("[data-input-area]");
}

// A pointer interaction in progress (down … up/cancel): focus moves it
// causes are decided by the pointer rule, not by the focus rule.
let pointerActive = false;
let pointerTimer = 0;
function setPointerActive(on: boolean): void {
  pointerActive = on;
  clearTimeout(pointerTimer);
  if (on) pointerTimer = window.setTimeout(() => { pointerActive = false; }, 2000);  // lost pointerup backstop
}

function onDocPointerDown(e: PointerEvent): void {
  setPointerActive(true);
  if (inAnyArea(e.target)) return;   // this owner's area (operating) or another's (the click switches)
  if (keypadState.open && !keypadState.locked) hideKeypad("pointer down outside the input area");
  if (inputSession.kind && !inputSession.locked) closeTextSession("pointer down outside the input area", true);
}

function onDocFocusIn(e: FocusEvent): void {
  const t = e.target;
  if (pointerActive && inAnyArea(t)) return;   // pointer switch: the click decides
  if (keypadState.open && !keypadState.locked && !inArea(t, keypadState.ownerId)) {
    hideKeypad("focus left the input area");
  }
  if (inputSession.kind && !inputSession.locked && !inArea(t, inputSession.ownerId)) {
    closeTextSession("focus left the input area", true);
  }
}

// ── Owner visibility (hidden-but-mounted → lock) ──
// DOM visibility is not reactive, so it is polled while a session is open:
// a number owner through its trigger element (removed from the document →
// the owner is gone, the session ends), a text owner through
// target.isVisible(). App's tab watcher locks the MDI/editor sessions at
// once; this poll is the rule every other owner gets for free.
const POLL_MS = 300;
let pollTimer = 0;
function pollOwners(): void {
  if (keypadState.open) {
    const t = keypadState.trigger;
    if (t && !t.isConnected) {
      closeKeypadIf(keypadState.ownerId, "owner removed from the document");
    } else {
      keypadState.locked = !!t && t.offsetParent === null;
      keypadState.probeTick++;
    }
  }
  if (inputSession.kind && inputSession.target?.isVisible) {
    inputSession.locked = !inputSession.target.isVisible();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", onDocPointerDown, { capture: true, passive: true });
  document.addEventListener("pointerup", () => setPointerActive(false), { capture: true, passive: true });
  document.addEventListener("pointercancel", () => setPointerActive(false), { capture: true, passive: true });
  window.addEventListener("blur", () => setPointerActive(false));
  document.addEventListener("focusin", onDocFocusIn, true);
  watch(() => keypadState.open || inputSession.kind !== null, (on) => {
    clearInterval(pollTimer);
    if (on) pollTimer = window.setInterval(pollOwners, POLL_MS);
  }, { immediate: true });
}

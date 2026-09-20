// The unified INPUT SESSION (WP8, UI-15): exactly one on-screen helper at a
// time — the number keypad (useNumberKeypad.ts, kept as the number facade)
// or the text/code keyboard (TextKeypadStrip.vue) — owned by ONE target.
//
// Rules (review table, all adopted):
//   • Selecting a field opens the layout for ITS kind; the field is the
//     owner and its name + unit are visible in the strip title.
//   • Text ↔ number: owner and layout switch directly; no old mode stays
//     behind. Number A → number B: A is NOT confirmed, its draft stays with
//     A (drafts) and comes back marked "draft" when A is re-opened.
//   • Operating the keys is not leaving (pointerdown.prevent). Leaving =
//     pointerdown outside the FOCUS AREA (field + glyph + strip section,
//     all tagged data-input-area="<ownerId>") or focus moving out of it,
//     or Close: hide, confirm nothing, send nothing. A bare DOM blur is not
//     a close criterion, and opening is NEVER bound to focus (UI-15a).
//   • Owner unmounted / gate closed → the session ends; a hidden-but-mounted
//     owner (tab switch) LOCKS it: the helper hides, the draft stays.
//   • Confirmation stays target-specific: number → OK/valid Enter; MDI →
//     Send; editor → Enter is a newline, Save saves; a search field's Enter
//     never reaches the machine. Escape stays E-Stop everywhere.
import { computed, reactive } from "vue";
import { keypadState, closeKeypad, onKeypadOpen } from "./useNumberKeypad";

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
  /** The session ended (close, outside tap, owner gone) — no value passes. */
  onClose?(): void;
}

export interface TextSessionOpts {
  ownerId: string;
  kind: "code" | "text";
  /** Strip title: "MDI", "Editor · prog.ngc", "Description", … */
  context: string;
  target: TextTarget;
  /** Label of the Enter key: "Send" (MDI), "newline" (editor icon), "OK". */
  enterLabel?: "Send" | "newline" | "OK";
}

export const inputSession = reactive({
  kind: null as "code" | "text" | null,
  ownerId: "",
  context: "",
  page: "code" as import("./textKeyboardPages").KeyPage,
  shift: false,
  /** Owner hidden but mounted (tab switch): helper hidden, session kept. */
  locked: false,
  enterLabel: "OK" as "Send" | "newline" | "OK",
  target: null as TextTarget | null,
  /** Bumped per open so the strip re-inits even for the same owner. */
  seq: 0,
  /** Test marker (UI-15a): the last owner whose helper the operator closed. */
  closedByUser: "",
});

/** Which helper the strip shows right now, if any. */
export const activeKind = computed<SessionKind | null>(() => {
  if (keypadState.open) return "number";
  if (inputSession.kind && !inputSession.locked) return inputSession.kind;
  return null;
});

/** True while ANY helper is up (number or text) — the shortcut map lets
 *  nothing but E-Stop through then (modalRegistry). */
export const helperOpen = computed(() => keypadState.open || (inputSession.kind !== null && !inputSession.locked));

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
  // Exactly one helper: a number keypad gives way (its draft stays with
  // its owner — NumberKeypadStrip files it before the state is replaced).
  if (keypadState.open) closeKeypad();
  if (inputSession.kind && inputSession.ownerId !== opts.ownerId) endText();
  inputSession.kind = opts.kind;
  inputSession.ownerId = opts.ownerId;
  inputSession.context = opts.context;
  inputSession.target = opts.target;
  inputSession.enterLabel = opts.enterLabel ?? (opts.kind === "code" ? "Send" : "OK");
  inputSession.page = opts.kind === "code" ? "code" : "abc";
  inputSession.shift = false;
  inputSession.locked = false;
  inputSession.seq++;
}

/** Close the text helper without confirming anything. */
export function closeTextSession(reason?: string, byUser = false): void {
  if (!inputSession.kind) return;
  if (byUser) inputSession.closedByUser = inputSession.ownerId;
  endText(reason);
}

/** Close only when `ownerId` owns the session (unmount, gate closed). */
export function closeTextSessionIf(ownerId: string, reason?: string): boolean {
  if (!inputSession.kind || inputSession.ownerId !== ownerId) return false;
  endText(reason);
  return true;
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

// ── Focus area (UI-15a) ──
// Field, glyph and helper section carry data-input-area="<ownerId>". A
// pointerdown OUTSIDE the current owner's area closes the text helper (the
// generalised MDI outside handler); a focusout whose relatedTarget lies
// outside it too. Neither confirms anything.
export function inArea(node: EventTarget | null, ownerId: string): boolean {
  const el = node as Element | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest(`[data-input-area="${CSS.escape(ownerId)}"]`);
}

let _pointerDownInside = false;
function onDocPointerDown(e: PointerEvent): void {
  if (!inputSession.kind) { _pointerDownInside = false; return; }
  _pointerDownInside = inArea(e.target, inputSession.ownerId);
  if (!_pointerDownInside && !inputSession.locked) closeTextSession("pointer down outside the input area", true);
}

/** Owner fields call this from @focusout: focus left the area → close.
 *  A null relatedTarget right after a pointerdown INSIDE the area (the
 *  helper's keys prevent focus) is not a leave. */
export function onOwnerFocusOut(ownerId: string, e: FocusEvent): void {
  if (!inputSession.kind || inputSession.ownerId !== ownerId) return;
  const rel = e.relatedTarget;
  if (rel == null) { if (_pointerDownInside) return; return; }  // null: nothing focusable took focus — the pointer rule decides
  if (!inArea(rel, ownerId)) closeTextSession("focus left the input area", true);
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", onDocPointerDown, { capture: true, passive: true });
}

// ── Number drafts (UI-15) ──
// A number owner's unconfirmed expression, kept while another field is
// edited and offered back — visibly as a draft — when it is re-opened.
// Short-lived: dropped on confirm, cancel, owner unmount and disconnect.
const _drafts = new Map<string, string>();
export function saveDraft(ownerId: string, expr: string): void {
  if (ownerId && expr.trim()) _drafts.set(ownerId, expr); else _drafts.delete(ownerId);
}
export function takeDraft(ownerId: string): string | null {
  const d = _drafts.get(ownerId);
  return d ?? null;
}
export function dropDraft(ownerId: string): void { _drafts.delete(ownerId); }
export function clearDrafts(): void { _drafts.clear(); }

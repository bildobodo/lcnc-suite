// Module-level singleton — shared across all components that import this.
// No provide/inject needed: the module itself is the shared instance.
//
// Owner model (WP0/WP6, UI-11 + UI-13): every keypad session belongs to ONE
// owner (the field that opened it). The owner's constraints ride along, the
// owner can revoke the session (unmount, gate closed) and confirm() asks the
// owner's canConfirm() — fresh, at confirm time — before delivering a value:
// an old callback is never applied to a target that no longer exists, is
// hidden or is no longer writable.
//
// Lifecycle (WP8, UI-15): the session LOCKS while its owner is hidden but
// mounted (inputSession.ts polls the trigger's visibility — the strip hides,
// the expression stays) and HIDES without confirming when the pointer or
// the focus leaves the input area; the unconfirmed expression is then filed
// as the owner's DRAFT and offered back, marked, on re-open.
import { reactive } from 'vue';
import type { EntryConstraints } from './mathEval';

export interface KeypadOpts {
  value: string | number | null;
  /** Field name shown in the keypad header (e.g. "Diameter"). */
  label?: string;
  /** Full target context for the readout ("T12 · Diameter · mm"). */
  context?: string;
  /** Owner identity — a later closeKeypadIf(ownerId) only closes THIS session. */
  ownerId?: string;
  /** Field contract: min/max/integer, refused (never clamped) on confirm. */
  constraints?: EntryConstraints | null;
  /** Owner veto at confirm time (target disabled/removed) — the keypad cancels. */
  canConfirm?: () => boolean;
  /** The element that opened the keypad: focus returns to it after OK /
   *  Cancel, and its visibility drives the session lock. */
  trigger?: HTMLElement | null;
  onConfirm: (value: number) => void;
  onCancel?: () => void;
}

export const keypadState = reactive({
  open: false,
  /** Owner hidden but mounted (tab switch): strip hidden, session kept. */
  locked: false,
  label: '',
  context: '',
  ownerId: '',
  constraints: null as EntryConstraints | null,
  canConfirm: null as (() => boolean) | null,
  initial: '',
  // Incremented on every openKeypad() call so the dialog can re-init even when
  // the new field's value matches the old one (e.g. switching between zeros).
  seq: 0,
  // Source input the keypad currently targets — bound to .keypad-active class
  // so the input shows a focus outline for the lifetime of the dialog.
  trigger: null as HTMLElement | null,
  onConfirm: null as ((v: number) => void) | null,
  onCancel: null as (() => void) | null,
  /** Set by closeKeypad(keepDraft = true): the strip files its unconfirmed
   *  expression as the owner's draft while it unmounts. */
  keepDraft: false,
  /** Bumped by the visibility poll so the strip's owner-veto readout
   *  re-evaluates — DOM visibility (offsetParent) is not reactive. */
  probeTick: 0,
  /** Bumped by refocusKeypad(): the strip takes the focus back. */
  focusTick: 0,
});

let _ownerSeq = 0;
/** Generate a unique owner id for a field instance. */
export function newKeypadOwnerId(prefix = 'field'): string {
  return `${prefix}-${++_ownerSeq}`;
}

// inputSession.ts registers here so a number keypad opening ends any text
// helper (one helper at a time) — a callback, not an import, because that
// module imports this one.
let _onOpen: (() => void) | null = null;
export function onKeypadOpen(cb: () => void): void { _onOpen = cb; }

export function openKeypad(opts: KeypadOpts): void {
  _onOpen?.();
  keypadState.label = opts.label ?? '';
  keypadState.context = opts.context ?? '';
  keypadState.ownerId = opts.ownerId ?? newKeypadOwnerId('anon');
  keypadState.constraints = opts.constraints ?? null;
  keypadState.canConfirm = opts.canConfirm ?? null;
  keypadState.initial = opts.value != null ? String(opts.value) : '';
  keypadState.trigger = opts.trigger ?? null;
  keypadState.onConfirm = opts.onConfirm;
  keypadState.onCancel = opts.onCancel ?? null;
  keypadState.keepDraft = false;
  keypadState.locked = false;
  keypadState.seq++;
  keypadState.open = true;
}

/** The owner was pressed again while its session is open (a label tap, Enter
 *  on the field Tab reached): the keypad takes the focus back — it holds
 *  the physical keyboard, a read-only field swallowed every typed digit
 *  (operator 2026-09-29). */
export function refocusKeypad(): void {
  if (keypadState.open && !keypadState.locked) keypadState.focusTick++;
}

/** End the session. `keepDraft` = the owner's unconfirmed expression is
 *  filed as a draft (pointer/focus left, a text helper took over); false =
 *  confirmed, cancelled or the owner ended it — nothing to offer back. */
export function closeKeypad(keepDraft = false): void {
  keypadState.keepDraft = keepDraft;
  keypadState.open = false;
  keypadState.locked = false;
  keypadState.ownerId = '';
  keypadState.constraints = null;
  keypadState.canConfirm = null;
  keypadState.trigger = null;
  keypadState.onConfirm = null;
  keypadState.onCancel = null;
}

/** Hide without confirming (the pointer or the focus left the input area,
 *  UI-15a): the draft stays with its owner, onCancel runs, no value passes. */
export function hideKeypad(reason?: string): void {
  if (!keypadState.open) return;
  if (reason) console.warn(`[keypad] hidden: ${reason}`);
  const onCancel = keypadState.onCancel;
  closeKeypad(true);
  onCancel?.();
}

/**
 * The owner's rule ended its context (unmounted, its gate closed, its
 * dialog dismissed, removed from the document): its DRAFT is dropped
 * whether or not it holds the keypad right now — a filed draft must not
 * outlive the context that admitted it (implementation review round 2,
 * UI-I05 B) — and the keypad closes only when THIS owner holds it. A keypad
 * opened for a different field stays. Runs the owner's onCancel so pending
 * state clears. Returns whether a session was closed.
 */
export function closeKeypadIf(ownerId: string, reason?: string): boolean {
  _drafts.delete(ownerId);
  if (!keypadState.open || keypadState.ownerId !== ownerId) return false;
  if (reason) console.warn(`[keypad] closed: ${reason}`);
  const onCancel = keypadState.onCancel;
  closeKeypad(false);
  onCancel?.();
  return true;
}

// ── Number drafts (UI-15) ──
// A number owner's unconfirmed expression, kept while another field is
// edited or the helper was hidden, and offered back — visibly as a draft —
// when the owner is re-opened. Short-lived: dropped on confirm, cancel,
// owner end (unmount, gate closed, disconnect).
const _drafts = new Map<string, string>();
/** File the owner's unconfirmed expression. An EMPTY expression is a draft
 *  too: it is the entry after "C" — the value 0, shown as "= 0" — not "no
 *  draft" (implementation review round 2, UI-I05 A). */
export function saveDraft(ownerId: string, expr: string): void {
  if (ownerId) _drafts.set(ownerId, expr);
}
/** The owner's draft, or null when none is filed ('' is a filed draft). */
export function takeDraft(ownerId: string): string | null {
  return _drafts.get(ownerId) ?? null;
}
export function dropDraft(ownerId: string): void { _drafts.delete(ownerId); }
/** Drop every draft whose owner matches — a panel ending all its cells'
 *  contexts at once (its gate closed, it unmounted). */
export function dropDrafts(match: (ownerId: string) => boolean): void {
  for (const id of [..._drafts.keys()]) if (match(id)) _drafts.delete(id);
}
export function clearDrafts(): void { _drafts.clear(); }
/** Test/diagnostics: the owners with a filed draft. */
export function draftOwners(): string[] { return [..._drafts.keys()]; }

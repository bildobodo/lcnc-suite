// Module-level singleton — shared across all components that import this.
// No provide/inject needed: the module itself is the shared instance.
//
// Owner model (WP0/WP6, UI-11 + UI-13): every keypad session belongs to ONE
// owner (the field that opened it). The owner's constraints ride along, the
// owner can revoke the session (unmount, gate closed) and confirm() asks the
// owner's canConfirm() before delivering a value — an old callback is never
// applied to a target that no longer exists or is no longer writable.
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
  trigger?: HTMLElement | null;
  onConfirm: (value: number) => void;
  onCancel?: () => void;
}

export const keypadState = reactive({
  open: false,
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
});

let _ownerSeq = 0;
/** Generate a unique owner id for a field instance. */
export function newKeypadOwnerId(prefix = 'field'): string {
  return `${prefix}-${++_ownerSeq}`;
}

export function openKeypad(opts: KeypadOpts): void {
  keypadState.label = opts.label ?? '';
  keypadState.context = opts.context ?? '';
  keypadState.ownerId = opts.ownerId ?? newKeypadOwnerId('anon');
  keypadState.constraints = opts.constraints ?? null;
  keypadState.canConfirm = opts.canConfirm ?? null;
  keypadState.initial = opts.value != null ? String(opts.value) : '';
  keypadState.trigger = opts.trigger ?? null;
  keypadState.onConfirm = opts.onConfirm;
  keypadState.onCancel = opts.onCancel ?? null;
  keypadState.seq++;
  keypadState.open = true;
}

export function closeKeypad(): void {
  keypadState.open = false;
  keypadState.ownerId = '';
  keypadState.constraints = null;
  keypadState.canConfirm = null;
  keypadState.trigger = null;
  keypadState.onConfirm = null;
  keypadState.onCancel = null;
}

/**
 * Close the keypad only if `ownerId` owns the current session (owner
 * unmounted, its gate closed, its dialog dismissed). A keypad opened for a
 * DIFFERENT field stays. Runs the owner's onCancel so pending state clears.
 */
export function closeKeypadIf(ownerId: string, reason?: string): boolean {
  if (!keypadState.open || keypadState.ownerId !== ownerId) return false;
  if (reason) console.warn(`[keypad] closed: ${reason}`);
  keypadState.onCancel?.();
  closeKeypad();
  return true;
}

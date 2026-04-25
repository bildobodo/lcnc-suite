// Module-level singleton — shared across all components that import this.
// No provide/inject needed: the module itself is the shared instance.
import { reactive } from 'vue';

export interface KeypadOpts {
  value: string | number | null;
  label?: string;
  onConfirm: (value: number) => void;
  onCancel?: () => void;
}

export const keypadState = reactive({
  open: false,
  label: '',
  initial: '',
  onConfirm: null as ((v: number) => void) | null,
  onCancel: null as (() => void) | null,
});

export function openKeypad(opts: KeypadOpts): void {
  keypadState.label = opts.label ?? '';
  keypadState.initial = opts.value != null ? String(opts.value) : '';
  keypadState.onConfirm = opts.onConfirm;
  keypadState.onCancel = opts.onCancel ?? null;
  keypadState.open = true;
}

export function closeKeypad(): void {
  keypadState.open = false;
  keypadState.onConfirm = null;
  keypadState.onCancel = null;
}

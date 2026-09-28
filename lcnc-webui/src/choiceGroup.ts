// Shared types of ChoiceGroup / MachineChoice (operator point P7).
import type { InputType } from "./machineControls";

export interface ChoiceOption<T> {
  value: T;
  label: string;
  gate: InputType;
  /** The caller's own "unavailable" on top of the gate (a reserved fixture). */
  disabled?: boolean;
  reason?: string;
  title?: string;
}

/** How long a requested machine choice may stay "pending" before it is
 *  said to be not confirmed (never "failed"; no retry — Codex R22). */
export const PENDING_MS = 5000;

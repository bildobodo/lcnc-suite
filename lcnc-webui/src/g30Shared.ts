// The stored G30 as last CONFIRMED in this tab (Codex R50 VP-I18): Probing ›
// Toolsetter's confirmed read or save puts its values here, and the 3D
// view's tool-change pin takes them at once. The pin's own read (GET /g30,
// on every busy→idle edge) stays an extra trigger — a short parameter
// assignment need not show as busy in any status packet, and the form said
// "G30 saved — confirmed by LinuxCNC" while the pin stood at the old place.
import { shallowRef } from "vue";

export interface G30Confirmed {
  values: Record<string, number | null>;
  /** Bumped per confirmation: the same values confirmed twice are two events. */
  seq: number;
}

export const g30Confirmed = shallowRef<G30Confirmed | null>(null);

let _seq = 0;

/** A confirmed read or save: the values LinuxCNC holds now. */
export function noteG30Confirmed(values: Record<string, number | null> | undefined): void {
  if (!values) return;
  g30Confirmed.value = { values: { ...values }, seq: ++_seq };
}

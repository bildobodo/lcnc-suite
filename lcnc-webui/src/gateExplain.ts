// ONE explanation path for a dimmed control (UX-09). MachineBtn had it
// (U-06 / R-05: a disabled <button> swallows pointer events, so the reason
// lived in a denial the button could not send — a wrapper carried the title,
// a tap and Enter/Space put it in the message center); the input, select,
// slider, toggle and radio controls only set `disabled` and stayed mute.
// The rule is the same for every control: the reason is the caller's own
// (while IT disables the control) or the gate's from the reason map, and
// it is offered only while ARMED — disarmed dims the whole UI and Arm is
// the one obvious next step, an explanation on every control would be
// noise. `explain()` puts it in the message center (touch has no hover),
// `onKeydown` makes Enter/Space say it and stops Space from reaching the
// shortcut map (Cycle Start), `label` names the affordance for a screen
// reader. Label-rooted controls carry the affordance on their root; an
// input-rooted control cannot wrap (its class selectors would move off the
// input) and cannot be focused while disabled — it explains on pointerdown,
// which Chromium ≥ 116 and Firefox ≥ 105 deliver to disabled controls.
import { computed, type ComputedRef } from "vue";
import { armed, pushMessage } from "./lcncWs";
import { OPERATOR_DISPLAY } from "./lcnc";
import { usePermissionReasons, explainKeydown, type Permissions } from "./permissions";

export interface GateExplain {
  /** The text, whenever there is one (caller's reason, else the gate's). */
  reason: ComputedRef<string | undefined>;
  /** Disabled + a reason + armed: the affordance is offered. */
  active: ComputedRef<boolean>;
  /** "Why is this unavailable? …" — the accessible name of the affordance. */
  label: ComputedRef<string | undefined>;
  explain(): void;
  onKeydown(e: KeyboardEvent): void;
}

export function useGateExplain(opts: {
  gate: () => keyof Permissions;
  disabled: () => boolean;
  /** The caller's own reason while IT disables the control. */
  reason?: () => string | undefined;
}): GateExplain {
  const reasons = usePermissionReasons();
  const reason = computed(() => opts.reason?.() ?? reasons.value[opts.gate()]);
  const active = computed(() => opts.disabled() && !!reason.value && armed.value);
  const label = computed(() => (reason.value ? `Why is this unavailable? ${reason.value}` : undefined));
  function explain() { if (active.value && reason.value) pushMessage(OPERATOR_DISPLAY, reason.value); }
  function onKeydown(e: KeyboardEvent) { if (active.value) explainKeydown(e, explain); }
  return { reason, active, label, explain, onKeydown };
}

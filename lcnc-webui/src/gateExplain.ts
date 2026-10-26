// ONE explanation path for a dimmed control (UX-09). MachineBtn had it
// (U-06 / R-05: a disabled <button> swallows pointer events, so the reason
// lived in a denial the button could not send — a wrapper carried the title,
// a tap and Enter/Space put it in the message center); the input, select,
// slider, toggle and radio controls only set `disabled` and stayed mute.
// The rule is the same for every control: the reason is the caller's own
// (while IT disables the control), the gate's from the reason map, or —
// for a control a closed inner <Gate> disables although its own gate is
// open — that Gate's (GATE_SCOPE_KEY). It is offered to every client, the
// disarmed one too: since button gates package C there is no outer armed
// fieldset that dims everything — a dimmed control is a real lock, and
// "Not armed — press Arm" is its reason (BG-16). `explain()` tells it AT the control — the transient hint
// (btnHint.ts), placed inside the window, closed by the next touch — and
// nowhere else: the message log is reserved for machine information (design
// wave D1, UI-K18: what a touch triggers answers where the finger is;
// operator decisions 2026-09-23 and 2026-09-24). `onKeydown` makes Enter/Space say it and stops Space from reaching the
// shortcut map (Cycle Start), `label` names the affordance for a screen
// reader. Label-rooted controls carry the affordance on their root; an
// input-rooted control cannot wrap (its class selectors would move off the
// input) and cannot be focused while disabled — it explains on pointerdown,
// which Chromium ≥ 116 and Firefox ≥ 105 deliver to disabled controls.
import { computed, inject, type ComputedRef, type InjectionKey } from "vue";
import { showBtnHint } from "./btnHint";
import { usePermissionReasons, explainKeydown, type Permissions } from "./permissions";

/** The nearest enclosing <Gate> that is CLOSED (its gate name), or null —
 *  provided by Gate.vue: a fieldset disables its form controls without
 *  telling them, so a control inside one asks here for the reason. */
export const GATE_SCOPE_KEY = Symbol("gateScope") as InjectionKey<ComputedRef<keyof Permissions | null>>;

export interface GateExplain {
  /** The text, whenever there is one (caller's reason, else the gate's). */
  reason: ComputedRef<string | undefined>;
  /** Disabled (by itself or a closed enclosing Gate) + a reason: the
   *  affordance is offered. */
  active: ComputedRef<boolean>;
  /** "Why is this unavailable? …" — the accessible name of the affordance. */
  label: ComputedRef<string | undefined>;
  /** Tell the reason at `at` (the event's control, or an element). */
  explain(at?: Event | HTMLElement | null): void;
  onKeydown(e: KeyboardEvent): void;
}

function anchorOf(at?: Event | HTMLElement | null): HTMLElement | null {
  if (at instanceof HTMLElement) return at;
  const t = at?.currentTarget ?? at?.target ?? null;
  return t instanceof HTMLElement ? t : null;
}

/** The one way a reason is told (also for controls a composable cannot
 *  reach, e.g. a v-for of radios): only AT the control — never in the
 *  message log, which is reserved for machine information (operator, D1
 *  live look 2026-09-24). Disarmed too (BG-16). */
export function explainAt(at: Event | HTMLElement | null | undefined, reason: string | undefined): void {
  if (!reason) return;
  showBtnHint(anchorOf(at), reason);
}

export function useGateExplain(opts: {
  gate: () => keyof Permissions;
  disabled: () => boolean;
  /** The caller's own reason while IT disables the control. */
  reason?: () => string | undefined;
}): GateExplain {
  const reasons = usePermissionReasons();
  const scope = inject(GATE_SCOPE_KEY, null);
  const scopeGate = () => scope?.value ?? null;
  const reason = computed(() => {
    const own = opts.reason?.() ?? reasons.value[opts.gate()];
    if (own) return own;
    const g = scopeGate();
    return g ? reasons.value[g] : undefined;
  });
  const active = computed(() => (opts.disabled() || scopeGate() != null) && !!reason.value);
  const label = computed(() => (reason.value ? `Why is this unavailable? ${reason.value}` : undefined));
  function explain(at?: Event | HTMLElement | null) { if (active.value) explainAt(at, reason.value); }
  function onKeydown(e: KeyboardEvent) { if (active.value) explainKeydown(e, () => explain(e)); }
  return { reason, active, label, explain, onKeydown };
}

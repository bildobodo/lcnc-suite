import { inject, type ComputedRef } from "vue";

/** Machine state inputs for permission evaluation */
export type MachineState = {
  armed: boolean;
  isEstop: boolean;
  isEnabled: boolean;
  isHomed: boolean;
  isIdle: boolean;
  isRunning: boolean;
  isPaused: boolean;
  busy: boolean;
  hasFile: boolean;
  eoffsetEnabled: boolean;
};

/** Permission classes — each maps to a set of buttons */
export type Permissions = {
  /** idle: machine on and idle (home, unhome, zero, G5x, file ops) */
  idle: boolean;
  /** jog: can jog axes (idle + homed, no busy gate for hold-to-move) */
  jog: boolean;
  /** override: can adjust feed/spindle/rapid overrides (works during execution) */
  override: boolean;
  /** ready: idle + homed (MDI, cycle start, spindle direction, coolant) */
  ready: boolean;
  /** pause: can pause a running program */
  pause: boolean;
  /** resume: can resume a paused program */
  resume: boolean;
  /** step: can single-step (ready to start OR paused to continue) */
  step: boolean;
  /** abort: can abort/stop */
  abort: boolean;
  /** probe: ready + no eoffset (probing with comp active contaminates results) */
  probe: boolean;
  /** zero: idle + no eoffset (zeroing with comp active bakes offset into G5x) */
  zero: boolean;
  /** safety: armed + estop cleared — for Machine On/Off (doesn't require enabled) */
  safety: boolean;
  /** armed: client is armed — outer content gate, allows navigation during E-Stop */
  armed: boolean;
  /** always: unconditional — only for Arm and E-Stop */
  always: boolean;
};

/** Evaluate all permission classes from machine state — single source of truth */
export function evaluatePermissions(s: MachineState): Permissions {
  const base = s.armed && !s.isEstop && s.isEnabled;
  return {
    idle:     base && s.isIdle && !s.busy,
    jog:      base && s.isIdle && s.isHomed,
    override: base && !s.busy,
    ready:    base && s.isIdle && !s.busy && s.isHomed,
    pause:    base && s.isRunning && !s.isPaused,
    resume:   base && s.isPaused,
    step:     base && ((s.isIdle && !s.busy && s.isHomed) || s.isPaused),
    abort:    base,
    probe:    base && s.isIdle && !s.busy && s.isHomed && !s.eoffsetEnabled,
    zero:     base && s.isIdle && !s.busy && !s.eoffsetEnabled,
    safety:   s.armed && !s.isEstop,
    armed:    s.armed,
    always:   true,
  };
}

/** Valid gate names — derived from evaluatePermissions, cannot drift */
const _dummy: MachineState = {
  armed: false, isEstop: false, isEnabled: false, isHomed: false,
  isIdle: false, isRunning: false, isPaused: false, busy: false,
  hasFile: false, eoffsetEnabled: false,
};
export const VALID_GATES: ReadonlySet<string> =
  new Set(Object.keys(evaluatePermissions(_dummy)).filter(k => k !== 'always'));

/** Injection key for provide/inject */
export const PERMISSIONS_KEY = Symbol("permissions") as InjectionKey<ComputedRef<Permissions>>;

import type { InjectionKey } from "vue";

/** Composable: inject permissions from ancestor provider */
export function usePermissions(): ComputedRef<Permissions> {
  const perms = inject(PERMISSIONS_KEY);
  if (!perms) throw new Error("usePermissions() called without provider — ensure App.vue provides PERMISSIONS_KEY");
  return perms;
}

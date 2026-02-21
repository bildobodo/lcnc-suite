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
  /** abort: can abort/stop */
  abort: boolean;
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
    abort:    s.armed,
  };
}

/** Injection key for provide/inject */
export const PERMISSIONS_KEY = Symbol("permissions") as InjectionKey<ComputedRef<Permissions>>;

import type { InjectionKey } from "vue";

/** Composable: inject permissions from ancestor provider */
export function usePermissions(): ComputedRef<Permissions> {
  const perms = inject(PERMISSIONS_KEY);
  if (!perms) throw new Error("usePermissions() called without provider — ensure App.vue provides PERMISSIONS_KEY");
  return perms;
}

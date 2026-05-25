import { inject, type ComputedRef } from "vue";

/**
 * Anti-desync principle for `isEstop` / `isEnabled`:
 *
 *   These two MachineState booleans must come from the MERGED truth of
 *   LinuxCNC's task state AND the HAL safety chain (iocontrol.0.emc-enable-in).
 *   `STAT.estop` / `STAT.enabled` alone can lie: iocontrol drives task_state
 *   transitions via EDGE detection on emc-enable-in, so a chain that was
 *   already LOW at command time is silently missed (issue #14) — task ends
 *   up in STATE_ESTOP_RESET / STATE_ON with the machine still HAL-locked.
 *
 *   Every other STAT boolean (inpos, probing, probe_tripped, flood, mist,
 *   homed, …) is either level-polled by the motion controller, has no HAL
 *   counterpart, or is an output command — none of them have the iocontrol
 *   edge-detection failure mode and STAT alone is safe.
 *
 *   The rule for any future STAT-derived boolean: if its value is gated by
 *   a HAL input pin via iocontrol's NML pump, it needs the same merged-
 *   truth treatment. If not, STAT is fine. The merge happens at the
 *   App.vue computed seam (isEstop / isEnabled); this layer just consumes
 *   the sharpened booleans, no special-casing here.
 */

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
  /** setup: armed + estop cleared + idle (admin ops that don't need machine enabled) */
  setup: boolean;
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
    setup:    s.armed && !s.isEstop && s.isIdle && !s.busy,
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

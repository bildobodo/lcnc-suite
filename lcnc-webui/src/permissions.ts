import { inject, type ComputedRef, type InjectionKey } from "vue";

/**
 * Permission classes — which controls are enabled in which machine state.
 *
 * The POLICY now lives on the backend (issue #19). `gateway.py` computes these
 * classes from machine state — `command_policy.evaluate_permissions()`, the
 * mirror of what this file used to compute — and ships them in every status
 * payload as `status.data.permissions`. This module no longer re-derives the
 * policy; it only applies the two genuinely CLIENT-LOCAL terms the backend
 * cannot observe:
 *
 *   - `armed` — this client's server-authoritative arming. ANDed into every
 *     gate except `always` (Arm / E-Stop stay reachable while disarmed).
 *   - `busy`  — a per-tab debounce while a command settles. ANDed as `!busy`
 *     into the gates that carried a top-level `!busy` term in the old formula.
 *
 * The backend computes with `armed=true` and without `busy` (the status payload
 * is a single shared broadcast — `gateway.py:315`), so the overlay below
 * reproduces the previous `evaluatePermissions` output. The estop/enabled
 * HAL-merge that used to live here (issue #14) now lives in the backend
 * `_policy_state_from_payload`. See REFACTOR_PLAN.md (WS1).
 */

/** Permission classes — each maps to a set of buttons */
export type Permissions = {
  /** idle: machine on and idle (home, unhome, zero, G5x, file ops) */
  idle: boolean;
  /** jog: can jog axes (idle + homed) */
  jog: boolean;
  /** override: feed/spindle/rapid overrides (works during execution) */
  override: boolean;
  /** ready: idle + homed (MDI, spindle direction, coolant) */
  ready: boolean;
  /** run: ready + the kinematics-runnable rule — Cycle Start / run-from-line.
   *  Plane (TOOL) kinematics without its plane, or with an operator fixture
   *  selected (what a program's M2 leaves behind: G54 restored, kins type
   *  not), must not start a program in the tilted frame. Backend:
   *  command_policy.kins_runnable. */
  run: boolean;
  /** pause: can pause a running program */
  pause: boolean;
  /** resume: can resume a paused program */
  resume: boolean;
  /** step: single-step (ready to start OR paused to continue) */
  step: boolean;
  /** abort: can abort/stop */
  abort: boolean;
  /** probe: ready + no eoffset (probing with comp active contaminates) */
  probe: boolean;
  /** zero: idle + no eoffset (zeroing with comp active bakes offset into G5x) */
  zero: boolean;
  /** touchoff: probe + the kins-mode × fixture rule for LINEAR letters —
   *  identity/TCP into G54–G58 (TCP only with the table at A=0), Plane mode
   *  only with the plane active and G59 selected (routed to the remap, which
   *  writes G54 through the plane). G59–G59.3 are the TWP remap's scratch
   *  rows and never a touch-off target. Backend: command_policy.touchoff_route. */
  touchoff: boolean;
  /** touchoffRotary: probe + Machine (identity) jog frame + G54 — a rotary
   *  offset under TCP/Plane kinematics displaces the orient move. */
  touchoffRotary: boolean;
  /** twpCapture: probe + the Capture-plane admission rule — TWP machine,
   *  G54 active, NO plane defined (refuse, never silently discard — user
   *  decision 2026-08-31), no rotary/G92 offsets. One button: G69 → G68.3
   *  at the tool tip → no-move G53.1 P0. Backend: twp_capture_check. */
  twpCapture: boolean;
  /** surfaceComp: probe + every rotary parked at zero — may START surface-map
   *  work (scan a new map, switch compensation ON). The map is a machine-Z
   *  shim applied after kinematics, valid only with the tool normal to the
   *  mapped surface and the grid aligned to the work. NOT the gate on the
   *  compensation toggle itself: turning comp OFF while tilted is the safe
   *  direction and stays available under `ready`. */
  surfaceComp: boolean;
  /** safety: armed + estop cleared — Machine On/Off (no enabled needed) */
  safety: boolean;
  /** setup: armed + estop cleared + idle (admin ops, no enabled needed) */
  setup: boolean;
  /** armed: client is armed — outer content gate, allows nav during E-Stop */
  armed: boolean;
  /** always: unconditional — only for Arm and E-Stop */
  always: boolean;
};

/** All gate names, in a stable order. */
export const GATE_NAMES = [
  "idle", "jog", "override", "ready", "run", "pause", "resume", "step",
  "abort", "probe", "zero", "touchoff", "touchoffRotary", "twpCapture",
  "surfaceComp",
  "safety", "setup", "armed", "always",
] as const;

/**
 * Gates that carried a top-level `!busy` term in the original policy.
 * `step` is intentionally excluded: its busy term was nested inside an OR
 * (only the idle-start branch, not the paused-resume branch), and `fire()`'s
 * 200 ms cooldown already guards double-fire — a uniform overlay would be
 * wrong. `jog` never had a busy term (hold-to-move).
 */
const BUSY_GATES: ReadonlySet<keyof Permissions> = new Set([
  "idle", "override", "ready", "run", "probe", "zero", "touchoff", "touchoffRotary",
  "twpCapture", "surfaceComp", "setup",
]);

/**
 * Gates that stay open in SIMULATION mode (client-local, see simMode.ts).
 * While the 3D model is posed along the program instead of the live machine,
 * every machine-action gate must be closed — the display is intentionally
 * wrong, so acting on it is the hazard. `always` keeps Arm/E-Stop, `armed`
 * keeps navigation, `setup` keeps file browsing (loading a file exits sim).
 * `safety` is deliberately NOT here: Machine On requires exiting sim first.
 */
const SIM_GATES: ReadonlySet<keyof Permissions> = new Set([
  "always", "armed", "setup",
]);

/** The backend's machine-state permission dict (computed with `armed=true`). */
export type MachinePermissions = Partial<Record<keyof Permissions, boolean>>;

/**
 * Apply the client-local overlay to the backend-broadcast machine permissions.
 * `always` is unconditional; every other gate requires `armed`; busy-subset
 * gates also require `!busy`. Absent backend perms (before the first status)
 * yield all-false except `always` — the safe default.
 */
let _warnedNoRun = false;
export function applyClientOverlay(
  machine: MachinePermissions | null | undefined,
  armed: boolean,
  busy: boolean,
  sim: boolean = false,
): Permissions {
  const out = {} as Permissions;
  // Mixed-version window (2026-09-03): a gateway that predates the `run`
  // class ships no `run` key. Read it as `ready` (its old gate) and say so
  // once, instead of dimming Cycle Start until the restart.
  if (machine && machine.run === undefined && machine.ready !== undefined) {
    if (!_warnedNoRun) { _warnedNoRun = true; console.warn("[permissions] backend ships no 'run' class — using 'ready' until the gateway restarts"); }
    machine = { ...machine, run: machine.ready };
  }
  for (const g of GATE_NAMES) {
    if (g === "always") { out[g] = true; continue; }
    out[g] = !!machine?.[g] && armed
      && (BUSY_GATES.has(g) ? !busy : true)
      && (sim ? SIM_GATES.has(g) : true);
  }
  return out;
}

/** Valid gate names (excludes `always`) — used by main.ts data-gate guard. */
export const VALID_GATES: ReadonlySet<string> =
  new Set(GATE_NAMES.filter((k) => k !== "always"));

/** Injection key for provide/inject */
export const PERMISSIONS_KEY = Symbol("permissions") as InjectionKey<ComputedRef<Permissions>>;

/**
 * The ONE client path for a state-changing command (issue #31): permission
 * re-check + the busy latch, with per-command transport policy from lcnc.ts.
 * `fire()` is a closure in App.vue over the shared `busy` ref, so components
 * that cannot see it used raw `send()` instead — which is how the same command
 * ended up with two policies. Providing it removes that reason without hoisting
 * `busy` out of App.vue. Same shape as PERMISSIONS_KEY above.
 */
export type FireFn = (payload: any, gate?: keyof Permissions, cooldownMs?: number) => void;
export const FIRE_KEY = Symbol("fire") as InjectionKey<FireFn>;

/** Composable: inject the gated send path from the ancestor provider. */
export function useFire(): FireFn {
  const fire = inject(FIRE_KEY);
  if (!fire) throw new Error("useFire() called without provider — ensure App.vue provides FIRE_KEY");
  return fire;
}

/** Composable: inject permissions from ancestor provider */
export function usePermissions(): ComputedRef<Permissions> {
  const perms = inject(PERMISSIONS_KEY);
  if (!perms) throw new Error("usePermissions() called without provider — ensure App.vue provides PERMISSIONS_KEY");
  return perms;
}

// One admission per action, whatever activates it (button gates BG-10, Codex
// R202): the screen's button, the keyboard shortcut and the gamepad button
// admit an action by the same rule — only the gesture differs. The gamepad
// used to start under `ready` without the editor or the load in flight, home
// under `idle` and switch the coolant under `ready`; the keyboard started
// while a program was still loading.
import type { Permissions } from "./permissions";

/** Each action's catalog gate — the screen's control, the shortcut and the
 *  gamepad button read the same one. */
export const ACTION_GATES = {
  start: "run",
  resume: "resume",
  pause: "pause",
  abort: "abort",
  spindleStop: "spindleStop",
  homeAll: "zero",
  coolant: "override",
} as const satisfies Record<string, keyof Permissions>;

/** What Start needs beyond its gate: the loaded program, nobody editing it,
 *  no load in flight (its displayed text not yet the published revision). */
export interface StartContext {
  activeFile: string | null | undefined;
  editing: boolean;
  loading: boolean;
}

export const START_REASONS = {
  editing: "Finish or discard the edit first",
  noProgram: "No program loaded",
  loading: "Loading program — wait",
} as const;

/** Why Start may not run the loaded program beyond its `run` gate — null
 *  when it may. The button shows it; the shortcut and the pad refuse by it. */
export function startRefusal(ctx: StartContext): string | null {
  if (ctx.editing) return START_REASONS.editing;
  if (!ctx.activeFile) return START_REASONS.noProgram;
  if (ctx.loading) return START_REASONS.loading;
  return null;
}

/** The whole start admission: the `run` gate and the program context. */
export function startAdmitted(can: Pick<Permissions, "run">, ctx: StartContext): boolean {
  return can.run && startRefusal(ctx) === null;
}

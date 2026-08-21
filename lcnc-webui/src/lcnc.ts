// ─── LinuxCNC interpreter states (interp_state field) ────────────
export const INTERP_IDLE = 1;
export const INTERP_READING = 2;
export const INTERP_PAUSED = 3;
export const INTERP_WAITING = 4;

// ─── Trajectory/motion modes (motion_mode field) ─────────────────
export const TRAJ_MODE_FREE = 1;
export const TRAJ_MODE_COORD = 2;
export const TRAJ_MODE_TELEOP = 3;

// ─── Task modes (task_mode field) ────────────────────────────────
export const TASK_MODE_MANUAL = 1;
export const TASK_MODE_AUTO = 2;
export const TASK_MODE_MDI = 3;

// ─── Spindle direction ───────────────────────────────────────────
export const SPINDLE_FORWARD = 1;
export const SPINDLE_REVERSE = -1;
export const SPINDLE_STOPPED = 0;

// ─── Error message kinds (NML) ───────────────────────────────────
export const NML_ERROR = 1;
export const OPERATOR_ERROR = 2;
export const NML_TEXT = 3;
export const OPERATOR_TEXT = 4;
export const NML_DISPLAY = 5;
export const OPERATOR_DISPLAY = 6;

// ─── Typed WebSocket command union ───────────────────────────────
export type WsCommand =
  // Machine control
  | { cmd: "arm"; armed: boolean }
  | { cmd: "estop" }
  | { cmd: "estop_reset" }
  | { cmd: "machine_on" }
  | { cmd: "machine_off" }
  | { cmd: "set_mode"; mode: number }
  // Homing
  | { cmd: "home_all" }
  | { cmd: "unhome_all" }
  // Program execution
  | { cmd: "cycle_start" }
  | { cmd: "auto_run"; line: number; spindle_dir?: string; spindle_speed?: number; pre_tool?: number; safe_z?: boolean; entry_x?: number; entry_y?: number; entry_wcs?: string; entry_units?: string }
  | { cmd: "auto_step" }
  | { cmd: "cycle_pause" }
  | { cmd: "cycle_resume" }
  | { cmd: "abort" }
  | { cmd: "load_file"; path: string }
  | { cmd: "unload_file" }
  // Re-parse the loaded program against the CURRENT work offsets (the preview
  // is parsed once, so a touch-off afterwards leaves it stale).
  | { cmd: "reparse_preview" }
  // MDI
  | { cmd: "mdi"; text: string }
  // Jogging (single axis)
  | { cmd: "jog_cont"; axis: number; vel: number }
  | { cmd: "jog_incr"; axis: number; vel: number; distance: number }
  | { cmd: "jog_stop"; axis: number }
  // Jogging (multi axis)
  | { cmd: "jog_cont_multi"; axes: { axis: number; vel: number }[] }
  | { cmd: "jog_incr_multi"; axes: { axis: number; vel: number; distance: number }[] }
  | { cmd: "jog_stop_multi"; axes: number[] }
  // Spindle
  | { cmd: "spindle_forward"; speed: number }
  | { cmd: "spindle_reverse"; speed: number }
  | { cmd: "spindle_stop" }
  | { cmd: "spindle_increase" }
  | { cmd: "spindle_decrease" }
  // Overrides
  | { cmd: "set_feed_override"; scale: number }
  | { cmd: "set_spindle_override"; scale: number }
  | { cmd: "set_rapid_override"; scale: number }
  // Program switches
  | { cmd: "set_optional_stop"; value: boolean }
  | { cmd: "set_block_delete"; value: boolean }
  // Tool table
  | { cmd: "get_tool_table" }
  | { cmd: "save_tool"; tool_number: number; [key: string]: any }
  | { cmd: "add_tool"; tool_number: number; [key: string]: any }
  | { cmd: "renumber_tool"; old_tool_number: number; tool_number: number; [key: string]: any }
  | { cmd: "delete_tool"; tool_number: number }
  | { cmd: "tool_change"; tool_number: number }
  // Coolant
  | { cmd: "flood_on" }
  | { cmd: "flood_off" }
  | { cmd: "mist_on" }
  | { cmd: "mist_off" }
  // Probing
  | { cmd: "list_probe_macros" }
  | { cmd: "simulate_probe_trip" }
  | { cmd: "set_probe_vars"; vars: Record<string, number> }
  | { cmd: "get_probe_vars"; vars: number[] }
  | { cmd: "get_probe_results" }
  | { cmd: "get_comp_grid" }
  // Surface compensation
  | { cmd: "set_compensation"; enable: boolean }
  | { cmd: "set_compensation_method"; method: number }
  // Tool change
  | { cmd: "confirm_tool_change" }
  // Offsets
  | { cmd: "get_wcs_table" }
  | { cmd: "clear_wcs"; target: string }
  | { cmd: "set_wcs"; target: string; x?: number; y?: number; z?: number; a?: number; b?: number; c?: number; u?: number; v?: number; w?: number; r?: number }
  // Heartbeat
  | { cmd: "heartbeat" }
  // Shutdown
  | { cmd: "shutdown" }
  // Settings
  | { cmd: "save_settings"; section: string; data: any }
  // Timing
  | { cmd: "timing_log"; enable: boolean }
  // Client-side diagnostics (heap, Three.js renderer info, etc.) — logged
  // server-side to trace.ndjson so a renderer crash ("Aw Snap") still
  // leaves a usable timeline.
  | { cmd: "client_diag"; data: Record<string, any> }
  // Halshow (Settings → Halshow tab) live updates
  | { cmd: "halshow_live"; on: boolean }
  // Tab visibility — gateway pauses status fan-out to hidden tabs to keep
  // the asyncio loop responsive under multi-tab storm conditions.
  | { cmd: "tab_visibility"; hidden: boolean }
  // Safety trip acknowledgment (clears sticky trip, re-allows arming)
  | { cmd: "safety_trip_ack" };

// Commands safe to queue while the socket is closed and replay after reconnect
// (issue #18). Read-only / telemetry only — everything else (motion, mode,
// spindle, overrides, tool/file/settings mutations) is DROPPED on a closed
// socket so a stale operator action can't replay into a fresh connection.
const QUEUE_SAFE_CMDS = new Set<string>([
  "heartbeat",
  "client_diag",
  "timing_log",
  "tab_visibility",
  "halshow_live",
  "safety_trip_ack",
]);

export function isQueueSafe(cmd: string): boolean {
  return cmd.startsWith("get_") || QUEUE_SAFE_CMDS.has(cmd);
}

/**
 * Commands that must NEVER be swallowed by the client-local busy latch.
 *
 * `fire()` opens with `if (busy.value) return` — a silent drop — and abort is
 * routed through it from the keyboard and the gamepad. An abort pressed within
 * the cooldown of any other gated action was therefore discarded, with no
 * feedback: a stop control failing because of a UI debounce.
 *
 * These are exactly the commands the GATEWAY maps to gate "always" or "abort"
 * (command_policy.COMMAND_GATES) — stopping must not depend on client-side
 * pacing. Their permission gate still applies; only the debounce is bypassed.
 */
const NEVER_DEBOUNCED = new Set<string>([
  "abort", "estop", "estop_reset", "jog_stop", "jog_stop_multi",
]);

export function isNeverDebounced(cmd: string): boolean {
  return NEVER_DEBOUNCED.has(cmd);
}

/**
 * Client-local TRANSPORT policy per command: how long `fire()` holds the busy
 * latch after sending it.
 *
 * Deliberately carries NO permission gates. A gate table here would be a
 * re-derivation of the backend's COMMAND_GATES on the client, which
 * permissions.ts forbids and which would drift; the gate check stays in
 * `fire()`, reading the permissions the backend broadcasts.
 *
 * Default is DEFAULT_COOLDOWN_MS: enough to debounce a double-click on a
 * motion command. Flag toggles and stop commands opt out — a 200 ms latch made
 * a checkbox feel laggy and dropped the second click of a deliberate pair.
 */
export const DEFAULT_COOLDOWN_MS = 200;

const COMMAND_COOLDOWN_MS: Record<string, number> = {
  // Stop/abort: never debounced at all (see NEVER_DEBOUNCED).
  abort: 0, estop: 0, estop_reset: 0, jog_stop: 0, jog_stop_multi: 0,
  // Modal flags — instant toggles, no motion started.
  set_optional_stop: 0,
  set_block_delete: 0,
  // Continuous inputs: the slider already rate-limits; the backend clamps.
  set_feed_override: 0,
  set_spindle_override: 0,
  set_rapid_override: 0,
  set_max_velocity: 0,
};

export function cooldownFor(cmd: string): number {
  const v = COMMAND_COOLDOWN_MS[cmd];
  return v === undefined ? DEFAULT_COOLDOWN_MS : v;
}

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
  // Homing
  | { cmd: "home_all" }
  | { cmd: "unhome_all" }
  // Teleop
  | { cmd: "teleop_enable" }
  | { cmd: "teleop_disable" }
  // Program execution
  | { cmd: "cycle_start" }
  | { cmd: "cycle_pause" }
  | { cmd: "cycle_resume" }
  | { cmd: "abort" }
  | { cmd: "load_file"; path: string }
  | { cmd: "unload_file" }
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
  // Overrides
  | { cmd: "set_feed_override"; scale: number }
  | { cmd: "set_spindle_override"; scale: number }
  | { cmd: "set_rapid_override"; scale: number }
  // Heartbeat
  | { cmd: "heartbeat" };

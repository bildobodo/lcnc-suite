// Jogging before homing (button gates package E, BG-07; operator E1–E3,
// 2026-10-28): where the machine declares it ([DISPLAY]
// WEBUI_JOINT_JOG_BEFORE_HOMING = 1), the jog opens before homing — joint by
// joint, each axis moving the joint the machine's joint order names for it,
// at most a share of that joint's top speed, and an axis two joints carry (a
// gantry) closed. The gateway decides and enforces all of it (viewer_init
// `ini_config.joint_jog`, the `jog` class, the handlers); this module only
// says why an axis is closed, names the joint an axis moves for the
// button's corner mark, and states the cap — for the strip, the keyboard and
// the gamepad alike (one admission, BG-10). The buttons keep their axis
// letters; the joint is a corner mark that never changes a button's size
// (operator 2026-10-28: "J2·Z+" in the label widened the Z and rotary
// buttons).

export interface JointJogAxis {
  letter: string;
  joint: number | null;
  reason: string | null;
}

export interface JointJog {
  enabled: boolean;
  fraction: number | null;
  reason: string | null;
  axes: JointJogAxis[];
}

/** The fallback when the gateway names no reason for a closed axis. */
export const AXIS_NOT_DECLARED = "No joint declared — jog it after Home All";
/** A diagonal moves two joints at once — no single joint, like a coordinated
 *  move: closed before homing (package F, operator 2026-10-28; the gateway
 *  refuses a multi-jog there with the same words). */
export const DIAGONAL_BEFORE_HOMING = "Diagonal jog after Home All";

/** Is the strip jogging joints — before homing, where the machine declares it? */
export function jointJogActive(jj: JointJog | null | undefined, homed: boolean): boolean {
  return !homed && !!jj?.enabled;
}

/** Why an axis may not jog joint-wise now, or null. Homed, or no joint jog
 *  declared: null — the `jog` class alone decides there. */
export function jogAxisRefusal(jj: JointJog | null | undefined, homed: boolean, axisIndex: number): string | null {
  if (!jointJogActive(jj, homed)) return null;
  const row = jj!.axes[axisIndex];
  if (!row || row.joint == null) return row?.reason ?? AXIS_NOT_DECLARED;
  return null;
}

/** Why a diagonal (two joints at once) may not jog now, or null. */
export function jogDiagonalRefusal(jj: JointJog | null | undefined, homed: boolean): string | null {
  return jointJogActive(jj, homed) ? DIAGONAL_BEFORE_HOMING : null;
}

/** The joint an axis moves while jogging joints (its button's corner
 *  mark), or null: homed, not declared, or a closed axis. */
export function jogAxisJoint(jj: JointJog | null | undefined, homed: boolean, axisIndex: number): number | null {
  if (!jointJogActive(jj, homed)) return null;
  return jj!.axes[axisIndex]?.joint ?? null;
}

/** The jog block's head line while jogging joints. */
/** The head line's "?" — the whole note where the line is cut (touch has no
 *  hover title; Codex R219 note, leftovers package). ≤ 120 characters. */
export function jointJogHelp(jj: JointJog | null | undefined): string {
  const pct = jj?.fraction != null ? Math.round(jj.fraction * 100) : null;
  return `Not homed: each button moves its own joint, without soft limits${pct != null ? `, at most ${pct} % of its speed` : ""}.`;
}
export function jointJogNote(jj: JointJog | null | undefined): string {
  const pct = jj?.fraction != null ? Math.round(jj.fraction * 100) : null;
  return pct != null ? `Joint jog — no soft limits · max ${pct} %` : "Joint jog — no soft limits";
}

// Jogging before homing (button gates package E, BG-07; operator E1–E3,
// 2026-10-28): where the machine declares it ([DISPLAY]
// WEBUI_JOINT_JOG_BEFORE_HOMING = 1), the jog opens before homing — joint by
// joint, each axis moving the joint the machine's joint order names for it,
// at most a share of that joint's top speed, and an axis two joints carry (a
// gantry) closed. The gateway decides and enforces all of it (viewer_init
// `ini_config.joint_jog`, the `jog` class, the handlers); this module only
// says why an axis is closed and states the cap — for the strip, the
// keyboard and the gamepad alike (one admission, BG-10). The buttons keep
// their axis letters (operator 2026-10-28).

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

/** The jog block's head line while jogging joints. */
export function jointJogNote(jj: JointJog | null | undefined): string {
  const pct = jj?.fraction != null ? Math.round(jj.fraction * 100) : null;
  return pct != null ? `Joint jog — no soft limits · max ${pct} %` : "Joint jog — no soft limits";
}

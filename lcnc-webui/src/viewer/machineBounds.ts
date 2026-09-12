// The machine-bounds box from LIVE joint limits (2026-09-12).
//
// The viewer used to draw `viewer_init.machine_bounds` — the INI FILE's
// [AXIS_X/Y/Z] MIN/MAX_LIMIT, read once per connection and mode-blind. The
// TWP sim switches its Z window LIVE by kins mode through a HAL mux
// (hallib/z_limit_window.hal: −2000..0.01 under identity, ±5000 under
// TCP/TOOL), so under TCP the drawn box was far too tight in +Z and legal
// motion clipped yellow. The gateway now publishes STAT's per-joint limits
// on every status frame; this derives the box from them. The INI box stays
// the documented fallback when the live limits are absent.

export interface MachineBox { origin: [number, number, number]; size: [number, number, number] }

/** [min, max] per joint (joint order), null entries when STAT had none. */
export type JointLimits = ReadonlyArray<readonly [number | null, number | null] | null>;

/** The X/Y/Z box from live joint limits. `axes` are the joint-ordered axis
 *  letters (viewer_init.axes — on XYZAC, C is joint 4 but canonical axis 5).
 *  null unless X, Y and Z joints exist with finite min < max — an unknown
 *  limit is never drawn as a box edge. */
export function boundsFromJointLimits(limits: JointLimits | null | undefined, axes: readonly string[]): MachineBox | null {
  if (!limits || !axes.length) return null;
  const lim = (letter: string): [number, number] | null => {
    const j = axes.findIndex(a => a.toUpperCase() === letter);
    if (j < 0 || j >= limits.length) return null;
    const l = limits[j];
    if (!l) return null;
    const [mn, mx] = l;
    if (typeof mn !== "number" || typeof mx !== "number" || !Number.isFinite(mn) || !Number.isFinite(mx) || !(mn < mx)) return null;
    return [mn, mx];
  };
  const x = lim("X"), y = lim("Y"), z = lim("Z");
  if (!x || !y || !z) return null;
  return { origin: [x[0], y[0], z[0]], size: [x[1] - x[0], y[1] - y[0], z[1] - z[0]] };
}

export function sameBox(a: MachineBox | null | undefined, b: MachineBox | null | undefined, eps = 1e-9): boolean {
  if (!a || !b) return a == null && b == null;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(a.origin[i]! - b.origin[i]!) > eps || Math.abs(a.size[i]! - b.size[i]!) > eps) return false;
  }
  return true;
}

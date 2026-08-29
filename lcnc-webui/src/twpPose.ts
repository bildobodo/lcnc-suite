// TWP tool-orientation staleness.
//
// The plane is stored TABLE-relative, so it rides the workpiece and cannot
// go stale. The HEAD SOLVE can: G53.x computes the spindle angles once, for
// the table pose in force at that moment, and no coordinate relabelling can
// swing the head afterwards. So when the A table moves after an orient, the
// tool stops being normal to the plane. The remap publishes the machine-frame
// A the head was last oriented at (`twp_pose_a`); comparing it against the
// live A is what tells the operator the tool is off-normal.
//
// One predicate, two consumers (the kins chip in SetupStrip and the plane
// overlay tint in ThreeViewer) so the epsilon lives in exactly one place.

/** Display threshold — below this the operator cannot act on the difference. */
export const TWP_POSE_EPS_DEG = 0.05;

/**
 * "No orient yet" sentinel written by the remap until G53.x has solved the
 * head (and again whenever the plane changes under it). The pin always
 * exists once the helper comp is loaded, so absence is expressed in the
 * value, not by a missing field — anything at or below this is "none".
 */
export const TWP_POSE_NONE_BELOW = -1e8;

/**
 * True when the table has moved since the head was oriented — i.e. the tool
 * is no longer normal to the plane. Makes no claim without data: no plane,
 * no orient yet (sentinel), or a missing live reading all return false —
 * unknown is not stale.
 */
export function twpPoseStale(
  poseA: number | null | undefined,
  liveA: number | null | undefined,
  defined: boolean | null | undefined,
): boolean {
  if (!defined) return false;
  if (poseA == null || liveA == null) return false;
  if (!Number.isFinite(poseA) || !Number.isFinite(liveA)) return false;
  if (poseA <= TWP_POSE_NONE_BELOW) return false;
  return Math.abs(liveA - poseA) > TWP_POSE_EPS_DEG;
}

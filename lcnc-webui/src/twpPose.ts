// TWP plane pose staleness (table-aware wave, stage 1).
//
// The TWP plane definition is stored as static world numbers; the A rotary
// on this machine is a WORK-side table, so rotating A after the plane was
// defined/oriented moves the physical face out from under the stored frame.
// The remap publishes the machine-frame A the current plane state assumes
// (`twp_pose_a`); comparing it against the live A tells the operator whether
// the plane frame and the workpiece still agree.
//
// One predicate, two consumers (the kins chip in SetupStrip and the plane
// overlay tint in ThreeViewer) so the epsilon lives in exactly one place.

/** Display threshold — below this the operator cannot act on the difference. */
export const TWP_POSE_EPS_DEG = 0.05;

/**
 * "No pose" sentinel written by the remap when no plane is defined. The pin
 * always exists once the helper comp is loaded, so absence is expressed in
 * the value, not by a missing field — anything at or below this is "none".
 */
export const TWP_POSE_NONE_BELOW = -1e8;

/**
 * True when the plane's assumed table pose and the live table pose disagree.
 * Makes no claim without data: an undefined plane, a sentinel pose, or a
 * missing live reading all return false (unknown is not stale).
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

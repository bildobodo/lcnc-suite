// Default camera framing — the ONE rule for where the eye starts (WP5).
//
// The viewer used to frame the machine's TRAVEL box only: eye at
// center + (1.5, −1.5, 1) × maxDim ≈ 2.345 × maxDim away. The machine
// MODEL is not the travel box — on the XYZAC sim the base is 2.2 m wide
// around a 0.4 m travel — so at low elevations the eye sat inside the bed
// and the camera "clipped into the model" (operator, 2026-09-19).
//
// Rule: the framing distance is the larger of the travel-box rule and the
// model's bounding SPHERE about the target (+ the near plane), so the
// default frame — build, first status, Reset's endpoint — starts outside
// every non-stock part for every orbit direction at that distance. Dolly,
// pan, later machine motion and the linear Reset tween are NOT covered:
// this is not a camera-collision system (docs/testing.md says so too).
//
// Pure: plain numbers, no three.js — pinned by cameraFraming.test.ts.

/** Travel-box rule: |(1.5, −1.5, 1)| × maxDim fills ~90 % of the 45° FOV. */
export const ENVELOPE_FACTOR = Math.sqrt(1.5 * 1.5 + 1.5 * 1.5 + 1);   // ≈ 2.345
/** Margin outside the model sphere. */
export const MODEL_MARGIN = 1.05;
/** Default view direction (unit vector of (1.5, −1.5, 1)). */
export const DEFAULT_FRAME_DIR: readonly [number, number, number] = (() => {
  const n = ENVELOPE_FACTOR;
  return [1.5 / n, -1.5 / n, 1 / n];
})();

/** Near/far planes for a scene whose travel box has `maxDim` and whose
 *  model sphere has `modelRadius` (both ≥ 0). */
export function frameNearFar(maxDim: number, modelRadius = 0): { near: number; far: number } {
  const near = Math.max(0.1, maxDim / 1000);
  const far = Math.max(200000, maxDim * 20, modelRadius * 20);
  return { near, far };
}

/** Eye distance from the target for the default frame. */
export function frameDistance(maxDim: number, modelRadius: number, near: number): number {
  return Math.max(ENVELOPE_FACTOR * maxDim, MODEL_MARGIN * modelRadius + near);
}

/** OrbitControls.minDistance: keeps a dolly from pushing the eye through the
 *  near plane (nothing more — see the header). */
export function minOrbitDistance(near: number): number {
  return near * 20;
}

export interface FramePose {
  near: number;
  far: number;
  distance: number;
  /** Eye position = target + DEFAULT_FRAME_DIR × distance. */
  position: [number, number, number];
  minDistance: number;
}

/** The full default pose about `center` (target) for a travel box of
 *  `maxDim` and a model sphere of `modelRadius` about that centre. */
export function framePose(center: readonly [number, number, number], maxDim: number,
                          modelRadius: number): FramePose {
  const { near, far } = frameNearFar(maxDim, modelRadius);
  const distance = frameDistance(maxDim, modelRadius, near);
  const d = DEFAULT_FRAME_DIR;
  return {
    near, far, distance,
    position: [center[0] + d[0] * distance, center[1] + d[1] * distance, center[2] + d[2] * distance],
    minDistance: minOrbitDistance(near),
  };
}

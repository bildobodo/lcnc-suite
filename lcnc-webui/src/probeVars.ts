import type { ProbeDefaults } from "./defaults";

/** The Probing form's starting point (the probe settings section's fallback). */
export const PROBE_FALLBACK: ProbeDefaults = {
  probeTool: 99, slowFr: 50, fastFr: 200, traverseFr: 1000,
  maxXYDistance: 10, xyClearance: 2, maxZDistance: 10, zClearance: 2,
  stepOffWidth: 5, extraProbeDepth: 0, edgeWidth: 0.5,
  diameterHint: 0, xHintBP: 0, yHintBP: 0, xHintRV: 0, yHintRV: 0,
  wcoRotation: 0, calDiameter: 0, xCalWidth: 0, yCalWidth: 0,
  scanX0: 10, scanX1: 200, scanY0: 10, scanY1: 200,
  scanXProbes: 5, scanYProbes: 5, scanSafeZ: 20, scanDepthZ: 24,
  autoZero: false,
};

type ProbeParams = Omit<ProbeDefaults, "autoZero">;

/** The probe tip offset's number: never in a page's set (P5-1 c) — the
 *  gateway alone writes it, from the active calibration (`probeCalibration`).
 *  A machine's var file still declares it. */
export const OFFSET_VAR = 3032;

/** The number each form field goes to — the `probe` purpose (settings split
 *  package 3: the gateway refuses a set outside it whole). #3030, the probe
 *  mode, comes from the Auto Zero switch. */
const PROBE_VARS: readonly (readonly [number, keyof ProbeParams])[] = [
  [3014, "probeTool"], [3015, "slowFr"], [3016, "fastFr"], [3017, "traverseFr"],
  [3018, "maxXYDistance"], [3019, "xyClearance"], [3020, "maxZDistance"], [3021, "zClearance"],
  [3022, "extraProbeDepth"], [3023, "stepOffWidth"], [3024, "edgeWidth"], [3025, "diameterHint"],
  [3026, "xHintBP"], [3027, "yHintBP"], [3028, "xHintRV"], [3029, "yHintRV"],
  [3031, "wcoRotation"], [3033, "calDiameter"], [3034, "xCalWidth"], [3035, "yCalWidth"],
];
/** The surface scan's numbers — the `surface` purpose: #3050–#3059 and the
 *  two probe values surface_scan.ngc reads (the probe tool #3014, the
 *  clearance #3021); #3056 / #3057 are the feeds of #3016 / #3015. */
const SCAN_VARS: readonly (readonly [number, keyof ProbeParams])[] = [
  [3014, "probeTool"], [3021, "zClearance"],
  [3050, "scanX0"], [3051, "scanX1"], [3052, "scanY0"], [3053, "scanY1"],
  [3054, "scanXProbes"], [3055, "scanYProbes"], [3056, "fastFr"], [3057, "slowFr"],
  [3058, "scanSafeZ"], [3059, "scanDepthZ"],
];
const fieldsBy = (vars: readonly (readonly [number, string])[]) =>
  Object.fromEntries(vars.map(([n, f]) => [String(n), f])) as Record<string, string>;
export const PROBE_VAR_FIELDS: Record<string, string> = { ...fieldsBy(PROBE_VARS), "3030": "autoZero" };
export const SCAN_VAR_FIELDS: Record<string, string> = fieldsBy(SCAN_VARS);

/** The probe parameters → the LinuxCNC var numbers the probe_basic routines
 *  read: #3014–#3035 without #3032 (XY and Z distance and clearance both; a
 *  calibration adds #3036, `calibrationVarMap`). Every number must be declared
 *  in the machine's var file — the gateway refuses one it does not declare
 *  (W3), and a probe sends these with its call (operator 2026-11-02: the
 *  shipped examples declared none past #3014, so every probe was refused). */
export function probeVarMap(p: ProbeParams, probeMode: number): Record<string, number> {
  return {
    ...Object.fromEntries(PROBE_VARS.map(([n, f]) => [String(n), p[f]])),
    "3030": probeMode,       // 0 = set WCO, 1 = measure only
  };
}

/** The surface scan's set (SCAN_VARS). */
export function surfaceVarMap(p: ProbeParams): Record<string, number> {
  return Object.fromEntries(SCAN_VARS.map(([n, f]) => [String(n), p[f]]));
}

/** A calibration sends the map above and its axis choice: #3036 = 0 the
 *  average of X and Y, 1 X only, 2 Y only (probe_cal_*) — the `calibration`
 *  purpose. One map for every number the panel writes — #3036 was added
 *  beside it and no var file declared it, so every calibration was refused
 *  (found by the probe-click spec, 2026-11-03). */
export function calibrationVarMap(p: ProbeParams, probeMode: number, calAxis: number): Record<string, number> {
  return { ...probeVarMap(p, probeMode), "3036": calAxis };
}

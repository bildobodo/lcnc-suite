import type { ProbeDefaults } from "./defaults";

/** The Probing form's starting point (the probe settings section's fallback). */
export const PROBE_FALLBACK: ProbeDefaults = {
  probeTool: 99, slowFr: 50, fastFr: 200, traverseFr: 1000,
  maxXYDistance: 10, xyClearance: 2, maxZDistance: 10, zClearance: 2,
  calOffset: 0, stepOffWidth: 5, extraProbeDepth: 0, edgeWidth: 0.5,
  diameterHint: 0, xHintBP: 0, yHintBP: 0, xHintRV: 0, yHintRV: 0,
  wcoRotation: 0, calDiameter: 0, xCalWidth: 0, yCalWidth: 0,
  scanX0: 10, scanX1: 200, scanY0: 10, scanY1: 200,
  scanXProbes: 5, scanYProbes: 5, scanSafeZ: 20, scanDepthZ: 24,
  autoZero: false,
};

/** The probe parameters → the LinuxCNC var numbers the routines read: the
 *  probe_basic routines #3014–#3035 (XY and Z distance and clearance both),
 *  the surface map #3050–#3059. Every number must be declared in the
 *  machine's var file — the gateway refuses one it does not declare (W3),
 *  and a probe sends these with its call (operator 2026-11-02: the shipped
 *  examples declared none past #3014, so every probe was refused). */
export function probeVarMap(p: Omit<ProbeDefaults, "autoZero">, probeMode: number): Record<string, number> {
  return {
    "3014": p.probeTool,
    "3015": p.slowFr,
    "3016": p.fastFr,
    "3017": p.traverseFr,
    "3018": p.maxXYDistance,
    "3019": p.xyClearance,
    "3020": p.maxZDistance,
    "3021": p.zClearance,
    "3022": p.extraProbeDepth,
    "3023": p.stepOffWidth,
    "3024": p.edgeWidth,
    "3025": p.diameterHint,
    "3026": p.xHintBP,
    "3027": p.yHintBP,
    "3028": p.xHintRV,
    "3029": p.yHintRV,
    "3030": probeMode,       // 0 = set WCO, 1 = measure only
    "3031": p.wcoRotation,
    "3032": p.calOffset,
    "3033": p.calDiameter,
    "3034": p.xCalWidth,
    "3035": p.yCalWidth,
    // Surface map scan (#3050-#3059)
    "3050": p.scanX0,
    "3051": p.scanX1,
    "3052": p.scanY0,
    "3053": p.scanY1,
    "3054": p.scanXProbes,
    "3055": p.scanYProbes,
    "3056": p.fastFr,     // shared with #3016
    "3057": p.slowFr,     // shared with #3015
    "3058": p.scanSafeZ,
    "3059": p.scanDepthZ,
  };
}

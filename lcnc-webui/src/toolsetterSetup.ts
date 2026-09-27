import type { ToolsetterDefaults } from "./defaults";
import {
  TS_POSITION_FIELDS, TS_PROBE_FIELDS, TS_OPTION_FIELDS, TS_OFFSET_FIELDS, TS_FINDER_FIELDS,
} from "./probeFields";

/** The form's starting point — NEVER a machine configuration (see below). */
export const TOOLSETTER_FALLBACK: ToolsetterDefaults = {
  fastFeed: 0, slowFeed: 0, traverseFeed: 0, maxZTravel: 0,
  retractDist: 0, spindleZeroHeight: 0, offsetDirection: 0,
  touchX: 0, touchY: 0, touchZ: 0, useToolTable: 0, toolMinDis: 0,
  brakeAfter: 0, goBackToStart: 0, spindleStopM: 5, disablePrePos: 0,
  addReps: 0, lastTry: 0, offsetDiameter: 0, offsetValue: 0,
  finderTouchX: 0, finderTouchY: 0, finderDiffZ: 0,
};

/**
 * Is the toolsetter SET UP — may its values go to the machine?
 *
 * TOOLSETTER_FALLBACK is a form's starting point, never a machine
 * configuration: a config without a saved section pushed its zeros into the
 * var file on every Measure Current (the XYZAC sim, 2026-09-27; Codex R15 B1).
 * So the answer comes from the section as the SERVER confirmed it, raw,
 * before any fallback is merged in: every REQUIRED field saved and every
 * saved field valid (its probeFields constraint, or its option values).
 * Options left unsaved take their documented default — off.
 */
export const TOOLSETTER_REQUIRED = [
  "touchX", "touchY", "touchZ",                               // where the setter is (zeros allowed)
  "fastFeed", "slowFeed", "traverseFeed",                     // slow feed 0 = skip the second touch
  "maxZTravel", "retractDist", "spindleZeroHeight",
] as const satisfies readonly (keyof ToolsetterDefaults)[];

const OPTION_VALUES: Partial<Record<keyof ToolsetterDefaults, readonly number[]>> = {
  offsetDirection: [0, 1, 2, 3], brakeAfter: [0, 1, 2], spindleStopM: [5, 500],
  useToolTable: [0, 1], goBackToStart: [0, 1], disablePrePos: [0, 1], lastTry: [0, 1],
};

const FIELDS = new Map(
  [...TS_POSITION_FIELDS, ...TS_PROBE_FIELDS, ...TS_OPTION_FIELDS, ...TS_OFFSET_FIELDS, ...TS_FINDER_FIELDS]
    .map(f => [f.key, f] as const),
);

/** Reasons at the control ("why — what to do", ≤ 60 characters). */
export const TOOLSETTER_UNSET_REASON = "Toolsetter not set up — Probing › Toolsetter";
export const TOOLSETTER_INVALID_REASON = "Toolsetter values invalid — Probing › Toolsetter";
export const TOOLSETTER_PENDING_REASON = "Settings not loaded yet — wait";

export type ToolsetterSetup =
  | { ok: true; values: ToolsetterDefaults }
  | { ok: false; reason: string; missing: string[]; invalid: string[] };

function valid(key: keyof ToolsetterDefaults, v: unknown): boolean {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  const allowed = OPTION_VALUES[key];
  if (allowed) return allowed.includes(v);
  const f = FIELDS.get(key);
  if (!f) return false;
  return (f.min === undefined || v >= f.min) && (f.max === undefined || v <= f.max)
    && (!f.integer || Number.isInteger(v));
}

/** Pure: the verdict on a raw section (what the server holds). */
export function toolsetterSetup(section: unknown): ToolsetterSetup {
  const saved = (section && typeof section === "object" ? section : {}) as Record<string, unknown>;
  const keys = Object.keys(TOOLSETTER_FALLBACK) as (keyof ToolsetterDefaults)[];
  const missing = TOOLSETTER_REQUIRED.filter(k => !(k in saved));
  const invalid = keys.filter(k => k in saved && !valid(k, saved[k]));
  if (missing.length || invalid.length) {
    return { ok: false, reason: missing.length ? TOOLSETTER_UNSET_REASON : TOOLSETTER_INVALID_REASON,
             missing: [...missing], invalid };
  }
  const values = { ...TOOLSETTER_FALLBACK };
  for (const k of keys) if (k in saved) values[k] = saved[k] as number;
  return { ok: true, values };
}

/** LinuxCNC var# → value for a SET-UP toolsetter (the routine reads
 *  #3004–#3013 and #3100–#3115; see CLAUDE.md "Toolsetter Var-File Mapping"). */
export function toolsetterVarMap(p: ToolsetterDefaults): Record<string, number> {
  return {
    "3004": p.fastFeed, "3005": p.slowFeed, "3006": p.traverseFeed,
    "3007": p.maxZTravel, "3009": p.retractDist, "3010": p.spindleZeroHeight,
    "3013": p.offsetDirection,
    "3100": p.touchX, "3101": p.touchY, "3102": p.touchZ,
    "3103": p.useToolTable, "3104": p.toolMinDis, "3105": p.brakeAfter,
    "3106": p.goBackToStart, "3107": p.spindleStopM, "3108": p.disablePrePos,
    "3109": p.addReps, "3110": p.lastTry, "3111": p.offsetDiameter,
    "3112": p.offsetValue, "3113": p.finderTouchX, "3114": p.finderTouchY,
    "3115": p.finderDiffZ,
  };
}


// Null placeholder convention (design wave D0, UI-N05): ONE placeholder,
// NO_VALUE ("—"), for every DISPLAY of a missing value — readouts, stats,
// table cells, the HUD. Editable values never show it: fmtAxisValue gives ""
// and an input keeps a number or an empty entry.

import { isRotaryAxis } from "./useAxes";

/** The one display placeholder for a missing value (never an input value). */
export const NO_VALUE = "\u2014";

/** Coordinate display — 3 decimals linear, 2° rotary */
export function fmtCoord(val: number | null | undefined, axis?: string): string {
  if (val == null || !Number.isFinite(val)) return NO_VALUE;
  if (axis && isRotaryAxis(axis)) return val.toFixed(2) + "°";
  return val.toFixed(3);
}

/** Coordinate as an editable VALUE — same precision as fmtCoord (3 linear,
 *  2 rotary) but no unit suffix and "" for null, so a keypad or input
 *  receives a clean numeric string. */
export function fmtAxisValue(val: number | null | undefined, axis: string): string {
  if (val == null || !Number.isFinite(val)) return "";
  return isRotaryAxis(axis) ? val.toFixed(2) : val.toFixed(3);
}

/** Fixed-decimal number — configurable precision, NO_VALUE for null */
export function fmtNum(val: number | null | undefined, decimals = 4): string {
  if (val == null) return NO_VALUE;
  const x = Number(val);
  return Number.isFinite(x) ? x.toFixed(decimals) : NO_VALUE;
}

/** Table cell number — NO_VALUE for null/empty */
export function fmtCell(val: any, decimals = 4): string {
  if (val == null || val === "") return NO_VALUE;
  const x = Number(val);
  return Number.isFinite(x) ? x.toFixed(decimals) : NO_VALUE;
}

/** Offset value — em-dash when source is null/missing, fixed-4 otherwise.
 *
 * Returning "0.0000" for null was a silent fallback: editable DRO cells
 * couldn't distinguish "real zero" from "data missing", and the user could
 * write the synthetic zero back to the machine. Callers that render this
 * inside an editable cell should treat "—" as read-only / not user-edited.
 */
export function fmtOffset(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return NO_VALUE;
  return val.toFixed(4);
}

/** RPM display — plain rounded integer. No locale grouping: thousands
 *  separators (e.g. Swiss 1'400) appear nowhere else in the UI. */
export function fmtRpm(val: number | null): string {
  if (val == null) return NO_VALUE;
  return String(Math.round(val));
}

/** Elapsed time — zero-padded mm:ss or h:mm:ss */
export function fmtElapsed(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Progress readout for a timed job: elapsed of the expected duration
 *  ("00:03 of ~00:12"), elapsed alone when nothing was expected. One
 *  wording for the status banner, the viewer HUD and their tooltips. */
export function fmtProgressTimes(elapsedMs: number, expectedMs: number | null | undefined): string {
  const el = fmtElapsed(Math.max(0, Math.floor(elapsedMs / 1000)));
  return expectedMs ? `${el} of ~${fmtElapsed(Math.max(1, Math.round(expectedMs / 1000)))}` : `${el} elapsed`;
}

/** Duration — human-readable abbreviated (5s, 3m 12s, 2h 15m) */
export function fmtDuration(secs: number): string {
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/** Distance with unit suffix — 1 decimal */
export function fmtDist(val: number, unit: string): string {
  return `${val.toFixed(1)} ${unit}`;
}

/** Percentage of a RATIO (1 = 100 %) — "120 %", the unit set off by a
 *  space like every other unit (UI-N03); NO_VALUE for a missing value. */
export function fmtPct(ratio: number | null | undefined, decimals = 0): string {
  if (ratio == null || !Number.isFinite(ratio)) return NO_VALUE;
  return `${(ratio * 100).toFixed(decimals)} %`;
}

/** Milliseconds — "12 ms" (UI-N04); NO_VALUE for a missing value. */
export function fmtMs(ms: number | null | undefined, decimals = 0): string {
  if (ms == null || !Number.isFinite(ms)) return NO_VALUE;
  return `${ms.toFixed(decimals)} ms`;
}

/** A number with its unit ("12.0000 mm"); NO_VALUE — without a unit — for
 *  a missing value (design wave D0, UI-N02). */
export function fmtQty(val: number | null | undefined, unit: string, decimals = 4): string {
  if (val == null || !Number.isFinite(val)) return NO_VALUE;
  return fmtUnit(val.toFixed(decimals), unit);
}

/** A value and its unit, set off by a space (design wave D0) — the unit is
 *  omitted when empty, never glued to the number. */
export function fmtUnit(value: string | number, unit: string): string {
  return unit ? `${value} ${unit}` : String(value);
}

/** File size — B/KB/MB */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

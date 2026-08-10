// Null placeholder conventions:
//   "---" for display values (DRO, stats, probe results)
//   "-"   for table cells (compact)
//   "0.0000" for editable offset values (must show a number)

import { isRotaryAxis } from "./useAxes";

/** Coordinate display — 3 decimals linear, 2° rotary */
export function fmtCoord(val: number | null | undefined, axis?: string): string {
  if (val == null || !Number.isFinite(val)) return "---";
  if (axis && isRotaryAxis(axis)) return val.toFixed(2) + "°";
  return val.toFixed(3);
}

/** Fixed-decimal number — configurable precision, "---" for null */
export function fmtNum(val: number | null | undefined, decimals = 4): string {
  if (val == null) return "---";
  const x = Number(val);
  return Number.isFinite(x) ? x.toFixed(decimals) : "---";
}

/** Table cell number — compact "-" for null */
export function fmtCell(val: any, decimals = 4): string {
  if (val == null || val === "") return "-";
  const x = Number(val);
  return Number.isFinite(x) ? x.toFixed(decimals) : "-";
}

/** Offset value — em-dash when source is null/missing, fixed-4 otherwise.
 *
 * Returning "0.0000" for null was a silent fallback: editable DRO cells
 * couldn't distinguish "real zero" from "data missing", and the user could
 * write the synthetic zero back to the machine. Callers that render this
 * inside an editable cell should treat "—" as read-only / not user-edited.
 */
export function fmtOffset(val: number | null | undefined): string {
  if (val == null || !Number.isFinite(val)) return "—";
  return val.toFixed(4);
}

/** RPM display — plain rounded integer. No locale grouping: thousands
 *  separators (e.g. Swiss 1'400) appear nowhere else in the UI. */
export function fmtRpm(val: number | null): string {
  if (val == null) return "---";
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

/** File size — B/KB/MB */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

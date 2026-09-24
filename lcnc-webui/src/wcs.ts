// Work-coordinate-system names — the ONE source (WP1). LinuxCNC's
// g5x_index is 1-based (1 = G54 … 9 = G59.3), matching the gateway's
// _G5X_MAP. Everything that names a fixture derives from here: the status
// label, the WCS selector, the offsets table, the viewer's fixture markers.

import { NO_VALUE } from "./format";

export const G5X_LABELS = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"] as const;
export type G5xLabel = (typeof G5X_LABELS)[number];

/** g5x index (1..9) → fixture name; NO_VALUE while status has none, and an honest
 *  `G5x#n` for an index outside the table (never a silent G54). */
export function g5xLabel(idx: number | null | undefined): string {
  if (idx == null) return NO_VALUE;
  return G5X_LABELS[idx - 1] ?? `G5x#${idx}`;
}

/** G59..G59.3: the TWP remap's scratch rows on a TWP-capable machine —
 *  rewritten by every orient, never an operator's touch-off target. */
export const RESERVED_WCS: ReadonlySet<string> = new Set(["G59", "G59.1", "G59.2", "G59.3"]);

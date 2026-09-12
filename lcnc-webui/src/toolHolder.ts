import type { HolderSegment, ToolMeta } from "./toolGeometry";

// No Three.js runtime import: the tool dialog must retain its lazy preview.
export function validHolderSegments(segments: HolderSegment[] | null | undefined): boolean {
  return !!segments?.length && segments.every(s =>
    Number.isFinite(s.height) && s.height > 0
    && Number.isFinite(s.lower_diameter) && s.lower_diameter >= 0
    && Number.isFinite(s.upper_diameter) && s.upper_diameter >= 0
  ) && segments.some(s => s.lower_diameter > 0 || s.upper_diameter > 0);
}

/** Nominal Fusion placement, measured from the physical tool tip.
 * This is a library preview coordinate, not an installed spindle reference.
 * Missing LB must not fall back to OAL, gauge length or a measured Z offset.
 */
export function nominalHolderBase(meta: ToolMeta | null | undefined): number | null {
  const lb = meta?.body_length;
  return typeof lb === "number" && Number.isFinite(lb) && lb >= 0
    && validHolderSegments(meta?.holder_segments) ? lb : null;
}

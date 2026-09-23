// Where a help popover goes (UX-11; review round 5, UI-I13): below its
// trigger when the whole popover fits there, else above it, else on the
// roomier side with its height capped so the content scrolls INSIDE the
// viewport. Pure geometry in ONE coordinate space — the caller passes
// viewport px (getBoundingClientRect / window.inner*) and converts the
// result into the popover's own CSS px (÷ CSS zoom) itself.

export interface Box { left: number; top: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Placement {
  top: number;
  left: number;
  /** Cap when the popover fits on neither side, else null. */
  maxHeight: number | null;
  side: "below" | "above";
}

export function placePopover(trigger: Box, size: Size, viewport: Size, margin: number): Placement {
  const triggerBottom = trigger.top + trigger.height;
  const below = viewport.height - margin - (triggerBottom + margin);
  const above = trigger.top - margin - margin;
  let side: "below" | "above";
  let top: number;
  let maxHeight: number | null = null;
  if (size.height <= below) {
    side = "below"; top = triggerBottom + margin;
  } else if (size.height <= above) {
    side = "above"; top = trigger.top - margin - size.height;
  } else if (below >= above) {
    side = "below"; top = triggerBottom + margin; maxHeight = Math.max(0, below);
  } else {
    side = "above"; top = margin; maxHeight = Math.max(0, above);
  }
  let left = trigger.left + trigger.width / 2 - size.width / 2;
  if (left + size.width > viewport.width - margin) left = viewport.width - size.width - margin;
  if (left < margin) left = margin;
  return { top, left, maxHeight, side };
}

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

/** `prefer` picks the first side tried: a help popover opens below its
 *  trigger, a control hint above it (the finger covers the control from
 *  below — design wave D1, UI-D08). `align`: centred on the trigger, or its
 *  END edge on the trigger's (a "More" panel under a button at a row's right
 *  end). Either way clamped into the viewport. */
export function placePopover(trigger: Box, size: Size, viewport: Size, margin: number,
                             prefer: "below" | "above" = "below",
                             align: "center" | "end" = "center"): Placement {
  const triggerBottom = trigger.top + trigger.height;
  const below = viewport.height - margin - (triggerBottom + margin);
  const above = trigger.top - margin - margin;
  let side: "below" | "above";
  let top: number;
  let maxHeight: number | null = null;
  const fitsBelow = size.height <= below, fitsAbove = size.height <= above;
  if (fitsAbove && (prefer === "above" || !fitsBelow)) {
    side = "above"; top = trigger.top - margin - size.height;
  } else if (fitsBelow) {
    side = "below"; top = triggerBottom + margin;
  } else if (below >= above) {
    side = "below"; top = triggerBottom + margin; maxHeight = Math.max(0, below);
  } else {
    side = "above"; top = margin; maxHeight = Math.max(0, above);
  }
  let left = align === "end" ? trigger.left + trigger.width - size.width
                             : trigger.left + trigger.width / 2 - size.width / 2;
  if (left + size.width > viewport.width - margin) left = viewport.width - size.width - margin;
  if (left < margin) left = margin;
  return { top, left, maxHeight, side };
}

/** The CSS zoom an element renders under: `currentCSSZoom` where the browser
 *  has it, else the ratio of the element's two measures; 1 without zoom.
 *  Viewport px (getBoundingClientRect) ÷ this = the element's own CSS px. */
export function cssZoomOf(el: HTMLElement): number {
  const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom;
  if (typeof z === "number" && z > 0) return z;
  const w = el.offsetWidth;
  return w > 0 ? el.getBoundingClientRect().width / w : 1;
}

/**
 * One-shot touch-mode detection.
 *
 * Sets `<html class="touch-device">` on the first observed touch input.
 * CSS uses `html:not(.touch-device)` to gate `:hover`/`:active` pseudo-classes,
 * which sidesteps the unreliable `@media (hover: hover)` query on Linux Firefox
 * and Chromium when both touch and mouse are connected.
 *
 * Once a session sees touch, it stays in touch mode — refresh to reset.
 */

import { ref } from "vue";

let installed = false;

/** Reactive mirror of the html.touch-device class — for JS that must stay
    in sync with the CSS touch layer (e.g. GcodePanel's virtual-scroll
    line height matching the .codeLine CSS height). */
export const isTouchDevice = ref(false);

function onFirstTouch(e: PointerEvent): void {
  if (e.pointerType !== "touch") return;
  document.documentElement.classList.add("touch-device");
  isTouchDevice.value = true;
  document.removeEventListener("pointerdown", onFirstTouch, true);
}

/** Where a long press may still open the browser's own menu: editable text
    (copy / paste in a field, the G-code editor). */
function isEditableText(t: EventTarget | null): boolean {
  if (!(t instanceof Element)) return false;
  if (t.closest("textarea, [contenteditable=''], [contenteditable='true'], .cm-content")) return true;
  const input = t.closest("input");
  return !!input && !input.readOnly && !["button", "checkbox", "radio", "range", "color", "file"].includes(input.type);
}

/** A long press on a touchscreen is a hold, never a right click (operator,
    real machine, 2026-09-26): Chromium turns the end of a long press into
    `contextmenu` — the hold's action ran AND the browser's menu popped up
    over the controls. On touch (the event's pointer, or the session's
    touch mode) the menu is refused everywhere but in editable text; a
    mouse right click on a desktop keeps the browser's menu. */
export function refusesContextMenu(e: MouseEvent): boolean {
  const pt = (e as PointerEvent).pointerType;
  const touch = pt === "touch" || pt === "pen" || document.documentElement.classList.contains("touch-device");
  return touch && !isEditableText(e.target);
}
function onContextMenu(e: MouseEvent): void {
  if (refusesContextMenu(e)) e.preventDefault();
}

export function initTouchDetect(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("pointerdown", onFirstTouch, true);
  document.addEventListener("contextmenu", onContextMenu, true);
}

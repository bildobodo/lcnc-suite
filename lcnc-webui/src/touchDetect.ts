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

export function initTouchDetect(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("pointerdown", onFirstTouch, true);
}

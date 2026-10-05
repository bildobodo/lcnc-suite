/**
 * ONE clock for every flash (operator 2026-10-05).
 *
 * The E-Stop button's Reset (Btn.vue `flash-estop`) and the state banner
 * (App.vue `flash-danger`) both flash on `--flash-duration` (0.6 s,
 * step-start) — the same RATE, but a CSS animation's PHASE starts when its
 * own element starts flashing: the banner flashes from the safety trip (or a
 * lost connection) on, the button only from the E-Stop state a status later
 * — measured 315 ms apart in the mock, half a period, the two blinking
 * against each other.
 *
 * Every flash animation is put on the document timeline's own phase
 * (`startTime = 0`): its local time is the timeline's time, so every flash of
 * one duration is in step whenever and however often its element starts —
 * a re-mount included. The start frame shows the "off" half like an element
 * that does not flash (step-start takes the 50 % keyframe from the start), so
 * the alignment one frame later shows no jump. Only `flash-` keyframes (Vue's
 * scoped names keep the prefix: `flash-estop-<hash>`): a transition, the
 * banner's fade and the gentle pulses are left alone. Under
 * `prefers-reduced-motion` nothing flashes and nothing starts.
 */

export const FLASH_PREFIX = "flash-";

interface AnimationStartLike {
  animationName: string;
  target: EventTarget | null;
}

/** The `animationstart` handler: put the started flash on the one clock. */
export function onFlashStart(e: AnimationStartLike): void {
  if (!e.animationName.startsWith(FLASH_PREFIX)) return;
  const el = e.target as { getAnimations?: () => Animation[] } | null;
  if (typeof el?.getAnimations !== "function") return;
  for (const a of el.getAnimations()) {
    if ((a as Partial<CSSAnimation>).animationName === e.animationName) a.startTime = 0;
  }
}

let installed = false;

/** Listen once, at the document (animationstart bubbles). */
export function initFlashClock(doc: Document = document): void {
  if (installed) return;
  installed = true;
  doc.addEventListener("animationstart", onFlashStart, true);
}

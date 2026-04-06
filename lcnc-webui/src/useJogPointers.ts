/**
 * Centralized jog pointer safety registry.
 *
 * All jog components (JogButton, JogPanel, JogStrip) register their active
 * pointers here. Document-level listeners act as a safety net for missed
 * pointerup/pointercancel events — critical on touchscreens where the browser
 * may swallow pointer events during gesture detection.
 *
 * Singleton module (like lcncWs.ts) — one registry, one set of listeners.
 */
import { reactive } from "vue";

interface JogPointer {
  key: string;
  stopFn: () => void;
  element: Element | null;
}

const activePointers = new Map<number, JogPointer>();

/** Reactive set of active jog keys — components bind to this for visual highlighting. */
export const activeJogKeys = reactive(new Set<string>());

/**
 * Register a pointer that is actively jogging.
 * Call AFTER sending the jog command and capturing the pointer.
 */
export function registerJog(
  pointerId: number,
  key: string,
  stopFn: () => void,
  element: Element | null,
): void {
  activePointers.set(pointerId, { key, stopFn, element });
  activeJogKeys.add(key);
}

/**
 * Unregister a pointer (normal release path).
 * Does NOT call stopFn — the component handles its own stop command.
 */
export function unregisterJog(pointerId: number): void {
  const entry = activePointers.get(pointerId);
  if (!entry) return;
  activeJogKeys.delete(entry.key);
  activePointers.delete(pointerId);
}

/**
 * Force-stop a specific pointer's jog (safety net path).
 * Calls the registered stopFn, releases pointer capture, clears state.
 */
export function forceStopJog(pointerId: number): void {
  const entry = activePointers.get(pointerId);
  if (!entry) return;
  activeJogKeys.delete(entry.key);
  activePointers.delete(pointerId);
  entry.stopFn();
  if (entry.element) {
    try { entry.element.releasePointerCapture(pointerId); } catch {}
  }
}

/**
 * Force-stop ALL registered jogs. Called by App.vue's stopAllJog().
 */
export function forceStopAllJogs(): void {
  for (const [pointerId, entry] of activePointers) {
    entry.stopFn();
    if (entry.element) {
      try { entry.element.releasePointerCapture(pointerId); } catch {}
    }
  }
  activePointers.clear();
  activeJogKeys.clear();
}

// ── Document-level safety listeners ──

function onPointerEnd(e: PointerEvent): void {
  if (activePointers.has(e.pointerId)) {
    forceStopJog(e.pointerId);
  }
}

function onBlur(): void {
  if (activePointers.size > 0) forceStopAllJogs();
}

function onVisibilityChange(): void {
  if (document.hidden && activePointers.size > 0) forceStopAllJogs();
}

let initialized = false;

/** Install document-level safety listeners. Call once from App.vue onMounted. */
export function initJogPointerSafety(): void {
  if (initialized) return;
  initialized = true;
  document.addEventListener("pointerup", onPointerEnd);
  document.addEventListener("pointercancel", onPointerEnd);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);
}

/** Remove listeners. Call from App.vue onUnmounted. */
export function destroyJogPointerSafety(): void {
  if (!initialized) return;
  initialized = false;
  document.removeEventListener("pointerup", onPointerEnd);
  document.removeEventListener("pointercancel", onPointerEnd);
  window.removeEventListener("blur", onBlur);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  forceStopAllJogs();
}

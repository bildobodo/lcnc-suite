// Modal registry — the ONE answer to "is a dialog open?" for the global
// keyboard shortcut map (WP0, UI-03).
//
// Every component that renders a `.dialogOverlay` registers its open state
// here (registerModal). While anything is registered open — or the number
// keypad is up — the shortcut map lets only E-Stop through: a dialog is not
// an operating position, so Space (Cycle Start), Backspace (Abort) and the
// jog keys must not reach the machine from behind it. Abort stays reachable
// by button and banner.
//
// Registration is explicit and per component so the guard spec can compare
// the DOM's `.dialogOverlay` count with `modalCount` (self-test): a dialog
// that forgot to register shows up as a mismatch, never as a silent gap.
import { computed, getCurrentInstance, onUnmounted, ref, watch, type Ref } from "vue";
import { helperOpen } from "./inputSession";

const openCount = ref(0);

/** Number of registered dialogs currently open (keypad excluded). */
export const modalCount = computed(() => openCount.value);

/** True while any registered dialog or an input helper (number keypad or
 *  text keyboard) is open. */
export const modalOpen = computed(() => openCount.value > 0 || helperOpen.value);

/**
 * Register a dialog's open state. Call from a component's setup; the entry
 * is counted while the source is truthy and released when it turns false
 * or the component unmounts (a dialog component that IS the overlay passes
 * `() => true`).
 */
export function registerModal(isOpen: Ref<boolean> | (() => boolean)): void {
  let counted = false;
  const release = () => { if (counted) { openCount.value--; counted = false; } };
  const stop = watch(isOpen, (open) => {
    if (open && !counted) { openCount.value++; counted = true; }
    else if (!open) release();
  }, { immediate: true });
  if (getCurrentInstance()) onUnmounted(() => { stop(); release(); });
}

// Diagnostics hook for the guard spec's DOM-vs-registry self-test.
if (typeof window !== "undefined") {
  (window as any).__modalRegistry = { count: () => openCount.value, open: () => modalOpen.value };
}

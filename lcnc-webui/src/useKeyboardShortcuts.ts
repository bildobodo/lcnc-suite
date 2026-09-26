// Keyboard-shortcut handling, extracted from App.vue.
//
// Owns the keyboard config (jogEnabled / buttonsEnabled / mapping) plus
// a derived reverseKeyMap (key → action) and the active-jog-action set
// used to translate keyup events back into jog_stop commands.
//
// The E-Stop path is a CAPTURE listener registered at setup time (before
// any child component can mount its own capture listener) and does nothing
// but send `estop`. The regular shortcut map is a bubbling keydown/keyup
// pair attached in onMounted. Cross-client sync (settingsVersion bumps)
// re-reads from loadKeyboardDefaults so a save on another tab is reflected.
//
// stopAllJog is App.vue's responsibility (it also clears pointer + gamepad
// jog state); this composable exposes clearJogState() so the global stop
// can clear our internal Set in the same call.

import { ref, reactive, computed, watch, onMounted, onUnmounted, type Ref, type ComputedRef } from "vue";
import {
  loadKeyboardDefaults, saveKeyboardDefaults, settingsVersion, normalizeKeyboardMapping,
  ESTOP_KEY, type KeyboardDefaults, type KeyboardAction,
} from "./defaults";
import type { Permissions } from "./permissions";
import type { WsCommand } from "./lcnc";

import { isRotaryAxis } from "./useAxes";

interface UseKeyboardShortcutsOptions {
  jogVel: Ref<number>;
  angularJogVel: Ref<number>;
  jogIncrement: Ref<number>;
  axes: ComputedRef<string[]>;
  permissions: Ref<Permissions>;
  canEstop: ComputedRef<boolean>;
  activeFile: Ref<string | null>;
  /** True while a dialog or the number keypad is open (modalRegistry). */
  modalOpen: ComputedRef<boolean>;
  /** True while the G-code editor is open — Cycle Start never runs a
   *  program whose buffer is being edited. */
  editing: Ref<boolean>;
  send: (cmd: WsCommand) => void;
  fire: (payload: any, gate?: keyof Permissions, cooldownMs?: number) => void;
}

export function useKeyboardShortcuts(opts: UseKeyboardShortcutsOptions) {
  const keyboardConfig = ref<KeyboardDefaults>(loadKeyboardDefaults());

  const reverseKeyMap = computed(() => {
    const map = new Map<string, KeyboardAction>();
    for (const [action, key] of Object.entries(keyboardConfig.value.mapping)) {
      if (key) map.set(key, action as KeyboardAction);
    }
    return map;
  });

  const jogActions = reactive(new Set<string>());

  function jogActionToAxis(action: string): { axis: number; dir: 1 | -1; isAngular: boolean } | null {
    const match = action.match(/^jog_([a-z])([+-])$/);
    if (!match) return null;
    const letter = match[1]!.toUpperCase();
    const dir = match[2] === "+" ? 1 : -1;
    const idx = opts.axes.value.indexOf(letter);
    if (idx < 0) return null;
    return { axis: idx, dir, isAngular: isRotaryAxis(letter) };
  }

  function isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!(el as HTMLElement).isContentEditable;
  }

  // Space and Enter ACTIVATE whatever has focus — they belong to that
  // element, not to the global shortcut map (R-06, implementation review
  // 2026-09-16; widened in WP0). With the default mapping Space is Cycle
  // Start, so a focused button started the loaded program AND never fired
  // itself. The rule is "anything focused": the keypad strip's root
  // (tabindex=-1) is focused while the operator types a value, and it is
  // not in any interactive selector — Space there reached the map and
  // started the program (P0, 2026-09-19). E-Stop is handled BEFORE this and
  // stays deliberately global.
  const ACTIVATION_KEYS = new Set([" ", "Spacebar", "Enter"]);

  function isActivationOnFocusedElement(e: KeyboardEvent): boolean {
    if (!ACTIVATION_KEYS.has(e.key)) return false;
    const el = document.activeElement;
    return !!el && el !== document.body && el !== document.documentElement;
  }

  // ── E-Stop: reserved key, capture phase, nothing else ──
  // Escape is not re-bindable (KeyboardTab shows it fixed; the mapping is
  // normalized on load). Registered at SETUP time in the capture phase so it
  // precedes every capture listener a child mounts later (KeyboardTab's key
  // capture used to stopPropagation() and swallow it). The reset branch is
  // gone: E-Stop Reset is a button, only (operator decision 2026-09-19).
  function onEstopKey(e: KeyboardEvent) {
    if (e.key !== ESTOP_KEY) return;
    e.preventDefault();
    if (opts.canEstop.value) opts.send({ cmd: "estop" });
  }
  if (typeof window !== "undefined") window.addEventListener("keydown", onEstopKey, true);

  function onKeyDown(e: KeyboardEvent) {
    const action = reverseKeyMap.value.get(e.key);
    if (!action) return;
    if (action === "estop") return;  // handled by the capture listener above

    // Already handled by a component (the refusal explanation stops
    // propagation; this is the backstop for anything that only prevents the
    // default), or an activation key on a focused element.
    if (e.defaultPrevented || isActivationOnFocusedElement(e)) return;

    // A dialog or the keypad is open: nothing but E-Stop reaches the machine
    // from behind it (not even Abort — it stays a button and a banner action).
    if (opts.modalOpen.value) return;

    if (isInputFocused()) return;

    // Jog actions — gated by jogEnabled independently
    if (action.startsWith("jog_")) {
      if (!keyboardConfig.value.jogEnabled) return;
      e.preventDefault();
      if (e.repeat || jogActions.has(action)) return;
      if (!opts.permissions.value.jog) return;
      const jog = jogActionToAxis(action);
      if (!jog) return;
      jogActions.add(action);
      const vel = (jog.isAngular ? opts.angularJogVel.value : opts.jogVel.value) * jog.dir;
      if (opts.jogIncrement.value > 0) {
        opts.send({ cmd: "jog_incr", axis: jog.axis, vel, distance: opts.jogIncrement.value * jog.dir });
      } else {
        opts.send({ cmd: "jog_cont", axis: jog.axis, vel });
      }
      return;
    }

    // Command shortcuts — gated by buttonsEnabled independently
    if (!keyboardConfig.value.buttonsEnabled) return;

    // Cycle start / pause / resume. Only the START branch carries the `run`
    // gate and the editor guard: pause/resume must stay reachable exactly as
    // before, while a start needs a runnable program that nobody is editing.
    if (action === "cycle") {
      e.preventDefault();
      if (opts.permissions.value.resume) opts.fire({ cmd: "cycle_resume" }, 'resume');
      else if (opts.permissions.value.pause) opts.fire({ cmd: "cycle_pause" }, 'pause');
      else if (opts.permissions.value.run && !opts.editing.value && !!opts.activeFile.value) opts.fire({ cmd: "cycle_start" }, 'run');
      return;
    }

    // Abort
    if (action === "abort") {
      e.preventDefault();
      if (opts.permissions.value.abort) opts.fire({ cmd: "abort" }, 'abort');
      return;
    }
  }

  // Keyup is deliberately UNFILTERED: a field or dialog opened while a jog
  // key is held must not suppress the release → jog_stop (the guards above
  // live in the keydown path only).
  function onKeyUp(e: KeyboardEvent) {
    const action = reverseKeyMap.value.get(e.key);
    if (!action || !action.startsWith("jog_")) return;
    if (jogActions.has(action)) {
      jogActions.delete(action);
      if (opts.jogIncrement.value <= 0) {
        const jog = jogActionToAxis(action);
        if (jog) opts.send({ cmd: "jog_stop", axis: jog.axis });
      }
    }
  }

  function setKeyboardConfig(cfg: KeyboardDefaults) {
    const normalized = { ...cfg, mapping: normalizeKeyboardMapping(cfg.mapping) };
    keyboardConfig.value = normalized;
    saveKeyboardDefaults(normalized);
  }

  /** Clear the active-jog-action set. Used by App.vue's global stopAllJog
   *  so a focus-loss / visibility-change / disabled-toggle stop is reflected
   *  in our internal state. Does NOT send jog_stop commands — that's the
   *  caller's responsibility (it also handles pointer + gamepad). */
  function clearJogState() {
    jogActions.clear();
  }

  // Cross-client sync: another tab saved keyboard config → re-read.
  watch(settingsVersion, () => {
    keyboardConfig.value = loadKeyboardDefaults();
  });

  onMounted(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", onEstopKey, true);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  });

  return {
    keyboardConfig,
    setKeyboardConfig,
    clearJogState,
    /** A keyboard jog is running (a jog key held down). */
    jogActive: computed(() => jogActions.size > 0),
  };
}

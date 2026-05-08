// Keyboard-shortcut handling, extracted from App.vue.
//
// Owns the keyboard config (jogEnabled / buttonsEnabled / mapping) plus
// a derived reverseKeyMap (key → action) and the active-jog-action set
// used to translate keyup events back into jog_stop commands.
//
// onMounted attaches global keydown/keyup listeners on window; onUnmounted
// detaches them. Cross-client sync (settingsVersion bumps) re-reads from
// loadKeyboardDefaults so a save on another tab is reflected here.
//
// stopAllJog is App.vue's responsibility (it also clears pointer + gamepad
// jog state); this composable exposes clearJogState() so the global stop
// can clear our internal Set in the same call.

import { ref, reactive, computed, watch, onMounted, onUnmounted, type Ref, type ComputedRef } from "vue";
import {
  loadKeyboardDefaults, saveKeyboardDefaults, settingsVersion,
  type KeyboardDefaults, type KeyboardAction,
} from "./defaults";
import type { Permissions } from "./permissions";
import type { WsCommand } from "./lcnc";

const ANGULAR_LETTERS = new Set(["A", "B", "C"]);

interface UseKeyboardShortcutsOptions {
  jogVel: Ref<number>;
  angularJogVel: Ref<number>;
  jogIncrement: Ref<number>;
  axes: ComputedRef<string[]>;
  permissions: Ref<Permissions>;
  canEstop: ComputedRef<boolean>;
  canResetEstop: ComputedRef<boolean>;
  activeFile: Ref<string | null>;
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
    return { axis: idx, dir, isAngular: ANGULAR_LETTERS.has(letter) };
  }

  function isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!(el as HTMLElement).isContentEditable;
  }

  function onKeyDown(e: KeyboardEvent) {
    const action = reverseKeyMap.value.get(e.key);
    if (!action) return;

    // E-Stop always fires — bypasses master toggle and input focus
    if (action === "estop") {
      e.preventDefault();
      if (opts.canEstop.value) opts.send({ cmd: "estop" });
      else if (opts.canResetEstop.value) opts.send({ cmd: "estop_reset" });
      return;
    }

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

    // Cycle start / pause / resume
    if (action === "cycle") {
      e.preventDefault();
      if (opts.permissions.value.resume) opts.fire({ cmd: "cycle_resume" }, 'resume');
      else if (opts.permissions.value.pause) opts.fire({ cmd: "cycle_pause" }, 'pause');
      else if (opts.permissions.value.ready && !!opts.activeFile.value) opts.fire({ cmd: "cycle_start" }, 'ready');
      return;
    }

    // Abort
    if (action === "abort") {
      e.preventDefault();
      if (opts.permissions.value.abort) opts.fire({ cmd: "abort" }, 'abort');
      return;
    }
  }

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
    keyboardConfig.value = cfg;
    saveKeyboardDefaults(cfg);
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
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  });

  return {
    keyboardConfig,
    setKeyboardConfig,
    clearJogState,
  };
}

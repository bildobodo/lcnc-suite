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
// The map that ACTS is the server's (button gates BG-19): a change made
// here is a draft (`keyboardDraft`, what Settings shows) until the server
// holds it — a refused save (not armed) changes no key.
//
// stopAllJog is App.vue's responsibility (it also clears pointer + gamepad
// jog state); this composable exposes clearJogState() so the global stop
// can clear our internal Set in the same call.

import { ref, reactive, computed, watch, onMounted, onUnmounted, type Ref, type ComputedRef } from "vue";
import {
  loadKeyboardDefaults, loadKeyboardDraft, saveKeyboardDefaults, settingsVersion, normalizeKeyboardMapping,
  ESTOP_KEY, type KeyboardDefaults, type KeyboardAction,
} from "./defaults";
import type { Permissions } from "./permissions";
import type { WsCommand } from "./lcnc";

import { isRotaryAxis } from "./useAxes";
import { JogGestures, type JogGesture } from "./jogGesture";
import { ACTION_GATES, startAdmitted, type StartContext } from "./actionAdmission";

interface UseKeyboardShortcutsOptions {
  jogVel: Ref<number>;
  angularJogVel: Ref<number>;
  jogIncrement: Ref<number>;
  axes: ComputedRef<string[]>;
  permissions: Ref<Permissions>;
  canEstop: ComputedRef<boolean>;
  /** Start's program context (actionAdmission.ts — the button's own rule). */
  startContext: Ref<StartContext>;
  /** Why this axis may not jog now beyond the `jog` class — before homing, an
   *  axis the machine closes (package E, jointJog.ts); null when it may. */
  jogAxisRefusal: (axis: number) => string | null;
  /** True while a dialog or the number keypad is open (modalRegistry). */
  modalOpen: ComputedRef<boolean>;
  send: (cmd: WsCommand) => void;
  fire: (payload: WsCommand, gate?: keyof Permissions, cooldownMs?: number) => void;
}

export function useKeyboardShortcuts(opts: UseKeyboardShortcutsOptions) {
  const keyboardConfig = ref<KeyboardDefaults>(loadKeyboardDefaults());
  const keyboardDraft = ref<KeyboardDefaults>(loadKeyboardDraft());

  const reverseKeyMap = computed(() => {
    const map = new Map<string, KeyboardAction>();
    for (const [action, key] of Object.entries(keyboardConfig.value.mapping)) {
      if (key) map.set(key, action as KeyboardAction);
    }
    return map;
  });

  // The keyboard jogs in progress, keyed by the PHYSICAL key that started
  // them (`code`), each with what it STARTED (BG-06): the keyup stops that —
  // never what the step, the key map (a remap saved on another client while
  // the key is held, Codex R205) or a modifier (Shift turns "q" into "Q")
  // say by then.
  const jogGestures = new JogGestures<string>(reactive(new Map<string, JogGesture>()));
  const physicalKey = (e: KeyboardEvent) => e.code || e.key;

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
      if (e.repeat || jogGestures.has(physicalKey(e))) return;
      if (!opts.permissions.value.jog) return;
      const jog = jogActionToAxis(action);
      if (!jog || opts.jogAxisRefusal(jog.axis)) return;
      const vel = (jog.isAngular ? opts.angularJogVel.value : opts.jogVel.value) * jog.dir;
      const step = opts.jogIncrement.value;
      if (step > 0) {
        opts.send({ cmd: "jog_incr", axis: jog.axis, vel, distance: step * jog.dir });
      } else {
        opts.send({ cmd: "jog_cont", axis: jog.axis, vel });
      }
      jogGestures.start(physicalKey(e), { axes: [jog.axis], cont: !(step > 0) });
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
      else if (startAdmitted(opts.permissions.value, opts.startContext.value)) opts.fire({ cmd: "cycle_start" }, ACTION_GATES.start);
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
    const stop = jogGestures.end(physicalKey(e));
    if (stop) opts.send(stop);
  }

  /** A change from Settings: the draft now, the active map once the server
   *  confirms it (the settingsVersion watch below). */
  function setKeyboardConfig(cfg: KeyboardDefaults) {
    const normalized = { ...cfg, mapping: normalizeKeyboardMapping(cfg.mapping) };
    keyboardDraft.value = normalized;
    saveKeyboardDefaults(normalized);
  }

  /** End every keyboard jog with the stop it owns. Used by App.vue's global
   *  stopAllJog (focus loss, visibility change, a disabled toggle, a tab
   *  switch): each continuous gesture's own axis, whatever the step or the
   *  key map say now (BG-06). */
  function stopJogs() {
    for (const c of jogGestures.endAll()) opts.send(c);
  }

  // The server's settings changed (this tab's save confirmed, another
  // client's, a reconnect) → re-read what acts and what the form shows.
  watch(settingsVersion, () => {
    keyboardConfig.value = loadKeyboardDefaults();
    keyboardDraft.value = loadKeyboardDraft();
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
    keyboardDraft,
    setKeyboardConfig,
    stopJogs,
    /** A keyboard jog is running (a jog key held down). */
    jogActive: computed(() => jogGestures.size > 0),
  };
}

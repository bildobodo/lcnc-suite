// ─── Gamepad jogging composable ──────────────────────────────────
//
// Polls the browser Gamepad API at ~60Hz via requestAnimationFrame.
// Left stick → XY continuous jog (proportional to deflection).
// Right stick Y → Z continuous jog (proportional).
// D-pad → discrete jog at full jogVel (or incremental when jogIncrement > 0).
// Button presses → configurable actions (edge-triggered).
//
// All jog commands go through the same send() as keyboard jog.
// Safety: stops all axes on disconnect, blur, permission loss, settings open.

import { ref, watch, type Ref, type ComputedRef } from "vue";
import type { WsCommand } from "./lcnc";
import { BTN_INDEX_TO_KEY, type GamepadAction, type GamepadDefaults } from "./defaults";
import { status } from "./lcncWs";

interface Permissions {
  jog: boolean;
  idle: boolean;
  ready: boolean;
  abort: boolean;
  pause: boolean;
  resume: boolean;
}

type GateKey = keyof Permissions;

// D-pad button indices (standard gamepad mapping)
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;

// Minimum interval between jog velocity updates per axis (ms)
// Stops and direction changes bypass this throttle.
const VEL_UPDATE_INTERVAL = 200; // 5 Hz for smooth velocity changes
// Minimum velocity change (fraction of jogVel) to trigger a velocity update
const VEL_EPSILON = 0.10;

export function useGamepad(deps: {
  jogVel: Ref<number>;
  angularJogVel: Ref<number>;
  jogIncrement: Ref<number>;
  permissions: ComputedRef<Permissions>;
  send: (cmd: WsCommand) => void;
  fire: (cmd: WsCommand, gate?: GateKey) => void;
  activeFile: ComputedRef<string | null>;
  config: Ref<GamepadDefaults>;
  axisCount: ComputedRef<number>;
  gated: Ref<boolean>;
}) {
  const gamepadConnected = ref(false);
  const gamepadName = ref("");
  const gamepadAxesState = ref<number[]>([]);
  const gamepadButtonsState = ref<boolean[]>([]);

  let gpIndex: number | null = null;
  let rafId = 0;

  // Per-axis tracking: last velocity we sent
  const lastSentVel: number[] = [];
  // Per-axis: last send timestamp
  const lastSendTime: number[] = [];
  // Button edge detection
  let prevButtons: boolean[] = [];

  function applyDeadZone(raw: number, dz: number): number {
    const abs = Math.abs(raw);
    if (abs < dz) return 0;
    return Math.sign(raw) * (abs - dz) / (1 - dz);
  }

  function stopAllJog() {
    const n = deps.axisCount.value || 3;
    for (let i = 0; i < n; i++) {
      if (lastSentVel[i] !== 0 && lastSentVel[i] !== undefined) {
        deps.send({ cmd: "jog_stop", axis: i });
        lastSentVel[i] = 0;
      }
    }
  }

  function sendJog(axis: number, vel: number, now: number) {
    const prev = lastSentVel[axis] ?? 0;
    const prevTime = lastSendTime[axis] ?? 0;

    if (vel === 0 && prev === 0) return; // already stopped

    // STOP: always immediate, never throttled
    if (vel === 0 && prev !== 0) {
      deps.send({ cmd: "jog_stop", axis });
      lastSentVel[axis] = 0;
      lastSendTime[axis] = now;
      return;
    }

    // DIRECTION CHANGE: stop first, then start in new direction
    if (prev !== 0 && Math.sign(vel) !== Math.sign(prev)) {
      deps.send({ cmd: "jog_stop", axis });
      deps.send({ cmd: "jog_cont", axis, vel });
      lastSentVel[axis] = vel;
      lastSendTime[axis] = now;
      return;
    }

    // START: first movement from zero — send immediately
    if (prev === 0) {
      deps.send({ cmd: "jog_cont", axis, vel });
      lastSentVel[axis] = vel;
      lastSendTime[axis] = now;
      return;
    }

    // VELOCITY UPDATE: heavily throttled to avoid command queue buildup
    const dt = now - prevTime;
    const dv = Math.abs(vel - prev);
    if (dt < VEL_UPDATE_INTERVAL || dv < Math.abs(deps.jogVel.value * VEL_EPSILON)) {
      return;
    }

    deps.send({ cmd: "jog_cont", axis, vel });
    lastSentVel[axis] = vel;
    lastSendTime[axis] = now;
  }

  /** Dispatch a configurable button action. */
  function dispatchAction(action: GamepadAction) {
    const perms = deps.permissions.value;
    switch (action) {
      case "start":
        if (perms.resume) deps.fire({ cmd: "cycle_resume" }, 'resume');
        else if (perms.ready && deps.activeFile.value) deps.fire({ cmd: "cycle_start" }, 'ready');
        break;
      case "pause":
        if (perms.pause) deps.fire({ cmd: "cycle_pause" }, 'pause');
        break;
      case "resume":
        if (perms.resume) deps.fire({ cmd: "cycle_resume" }, 'resume');
        break;
      case "abort":
        if (perms.abort) deps.fire({ cmd: "abort" }, 'abort');
        break;
      case "estop":
        deps.send({ cmd: "estop" }); // no permission gate — E-Stop must always work
        break;
      case "spindle_stop":
        if (perms.ready) deps.fire({ cmd: "spindle_stop" }, 'ready');
        break;
      case "flood_toggle": {
        if (!perms.ready) break;
        const floodOn = !!status.value?.data?.flood;
        deps.fire({ cmd: floodOn ? "flood_off" : "flood_on" }, 'ready');
        break;
      }
      case "mist_toggle": {
        if (!perms.ready) break;
        const mistOn = !!status.value?.data?.mist;
        deps.fire({ cmd: mistOn ? "mist_off" : "mist_on" }, 'ready');
        break;
      }
      case "home_all":
        if (perms.idle) deps.fire({ cmd: "home_all" }, 'idle');
        break;
      // z_mod, dead_man, none are not dispatchable actions
    }
  }

  /** Check if any button assigned to the given action is currently held. */
  function isActionHeld(currButtons: boolean[], action: GamepadAction): boolean {
    const mapping = deps.config.value.mapping;
    for (const [idxStr, key] of Object.entries(BTN_INDEX_TO_KEY)) {
      if (mapping[key] === action && (currButtons[Number(idxStr)] ?? false)) {
        return true;
      }
    }
    return false;
  }

  /** Check if any button is assigned to the given action. */
  function hasActionMapped(action: GamepadAction): boolean {
    const mapping = deps.config.value.mapping;
    for (const key of Object.values(BTN_INDEX_TO_KEY)) {
      if (mapping[key] === action) return true;
    }
    return false;
  }

  /** Dead man satisfied: no dead_man mapped, or any dead_man button is held. */
  function isDeadManSatisfied(currButtons: boolean[]): boolean {
    if (!hasActionMapped("dead_man")) return true;
    return isActionHeld(currButtons, "dead_man");
  }

  // Track previous dead man state for release detection
  let prevDeadManOk = true;

  function pollLoop() {
    rafId = requestAnimationFrame(pollLoop);

    if (gpIndex === null) return;

    const gp = navigator.getGamepads()[gpIndex];
    if (!gp) return;

    const cfg = deps.config.value;
    const gated = deps.gated.value;
    const canJog = !gated && deps.permissions.value.jog;
    const now = performance.now();

    // Update reactive axis state for UI (always, even when gated)
    gamepadAxesState.value = Array.from(gp.axes);
    gamepadButtonsState.value = Array.from(gp.buttons).map(b => b.pressed);

    // When gated (settings open), stop any active jogs and skip all commands
    if (gated) {
      stopAllJog();
      // Still update prevButtons for edge detection continuity
      prevButtons = Array.from(gp.buttons).map(b => b.pressed);
      return;
    }

    // ── Dead man switch check ──
    const currButtons = Array.from(gp.buttons).map(b => b.pressed);
    const deadManOk = isDeadManSatisfied(currButtons);

    // Dead man released → stop all jog immediately
    if (prevDeadManOk && !deadManOk) {
      stopAllJog();
    }
    prevDeadManOk = deadManOk;

    const canJogNow = canJog && deadManOk && cfg.jogEnabled;

    // ── Analog sticks → continuous jog ──
    // Left stick: axes 0 (X), 1 (Y)
    const rawLX = gp.axes[0] ?? 0;
    const rawLY = gp.axes[1] ?? 0;
    // Right stick: axes 2 (unused), 3 (Z)
    const rawRY = gp.axes[3] ?? 0;

    const lx = applyDeadZone(rawLX, cfg.deadZone) * (cfg.invertX ? -1 : 1);
    const ly = applyDeadZone(rawLY, cfg.deadZone) * (cfg.invertY ? 1 : -1); // Y axis inverted by default (stick down = positive)
    const rz = applyDeadZone(rawRY, cfg.deadZone) * (cfg.invertZ ? 1 : -1); // Same inversion

    if (canJogNow) {
      const maxVel = deps.jogVel.value;
      sendJog(0, lx * maxVel, now); // X
      sendJog(1, ly * maxVel, now); // Y
      if (deps.axisCount.value >= 3) {
        sendJog(2, rz * maxVel, now); // Z
      }
    } else if (!deadManOk || !canJog || !cfg.jogEnabled) {
      // Lost permission, dead man released, or jog disabled — stop everything
      stopAllJog();
    }

    // ── D-pad → discrete jog ──
    if (canJogNow) {
      // D-pad: full-speed jog or incremental
      const dpadAxes: [number, number, number][] = [
        [DPAD_RIGHT, 0, 1],   // Right → X+
        [DPAD_LEFT, 0, -1],   // Left → X-
        [DPAD_UP, 1, 1],      // Up → Y+
        [DPAD_DOWN, 1, -1],   // Down → Y-
      ];

      // Check if z_mod button is held
      const zModHeld = isActionHeld(currButtons, "z_mod");

      for (const [btnIdx, axis, dir] of dpadAxes) {
        const pressed = currButtons[btnIdx] ?? false;
        const wasPressed = prevButtons[btnIdx] ?? false;

        if (zModHeld && (btnIdx === DPAD_UP || btnIdx === DPAD_DOWN)) {
          // Z axis via D-pad + z_mod
          if (pressed && !wasPressed && deps.axisCount.value >= 3) {
            const zDir = btnIdx === DPAD_UP ? 1 : -1;
            const vel = deps.jogVel.value * zDir;
            if (deps.jogIncrement.value > 0) {
              deps.send({ cmd: "jog_incr", axis: 2, vel, distance: deps.jogIncrement.value * zDir });
            } else {
              deps.send({ cmd: "jog_cont", axis: 2, vel });
              lastSentVel[2] = vel;
            }
          } else if (!pressed && wasPressed && deps.jogIncrement.value <= 0) {
            deps.send({ cmd: "jog_stop", axis: 2 });
            lastSentVel[2] = 0;
          }
          continue;
        }

        if (pressed && !wasPressed) {
          const vel = deps.jogVel.value * dir;
          if (deps.jogIncrement.value > 0) {
            deps.send({ cmd: "jog_incr", axis, vel, distance: deps.jogIncrement.value * dir });
          } else {
            deps.send({ cmd: "jog_cont", axis, vel });
            lastSentVel[axis] = vel;
          }
        } else if (!pressed && wasPressed && deps.jogIncrement.value <= 0) {
          deps.send({ cmd: "jog_stop", axis });
          lastSentVel[axis] = 0;
        }
      }
    }

    // ── Configurable button actions (edge-triggered) ──
    const mapping = cfg.mapping;
    for (const [idxStr, key] of Object.entries(BTN_INDEX_TO_KEY)) {
      const idx = Number(idxStr);
      const pressed = currButtons[idx] ?? false;
      const wasPressed = prevButtons[idx] ?? false;
      if (pressed && !wasPressed) {
        const action = mapping[key];
        if (action && action !== "none" && action !== "z_mod" && action !== "dead_man") {
          if (action === "estop" || cfg.buttonsEnabled) {
            dispatchAction(action);
          }
        }
      }
    }

    prevButtons = currButtons;
  }

  function onConnected(e: GamepadEvent) {
    if (gpIndex !== null) return; // already have one
    gpIndex = e.gamepad.index;
    gamepadConnected.value = true;
    gamepadName.value = e.gamepad.id;
    prevButtons = [];
  }

  function onDisconnected(e: GamepadEvent) {
    if (e.gamepad.index !== gpIndex) return;
    stopAllJog();
    gpIndex = null;
    gamepadConnected.value = false;
    gamepadName.value = "";
    gamepadAxesState.value = [];
    gamepadButtonsState.value = [];
    prevButtons = [];
  }

  // Stop jog when permissions drop or when gated
  watch(() => deps.permissions.value.jog, (canJog) => {
    if (!canJog) stopAllJog();
  });
  watch(deps.gated, (gated) => {
    if (gated) stopAllJog();
  });

  function start() {
    window.addEventListener("gamepadconnected", onConnected);
    window.addEventListener("gamepaddisconnected", onDisconnected);

    // Check if a gamepad is already connected
    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp) {
        gpIndex = gp.index;
        gamepadConnected.value = true;
        gamepadName.value = gp.id;
        break;
      }
    }

    rafId = requestAnimationFrame(pollLoop);
  }

  function stop() {
    cancelAnimationFrame(rafId);
    window.removeEventListener("gamepadconnected", onConnected);
    window.removeEventListener("gamepaddisconnected", onDisconnected);
    stopAllJog();
  }

  return {
    gamepadConnected,
    gamepadName,
    gamepadAxesState,
    gamepadButtonsState,
    start,
    stop,
    stopAllJog,
  };
}

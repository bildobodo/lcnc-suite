// ─── Gamepad jogging composable ──────────────────────────────────
//
// Polls the browser Gamepad API at ~60Hz via requestAnimationFrame.
// Raw state is resolved to LOGICAL controls each frame (gamepadProfile.ts):
// a per-controller capture profile when one exists for this gamepad.id,
// else the W3C standard layout. All downstream logic (jog, D-pad, button
// actions) speaks logical controls only.
// Left stick → XY continuous jog (proportional to deflection).
// Right stick Y → Z continuous jog (proportional).
// D-pad → discrete jog at full jogVel (or incremental when jogIncrement > 0).
// Button presses → configurable actions (edge-triggered).
//
// All jog commands go through the same send() as keyboard jog.
// Safety: stops all axes on disconnect, blur, permission loss, settings open.

import { ref, watch, type Ref, type ComputedRef } from "vue";
import type { WsCommand } from "./lcnc";
import type { GamepadAction, GamepadDefaults, GamepadMapping } from "./defaults";
import {
  resolveLogical, getMappingSource,
  type LogicalButton, type LogicalState, type LogicalStick, type MappingSource,
} from "./gamepadProfile";
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

// Minimum interval between jog velocity updates per axis (ms)
// Stops and direction changes bypass this throttle.
const VEL_UPDATE_INTERVAL = 200; // 5 Hz for smooth velocity changes
// Minimum velocity change (fraction of jogVel) to trigger a velocity update
const VEL_EPSILON = 0.10;
// Another connected pad pressing a button claims the active slot once the
// current pad has been button-idle this long (phantom-device recovery).
const PAD_SWITCH_IDLE_MS = 1500;

const NO_BUTTONS: Record<LogicalButton, boolean> = resolveLogical([], [], null).buttons;

export function useGamepad(deps: {
  jogVel: Ref<number>;
  angularJogVel: Ref<number>;
  jogIncrement: Ref<number>;
  permissions: ComputedRef<Permissions>;
  send: (cmd: WsCommand) => void;
  fire: (cmd: WsCommand, gate?: GateKey) => void;
  activeFile: ComputedRef<string | null>;
  config: Ref<GamepadDefaults>;
  /** Machine axis letters (viewer_init.axes) — X/Y/Z resolved by letter. */
  axes: ComputedRef<string[]>;
  gated: Ref<boolean>;
}) {
  const gamepadConnected = ref(false);
  const gamepadName = ref("");
  /** How the active pad's inputs are being interpreted (null = no pad). */
  const gamepadMappingSource = ref<MappingSource | null>(null);
  const gamepadAxesState = ref<number[]>([]);
  const gamepadButtonsState = ref<boolean[]>([]);
  /** Resolved logical state for UI (live view / wizard verification). */
  const gamepadLogicalButtons = ref<Record<LogicalButton, boolean>>({ ...NO_BUTTONS });
  const gamepadLogicalSticks = ref<Record<LogicalStick, number>>({ lx: 0, ly: 0, rz: 0 });

  let gpIndex: number | null = null;
  let rafId = 0;
  // Last time the ACTIVE pad had any raw button pressed (pad-switch arbiter).
  let lastButtonActivity = 0;

  // Per-axis tracking: last velocity we sent
  const lastSentVel: number[] = [];
  // Per-axis: last send timestamp
  const lastSendTime: number[] = [];
  // Button edge detection (logical)
  let prevButtons: Record<LogicalButton, boolean> = { ...NO_BUTTONS };

  function applyDeadZone(raw: number, dz: number): number {
    const abs = Math.abs(raw);
    if (abs < dz) return 0;
    return Math.sign(raw) * (abs - dz) / (1 - dz);
  }

  function stopAllJog() {
    const n = deps.axes.value.length || 3;
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

  /** Check if any logical button assigned to the given action is held. */
  function isActionHeld(logical: Record<LogicalButton, boolean>, action: GamepadAction): boolean {
    const mapping = deps.config.value.mapping;
    for (const [key, mapped] of Object.entries(mapping) as [keyof GamepadMapping, GamepadAction][]) {
      if (mapped === action && logical[key]) return true;
    }
    return false;
  }

  /** Check if any button is assigned to the given action. */
  function hasActionMapped(action: GamepadAction): boolean {
    const mapping = deps.config.value.mapping;
    for (const mapped of Object.values(mapping)) {
      if (mapped === action) return true;
    }
    return false;
  }

  /** Dead man satisfied: no dead_man mapped, or any dead_man button is held. */
  function isDeadManSatisfied(logical: Record<LogicalButton, boolean>): boolean {
    if (!hasActionMapped("dead_man")) return true;
    return isActionHeld(logical, "dead_man");
  }

  // Track previous dead man state for release detection
  let prevDeadManOk = true;

  function adoptPad(gp: Gamepad, now: number) {
    if (gpIndex !== null) stopAllJog();
    gpIndex = gp.index;
    gamepadConnected.value = true;
    gamepadName.value = gp.id;
    prevButtons = { ...NO_BUTTONS };
    lastButtonActivity = now;
  }

  /**
   * Another pad pressing a button while the active one is idle claims the
   * slot. Recovers from a phantom/secondary device grabbing first-connect
   * (button presses are the only unambiguous activity signal — nonstandard
   * pads idle with axes at nonzero rest values).
   */
  function arbitratePads(active: Gamepad | null, now: number) {
    const anyPressed = (gp: Gamepad) => gp.buttons.some(b => b.pressed);
    if (active && anyPressed(active)) {
      lastButtonActivity = now;
      return;
    }
    if (active && now - lastButtonActivity < PAD_SWITCH_IDLE_MS) return;
    for (const gp of navigator.getGamepads()) {
      if (gp && gp.index !== gpIndex && anyPressed(gp)) {
        adoptPad(gp, now);
        return;
      }
    }
  }

  function pollLoop() {
    rafId = requestAnimationFrame(pollLoop);

    if (gpIndex === null) return;

    const gp = navigator.getGamepads()[gpIndex];
    const now = performance.now();
    arbitratePads(gp ?? null, now);
    // Pad switched this frame — process it from the next frame's fresh state
    if (!gp || gp.index !== gpIndex) return;

    const cfg = deps.config.value;
    const gated = deps.gated.value;
    const canJog = !gated && deps.permissions.value.jog;

    const rawAxes = Array.from(gp.axes);
    const rawButtons = Array.from(gp.buttons).map(b => b.pressed);
    const profile = cfg.profiles[gp.id] ?? null;
    const logical: LogicalState = resolveLogical(rawAxes, rawButtons, profile);

    // Update reactive state for UI (always, even when gated)
    gamepadAxesState.value = rawAxes;
    gamepadButtonsState.value = rawButtons;
    gamepadLogicalButtons.value = logical.buttons;
    gamepadLogicalSticks.value = logical.sticks;
    gamepadMappingSource.value = getMappingSource(profile, gp.mapping);

    // When gated (settings open), stop any active jogs and skip all commands
    if (gated) {
      stopAllJog();
      // Still update prevButtons for edge detection continuity
      prevButtons = logical.buttons;
      return;
    }

    // ── Dead man switch check ──
    const deadManOk = isDeadManSatisfied(logical.buttons);

    // Dead man released → stop all jog immediately
    if (prevDeadManOk && !deadManOk) {
      stopAllJog();
    }
    prevDeadManOk = deadManOk;

    const canJogNow = canJog && deadManOk && cfg.jogEnabled;

    // ── Analog sticks → continuous jog ──
    // Stick semantics stay XY/Z, but MACHINE indices are resolved by letter
    // (WS-D): machines lacking X/Y/Z simply get no gamepad jog on the
    // missing axis. A full stick→any-axis remap model is a flagged
    // follow-up (ledger).
    const xi = deps.axes.value.indexOf("X");
    const yi = deps.axes.value.indexOf("Y");
    const zi = deps.axes.value.indexOf("Z");
    // Logical sticks are normalized +1 = right/up; invert toggles flip the
    // machine direction on top of that.
    const lx = applyDeadZone(logical.sticks.lx, cfg.deadZone) * (cfg.invertX ? -1 : 1);
    const ly = applyDeadZone(logical.sticks.ly, cfg.deadZone) * (cfg.invertY ? -1 : 1);
    const rz = applyDeadZone(logical.sticks.rz, cfg.deadZone) * (cfg.invertZ ? -1 : 1);

    if (canJogNow) {
      const maxVel = deps.jogVel.value;
      if (xi >= 0) sendJog(xi, lx * maxVel, now);
      if (yi >= 0) sendJog(yi, ly * maxVel, now);
      if (zi >= 0) sendJog(zi, rz * maxVel, now);
    } else if (!deadManOk || !canJog || !cfg.jogEnabled) {
      // Lost permission, dead man released, or jog disabled — stop everything
      stopAllJog();
    }

    // ── D-pad → discrete jog ──
    if (canJogNow) {
      // D-pad: full-speed jog or incremental (machine indices by letter,
      // pairs dropped when the machine lacks the axis)
      const dpadAxes: [LogicalButton, number, number][] = [];
      if (xi >= 0) dpadAxes.push(["dpad_right", xi, 1], ["dpad_left", xi, -1]);
      if (yi >= 0) dpadAxes.push(["dpad_up", yi, 1], ["dpad_down", yi, -1]);

      // Check if z_mod button is held
      const zModHeld = isActionHeld(logical.buttons, "z_mod");

      for (const [btn, axis, dir] of dpadAxes) {
        const pressed = logical.buttons[btn];
        const wasPressed = prevButtons[btn];

        if (zModHeld && (btn === "dpad_up" || btn === "dpad_down")) {
          // Z axis via D-pad + z_mod
          if (pressed && !wasPressed && zi >= 0) {
            const zDir = btn === "dpad_up" ? 1 : -1;
            const vel = deps.jogVel.value * zDir;
            if (deps.jogIncrement.value > 0) {
              deps.send({ cmd: "jog_incr", axis: zi, vel, distance: deps.jogIncrement.value * zDir });
            } else {
              deps.send({ cmd: "jog_cont", axis: zi, vel });
              lastSentVel[zi] = vel;
            }
          } else if (!pressed && wasPressed && deps.jogIncrement.value <= 0 && zi >= 0) {
            deps.send({ cmd: "jog_stop", axis: zi });
            lastSentVel[zi] = 0;
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
    for (const [key, action] of Object.entries(mapping) as [keyof GamepadMapping, GamepadAction][]) {
      if (logical.buttons[key] && !prevButtons[key]) {
        if (action && action !== "none" && action !== "z_mod" && action !== "dead_man") {
          if (action === "estop" || cfg.buttonsEnabled) {
            dispatchAction(action);
          }
        }
      }
    }

    prevButtons = logical.buttons;
  }

  function onConnected(e: GamepadEvent) {
    if (gpIndex !== null) return; // already have one (arbitratePads can still switch)
    adoptPad(e.gamepad, performance.now());
  }

  function onDisconnected(e: GamepadEvent) {
    if (e.gamepad.index !== gpIndex) return;
    stopAllJog();
    gpIndex = null;
    gamepadConnected.value = false;
    gamepadName.value = "";
    gamepadMappingSource.value = null;
    gamepadAxesState.value = [];
    gamepadButtonsState.value = [];
    gamepadLogicalButtons.value = { ...NO_BUTTONS };
    gamepadLogicalSticks.value = { lx: 0, ly: 0, rz: 0 };
    prevButtons = { ...NO_BUTTONS };
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
        adoptPad(gp, performance.now());
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
    gamepadMappingSource,
    gamepadAxesState,
    gamepadButtonsState,
    gamepadLogicalButtons,
    gamepadLogicalSticks,
    start,
    stop,
    stopAllJog,
  };
}

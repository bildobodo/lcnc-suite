// The gamepad's jog lifecycle (button gates BG-06, Codex R202): a D-pad
// release stops what its press started — not the axis the Z modifier names
// at the release, not "nothing" because the step selector moved, and a stick
// at rest never stops a D-pad jog it did not start.
import "./testGlobals";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { computed, ref } from "vue";
import { useGamepad } from "./useGamepad";
import { GAMEPAD_FALLBACK, type GamepadAction, type GamepadDefaults, type GamepadMapping } from "./defaults";
import type { WsCommand } from "./lcnc";
import { status } from "./lcncWs";
import { ACTION_GATES } from "./actionAdmission";

const g = globalThis as any;

// One frame at a time: the composable polls through requestAnimationFrame.
let frame: ((t: number) => void) | null = null;
g.requestAnimationFrame = (cb: (t: number) => void) => { frame = cb; return 1; };
g.cancelAnimationFrame = () => { frame = null; };
if (typeof g.window === "undefined") g.window = { addEventListener: () => {}, removeEventListener: () => {} };

// A W3C-standard pad: buttons 12–15 the D-pad, 4 the left bumper (Z modifier).
const pressed = new Array<boolean>(16).fill(false);
// Raw stick axes: 0 = left stick X (+ right), the stick jog's X.
const stick = [0, 0, 0, 0];
const pad = {
  index: 0, id: "test pad", mapping: "standard",
  get axes() { return [...stick]; },
  get buttons() { return pressed.map(p => ({ pressed: p })); },
};
Object.defineProperty(globalThis, "navigator", {
  value: { getGamepads: () => [pad] }, configurable: true,
});

const DPAD_UP = 12, DPAD_RIGHT = 15, LB = 4;

function setup(step: number, closed: number[] = []) {
  const sent: WsCommand[] = [];
  const jogIncrement = ref(step);
  const jogVel = ref(10);
  const config = ref<GamepadDefaults>({
    ...GAMEPAD_FALLBACK, jogEnabled: true,
    // no dead man in this pad's mapping: jogging needs no held button
    mapping: { ...GAMEPAD_FALLBACK.mapping, btn_rt: "none" },
  });
  const pad_ = useGamepad({
    jogVel, angularJogVel: ref(5), jogIncrement,
    permissions: computed(() => ({ jog: true, run: true, zero: true, override: true, abort: true, pause: false, resume: false, spindleStop: true })),
    send: (c) => { sent.push(c); }, fire: () => {},
    startContext: computed(() => ({ activeFile: null, editing: false, loading: false })), jogAxisRefusal: (a) => closed.includes(a) ? "Gantry axis — jog it after Home All" : null, config,
    axes: computed(() => ["X", "Y", "Z"]), gated: ref(false),
  });
  pad_.start();
  const tick = (t = performance.now()) => { const f = frame; frame = null; f?.(t); };
  tick();   // adopt the pad
  return { sent, jogIncrement, jogVel, tick, pad: pad_ };
}

beforeEach(() => { pressed.fill(false); stick.fill(0); frame = null; });

describe("useGamepad stick jog speed (button gates BG-05)", () => {
  it("a stick gesture keeps the speed it started with; the next one takes the new speed", () => {
    // pollLoop reads performance.now(): drive THAT clock past the 200 ms
    // throttle, or both the old and the new code send nothing in between.
    let clock = performance.now() + 1000;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => clock);
    const { sent, jogVel, tick: frame, pad: p } = setup(0);
    const tick = (t: number) => { clock = t; frame(t); };
    const t0 = clock + 1000;
    stick[0] = 1; tick(t0);
    expect(sent).toEqual([{ cmd: "jog_cont", axis: 0, vel: 10 }]);
    jogVel.value = 30;                       // the slider moves mid-gesture
    tick(t0 + 500); tick(t0 + 1000);         // past the 200 ms throttle
    expect(sent).toEqual([{ cmd: "jog_cont", axis: 0, vel: 10 }]);
    stick[0] = 0; tick(t0 + 1500);           // back in the dead zone: the gesture ends
    stick[0] = 1; tick(t0 + 1600);           // a new gesture: the new speed
    expect(sent.slice(1)).toEqual([{ cmd: "jog_stop", axis: 0 }, { cmd: "jog_cont", axis: 0, vel: 30 }]);
    p.stop();
    spy.mockRestore();
  });
});

describe("useGamepad D-pad jog lifecycle", () => {
  it("a continuous D-pad jog stops on release, the stick at rest does not stop it", () => {
    const { sent, tick, pad: p } = setup(0);
    pressed[DPAD_RIGHT] = true; tick(); tick(); tick();
    expect(sent).toEqual([{ cmd: "jog_cont", axis: 0, vel: 10 }]);
    pressed[DPAD_RIGHT] = false; tick();
    expect(sent.slice(1)).toEqual([{ cmd: "jog_stop", axis: 0 }]);
    p.stop();
  });

  it("a step changed mid-hold still stops the continuous jog on release", () => {
    const { sent, jogIncrement, tick, pad: p } = setup(0);
    pressed[DPAD_RIGHT] = true; tick(); tick(); tick();
    expect(sent).toEqual([{ cmd: "jog_cont", axis: 0, vel: 10 }]);   // still moving while held
    jogIncrement.value = 1;
    pressed[DPAD_RIGHT] = false; tick();
    expect(sent).toEqual([{ cmd: "jog_cont", axis: 0, vel: 10 }, { cmd: "jog_stop", axis: 0 }]);
    p.stop();
  });

  it("a Z jog whose modifier is let go first stops Z, not Y", () => {
    const { sent, tick, pad: p } = setup(0);
    pressed[LB] = true; tick();
    pressed[DPAD_UP] = true; tick();
    expect(sent).toEqual([{ cmd: "jog_cont", axis: 2, vel: 10 }]);
    pressed[LB] = false; tick();
    pressed[DPAD_UP] = false; tick();
    expect(sent.slice(1)).toEqual([{ cmd: "jog_stop", axis: 2 }]);
    p.stop();
  });

  it("a step jog sends no stop at its release", () => {
    const { sent, tick, pad: p } = setup(0.5);
    pressed[DPAD_RIGHT] = true; tick();
    pressed[DPAD_RIGHT] = false; tick();
    expect(sent).toEqual([{ cmd: "jog_incr", axis: 0, vel: 10, distance: 0.5 }]);
    p.stop();
  });

  it("stopAllJog ends a held D-pad jog with its own stop", () => {
    const { sent, tick, pad: p } = setup(0);
    pressed[DPAD_RIGHT] = true; tick();
    p.stopAllJog();
    expect(sent).toEqual([{ cmd: "jog_cont", axis: 0, vel: 10 }, { cmd: "jog_stop", axis: 0 }]);
    pressed[DPAD_RIGHT] = false; tick();
    expect(sent.length).toBe(2);   // nothing left to stop
    p.stop();
  });
});

describe("useGamepad before homing (button gates package E)", () => {
  it("an axis closed before homing starts nothing from the D-pad or the stick; an open one jogs", () => {
    const { sent, tick } = setup(0, [0]);   // X closed (a gantry letter)
    pressed[DPAD_RIGHT] = true; tick();
    pressed[DPAD_RIGHT] = false; tick();
    stick[0] = 1; tick();
    stick[0] = 0; tick();
    expect(sent).toEqual([]);
    pressed[DPAD_UP] = true; tick();
    expect(sent).toEqual([{ cmd: "jog_cont", axis: 1, vel: 10 }]);
    pressed[DPAD_UP] = false; tick();
    expect(sent.slice(1)).toEqual([{ cmd: "jog_stop", axis: 1 }]);
  });
});


describe("useGamepad button actions (the function inventory's F-GAMEPAD S3)", () => {
  // A mapped button fires exactly its action, admitted as its screen control
  // is (actionAdmission.ts ACTION_GATES); its gate closed, nothing — E-Stop
  // always. Pressed on button 0 (A), every other button unmapped.
  const BTN_A = 0;
  type Out = { cmd: string; gate?: string; how: "send" | "fire" };
  function press(action: GamepadAction, perms: Record<string, boolean>, opts: { coolantOn?: boolean; buttonsEnabled?: boolean } = {}): Out[] {
    status.value = { type: "status", data: { flood: !!opts.coolantOn, mist: !!opts.coolantOn } } as never;
    const out: Out[] = [];
    const none = Object.fromEntries(Object.keys(GAMEPAD_FALLBACK.mapping).map(k => [k, "none"])) as unknown as GamepadMapping;
    const config = ref<GamepadDefaults>({ ...GAMEPAD_FALLBACK, jogEnabled: false, buttonsEnabled: opts.buttonsEnabled ?? true,
      mapping: { ...none, btn_a: action } });
    const pad_ = useGamepad({
      jogVel: ref(10), angularJogVel: ref(5), jogIncrement: ref(0),
      permissions: computed(() => perms as never),
      send: (c) => { out.push({ cmd: c.cmd, how: "send" }); },
      fire: (c, gate) => { out.push({ cmd: c.cmd, gate, how: "fire" }); },
      startContext: computed(() => ({ activeFile: "/A.ngc", editing: false, loading: false })),
      jogAxisRefusal: () => null, config, axes: computed(() => ["X", "Y", "Z"]), gated: ref(false),
    });
    pad_.start();
    const tick = () => { const f = frame; frame = null; f?.(performance.now()); };
    tick();
    pressed[BTN_A] = true; tick();
    pressed[BTN_A] = false; tick();
    pad_.stop();
    status.value = null;
    return out;
  }
  const CASES: { action: GamepadAction; open: Record<string, boolean>; want: Out; coolantOn?: boolean }[] = [
    { action: "start", open: { run: true, resume: false }, want: { cmd: "cycle_start", gate: ACTION_GATES.start, how: "fire" } },
    { action: "start", open: { run: true, resume: true }, want: { cmd: "cycle_resume", gate: ACTION_GATES.resume, how: "fire" } },
    { action: "pause", open: { pause: true }, want: { cmd: "cycle_pause", gate: ACTION_GATES.pause, how: "fire" } },
    { action: "resume", open: { resume: true }, want: { cmd: "cycle_resume", gate: ACTION_GATES.resume, how: "fire" } },
    { action: "abort", open: { abort: true }, want: { cmd: "abort", gate: ACTION_GATES.abort, how: "fire" } },
    { action: "spindle_stop", open: { spindleStop: true }, want: { cmd: "spindle_stop", gate: ACTION_GATES.spindleStop, how: "fire" } },
    { action: "flood_toggle", open: { override: true }, want: { cmd: "flood_on", gate: ACTION_GATES.coolant, how: "fire" } },
    { action: "flood_toggle", open: { override: true }, coolantOn: true, want: { cmd: "flood_off", gate: ACTION_GATES.coolant, how: "fire" } },
    { action: "mist_toggle", open: { override: true }, want: { cmd: "mist_on", gate: ACTION_GATES.coolant, how: "fire" } },
    { action: "mist_toggle", open: { override: true }, coolantOn: true, want: { cmd: "mist_off", gate: ACTION_GATES.coolant, how: "fire" } },
    { action: "home_all", open: { zero: true }, want: { cmd: "home_all", gate: ACTION_GATES.homeAll, how: "fire" } },
  ];
  it.each(CASES)("$action ($want.cmd): exactly its command under its control's gate; closed, nothing", ({ action, open, want, coolantOn }) => {
    expect(press(action, open, { coolantOn })).toEqual([want]);
    const closed = Object.fromEntries(Object.keys(open).map(k => [k, false]));
    expect(press(action, closed, { coolantOn }), "its gate closed").toEqual([]);
  });
  it("E-Stop goes out with every gate closed, and with the buttons switched off", () => {
    expect(press("estop", {})).toEqual([{ cmd: "estop", how: "send" }]);
    expect(press("estop", {}, { buttonsEnabled: false })).toEqual([{ cmd: "estop", how: "send" }]);
  });
  it("buttons switched off: no action but E-Stop", () => {
    expect(press("home_all", { zero: true }, { buttonsEnabled: false })).toEqual([]);
  });
});

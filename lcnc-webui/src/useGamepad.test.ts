// The gamepad's jog lifecycle (button gates BG-06, Codex R202): a D-pad
// release stops what its press started — not the axis the Z modifier names
// at the release, not "nothing" because the step selector moved, and a stick
// at rest never stops a D-pad jog it did not start.
import "./testGlobals";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { computed, ref } from "vue";
import { useGamepad } from "./useGamepad";
import { GAMEPAD_FALLBACK, type GamepadDefaults } from "./defaults";
import type { WsCommand } from "./lcnc";

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

function setup(step: number) {
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
    startContext: computed(() => ({ activeFile: null, editing: false, loading: false })), config,
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

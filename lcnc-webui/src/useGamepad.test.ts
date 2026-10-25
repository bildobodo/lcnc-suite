// The gamepad's jog lifecycle (button gates BG-06, Codex R202): a D-pad
// release stops what its press started — not the axis the Z modifier names
// at the release, not "nothing" because the step selector moved, and a stick
// at rest never stops a D-pad jog it did not start.
import "./testGlobals";
import { describe, it, expect, beforeEach } from "vitest";
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
const pad = {
  index: 0, id: "test pad", mapping: "standard",
  get axes() { return [0, 0, 0, 0]; },
  get buttons() { return pressed.map(p => ({ pressed: p })); },
};
Object.defineProperty(globalThis, "navigator", {
  value: { getGamepads: () => [pad] }, configurable: true,
});

const DPAD_UP = 12, DPAD_RIGHT = 15, LB = 4;

function setup(step: number) {
  const sent: WsCommand[] = [];
  const jogIncrement = ref(step);
  const config = ref<GamepadDefaults>({
    ...GAMEPAD_FALLBACK, jogEnabled: true,
    // no dead man in this pad's mapping: jogging needs no held button
    mapping: { ...GAMEPAD_FALLBACK.mapping, btn_rt: "none" },
  });
  const pad_ = useGamepad({
    jogVel: ref(10), angularJogVel: ref(5), jogIncrement,
    permissions: computed(() => ({ jog: true, idle: true, ready: true, abort: true, pause: false, resume: false, spindleStop: true })),
    send: (c) => { sent.push(c); }, fire: () => {},
    activeFile: computed(() => null), config,
    axes: computed(() => ["X", "Y", "Z"]), gated: ref(false),
  });
  pad_.start();
  const tick = () => { const f = frame; frame = null; f?.(performance.now()); };
  tick();   // adopt the pad
  return { sent, jogIncrement, tick, pad: pad_ };
}

beforeEach(() => { pressed.fill(false); frame = null; });

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

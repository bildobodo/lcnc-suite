// One admission per action (button gates BG-10, Codex R202): the gamepad
// admits Start, Home All and the coolant as the screen's controls do — Start
// under `run` with a loaded program nobody edits and nothing loads, Home All
// under `zero`, the coolant under `override`. Before: Start `ready` without
// the editor or the load, Home All `idle`, the coolant `ready`.
import "./testGlobals";
import { describe, it, expect, beforeEach } from "vitest";
import { computed, ref } from "vue";
import { ACTION_GATES, START_REASONS, startAdmitted, startRefusal, type StartContext } from "./actionAdmission";
import { useGamepad } from "./useGamepad";
import { GAMEPAD_FALLBACK, type GamepadDefaults } from "./defaults";
import type { WsCommand } from "./lcnc";

const g = globalThis as any;
let frame: ((t: number) => void) | null = null;
g.requestAnimationFrame = (cb: (t: number) => void) => { frame = cb; return 1; };
g.cancelAnimationFrame = () => { frame = null; };
if (typeof g.window === "undefined") g.window = { addEventListener: () => {}, removeEventListener: () => {} };

const pressed = new Array<boolean>(16).fill(false);
const pad = {
  index: 0, id: "test pad", mapping: "standard",
  get axes() { return [0, 0, 0, 0]; },
  get buttons() { return pressed.map(p => ({ pressed: p })); },
};
Object.defineProperty(globalThis, "navigator", { value: { getGamepads: () => [pad] }, configurable: true });
const BTN_A = 0, BTN_B = 1, BTN_X = 2;

const READY_CTX: StartContext = { activeFile: "/nc/part.ngc", editing: false, loading: false };

describe("the start admission", () => {
  it("needs run and the program context, in the button's order", () => {
    expect(startRefusal(READY_CTX)).toBeNull();
    expect(startRefusal({ ...READY_CTX, editing: true, activeFile: null })).toBe(START_REASONS.editing);
    expect(startRefusal({ ...READY_CTX, activeFile: null })).toBe(START_REASONS.noProgram);
    expect(startRefusal({ ...READY_CTX, loading: true })).toBe(START_REASONS.loading);
    expect(startAdmitted({ run: true }, READY_CTX)).toBe(true);
    expect(startAdmitted({ run: false }, READY_CTX)).toBe(false);
  });

  it("names each action's screen gate", () => {
    expect(ACTION_GATES).toMatchObject({ start: "run", homeAll: "zero", coolant: "override" });
  });
});

describe("the gamepad admits as the screen does (BG-10)", () => {
  let fired: [WsCommand, string | undefined][];
  const perms = ref<Record<string, boolean>>({});
  const ctx = ref<StartContext>(READY_CTX);

  const tick = () => { const f = frame; frame = null; f?.(performance.now()); };
  function press(btn: number) {
    pressed[btn] = true;
    tick();
    pressed[btn] = false;
    tick();
  }

  beforeEach(() => {
    pressed.fill(false);
    frame = null;
    fired = [];
    const config = ref<GamepadDefaults>({
      ...GAMEPAD_FALLBACK, buttonsEnabled: true,
      mapping: { ...GAMEPAD_FALLBACK.mapping, btn_a: "start", btn_b: "home_all", btn_x: "flood_toggle", btn_rt: "none" },
    });
    const p = useGamepad({
      jogVel: ref(10), angularJogVel: ref(5), jogIncrement: ref(0),
      permissions: computed(() => perms.value as any),
      send: () => {}, fire: (c, gate) => { fired.push([c, gate]); },
      startContext: computed(() => ctx.value), jogAxisRefusal: () => null, config,
      axes: computed(() => ["X", "Y", "Z"]), gated: ref(false),
    });
    p.start();
    tick();   // adopt the pad
  });

  it("Start: a stranded Plane state (ready, not run) starts nothing", () => {
    perms.value = { ready: true, run: false, resume: false };
    ctx.value = READY_CTX;
    press(BTN_A);
    expect(fired).toEqual([]);
  });

  it("Start: editing or a load in flight starts nothing; the admitted start fires under run", () => {
    perms.value = { run: true, resume: false };
    for (const c of [{ ...READY_CTX, editing: true }, { ...READY_CTX, loading: true }, { ...READY_CTX, activeFile: null }]) {
      ctx.value = c;
      press(BTN_A);
    }
    expect(fired).toEqual([]);
    ctx.value = READY_CTX;
    press(BTN_A);
    expect(fired).toEqual([[{ cmd: "cycle_start" }, "run"]]);
  });

  it("Home All: idle with surface compensation on (zero closed) homes nothing; zero homes", () => {
    perms.value = { idle: true, zero: false };
    press(BTN_B);
    expect(fired).toEqual([]);
    perms.value = { zero: true };
    press(BTN_B);
    expect(fired).toEqual([[{ cmd: "home_all" }, "zero"]]);
  });

  it("Coolant: a running program (ready closed, override open) toggles it, under override", () => {
    perms.value = { ready: false, override: true };
    press(BTN_X);
    expect(fired.map(([c, gate]) => [c.cmd, gate])).toEqual([["flood_on", "override"]]);
    fired = [];
    perms.value = { ready: true, override: false };
    press(BTN_X);
    expect(fired).toEqual([]);
  });
});

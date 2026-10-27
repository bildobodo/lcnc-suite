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
    permissions: computed(() => ({ jog: true, idle: true, ready: true, abort: true, pause: false, resume: false, spindleStop: true })),
    send: (c) => { sent.push(c); }, fire: () => {},
    activeFile: computed(() => null), config,
    axes: computed(() => ["X", "Y", "Z"]), gated: ref(false),
  });
  pad_.start();
  const tick = (t = performance.now()) => { const f = frame; frame = null; f?.(t); };
  tick();   // adopt the pad
  return { sent, jogIncrement, jogVel, tick, pad: pad_ };
}

beforeEach(() => { pressed.fill(false); stick.fill(0); frame = null; });

describe('R213 independent analog gesture probes', () => {
 it('reverse and lower deflection keep the original maximum after preselection changes',()=>{
  let clock=1000; const spy=vi.spyOn(performance,'now').mockImplementation(()=>clock);
  const {sent,jogVel,tick,pad:p}=setup(0);
  stick[0]=1; tick(); jogVel.value=90;
  clock+=500; stick[0]=-1; tick();
  const reversed=sent.filter(c=>c.cmd==='jog_cont').at(-1) as any;
  expect(reversed.vel).toBe(-10);
  clock+=500; stick[0]=-0.5; tick();
  expect(Math.abs((sent.filter(c=>c.cmd==='jog_cont').at(-1) as any).vel)).toBeLessThan(10);
  p.stop(); spy.mockRestore();
 });
 it('lowering the preselection does not decelerate the current gesture, but applies after the dead zone',()=>{
  let clock=1000; const spy=vi.spyOn(performance,'now').mockImplementation(()=>clock);
  const {sent,jogVel,tick,pad:p}=setup(0);
  stick[0]=1; tick(); jogVel.value=2; clock+=500; tick();
  expect(sent).toEqual([{cmd:'jog_cont',axis:0,vel:10}]);
  stick[0]=0;clock+=500;tick();stick[0]=1;clock+=500;tick();
  expect(sent.at(-1)).toEqual({cmd:'jog_cont',axis:0,vel:2});
  p.stop();spy.mockRestore();
 });
});

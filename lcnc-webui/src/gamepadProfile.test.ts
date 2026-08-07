import { describe, it, expect } from "vitest";
import {
  isBindingPressed, bindingEquals, detectBinding, detectStickBinding,
  resolveLogical, getMappingSource,
  type GamepadProfile, type RawSample,
} from "./gamepadProfile";

const sample = (axes: number[], buttons: boolean[] = []): RawSample => ({ axes, buttons });
const noButtons = (n: number) => new Array(n).fill(false);

// Firefox exposes single-axis 8-way hats: N=-1, E=-0.4286, S=0.1429,
// W=0.7143, idle=1.2857 (adjacent directions 0.2857 apart).
const HAT_IDLE = 1.2857;
const HAT_N = -1, HAT_E = -0.4286, HAT_S = 0.1429, HAT_W = 0.7143;

describe("isBindingPressed", () => {
  it("button binding reads the raw index", () => {
    expect(isBindingPressed({ type: "button", index: 2 }, [], [false, false, true])).toBe(true);
    expect(isBindingPressed({ type: "button", index: 2 }, [], [true, true, false])).toBe(false);
  });

  it("missing indices are not pressed (device unplugged mid-frame)", () => {
    expect(isBindingPressed({ type: "button", index: 9 }, [], [])).toBe(false);
    expect(isBindingPressed({ type: "axisDir", index: 6, sign: 1 }, [], [])).toBe(false);
    expect(isBindingPressed({ type: "axisValue", index: 9, value: -1 }, [], [])).toBe(false);
  });

  it("axisDir respects sign and threshold", () => {
    const b = { type: "axisDir", index: 6, sign: -1 } as const;
    expect(isBindingPressed(b, [0, 0, 0, 0, 0, 0, -1], [])).toBe(true);
    expect(isBindingPressed(b, [0, 0, 0, 0, 0, 0, -0.3], [])).toBe(false);
    expect(isBindingPressed(b, [0, 0, 0, 0, 0, 0, 1], [])).toBe(false);
  });

  it("axisValue discriminates adjacent hat directions", () => {
    const up = { type: "axisValue", index: 9, value: HAT_N } as const;
    const axesAt = (v: number) => [0, 0, 0, 0, 0, 0, 0, 0, 0, v];
    expect(isBindingPressed(up, axesAt(HAT_N), [])).toBe(true);
    expect(isBindingPressed(up, axesAt(-0.7143), [])).toBe(true); // NE diagonal still counts as up
    expect(isBindingPressed(up, axesAt(HAT_E), [])).toBe(false);
    expect(isBindingPressed(up, axesAt(HAT_S), [])).toBe(false);
    expect(isBindingPressed(up, axesAt(HAT_W), [])).toBe(false);
    expect(isBindingPressed(up, axesAt(HAT_IDLE), [])).toBe(false);
  });
});

describe("detectBinding", () => {
  it("button rising edge wins over a co-moving axis", () => {
    const base = sample([0, 0], noButtons(4));
    const curr = sample([0.9, 0], [false, false, true, false]);
    expect(detectBinding(base, curr)).toEqual({ type: "button", index: 2 });
  });

  it("centered-rest axis movement → axisDir with sign", () => {
    const base = sample([0, 0, 0, 0, 0, 0, 0.02, 0]);
    const curr = sample([0, 0, 0, 0, 0, 0, -1, 0]);
    expect(detectBinding(base, curr)).toEqual({ type: "axisDir", index: 6, sign: -1 });
  });

  it("trigger resting at −1 → axisValue at the pressed value", () => {
    const base = sample([0, 0, 0, 0, -1]);
    const curr = sample([0, 0, 0, 0, 1]);
    expect(detectBinding(base, curr)).toEqual({ type: "axisValue", index: 4, value: 1 });
  });

  it("8-way hat (idle rest off-center) → axisValue", () => {
    const base = sample([0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_IDLE]);
    const curr = sample([0, 0, 0, 0, 0, 0, 0, 0, 0, HAT_N]);
    expect(detectBinding(base, curr)).toEqual({ type: "axisValue", index: 9, value: HAT_N });
  });

  it("returns null when nothing moved decisively", () => {
    const base = sample([0, 0], noButtons(2));
    expect(detectBinding(base, sample([0.3, 0.1], noButtons(2)))).toBeNull();
    expect(detectBinding(base, sample([0, 0], noButtons(2)))).toBeNull();
  });
});

describe("detectStickBinding", () => {
  it("accepts a centered-rest axis and records direction", () => {
    const base = sample([0, 0]);
    expect(detectStickBinding(base, sample([0, -1]))).toEqual({ index: 1, sign: -1 });
  });

  it("rejects button presses and off-center-rest axes", () => {
    const base = sample([0, 0, HAT_IDLE], noButtons(2));
    expect(detectStickBinding(base, sample([0, 0, HAT_IDLE], [true, false]))).toBeNull();
    expect(detectStickBinding(base, sample([0, 0, HAT_N], noButtons(2)))).toBeNull();
  });
});

describe("bindingEquals", () => {
  it("matches same physical control, distinguishes hat directions on one axis", () => {
    expect(bindingEquals({ type: "button", index: 3 }, { type: "button", index: 3 })).toBe(true);
    expect(bindingEquals({ type: "button", index: 3 }, { type: "button", index: 4 })).toBe(false);
    expect(bindingEquals(
      { type: "axisDir", index: 6, sign: 1 }, { type: "axisDir", index: 6, sign: -1 })).toBe(false);
    expect(bindingEquals(
      { type: "axisValue", index: 9, value: HAT_N }, { type: "axisValue", index: 9, value: HAT_E })).toBe(false);
    expect(bindingEquals(
      { type: "axisValue", index: 9, value: HAT_N }, { type: "axisValue", index: 9, value: -0.9 })).toBe(true);
  });
});

describe("resolveLogical — standard layout", () => {
  it("maps positional buttons and normalizes stick up to positive", () => {
    const buttons = noButtons(16);
    buttons[0] = true;   // A
    buttons[13] = true;  // dpad down
    const st = resolveLogical([0.5, -1, 0, 0.25], buttons, null);
    expect(st.buttons.btn_a).toBe(true);
    expect(st.buttons.dpad_down).toBe(true);
    expect(st.buttons.btn_b).toBe(false);
    expect(st.sticks.lx).toBe(0.5);
    expect(st.sticks.ly).toBe(1);      // raw up (−1) → logical +1
    expect(st.sticks.rz).toBe(-0.25);  // raw down → logical negative
  });
});

describe("resolveLogical — profile", () => {
  const profile: GamepadProfile = {
    id: "test-pad",
    buttons: {
      btn_a: { type: "button", index: 5 },
      dpad_up: { type: "axisValue", index: 9, value: HAT_N },
      btn_rt: { type: "axisDir", index: 4, sign: 1 },
    },
    sticks: {
      lx: { index: 2, sign: 1 },
      ly: { index: 3, sign: -1 },
    },
  };

  it("uses only profile bindings; unbound controls stay inactive", () => {
    const buttons = noButtons(16);
    buttons[0] = true;  // would be A in standard layout — unbound raw control
    buttons[5] = true;  // bound to btn_a
    const axes = [0, 0, 0.7, 0.4, 0.9, 0, 0, 0, 0, HAT_N];
    const st = resolveLogical(axes, buttons, profile);
    expect(st.buttons.btn_a).toBe(true);
    expect(st.buttons.btn_b).toBe(false);   // raw 0 pressed but btn_b unbound
    expect(st.buttons.dpad_up).toBe(true);  // hat value match
    expect(st.buttons.btn_rt).toBe(true);   // axisDir past threshold
    expect(st.sticks.lx).toBe(0.7);
    expect(st.sticks.ly).toBeCloseTo(-0.4); // sign −1 applied
    expect(st.sticks.rz).toBe(0);           // unbound stick
  });

  it("clamps out-of-range hat-idle values on a bound stick axis", () => {
    const st = resolveLogical([0, 0, HAT_IDLE, 0], noButtons(1), profile);
    expect(st.sticks.lx).toBe(1);
  });
});

describe("getMappingSource", () => {
  it("profile > standard > assumed", () => {
    const p: GamepadProfile = { id: "x", buttons: {}, sticks: {} };
    expect(getMappingSource(p, "")).toBe("profile");
    expect(getMappingSource(null, "standard")).toBe("standard");
    expect(getMappingSource(undefined, "")).toBe("assumed");
  });
});

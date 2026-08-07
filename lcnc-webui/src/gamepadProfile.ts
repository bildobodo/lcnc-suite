// ─── Gamepad raw→logical mapping profiles ────────────────────────
//
// The Gamepad API only guarantees index semantics when the browser reports
// mapping === "standard". Controllers it doesn't recognize (or ones lying
// about their identity, e.g. clones advertising a DualShock VID/PID) deliver
// raw indices that don't line up: D-pads arrive as hat axes, triggers as
// analog axes, face buttons shuffled. A GamepadProfile captures the raw
// binding for each *logical* control on a specific device (keyed by
// gamepad.id), so the advertised identity becomes irrelevant.
//
// Pure module — no Vue, no DOM. Unit-tested in gamepadProfile.test.ts.

/** Logical controls — the vocabulary the rest of the app speaks. */
export const LOGICAL_BUTTONS = [
  "btn_a", "btn_b", "btn_x", "btn_y",
  "btn_lb", "btn_rb", "btn_lt", "btn_rt",
  "btn_back", "btn_start", "btn_ls", "btn_rs",
  "dpad_up", "dpad_down", "dpad_left", "dpad_right",
] as const;
export type LogicalButton = (typeof LOGICAL_BUTTONS)[number];

/** Logical stick channels, normalized so +1 = right / up. */
export const LOGICAL_STICKS = ["lx", "ly", "rz"] as const;
export type LogicalStick = (typeof LOGICAL_STICKS)[number];

/**
 * Raw binding for a logical button.
 * - button:    plain button index.
 * - axisDir:   axis resting near 0 (two-axis hats, stick axes) — pressed
 *              when the value crosses ±AXIS_PRESS_THRESHOLD in `sign`.
 * - axisValue: axis resting away from 0 (single-axis 8-way hats, triggers
 *              resting at −1) — pressed when the value is within
 *              AXIS_VALUE_TOLERANCE of the captured pressed value.
 */
export type RawBinding =
  | { type: "button"; index: number }
  | { type: "axisDir"; index: number; sign: 1 | -1 }
  | { type: "axisValue"; index: number; value: number };

/** Raw axis feeding a logical stick; sign maps raw + to logical + (right/up). */
export interface StickBinding {
  index: number;
  sign: 1 | -1;
}

export interface GamepadProfile {
  /** gamepad.id the profile was captured on (also its storage key). */
  id: string;
  buttons: Partial<Record<LogicalButton, RawBinding>>;
  sticks: Partial<Record<LogicalStick, StickBinding>>;
}

export type MappingSource = "profile" | "standard" | "assumed";

export interface LogicalState {
  buttons: Record<LogicalButton, boolean>;
  /** Normalized deflection, +1 = right (lx) / up (ly, rz). No dead zone. */
  sticks: Record<LogicalStick, number>;
}

export const AXIS_PRESS_THRESHOLD = 0.5;
export const AXIS_VALUE_TOLERANCE = 0.4;
/** |rest| below this → axis treated as centered (axisDir); above → axisValue. */
export const AXIS_CENTERED_REST = 0.35;
/** Minimum |delta from rest| for capture to accept an axis movement. */
export const CAPTURE_AXIS_DELTA = 0.6;

/** Standard-mapping button index per logical button (W3C standard gamepad). */
const STANDARD_BUTTON_INDEX: Record<LogicalButton, number> = {
  btn_a: 0, btn_b: 1, btn_x: 2, btn_y: 3,
  btn_lb: 4, btn_rb: 5, btn_lt: 6, btn_rt: 7,
  btn_back: 8, btn_start: 9, btn_ls: 10, btn_rs: 11,
  dpad_up: 12, dpad_down: 13, dpad_left: 14, dpad_right: 15,
};

export function isBindingPressed(
  b: RawBinding,
  axes: readonly number[],
  buttons: readonly boolean[],
): boolean {
  switch (b.type) {
    case "button":
      return buttons[b.index] ?? false;
    case "axisDir": {
      const v = axes[b.index];
      return v !== undefined && v * b.sign > AXIS_PRESS_THRESHOLD;
    }
    case "axisValue": {
      const v = axes[b.index];
      return v !== undefined && Math.abs(v - b.value) < AXIS_VALUE_TOLERANCE;
    }
  }
}

/** Two bindings target the same physical control (duplicate-capture guard). */
export function bindingEquals(a: RawBinding, b: RawBinding): boolean {
  if (a.type !== b.type || a.index !== b.index) return false;
  if (a.type === "axisDir" && b.type === "axisDir") return a.sign === b.sign;
  if (a.type === "axisValue" && b.type === "axisValue") {
    return Math.abs(a.value - b.value) < AXIS_VALUE_TOLERANCE;
  }
  return true; // button, same index
}

export interface RawSample {
  axes: readonly number[];
  buttons: readonly boolean[];
}

/**
 * Capture: what did the user just actuate relative to the rest baseline?
 * Button rising edges win over axis movement (a pressed button often also
 * jiggles an analog axis). Returns null when nothing moved decisively.
 */
export function detectBinding(baseline: RawSample, curr: RawSample): RawBinding | null {
  for (let i = 0; i < curr.buttons.length; i++) {
    if (curr.buttons[i] && !baseline.buttons[i]) return { type: "button", index: i };
  }
  let best = -1;
  let bestDelta = 0;
  for (let i = 0; i < curr.axes.length; i++) {
    const delta = Math.abs((curr.axes[i] ?? 0) - (baseline.axes[i] ?? 0));
    if (delta > bestDelta) { bestDelta = delta; best = i; }
  }
  if (best < 0 || bestDelta < CAPTURE_AXIS_DELTA) return null;
  const rest = baseline.axes[best] ?? 0;
  const v = curr.axes[best] ?? 0;
  if (Math.abs(rest) < AXIS_CENTERED_REST) {
    return { type: "axisDir", index: best, sign: v > rest ? 1 : -1 };
  }
  return { type: "axisValue", index: best, value: v };
}

/**
 * Stick capture: accepts only a centered-rest axis movement (sticks rest
 * at 0); button presses and hat/trigger-style axes are rejected so the
 * wizard can prompt the user to move the stick instead.
 */
export function detectStickBinding(baseline: RawSample, curr: RawSample): StickBinding | null {
  const b = detectBinding(baseline, curr);
  if (b?.type !== "axisDir") return null;
  return { index: b.index, sign: b.sign };
}

export function getMappingSource(
  profile: GamepadProfile | null | undefined,
  browserMapping: string,
): MappingSource {
  if (profile) return "profile";
  return browserMapping === "standard" ? "standard" : "assumed";
}

function emptyLogical(): LogicalState {
  const buttons = {} as Record<LogicalButton, boolean>;
  for (const k of LOGICAL_BUTTONS) buttons[k] = false;
  return { buttons, sticks: { lx: 0, ly: 0, rz: 0 } };
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/**
 * Resolve raw gamepad state to logical state.
 * With a profile, only its bindings are consulted (unbound controls stay
 * inactive — honestly absent, not guessed). Without one, the W3C standard
 * layout is assumed: buttons 0–15 positional, lx=axes[0], ly=−axes[1],
 * rz=−axes[3] (raw stick up is negative; logical up is positive).
 */
export function resolveLogical(
  axes: readonly number[],
  buttons: readonly boolean[],
  profile: GamepadProfile | null | undefined,
): LogicalState {
  const out = emptyLogical();
  if (profile) {
    for (const k of LOGICAL_BUTTONS) {
      const b = profile.buttons[k];
      if (b) out.buttons[k] = isBindingPressed(b, axes, buttons);
    }
    for (const s of LOGICAL_STICKS) {
      const b = profile.sticks[s];
      if (b) out.sticks[s] = clamp1((axes[b.index] ?? 0) * b.sign);
    }
    return out;
  }
  for (const k of LOGICAL_BUTTONS) {
    out.buttons[k] = buttons[STANDARD_BUTTON_INDEX[k]] ?? false;
  }
  out.sticks.lx = clamp1(axes[0] ?? 0);
  out.sticks.ly = clamp1(-(axes[1] ?? 0));
  out.sticks.rz = clamp1(-(axes[3] ?? 0));
  return out;
}

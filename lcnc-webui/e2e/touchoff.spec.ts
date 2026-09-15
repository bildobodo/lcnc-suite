import { test, expect } from "@playwright/test";
import { ctl as ctlSend, MOCK } from "./ctl";

// Touch-off under kinematics modes (2026-08-30): the backend broadcasts two
// gate classes (touchoff / touchoffRotary) and SetupStrip renders the rotary
// axis controls under the rotary class and the reserved fixtures disabled on
// a TWP machine. This pins the visible layer — what the operator sees is
// what the policy decided.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};

// Kins declarations (viewer_init.kins): the TWP stack vs a switchable TCP
// trunnion that has no plane remap at all (TWP-08b).
const TRSRN = { module: "xyzacb_trsrn", type: "xyzacb-trsrn", identity_first: false, params: {} };
const TRT = { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: true, params: {} };
// The same trunnion loaded WITHOUT `sparm=identityfirst`, where raw
// switchkins type 0 is the WORLD kins and 1 is identity (xyzac-trt-kins.c
// switchkinsSetup) — the configuration that tells a frame selector bound to
// raw numbers apart from one bound to frames (R-01).
const TRT_WORLD_FIRST = { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: false, params: {} };

test("Plane mode: rotary touch-off closed, reserved fixtures disabled, Zero XYZ stays open", async ({ page }) => {
  // setAxes re-ships viewer_init to CONNECTED clients — load the page and
  // wait for the first axis rows before asking for the 6-axis set.
  await page.goto(MOCK);
  const zeroA = page.getByRole("button", { name: "Zero A", exact: true });
  const zeroX = page.getByRole("button", { name: "Zero X", exact: true });
  await expect(zeroX).toBeVisible();
  await ctlSend({ op: "setAxes", axes: ["X", "Y", "Z", "A", "C", "B"] });
  await expect(zeroA).toBeVisible();
  // No switchable kins reported (kins_type absent): every fixture selectable.
  await expect(page.locator('input[name="wcs"][value="G59"]')).not.toBeDisabled();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "setKins", kins: TRSRN });
    await ctlSend({ op: "status_delta", data: {
      kins_type: 2, g5x_index: 6, twp_active: true,
      permissions: { ...PERMS_ALL, touchoffRotary: false },
    } });
    await expect(zeroA).toBeDisabled();
    await expect(zeroX).not.toBeDisabled();
    // D-02: on a switchable machine the button names its axis set.
    await expect(page.getByRole("button", { name: "Zero XYZ" })).not.toBeDisabled();
    await expect(page.getByRole("button", { name: "Go to WCS 0" })).toBeVisible();
    await expect(page.locator('input[name="wcs"][value="G59"]')).toBeDisabled();
    await expect(page.locator('input[name="wcs"][value="G59.3"]')).toBeDisabled();
    await expect(page.locator('input[name="wcs"][value="G54"]')).not.toBeDisabled();
    // Linear touch-off closed (e.g. TCP off the A=0 datum): inputs + Zero close.
    await ctlSend({ op: "status_delta", data: {
      kins_type: 1, g5x_index: 1,
      permissions: { ...PERMS_ALL, touchoff: false, touchoffRotary: false },
    } });
    await expect(zeroX).toBeDisabled();
    await expect(page.locator("input.setupInput").first()).toBeDisabled();
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("Capture/Clear plane buttons: gate-driven, Clear needs a plane (or TOOL limbo)", async ({ page }) => {
  await page.goto(MOCK);
  await expect(page.getByRole("button", { name: "Zero X", exact: true })).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    // TWP machine, no plane: Capture open (perm true), Clear disabled.
    await ctlSend({ op: "setKins", kins: TRSRN });
    await ctlSend({ op: "status_delta", data: {
      kins_type: 0, g5x_index: 1, twp_defined: false,
      permissions: { ...PERMS_ALL },
    } });
    const capture = page.getByRole("button", { name: "Capture plane" });
    const clear = page.getByRole("button", { name: "Clear plane" });
    await expect(capture).toBeVisible();
    await expect(capture).not.toBeDisabled();
    await expect(clear).toBeDisabled();
    // Plane defined: backend closes twpCapture (refuse, never discard);
    // Clear opens.
    await ctlSend({ op: "status_delta", data: {
      twp_defined: true,
      permissions: { ...PERMS_ALL, twpCapture: false },
    } });
    await expect(capture).toBeDisabled();
    await expect(clear).not.toBeDisabled();
    // TOOL-kins limbo (kins 2, no plane): Clear stays open as the recovery.
    await ctlSend({ op: "status_delta", data: {
      kins_type: 2, twp_defined: false,
      permissions: { ...PERMS_ALL, twpCapture: false },
    } });
    await expect(clear).not.toBeDisabled();
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("TCP trunnion (switchable, not TWP): G59 selectable, no Plane frame, no Capture row", async ({ page }) => {
  // TWP-08b: switchability alone used to reserve G59, offer the Plane jog
  // frame and render Capture/Orient/Clear — on a machine with no plane remap.
  await page.goto(MOCK);
  await expect(page.getByRole("button", { name: "Zero X", exact: true })).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "setKins", kins: TRT });
    await ctlSend({ op: "status_delta", data: {
      kins_type: 0, g5x_index: 1, permissions: { ...PERMS_ALL },
    } });
    // The kins-frame selector exists (Machine / TCP) but never offers Plane.
    await expect(page.locator('input[name="jogFrame"][value="0"]')).toHaveCount(1);
    await expect(page.locator('input[name="jogFrame"][value="2"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Capture plane" })).toHaveCount(0);
    await expect(page.locator('input[name="wcs"][value="G59"]')).not.toBeDisabled();
    await expect(page.locator('input[name="wcs"][value="G59.3"]')).not.toBeDisabled();
    // The TWP stack: same status, now G59 is reserved and Plane is offered.
    await ctlSend({ op: "setKins", kins: TRSRN });
    await expect(page.locator('input[name="jogFrame"][value="2"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Capture plane" })).toHaveCount(1);
    await expect(page.locator('input[name="wcs"][value="G59"]')).toBeDisabled();
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("kinematics selector shows the FRAME the raw type means, and emits frames", async ({ page }) => {
  // R-01 (implementation review 2026-09-15): the radios were bound to the raw
  // switchkins pin, which means different frames on different kins families.
  // On a trt WITHOUT identityfirst, raw 0 is the trt world kins — the strip
  // showed "Machine" while the machine was in TCP.
  await page.goto(MOCK);
  await expect(page.getByRole("button", { name: "Zero X", exact: true })).toBeVisible();
  const machine = page.locator('input[name="jogFrame"][value="0"]');
  const tcp = page.locator('input[name="jogFrame"][value="1"]');
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "setKins", kins: TRT_WORLD_FIRST });
    await ctlSend({ op: "status_delta", data: {
      kins_type: 0, g5x_index: 1, permissions: { ...PERMS_ALL },
    } });
    await expect(tcp).toBeChecked();
    await expect(machine).not.toBeChecked();
    await ctlSend({ op: "status_delta", data: { kins_type: 1 } });
    await expect(machine).toBeChecked();
    await expect(tcp).not.toBeChecked();
    // Picking a frame sends the FRAME; the gateway resolves the M-code from
    // this machine's own remaps.
    await ctlSend({ op: "clearCmds" });
    await tcp.click();
    await expect.poll(async () => {
      const r = await ctlSend({ op: "lastCmds" }) as { cmds?: { cmd?: string; mode?: number }[] };
      return (r.cmds ?? []).filter(c => c.cmd === "set_kins_mode").map(c => c.mode);
    }).toEqual([1]);
    // The TWP stack maps raw straight through, so the same pin reads as Plane.
    await ctlSend({ op: "setKins", kins: TRSRN });
    await ctlSend({ op: "status_delta", data: { kins_type: 2, twp_active: true } });
    await expect(page.locator('input[name="jogFrame"][value="2"]')).toBeChecked();
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("keypad names its target; a frame/fixture change while open cancels it with a message", async ({ page }) => {
  // U-03 (review 2026-09-14): the heading says which axis, frame and datum
  // the value writes, and a target change mid-entry never lands the value
  // elsewhere — the keypad closes and the message center says why.
  await page.goto(MOCK);
  const zInput = page.locator("input.setupInput").nth(2);
  await expect(zInput).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "setKins", kins: TRSRN });
    await ctlSend({ op: "status_delta", data: {
      kins_type: 2, g5x_index: 6, twp_active: true,
      permissions: { ...PERMS_ALL, touchoffRotary: false },
    } });
    await zInput.click();
    const strip = page.locator(".nkStrip");
    await expect(strip).toBeVisible();
    await expect(strip.locator(".sub")).toHaveText("Touch off Z · Plane · updates G54");
    const messages = page.getByRole("button", { name: /^Messages \(/ });
    const before = await messages.getAttribute("title");
    // The program's M2 restores G54 and identity: a different target.
    await ctlSend({ op: "status_delta", data: { kins_type: 0, g5x_index: 1 } });
    await expect(strip).toHaveCount(0);
    await expect(messages).not.toHaveAttribute("title", before ?? "");
    // Re-opened, the heading names the NEW target.
    await zInput.click();
    await expect(strip.locator(".sub")).toHaveText("Touch off Z · Machine · G54");
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("a disabled control explains itself to the keyboard, and sends no command", async ({ page }) => {
  // R-05 (implementation review 2026-09-15): the explanation was reachable by
  // pointer only — the wrapper was a plain span, and its child is disabled, so
  // a keyboard user tabbed past both the control and its reason.
  await page.goto(MOCK);
  // exact: the disabled control's own name — the help wrapper beside it is a
  // button too, and quotes the reason (which names the control).
  const btn = page.getByRole("button", { name: "Go to WCS 0", exact: true });
  await expect(btn).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "status_delta", data: {
      permissions: { ...PERMS_ALL, goZero: false },
      permission_reasons: { goZero: "Go to WCS 0 under TCP: select the Machine frame or the Plane frame first" },
    } });
    await expect(btn).toBeDisabled();
    const tip = page.locator(".btnTip", { has: btn });
    // Focusable, and it says what it is for.
    await expect(tip).toHaveAttribute("tabindex", "0");
    await expect(tip).toHaveAttribute("aria-label", /Why is this unavailable\?.*Machine frame/);
    await tip.focus();
    await expect(tip).toBeFocused();
    await page.keyboard.press("Enter");
    const messages = page.getByRole("button", { name: /^Messages \(/ });
    await messages.click();
    await expect(page.locator(".msgText").first()).toContainText("select the Machine frame");
    await messages.click();
    // Space explains too — and neither key reaches the machine. (Escape is
    // deliberately NOT used to close anything here: it is the E-Stop
    // shortcut, which fires from anywhere by design.)
    await ctlSend({ op: "clearCmds" });
    await tip.focus();
    await page.keyboard.press(" ");
    await messages.click();
    await expect(page.locator(".msgText")).toHaveCount(2);
    const sent = await ctlSend({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] };
    expect((sent.cmds ?? []).map(c => c.cmd)).toEqual([]);
    await messages.click();
    // Enabled again: no wrapper, so the tab order is the plain control's.
    await ctlSend({ op: "status_delta", data: { permissions: { ...PERMS_ALL }, permission_reasons: {} } });
    await expect(page.locator(".btnTip", { has: btn })).toHaveCount(0);
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("a disabled control explains itself: the reason on hover and on tap", async ({ page }) => {
  // U-06 (review 2026-09-14): a disabled <button> swallowed pointer events —
  // the reason existed only in a denial it could not send.
  await page.goto(MOCK);
  const btn = page.getByRole("button", { name: "Go to WCS 0", exact: true });
  await expect(btn).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "status_delta", data: {
      permissions: { ...PERMS_ALL, goZero: false },
      permission_reasons: { goZero: "Go to WCS 0 under TCP: neither the machine top nor the tool axis is a world axis here — select the Machine frame or the Plane frame first" },
    } });
    await expect(btn).toBeDisabled();
    const tip = page.locator(".btnTip", { has: btn });
    await expect(tip).toHaveAttribute("title", /under TCP/);
    const messages = page.getByRole("button", { name: /^Messages \(/ });
    const before = await messages.getAttribute("title");
    await tip.click();
    await expect(messages).not.toHaveAttribute("title", before ?? "");
    await messages.click();
    await expect(page.locator(".msgText").first()).toContainText("under TCP");
    // Open again: no wrapper, plain button.
    await page.keyboard.press("Escape");
    await ctlSend({ op: "status_delta", data: { permissions: { ...PERMS_ALL }, permission_reasons: {} } });
    await expect(btn).not.toBeDisabled();
    await expect(page.locator(".btnTip", { has: btn })).toHaveCount(0);
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});


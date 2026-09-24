import { test, expect, type Page } from "@playwright/test";
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

// Commands the UI may send on its own while a test is merely looking at the
// screen — status/table reads, never a machine action. Asserting "nothing was
// sent" over the raw log is wrong: the mock records these too, and the review
// of 2026-09-16 saw the keyboard test fail on a background get_tool_table.
// The assertion that matters is "no MACHINE action", with this allow-list as
// the backstop that fails closed when a new command appears.
const READ_ONLY_CMDS = ["hello", "heartbeat", "get_tool_table", "halshow_live", "timing_log",
                       "tab_visibility"]; // Advisory status-delivery hint; no machine state change.
const MACHINE_CMDS = ["cycle_start", "cycle_pause", "cycle_resume", "abort", "jog_cont",
                      "jog_incr", "jog_stop", "go_to_zero", "touchoff", "set_kins_mode",
                      "home_all", "machine_on", "estop", "mdi", "twp_capture"];

async function recordedCmds(): Promise<string[]> {
  const sent = await ctlSend({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] };
  return (sent.cmds ?? []).map(c => c.cmd ?? "");
}

function expectNoMachineAction(cmds: string[]) {
  for (const machine of MACHINE_CMDS) expect(cmds).not.toContain(machine);
  expect(cmds.filter(c => !READ_ONLY_CMDS.includes(c))).toEqual([]);
}

// Kins declarations (viewer_init.kins): the TWP stack vs a switchable TCP
// trunnion that has no plane remap at all (TWP-08b).
const TRSRN = { module: "xyzacb_trsrn", type: "xyzacb-trsrn", identity_first: false, params: {} };
const TRT = { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: true, params: {} };
// The same trunnion loaded WITHOUT `sparm=identityfirst`, where raw
// switchkins type 0 is the WORLD kins and 1 is identity (xyzac-trt-kins.c
// switchkinsSetup) — the configuration that tells a frame selector bound to
// raw numbers apart from one bound to frames (R-01).
const TRT_WORLD_FIRST = { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: false, params: {} };

async function stripGeometry(page: Page) {
  return page.locator('[data-strip="jog"], [data-strip="setup"]').evaluateAll(strips =>
    strips.flatMap(strip => {
      const origin = strip.getBoundingClientRect();
      return [...strip.querySelectorAll('button, input.setupInput')].map(control => {
        const box = control.getBoundingClientRect();
        return { label: control.textContent?.trim() || 'touch-off input',
          x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
      });
    }));
}

test.describe('strip layout', () => {
  test.afterEach(async () => { await ctlSend({ op: 'reset' }); });
  for (const profile of [
    { name: 'XYZ', axes: ['X', 'Y', 'Z'], kins: null },
    { name: 'XYZAC', axes: ['X', 'Y', 'Z', 'A', 'C'], kins: TRT },
    { name: 'XYZABC TWP', axes: ['X', 'Y', 'Z', 'A', 'B', 'C'], kins: TRSRN },
  ]) {
    for (const layout of ['landscape', 'landscape touch', 'portrait touch']) {
      const portrait = layout === 'portrait touch';
      test(`${profile.name} ${layout}: unhome preserves control geometry`, async ({ page }, testInfo) => {
        await ctlSend({ op: 'reset' });
        await page.setViewportSize(portrait ? { width: 900, height: 1200 } : { width: 1600, height: 1000 });
        await page.goto(MOCK);
        await expect(page.getByRole('button', { name: 'Zero X', exact: true })).toBeVisible();
        if (layout.includes('touch')) await page.evaluate(() => document.documentElement.classList.add('touch-device'));
        await ctlSend({ op: 'setAxes', axes: profile.axes });
        await ctlSend({ op: 'setKins', kins: profile.kins });
        const homed = {
          homed: profile.axes.map(() => 1), task_mode: 1,
          homed_joints: profile.axes.map(() => true),
          kins_type: profile.kins ? 0 : null, g5x_index: 1,
          permissions: { ...PERMS_ALL }, permission_reasons: {},
        };
        await ctlSend({ op: 'status_delta', data: homed });
        const setup = page.locator('[data-strip="setup"]');
        await expect(setup.getByRole('button', { name: 'Unhome All', exact: true })).toBeEnabled();
        await expect(setup.getByRole('button', { name: 'Unhome Z', exact: true })).toBeEnabled();
        await page.evaluate(() => document.fonts.ready);
        // Aggregate actions always follow ALL axis rows, followed by travel
        // and plane actions. No half-empty action column between axis groups.
        const footer = await setup.evaluate(el => {
          const axes = el.querySelector('.axisGrids')!.getBoundingClientRect();
          const rows = [...el.querySelectorAll('.actionRow')].map(row => {
            const box = row.getBoundingClientRect();
            return { x: box.x, y: box.y, width: box.width, bottom: box.bottom };
          });
          return { axesBottom: axes.bottom, bottom: el.getBoundingClientRect().bottom, rows };
        });
        expect(footer.rows).toHaveLength(profile.kins === TRSRN ? 3 : 2);
        expect(footer.rows[0]!.y).toBeGreaterThanOrEqual(footer.axesBottom);
        for (let row = 1; row < footer.rows.length; row++) {
          expect(footer.rows[row]!.y).toBeGreaterThanOrEqual(footer.rows[row - 1]!.bottom);
          expect(footer.rows[row]!.width).toBeCloseTo(footer.rows[0]!.width, 0);
        }
        expect(footer.rows.at(-1)!.bottom).toBeLessThanOrEqual(footer.bottom + 1);
        // WCS choices must also fit the fixed landscape height on touch.
        const clipped = await setup.evaluate(el => {
          const root = el.getBoundingClientRect();
          return [...el.querySelectorAll('button, input.setupInput, .wcsCol label')]
            .filter(control => {
              const box = control.getBoundingClientRect();
              return box.right > root.right + 1 || box.bottom > root.bottom + 1;
            }).map(control => control.textContent?.trim());
        });
        expect(clipped).toEqual([]);
        await setup.screenshot({ path: testInfo.outputPath('setup-homed.png') });
        const before = await stripGeometry(page);
        await ctlSend({ op: 'status_delta', data: {
          homed: profile.axes.map(() => 0),
          homed_joints: profile.axes.map(() => false),
          permissions: { ...PERMS_ALL, jog: !profile.kins, touchoff: false,
            touchoffRotary: false, machineFrame: false, goZero: false, twpCapture: false },
          permission_reasons: Object.fromEntries(['jog', 'touchoff', 'touchoffRotary',
            'machineFrame', 'goZero', 'twpCapture'].map(gate => [gate, 'Home all axes first'])),
        } });
        await expect(setup.getByRole('button', { name: 'Home All', exact: true })).toBeEnabled();
        await expect(setup.getByRole('button', { name: 'Home Z', exact: true })).toBeEnabled();
        await expect(setup.getByRole('button', { name: 'Zero X', exact: true })).toBeDisabled();
        const after = await stripGeometry(page);
        expect(after).toHaveLength(before.length);
        for (let i = 0; i < before.length; i++) {
          for (const key of ['x', 'y', 'width', 'height'] as const) {
            expect(Math.abs(after[i]![key] - before[i]![key]), `${before[i]!.label}: ${key}`)
              .toBeLessThanOrEqual(1);
          }
        }
        await setup.screenshot({ path: testInfo.outputPath('setup-unhomed.png') });
        await page.locator('.jogBtns').screenshot({ path: testInfo.outputPath('jog-unhomed.png') });
        // Re-enabling must restore both the controls and their original footprint.
        await ctlSend({ op: 'status_delta', data: homed });
        await expect(setup.getByRole('button', { name: 'Zero X', exact: true })).toBeEnabled();
        expect(await stripGeometry(page)).toEqual(before);
        if (layout === 'landscape') {
          // The compact footer must preserve the actual touch-off axis set:
          // Zero All on XYZ, Zero XYZ (never rotary offsets) on switchable kins.
          const zero = setup.getByRole('button', { name: profile.kins ? 'Zero XYZ' : 'Zero All', exact: true });
          await zero.scrollIntoViewIfNeeded();
          const box = (await zero.boundingBox())!;
          await ctlSend({ op: 'clearCmds' });
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          try {
            await expect.poll(async () => {
              const sent = await ctlSend({ op: 'lastCmds' }) as { cmds: { cmd: string; axes?: Record<string, number> }[] };
              return sent.cmds.filter(c => c.cmd === 'touchoff').map(c => c.axes);
            }).toEqual([{ X: 0, Y: 0, Z: 0 }]);
          } finally {
            await page.mouse.up();
          }
        }
      });
    }
  }
});

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
    const capture = page.getByRole("button", { name: "Capture plane", exact: true });
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
    await expect(page.getByRole("button", { name: "Capture plane", exact: true })).toHaveCount(0);
    await expect(page.locator('input[name="wcs"][value="G59"]')).not.toBeDisabled();
    await expect(page.locator('input[name="wcs"][value="G59.3"]')).not.toBeDisabled();
    // The TWP stack: same status, now G59 is reserved and Plane is offered.
    await ctlSend({ op: "setKins", kins: TRSRN });
    await expect(page.locator('input[name="jogFrame"][value="2"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Capture plane", exact: true })).toHaveCount(1);
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
    expectNoMachineAction(await recordedCmds());
    await messages.click();
    // Enabled again: no wrapper, so the tab order is the plain control's.
    await ctlSend({ op: "status_delta", data: { permissions: { ...PERMS_ALL }, permission_reasons: {} } });
    await expect(page.locator(".btnTip", { has: btn })).toHaveCount(0);
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("asking why never starts, pauses or resumes a program", async ({ page }) => {
  // R-06 (implementation review 2026-09-16): explainKeydown prevented the
  // default but the event still bubbled to the window, where Space is Cycle
  // Start by default — so asking a disabled control why it is disabled STARTED
  // THE LOADED PROGRAM. The earlier test could not see it: with no file loaded
  // the cycle branch falls through.
  await page.goto(MOCK);
  const btn = page.getByRole("button", { name: "Go to WCS 0", exact: true });
  await expect(btn).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    const REASON = { goZero: "Go to WCS 0 under TCP: select the Machine frame or the Plane frame first" };
    // Every state the cycle shortcut has a branch for: ready with a program
    // loaded, paused, and running.
    for (const [label, perms] of [
      ["ready with a program loaded", { ...PERMS_ALL, goZero: false }],
      ["paused", { ...PERMS_ALL, goZero: false, resume: true, pause: false }],
      ["running", { ...PERMS_ALL, goZero: false, pause: true, resume: false }],
    ] as const) {
      await ctlSend({ op: "status_delta", data: {
        active_file: "/loaded.ngc", permissions: perms, permission_reasons: REASON,
      } });
      await expect(btn).toBeDisabled();
      const tip = page.locator(".btnTip", { has: btn });
      await ctlSend({ op: "clearCmds" });
      await tip.focus();
      await page.keyboard.press(" ");
      const messages = page.getByRole("button", { name: /^Messages \(/ });
      await messages.click();
      await expect(page.locator(".msgText").first()).toContainText("select the Machine frame");
      await messages.click();
      expectNoMachineAction(await recordedCmds());
      // Enter is the other activation key.
      await ctlSend({ op: "clearCmds" });
      await tip.focus();
      await page.keyboard.press("Enter");
      expectNoMachineAction(await recordedCmds());
      expect(label.length).toBeGreaterThan(0);   // names the case in a failure
    }
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("Space on a focused control never reaches the Cycle Start shortcut", async ({ page }) => {
  // The same root cause as R-06 on an ORDINARY ENABLED button, which predates
  // the help affordance: the global map claimed Space, so tabbing to any
  // button and pressing it started the loaded program — and the button itself
  // never fired, because the shortcut's preventDefault suppressed the native
  // activation. (→ Zero is hold-to-fire, so ITS action is deliberately
  // pointer-only; what must not happen is a different machine action.)
  await page.goto(MOCK);
  const btn = page.getByRole("button", { name: "Go to WCS 0", exact: true });
  await expect(btn).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "status_delta", data: {
      active_file: "/loaded.ngc", permissions: { ...PERMS_ALL },
    } });
    await expect(btn).toBeEnabled();
    await ctlSend({ op: "clearCmds" });
    await btn.focus();
    await page.keyboard.press(" ");
    await page.waitForTimeout(300);
    expectNoMachineAction(await recordedCmds());
    // …and ordinary activation still works: Space on a plain button presses it
    // (the Messages button opens its dialog — a UI-only action, so this half
    // stays honest about sending nothing).
    const messages = page.getByRole("button", { name: /^Messages \(/ });
    await messages.focus();
    await page.keyboard.press(" ");
    await expect(page.getByText(/^Messages \(\d+\)$/)).toBeVisible();
    expectNoMachineAction(await recordedCmds());
    await page.getByRole("button", { name: "Close messages", exact: true }).click();
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("Space selects an ENABLED Plane radio; the explanation is only for the disabled one", async ({ page }) => {
  // R-07: the label's keydown handler was installed unconditionally, so its
  // preventDefault swallowed the native radio activation once Plane became
  // available — the radio could be clicked but not chosen from the keyboard.
  await page.goto(MOCK);
  await expect(page.getByRole("button", { name: "Zero X", exact: true })).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "setKins", kins: TRSRN });
    await ctlSend({ op: "status_delta", data: {
      kins_type: 0, g5x_index: 1, twp_defined: true, twp_active: true,
      twp_pose_a: 0, twp_pose_b: 0, twp_pose_c: 0, rotary_abc: [0, 0, 0],
      permissions: { ...PERMS_ALL },
    } });
    const plane = page.locator('input[name="jogFrame"][value="2"]');
    await expect(plane).toBeEnabled();
    await ctlSend({ op: "clearCmds" });
    await plane.focus();
    await page.keyboard.press(" ");
    await expect.poll(async () => {
      const sent = await ctlSend({ op: "lastCmds" }) as { cmds?: { cmd?: string; mode?: number }[] };
      return (sent.cmds ?? []).filter(c => c.cmd === "set_kins_mode").map(c => c.mode);
    }).toEqual([2]);
    // Disabled again: the same key explains instead, and commands nothing.
    await ctlSend({ op: "status_delta", data: {
      permissions: { ...PERMS_ALL, planeFrame: false },
      permission_reasons: { planeFrame: "Head not aligned with the plane — press Orient" },
    } });
    await expect(plane).toBeDisabled();
    await ctlSend({ op: "clearCmds" });
    await page.locator("label", { has: plane }).focus();
    await page.keyboard.press(" ");
    expectNoMachineAction(await recordedCmds());
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

// ── WP0 / UI-11: the keypad's field contract ──────────────────────────────
// ONE admissibility check feeds the readout, the OK button and confirm():
// an invalid expression (`1.2.3` used to confirm as 1.2 through parseFloat's
// prefix), a constraint violation and a fraction in an integer field are not
// confirmable by touch OR by physical Enter, and send nothing.

test("keypad refuses 1.2.3 on a touch-off field, shows empty as 0, confirms a valid value once", async ({ page }) => {
  await page.goto(MOCK);
  const zInput = page.locator("input.setupInput").nth(2);
  await expect(zInput).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "status_delta", data: { permissions: PERMS_ALL } });
    await ctlSend({ op: "clearCmds" });
    await zInput.click();
    const strip = page.locator(".nkStrip");
    await expect(strip).toBeVisible();
    // Fresh entry replaces the pre-filled value.
    await page.keyboard.type("1.2.3");
    await expect(strip.locator(".nkExpr")).toHaveText("1.2.3");
    await expect(strip.locator(".nkPreview")).toHaveText("invalid");
    const ok = strip.getByRole("button", { name: "Apply", exact: true });
    await expect(ok).toBeDisabled();
    await page.keyboard.press("Enter");
    await expect(strip).toBeVisible();
    expect(await recordedCmds()).not.toContain("touchoff");
    // C → empty → "= 0" is visible, not implied.
    await strip.getByRole("button", { name: "Clear entry", exact: true }).click();
    await expect(strip.locator(".nkPreview")).toHaveText("= 0");
    await expect(ok).toBeEnabled();
    await page.keyboard.type("5");
    await page.keyboard.press("Enter");
    await expect(strip).toHaveCount(0);
    const cmds = await recordedCmds();
    expect(cmds.filter(c => c === "touchoff")).toHaveLength(1);
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("tool number field: minimum 1 and whole numbers only, on Enter and on OK", async ({ page }) => {
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name: "+ Add", exact: true }).click();
    const dialog = page.locator(".dialogOverlay").last();
    const toolNo = dialog.locator("label", { hasText: "Tool #" }).locator("xpath=following-sibling::input[1]");
    const before = await toolNo.inputValue();
    await toolNo.click();
    const strip = page.locator(".nkStrip");
    await expect(strip).toBeVisible();
    await expect(strip.locator(".sub")).toContainText("Tool #");
    const ok = strip.getByRole("button", { name: "Apply", exact: true });
    await page.keyboard.type("0");
    await expect(strip.locator(".nkPreview")).toContainText("minimum 1");
    await expect(ok).toBeDisabled();
    await page.keyboard.press("Enter");
    await expect(strip).toBeVisible();
    // A real press on the disabled OK (force: no actionability wait) does nothing.
    await ok.click({ force: true });
    await expect(strip).toBeVisible();
    await expect(toolNo).toHaveValue(before);
    await strip.getByRole("button", { name: "Clear entry", exact: true }).click();
    await expect(strip.locator(".nkPreview")).toContainText("= 0 · minimum 1");
    await page.keyboard.type("2.5");
    await expect(strip.locator(".nkPreview")).toContainText("whole number required");
    await page.keyboard.press("Enter");
    await expect(strip).toBeVisible();
    await strip.getByRole("button", { name: "Clear entry", exact: true }).click();
    await page.keyboard.type("3");
    await page.keyboard.press("Enter");
    await expect(strip).toHaveCount(0);
    await expect(toolNo).toHaveValue("3");
    // Focus returned to the field that opened the keypad.
    await expect(toolNo).toBeFocused();
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

// ── WP6: hold target binding, hold hint, tool-change confirm, surface states, keypad owner ──

async function holdOn(page: Page, locator: ReturnType<Page["locator"]>, ms: number) {
  const box = (await locator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
}

test("Offsets Clear: disabled without a real selection, hold-to-fire, hold cancels when the target moves", async ({ page }) => {
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    // The default fixture ships no wcs_table; setAxes fills the nine rows.
    await ctlSend({ op: "setAxes", axes: ["X", "Y", "Z"] });
    // No g5x_index yet → the label is "-" → nothing selected → Clear disabled with a reason.
    await page.getByRole("button", { name: "Offsets", exact: true }).click();
    const clear = page.getByRole("button", { name: /^Clear (—|G5)/ });
    await expect(clear).toBeDisabled();
    await expect(page.locator(".btnTip", { has: clear })).toHaveAttribute("title", /Select a coordinate system/);
    // The active fixture selects itself once the status names one.
    await ctlSend({ op: "status_delta", data: { g5x_index: 2, permissions: PERMS_ALL } });
    await expect(clear).toBeEnabled();
    await expect(clear).toHaveText(/Clear\s+G55/);
    await ctlSend({ op: "clearCmds" });
    // A tap is not a hold: hint shown, nothing sent.
    await clear.click();
    await expect(page.locator("[data-btn-hint]")).toHaveText("Hold to activate");
    await page.waitForTimeout(300);
    expect(await recordedCmds()).not.toContain("clear_wcs");
    // Selection moves mid-hold (pin another row) → cancelled, nothing sent.
    await holdOn(page, clear, 200);
    await page.locator("tbody tr", { hasText: "G57" }).locator("td").first().dispatchEvent("click");
    await page.waitForTimeout(600);
    await page.mouse.up();
    expect(await recordedCmds()).not.toContain("clear_wcs");
    await expect(clear).toHaveText(/Clear\s+G57/);
    // Gate closes during the hold → cancelled even though it re-opens.
    await holdOn(page, clear, 150);
    await ctlSend({ op: "status_delta", data: { permissions: { ...PERMS_ALL, probe: false } } });
    await page.waitForTimeout(100);
    await ctlSend({ op: "status_delta", data: { permissions: PERMS_ALL } });
    await page.waitForTimeout(500);
    await page.mouse.up();
    expect(await recordedCmds()).not.toContain("clear_wcs");
    // A complete hold sends exactly one clear_wcs for the pinned target.
    await holdOn(page, clear, 700);
    await page.mouse.up();
    const sent = await ctlSend({ op: "lastCmds" }) as { cmds?: { cmd?: string; target?: string }[] };
    const clears = (sent.cmds ?? []).filter(c => c.cmd === "clear_wcs");
    expect(clears).toHaveLength(1);
    expect(clears[0]!.target).toBe("G57");
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("tool-change confirm: once per request, retry after a refusal, nothing without a request", async ({ page }) => {
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "status_delta", data: { tool_change_requested: true, tool_change_tool: 3, permissions: PERMS_ALL } });
    const dialog = page.locator(".safetyDialog .dialog", { hasText: "Load Tool into Spindle" });
    await expect(dialog).toBeVisible();
    await ctlSend({ op: "clearCmds" });
    const confirm = dialog.getByRole("button", { name: /Confirm/ });
    await confirm.click();
    await expect(dialog.getByRole("button", { name: "Confirming…", exact: true })).toBeDisabled();
    await confirm.click({ force: true }).catch(() => {});
    await page.waitForTimeout(200);
    const sent = await ctlSend({ op: "lastCmds" }) as { cmds?: { cmd?: string; req_id?: string }[] };
    const confirms = (sent.cmds ?? []).filter(c => c.cmd === "confirm_tool_change");
    expect(confirms).toHaveLength(1);
    // Refusal → the button comes back; a second confirm goes out.
    await ctlSend({ op: "raw", frame: { type: "reply", cmd: "confirm_tool_change", req_id: confirms[0]!.req_id, ok: false, error: "not pending" } });
    await expect(dialog.getByRole("button", { name: "Confirm", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect.poll(async () => ((await ctlSend({ op: "lastCmds" })).cmds ?? []).filter((c: any) => c.cmd === "confirm_tool_change").length).toBe(2);
    // Request ends → dialog gone; nothing more is sent.
    await ctlSend({ op: "status_delta", data: { tool_change_requested: false, tool_change_tool: null } });
    await expect(dialog).toHaveCount(0);
    expect(((await ctlSend({ op: "lastCmds" })).cmds ?? []).filter((c: any) => c.cmd === "confirm_tool_change").length).toBe(2);
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("surface map: empty state without a toast, error with retry, points load without a grid", async ({ page }) => {
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "status_delta", data: { permissions: PERMS_ALL } });
    await page.getByRole("button", { name: "Probing", exact: true }).click();
    await page.getByRole("button", { name: "Surface", exact: true }).click();
    const messages = page.getByRole("button", { name: /^Messages \(/ });
    const before = await messages.getAttribute("title");
    await ctlSend({ op: "clearCmds" });
    await page.getByRole("button", { name: /Reload Data|Loading…/ }).click();
    const sent = async () => ((await ctlSend({ op: "lastCmds" })).cmds ?? []) as { cmd?: string; req_id?: string }[];
    // The panel's own auto-fetch (view change, points/grid version) may send
    // a request after the click: the App correlates replies with the LATEST
    // request, so the test answers the latest one too.
    const last = async (cmd: string) => [...(await sent())].reverse().find(c => c.cmd === cmd)!;
    await expect.poll(async () => (await sent()).some(c => c.cmd === "get_probe_results") && (await sent()).some(c => c.cmd === "get_comp_grid")).toBe(true);
    const points = await last("get_probe_results");
    const grid = await last("get_comp_grid");
    // No grid yet is a STATE (ok, comp_grid null): empty text, no message.
    await ctlSend({ op: "raw", frame: { type: "reply", cmd: "get_comp_grid", req_id: grid.req_id, ok: true, comp_grid: null, reason: "no grid file" } });
    await ctlSend({ op: "raw", frame: { type: "reply", cmd: "get_probe_results", req_id: points.req_id, ok: true, points: [] } });
    await expect(page.getByText("No surface map recorded yet", { exact: true })).toBeVisible();
    await expect(page.getByText("No compensation grid yet", { exact: true })).toBeVisible();
    expect(await messages.getAttribute("title")).toBe(before);
    // A damaged grid file is an error with a retry; the points still load.
    await ctlSend({ op: "clearCmds" });
    await page.getByRole("button", { name: /Reload Data|Loading…/ }).click();
    await expect.poll(async () => (await sent()).length).toBeGreaterThanOrEqual(2);
    const points2 = await last("get_probe_results");
    // Points first: their arrival activates the surface viewer, which asks
    // for the grid once more — the LATEST grid request is the one whose
    // reply the panel shows, so it is answered after the points landed.
    await ctlSend({ op: "raw", frame: { type: "reply", cmd: "get_probe_results", req_id: points2.req_id, ok: true, points: [[0, 0, 0], [10, 0, 0.1], [0, 10, -0.1], [10, 10, 0]] } });
    await expect(page.getByText("No surface map recorded yet", { exact: true })).toHaveCount(0);
    await page.waitForTimeout(300);
    const grid2 = await last("get_comp_grid");
    await ctlSend({ op: "raw", frame: { type: "reply", cmd: "get_comp_grid", req_id: grid2.req_id, ok: false, error: "Invalid grid file" } });
    await expect(page.getByText(/Grid: Invalid grid file/)).toBeVisible();
    await expect(page.getByText("No surface map recorded yet", { exact: true })).toHaveCount(0);
    await ctlSend({ op: "clearCmds" });
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(async () => (await sent()).map(c => c.cmd)).toContain("get_comp_grid");
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

test("keypad owner: dialog close, gate change and a second field end or retarget the session", async ({ page }) => {
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "status_delta", data: { permissions: PERMS_ALL } });
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    await page.getByRole("button", { name: "+ Add", exact: true }).click();
    const dialog = page.locator(".editDialog");
    const field = (name: string) => dialog.locator("label", { hasText: name }).locator("xpath=following-sibling::input[1]");
    await field("Diameter").click();
    const strip = page.locator(".nkStrip");
    await expect(strip.locator(".sub")).toHaveText("New tool · Diameter · mm");
    // Second field retargets: the header names it, the first draft is not confirmed.
    await page.keyboard.type("12");
    await field("Flutes").click();
    await expect(strip.locator(".sub")).toHaveText("New tool · Flutes");
    await expect(field("Diameter")).toHaveValue("0");
    // Closing the dialog while the keypad is open ends the session.
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(strip).toHaveCount(0);
    // Gate change while open on a strip field closes it too.
    await page.locator("input.setupInput").first().click();
    await expect(strip).toBeVisible();
    await ctlSend({ op: "status_delta", data: { permissions: { ...PERMS_ALL, touchoff: false } } });
    await expect(strip).toHaveCount(0);
    await ctlSend({ op: "status_delta", data: { permissions: PERMS_ALL } });
  } finally {
    await ctlSend({ op: "quiet", on: false });
    await ctlSend({ op: "reset" });
  }
});

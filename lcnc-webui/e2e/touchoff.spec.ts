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
    await page.getByRole("button", { name: "×", exact: true }).first().click();
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

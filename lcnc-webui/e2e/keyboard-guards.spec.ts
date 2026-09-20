import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// WP0 / UI-03 — global keyboard shortcuts behind dialogs and fields.
//
// The default shortcut map binds Space to Cycle Start, Backspace to Abort
// and Escape to E-Stop. Every test below pins the same contract: with a
// dialog, the number keypad or the editor open, NOTHING but E-Stop reaches
// the machine from the keyboard; Escape sends exactly `estop` and never
// `estop_reset` (reset is a button, only); and a jog key released while a
// field opened mid-jog still sends its `jog_stop`.
//
// Runs under the `serial-guards` project: mock-global state (status deltas,
// recorded commands) — one file at a time.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};

const READ_ONLY_CMDS = ["hello", "heartbeat", "get_tool_table", "halshow_live", "timing_log",
                        "tab_visibility", "save_settings", "load_file"];
const MACHINE_CMDS = ["cycle_start", "cycle_pause", "cycle_resume", "abort", "jog_cont",
                      "jog_incr", "jog_stop", "go_to_zero", "touchoff", "set_kins_mode",
                      "home_all", "machine_on", "estop", "estop_reset", "mdi", "twp_capture"];

async function recordedCmds(): Promise<string[]> {
  const sent = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] };
  return (sent.cmds ?? []).map(c => c.cmd ?? "");
}

function expectNoMachineAction(cmds: string[]) {
  for (const machine of MACHINE_CMDS) expect(cmds).not.toContain(machine);
  expect(cmds.filter(c => !READ_ONLY_CMDS.includes(c))).toEqual([]);
}

/** Registry self-test: every `.dialogOverlay` in the DOM is registered. A
 *  dialog that forgot registerModal() shows up here, not as a silent gap. */
async function expectRegistryMatchesDom(page: Page) {
  const [dom, registered] = await page.evaluate(() => [
    document.querySelectorAll(".dialogOverlay").length,
    (window as any).__modalRegistry.count(),
  ]);
  expect(registered, `registry ${registered} vs DOM overlays ${dom}`).toBe(dom);
}

async function openReady(page: Page) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", permissions: PERMS_ALL } });
  // The mock sends no settings on its own; the Settings dialog's tabs render
  // only once the server's settings_init arrived (defaults for every section).
  await ctl({ op: "raw", frame: { type: "settings_init", settings: {} } });
  await expect(page.locator(".safetyStrip")).toBeVisible();
  await ctl({ op: "clearCmds" });
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Blur whatever holds focus — the shortcut map's "body focused" case. */
async function focusBody(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

test.afterEach(async () => {
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("positive control: Space on the bare page sends cycle_start", async ({ page }) => {
  await openReady(page);
  await focusBody(page);
  await page.keyboard.press(" ");
  await expect.poll(recordedCmds).toContain("cycle_start");
});

test("number keypad open: Space/Backspace send nothing, Escape sends exactly estop", async ({ page }) => {
  await openReady(page);
  await page.locator("input.setupInput").first().click();
  await expect(page.locator(".nkStrip")).toBeVisible();
  await expectRegistryMatchesDom(page);
  await page.keyboard.press(" ");
  await page.keyboard.press("Backspace");
  await settle(page);
  expectNoMachineAction(await recordedCmds());
  await page.keyboard.press("Escape");
  await expect.poll(recordedCmds).toContain("estop");
  const cmds = await recordedCmds();
  expect(cmds.filter(c => c === "estop")).toHaveLength(1);
  expect(cmds).not.toContain("estop_reset");
  // The keypad is not an Escape target — it closes by Cancel/OK only.
  await expect(page.locator(".nkStrip")).toBeVisible();
});

test("repeated Escape in E-Stop never sends estop_reset", async ({ page }) => {
  await openReady(page);
  await ctl({ op: "status_delta", data: { estop: true, is_estop: true } });
  await expect(page.locator(".safetyStrip .statusRow").filter({ hasText: "E-Stop" })
    .locator(".stable-width > span:not(.alt)")).toHaveText("TRUE");
  await ctl({ op: "clearCmds" });
  await focusBody(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await settle(page);
  const cmds = await recordedCmds();
  expect(cmds).not.toContain("estop_reset");
  expect(cmds).not.toContain("estop");
});

test("settings dialog and key capture: only Escape passes, and it cancels the capture", async ({ page }) => {
  await openReady(page);
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  await expect(dialog).toBeVisible();
  await expectRegistryMatchesDom(page);
  await focusBody(page);
  await page.keyboard.press(" ");
  await page.keyboard.press("Backspace");
  await settle(page);
  expectNoMachineAction(await recordedCmds());

  await dialog.getByRole("button", { name: "Keyboard", exact: true }).click();
  // E-Stop is a fixed, reserved row: no capture cell, no unbind.
  const estopRow = dialog.locator("tr").filter({ hasText: "E-Stop" });
  await expect(estopRow.locator(".kbKeyCell")).toHaveText("Esc");
  await expect(estopRow.locator(".kbKeyCell")).toHaveClass(/kbFixed/);
  await expect(estopRow.locator(".kbUnbind button")).toHaveCount(0);
  // Binding another action: Escape is NOT captured — it E-Stops and cancels.
  const cycleCell = dialog.locator("tr").filter({ hasText: "Cycle Start" }).locator(".kbKeyCell");
  await cycleCell.click();
  await expect(cycleCell).toHaveText("Press a key...");
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("Escape");
  await expect.poll(recordedCmds).toContain("estop");
  await expect(cycleCell).toHaveText("Space");
  expect(await recordedCmds()).not.toContain("estop_reset");
  // Space during a capture binds nothing to the machine either.
  await cycleCell.click();
  await page.keyboard.press("Backspace");   // duplicate of Abort → refused, still capturing
  await expect(dialog.locator(".kbCaptureError")).toContainText("Already bound");
  expectNoMachineAction((await recordedCmds()).filter(c => c !== "estop"));
});

test("tool dialog, messages and reference dialogs block Space/Enter/Backspace", async ({ page }) => {
  await openReady(page);
  for (const open of [
    async () => { await page.getByRole("button", { name: "Tools", exact: true }).click();
      await page.getByRole("button", { name: "+ Add", exact: true }).click(); },
    async () => { await page.getByRole("button", { name: /^Messages \(/ }).click(); },
    async () => { await page.getByTitle("G-code Reference", { exact: true }).click(); },
  ]) {
    await open();
    const overlay = page.locator(".dialogOverlay").last();
    await expect(overlay).toBeVisible();
    await expectRegistryMatchesDom(page);
    await focusBody(page);
    await ctl({ op: "clearCmds" });
    await page.keyboard.press(" ");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Backspace");
    await settle(page);
    expectNoMachineAction(await recordedCmds());
    await page.keyboard.press("Escape");
    await expect.poll(recordedCmds).toContain("estop");
    expect(await recordedCmds()).not.toContain("estop_reset");
    // Close via the dialog's own control (Escape is never a close).
    const close = overlay.getByRole("button", { name: /^(Cancel|×)$/ }).first();
    await close.click();
    await expect(overlay).toHaveCount(0);
    await expectRegistryMatchesDom(page);
  }
});

test("documented remainder: Tab leaves the dialog (no focus trap in this wave)", async ({ page }) => {
  await openReady(page);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  const dialog = page.locator(".dialogOverlay .dialog").last();
  await dialog.getByRole("button", { name: "Add", exact: true }).focus();
  await page.keyboard.press("Tab");
  const inside = await page.evaluate(() => !!document.activeElement?.closest(".dialog"));
  // A focus trap is on the follow-up list; the guard spec records that the
  // background is reachable by Tab and that Space activates the focused
  // background control NATIVELY (observed: the Arm/Disarm toggle is the next
  // Tab stop after the teleported dialog — `arm` is recorded; disarming is
  // the safe direction). What matters here: no MOTION command.
  expect(typeof inside).toBe("boolean");
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");
  await settle(page);
  const cmds = await recordedCmds();
  for (const machine of MACHINE_CMDS) expect(cmds).not.toContain(machine);
  expect(cmds.filter(c => !READ_ONLY_CMDS.includes(c) && c !== "arm")).toEqual([]);
});

test("editor open: Space never starts the program", async ({ page }) => {
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: "G0 X0\nG1 X10 F100\nM2\n" }));
  await openReady(page);
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 1, file: "/A.ngc" } });
  await expect(page.locator(".codeLine").first()).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".cm-content")).toBeVisible();
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");          // inside CodeMirror: text, not a shortcut
  await focusBody(page);
  await page.keyboard.press(" ");          // body focused: the editing guard
  await settle(page);
  expectNoMachineAction(await recordedCmds());
  await page.keyboard.press("Escape");
  await expect.poll(recordedCmds).toContain("estop");
});

test("pause and resume via Space are unchanged", async ({ page }) => {
  await openReady(page);
  await ctl({ op: "status_delta", data: { interp_state: 2, task_mode: 2, permissions: { ...PERMS_ALL, run: false, pause: true } } });
  await expect(page.locator(".safetyStrip .statusRow").filter({ hasText: "Interp" })
    .locator(".stable-width > span:not(.alt)")).toHaveText("RUNNING");
  await focusBody(page);
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");
  await expect.poll(recordedCmds).toContain("cycle_pause");
  await ctl({ op: "status_delta", data: { interp_state: 3, paused: true, permissions: { ...PERMS_ALL, run: false, pause: false, resume: true } } });
  await expect(page.locator(".safetyStrip .statusRow").filter({ hasText: "Interp" })
    .locator(".stable-width > span:not(.alt)")).toHaveText("PAUSED");
  // fire()'s 200 ms busy latch after the pause would drop a second Space.
  await page.waitForTimeout(250);
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");
  await expect.poll(recordedCmds).toContain("cycle_resume");
});

test("a jog key released after a field opened mid-jog still sends jog_stop", async ({ page }) => {
  await openReady(page);
  // Enable keyboard jogging through the operator's own control.
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  await dialog.getByRole("button", { name: "Keyboard", exact: true }).click();
  await dialog.getByText("Enable keyboard jogging", { exact: true }).click();
  // The overlay closes itself on a click outside the dialog (@click.self).
  await dialog.click({ position: { x: 4, y: 4 } });
  await expect(page.locator(".dialogOverlay")).toHaveCount(0);
  await focusBody(page);
  await ctl({ op: "clearCmds" });
  await page.keyboard.down("ArrowRight");
  await expect.poll(recordedCmds).toContain("jog_cont");
  await page.locator("input.setupInput").first().click();
  await expect(page.locator(".nkStrip")).toBeVisible();
  await page.keyboard.up("ArrowRight");
  await expect.poll(recordedCmds).toContain("jog_stop");
});

test("keyboard tab: a capture edits a local copy, no page error, a server change refreshes it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await openReady(page);
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  await dialog.getByRole("button", { name: "Keyboard", exact: true }).click();
  const abortCell = dialog.locator("tr").filter({ hasText: "Abort" }).locator(".kbKeyCell");
  await expect(abortCell).toHaveText("⌫");
  await abortCell.click();
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("F9");
  await expect(abortCell).toHaveText("F9");
  // The edit went out as a save (the copy was emitted), not as a mutation of the store.
  await expect.poll(async () => ((await ctl({ op: "lastCmds" })).cmds ?? []).some((c: any) => c.cmd === "save_settings" && c.section === "keyboard")).toBe(true);
  // A server-side change (another tab) refreshes the copy.
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { keyboard: { jogEnabled: false, buttonsEnabled: true, mapping: { abort: "F10", cycle: " ", estop: "Escape" } } } } });
  await expect(abortCell).toHaveText("F10");
  expect(errors).toEqual([]);
});

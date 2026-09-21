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

test("keypad OK: Space through the whole focus return never starts the program; Escape still E-Stops", async ({ page }) => {
  // Review round 2 (UI-I06): the field's own confirm disables it for the
  // busy latch, the focus it just took drops to body, and between the
  // latch's end and a fixed re-focus delay Space reached the shortcut map
  // (`touchoff` followed by `cycle_start`, 3 of 3). The return is now a
  // guarded transition: Space is hammered from the confirm until focus has
  // landed on the field — every phase of the window — and nothing but the
  // touch-off may be sent. Escape stays E-Stop throughout.
  await openReady(page);
  const x = page.locator("input.setupInput").first();
  const nk = page.locator(".nkStrip");
  await x.click();
  await expect(nk).toBeVisible();
  await page.keyboard.type("17");
  await page.keyboard.press("Enter");
  await expect(nk).toHaveCount(0);
  const t0 = Date.now();
  while (Date.now() - t0 < 700) {
    // Stop once the field holds focus again (Space there would re-open the keypad).
    if (await x.evaluate(el => document.activeElement === el)) break;
    await page.keyboard.press(" ");
    await page.waitForTimeout(8);
  }
  if (await nk.count()) await nk.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(x).toBeFocused();
  let cmds = await recordedCmds();
  expect(cmds.filter(c => c === "touchoff")).toHaveLength(1);
  expect(cmds).not.toContain("cycle_start");
  expectNoMachineAction(cmds.filter(c => c !== "touchoff"));
  // Escape inside the same window sends estop (the guard never holds E-Stop).
  await ctl({ op: "clearCmds" });
  await x.click();
  await page.keyboard.type("18");
  await nk.getByRole("button", { name: "Apply", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect.poll(recordedCmds).toContain("estop");
  await expect(x).toBeFocused();
  cmds = await recordedCmds();
  expect(cmds).not.toContain("cycle_start");
  // Positive control: with the return landed, an unfocused page is an
  // operating position again — the guard is a transition, not a latch.
  await focusBody(page);
  await page.keyboard.press(" ");
  await expect.poll(recordedCmds).toContain("cycle_start");
});

/** Real Tab navigation until `target` holds focus (bounded). */
async function tabTo(page: Page, target: import("@playwright/test").Locator, limit = 40): Promise<boolean> {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return true;
    await page.keyboard.press("Tab");
  }
  return target.evaluate(el => el === document.activeElement);
}

test("a focused key acts as itself: Enter on Discard discards, Space on a digit appends, Enter on OK confirms once; text keys act on Enter/Space", async ({ page }) => {
  // Review UI-I10 (P1): the keypad root's Enter handler confirmed the value
  // whichever key held focus — Tab to Cancel + Enter sent a touch-off — and
  // the text keyboard's keys, acting on pointerdown only, were dead to a
  // native Enter/Space. Keys act on click now: pointer and keyboard, once.
  await openReady(page);
  const x = page.locator("input.setupInput").first();
  const nk = page.locator(".nkStrip");
  await x.click();
  await expect(nk).toBeFocused();
  await page.keyboard.type("17");
  expect(await tabTo(page, nk.getByRole("button", { name: "Discard", exact: true })), "Discard reached by real Tab navigation").toBe(true);
  await page.keyboard.press("Enter");
  await expect(nk).toHaveCount(0);
  await settle(page);
  expectNoMachineAction(await recordedCmds());
  await expect(x).toBeFocused();
  // Discard is Discard: the draft is gone, the field re-opens with its value.
  await x.click();
  await expect(nk).toBeFocused();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
  // Space on a focused digit key appends — the native activation — once each.
  expect(await tabTo(page, nk.getByRole("button", { name: "7", exact: true }))).toBe(true);
  await page.keyboard.press(" ");
  await expect(nk.locator(".nkExpr")).toHaveText("7");
  await page.keyboard.press(" ");
  await expect(nk.locator(".nkExpr")).toHaveText("77");
  // Enter on the focused OK confirms exactly once.
  expect(await tabTo(page, nk.getByRole("button", { name: "Apply", exact: true }))).toBe(true);
  await page.keyboard.press("Enter");
  await expect(nk).toHaveCount(0);
  await expect.poll(async () => (await recordedCmds()).filter(c => c === "touchoff").length).toBe(1);
  await expect(x).toBeFocused();
  // Enter on the ROOT — the entry itself — still confirms.
  await x.click();
  await expect(nk).toBeFocused();
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");
  await expect(nk).toHaveCount(0);
  await expect.poll(async () => (await recordedCmds()).filter(c => c === "touchoff").length).toBe(2);
  await expect(x).toBeFocused();
  // Text keyboard: a focused key acts on Enter and on Space, once; a
  // focused Close closes — the same action the pointer click runs.
  await page.getByRole("button", { name: "MDI", exact: true }).click();
  const mdi = page.locator(".mdiInput");
  await mdi.click();
  const tk = page.locator(".tkStrip");
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "G", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(mdi).toHaveValue("G");
  await tk.getByRole("button", { name: "1", exact: true }).focus();
  await page.keyboard.press(" ");
  await expect(mdi).toHaveValue("G1");
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "Close keyboard", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(tk).toHaveCount(0);
  await expect(mdi).toHaveValue("G1");
  await settle(page);
  const cmds = await recordedCmds();
  expect(cmds.filter(c => c === "touchoff")).toHaveLength(2);
  expectNoMachineAction(cmds.filter(c => c !== "touchoff"));
});

test("an explicit close by keyboard returns focus: Enter/Space on the keyboard's X, Done in a search field and the editor's X leave the owner focused; the next Space types, never starts the program", async ({ page }) => {
  // Review round 4 (UI-I10 rest): the X activated by Tab + Enter/Space
  // unmounted with focus ON it — focus fell to body, the helper's modal
  // guard fell with the session, and the next Space was Cycle Start (6/6).
  // The X hands focus back through the guarded return now, and the MDI
  // line sends on keydown, so the Enter that activated the X never sends.
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: "G0 X0\nM2\n" }));
  await openReady(page);
  await page.getByRole("button", { name: "MDI", exact: true }).click();
  const mdi = page.locator(".mdiInput");
  const tk = page.locator(".tkStrip");
  await mdi.click();
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "G", exact: true }).click();
  await tk.getByRole("button", { name: "1", exact: true }).click();
  await expect(mdi).toHaveValue("G1");
  let expected = "G1";
  for (const activation of ["Enter", " "]) {
    if (!(await tk.count())) { await mdi.click(); await expect(tk).toBeVisible(); }
    await tk.getByRole("button", { name: "Close keyboard", exact: true }).focus();
    await page.keyboard.press(activation);
    await expect(tk).toHaveCount(0);
    await expect(mdi).toHaveValue(expected);
    await expect(mdi).toBeFocused();
    await expect.poll(() => page.evaluate(() => (window as any).__modalRegistry.open())).toBe(false);
    // Continuing to type is typing — the Space lands in the line.
    await page.keyboard.press(" ");
    expected += " ";
    await expect(mdi).toHaveValue(expected);
  }
  await settle(page);
  expectNoMachineAction(await recordedCmds());
  // A plain text field: Done by Enter leaves the search field focused.
  await page.getByTitle("G-code Reference", { exact: true }).click();
  const overlay = page.locator(".dialogOverlay").first();
  const search = overlay.locator("input.inputField").first();
  await search.click();
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "g", exact: true }).click();
  await tk.getByRole("button", { name: "Done", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(tk).toHaveCount(0);
  await expect(search).toBeFocused();
  await page.keyboard.press(" ");
  await expect(search).toHaveValue("g ");
  await overlay.getByRole("button", { name: /^(Cancel|Close .*)$/ }).first().click();
  await expect(overlay).toHaveCount(0);
  // The editor: its X hands focus to the CodeMirror content.
  await page.getByRole("button", { name: "Program", exact: true }).click();
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 1, file: "/A.ngc" } });
  await expect(page.locator(".codeLine").first()).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const content = page.locator(".cm-content");
  await expect(content).toBeVisible();
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "Close keyboard", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(tk).toHaveCount(0);
  await expect(content).toBeFocused();
  await page.keyboard.press(" ");
  await settle(page);
  expectNoMachineAction(await recordedCmds());
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
    const close = overlay.getByRole("button", { name: /^(Cancel|Close .*)$/ }).first();
    await close.click();
    await expect(overlay).toHaveCount(0);
    await expectRegistryMatchesDom(page);
  }
});

test("tool editor: header X and footer Cancel close an unchanged form at once and ask when it was edited; Keep editing keeps the values", async ({ page }) => {
  // UX-02: the X ran the same silent discard as Cancel while the overlay
  // was already hardened against a mis-grab. One check for both now.
  await openReady(page);
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  const dialog = page.locator(".editDialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close tool editor", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await expect(dialog).toBeVisible();
  const desc = dialog.locator("#tool-description");
  await desc.click();
  await page.keyboard.type("6 mm endmill");
  await dialog.getByRole("button", { name: "Close tool editor", exact: true }).click();
  const ask = page.locator(".dialogOverlay").last();
  await expect(ask.getByText("Discard changes?")).toBeVisible();
  await expectRegistryMatchesDom(page);
  await ask.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(desc).toHaveValue("6 mm endmill");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".dialogOverlay").last().getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await settle(page);
  expectNoMachineAction(await recordedCmds());
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

test("settings save status: Saving… on a change, Saved on the gateway's ok, the reason on ok:false", async ({ page }) => {
  // UX-08: the header's "saved automatically" is a promise with a proof —
  // the status follows the correlated reply, never the send alone.
  await openReady(page);
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  const status = dialog.locator(".saveStatus");
  await expect(status).toHaveText("");
  await dialog.getByRole("button", { name: "Keyboard", exact: true }).click();
  const abortCell = dialog.locator("tr").filter({ hasText: "Abort" }).locator(".kbKeyCell");
  await ctl({ op: "clearCmds" });
  await abortCell.click();
  await page.keyboard.press("F9");
  await expect(status).toHaveText("Saving…");
  const saveReq = async () => {
    const sent = ((await ctl({ op: "lastCmds" })).cmds ?? []) as { cmd?: string; section?: string; req_id?: string }[];
    return sent.filter(c => c.cmd === "save_settings" && c.section === "keyboard").at(-1)?.req_id;
  };
  await expect.poll(saveReq).toMatch(/\S/);
  await ctl({ op: "raw", frame: { type: "reply", cmd: "save_settings", ok: true, req_id: await saveReq() } });
  await expect(status).toHaveText("Saved");
  await ctl({ op: "clearCmds" });
  await abortCell.click();
  await page.keyboard.press("F10");
  await expect(status).toHaveText("Saving…");
  await expect.poll(saveReq).toMatch(/\S/);
  await ctl({ op: "raw", frame: { type: "reply", cmd: "save_settings", ok: false, error: "disk full", req_id: await saveReq() } });
  await expect(status).toHaveText("Save failed — disk full");
  // A foreign reply moves nothing.
  await ctl({ op: "raw", frame: { type: "reply", cmd: "save_settings", ok: true, req_id: "nobody-1" } });
  await page.waitForTimeout(100);
  await expect(status).toHaveText("Save failed — disk full");
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

import { test, expect, type Page, type Locator } from "./test";
import { ctl, MOCK, publishToolTable } from "./ctl";
import { toolsetterSetup, toolsetterVarMap } from "../src/toolsetterSetup";

// Codex review R15 B1: the toolsetter's values reach the machine only when it
// is SET UP — every required field in the section the SERVER confirmed, each
// valid. R16 XZ-06: every M600 the WebUI starts is ONE command, `mdi` with
// the values in `vars` — the gateway sets them and sends the line only once
// the interpreter took them over; no continuation waits in the browser for
// an abort (any client's) to miss. A config without a saved
// section used to push TOOLSETTER_FALLBACK's zeros on each Measure Current
// (the XYZAC sim's var file, 2026-09-27). Guard list: section missing, server
// data pending, a partial section, a save never confirmed, the takeover
// refused, a valid setup with zeros, Reset, another INI's blob.
//
// The worker's own mock (e2e/test.ts): its state is this test's alone, reset
// and checked before every test.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  // button gates D
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
const SET_UP = {
  touchX: 0, touchY: 0, touchZ: -300, fastFeed: 200, slowFeed: 0, traverseFeed: 500,
  maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180,
};
const M600 = { machine: { toolChangeMode: "m600" } };
const UNSET = "Toolsetter not set up — Probing › Toolsetter";

async function open(page: Page, settings: Record<string, unknown> | null) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  // the page's first settings read fails: the server's blob has not arrived
  // (the mock answers it with this device's view otherwise)
  if (settings === null) {
    await page.route(/\/settings$/, r => r.fulfill({ status: 503, body: "" }));
    await ctl({ op: "settingsOnHello", on: false });
  }
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL, tool_number: 5 } });
  if (settings) await ctl({ op: "raw", frame: { type: "settings_init", settings } });
  await ctl({ op: "clearCmds" });
}

const sent = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; [k: string]: unknown }[])
  .filter(c => !["hello", "arm", "client_diag", "tab_visibility", "get_tool_table"].includes(c.cmd));

/** Measure Current starts motion: a HOLD (design wave D6), not a tap. */
async function hold(page: Page, target: Locator) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);   // > HOLD_FIRE_MS (500)
  await page.mouse.up();
}

async function reasonAt(page: Page, name: string) {
  const btn = page.getByRole("button", { name, exact: true });
  await expect(btn).toBeDisabled();
  await btn.locator("xpath=..").click({ force: true });   // the .btnTip wrapper explains
  return page.locator(".btnHint");
}

test("without the server's settings, and without a saved section, Measure Current and Unload (M600) stay off — with the reason", async ({ page }) => {
  await open(page, null);                          // the server's blob has not arrived
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(await reasonAt(page, "Measure Current")).toHaveText("Settings not loaded yet — wait");
  await ctl({ op: "raw", frame: { type: "settings_init", settings: M600 } });
  // ctl returns once the mock SENT the frame; under load the page takes it a
  // little later, and a hint shown meanwhile keeps the old reason — ask again
  await expect.poll(async () => (await reasonAt(page, "Measure Current")).innerText()).toBe(UNSET);
  await expect(await reasonAt(page, "Unload")).toHaveText(UNSET);
  expect(await sent(), "nothing reached the machine").toEqual([]);
});

test("the gate sits in the call path: a tool-table load in M600 mode sends nothing while the setter is not set up", async ({ page }) => {
  await open(page, { ...M600, toolsetter: { touchZ: -300 } });
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await publishToolTable([{ T: 7, P: 7, Z: -40, D: 6, type: "endmill", description: "Load me" }]);
  await page.getByRole("button", { name: "T7", exact: true }).click();
  await expect(page.locator(".bannerContent")).toContainText(`Load T7 not sent — ${UNSET}`);
  expect(await sent()).toEqual([]);
});

test("a partial section: the form names what is missing, shows unset fields empty, and a change saves only that field", async ({ page }) => {
  await open(page, { toolsetter: { touchZ: -300 } });
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  await page.getByRole("tab", { name: "Toolsetter", exact: true }).click();
  const note = page.locator(".tsPanel .statusNote.warn");
  await expect(note).toContainText("Not set up — enter Touch X, Touch Y, Fast Feed");
  await expect(page.getByRole("textbox", { name: "Touch X", exact: true })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Touch Z", exact: true })).toHaveValue("-300");
  await expect(page.getByRole("textbox", { name: "Extra Retries", exact: true }), "an option shows its default").toHaveValue("0");
  await page.getByRole("textbox", { name: "Fast Feed", exact: true }).click();
  const pad = page.locator(".nkStrip");
  for (const k of ["2", "0", "0"]) await pad.getByRole("button", { name: k, exact: true }).click();
  await pad.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "save_settings").at(-1)?.data)
    .toEqual({ touchZ: -300, fastFeed: 200 });
  expect((await sent()).map(c => c.cmd), "saved, nothing pushed").not.toContain("set_probe_vars");
});

test("a save the server never confirmed is no setup; its confirmation is", async ({ page }) => {
  const { spindleZeroHeight: _last, ...almost } = SET_UP;
  await open(page, { ...M600, toolsetter: almost });
  // the mock answers no save here (button gates BG-19: by default it acts
  // like the gateway and broadcasts the blob — this test needs a save the
  // server never confirmed)
  await ctl({ op: "settingsEcho", on: false });
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  await page.getByRole("tab", { name: "Toolsetter", exact: true }).click();
  await page.getByRole("textbox", { name: "Spindle Zero Height", exact: true }).click();
  const pad = page.locator(".nkStrip");
  for (const k of ["1", "8", "0"]) await pad.getByRole("button", { name: k, exact: true }).click();
  await pad.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(async () => (await sent()).some(c => c.cmd === "save_settings")).toBe(true);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  // The mock never broadcasts the save: only this tab's optimistic copy has it.
  await expect(page.getByRole("button", { name: "Measure Current", exact: true })).toBeDisabled();
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { ...M600, toolsetter: SET_UP } } });
  await expect(page.getByRole("button", { name: "Measure Current", exact: true })).toBeEnabled();
  // Another INI's blob (no section): off again.
  await ctl({ op: "raw", frame: { type: "settings_init", settings: M600 } });
  await expect(page.getByRole("button", { name: "Measure Current", exact: true })).toBeDisabled();
});

test("Measure Current is ONE command: the values ride the mdi — a refusal says why and nothing follows (Codex R16 XZ-06)", async ({ page }) => {
  await open(page, { ...M600, toolsetter: SET_UP });   // zeros in X/Y and slow feed 0: a valid setup
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  const measure = page.getByRole("button", { name: "Measure Current", exact: true });
  await ctl({ op: "replies", replies: { mdi: { ok: false, error: "Parameters not taken over — nothing started", mdi_set: false } } });
  await hold(page, measure);
  await expect(page.locator(".bannerContent")).toContainText("Measure Current not started — Parameters not taken over — nothing started");
  expect((await sent()).map(c => c.cmd), "one command, refused").toEqual(["mdi"]);
  await page.waitForTimeout(400);   // the latch after the refused command
  await ctl({ op: "replies", replies: { mdi: { ok: true, persisted: true, mdi_set: true } } });
  await ctl({ op: "clearCmds" });
  await hold(page, measure);
  await expect.poll(async () => (await sent()).map(c => c.cmd)).toEqual(["mdi"]);
  const [mdi] = await sent();
  expect(mdi.text).toBe("T5 M600");
  expect(mdi.vars).toMatchObject({ "3100": 0, "3101": 0, "3102": -300, "3004": 200, "3005": 0 });
});

test("an abort while the reply is outstanding leaves nothing to send: a late success after it, or after a cleared setup, sends nothing more (Codex R16 XZ-06)", async ({ page }) => {
  await open(page, { ...M600, toolsetter: SET_UP });
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await hold(page, page.getByRole("button", { name: "Measure Current", exact: true }));
  await expect.poll(async () => (await sent()).map(c => c.cmd)).toEqual(["mdi"]);
  const [pending] = await sent();   // the mock withholds the reply
  await page.locator(".sidePane").getByRole("button", { name: "Abort", exact: true }).click();
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { ...M600, toolsetter: {} } } });
  await ctl({ op: "raw", frame: { type: "reply", cmd: "mdi", req_id: pending.req_id, ok: true, persisted: true, mdi_set: true } });
  await page.waitForTimeout(500);
  expect((await sent()).map(c => c.cmd)).toEqual(["mdi", "abort"]);
});

test("Reset clears the section — no field counts as saved, nothing is pushed", async ({ page }) => {
  await open(page, { toolsetter: SET_UP });
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  await page.getByRole("tab", { name: "Toolsetter", exact: true }).click();
  await page.getByRole("button", { name: "Reset Toolsetter", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Reset Toolsetter settings?", exact: true });
  await expect(ask).toContainText("stay off until they are entered again");
  await ask.getByRole("button", { name: "Reset", exact: true }).click();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "save_settings").at(-1)?.data).toEqual({});
  await expect(page.getByRole("textbox", { name: "Touch Z", exact: true })).toHaveValue("");
  expect((await sent()).map(c => c.cmd)).not.toContain("set_probe_vars");
});

test("Unload is ONE command: T0 M600 with the setter's values in M600 mode, tool_change 0 in the standard mode", async ({ page }) => {
  // The function inventory's F-TOOLMEASURE S6 (the browser half; the gate
  // without a setup is the first test above).
  await open(page, { ...M600, toolsetter: SET_UP });
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  const unload = page.getByRole("button", { name: "Unload", exact: true });
  await expect(unload).toBeEnabled();
  await unload.click();
  await expect.poll(async () => (await sent()).map(c => c.cmd)).toEqual(["mdi"]);
  const [mdi] = await sent();
  expect(mdi.text).toBe("T0 M600");
  expect(mdi.vars).toMatchObject({ "3100": 0, "3101": 0, "3102": -300, "3004": 200, "3005": 0 });
  // the standard tool change needs no setter
  await open(page, { machine: { toolChangeMode: "m6g43" } });
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(unload).toBeEnabled();
  await unload.click();
  await expect.poll(async () => (await sent()).map(c => ({ cmd: c.cmd, tool_number: c.tool_number })))
    .toEqual([{ cmd: "tool_change", tool_number: 0 }]);
});

// P2 (Codex R308–R309 FI308-04): the form says what the machine holds — from
// the gateway's booking (toolsetter_booking), never from a reply or its own
// memory. The booking rides the status envelope; the mock sets it per test.
function bookingOf(section: Record<string, number>, origin: string, over: Record<string, number> = {}) {
  const s = toolsetterSetup(section);
  if (!s.ok) throw new Error("not set up");
  const keys: Record<string, { value: number; origin: string }> = {};
  for (const [k, v] of Object.entries(toolsetterVarMap(s.values))) keys[k] = { value: over[k] ?? v, origin };
  return { version: 1, keys };
}

async function toolsetterTab(page: Page) {
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  await page.getByRole("tab", { name: "Toolsetter", exact: true }).click();
  // the line's text — the note around it also holds its "?"
  return page.locator(".tsPanel .tsMachine").getByRole("status");
}

test("the machine line follows the gateway's booking: not known, confirmed, pending, not confirmed", async ({ page }) => {
  await open(page, { toolsetter: SET_UP });
  const line = await toolsetterTab(page);
  await expect(line).toHaveText("LinuxCNC parameters not known yet");
  await ctl({ op: "status_delta", data: {}, envelope: { toolsetter_booking: bookingOf(SET_UP, "applied") } });
  await expect(line).toHaveText("LinuxCNC parameters hold these values — confirmed");
  await expect(page.locator(".tsPanel .tsMachine")).toHaveClass(/\bok\b/);
  await ctl({ op: "status_delta", data: {}, envelope: { toolsetter_booking: bookingOf(SET_UP, "read", { "3102": -299 }) } });
  await expect(line).toContainText("Saved — not yet in the LinuxCNC parameters");
  await ctl({ op: "status_delta", data: {}, envelope: { toolsetter_booking: bookingOf(SET_UP, "assumed") } });
  await expect(line, "equal numbers only assumed are no proof").toContainText("LinuxCNC parameters not confirmed (0 of 23)");
});

test("the line's \"?\" says which parameters it means (operator 2026-11-07)", async ({ page }) => {
  await open(page, { toolsetter: SET_UP });
  await toolsetterTab(page);
  await ctl({ op: "status_delta", data: {}, envelope: { toolsetter_booking: bookingOf(SET_UP, "applied") } });
  const help = page.locator(".tsPanel .tsMachine").getByRole("button", { name: "Help: LinuxCNC parameters" });
  await help.click();
  await expect(page.locator(".helpPopover:popover-open"))
    .toHaveText("#3004–#3013 and #3100–#3115 — the values the measurement (M600) reads.");
});

test("not set up: no machine line beyond the setup note, which says nothing is written", async ({ page }) => {
  await open(page, { toolsetter: { touchZ: -300 } });
  await toolsetterTab(page);
  await ctl({ op: "status_delta", data: {}, envelope: { toolsetter_booking: bookingOf(SET_UP, "read") } });
  await expect(page.locator(".tsPanel .tsMachine")).toHaveCount(0);
  await expect(page.locator(".tsPanel .statusNote.warn")).toContainText("nothing is written to the LinuxCNC parameters");
});

test("a save while the machine is not ready sends nothing; the line says it is not yet in the machine", async ({ page }) => {
  await open(page, { toolsetter: SET_UP });
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, ready: false } },
              envelope: { toolsetter_booking: bookingOf(SET_UP, "applied") } });
  const line = await toolsetterTab(page);
  await expect(line).toHaveText("LinuxCNC parameters hold these values — confirmed");
  const touchZ = page.getByRole("textbox", { name: "Touch Z", exact: true });
  await touchZ.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("-299");
  await page.keyboard.press("Enter");
  await expect(touchZ).toHaveValue("-299");
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "save_settings").at(-1)?.data)
    .toMatchObject({ touchZ: -299 });
  await expect(line).toContainText("Saved — not yet in the LinuxCNC parameters");
  expect((await sent()).map(c => c.cmd), "nothing pushed while not ready").not.toContain("set_probe_vars");
});

test("a save the read-back already confirms pushes nothing; one it does not gets the convenience push (Codex R309)", async ({ page }) => {
  await open(page, { toolsetter: SET_UP });
  await ctl({ op: "status_delta", data: {}, envelope: { toolsetter_booking: bookingOf({ ...SET_UP, touchZ: -299 }, "read") } });
  const line = await toolsetterTab(page);
  await expect(line).toContainText("Saved — not yet in the LinuxCNC parameters");
  const touchZ = page.getByRole("textbox", { name: "Touch Z", exact: true });
  for (const value of ["-299", "-298"]) {
    await touchZ.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(value);
    await page.keyboard.press("Enter");
    await expect(touchZ).toHaveValue(value);
    if (value === "-299") await expect(line, "the read-back holds the saved number").toHaveText("LinuxCNC parameters hold these values — confirmed");
  }
  // the second push is the signal that every earlier one has arrived (one worker, in order)
  const pushes = async () => (await sent()).filter(c => c.cmd === "set_probe_vars").map(c => (c.vars as Record<string, number>)["3102"]);
  await expect.poll(pushes).toContain(-298);
  expect(await pushes(), "nothing pushed for the save the read-back confirmed").toEqual([-298]);
});

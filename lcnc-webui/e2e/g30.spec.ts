import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// G30's stored tool-change position (operator point P4, Codex R21–R24):
// the fields are a DRAFT; "Use Current Position" fills it and writes nothing;
// Save is ONE set_g30 on the basis the draft started from, and the section
// shows only what LinuxCNC confirmed. A missing stored value is empty, never
// 0 (GET /g30 turned a missing row into 0.0). The old "Set Current Position"
// sent G30.1 and meant to show the position — the readout stayed old.
//
// Runs under `serial-guards`: mock-global state (status, replies, command log).

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, g30Capture: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};
const STORED = { X: 100, Y: 0, Z: -26.275 };
const SETTINGS = { toolsetter: { touchX: 0, touchY: 0, touchZ: -300, fastFeed: 200, slowFeed: 20, traverseFeed: 500,
  maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180 } };

async function open(page: Page, g30: Record<string, number | null>, replies: Record<string, unknown> = {},
                    hold?: Promise<void>) {
  await ctl({ op: "reset" });
  await page.route("**/g30*", async r => {
    if (hold) await hold;          // a late file read (Codex R25 OP-I03)
    await r.fulfill({ contentType: "application/json",
      body: JSON.stringify({ ok: true, values: g30, mtime_ms: Date.UTC(2026, 8, 28, 12, 5), units: "mm" }) });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL, kins_type: 0 } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: SETTINGS } });
  await ctl({ op: "replies", replies });
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  await page.getByRole("tab", { name: "Toolsetter", exact: true }).click();
  await ctl({ op: "clearCmds" });
}
const sent = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; [k: string]: unknown }[])
  .filter(c => !["hello", "arm", "client_diag", "tab_visibility", "get_tool_table", "heartbeat"].includes(c.cmd));
const field = (page: Page, l: string) => page.getByLabel(`G30 ${l}`, { exact: true });
const values = async (page: Page) => Promise.all(["X", "Y", "Z"].map(l => field(page, l).inputValue()));
const storedLine = (page: Page) => page.locator(".g30Stored");
/** Answer the request the page sent for `cmd` — a reply held back so the
 *  operator (or the status) can act while it is out. */
async function deliver(cmd: string, result: Record<string, unknown>) {
  await expect.poll(async () => (await sent()).some(c => c.cmd === cmd)).toBe(true);
  const c = (await sent()).find(x => x.cmd === cmd)!;
  await ctl({ op: "raw", frame: { type: "reply", cmd, req_id: c.req_id, ...result } });
}
/** An entry through the field's keypad, the operator's way. */
async function enter(page: Page, l: string, value: number) {
  await field(page, l).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
  await expect(field(page, l)).toHaveValue(String(value));
}

test("the stored G30 is a display: a missing value is empty, never 0, and Save waits for a known basis", async ({ page }) => {
  await open(page, { X: 100, Y: 0, Z: null });
  expect(await values(page)).toEqual(["100", "0", ""]);
  await expect(storedLine(page)).toHaveText(/^Stored: as of LinuxCNC's last synch \(\d\d:\d\d\)$/);
  const save = page.getByRole("button", { name: "Save G30", exact: true });
  await expect(save).toBeDisabled();
  await save.locator("xpath=..").click({ force: true });
  await expect(page.locator(".btnHint")).toHaveText("Stored G30 not known — refresh first");
  expect(await sent()).toEqual([]);
});

test("Use Current Position fills the draft and writes nothing; Save is one set_g30 on its basis, shown only as confirmed", async ({ page }) => {
  await open(page, STORED, {
    capture_g30: { ok: true, confirmed: true, values: STORED, current: { X: 10, Y: 20, Z: -5 }, units: "mm" },
    set_g30: { ok: true, confirmed: true, values: { X: 10, Y: 20, Z: -5 } },
  });
  await page.getByRole("button", { name: "Use Current Position", exact: true }).click();
  await expect.poll(() => values(page)).toEqual(["10", "20", "-5"]);
  await expect(storedLine(page)).toHaveText(/draft not saved$/);
  expect((await sent()).map(c => c.cmd), "a capture, no MDI, no write").toEqual(["capture_g30"]);
  await ctl({ op: "clearCmds" });
  await page.getByRole("button", { name: "Save G30", exact: true }).click();
  await expect(page.locator(".statusNote.ok")).toHaveText("G30 saved — confirmed by LinuxCNC");
  const cmds = await sent();
  expect(cmds.map(c => c.cmd)).toEqual(["set_g30"]);
  expect({ values: cmds[0]!.values, based_on: cmds[0]!.based_on }).toEqual({ values: { X: 10, Y: 20, Z: -5 }, based_on: STORED });
  await expect(storedLine(page)).toHaveText("Stored: confirmed by LinuxCNC");
});

test("a save LinuxCNC did not confirm is never 'saved'", async ({ page }) => {
  await open(page, STORED, {
    capture_g30: { ok: true, confirmed: true, values: STORED, current: { X: 10, Y: 20, Z: -5 }, units: "mm" },
    set_g30: { ok: false, confirmed: false, error: "G30 not confirmed — parameters not saved" },
  });
  await page.getByRole("button", { name: "Use Current Position", exact: true }).click();
  await expect.poll(() => values(page)).toEqual(["10", "20", "-5"]);
  await page.getByRole("button", { name: "Save G30", exact: true }).click();
  await expect(page.locator(".statusNote.error")).toHaveText("G30 not confirmed — parameters not saved");
  await expect(storedLine(page)).toHaveText("Stored: not confirmed — refresh · draft not saved");
});

test("machine frame only: under TCP, Use Current Position and Save are dimmed with the reason", async ({ page }) => {
  await open(page, STORED);
  await ctl({ op: "status_delta", data: { kins_type: 1, permissions: { ...PERMS_ALL, machineFrame: false, g30Capture: false },
    permission_reasons: { machineFrame: "Machine frame only", g30Capture: "Machine frame only" } } });
  for (const name of ["Use Current Position", "Save G30"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  }
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
});

test("a captured draft is dropped when the kinematics mode changes", async ({ page }) => {
  await open(page, STORED, { capture_g30: { ok: true, confirmed: true, values: STORED, current: { X: 10, Y: 20, Z: -5 }, units: "mm" } });
  await page.getByRole("button", { name: "Use Current Position", exact: true }).click();
  await expect.poll(() => values(page)).toEqual(["10", "20", "-5"]);
  await ctl({ op: "status_delta", data: { kins_type: 1 } });
  await expect.poll(() => values(page)).toEqual(["100", "0", "-26.275"]);
  await expect(page.locator(".statusNote.warn")).toHaveText("Draft dropped — units, kinematics or connection changed");
});

// Codex R25 OP-I03: a reply belongs to what its request was SENT under.
test("a save's confirmation never replaces an entry typed while it was out", async ({ page }) => {
  await open(page, STORED);
  await enter(page, "X", 110);
  await page.getByRole("button", { name: "Save G30", exact: true }).click();
  await expect.poll(async () => (await sent()).map(c => c.cmd)).toContain("set_g30");
  await enter(page, "X", 120);                      // typed while the save is out
  await deliver("set_g30", { ok: true, confirmed: true, values: { ...STORED, X: 110 } });
  await expect(page.locator(".tsPanel .statusNote.warn")).toHaveText("G30 saved — your newer entry is still a draft");
  await expect(field(page, "X")).toHaveValue("120");
  await expect(storedLine(page)).toHaveText("Stored: confirmed by LinuxCNC · draft not saved");
  // the next save is based on what LinuxCNC confirmed
  await ctl({ op: "clearCmds" });
  await page.getByRole("button", { name: "Save G30", exact: true }).click();
  await expect.poll(async () => (await sent()).find(c => c.cmd === "set_g30")?.based_on).toEqual({ ...STORED, X: 110 });
});

test("a capture answered after the frame changed takes nothing over", async ({ page }) => {
  await open(page, STORED);
  await page.getByRole("button", { name: "Use Current Position", exact: true }).click();
  await expect.poll(async () => (await sent()).map(c => c.cmd)).toContain("capture_g30");
  await ctl({ op: "status_delta", data: { kins_type: 1 } });
  await page.waitForTimeout(300);                   // the status has landed
  await deliver("capture_g30", { ok: true, confirmed: true, values: STORED, current: { X: 10, Y: 20, Z: -5 }, units: "mm" });
  await expect(page.locator(".tsPanel .statusNote.warn")).toHaveText("Capture dropped — units or kinematics changed");
  expect(await values(page)).toEqual(["100", "0", "-26.275"]);
});

test("a capture answered after the draft was edited takes nothing over; a refresh keeps a newer entry", async ({ page }) => {
  await open(page, STORED);
  await page.getByRole("button", { name: "Use Current Position", exact: true }).click();
  await expect.poll(async () => (await sent()).map(c => c.cmd)).toContain("capture_g30");
  await enter(page, "Y", 5);
  await deliver("capture_g30", { ok: true, confirmed: true, values: STORED, current: { X: 10, Y: 20, Z: -5 }, units: "mm" });
  await expect(page.locator(".tsPanel .statusNote.warn")).toHaveText("Capture dropped — the draft was edited meanwhile");
  expect(await values(page)).toEqual(["100", "5", "-26.275"]);
  await ctl({ op: "clearCmds" });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(async () => (await sent()).map(c => c.cmd)).toContain("read_g30");
  await enter(page, "Y", 6);
  await deliver("read_g30", { ok: true, confirmed: true, values: { ...STORED, X: 105 } });
  await expect(page.locator(".tsPanel .statusNote.warn")).toHaveText("Stored G30 refreshed — your newer entry stays a draft");
  expect(await values(page)).toEqual(["100", "6", "-26.275"]);
  await expect(storedLine(page)).toHaveText("Stored: confirmed by LinuxCNC · draft not saved");
});

test("a late file read never overwrites a newer confirmed read", async ({ page }) => {
  let release!: () => void;
  const hold = new Promise<void>(r => { release = r; });
  await open(page, STORED, { read_g30: { ok: true, confirmed: true, values: { ...STORED, X: 105 } } }, hold);
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(storedLine(page)).toHaveText("Stored: confirmed by LinuxCNC");
  await expect(field(page, "X")).toHaveValue("105");
  release();                                        // the file read of X = 100 lands late
  await page.waitForTimeout(300);
  await expect(field(page, "X")).toHaveValue("105");
  await expect(storedLine(page)).toHaveText("Stored: confirmed by LinuxCNC");
});

// Codex R25 OP-I02: Capture takes the CURRENT position — the machine must stand.
test("Use Current Position is dimmed while the machine moves, with the gateway's reason", async ({ page }) => {
  await open(page, STORED);
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, g30Capture: false },
    permission_reasons: { g30Capture: "Machine moving — capture once it stands" } } });
  const capture = page.getByRole("button", { name: "Use Current Position", exact: true });
  await expect(capture).toBeDisabled();
  await capture.locator("xpath=..").click({ force: true });
  await expect(page.locator(".btnHint")).toHaveText("Machine moving — capture once it stands");
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();
  expect(await sent()).toEqual([]);
});

// Codex R26 OP-I03: the stored values and the basis a save is sent on
// belong to their connection — a reconnect may be another LinuxCNC
// instance. A reconnect reads G30 again; an answer from before it,
// delivered late, supplies neither the stored line nor the basis.
test("a file read answered after a reconnect supplies no basis; the reconnect reads G30 again", async ({ page }) => {
  let releaseOld!: () => void, releaseNew!: () => void;
  const oldRead = new Promise<void>(r => { releaseOld = r; });
  const newRead = new Promise<void>(r => { releaseNew = r; });
  try {
    await open(page, STORED, {}, oldRead);               // the first read (X = 100) stays out
    await page.route("**/g30*", async r => {             // the reconnect's read (X = 105), held too
      await newRead;
      await r.fulfill({ contentType: "application/json",
        body: JSON.stringify({ ok: true, values: { ...STORED, X: 105 }, mtime_ms: Date.UTC(2026, 8, 28, 12, 6), units: "mm" }) });
    });
    await ctl({ op: "refuseWs", on: true });
    await ctl({ op: "shutdownClose" });
    await expect(page.getByText("Server shutting down")).toBeVisible();
    await ctl({ op: "refuseWs", on: false });
    await expect(page.locator(".pill.armed")).toBeVisible({ timeout: 12_000 });
    await ctl({ op: "status_delta", data: { permissions: PERMS_ALL, kins_type: 0 } });
    await enter(page, "X", 120);
    await enter(page, "Y", 0);
    await enter(page, "Z", -30);
    // Codex R26's window: the OLD connection's answer lands first
    releaseOld();
    await page.waitForTimeout(400);
    await expect(storedLine(page), "no basis from before the reconnect").toHaveText(/^Stored: unknown — refresh/);
    await expect(page.getByRole("button", { name: "Save G30", exact: true })).toBeDisabled();
    // the reconnect's own read supplies it; the entry stays a draft
    releaseNew();
    await expect(storedLine(page)).toHaveText(/^Stored: as of LinuxCNC's last synch .* · draft not saved$/);
    expect(await values(page)).toEqual(["120", "0", "-30"]);
    await ctl({ op: "clearCmds" });
    await page.getByRole("button", { name: "Save G30", exact: true }).click();
    await expect.poll(async () => (await sent()).find(c => c.cmd === "set_g30")?.based_on,
      "the basis is the reconnect's read").toEqual({ ...STORED, X: 105 });
  } finally {
    releaseOld(); releaseNew();
    await ctl({ op: "refuseWs", on: false });
  }
});


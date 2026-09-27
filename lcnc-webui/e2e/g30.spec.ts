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
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};
const STORED = { X: 100, Y: 0, Z: -26.275 };
const SETTINGS = { toolsetter: { touchX: 0, touchY: 0, touchZ: -300, fastFeed: 200, slowFeed: 20, traverseFeed: 500,
  maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180 } };

async function open(page: Page, g30: Record<string, number | null>, replies: Record<string, unknown> = {}) {
  await ctl({ op: "reset" });
  await page.route("**/g30*", r => r.fulfill({ contentType: "application/json",
    body: JSON.stringify({ ok: true, values: g30, mtime_ms: Date.UTC(2026, 8, 28, 12, 5), units: "mm" }) }));
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
  await ctl({ op: "status_delta", data: { kins_type: 1, permissions: { ...PERMS_ALL, machineFrame: false },
    permission_reasons: { machineFrame: "Machine frame only — switch to Machine" } } });
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
  await expect(page.locator(".statusNote.warn")).toHaveText("Draft dropped — units or kinematics changed");
});

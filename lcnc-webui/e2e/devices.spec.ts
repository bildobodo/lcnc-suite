// Settings › Devices (settings split, operator 2026-11-07, plan Codex
// R335–R337): this device's simulation switch and name need no arm; another
// device's change does; a connected device is never deleted; a tab bound to
// no device says why and saves no device setting; the macro bar is the
// device's own (OP3) — a disarmed tab puts a macro on it.
import { test, expect, type Page } from "./test";
import { ctl, MOCK } from "./ctl";

const OTHER_ONLINE = { id: "dev-panel", name: "Panel", created: null, last_seen: "2026-11-07T20:00:00",
  last_address: "10.0.0.5", changed: true, simulation: false, simulation_rev: 2, online: true, tabs: 1, this: false };
const OTHER_OFFLINE = { id: "dev-laptop", name: "", created: null, last_seen: "2026-11-01T08:30:00",
  last_address: "10.0.0.9", changed: false, simulation: true, simulation_rev: 4, online: false, tabs: 0, this: false };

async function ready(page: Page, settings: Record<string, unknown> = {}, device?: { id: string | null; name: string }) {
  await ctl({ op: "reset" });
  await ctl({ op: "devices", devices: [OTHER_ONLINE, OTHER_OFFLINE] });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "raw", frame: { type: "settings_init", settings, ...(device ? { device } : {}) } });
  await ctl({ op: "clearCmds" });
}

async function disarm() {
  await ctl({ op: "status_delta", armed: false, data: {} });
}

async function openDevices(page: Page) {
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole("tab", { name: "Devices", exact: true }).click();
  return settings;
}

async function sent(): Promise<Record<string, any>[]> {
  const r = await ctl({ op: "lastCmds" }) as { cmds?: Record<string, any>[] };
  return r.cmds ?? [];
}

test.afterEach(async () => { await ctl({ op: "reset" }); });

test("this device switches its own simulation without arm; it acts once the gateway holds it", async ({ page }) => {
  await ready(page, { simulation: { enabled: false } });
  await disarm();
  const settings = await openDevices(page);
  const sim = settings.locator("[data-devices=this]").getByRole("checkbox");
  await expect(sim).not.toBeChecked();
  await expect(sim).toBeEnabled();
  await sim.check({ force: true });
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "save_settings"))
    .toEqual([expect.objectContaining({ section: "simulation", data: { enabled: true }, base_rev: 0 })]);
  await expect(sim).toBeChecked();   // the mock echoes: the gateway holds it
});

test("another device: its simulation and its rename need arm; a connected one is never deleted", async ({ page }) => {
  await ready(page);
  await disarm();
  const settings = await openDevices(page);
  const online = settings.locator('[data-device-row="dev-panel"]');
  const offline = settings.locator('[data-device-row="dev-laptop"]');
  await expect(online).toContainText("Online · 1 tab");
  await expect(offline).toContainText("Offline · last seen 2026-11-01 08:30");
  await expect(offline).toContainText("never changed");
  // disarmed: another device's switch and actions are closed, with the reason
  await expect(offline.getByRole("checkbox")).toBeDisabled();
  await expect(offline.getByRole("button", { name: /^Rename / })).toBeDisabled();
  // armed: the switch goes into THAT device's profile on the revision the list showed
  await ctl({ op: "status_delta", armed: true, data: {} });
  await expect(offline.getByRole("checkbox")).toBeEnabled();
  // the switch shows the list's state: a click sends, the next list shows the result
  await offline.getByRole("checkbox").click({ force: true });
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "save_settings"))
    .toEqual([expect.objectContaining({ section: "simulation", data: { enabled: false }, base_rev: 4, device: "dev-laptop" })]);
  // the connected device's delete stays closed and says why
  const del = online.getByRole("button", { name: "Delete Panel" });
  await expect(del).toBeDisabled();
  // the offline one: the ask, then the command naming it
  await offline.getByRole("button", { name: /^Delete / }).click();
  const ask = page.getByRole("dialog", { name: /^Delete / });
  await ask.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "device_delete"))
    .toEqual([expect.objectContaining({ device: "dev-laptop" })]);
});

test("a tab bound to no device says why and saves no device setting", async ({ page }) => {
  await ready(page, {}, { id: null, name: "" });
  const settings = await openDevices(page);
  await expect(settings.locator("[data-device-unbound]")).toBeVisible();
  await expect(settings.locator("[data-devices=this]").getByRole("checkbox")).toHaveCount(0);
  await settings.getByRole("tab", { name: "Display", exact: true }).click();
  await settings.getByText("Dark", { exact: true }).click();
  // the header says the save is blocked, and why — the signal that nothing went out
  await expect(settings.locator(".saveStatus.blocked")).toContainText("device not bound yet");
  expect((await sent()).filter(c => c.cmd === "save_settings")).toEqual([]);
});

test("this device's name is saved without arm", async ({ page }) => {
  await ready(page);
  await disarm();
  const settings = await openDevices(page);
  const field = settings.locator("[data-devices=this]").getByLabel("Name");
  await field.fill("Machine panel");
  await field.press("Tab");
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "device_rename"))
    .toEqual([expect.objectContaining({ name: "Machine panel" })]);
  await expect(settings.locator("[data-devices=this] .statusNote")).toHaveText("Name saved");
});

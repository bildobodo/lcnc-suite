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

// Codex R338 SS-I01: a save into ANOTHER device's profile answers with THAT
// profile's state — ok or stale — and this device's own stays as it was.
test("switching another device's simulation leaves this one's own off — ok and stale alike", async ({ page }) => {
  await ready(page, { simulation: { enabled: false } });
  const settings = await openDevices(page);
  const offline = settings.locator('[data-device-row="dev-laptop"]');
  // stale for the other device, carrying ITS state: simulation on
  await ctl({ op: "replyFor", cmd: "save_settings",
              reply: { ok: false, stale: true, error: "simulation changed elsewhere — reloaded",
                       section: "simulation", device: "dev-laptop", data: { enabled: true }, rev: 9 } });
  await offline.getByRole("checkbox").click({ force: true });
  await expect(settings.locator("[data-devices=this] .statusNote")).toContainText("changed elsewhere");
  await ctl({ op: "replyFor", cmd: "save_settings", reply: null });
  await expect(settings.locator("[data-devices=this]").getByRole("checkbox"), "this device: still off").not.toBeChecked();
  await expect(page.getByRole("tab", { name: "Sim", exact: true })).toHaveCount(0);
  // and its own save still goes on its own revision
  await ctl({ op: "clearCmds" });
  await settings.locator("[data-devices=this]").getByRole("checkbox").check({ force: true });
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "save_settings"))
    .toEqual([expect.objectContaining({ section: "simulation", data: { enabled: true }, base_rev: 0 })]);
});

// Codex R339 SS-I06: a profile the gateway MADE for a browser that already
// held a token — a removed profile, or its first visit in this machine
// configuration — is said neutrally, BESIDE the device's own controls.
test("a new profile for a stored token: a neutral note, the name and the switch stay", async ({ page }) => {
  await ready(page);
  await page.reload();   // the token is stored now: not this page load's own
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { simulation: { enabled: false } },
                                  device: { id: "dev-new", name: "", created: true } } });
  const settings = await openDevices(page);
  const mine = settings.locator("[data-devices=this]");
  await expect(mine.locator("[data-device-new]")).toHaveText(
    "A new device profile was made for this browser in this machine configuration — its simulation is off");
  await expect(mine.getByLabel("Name")).toBeVisible();
  await expect(mine.getByRole("checkbox")).toBeEnabled();
});

test("a first start is no news: no note for this page load's own token", async ({ page }) => {
  await ready(page, { simulation: { enabled: false } }, { id: "dev-first", name: "", created: true } as never);
  const settings = await openDevices(page);
  await expect(settings.locator("[data-device-new]")).toHaveCount(0);
});

// SS-I02 rest: the device list takes an answer only for its LATEST read of
// the CURRENT binding — an older read landing late shows nothing.
test("a late device list from before a new binding never shows this device among the others", async ({ page }) => {
  let first = true;
  let release!: () => void, answered!: () => void;
  const held = new Promise<void>(res => { release = res; });
  const lateAnswered = new Promise<void>(res => { answered = res; });
  await page.route(/\/devices$/, async r => {
    if (first) {   // the read under the OLD binding: held, then answered with the old view
      first = false;
      await held;
      await r.fulfill({ json: { ok: true, devices: [{ ...OTHER_ONLINE, id: "dev-b", name: "Me now", this: false }] } });
      answered();
      return;
    }
    await r.fulfill({ json: { ok: true, devices: [{ ...OTHER_ONLINE, id: "dev-b", name: "Me now", this: true },
                                                 OTHER_OFFLINE] } });
  });
  await ready(page);
  const settings = await openDevices(page);
  // a new binding while the first read is out
  await ctl({ op: "raw", frame: { type: "settings_init", settings: {}, device: { id: "dev-b", name: "Me now" } } });
  await expect(settings.locator('[data-device-row="dev-laptop"]')).toBeVisible();
  release();          // now the old read answers, late
  await lateAnswered;
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(settings.locator('[data-device-row="dev-b"]'), "this device is never one of the others").toHaveCount(0);
  await expect(settings.locator('[data-device-row="dev-laptop"]')).toBeVisible();
});

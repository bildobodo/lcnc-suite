import { test, expect, type Page } from "./test";
import { ctl, MOCK } from "./ctl";
import { Folder, serve } from "./macroFolder";

// The switchable suite functions (settings split package 3, plan R335–R337,
// operator OP2): a function switched off LEAVES the UI — its tab, its
// buttons, its settings, its reading of the gamepad — not dimmed. The tab in
// use when its function goes off stays until it is left, with a note (a
// draft is never lost unasked, SS334-02). The switches are a machine section
// the server holds; the page has them from its first render.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
const ALL_ON = { probing: true, toolsetter: true, surfaceMap: true, camera: true, macros: true, gamepad: true };
const off = (...names: (keyof typeof ALL_ON)[]) => ({ ...ALL_ON, ...Object.fromEntries(names.map(n => [n, false])) });
const MACROS = { macroBar: { bar: ["park"] } };

const sent = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; [k: string]: unknown }[])
  .filter(c => !["hello", "client_diag", "tab_visibility", "get_tool_table"].includes(c.cmd));

/** The page with these server settings from its FIRST read (the bootstrap
 *  fetch answers with them), the status ready. */
async function open(page: Page, settings: Record<string, unknown>, status: Record<string, unknown> = {}) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await ctl({ op: "raw", frame: { type: "settings_init", settings } });   // the mock's store, before the load
  await serve(page, new Folder());
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL, tool_number: 5, eoffset_enabled: false, ...status } });
  await ctl({ op: "clearCmds" });
}

const side = (page: Page) => page.locator(".sidePane");
const mainTabs = (page: Page) => side(page).getByRole("tablist", { name: "Side panel" }).getByRole("tab");
const switchTo = (features: Record<string, boolean>, more: Record<string, unknown> = {}) =>
  ctl({ op: "raw", frame: { type: "settings_changed", settings: { features, ...more } } });

test("a first start with functions off never shows them: no Probing, no Macros, no macro bar, no Measure", async ({ page }) => {
  // from the first render: a tab painted and taken away again is a jump
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as unknown as { __tabsSeen: Set<string> }).__tabsSeen = seen;
    new MutationObserver(() => {
      for (const t of document.querySelectorAll('.sidePane [role="tab"]')) seen.add(t.textContent?.trim() ?? "");
      if (document.querySelector(".macroBar")) seen.add("macroBar");
    }).observe(document, { subtree: true, childList: true });
  });
  await open(page, { features: off("probing", "surfaceMap", "toolsetter", "macros"), ...MACROS });
  await expect(mainTabs(page)).toHaveText(["Program", "MDI", "Offsets", "Tools", "Sim"]);
  const seen = await page.evaluate(() => [...(window as unknown as { __tabsSeen: Set<string> }).__tabsSeen]);
  expect(seen, "never painted").not.toContain("Probing");
  expect(seen).not.toContain("Macros");
  expect(seen).not.toContain("macroBar");
  await side(page).getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(side(page).getByRole("button", { name: "Unload", exact: true }), "the normal tool handling stays").toBeVisible();
  await expect(side(page).getByRole("button", { name: "Measure Current", exact: true })).toHaveCount(0);
});

test("switched at run time: the tab and the bar go and come back", async ({ page }) => {
  await open(page, { features: ALL_ON, ...MACROS });
  await expect(page.locator(".macroBar")).toBeVisible();
  await expect(mainTabs(page)).toHaveText(["Program", "MDI", "Probing", "Offsets", "Tools", "Macros", "Sim"]);
  await switchTo(off("macros"), MACROS);
  await expect(mainTabs(page)).toHaveText(["Program", "MDI", "Probing", "Offsets", "Tools", "Sim"]);
  await expect(page.locator(".macroBar")).toHaveCount(0);
  await switchTo(ALL_ON, MACROS);
  await expect(mainTabs(page)).toHaveText(["Program", "MDI", "Probing", "Offsets", "Tools", "Macros", "Sim"]);
  await expect(page.locator(".macroBar")).toBeVisible();
});

test("the tab in use stays with a note until it is left", async ({ page }) => {
  await open(page, { features: ALL_ON });
  await side(page).getByRole("tab", { name: "Macros", exact: true }).click();
  await switchTo(off("macros"));
  const note = side(page).locator(".macrosTab .statusNote.warn");
  await expect(note).toHaveText("Macros are off — this closes once you leave it");
  await expect(side(page).getByRole("tab", { name: "Macros", exact: true })).toHaveAttribute("aria-selected", "true");
  await side(page).getByRole("tab", { name: "Program", exact: true }).click();
  await expect(side(page).getByRole("tab", { name: "Macros", exact: true })).toHaveCount(0);
});

test("Probing shows the procedures of the functions on: each of the three is its own", async ({ page }) => {
  await open(page, { features: off("probing") });
  await side(page).getByRole("tab", { name: "Probing", exact: true }).click();
  const procs = side(page).getByRole("tablist", { name: "Probing procedure" }).getByRole("tab");
  await expect(procs).toHaveText(["Surface", "Toolsetter"]);
  await switchTo(off("probing", "toolsetter"));
  // in use: Surface was chosen as the first one left — it stays
  await expect(procs).toHaveText(["Surface"]);
  await side(page).getByRole("tab", { name: "Program", exact: true }).click();
  await switchTo(off("probing", "toolsetter", "surfaceMap"));
  await expect(side(page).getByRole("tab", { name: "Probing", exact: true }), "none of the three: no tab").toHaveCount(0);
});

test("surface map off with the compensation still on: its state and its OFF stay, nothing of the scan", async ({ page }) => {
  await open(page, { features: off("surfaceMap") }, { eoffset_enabled: true, comp_method: 1 });
  await side(page).getByRole("tab", { name: "Probing", exact: true }).click();
  await side(page).getByRole("tab", { name: "Surface", exact: true }).click();
  await expect(side(page).locator(".statusNote.warn").first())
    .toHaveText("Surface map is off — the compensation is still on: turn it off here");
  await expect(side(page).getByRole("button", { name: "Start Scan", exact: true })).toHaveCount(0);
  await expect(side(page).getByRole("radiogroup", { name: "Compensation method" })).toHaveCount(0);
  const toggle = side(page).getByRole("checkbox", { name: "Enable Compensation" });
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
  // off (the status shows it), then left: the view and — nothing else on — the tab go
  await ctl({ op: "status_delta", data: { eoffset_enabled: false } });
  await side(page).getByRole("tab", { name: "Outside", exact: true }).click();
  await expect(side(page).getByRole("tab", { name: "Surface", exact: true })).toHaveCount(0);
});

test("toolsetter off: its procedure, Measure Current and the M600 tool change are gone — Unload stays", async ({ page }) => {
  await open(page, { features: off("toolsetter") });
  await side(page).getByRole("tab", { name: "Probing", exact: true }).click();
  await expect(side(page).getByRole("tab", { name: "Toolsetter", exact: true })).toHaveCount(0);
  await side(page).getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(side(page).getByRole("button", { name: "Measure Current", exact: true })).toHaveCount(0);
  await expect(side(page).getByRole("button", { name: "Unload", exact: true })).toBeVisible();
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Machine", exact: true }).click();
  await expect(settings.getByText("M6 G43", { exact: true })).toBeVisible();
  await expect(settings.getByText("M600", { exact: true })).toHaveCount(0);
});

test("camera off: no quick toggle, no picture, no overlay settings", async ({ page }) => {
  await open(page, { features: ALL_ON });
  await expect(page.getByRole("button", { name: "Show camera", exact: true })).toBeVisible();
  await switchTo(off("camera"));
  await expect(page.getByRole("button", { name: /camera/i })).toHaveCount(0);
  await expect(page.locator(".cameraPip, .pip")).toHaveCount(0);
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.locator('[data-viewer-section="camera"]')).toHaveCount(0);
});

test("Settings › Features: a switch saves the machine's section; Gamepad leaves the settings with its switch", async ({ page }) => {
  await open(page, { features: ALL_ON });
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Features", exact: true }).click();
  await settings.getByRole("checkbox", { name: "Macros" }).click();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "save_settings" && c.section === "features").at(-1)?.data)
    .toEqual(off("macros"));
  await expect(settings.getByRole("tab", { name: "Gamepad", exact: true })).toBeVisible();
  await switchTo(off("gamepad"));
  await expect(settings.getByRole("tab", { name: "Gamepad", exact: true })).toHaveCount(0);
});

test("gamepad: its commands say so; off, the pad is not read; on again, a held button acts only after a release", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)", index: 0, connected: true,
      mapping: "standard", timestamp: 0, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad, null, null, null] });
  });
  const press = (on: boolean) => page.evaluate((v) => {
    const b = (window as unknown as { __pad: { buttons: { pressed: boolean; value: number }[] } }).__pad.buttons[1]!;
    b.pressed = v; b.value = v ? 1 : 0;   // B: Abort by default
  }, on);
  const frames = () => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));
  const aborts = async () => (await sent()).filter(c => c.cmd === "abort");
  await open(page, { features: ALL_ON, gamepad: { buttonsEnabled: true } });
  await press(true);
  await expect.poll(aborts).toEqual([expect.objectContaining({ cmd: "abort", via: "gamepad" })]);
  await press(false);
  await frames();
  await switchTo(off("gamepad"), { gamepad: { buttonsEnabled: true } });
  await ctl({ op: "clearCmds" });
  await press(true);
  await frames(); await frames();
  expect(await aborts(), "off: the pad is not read").toEqual([]);
  // on again with B still held: no press until it was let go
  await switchTo(ALL_ON, { gamepad: { buttonsEnabled: true } });
  await frames(); await frames();
  expect(await aborts(), "a held button is no press").toEqual([]);
  await press(false);
  await frames();
  await press(true);
  await expect.poll(aborts).toEqual([expect.objectContaining({ cmd: "abort", via: "gamepad" })]);
});

// ── Codex R343 ──────────────────────────────────────────────────────────

const focusNow = (page: Page) => page.evaluate(() => {
  const a = document.activeElement;
  return { tag: a?.tagName, role: a?.getAttribute("role"), name: a?.getAttribute("aria-label") ?? a?.textContent?.trim().slice(0, 40) };
});

test("a focused control its switch removes hands the focus on — an arrow then moves no axis (SS-I09)", async ({ page }) => {
  const SETUP = { touchX: 150, touchY: 10, touchZ: -300, fastFeed: 2000, slowFeed: 20, traverseFeed: 500,
    maxZTravel: 180, retractDist: 3, spindleZeroHeight: 180 };
  const KB = { keyboard: { jogEnabled: true } };
  await open(page, { features: ALL_ON, toolsetter: SETUP, ...KB, ...MACROS });
  // Measure Current (the Tools head) → the side pane's navigation
  await side(page).getByRole("tab", { name: "Tools", exact: true }).click();
  const measure = side(page).getByRole("button", { name: "Measure Current", exact: true });
  await expect(measure).toBeEnabled();
  await measure.focus();
  await switchTo(off("toolsetter"), { toolsetter: SETUP, ...KB, ...MACROS });
  await expect(measure).toHaveCount(0);
  await expect(side(page).getByRole("tab", { name: "Tools", exact: true })).toBeFocused();
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  expect((await sent()).filter(c => c.cmd.startsWith("jog_")), "navigation, never a jog").toEqual([]);
  // the camera's quick toggle → a remaining viewer control
  const cam = page.getByRole("button", { name: "Show camera", exact: true });
  await cam.focus();
  await switchTo(off("toolsetter", "camera"), { ...KB, ...MACROS });
  await expect(cam).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset view", exact: true })).toBeFocused();
  // a macro bar button → the side pane's navigation
  const bar = page.locator(".macroBar").getByRole("button").first();
  await bar.focus();
  await switchTo(off("toolsetter", "camera", "macros"), { ...KB });
  await expect(page.locator(".macroBar")).toHaveCount(0);
  expect((await focusNow(page)).tag, "not on BODY").not.toBe("BODY");
  expect((await focusNow(page)).role).toBe("tab");
  // a focus set elsewhere meanwhile stays: nothing pulls it back
  await switchTo(ALL_ON, { ...KB, ...MACROS });
  await page.locator("input.setupInput").first().focus();
  await switchTo(off("camera"), { ...KB, ...MACROS });
  await expect(page.locator("input.setupInput").first()).toBeFocused();
});

test("a focused camera setting its switch removes hands the focus to the settings sections (SS-I09)", async ({ page }) => {
  await open(page, { features: ALL_ON });
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const crosshair = settings.getByRole("checkbox", { name: "Crosshair" });
  await crosshair.focus();
  await switchTo(off("camera"));
  await expect(crosshair).toHaveCount(0);
  await expect(settings.getByRole("tab", { name: "3D Viewer", exact: true })).toBeFocused();
});

test("Reset Calibration sends its routine as a probe job without values (SS-I08)", async ({ page }) => {
  await open(page, { features: ALL_ON });
  await side(page).getByRole("tab", { name: "Probing", exact: true }).click();
  await side(page).getByRole("tab", { name: "Calibrate", exact: true }).click();
  await side(page).getByRole("button", { name: "Reset Calibration", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset", exact: true }).click();
  // the same payload test_feature_switches replays through the dispatcher
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "probe_run"))
    .toEqual([expect.objectContaining({ cmd: "probe_run", routine: "probe_cal_reset", vars: {} })]);
});

for (const c of [
  { name: "both on", features: ALL_ON, purposes: ["probe", "surface"] },
  { name: "probing off", features: off("probing"), purposes: ["surface"] },
  { name: "surface map off", features: off("surfaceMap"), purposes: ["probe"] },
]) {
  test(`a probing parameter goes out to every purpose switched on — ${c.name} (SS-I10)`, async ({ page }) => {
    await open(page, { features: c.features });
    await side(page).getByRole("tab", { name: "Probing", exact: true }).click();
    // a number both purposes read: the probe tool (#3014) — on the Surface
    // view while it is there, else on a probing procedure
    await side(page).getByRole("tab", { name: c.features.surfaceMap ? "Surface" : "Outside", exact: true }).click();
    const field = side(page).getByLabel(c.features.surfaceMap ? "X Probes" : "Probe Tool #", { exact: true });
    await field.click();
    const pad = page.locator(".nkStrip");
    await pad.getByRole("button", { name: "9", exact: true }).click();
    await pad.getByRole("button", { name: "Apply", exact: true }).click();
    const params = async () => (await sent()).filter(x => x.cmd === "set_params");
    await expect.poll(async () => (await params()).map(x => x.purpose).sort()).toEqual(c.purposes);
    const surface = (await params()).find(x => x.purpose === "surface");
    if (surface) expect((surface.vars as Record<string, number>)["3054"], "X Probes as entered").toBe(9);
  });
}


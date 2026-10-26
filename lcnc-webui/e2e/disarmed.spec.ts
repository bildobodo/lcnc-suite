// Button gates package C (BG-01, BG-02, BG-05, BG-16; Codex R202–R204): a
// DISARMED client — the observer — navigates, reads and preselects freely;
// every control that would act is closed by its OWN gate and says why; the
// stops stay reachable. Before package C an outer `armed` fieldset disabled
// the whole content, the strip, the macro bar and every dialog — tabs, the
// file browser, a dialog's X and the stops inside the content included.
//
// The visible layer, in the browser against the mock: each visible catalog
// control (data-control = its catalog entry) whose gate needs arm must be
// disabled AND carry its reason; a free one may act. The static inventory
// (src/controlInventory.ts) names what each free control does.
import { test, expect, type Page, type Locator } from "@playwright/test";
import { ctl, MOCK } from "./ctl";
import { clickMore } from "./more";
import { BUTTON_TYPES, INPUT_DEFS } from "../src/machineControls";
import { GATE_NAMES, type Permissions } from "../src/permissions";

/** Gates open to a disarmed client (controlScan.ts LIVE_GATES). */
const LIVE = new Set(["always", "abort", "pause", "spindleStop"]);
const FREE_SECTIONS = new Set(["display", "viewer", "panels", "camera"]);
/** What a disarmed client may send: reads, liveness, free settings, stops. */
const ALLOWED = new Set(["hello", "heartbeat", "get_tool_table", "halshow_live", "tab_visibility",
  "get_settings", "get_probe_results", "get_comp_grid", "client_diag"]);

function gateOf(entry: string): string | undefined {
  return (BUTTON_TYPES as Record<string, { gate: string }>)[entry]?.gate
    ?? (INPUT_DEFS as Record<string, { gate: string }>)[entry]?.gate;
}

type Sent = { cmd?: string; section?: string };
async function sentNow(): Promise<Sent[]> {
  const r = await ctl({ op: "lastCmds" }) as { cmds?: Sent[] };
  return r.cmds ?? [];
}
/** Commands a disarmed client must never send (stops checked by their own tests). */
async function forbidden(): Promise<string[]> {
  return (await sentNow())
    .filter((c) => !ALLOWED.has(c.cmd ?? "") && !(c.cmd === "save_settings" && FREE_SECTIONS.has(c.section ?? "")))
    .map((c) => (c.cmd === "save_settings" ? `save_settings:${c.section}` : c.cmd ?? "?"));
}

/** The machine's permissions for a state (the backend's dict, computed armed). */
function perms(state: "idle" | "running" | "unhomed" | "estop"): Permissions {
  const p = Object.fromEntries(GATE_NAMES.map((k) => [k, true])) as Permissions;
  p.pause = state === "running";
  p.resume = false;
  p.toolChangeConfirm = false;
  if (state === "running" || state === "estop") {
    for (const k of ["idle", "ready", "run", "jog", "probe", "zero", "touchoff", "touchoffRotary", "machineFrame",
      "goZero", "planeFrame", "twpCapture", "surfaceComp", "step", "setup", "sourceWrite", "toolTableWrite", "g30Capture"] as const) p[k] = false;
  }
  if (state === "running") p.spindleStop = false;
  if (state === "estop") { p.safety = false; p.override = false; p.spindleStop = false; }
  if (state === "unhomed") {
    for (const k of ["ready", "run", "jog", "probe", "touchoff", "touchoffRotary", "machineFrame", "goZero",
      "planeFrame", "twpCapture", "surfaceComp", "g30Capture"] as const) p[k] = false;
  }
  return p;
}

async function disarmedIn(page: Page, state: "idle" | "running" | "unhomed" | "estop", extra: Record<string, unknown> = {}) {
  const homed = state !== "unhomed" && state !== "estop";
  await ctl({ op: "status_delta", armed: false, data: {
    permissions: perms(state), homed, homed_joints: [homed, homed, homed],
    estop: state === "estop", is_estop: state === "estop", enabled: state !== "estop", is_enabled: state !== "estop",
    task_mode: state === "running" ? 2 : 1, interp_state: state === "running" ? 2 : 1, paused: false,
    active_file: "/A.ngc", ...extra,
  } });
  await expect(page.locator(".pill.disarmed")).toHaveCount(1);
  await expect(page.locator(".safetyStrip .statusRow").filter({ hasText: "Interp" }).locator(".stable-width > span:not(.alt)"))
    .toHaveText(state === "running" ? "RUNNING" : "IDLE");
}

async function open(page: Page) {
  await ctl({ op: "reset" });
  await page.route("**/gcode?*", (route) => route.fulfill({ contentType: "text/plain", body: "(program A)\nG0 X0\nM2\n" }));
  await page.goto(MOCK);
  await expect(page.locator(".safetyStrip")).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: {} } });
}

/** Every visible catalog control in `scope`: a gated one is closed and
 *  explains itself; returns the violations. */
async function audit(scope: Locator, where: string): Promise<string[]> {
  const found = await scope.locator("[data-control]:visible").evaluateAll((els) => els.map((el) => {
    const e = el as HTMLButtonElement;
    const wrap = e.closest(".btnTip, .toggleRow") as HTMLElement | null;
    const reason = e.getAttribute("title") || wrap?.getAttribute("title") || "";
    // a ChoiceGroup option stays focusable: aria-disabled, never `disabled`
    return { entry: e.dataset.control ?? "", disabled: e.disabled || e.getAttribute("aria-disabled") === "true", reason,
             name: (e.getAttribute("aria-label") || e.textContent || e.getAttribute("name") || "").trim().slice(0, 40) };
  }));
  const bad: string[] = [];
  for (const c of found) {
    const g = gateOf(c.entry);
    if (!g) { bad.push(`${where}: ${c.entry} (${c.name}) — not in the catalog`); continue; }
    if (LIVE.has(g)) continue;
    if (!c.disabled) bad.push(`${where}: ${c.entry} [${g}] (${c.name}) — enabled while disarmed`);
    else if (!c.reason) bad.push(`${where}: ${c.entry} [${g}] (${c.name}) — closed without its reason`);
  }
  return bad;
}

const strip = (page: Page) => page.locator(".strip");
const side = (page: Page) => page.locator(".sidePane");

test("disarmed at idle: every tab and sub-tab opens, nothing that acts is enabled, every closed control says why", async ({ page }) => {
  await open(page);
  await disarmedIn(page, "idle");
  await ctl({ op: "clearCmds" });
  const bad: string[] = [];
  bad.push(...await audit(strip(page), "strip"));
  for (const tab of ["Program", "MDI", "Probing", "Offsets", "Tools", "Macros", "Sim"]) {
    const t = page.getByRole("tab", { name: tab, exact: true });
    await expect(t, `${tab}: a tab is navigation`).toBeEnabled();
    await t.click();
    await expect(t).toHaveAttribute("aria-selected", "true");
    if (tab === "Probing") {
      for (const sub of ["Outside", "Inside", "Angle", "Boss/Pocket", "Ridge/Valley", "Surface", "Calibrate", "Toolsetter"]) {
        await side(page).getByRole("tab", { name: sub, exact: true }).click();
        await expect(side(page).getByRole("tab", { name: sub, exact: true })).toHaveAttribute("aria-selected", "true");
        bad.push(...await audit(side(page), `Probing/${sub}`));
      }
    } else {
      bad.push(...await audit(side(page), tab));
    }
  }
  // Settings: every section reads; the display sections act, the protected
  // ones are dimmed with their reason (operator 2026-10-26, Q2).
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  for (const sub of ["3D Viewer", "Machine", "Display", "Gamepad", "Keyboard"]) {
    await settings.getByRole("tab", { name: sub, exact: true }).click();
    bad.push(...await audit(settings, `Settings/${sub}`));
  }
  await settings.getByRole("tab", { name: "Machine", exact: true }).click();
  await expect(settings.locator('[data-control="protectedSetting"]').first(), "a protected section: dimmed").toBeDisabled();
  await settings.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(settings.locator('[data-control="displaySetting"]').first(), "a display section: free").toBeEnabled();
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(settings).toHaveCount(0);
  expect(bad).toEqual([]);
  expect(await forbidden(), "nothing a disarmed client may not send").toEqual([]);
});

test("disarmed and unhomed, and in E-Stop: still navigable, still nothing that acts", async ({ page }) => {
  await open(page);
  for (const state of ["unhomed", "estop"] as const) {
    await disarmedIn(page, state);
    await ctl({ op: "clearCmds" });
    const bad = await audit(strip(page), `${state} strip`);
    for (const tab of ["Program", "Offsets", "Tools"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      bad.push(...await audit(side(page), `${state} ${tab}`));
    }
    expect(bad).toEqual([]);
    expect(await forbidden()).toEqual([]);
  }
});

test("disarmed: the preselections take no command — step, speed, RPM, the MDI line", async ({ page }) => {
  await open(page);
  await disarmedIn(page, "idle");
  await ctl({ op: "clearCmds" });
  const jog = page.locator('[data-strip="jog"]');
  // the jog step: a direct choice, free (BG-05)
  const steps = jog.getByRole("radiogroup", { name: "Jog step", exact: true }).getByRole("radio");
  const last = steps.last();
  await last.click();
  await expect(last).toHaveAttribute("aria-checked", "true");
  // the jog speed: the slider moves
  const speed = jog.getByRole("slider").first();
  await expect(speed).toBeEnabled();
  await speed.focus();
  await page.keyboard.press("ArrowRight");
  // the RPM preselection
  await expect(page.locator(".spRpmInput")).toBeEnabled();
  // the MDI line: typed while disarmed; Enter refuses the SEND and keeps it
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  const mdi = page.getByRole("textbox", { name: "MDI command", exact: true });
  await expect(mdi).toBeEnabled();
  await mdi.fill("G0 X1");
  await mdi.press("Enter");
  await expect(mdi, "a refused send keeps the draft").toHaveValue("G0 X1");
  await expect(page.locator("[data-btn-hint]"), "the reason at the line").toContainText("Not armed");
  // the jog buttons themselves stay closed, with their reason
  await expect(jog.locator('[data-control="jog"]').first()).toBeDisabled();
  expect(await forbidden(), "a preselection is no command, a refused MDI no history write").toEqual([]);
});

test("disarmed while a program runs: Pause, Abort and the jog Stop are reachable and act", async ({ page }) => {
  await open(page);
  await disarmedIn(page, "running");
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await ctl({ op: "clearCmds" });
  const pause = side(page).getByRole("button", { name: /Pause/ }).first();
  await expect(pause).toBeEnabled();
  await pause.click();
  await expect.poll(async () => (await sentNow()).map((c) => c.cmd)).toContain("cycle_pause");
  const abort = side(page).getByRole("button", { name: "Abort", exact: true }).first();
  await expect(abort).toBeEnabled();
  await abort.click();
  await expect.poll(async () => (await sentNow()).map((c) => c.cmd)).toContain("abort");
  const jogStop = page.locator('[data-strip="jog"] [data-control="jogStop"]');
  await expect(jogStop, "the jog pad's centre Stop is a stop").toBeEnabled();
  await jogStop.dispatchEvent("pointerdown", { button: 0, pointerId: 1, isPrimary: true });
  await expect.poll(async () => (await sentNow()).map((c) => c.cmd)).toContain("jog_stop");
  // the Macros tab's and the MDI tab's Abort too (inside the content before package C)
  for (const tab of ["MDI", "Macros"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await expect(side(page).getByRole("button", { name: "Abort", exact: true }).first(), tab).toBeEnabled();
  }
});

test("disarmed at idle: the spindle stop is reachable (BG-18 — inside the strip's fieldset before package C)", async ({ page }) => {
  await open(page);
  await disarmedIn(page, "idle", { spindle_direction: 1, spindle_speed: 1000 });
  await ctl({ op: "clearCmds" });
  const stop = page.locator('[data-strip="spindle"]').getByRole("button", { name: "Stop", exact: true });
  await expect(stop).toBeEnabled();
  await stop.click();
  await expect.poll(async () => (await sentNow()).map((c) => c.cmd)).toContain("spindle_stop");
  await expect(page.locator('[data-strip="spindle"]').getByRole("button", { name: "Fwd", exact: true })).toBeDisabled();
});

test("disarmed: the program browser browses folders; a file row is closed with its reason (BG-02)", async ({ page }) => {
  const ncDir = "/home/operator/linuxcnc/nc_files";
  await page.route("**/files*", (route) => {
    const subdir = new URL(route.request().url()).searchParams.get("subdir") ?? "";
    return route.fulfill({ json: { ok: true, nc_dir: ncDir, subdir,
      entries: subdir
        ? [{ name: "tilted.ngc", type: "file", path: `${ncDir}/twp/tilted.ngc`, size: 200 }]
        : [{ name: "twp", type: "directory", path: "twp" }, { name: "a.ngc", type: "file", path: `${ncDir}/a.ngc`, size: 10 }],
    } });
  });
  await open(page);
  await disarmedIn(page, "idle");
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await ctl({ op: "clearCmds" });
  const panel = page.locator(".sidePane .container").filter({ has: page.locator(".codeArea") });
  await clickMore(panel.locator(".ctrlRow"), "Files");
  const browser = panel.getByRole("region", { name: "Server programs" });
  await expect(browser.getByRole("button", { name: "twp", exact: true })).toBeEnabled();
  await browser.getByRole("button", { name: "twp", exact: true }).click();
  await expect(browser.getByRole("button", { name: "tilted.ngc", exact: true })).toBeVisible();
  const file = browser.getByRole("button", { name: "tilted.ngc", exact: true });
  await expect(file, "loading needs `setup` (armed)").toBeDisabled();
  await expect(file).toHaveAttribute("title", /Not armed/);
  await expect(browser.getByRole("button", { name: "Parent folder", exact: true })).toBeEnabled();
  await browser.getByRole("button", { name: "Parent folder", exact: true }).click();
  await expect(browser.getByRole("button", { name: "twp", exact: true })).toBeVisible();
  expect(await forbidden(), "browsing is no load").toEqual([]);
});

test("a dialog opened armed: after the disarm its action is closed with its reason, Cancel still closes", async ({ page }) => {
  await open(page);
  await ctl({ op: "status_delta", armed: true, data: { permissions: perms("idle") } });
  await expect(page.locator(".pill.armed")).toHaveCount(1);
  await page.getByTitle("Shut Down LinuxCNC", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Shut Down LinuxCNC?", exact: true });
  await expect(dialog).toBeVisible();
  const shut = dialog.getByRole("button", { name: "Shut Down", exact: true });
  await expect(shut).toBeEnabled();
  await disarmedIn(page, "idle");
  await expect(shut).toBeDisabled();
  await expect(dialog.locator(".btnTip").filter({ has: page.getByRole("button", { name: "Shut Down", exact: true }) }))
    .toHaveAttribute("title", /Not armed/);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

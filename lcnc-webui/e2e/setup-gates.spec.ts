// Button gates package D (BG-03, BG-04, BG-10, BG-11, BG-13, Q1; Codex
// R202–R204), at the controls: what the gateway decides (its permissions
// and reasons, tested in lcnc-gateway/test_button_gates_d.py), the strip,
// the program panel, the toolsetter and the shortcuts show and obey.
//
//   load        a program loads in E-Stop, off and unhomed (programLoad)
//   mode        MANUAL wherever task takes it, MDI / AUTO dimmed with the
//               reason where COORD is unreachable; the checked mode sends nothing
//   recovery    E-Stop Reset and arming wait for the trip's acknowledgement
//   G30         the read opens with the machine off, closes ON in AUTO
//   spindle     unhomed in MANUAL where the machine declares it (Q1)
//   start       the shortcut refuses while the program is still loading,
//               like the button (one admission, BG-10)
import { test, expect, type Page, type Route } from "@playwright/test";
import { ctl, MOCK } from "./ctl";
import { clickMore } from "./more";
import { GATE_NAMES, type Permissions } from "../src/permissions";

function perms(over: Partial<Permissions> = {}): Permissions {
  const p = Object.fromEntries(GATE_NAMES.map((k) => [k, true])) as Permissions;
  p.pause = false; p.resume = false; p.toolChangeConfirm = false;
  return { ...p, ...over };
}

type Sent = { cmd?: string; mode?: number; path?: string };
const sent = async (): Promise<Sent[]> => ((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [];
const sentCmds = async () => (await sent()).map((c) => c.cmd);

async function open(page: Page) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { keyboard: { jogEnabled: true, buttonsEnabled: true } } } });
}

/** A machine state: the gateway's permissions + reasons for it, armed by default. */
async function machine(page: Page, data: Record<string, unknown>, over: Partial<Permissions>,
                       reasons: Partial<Record<keyof Permissions, string>> = {}, armed = true) {
  await ctl({ op: "status_delta", armed, data: { ...data, permissions: perms(over), permission_reasons: reasons } });
  await expect(page.locator(armed ? ".pill.armed" : ".pill.disarmed")).toHaveCount(1);
}

const ESTOP = { estop: true, is_estop: true, enabled: false, is_enabled: false, homed: false, homed_joints: [false, false, false] };
const UNHOMED = { homed: false, homed_joints: [false, false, false] };
const reasonOf = (page: Page, control: string) =>
  page.locator(`.btnTip:has([data-control="${control}"])`).first();

test("a program loads in E-Stop, off and unhomed: programLoad, no power or homing (BG-03)", async ({ page }) => {
  const ncDir = "/home/operator/linuxcnc/nc_files";
  await page.route("**/files*", (route) => route.fulfill({ json: { ok: true, nc_dir: ncDir, subdir: "",
    entries: [{ name: "part.ngc", type: "file", path: `${ncDir}/part.ngc`, size: 10 }] } }));
  await open(page);
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  const panel = page.locator(".sidePane .container").filter({ has: page.locator(".codeArea") });
  const browser = panel.getByRole("region", { name: "Server programs" });
  const file = browser.getByRole("button", { name: "part.ngc", exact: true });
  for (const [name, data] of [["E-Stop", ESTOP], ["off", { enabled: false, is_enabled: false }], ["unhomed", UNHOMED]] as const) {
    // the gateway's classes in that state: no idle / setup / ready, programLoad open
    await machine(page, data, { idle: false, setup: name !== "E-Stop", ready: false, run: false });
    if (!(await browser.isVisible())) await clickMore(panel.locator(".ctrlRow"), "Files");   // a load closes it
    await ctl({ op: "clearCmds" });
    await expect(file, name).toBeEnabled();
    await file.click();
    await expect.poll(async () => (await sent()).filter((c) => c.cmd === "load_file").map((c) => c.path), name)
      .toEqual([`${ncDir}/part.ngc`]);
  }
});

test("the task mode per target: MANUAL in E-Stop and unhomed, MDI / AUTO dimmed with the reason; the checked mode sends nothing (BG-04)", async ({ page }) => {
  await open(page);
  const mode = page.locator('[data-strip="jog"]').getByRole("toolbar", { name: "Task mode", exact: true });
  const option = (name: string) => mode.getByRole("radio", { name, exact: true });
  const NOT_HOMED = "Not homed — MDI and Auto need Home All";
  // unhomed, task in MDI: Manual open, MDI / Auto closed with the reason
  await machine(page, { ...UNHOMED, task_mode: 3 }, { modeCoord: false, idle: true }, { modeCoord: NOT_HOMED });
  await expect(option("Manual")).not.toHaveAttribute("aria-disabled", "true");
  await expect(option("Auto")).toHaveAttribute("aria-disabled", "true");
  await expect(option("Auto")).toHaveAttribute("title", NOT_HOMED);
  await ctl({ op: "clearCmds" });
  const auto = (await option("Auto").boundingBox())!;   // a real tap on the dimmed option
  await page.mouse.click(auto.x + auto.width / 2, auto.y + auto.height / 2);
  await expect(page.locator(".btnHint")).toHaveText(NOT_HOMED);
  await option("Manual").click();
  await expect.poll(async () => (await sent()).filter((c) => c.cmd === "set_mode").map((c) => c.mode)).toEqual([1]);
  // E-Stop, task in MDI: Manual still open (no power term)
  await machine(page, { ...ESTOP, task_mode: 3 }, { idle: false, safety: false, modeCoord: false }, { modeCoord: NOT_HOMED });
  await expect(option("Manual")).not.toHaveAttribute("aria-disabled", "true");
  // the checked mode again: nothing sent
  await machine(page, { ...UNHOMED, task_mode: 1, estop: false, is_estop: false, enabled: true, is_enabled: true }, { modeCoord: false }, { modeCoord: NOT_HOMED });
  await expect(option("Manual")).toHaveAttribute("aria-checked", "true");
  await ctl({ op: "clearCmds" });
  await option("Manual").click();
  await page.waitForTimeout(300);
  expect(await sentCmds()).not.toContain("set_mode");
});

test("the recovery order: E-Stop Reset and arming wait for the trip's acknowledgement — the reason at the button (BG-11)", async ({ page }) => {
  await open(page);
  const TRIP = "Acknowledge the safety trip first";
  const reset = page.getByRole("button", { name: "Reset E-Stop", exact: true });
  await machine(page, ESTOP, { estopReset: false }, { estopReset: TRIP });
  await expect(reset).toBeDisabled();
  await expect(reasonOf(page, "estop")).toHaveAttribute("title", TRIP);
  await machine(page, ESTOP, { estopReset: true });
  await expect(reset).toBeEnabled();
  await ctl({ op: "clearCmds" });
  await reset.click();
  await expect.poll(sentCmds).toContain("estop_reset");
  // disarmed with a trip waiting: Arm dimmed with the reason; acknowledged: open
  await machine(page, ESTOP, { armEnable: false }, { armEnable: TRIP }, false);
  await expect(page.getByRole("button", { name: "Arm", exact: true })).toBeDisabled();
  await expect(reasonOf(page, "arm")).toHaveAttribute("title", TRIP);
  await machine(page, ESTOP, { armEnable: true }, {}, false);
  await expect(page.getByRole("button", { name: "Arm", exact: true })).toBeEnabled();
});

test("the G30 read: open with the machine off, closed ON in AUTO with the reason (BG-13)", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  await page.locator(".sidePane").getByRole("tab", { name: "Toolsetter", exact: true }).click();
  const refresh = page.locator('[data-control="g30Read"]');
  await machine(page, { enabled: false, is_enabled: false }, { idle: false, ready: false, machineFrame: false, parameterRead: true });
  await expect(refresh, "off: the confirming synch works").toBeEnabled();
  const AUTO = "G30 not confirmed in AUTO — switch to MDI first";
  await machine(page, { enabled: true, is_enabled: true, task_mode: 2 }, { parameterRead: false, g30Write: false, g30Capture: false },
    { parameterRead: AUTO, g30Write: AUTO, g30Capture: AUTO });
  await expect(refresh).toBeDisabled();
  await expect(reasonOf(page, "g30Read")).toHaveAttribute("title", AUTO);
});

test("the manual spindle unhomed where the machine declares it, MANUAL only (Q1)", async ({ page }) => {
  await open(page);
  const fwd = page.locator('[data-strip="spindle"]').getByRole("button", { name: "Fwd", exact: true });
  await machine(page, UNHOMED, { ready: false, run: false, spindleManual: true });
  await expect(fwd, "declared, in MANUAL").toBeEnabled();
  const MANUAL_ONLY = "Unhomed spindle: Manual mode only";
  await machine(page, { ...UNHOMED, task_mode: 3 }, { ready: false, spindleManual: false }, { spindleManual: MANUAL_ONLY });
  await expect(fwd).toBeDisabled();
  await expect(reasonOf(page, "spindleFwd")).toHaveAttribute("title", MANUAL_ONLY);
});

test("Start by the shortcut waits for the program text like the button (one admission, BG-10)", async ({ page }) => {
  let held: Route | null = null;
  await page.route("**/gcode?*", (route) => { held = route; });
  await open(page);
  await machine(page, { active_file: "/leak.ngc" }, {});
  await ctl({ op: "loadGcode" });   // viewer_gcode_ready → the text is fetched (held here)
  await expect.poll(() => held !== null, "the program text is being fetched").toBe(true);
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  const start = page.locator('[data-control="start"]').first();
  await expect(start).toBeDisabled();
  await expect(reasonOf(page, "start")).toHaveAttribute("title", "Loading program — wait");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");
  await page.waitForTimeout(300);
  expect(await sentCmds(), "Space while loading starts nothing").not.toContain("cycle_start");
  // the text arrives: the button and the shortcut start (positive control)
  await held!.fulfill({ contentType: "text/plain", body: "(B)\nG0 X0\nM2\n" });
  await expect(start).toBeEnabled();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await expect.poll(async () => { await page.keyboard.press(" "); return sentCmds(); }).toContain("cycle_start");
});

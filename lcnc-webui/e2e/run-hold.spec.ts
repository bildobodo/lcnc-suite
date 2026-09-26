import { test, expect, type Page, type Locator } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// Design wave D6 (operator decision 2026-09-25, UI-D02 / N95): starting
// motion is a HOLD, like every other motion button —
//
//   - Start, Step and Resume fire on a complete hold only; a tap sends
//     nothing and says so at the control. Pause and Abort stay taps.
//   - Start with a selected line only OPENS the Run-from-line dialog (no
//     motion, a tap); the dialog's action is the hold, bound to the program
//     and the line.
//   - A macro without parameters runs on a hold bound to its command: a
//     command saved by another client during the hold cancels it, and the
//     next hold runs exactly the visible command once.
//   - A macro with parameters opens its dialog on a tap; Enter in a field
//     moves on and never executes; Execute is a hold bound to the values;
//     the send checks the button's own class (`probe`, not `ready`).
//
// Runs under `serial-guards`: mock-global status + recorded commands.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};
const PROGRAM = "(program A)\nG0 X0\nG1 X10 F100\nG1 Y10\nM2\n";
const MACROS = { macros: [
  { id: "m-park", name: "Park", command: "G53 G0 Z0", params: [] },
  { id: "m-face", name: "Face Top", command: "G0 Z{depth} F{feed}",
    params: [{ name: "depth", label: "Depth", default: "5" }, { name: "feed", label: "Feed", default: "100" }] },
] };
const HOLD_MS = 700;   // > HOLD_FIRE_MS (500)

async function sent(): Promise<{ cmd?: string; text?: string; line?: number }[]> {
  const r = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string; text?: string; line?: number }[] };
  return r.cmds ?? [];
}
const count = async (cmd: string) => (await sent()).filter(c => c.cmd === cmd).length;

async function ready(page: Page, settings: Record<string, unknown> = {}) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: PROGRAM }));
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", homed: [1, 1, 1], permissions: PERMS_ALL } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 700, file: "/A.ngc" } });
  await expect(page.locator(".codeLine").first()).toContainText("(program A)");
  await ctl({ op: "clearCmds" });
}

/** Press with the mouse for `ms`, then release — a tap or a hold. */
async function press(page: Page, target: Locator, ms: number) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test.afterEach(async () => { await ctl({ op: "reset" }); });

test("Start, Step and Resume fire on a complete hold only — a tap says why; Pause stays a tap", async ({ page }) => {
  await ready(page);
  const start = page.getByRole("button", { name: "Start", exact: true });
  await press(page, start, 120);
  await expect(page.locator("[data-btn-hint]")).toHaveText("Hold to activate");
  await page.waitForTimeout(300);
  expect(await count("cycle_start"), "a tap starts nothing").toBe(0);
  await press(page, start, HOLD_MS);
  await expect.poll(() => count("cycle_start")).toBe(1);

  const step = page.getByRole("button", { name: "Step", exact: true });
  await press(page, step, 120);
  await page.waitForTimeout(300);
  expect(await count("auto_step")).toBe(0);
  await press(page, step, HOLD_MS);
  await expect.poll(() => count("auto_step")).toBe(1);

  // Running: Pause is a tap. Paused: Resume is a hold.
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, pause: true, run: false } } });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(() => count("cycle_pause")).toBe(1);
  await ctl({ op: "status_delta", data: { paused: true, permissions: { ...PERMS_ALL, pause: false, resume: true, run: false } } });
  const resume = page.getByRole("button", { name: "Resume", exact: true });
  await press(page, resume, 120);
  await page.waitForTimeout(300);
  expect(await count("cycle_resume")).toBe(0);
  await press(page, resume, HOLD_MS);
  await expect.poll(() => count("cycle_resume")).toBe(1);
});

test("Run from line: Start only opens the dialog on a tap; the dialog's action is a hold bound to the program and the line", async ({ page }) => {
  await ready(page, { machine: { runFromLine: true, rflSpindleDir: "off" } });
  await page.locator(".codeLine").nth(2).click();
  const start = page.getByRole("button", { name: "Start L3", exact: true });
  await start.click();
  const dialog = page.getByRole("dialog", { name: "Run from Line 3", exact: true });
  await expect(dialog).toBeVisible();
  const run = dialog.getByRole("button", { name: "Run from Line 3", exact: true });
  await press(page, run, 120);
  await page.waitForTimeout(300);
  expect(await count("auto_run"), "a tap on the action runs nothing").toBe(0);
  await press(page, run, HOLD_MS);
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "auto_run").map(c => c.line)).toEqual([3]);
});

test("a macro without parameters runs on a hold; a command saved during the hold cancels it, the next hold runs the new one once", async ({ page }) => {
  await ready(page, { macros: MACROS });
  const park = page.locator(".macroBar").getByRole("button", { name: "Park", exact: true });
  await press(page, park, 120);
  await page.waitForTimeout(300);
  expect(await count("mdi"), "a tap runs nothing").toBe(0);
  // Another client saves a different command under the same id mid-hold.
  const box = (await park.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { macros: { macros: [
    { ...MACROS.macros[0], command: "G53 G0 Z-5" }, MACROS.macros[1]] } } } });
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  await expect(page.locator("[data-btn-hint]")).toHaveText("Selection changed — hold again");
  expect(await count("mdi"), "the retargeted hold ran nothing").toBe(0);
  await press(page, park, HOLD_MS);
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "mdi").map(c => c.text)).toEqual(["G53 G0 Z-5"]);
});

test("a macro with parameters opens on a tap; Enter moves on and never executes; Execute is a hold bound to the values", async ({ page }) => {
  await ready(page, { macros: MACROS });
  await page.locator(".macroBar").getByRole("button", { name: "Face Top", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Face Top", exact: true });
  await expect(dialog).toBeVisible();
  const depth = dialog.getByRole("textbox", { name: "Depth", exact: true });
  const feed = dialog.getByRole("textbox", { name: "Feed", exact: true });
  await depth.focus();
  await page.keyboard.press("Enter");
  await expect(feed).toBeFocused();
  await page.keyboard.press("Enter");
  const execute = dialog.getByRole("button", { name: "Execute", exact: true });
  await expect(execute).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  expect(await count("mdi"), "Enter never executes").toBe(0);
  await expect(dialog).toBeVisible();
  // A value changed during the hold cancels it.
  await feed.fill("250");
  const box = (await execute.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(200);
  await feed.evaluate((el: HTMLInputElement) => { el.value = "300"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  expect(await count("mdi"), "the retargeted hold ran nothing").toBe(0);
  await press(page, execute, HOLD_MS);
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "mdi").map(c => c.text)).toEqual(["G0 Z5 F300"]);
  // The send checks the button's class: probe closed (ready open) → dimmed.
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, probe: false } } });
  await expect(page.locator(".macroBar").getByRole("button", { name: "Park", exact: true })).toBeDisabled();
});

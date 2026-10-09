import { test, expect, type Page, type Locator } from "@playwright/test";
import { ctl, MOCK } from "./ctl";
import { Folder, serve, rev } from "./macroFolder";

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
/** The macro files on the bar: park (no parameters, a hold) and face_top
 *  (parameters, a dialog) — macroFolder.ts; the earlier settings macros were
 *  dropped 2026-10-02. */
const BAR = { macros: { macros: [], bar: ["park", "face_top"] } };
const HOLD_MS = 700;   // > HOLD_FIRE_MS (500)

async function sent(): Promise<{ cmd?: string; text?: string; line?: number }[]> {
  const r = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string; text?: string; line?: number }[] };
  return r.cmds ?? [];
}
const count = async (cmd: string) => (await sent()).filter(c => c.cmd === cmd).length;

// The fingerprint GET /gcode names for the text it serves (Codex R17 XZ-07).
const SOURCE_A = "a".repeat(64), SOURCE_M = "m".repeat(64);

async function ready(page: Page, settings: Record<string, unknown> = {}, folder?: Folder) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  if (folder) await serve(page, folder);
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: PROGRAM,
    headers: { "X-Program-Source": SOURCE_A } }));
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
  // a gate change re-renders the button (its .btnTip wrapper): wait for a box
  await expect(target).toBeVisible();
  let box = await target.boundingBox();
  for (let i = 0; !box && i < 40; i++) { await page.waitForTimeout(50); box = await target.boundingBox(); }
  if (!box) throw new Error("press: the control has no box");
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
  // Bound to what the dialog showed (Codex R16/R17 XZ-07): the gateway
  // refuses an auto_run whose program, text revision or text is no longer
  // the loaded one.
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "auto_run")
    .map(c => [c.line, (c as { file?: string }).file, (c as { version?: number }).version,
      (c as { source?: string }).source])).toEqual([[3, "/A.ngc", 700, SOURCE_A]]);
});

test("Run from line with a pre-measurement is ONE auto_run carrying the toolsetter's values and its program — nothing waits in the browser (Codex R16 XZ-07)", async ({ page }) => {
  const WITH_M600 = "(program M)\nT5 M600\nG90 G54 G0 X10 Y20\nG1 X11 F100\nG1 X12\nM2\n";
  await ready(page, { machine: { runFromLine: true, rflSpindleDir: "off" },
    toolsetter: { touchX: 0, touchY: 0, touchZ: -300, fastFeed: 200, slowFeed: 20, traverseFeed: 500,
                  maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180 } });
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: WITH_M600,
    headers: { "X-Program-Source": SOURCE_M } }));
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 701, file: "/A.ngc" } });
  await expect(page.locator(".codeLine").first()).toContainText("(program M)");
  await ctl({ op: "clearCmds" });
  await page.locator(".codeLine").nth(4).click();
  await page.getByRole("button", { name: "Start L5", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Run from Line 5", exact: true });
  await press(page, dialog.getByRole("button", { name: "Measure T5 + Run from Line 5", exact: true }), HOLD_MS);
  await expect.poll(async () => (await sent()).map(c => c.cmd)).toEqual(["auto_run"]);
  const [run] = await sent() as { [k: string]: unknown }[];
  expect(run).toMatchObject({ line: 5, pre_tool: 5, file: "/A.ngc", version: 701, source: SOURCE_M, entry_x: 11, entry_y: 20 });
  expect(run.probe_vars).toMatchObject({ "3102": -300, "3004": 200 });
  // Another program arriving now changes nothing that was sent.
  await ctl({ op: "status_delta", data: { active_file: "/B.ngc" } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 702, file: "/B.ngc" } });
  await page.waitForTimeout(400);
  expect((await sent()).map(c => c.cmd)).toEqual(["auto_run"]);
});

// ── A new revision of the SAME program (UI-DI05) ──
// The holds were keyed to the path alone: a re-published /A.ngc during a
// hold ran the confirmed action on the new program, and Run from line sent
// the OLD text's entry position. The arrival of the revision cancels a
// running hold even while its text is still being fetched; until the text
// has landed Start, Step and the Run-from-line action wait.
// Each later revision names itself on line 1 and starts at X20.
const programV = (v: string) => `(program A${v})\nG0 X20\nG1 X10 F100\nG1 Y10\nM2\n`;

/** Serve the program text per version (`v=`), the new one late. */
async function serveRevisions(page: Page, late: Record<string, number>) {
  await page.route("**/gcode?*", async route => {
    const v = new URL(route.request().url()).searchParams.get("v") ?? "";
    if (late[v] !== undefined) await new Promise(r => setTimeout(r, late[v]));
    await route.fulfill({ contentType: "text/plain", body: Number(v) > 700 ? programV(v) : PROGRAM });
  });
}
/** Hold `target`; `during` runs 100 ms in; true when the hold was cancelled. */
async function holdWhile(page: Page, target: Locator, during: () => Promise<void>) {
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await during();
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
}
const republish = (version: number) =>
  ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version, file: "/A.ngc" } });

test("a new revision of the same program cancels a Start, Step or Resume hold — at its arrival, the text still loading", async ({ page }) => {
  await ready(page);
  await serveRevisions(page, { "701": 1500, "702": 1500, "703": 1500 });
  const hint = page.locator("[data-btn-hint]");
  const cases: [string, string, number, () => Promise<void>][] = [
    ["Start", "cycle_start", 701, async () => {}],
    ["Step", "auto_step", 702, async () => {}],
    ["Resume", "cycle_resume", 703, async () => {
      await ctl({ op: "status_delta", data: { paused: true, permissions: { ...PERMS_ALL, pause: false, resume: true, run: false } } });
    }],
  ];
  for (const [name, cmd, version, prepare] of cases) {
    await prepare();
    const btn = page.getByRole("button", { name, exact: true });
    await holdWhile(page, btn, () => republish(version));
    await expect(hint, `${name}: the hold says it was cancelled`).toBeVisible();
    await page.waitForTimeout(200);
    expect(await count(cmd), `${name}: a new revision mid-hold runs nothing`).toBe(0);
    // The text lands; a complete hold now runs exactly once.
    await expect(page.locator(".codeLine").first()).toContainText(`(program A${version})`, { timeout: 5000 });
    await press(page, btn, HOLD_MS);
    await expect.poll(() => count(cmd), `${name}: the next complete hold`).toBe(1);
  }
});

test("while a revision's text is still loading, Start and Step wait — a hold there runs nothing", async ({ page }) => {
  await ready(page);
  await serveRevisions(page, { "701": 2500 });
  await republish(701);
  const start = page.getByRole("button", { name: "Start", exact: true });
  await press(page, start, HOLD_MS);
  await page.waitForTimeout(200);
  expect(await count("cycle_start"), "a hold on the stale text").toBe(0);
  await expect(page.locator(".codeLine").first()).toContainText("(program A701)", { timeout: 5000 });
  await press(page, start, HOLD_MS);
  await expect.poll(() => count("cycle_start")).toBe(1);
});

test("Run from line: a new revision cancels the action's hold, closes the dialog when the text changed, and the next run carries the new entry", async ({ page }) => {
  await ready(page, { machine: { runFromLine: true, rflSpindleDir: "off" } });
  await serveRevisions(page, { "701": 1500 });
  await page.locator(".codeLine").nth(2).click();
  await page.getByRole("button", { name: "Start L3", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Run from Line 3", exact: true });
  const run = dialog.getByRole("button", { name: "Run from Line 3", exact: true });
  await holdWhile(page, run, () => republish(701));
  await page.waitForTimeout(200);
  expect(await count("auto_run"), "a new revision mid-hold runs nothing").toBe(0);
  // The new text differs: a line of the old text is not a line of the new.
  await expect(page.locator(".codeLine").first()).toContainText("(program A701)", { timeout: 5000 });
  await expect(dialog, "the dialog of the old text closes").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start", exact: true }), "the selection is gone").toBeVisible();
  await page.locator(".codeLine").nth(2).click();
  await page.getByRole("button", { name: "Start L3", exact: true }).click();
  await press(page, page.getByRole("dialog", { name: "Run from Line 3", exact: true })
    .getByRole("button", { name: "Run from Line 3", exact: true }), HOLD_MS);
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "auto_run")
    .map(c => [c.line, (c as { entry_x?: number }).entry_x])).toEqual([[3, 20]]);
});

test("a line selection belongs to its program: another program clears it", async ({ page }) => {
  await ready(page, { machine: { runFromLine: true, rflSpindleDir: "off" } });
  await page.locator(".codeLine").nth(2).click();
  await expect(page.getByRole("button", { name: "Start L3", exact: true })).toBeVisible();
  await ctl({ op: "status_delta", data: { active_file: "/B.ngc" } });
  await expect(page.getByRole("button", { name: "Start", exact: true }), "B's Start is no run from A's line").toBeVisible();
});

// ── Two independent option groups, two native names (UI-DI07) ──
// The Run-from-line dialog's spindle preset and Settings' DEFAULT preset
// shared the native radio name `rflSpindleDir`: mounting Settings (any
// section) unchecked the dialog's choice while its model still held it —
// the sent preset and the visible one disagreed.
const PRESETS = [["reverse", "Rev"], ["off", "Stop"], ["forward", "Fwd"]] as const;
const checkedIn = (group: Locator) => group.locator("label").filter({ has: group.page().locator("input:checked") });

test("the Run-from-line preset and Settings' default preset never uncheck each other — both orders, every value", async ({ page }) => {
  await ready(page, { machine: { runFromLine: true, rflSpindleDir: "forward", rflSpindleRpm: 8000 } });
  const runGroup = page.getByRole("radiogroup", { name: "Spindle preset", exact: true });
  const defaultGroup = page.getByRole("radiogroup", { name: "Default Spindle Preset", exact: true });
  for (const [value, label] of PRESETS) {
    for (const order of ["dialog first", "settings first"]) {
      await ctl({ op: "clearCmds" });
      if (order === "settings first") {
        // Settings mounted and closed before the dialog opens.
        await page.getByRole("button", { name: "Settings", exact: true }).click();
        await page.getByRole("button", { name: "Close settings", exact: true }).click();
      }
      await page.locator(".codeLine").nth(2).click();
      await page.getByRole("button", { name: "Start L3", exact: true }).click();
      await runGroup.getByText(label, { exact: true }).click();
      await expect(checkedIn(runGroup)).toHaveText(label);
      // Settings over the dialog, on a section other than Machine, then Machine.
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const sections = page.getByRole("tablist", { name: "Settings sections", exact: true });
      await sections.getByRole("tab", { name: "Display", exact: true }).click();
      await expect(checkedIn(runGroup), `${order}, ${label}: under Settings`).toHaveText(label);
      await sections.getByRole("tab", { name: "Machine", exact: true }).click();
      await expect(checkedIn(defaultGroup), "Settings shows the saved default").toHaveText("Fwd");
      await expect(checkedIn(runGroup), `${order}, ${label}: beside the default group`).toHaveText(label);
      await page.getByRole("button", { name: "Close settings", exact: true }).click();
      await expect(checkedIn(runGroup), `${order}, ${label}: after Settings`).toHaveText(label);
      // The visible choice is the sent one.
      await press(page, page.getByRole("dialog", { name: "Run from Line 3", exact: true })
        .getByRole("button", { name: "Run from Line 3", exact: true }), HOLD_MS);
      await expect.poll(async () => (await sent()).filter(c => c.cmd === "auto_run")
        .map(c => (c as { spindle_dir?: string }).spindle_dir ?? "off")).toEqual([value]);
    }
  }
});

// (A macro without parameters on a hold, a revision saved during the hold:
// macros.spec "another client's save during a bar hold cancels it".)

// ── Package 5, stage A: the bar moves with the orientation ──
// Portrait puts the macro bar in the viewer column, landscape under the
// content: an orientation change mounts a NEW bar. A hold in progress ends
// with the old button — nothing runs, the next full hold runs once; a
// focused macro keeps its focus on the same macro (by its id); an open
// parameter dialog returns to the new button when it closes.
test("an orientation change mid-hold runs nothing; the focus and an open dialog's return follow the macro", async ({ page }) => {
  await ready(page, BAR, new Folder());
  const PORTRAIT = { width: 1000, height: 1400 }, LANDSCAPE = { width: 1600, height: 1000 };
  const park = () => page.locator(".macroBar").getByRole("button", { name: "Park", exact: true });
  const box = (await park().boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  await page.setViewportSize(PORTRAIT);
  await expect(page.locator(".viewerColumn .macroBar"), "the bar moved into the viewer column").toBeVisible();
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await count("run_macro"), "the hold ended with its button").toBe(0);
  await press(page, park(), HOLD_MS);
  await expect.poll(() => count("run_macro"), { message: "a full hold on the new button runs once" }).toBe(1);
  // the focus follows the macro, not a position
  await park().focus();
  await page.setViewportSize(LANDSCAPE);
  await expect(page.locator(".viewerColumn .macroBar")).toHaveCount(0);
  await expect(park(), "focus on the same macro in the new bar").toBeFocused();
  // an open parameter dialog returns to the new button
  const face = () => page.locator(".macroBar").getByRole("button", { name: "Face top", exact: true });
  await face().click();
  const dialog = page.getByRole("dialog", { name: "Face top" });
  await expect(dialog).toBeVisible();
  await page.setViewportSize(PORTRAIT);
  await expect(page.locator(".viewerColumn .macroBar")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(face(), "the dialog returned to the new Face top").toBeFocused();
  expect(await count("run_macro"), "nothing else ran").toBe(1);
});

// ── The parameter dialog follows its macro file (UI-DI08) ──
// The dialog reads its file live by name — a new revision, a new parameter
// set or the file's deletion cancels the Execute hold; entered values stay,
// a new parameter shows its default, and the next complete hold runs exactly
// the visible revision with the visible values once.
const runs = async () => (await sent()).filter(c => c.cmd === "run_macro") as { name?: string; revision?: string; args?: number[] }[];
/** A value through the field's keypad, the operator's way. */
async function enterValue(page: Page, field: Locator, value: string) {
  await field.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(value);
  await page.keyboard.press("Enter");
  await expect(field).toHaveValue(value);
}
test("a macro revision saved during the dialog's Execute hold cancels it; the next hold runs the visible revision once", async ({ page }) => {
  const folder = new Folder();
  await ready(page, BAR, folder);
  const hint = page.locator("[data-btn-hint]");
  const dialog = page.getByRole("dialog");
  const execute = dialog.getByRole("button", { name: "Execute", exact: true });
  const face = folder.files.get("face_top")!;
  const meta = face.meta as { title: string; params: Record<string, unknown>[] };
  const changed = (version: number) => ctl({ op: "raw", frame: { type: "macros_changed", version } });

  // 1. A new revision (and title) of the same file.
  await page.locator(".macroBar").getByRole("button", { name: "Face top", exact: true }).click();
  await holdWhile(page, execute, async () => {
    folder.touch("face_top", face.text.replace("(MACRO Face top)", "(MACRO Face deep)"));
    face.meta = { ...meta, title: "Face deep" };
    await changed(2);
  });
  await expect(hint).toHaveText("Selection changed — hold again");
  expect(await runs(), "the old revision did not run").toEqual([]);
  await expect(page.getByRole("dialog", { name: "Face deep", exact: true })).toBeVisible();
  await press(page, execute, HOLD_MS);
  await expect.poll(runs).toEqual([expect.objectContaining({ name: "face_top", revision: rev(face.text), args: [0.5, 600] })]);

  // 2. A new parameter: the entered value stays, the new one shows its default.
  await ctl({ op: "clearCmds" });
  await page.locator(".macroBar").getByRole("button", { name: "Face deep", exact: true }).click();
  const feed = dialog.getByLabel("Feed", { exact: true });
  await enterValue(page, feed, "250");
  await holdWhile(page, execute, async () => {
    folder.touch("face_top", face.text.replace("(PARAM 2 feed", '(PARAM 3 clear "Clearance Z" length 5 min=1 max=100)\n(PARAM 2 feed'));
    face.meta = { ...face.meta, params: [...meta.params,
      { n: 3, key: "clear", label: "Clearance Z", unit: "length", default: 5, min: 1, max: 100, integer: false }] };
    await changed(3);
  });
  expect(await runs(), "a new parameter set cancels").toEqual([]);
  await expect(feed, "the entered value stays").toHaveValue("250");
  await expect(dialog.getByLabel("Clearance Z", { exact: true }), "the new parameter's default").toHaveValue("5");
  await press(page, execute, HOLD_MS);
  await expect.poll(runs).toEqual([expect.objectContaining({ name: "face_top", revision: rev(face.text), args: [0.5, 250, 5] })]);

  // 3. The file deleted: the hold ends, nothing runs, the dialog says so.
  await ctl({ op: "clearCmds" });
  await page.locator(".macroBar").getByRole("button", { name: "Face deep", exact: true }).click();
  await holdWhile(page, execute, async () => {
    folder.files.delete("face_top");
    await changed(4);
  });
  await page.waitForTimeout(200);
  expect(await runs(), "a deleted macro runs nothing").toEqual([]);
  await expect(dialog.getByRole("alert")).toContainText("removed");
  await expect(execute).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("a macro with parameters opens on a tap; Enter opens a field's keypad and never executes; Execute is a hold bound to the values", async ({ page }) => {
  const folder = new Folder();
  await ready(page, BAR, folder);
  await page.locator(".macroBar").getByRole("button", { name: "Face top", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Face top", exact: true });
  await expect(dialog).toBeVisible();
  const depth = dialog.getByLabel("Depth", { exact: true });
  const feed = dialog.getByLabel("Feed", { exact: true });
  // A macro's parameters are numbers: Enter opens the field's keypad (the
  // number-field contract), Enter there applies and hands the focus back.
  await depth.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".nkStrip")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".nkStrip")).toHaveCount(0);
  await expect(depth).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(feed).toBeFocused();
  const execute = dialog.getByRole("button", { name: "Execute", exact: true });
  await execute.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  expect(await count("run_macro"), "Enter and Space never execute").toBe(0);
  await expect(dialog).toBeVisible();
  // The hold runs the entered values (a value changed during a hold re-keys
  // it: useMacros.test.ts — a number field takes values only through its
  // keypad, which no pointer holding Execute can reach).
  await enterValue(page, feed, "300");
  await press(page, execute, 120);
  expect(await count("run_macro"), "a tap runs nothing").toBe(0);
  await press(page, execute, HOLD_MS);
  await expect.poll(runs).toEqual([expect.objectContaining({ name: "face_top", revision: rev(folder.files.get("face_top")!.text), args: [0.5, 300] })]);
  // The send checks the button's class: probe closed (ready open) → dimmed.
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, probe: false } } });
  await expect(page.locator(".macroBar").getByRole("button", { name: "Park", exact: true })).toBeDisabled();
});

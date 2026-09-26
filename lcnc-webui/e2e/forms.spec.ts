import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// Design wave D4 (UI-K03, K04, K10, plan WP-D4) — controls and forms:
//
//   - every visible field (input, select, textarea, slider, colour) has an
//     accessible name, and every visible <label> labels a control (no label
//     that only sits next to its field) — on the strip, every side-pane tab
//     and Probing procedure, the tool editor, the import preview, the macro
//     parameters, the G-code Reference and every Settings section;
//   - ONE height per density: a field (.inputField) and an md button in the
//     side pane or a dialog are --control-h tall (32 px desktop, 44 px
//     touch); inside a dense area (the strip, a data table) a field is at
//     least the compact height (28 / 36 px);
//   - a form field's unit follows the machine's linear unit (mm → in), is
//     part of its description and of the keypad readout; a label tap opens
//     the field.
//
// Runs under `serial-guards`: mock-global state, one file at a time.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};
const TOOL = { T: 5, P: 5, Z: -40, D: 6, type: "endmill", description: "Test cutter" };
const PROBE_VIEWS = ["Outside", "Inside", "Angle", "Boss/Pocket", "Ridge/Valley", "Surface", "Calibrate", "Toolsetter"];
const SETTINGS_TABS = ["3D Viewer", "Machine", "Display", "Macros", "Gamepad", "Keyboard", "HAL", "Debug"];
const MACROS = { macros: [
  { id: "m-face", name: "Face Top", command: "G0 Z{depth} F{feed}",
    params: [{ name: "depth", label: "Depth", default: "5" }, { name: "feed", label: "Feed", default: "100" }] },
] };
// Run from line on, its preset forward (the speed field shows); gamepad
// buttons on (the mapping table's selects show).
const SETTINGS = { macros: MACROS, machine: { runFromLine: true, rflSpindleDir: "forward" },
  gamepad: { jogEnabled: true, buttonsEnabled: true } };

function viewerInit(linearUnits: string) {
  return { units: linearUnits, stl_base_url: "/machine/", parts: [], kinematics: [], axes: ["X", "Y", "Z"],
    machine_bounds: { origin: [0, 0, 0], size: [100, 100, 100] }, ini_config: { linear_units: linearUnits } };
}

async function ready(page: Page, touch: boolean, linearUnits = "mm", settings: Record<string, unknown> = {}) {
  await ctl({ op: "reset" });
  // The DR geometry (plan WP-DR): desktop 1600 × 1000, touch landscape 1280 × 800.
  await page.setViewportSize(touch ? { width: 1280, height: 800 } : { width: 1600, height: 1000 });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  if (touch) await page.evaluate(() => document.documentElement.classList.add("touch-device"));
  await ctl({ op: "setViewerInit", data: viewerInit(linearUnits) });
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings } });
  await expect(page.locator("input.setupInput")).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
}

interface Found { problems: string[]; fields: number }

/** Names, labels and heights inside one surface. */
async function scan(page: Page, surface: string, scope: string): Promise<Found> {
  const root = page.locator(scope).first();
  const problems: string[] = [];
  const fields = root.locator('input:not([type="hidden"]):not([type="file"]), select, textarea');
  let count = 0;
  for (const f of await fields.all()) {
    if (!(await f.isVisible())) continue;
    count++;
    const name = await f.evaluate(e => {
      const id = e.getAttribute("name") ?? "";
      return `${e.tagName.toLowerCase()}[${(e as HTMLInputElement).type ?? ""}] ${id}`.trim();
    });
    try { await expect(f).toHaveAccessibleName(/\S/, { timeout: 100 }); }
    catch { problems.push(`${surface}: ${name} has no accessible name`); }
  }
  problems.push(...await root.evaluate((el, surface) => {
    const out: string[] = [];
    const shown = (e: Element) => (e as HTMLElement).offsetParent !== null || getComputedStyle(e).position === "fixed";
    // A label that labels nothing: the visible text next to a field that the
    // field does not know (the K10 finding — 112 probe fields).
    for (const l of el.querySelectorAll("label")) {
      if (shown(l) && !(l as HTMLLabelElement).control) out.push(`${surface}: label "${l.textContent!.trim().slice(0, 30)}" labels no control`);
    }
    const controlH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--control-h"));
    const compactH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--control-h-compact"));
    for (const f of el.querySelectorAll<HTMLElement>(".inputField")) {
      if (!shown(f)) continue;
      const h = Math.round(f.getBoundingClientRect().height * 10) / 10;
      const who = f.getAttribute("name") ?? f.getAttribute("aria-label") ?? f.tagName;
      if (f.closest(".strip, .dataTable")) {
        if (h < compactH - 0.5) out.push(`${surface}: dense field ${who} is ${h} px (< ${compactH})`);
      } else if (Math.abs(h - controlH) > 0.5) out.push(`${surface}: field ${who} is ${h} px (≠ ${controlH})`);
    }
    // An md button follows its area's density too (a table row's actions
    // are compact); the strip keeps its own button sizes until D6.
    for (const b of el.querySelectorAll<HTMLElement>("button.b.md")) {
      if (!shown(b) || !b.closest(".sidePane, .dialog")) continue;
      const want = b.closest(".dataTable") ? compactH : controlH;
      const h = Math.round(b.getBoundingClientRect().height * 10) / 10;
      if (Math.abs(h - want) > 0.5) out.push(`${surface}: md button "${b.textContent!.trim().slice(0, 20)}" is ${h} px (≠ ${want})`);
    }
    return out;
  }, surface));
  return { problems, fields: count };
}

for (const touch of [false, true]) {
  const density = touch ? "touch" : "desktop";
  test(`${density}: every field is named, every label labels a control, one density is one height`, async ({ page }) => {
    await ready(page, touch, "mm", SETTINGS);
    const problems: string[] = [];
    let fields = 0;
    const add = (r: Found) => { problems.push(...r.problems); fields += r.fields; };
    add(await scan(page, "strip", ".strip"));
    for (const tab of ["Program", "MDI", "Offsets", "Tools"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      if (tab === "Tools") {
        await expect.poll(async () => {
          await ctl({ op: "raw", frame: { type: "reply", cmd: "get_tool_table", ok: true, tools: [TOOL] } });
          return page.getByTitle("Edit tool", { exact: true }).count();
        }).toBe(1);
      }
      add(await scan(page, tab, ".sidePane"));
    }
    await page.getByRole("tab", { name: "Probing", exact: true }).click();
    for (const view of PROBE_VIEWS) {
      await page.getByRole("tab", { name: view, exact: true }).click();
      await expect(page.getByRole("tab", { name: view, exact: true })).toHaveAttribute("aria-selected", "true");
      add(await scan(page, `Probing/${view}`, ".sidePane"));
    }
    await page.getByTitle("G-code Reference", { exact: true }).click();
    add(await scan(page, "G-code Reference", '[role="dialog"]'));
    await page.getByRole("button", { name: "Close reference", exact: true }).click();

    // The tool editor (K04) and the import preview.
    await page.getByRole("tab", { name: "Tools", exact: true }).click();
    await page.getByTitle("Edit tool", { exact: true }).click();
    add(await scan(page, "Tool editor", '[role="dialog"]'));
    await page.locator('[role="dialog"]').getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await page.route("**/import-tool-library", route => route.fulfill({ json: {
      ok: true, tools: [{ ...TOOL, T: 1 }], total: 1, existing_count: 3, skipped_duplicates: [],
      metadata_refresh: { rows: [], updated: [], skipped: [], revision: "r1" } } }));
    await page.locator('input[type="file"][accept*=".fctb"]').setInputFiles(
      { name: "tools.json", mimeType: "application/json", buffer: Buffer.from('{"data":[]}') });
    add(await scan(page, "Import preview", '[role="dialog"]'));
    await page.locator('[role="dialog"]').getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // The macro parameters.
    await page.locator(".macroBar").getByRole("button", { name: "Face Top", exact: true }).click();
    add(await scan(page, "Macro parameters", '[role="dialog"]'));
    await page.locator('[role="dialog"]').getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // Every Settings section, the macro editor open.
    await page.getByTitle("Settings", { exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    for (const tab of SETTINGS_TABS) {
      await settings.getByRole("tab", { name: tab, exact: true }).click();
      await expect(settings.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
      if (tab === "Macros") await settings.getByRole("button", { name: "Add Macro", exact: true }).click();
      add(await scan(page, `Settings/${tab}`, '[role="dialog"]'));
    }
    expect(problems, problems.join("\n")).toEqual([]);
    // The scan saw the forms it guards (a broken surface must not pass empty).
    expect(fields).toBeGreaterThan(250);
  });
}

test("a probe field carries its unit — the machine's linear unit, in its description and its keypad readout", async ({ page }) => {
  await ready(page, false);
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  const slow = page.getByRole("textbox", { name: "Slow Feed", exact: true });
  await expect(slow).toHaveAccessibleDescription("mm/min");
  await expect(page.getByRole("textbox", { name: "Max Z Travel", exact: true })).toHaveAccessibleDescription("mm");
  await expect(page.getByRole("textbox", { name: "Probe Tool #", exact: true })).toHaveAccessibleDescription("");
  // A label tap is a tap on its field: the keypad opens, the unit in the readout.
  await page.locator("label", { hasText: /^Slow Feed$/ }).click();
  const pad = page.locator(".nkStrip");
  await expect(pad).toBeVisible();
  await expect(pad).toContainText("Slow Feed · mm/min");
  await pad.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(pad).toHaveCount(0);

  // An inch machine: the same fields read in and in/min — a unit follows its source.
  await ctl({ op: "setViewerInit", data: viewerInit("in") });
  await expect(slow).toHaveAccessibleDescription("in/min");
  await expect(page.getByRole("textbox", { name: "Max Z Travel", exact: true })).toHaveAccessibleDescription("in");
  await page.getByRole("tab", { name: "Toolsetter", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Spindle Zero Height", exact: true })).toHaveAccessibleDescription("in");
  await expect(page.getByRole("textbox", { name: "Offset", exact: true })).toHaveAccessibleDescription("%");
  // A count takes whole numbers only (UI-11): the keypad refuses 2.5 retries.
  await page.getByRole("textbox", { name: "Extra Retries", exact: true }).click();
  await expect(pad).toBeVisible();
  await pad.getByRole("button", { name: "2", exact: true }).click();
  await pad.getByRole("button", { name: ".", exact: true }).click();
  await pad.getByRole("button", { name: "5", exact: true }).click();
  await expect(pad.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await pad.getByRole("button", { name: "Discard", exact: true }).click();
});

test("a reset sits at the end of its section, right, and its confirm keeps its button's gate", async ({ page }) => {
  // UI-N65: one place, one confirm, the action's own gate. The toolsetter's
  // confirm used to sit on `safety` and the calibration's on `ready` —
  // looser than their buttons (setup / probe): a Reset stayed available in
  // an open confirm after the machine had closed the button's class.
  await ready(page, false);
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  await page.getByRole("tab", { name: "Toolsetter", exact: true }).click();
  const reset = page.getByRole("button", { name: "Reset Toolsetter", exact: true });
  const [b, form] = [await reset.boundingBox(), await page.locator(".tsPanel").boundingBox()];
  expect(Math.abs(b!.x + b!.width - (form!.x + form!.width)), "right edge of its section").toBeLessThan(1.5);
  await reset.click();
  const ask = page.getByRole("dialog", { name: "Reset Toolsetter settings?", exact: true });
  await expect(ask.getByRole("button", { name: "Reset", exact: true })).toBeEnabled();
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, setup: false } } });
  await expect(ask.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
  await expect(ask.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();
  await ask.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(ask).toHaveCount(0);

  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL } });
  await page.getByRole("tab", { name: "Calibrate", exact: true }).click();
  await page.getByRole("button", { name: "Reset Calibration", exact: true }).click();
  const cal = page.getByRole("dialog", { name: "Reset probe calibration?", exact: true });
  await expect(cal.getByRole("button", { name: "Reset", exact: true })).toBeEnabled();
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, probe: false } } });
  await expect(cal.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
  await cal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(cal).toHaveCount(0);
});

test("list editors: one row-action look, action before binding, gamepad inversion from the machine's axes", async ({ page }) => {
  await ready(page, false, "mm", { gamepad: { jogEnabled: true, buttonsEnabled: true }, keyboard: { jogEnabled: true, buttonsEnabled: true } });
  // The tool table's pencil / Trash2 (UI-N67): named for their target, the
  // same look as every other list row's actions.
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect.poll(async () => {
    await ctl({ op: "raw", frame: { type: "reply", cmd: "get_tool_table", ok: true, tools: [TOOL, { ...TOOL, T: 7, P: 7 }] } });
    return page.getByRole("button", { name: "Edit T7", exact: true }).count();
  }).toBe(1);
  const edit = page.getByRole("button", { name: "Edit T7", exact: true });
  const del = page.getByRole("button", { name: "Delete T7", exact: true });
  const look = (b: typeof edit) => b.evaluate(e => [...e.classList].filter(c => !c.startsWith("data-")).sort().join(" "));
  expect(await look(del)).toBe(await look(edit));

  // Both binding tables read Action | binding (UI-N68).
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const firstRow = () => settings.locator('[role="tabpanel"]:visible tbody tr').first().locator("td");
  await settings.getByRole("tab", { name: "Keyboard", exact: true }).click();
  await expect(firstRow().first()).toHaveText(/^Jog /);
  await expect(firstRow().nth(1)).toHaveClass(/kbKeyCell/);
  await settings.getByRole("tab", { name: "Gamepad", exact: true }).click();
  await expect(firstRow().first()).toHaveText(/jog/);
  await expect(firstRow().nth(1)).toHaveText("Left Stick");
  const padRow = settings.locator('[role="tabpanel"]:visible tbody tr').filter({ has: page.getByRole("combobox") }).first().locator("td");
  await expect(padRow.first().getByRole("combobox")).toHaveCount(1);
  // Inversion per stick axis the machine has (UI-N70): XYZ, then an XZ lathe.
  const inverts = async () => (await settings.locator("label").filter({ hasText: /Invert [A-Z]/ }).allTextContents()).map(t => t.trim());
  await expect.poll(inverts).toEqual(["Invert X", "Invert Y", "Invert Z"]);
  await ctl({ op: "setViewerInit", data: { ...viewerInit("mm"), axes: ["X", "Z"] } });
  await expect.poll(inverts).toEqual(["Invert X", "Invert Z"]);
});

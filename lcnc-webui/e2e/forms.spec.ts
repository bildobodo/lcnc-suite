import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// Design wave D4 (UI-K03, K04, K10, plan WP-D4) — controls and forms:
//
//   - every visible field (input, select, textarea, slider, colour) has an
//     accessible name, and every visible <label> labels a control (no label
//     that only sits next to its field);
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

function viewerInit(linearUnits: string) {
  return { units: linearUnits, stl_base_url: "/machine/", parts: [], kinematics: [], axes: ["X", "Y", "Z"],
    machine_bounds: { origin: [0, 0, 0], size: [100, 100, 100] }, ini_config: { linear_units: linearUnits } };
}

async function ready(page: Page, touch: boolean, linearUnits = "mm") {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  if (touch) await page.evaluate(() => document.documentElement.classList.add("touch-device"));
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "setViewerInit", data: viewerInit(linearUnits) });
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: {} } });
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
    await ready(page, touch);
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
    expect(problems, problems.join("\n")).toEqual([]);
    // The scan saw the forms it guards (a broken surface must not pass empty).
    expect(fields).toBeGreaterThan(150);
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

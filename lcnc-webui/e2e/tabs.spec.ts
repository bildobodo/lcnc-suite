import { test, expect, type Page, type Locator } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// Design wave D3 (UI-K17, K12, plan WP-D3 / WP-DR) — the ONE tab
// navigation (TabNav.vue):
//
//   - `tablist` / `tab` / `tabpanel` with `aria-selected`, the panel named
//     by its tab, ONE Tab stop per list (the selected tab);
//   - MANUAL activation: the arrow keys move focus, Enter / Space select;
//     Left / Right in reading order (wrapping), Home / End to the ends,
//     Up / Down a grid row (Probing's 4 × 2);
//   - every navigation key is the list's own: with keyboard jog on and the
//     arrows / Home / End mapped to jog, a focused tab sends NOTHING (the
//     same keys on an unfocused page jog — the control case);
//   - a tab switch is never a machine action, but a jog still running
//     stops;
//   - a hidden panel is not focusable;
//   - narrow (the side pane below 400 px): two labelled selects.
//
// Runs under `serial-guards`: mock-global state, one file at a time.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};
const READ_ONLY_CMDS = ["hello", "heartbeat", "get_tool_table", "halshow_live", "timing_log",
                        "tab_visibility", "save_settings", "load_file", "get_probe_results", "get_comp_grid"];
// Keyboard jog ON, the navigation keys bound to jog: a key a tab list failed
// to keep would move the machine.
const KEYBOARD = { keyboard: { jogEnabled: true, buttonsEnabled: true, mapping: {
  "jog_x+": "ArrowRight", "jog_x-": "ArrowLeft", "jog_y+": "ArrowUp", "jog_y-": "ArrowDown",
  "jog_z+": "Home", "jog_z-": "End", estop: "Escape", cycle: " ", abort: "Backspace",
} } };

async function cmds(): Promise<string[]> {
  const sent = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] };
  return (sent.cmds ?? []).map(c => c.cmd ?? "").filter(c => !READ_ONLY_CMDS.includes(c));
}
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}
async function ready(page: Page) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: KEYBOARD } });
  await expect(page.locator(".safetyStrip")).toBeVisible();
  await ctl({ op: "clearCmds" });
}
const selected = (list: Locator) => list.locator('[role="tab"][aria-selected="true"]');
const stops = (list: Locator) => list.locator('[role="tab"][tabindex="0"]');

test.afterEach(async () => {
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("tab semantics: tablist, tab, tabpanel — one Tab stop, the panel named by its tab", async ({ page }) => {
  await ready(page);
  const side = page.getByRole("tablist", { name: "Side panel", exact: true });
  await expect(side.getByRole("tab")).toHaveText(["Program", "MDI", "Probing", "Offsets", "Tools"]);
  await expect(selected(side)).toHaveText("Program");
  await expect(stops(side), "one Tab stop: the selected tab").toHaveCount(1);
  await expect(stops(side)).toHaveText("Program");
  const panelId = await selected(side).getAttribute("aria-controls");
  const panel = page.locator(`#${panelId}`);
  await expect(panel).toHaveAttribute("role", "tabpanel");
  await expect(panel).toHaveAttribute("aria-labelledby", (await selected(side).getAttribute("id"))!);
  await expect(page.getByRole("tabpanel", { name: "Program", exact: true })).toBeVisible();

  await side.getByRole("tab", { name: "Probing", exact: true }).click();
  const probe = page.getByRole("tablist", { name: "Probing procedure", exact: true });
  await expect(probe.getByRole("tab")).toHaveCount(8);
  await expect(stops(probe)).toHaveCount(1);
  await expect(page.getByRole("tabpanel", { name: "Outside", exact: true })).toBeVisible();

  await page.getByTitle("Settings", { exact: true }).click();
  const sections = page.getByRole("tablist", { name: "Settings sections", exact: true });
  await expect(sections.getByRole("tab")).toHaveCount(8);
  await expect(stops(sections)).toHaveCount(1);
  await sections.getByRole("tab", { name: "HAL", exact: true }).click();
  const hal = page.getByRole("tablist", { name: "HAL view", exact: true });
  await expect(hal.getByRole("tab")).toHaveCount(3);
  await expect(selected(hal)).toHaveText(/^Pins/);
});

test("arrows move focus, Enter selects; every navigation key stays in the list — no jog", async ({ page }) => {
  await ready(page);
  const side = page.getByRole("tablist", { name: "Side panel", exact: true });
  const tab = (name: string) => side.getByRole("tab", { name, exact: true });

  // Control: the same key on an unfocused page jogs (the binding is live).
  await page.locator("body").click({ position: { x: 1, y: 1 } }).catch(() => {});
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down("ArrowRight");
  await expect.poll(cmds, "control: ArrowRight on an unfocused page jogs").toContain("jog_cont");
  await page.keyboard.up("ArrowRight");
  await expect.poll(cmds).toContain("jog_stop");
  await ctl({ op: "clearCmds" });

  await tab("Program").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab("MDI"), "ArrowRight moves focus").toBeFocused();
  await expect(selected(side), "…and selects nothing (manual activation)").toHaveText("Program");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(tab("Tools"), "ArrowLeft wraps from the first to the last").toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab("Program")).toBeFocused();
  await page.keyboard.press("End");
  await expect(tab("Tools")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowDown");
  await expect(tab("Tools"), "Up / Down do nothing in a single row").toBeFocused();
  await settle(page);
  expect(await cmds(), "no key on a focused tab reached the jog map").toEqual([]);

  await page.keyboard.press("Enter");
  await expect(selected(side)).toHaveText("Tools");
  await expect(stops(side)).toHaveText("Tools");
  await tab("Tools").focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press(" ");
  await expect(selected(side), "Space selects too").toHaveText("Offsets");
  await settle(page);
  expect(await cmds(), "selecting a tab is no machine action").toEqual([]);
});

test("Probing's 4 × 2 grid: Left / Right in reading order across rows, Up / Down change the row", async ({ page }) => {
  await ready(page);
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  const probe = page.getByRole("tablist", { name: "Probing procedure", exact: true });
  const tab = (name: string) => probe.getByRole("tab", { name, exact: true });
  await expect(probe.getByRole("tab")).toHaveText(
    ["Outside", "Inside", "Angle", "Boss/Pocket", "Ridge/Valley", "Surface", "Calibrate", "Toolsetter"]);
  // Two rows of four: the fifth tab starts the second row.
  const [first, fifth] = await Promise.all([tab("Outside").boundingBox(), tab("Ridge/Valley").boundingBox()]);
  expect(Math.round(fifth!.x), "Ridge/Valley starts row 2 under Outside").toBe(Math.round(first!.x));
  expect(fifth!.y).toBeGreaterThan(first!.y);

  await tab("Outside").focus();
  await page.keyboard.press("ArrowDown");
  await expect(tab("Ridge/Valley")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(tab("Ridge/Valley"), "no row below the last").toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(tab("Outside")).toBeFocused();
  await tab("Boss/Pocket").focus();
  await page.keyboard.press("ArrowRight");
  await expect(tab("Ridge/Valley"), "reading order runs on into row 2").toBeFocused();
  await page.keyboard.press("End");
  await expect(tab("Toolsetter")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tabpanel", { name: "Toolsetter", exact: true })).toBeVisible();
  await settle(page);
  expect(await cmds()).toEqual([]);
});

test("a tab switch sends nothing — but a jog still running stops", async ({ page }) => {
  await ready(page);
  const side = page.getByRole("tablist", { name: "Side panel", exact: true });
  for (const name of ["MDI", "Probing", "Offsets", "Tools", "Program"]) {
    await side.getByRole("tab", { name, exact: true }).click();
  }
  await settle(page);
  expect(await cmds(), "switching tabs").toEqual([]);

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down("ArrowRight");
  await expect.poll(cmds).toEqual(["jog_cont"]);
  await side.getByRole("tab", { name: "Offsets", exact: true }).click();
  await expect.poll(cmds, "the running jog stops at the switch").toContain("jog_stop");
  await page.keyboard.up("ArrowRight");
});

test("a hidden panel is not focusable", async ({ page }) => {
  await ready(page);
  const took = await page.evaluate(() => {
    const panel = [...document.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
      .find(p => getComputedStyle(p).display === "none" && p.querySelector("button, input"));
    const el = panel?.querySelector<HTMLElement>("button, input");
    if (!el) return "no hidden panel with a control";
    el.focus();
    return el === document.activeElement ? "took focus" : "refused";
  });
  expect(took, "a control in a hidden panel").toBe("refused");
  // Tab walks from the side pane's list into its visible panel only.
  await page.getByRole("tab", { name: "Program", exact: true }).focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    const inHidden = await page.evaluate(() => {
      const panel = document.activeElement?.closest('[role="tabpanel"]') as HTMLElement | null;
      return !!panel && getComputedStyle(panel).display === "none";
    });
    expect(inHidden, `Tab #${i + 1} landed in a hidden panel`).toBe(false);
  }
});

test("the Run-from-line spindle preset is one option group: Rev, Stop, Fwd", async ({ page }) => {
  await ready(page);
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { ...KEYBOARD, machine: { runFromLine: true } } } });
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: "(A)\nG0 X0\nG1 X10 F100\nM2\n" }));
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc" } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 901, file: "/A.ngc" } });
  await expect(page.locator(".codeLine").first()).toContainText("(A)");
  await page.locator(".codeLine").nth(2).click();
  await page.getByRole("button", { name: /^Start L\d+$/ }).click();
  const group = page.getByRole("radiogroup", { name: "Spindle preset", exact: true });
  await expect(group.getByRole("radio")).toHaveCount(3);
  const names = await group.locator("label").allTextContents();
  expect(names.map(n => n.trim())).toEqual(["Rev", "Stop", "Fwd"]);
});

test("narrow side pane (150 % portrait): the area and the procedure are two labelled selects on one row", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1200 });
  await ready(page);
  await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
  const area = page.getByRole("combobox", { name: "Side panel", exact: true });
  await expect(area).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Side panel", exact: true })).toHaveCount(0);
  await area.selectOption("probe");
  const procedure = page.getByRole("combobox", { name: "Probing procedure", exact: true });
  await expect(procedure).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Probing procedure", exact: true })).toHaveCount(0);
  const [a, p] = await Promise.all([area.boundingBox(), procedure.boundingBox()]);
  expect(Math.abs(a!.y - p!.y), "one row").toBeLessThan(2);
  await procedure.selectOption("angle");
  await expect(page.getByRole("tabpanel", { name: "Angle", exact: true })).toBeVisible();
  // Back to full width: the lists return with the same selection.
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  const probe = page.getByRole("tablist", { name: "Probing procedure", exact: true });
  await expect(probe).toBeVisible();
  await expect(selected(probe)).toHaveText("Angle");
  await settle(page);
  expect(await cmds()).toEqual([]);
});

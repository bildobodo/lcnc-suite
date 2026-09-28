import { test, expect, type Page } from "@playwright/test";
import { ctl } from "./ctl";
import { PROFILES, VIEWPORTS, openLayout, settleLayout } from "./layout-fixtures";

// The strip's choice groups (operator point P7, Codex R21–R24): task mode,
// kinematics frame and work offset send machine commands — radios IN A
// TOOLBAR, manual activation: the arrows only move focus (never a jog: a
// button is no INPUT, the shortcut map's tag guard does not cover it — the
// group default-prevents every navigation key, with a modifier too), click /
// Enter / Space choose, the checked option is the CONFIRMED state and a
// requested one is "pending" until the status confirms it or for 5 s. The
// step increment is local: a row (the arrows choose) only with few, short
// options, else a labelled select.
//
// Runs under `serial-guards`: mock-global state (status, command log).

const TWP = PROFILES.find(p => p.name === "6axis-twp")!;
const DESKTOP = VIEWPORTS.find(v => v.name === "desktop")!;
const NAV = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End",
  "Control+ArrowRight", "Alt+ArrowLeft", "Meta+ArrowDown", "Shift+ArrowUp"];

const sent = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; [k: string]: unknown }[])
  .filter(c => !["hello", "arm", "client_diag", "tab_visibility", "get_tool_table", "heartbeat"].includes(c.cmd));
const group = (page: Page, name: string) => page.getByRole("radiogroup", { name, exact: true });
const option = (page: Page, g: string, name: string) => group(page, g).getByRole("radio", { name, exact: true });

async function open(page: Page) {
  await openLayout(page, TWP, DESKTOP);
  await settleLayout(page);
  await ctl({ op: "clearCmds" });
}

test("the machine groups: the arrows only move focus — no jog, no command; Enter and Space choose exactly once", async ({ page }) => {
  await open(page);
  const cases = [
    { g: "Task mode", from: "Manual", to: "MDI", key: "Enter", want: { cmd: "set_mode", mode: 3 } },
    { g: "Kinematics frame", from: "Machine", to: "TCP", key: "Space", want: { cmd: "set_kins_mode", mode: 1 } },
    { g: "Work offset", from: "G54", to: "G55", key: "Enter", want: { cmd: "mdi", text: "G55" } },
  ];
  for (const c of cases) {
    await option(page, c.g, c.from).focus();
    await ctl({ op: "clearCmds" });
    for (const key of NAV) await page.keyboard.press(key);
    expect(await sent(), `${c.g}: the arrows sent nothing (no jog, no choice)`).toEqual([]);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("role"));
    expect(focused, `${c.g}: focus stays in the group`).toBe("radio");
    // the previous group's busy latch (fire(), 200 ms): pressed inside it,
    // an option explains "Busy" instead of choosing — the product's rule
    await expect(option(page, c.g, c.to)).not.toHaveAttribute("aria-disabled", "true");
    await option(page, c.g, c.to).focus();
    await page.keyboard.press(c.key);
    await expect.poll(async () => (await sent()).length, `${c.g}: a command`).toBeGreaterThan(0);
    await page.waitForTimeout(300);   // a second one would land within the latch
    const cmds = await sent();
    expect(cmds.length, `${c.g}: one command`).toBe(1);
    expect(cmds[0], c.g).toMatchObject(c.want);
  }
});

test("one Tab stop per group, kept where the operator left it; a status change never pulls focus back", async ({ page }) => {
  await open(page);
  const mode = group(page, "Task mode");
  expect(await mode.getByRole("radio").evaluateAll(els => els.map(e => e.getAttribute("tabindex")))).toEqual(["0", "-1", "-1"]);
  await option(page, "Task mode", "Manual").focus();
  await page.keyboard.press("ArrowRight");
  await expect(option(page, "Task mode", "MDI")).toBeFocused();
  await ctl({ op: "status_delta", data: { task_mode: 2 } });           // the machine switched to Auto
  await expect(option(page, "Task mode", "Auto")).toHaveAttribute("aria-checked", "true");
  await expect(option(page, "Task mode", "MDI"), "focus stays where the operator left it").toBeFocused();
});

test("a requested choice is pending until the machine confirms it, and 'not confirmed' after 5 s", async ({ page }) => {
  await open(page);
  const mdi = option(page, "Task mode", "MDI");
  await mdi.focus();
  await page.keyboard.press("Enter");
  await expect(mdi).toHaveAttribute("aria-busy", "true");
  await expect(mdi, "the checked option stays the confirmed state").toHaveAttribute("aria-checked", "false");
  await ctl({ op: "status_delta", data: { task_mode: 3 } });
  await expect(mdi).toHaveAttribute("aria-checked", "true");
  await expect(mdi).not.toHaveAttribute("aria-busy", "true");
  const auto = option(page, "Task mode", "Auto");
  // the MDI choice's busy latch (fire(), 200 ms): pressed inside it, the
  // option explains "Busy" instead of choosing — the product's rule
  await expect(auto).not.toHaveAttribute("aria-disabled", "true");
  await auto.focus();
  await page.keyboard.press("Enter");
  await expect(auto).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".btnHint")).toHaveText("Not confirmed — the machine shows MDI", { timeout: 7000 });
  await expect(auto).not.toHaveAttribute("aria-busy", "true");
  await expect(auto).toHaveAttribute("aria-checked", "false");
});

test("a reserved work offset stays focusable and explains itself where it is pressed — nothing is sent", async ({ page }) => {
  await open(page);
  const g59 = option(page, "Work offset", "G59");
  await expect(g59).toHaveAttribute("aria-disabled", "true");
  await g59.click({ force: true });   // aria-disabled: Playwright would wait; a user clicks
  await expect(page.locator(".btnHint")).toHaveText("Reserved for the tilted work plane — use G54–G58");
  await option(page, "Work offset", "G54").focus();
  await page.keyboard.press("ArrowRight");                            // G54 → G59 (the other column)
  await expect(g59).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.locator(".btnHint")).toHaveText("Reserved for the tilted work plane — use G54–G58");
  expect(await sent()).toEqual([]);
});

test("portrait: the work offsets are 3 × 3 by row — width is fixed there, height the price; the arrows follow the rows", async ({ page }) => {
  await openLayout(page, TWP, VIEWPORTS.find(v => v.name === "touch-portrait")!);
  await settleLayout(page);
  await ctl({ op: "clearCmds" });
  const tops = await group(page, "Work offset").getByRole("radio").evaluateAll(els =>
    els.map(e => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size, `rows: ${tops.join(", ")}`).toBe(3);
  expect(tops.slice(0, 3).every(t => t === tops[0]), "G54 G55 G56 share the first row").toBe(true);
  await option(page, "Work offset", "G54").focus();
  await page.keyboard.press("ArrowRight");
  await expect(option(page, "Work offset", "G55")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(option(page, "Work offset", "G58")).toBeFocused();
  expect(await sent()).toEqual([]);
});

test("the step: a row only with few, short options (the arrows choose, locally); nine, long or inch values are a select", async ({ page }) => {
  await open(page);
  await ctl({ op: "setIncrements", increments: [1, 10] });
  const row = group(page, "Jog step");
  await expect(row.getByRole("radio")).toHaveCount(3);
  await option(page, "Jog step", "Cont").focus();
  await page.keyboard.press("ArrowRight");
  await expect(option(page, "Jog step", "1")).toHaveAttribute("aria-checked", "true");
  expect(await sent(), "a local setting: nothing sent").toEqual([]);
  for (const increments of [[0.001, 0.01, 0.1, 1, 10, 100, 1000, 5000], [0.000001, 0.000002, 0.000003, 0.000004, 0.000005], [0.0001, 0.001, 0.01, 0.1]]) {
    await ctl({ op: "setIncrements", increments });
    await expect(page.getByRole("combobox", { name: "Jog step", exact: true }), String(increments)).toBeVisible();
    await expect(group(page, "Jog step")).toHaveCount(0);
  }
});

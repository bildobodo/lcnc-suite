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

// Codex R25 OP-I04: a refusal of THIS request ends its pending at once and
// says why at the option; the confirmed state stays checked.
test("a refused choice ends its pending at once and explains itself at the option — mode, frame, work offset", async ({ page }) => {
  await open(page);
  const cases = [
    { g: "Task mode", to: "MDI", cmd: "set_mode", error: "R25: controller refused this mode" },
    { g: "Kinematics frame", to: "TCP", cmd: "set_kins_mode", error: "R25: kinematics switch refused" },
    { g: "Work offset", to: "G55", cmd: "mdi", error: "R25: fixture switch refused" },
  ];
  for (const c of cases) {
    await ctl({ op: "replies", replies: { [c.cmd]: { ok: false, error: c.error } } });
    const opt = option(page, c.g, c.to);
    await expect(opt).not.toHaveAttribute("aria-disabled", "true");   // past the previous latch
    await opt.click();
    await expect(page.locator(".btnHint"), c.g).toHaveText(c.error, { timeout: 2000 });
    await expect(opt, `${c.g}: no longer pending`).not.toHaveAttribute("aria-busy", "true", { timeout: 1000 });
    await expect(opt, `${c.g}: the confirmed state stays checked`).toHaveAttribute("aria-checked", "false");
  }
  await ctl({ op: "replies", replies: {} });
});

test("an older request's refusal never cancels a newer choice", async ({ page }) => {
  await open(page);
  const mdi = option(page, "Task mode", "MDI"), auto = option(page, "Task mode", "Auto");
  await mdi.click();                                   // no reply yet
  await expect(mdi).toHaveAttribute("aria-busy", "true");
  await expect(auto).not.toHaveAttribute("aria-disabled", "true");
  await auto.click();                                  // the newer choice
  await expect(auto).toHaveAttribute("aria-busy", "true");
  const modes = (await sent()).filter(c => c.cmd === "set_mode");
  expect(modes.map(c => c.mode)).toEqual([3, 2]);
  const refuse = (c: { cmd: string; req_id?: unknown }, error: string) =>
    ctl({ op: "raw", frame: { type: "reply", cmd: c.cmd, req_id: c.req_id, ok: false, error } });
  await refuse(modes[0]!, "R25: the older request refused");
  await page.waitForTimeout(300);
  await expect(auto, "the newer choice stays pending").toHaveAttribute("aria-busy", "true");
  await refuse(modes[1]!, "R25: the newer request refused");
  await expect(page.locator(".btnHint")).toHaveText("R25: the newer request refused");
  await expect(auto).not.toHaveAttribute("aria-busy", "true");
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

// Codex R25 OP-I01 (P1): a display change of the step (row ↔ two rows ↔
// select) on a resize or new INI options must take the focus along — the
// select used to replace the focused row and leave BODY focused, and the
// next arrow jogged (jog_incr 0.001 in the mock). Keyboard jog is ON here.
const VP = (n: string) => VIEWPORTS.find(v => v.name === n)!;
const stepLayout = (page: Page) => page.locator(".stepBlock").evaluate(b =>
  b.querySelector("select") ? "select" : b.querySelector(".choiceGroup .grid") ? "grid" : "row");
const jogs = async () => (await sent()).filter(c => c.cmd.startsWith("jog"));
async function openJog(page: Page, vp: string) {
  await openLayout(page, TWP, VP(vp));
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { keyboard: { jogEnabled: true, buttonsEnabled: true } } } });
  await settleLayout(page);
  await ctl({ op: "clearCmds" });
}
const stepFocus = (page: Page) => page.evaluate(() => {
  const a = document.activeElement as HTMLElement | null;
  return a?.closest(".stepBlock") ? (a.tagName === "SELECT" ? "select" : a.getAttribute("role") ?? a.className) : a?.tagName ?? null;
});

test("the step keeps its focus through every display change; the next arrow stays local", async ({ page }) => {
  // portrait row → landscape on touch: the select (TWP: no height for two rows)
  await openJog(page, "touch-portrait");
  expect(await stepLayout(page)).toBe("row");
  await option(page, "Jog step", ".001").focus();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(() => stepLayout(page)).toBe("select");
  expect(await stepFocus(page), "row → select").toBe("select");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  expect(await jogs(), "no jog from the arrow").toEqual([]);
  // desktop: two rows → many INI steps (select) → few again (two rows)
  await openJog(page, "desktop");
  expect(await stepLayout(page)).toBe("grid");
  await option(page, "Jog step", ".01").focus();
  await ctl({ op: "setIncrements", increments: [0.001, 0.01, 0.1, 1, 10, 100, 1000, 5000] });
  await expect.poll(() => stepLayout(page)).toBe("select");
  expect(await stepFocus(page), "two rows → select").toBe("select");
  await ctl({ op: "setIncrements", increments: [0.001, 0.01, 0.1, 1] });
  await expect.poll(() => stepLayout(page)).toBe("grid");
  expect(await stepFocus(page), "select → two rows").toBe("radio");
  for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft"]) await page.keyboard.press(key);
  await page.waitForTimeout(300);
  expect(await jogs(), "no jog from the arrows").toEqual([]);
  // portrait row ↔ desktop two rows: the same group, the same focused option
  await openJog(page, "touch-portrait");
  await page.evaluate(() => document.documentElement.classList.remove("touch-device"));   // a desktop, upright
  await expect.poll(() => stepLayout(page)).toBe("row");
  await option(page, "Jog step", ".1").focus();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await expect.poll(() => stepLayout(page)).toBe("grid");
  await expect(option(page, "Jog step", ".1"), "row → two rows").toBeFocused();
});

test("the step never changes its display under a held pointer — it follows on release", async ({ page }) => {
  await openJog(page, "desktop");
  expect(await stepLayout(page)).toBe("grid");
  const box = (await option(page, "Jog step", ".1").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await ctl({ op: "setIncrements", increments: [0.001, 0.01, 0.1, 1, 10, 100, 1000, 5000] });
  await page.waitForTimeout(400);
  expect(await stepLayout(page), "held: the display waits").toBe("grid");
  await page.mouse.up();
  await expect.poll(() => stepLayout(page)).toBe("select");
  expect(await jogs()).toEqual([]);
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

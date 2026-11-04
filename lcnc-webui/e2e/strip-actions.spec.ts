import { test, expect, type Page, type Locator } from "./test";
import { ctl } from "./ctl";
import { PROFILES, VIEWPORTS, openLayout, setLayoutState, settleLayout } from "./layout-fixtures";

// What the strip's machine controls send (the function inventory's open
// statements, test strategy step 2): a slider sends its own factor, the
// coolant and the program switches their value against the REPORTED state
// (the display follows the status, never the click), the spindle its
// preselected speed on a hold, ± a command only while it turns, Home All on
// a hold. A tap on a hold control sends nothing.
//
// The worker's own mock (e2e/test.ts): its state is this test's alone, reset
// and checked before every test.

const DESKTOP = VIEWPORTS.find(v => v.name === "desktop")!;
const XYZ = PROFILES[0]!;
const QUIET = ["hello", "arm", "client_diag", "tab_visibility", "get_tool_table", "heartbeat", "save_settings"];
type Cmd = { cmd: string; [k: string]: unknown };
// what the command says — its transport id (req_id) is no part of it
const sent = async (): Promise<Cmd[]> => ((await ctl({ op: "lastCmds" })).cmds as Cmd[])
  .filter(c => !QUIET.includes(c.cmd)).map(({ req_id: _, ...c }) => c as Cmd);
const strip = (page: Page, name: string) => page.locator(`[data-strip="${name}"]`);

async function open(page: Page, status: Record<string, unknown> = {}) {
  await openLayout(page, XYZ, DESKTOP);
  if (Object.keys(status).length) await ctl({ op: "status_delta", data: status });
  await settleLayout(page);
  await ctl({ op: "clearCmds" });
}

/** Press with the mouse for `ms`, then release — a tap or a hold (HOLD_FIRE_MS 500). */
async function press(page: Page, target: Locator, ms: number) {
  await expect(target).toBeEnabled();
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}
const HOLD_MS = 700, TAP_MS = 80;

test("each override slider sends its own factor; its 100 % button sends 1.0", async ({ page }) => {
  await open(page, { feed_override: 1, feed_override_enabled: true, spindle_override: 1,
    spindle_override_enabled: true, rapid_override: 1 });
  const cases = [
    { name: "Feed", cmd: "set_feed_override", to: "50", scale: 0.5 },
    { name: "Spindle", cmd: "set_spindle_override", to: "75", scale: 0.75 },
    { name: "Rapid", cmd: "set_rapid_override", to: "50", scale: 0.5 },
  ];
  for (const c of cases) {
    await ctl({ op: "clearCmds" });
    const slider = strip(page, "overrides").getByRole("slider", { name: `${c.name} override`, exact: true });
    await expect(slider, c.name).toBeEnabled();
    await slider.fill(c.to);
    await expect.poll(sent, c.name).toEqual([expect.objectContaining({ cmd: c.cmd, scale: c.scale })]);
    await ctl({ op: "clearCmds" });
    await strip(page, "overrides").getByRole("button", { name: `Reset ${c.name.toLowerCase()} override to 100 %`, exact: true }).click();
    await expect.poll(sent, `${c.name}: 100 %`).toEqual([expect.objectContaining({ cmd: c.cmd, scale: 1 })]);
  }
});

test("Flood and Mist send on against the reported off, off against the reported on — the switch shows the status", async ({ page }) => {
  await open(page, { flood: false, mist: false });
  for (const [name, field] of [["Flood", "flood"], ["Mist", "mist"]] as const) {
    const sw = strip(page, "spindle").getByRole("checkbox", { name, exact: true });
    await expect(sw, name).not.toBeChecked();
    await expect(sw).toBeEnabled();
    await sw.click();
    await expect.poll(sent, `${name}: on`).toEqual([{ cmd: `${field}_on` }]);
    await expect(sw, `${name}: not on before the status says so`).not.toBeChecked();
    await ctl({ op: "status_delta", data: { [field]: true } });
    await expect(sw, `${name}: on once reported`).toBeChecked();
    await ctl({ op: "clearCmds" });
    await expect(sw).toBeEnabled();
    await sw.click();
    await expect.poll(sent, `${name}: off`).toEqual([{ cmd: `${field}_off` }]);
    await expect(sw, `${name}: still on until reported`).toBeChecked();
    await ctl({ op: "status_delta", data: { [field]: false } });
    await expect(sw).not.toBeChecked();
    await ctl({ op: "clearCmds" });
  }
});

test("M01 and /BD send the opposite of the reported switch; the switch shows the status", async ({ page }) => {
  await open(page, { optional_stop: false, block_delete: true });
  const program = page.locator(".sidePane");
  const trigger = program.getByRole("button", { name: /^More program actions/ });
  await trigger.click();
  const panel = page.locator(`[id="${await trigger.getAttribute("aria-controls")}"]`);
  const m01 = panel.getByRole("checkbox", { name: "M01", exact: true });
  const bd = panel.getByRole("checkbox", { name: "/BD", exact: true });
  await expect(m01).not.toBeChecked();
  await expect(bd).toBeChecked();
  await m01.click();
  await expect.poll(sent).toEqual([{ cmd: "set_optional_stop", value: true }]);
  await expect(m01, "not on before the status says so").not.toBeChecked();
  await ctl({ op: "clearCmds" });
  await bd.click();
  await expect.poll(sent).toEqual([{ cmd: "set_block_delete", value: false }]);
  await expect(bd, "still on until reported").toBeChecked();
  await ctl({ op: "status_delta", data: { optional_stop: true, block_delete: false } });
  await expect(m01).toBeChecked();
  await expect(bd).not.toBeChecked();
});

test("Fwd and Rev send the preselected speed on a hold — a tap sends nothing", async ({ page }) => {
  await open(page, { spindle_direction: 0 });
  const sp = strip(page, "spindle");
  const fwd = sp.getByRole("button", { name: "Fwd", exact: true });
  const rev = sp.getByRole("button", { name: "Rev", exact: true });
  await expect(sp.locator("input.spRpmInput")).toHaveValue("1000");
  await press(page, fwd, TAP_MS);
  await press(page, rev, TAP_MS);
  await page.waitForTimeout(300);
  expect(await sent(), "a tap sends nothing").toEqual([]);
  await press(page, fwd, HOLD_MS);
  await expect.poll(sent).toEqual([{ cmd: "spindle_forward", speed: 1000 }]);
  await ctl({ op: "clearCmds" });
  await press(page, rev, HOLD_MS);
  await expect.poll(sent).toEqual([{ cmd: "spindle_reverse", speed: 1000 }]);
});

test("± move the preselection while the spindle stands, and send increase / decrease while it turns", async ({ page }) => {
  await open(page, { spindle_direction: 0 });
  const sp = strip(page, "spindle");
  const plus = sp.getByRole("button", { name: "Increase spindle speed", exact: true });
  const minus = sp.getByRole("button", { name: "Decrease spindle speed", exact: true });
  const rpm = sp.locator("input.spRpmInput");
  await plus.click();
  await expect(rpm, "standing: + raises the preselection by the increment").toHaveValue("1100");
  await minus.click();
  await minus.click();
  await expect(rpm).toHaveValue("900");
  expect(await sent(), "standing: nothing sent").toEqual([]);
  await ctl({ op: "status_delta", data: { spindle_direction: 1, spindle_speed: 900 } });
  await expect(sp.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await plus.click();
  await expect.poll(sent).toEqual([{ cmd: "spindle_increase" }]);
  await ctl({ op: "clearCmds" });
  await expect(minus).toBeEnabled();
  await minus.click();
  await expect.poll(sent).toEqual([{ cmd: "spindle_decrease" }]);
});

test("Home All sends home_all on a hold — a tap sends nothing", async ({ page }) => {
  await open(page);
  await setLayoutState(page, XYZ, "unhomed");
  await ctl({ op: "clearCmds" });
  const home = strip(page, "setup").getByRole("button", { name: "Home All", exact: true });
  await press(page, home, TAP_MS);
  await page.waitForTimeout(300);
  expect(await sent(), "a tap sends nothing").toEqual([]);
  await press(page, home, HOLD_MS);
  await expect.poll(sent).toEqual([{ cmd: "home_all" }]);
});

import { test, expect, type Page } from "./test";
import { ctl } from "./ctl";
import { PROFILES, VIEWPORTS, openLayout, settleLayout } from "./layout-fixtures";

// Surface compensation shows what the status reports (Codex R265, the function
// inventory's F-COMP S1/S2): an unread pin is "—", never OFF; an unread method
// checks nothing, never Cubic; a requested method is pending until the status
// shows it — the reported one stays checked, and "Not confirmed" after 5 s.

const DESKTOP = VIEWPORTS.find(v => v.name === "desktop")!;
const sent = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; [k: string]: unknown }[])
  .filter(c => c.cmd === "set_compensation_method" || c.cmd === "set_compensation");
// by role and name, as the operator meets them (a native radio or a choice)
const method = (page: Page, name: string) => page.locator(".sidePane").getByRole("radio", { name, exact: true });
const state = (page: Page) => page.locator("span", { hasText: /^Compensation:/ }).locator("b > span:not(.alt)");

async function open(page: Page, status: Record<string, unknown>) {
  await openLayout(page, PROFILES[0]!, DESKTOP);
  await settleLayout(page);
  const side = page.locator(".sidePane");
  await side.getByRole("tab", { name: "Probing", exact: true }).click();
  await side.getByRole("tab", { name: "Surface", exact: true }).click();
  await ctl({ op: "status_delta", data: status });
  await ctl({ op: "clearCmds" });
}

test("unread pins are never OFF or Cubic: the state reads —, no method is checked, the switch is not on", async ({ page }) => {
  await open(page, { eoffset_enabled: null, comp_method: null });
  await expect(state(page)).toHaveText("—");
  for (const m of ["Nearest", "Linear", "Cubic"]) await expect(method(page, m), m).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Enable Compensation" })).not.toBeChecked();
});

test("the reported state: ON with its method checked, OFF once the status says so", async ({ page }) => {
  await open(page, { eoffset_enabled: true, comp_method: 1 });
  await expect(state(page)).toHaveText("ON");
  await expect(method(page, "Linear")).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Enable Compensation" })).toBeChecked();
  await ctl({ op: "status_delta", data: { eoffset_enabled: false } });
  await expect(state(page)).toHaveText("OFF");
});

test("a chosen method is sent once and pending; the reported one stays checked, 'Not confirmed' after 5 s", async ({ page }) => {
  await open(page, { eoffset_enabled: false, comp_method: 1 });
  const cubic = method(page, "Cubic");
  await cubic.click();
  await expect.poll(sent).toEqual([expect.objectContaining({ cmd: "set_compensation_method", method: 2 })]);
  await expect(cubic, "not checked before the status shows it").not.toBeChecked();
  await expect(method(page, "Linear")).toBeChecked();
  await expect(cubic).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".btnHint")).toHaveText("Not confirmed — the machine shows Linear", { timeout: 7000 });
  await expect(cubic).not.toBeChecked();
  await expect(method(page, "Linear")).toBeChecked();
  // the status confirms a later choice
  await cubic.click();
  await ctl({ op: "status_delta", data: { comp_method: 2 } });
  await expect(cubic).toBeChecked();
  await expect(cubic).not.toHaveAttribute("aria-busy", "true");
});

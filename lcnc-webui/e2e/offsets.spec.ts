import { test, expect, type Page } from "@playwright/test";
import { ctl } from "./ctl";
import { PROFILES, VIEWPORTS, openLayout, setLayoutState, settleLayout } from "./layout-fixtures";

// The Offsets panel's contract (operator points P5/P6, Codex R21–R23):
// - the auxiliary rows read each axis from its CANONICAL slot (on XYZAC the C
//   column showed B's G92 — the visible column index was used);
// - unknown is never zero: one summary line says "nothing in effect" only
//   when every source is known, else names the unknown source;
// - a cell has a keyboard path (a value button), opens in DEGREES for A/C,
//   and only the cell being edited carries the edit mark;
// - a row click selects for Clear and never switches the machine's WCS.
//
// Runs under `serial-guards`: mock-global state (status, command log).

const XYZAC = PROFILES.find(p => p.name === "5axis-xyzac")!;
const canon = (o: Partial<Record<string, number>>) => "XYZABCUVW".split("").map(l => o[l] ?? 0);
const row = (name: string, o: Partial<Record<string, number>> = {}) =>
  ({ name, x: 0, y: 0, z: 0, a: 0, c: 0, r: 0, ...o });
const WCS = ["G54", "G55", "G56", "G57", "G58", "G59", "G59.1", "G59.2", "G59.3"].map(n => row(n, n === "G54" ? { x: 10, c: 45 } : {}));

async function openOffsets(page: Page, data: Record<string, unknown>) {
  await openLayout(page, XYZAC, VIEWPORTS.find(v => v.name === "desktop")!);
  await setLayoutState(page, XYZAC, "homed");
  await ctl({ op: "status_delta", data: { wcs_table: WCS, g5x_index: 1, ...data } });
  await page.locator(".sidePane").getByRole("tab", { name: "Offsets", exact: true }).click();
  await settleLayout(page);
  await ctl({ op: "clearCmds" });
}
const sent = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; [k: string]: unknown }[])
  .filter(c => !["hello", "arm", "client_diag", "tab_visibility", "get_tool_table", "heartbeat"].includes(c.cmd));
const cells = (page: Page, i: number) =>
  page.locator(".offsetPanel tbody tr.auxRow").nth(i).locator("td").allTextContents();

test("the auxiliary rows read each axis from its canonical slot — on XYZAC, C is not B", async ({ page }) => {
  await openOffsets(page, {
    g92_offset: canon({ X: 1, B: 5, C: 6 }), tool_offset: canon({ Z: 45.7, B: 7, C: 8 }),
    eoffset_enabled: false, eoffset_z: 0,
  });
  // columns: name, X, Y, Z, A, C, R
  expect((await cells(page, 0)).map(t => t.trim()), "G52/G92").toEqual(["G52/G92", "1.0000", "0.0000", "0.0000", "0.0000", "6.0000", ""]);
  expect((await cells(page, 1)).map(t => t.trim()), "Tool").toEqual(["Tool", "0.0000", "0.0000", "45.7000", "0.0000", "8.0000", ""]);
});

test("unknown is never zero: the summary names what is unknown, and says 'none' only when all is known", async ({ page }) => {
  await openOffsets(page, { g92_offset: canon({}), tool_offset: canon({}), eoffset_enabled: false, eoffset_z: 0 });
  const summary = page.locator(".offsetPanel .offsetSummary");
  await expect(summary).toHaveText("No G52/G92, tool or comp offset in effect");
  await expect(page.locator(".offsetPanel tr.auxRow")).toHaveCount(0);
  await ctl({ op: "status_delta", data: { eoffset_enabled: null } });
  await expect(summary, "an amount of 0 with an unknown enable proves nothing").toHaveText("Offset status unknown — comp");
  await ctl({ op: "status_delta", data: { eoffset_enabled: true, eoffset_z: 0 } });
  await expect(summary, "comp in effect at 0: its row, no summary").toHaveCount(0);
  expect((await cells(page, 0)).map(t => t.trim())).toEqual(["Comp", "", "", "0.0000", "", "", ""]);
  await ctl({ op: "status_delta", data: { eoffset_z: null } });
  await expect(summary, "enabled with no amount is unknown").toHaveText("Offset status unknown — comp");
  await ctl({ op: "status_delta", data: { eoffset_enabled: false, g92_offset: null } });
  await expect(summary).toHaveText("Offset status unknown — G52/G92");
});

test("a cell opens from the keyboard, in degrees for A/C, and only that cell carries the edit mark", async ({ page }) => {
  await openOffsets(page, { g92_offset: canon({}), tool_offset: canon({}), eoffset_enabled: false, eoffset_z: 0 });
  const edit = page.getByRole("button", { name: "Edit G54 C", exact: true });
  await edit.focus();
  await page.keyboard.press("Enter");
  const heading = page.locator(".nkStrip > .sub");
  await expect(heading).toHaveText("G54 · C · °");
  const marked = page.locator(".offsetPanel td.editingCell");
  await expect(marked).toHaveCount(1);
  await expect(marked.getByRole("button", { name: "Edit G54 C", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Close keyboard", exact: true }).click();
  await expect(marked).toHaveCount(0);
  await page.getByRole("button", { name: "Edit G54 X", exact: true }).click();
  await expect(heading).toHaveText("G54 · X · mm");
  expect(await sent(), "opening edits nothing").toEqual([]);
});

test("the active fixture is named, not only tinted; a row click selects for Clear and never switches the WCS", async ({ page }) => {
  await openOffsets(page, { g92_offset: canon({}), tool_offset: canon({}), eoffset_enabled: false, eoffset_z: 0 });
  const active = page.locator('.offsetPanel tbody tr[aria-current="true"]');
  await expect(active).toHaveCount(1);
  await expect(active.locator("td").first()).toHaveText("G54");
  await page.locator(".offsetPanel tbody tr", { hasText: "G55" }).locator("td").first().click();
  await expect(page.getByRole("button", { name: /^Clear G55/ })).toBeVisible();
  expect(await sent(), "selecting a row sends nothing").toEqual([]);
  await expect(active.locator("td").first(), "the machine's WCS stays").toHaveText("G54");
});

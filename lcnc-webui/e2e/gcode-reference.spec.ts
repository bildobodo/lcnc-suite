// The G-code reference (operator 2026-10-03, from the renders): as wide as
// Settings, nothing sideways — a narrow dialog stacks its rows as cards; the
// Safety strip's active codes are ONE button that opens it on "Active now"
// (variant B); a code tapped in the program opens it AT its entry (the whole
// list, the entry marked and in view) instead of searching for it.
import { test, expect, type Page } from "@playwright/test";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";
import { sidewaysOverflow } from "./layout-audit";

// The XYZAC sim's codes, read from LinuxCNC 2026-10-03 at idle
const GCODES = [9, 800, -1, 170, 400, 210, 900, 940, 540, 490, 980, 640, -1, 970, 911, 80, -1];
const MCODES = [9, -1, 5, -1, 9, -1, 48, -1, 53, 0];
const ACTIVE_KNOWN = ["G17", "G21", "G40", "G49", "G54", "G64", "G80", "G90", "G91.1", "G94", "G97", "G98",
  "M0", "M5", "M9", "M48", "M53"];
const PROGRAM = "G21 G90\nG01 X10 F100\nG10 L2 P1 X0\nG8 X1\nG64 P0.01\nM2\n";

async function setup(page: Page, vp = "desktop", zoom = 1) {
  await page.route("**/gcode?*", r => r.fulfill({ contentType: "text/plain", body: PROGRAM }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === vp)!);
  if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
  await ctl({ op: "status_delta", data: { gcodes: GCODES, mcodes: MCODES } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5, file: "/layout-example.ngc" } });
  await expect(page.locator(".codeLine").first()).toContainText("G21");
  await settleLayout(page);
}
const reference = (page: Page) => page.getByRole("dialog", { name: "G-code Reference", exact: true });
const codesBlock = (page: Page) => page.getByRole("button", { name: /^Active codes G80 G17 .* — open in the G-code reference$/ });
const shownCodes = (page: Page) => reference(page).locator("tbody td.refCode").allTextContents();
const close = (page: Page) => reference(page).getByRole("button", { name: "Close reference", exact: true }).click();

/** The marked rows: their codes, and whether the first lies wholly in the
 *  table's view below its sticky head. */
async function marked(page: Page) {
  return reference(page).locator(".refTable").evaluate(t => {
    const rows = [...t.querySelectorAll<HTMLElement>('tbody tr[aria-current="true"]')];
    const head = t.querySelector("thead")!.getBoundingClientRect(), box = t.getBoundingClientRect();
    const r = rows[0]?.getBoundingClientRect();
    return {
      codes: rows.map(x => x.querySelector(".refCode")!.textContent!.trim()),
      inView: !!r && r.top >= head.bottom - 0.5 && r.bottom <= box.bottom + 0.5,
    };
  });
}

test("the strip's active codes are one button that opens the reference on \"Active now\" — by pointer and by key, nothing sent", async ({ page }) => {
  await setup(page);
  await ctl({ op: "clearCmds" });
  const block = codesBlock(page);
  await expect(block).toContainText("G80 G17 G40 G21 G90 G94 G54 G49 G98 G64 G97 G91.1 G8");
  await expect(block).toContainText("M5 M9 M48 M53 M0");
  await block.click();
  const dialog = reference(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Filter by group" })).toHaveValue("__active");
  await expect.poll(() => shownCodes(page)).toEqual(ACTIVE_KNOWN);
  await expect(dialog.locator(".refFooter")).toHaveText(/17 codes\s+active now · not in the reference: G8/);
  expect(await sidewaysOverflow(dialog), "content past its box sideways").toEqual([]);
  await close(page);
  await expect(dialog).toBeHidden();
  await expect(block, "the guarded focus return lands on the block").toBeFocused();

  // by key: Enter on the focused block
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect.poll(() => shownCodes(page)).toEqual(ACTIVE_KNOWN);
  // the header button opens the whole reference, as before
  await close(page);
  await page.getByTitle("G-code Reference", { exact: true }).click();
  await expect(dialog.getByRole("combobox", { name: "Filter by group" })).toHaveValue("");
  expect((await shownCodes(page)).length).toBeGreaterThan(100);
  await close(page);
  const sent = (await ctl({ op: "lastCmds" })).cmds as { cmd: string }[];
  expect(sent.map(c => c.cmd).filter(c => !["heartbeat", "hello", "tab_visibility"].includes(c)), "opening the reference sends nothing").toEqual([]);
});

test("a code tapped in the program opens the reference AT its entry: marked, in view, the whole list; a word with no entry searches", async ({ page }) => {
  await setup(page);
  const token = (text: string) => page.locator(".codeLine .token-gcode", { hasText: new RegExp(`^${text}$`) }).first();
  const dialog = reference(page);
  const search = dialog.getByRole("textbox", { name: "Search G-code reference", exact: true });

  await token("G01").click();                       // G01 is G1
  await expect(dialog).toBeVisible();
  await expect.poll(() => marked(page)).toEqual({ codes: ["G1"], inView: true });
  await expect(search).toHaveValue("");
  expect((await shownCodes(page)).length, "the whole list, not a search").toBeGreaterThan(100);
  await close(page);

  await token("G64").click();                       // far down the list: scrolled to
  await expect.poll(() => marked(page)).toEqual({ codes: ["G64"], inView: true });
  await close(page);

  await token("G10").click();                       // every form it heads
  await expect.poll(() => marked(page)).toEqual({ codes: ["G10 L1", "G10 L2", "G10 L10", "G10 L11", "G10 L20"], inView: true });
  await close(page);

  await token("G8").click();                        // no entry: what a search for it finds
  await expect(search).toHaveValue("G8");
  expect((await marked(page)).codes).toEqual([]);
  await close(page);

  // the next plain open marks nothing
  await page.getByTitle("G-code Reference", { exact: true }).click();
  expect((await marked(page)).codes).toEqual([]);
  await close(page);
});

test("the reference is as wide as Settings; nothing sideways at 100 % and at 150 % portrait, where a row is a card under a sticky head", async ({ page }) => {
  await setup(page);
  const width = async (name: string) => page.getByRole("dialog", { name, exact: true }).evaluate(d => d.getBoundingClientRect().width);
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = await width("Settings");
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await codesBlock(page).click();
  expect(await width("G-code Reference")).toBeCloseTo(settings, 0);
  expect(settings).toBeCloseTo(760, 0);
  await reference(page).getByRole("combobox", { name: "Filter by group" }).selectOption("");
  expect(await sidewaysOverflow(reference(page)), "desktop: content past its box sideways").toEqual([]);
  await close(page);

  await setup(page, "touch-portrait", 1.5);
  await page.locator(".codeLine .token-gcode", { hasText: /^G01$/ }).first().click();
  const dialog = reference(page);
  await expect(dialog).toBeVisible();
  await settleLayout(page);
  expect(await sidewaysOverflow(dialog), "150 % portrait: content past its box sideways").toEqual([]);
  const card = await dialog.locator(".refTable").evaluate(t => {
    const row = t.querySelector<HTMLElement>('tbody tr[aria-current="true"]')!;
    const cell = (c: string) => row.querySelector<HTMLElement>(c)!.getBoundingClientRect();
    const code = cell(".colCode"), name = cell(".colName"), desc = cell(".colDesc"), syntax = cell(".colSyntax");
    const group = row.querySelector<HTMLElement>(".colGroup")!;
    return {
      display: getComputedStyle(row).display,
      nameBesideCode: Math.abs(name.top - code.top) < 2 && name.left > code.right,
      descBelow: desc.top >= code.bottom - 0.5 && syntax.top >= desc.bottom - 0.5,
      groupHidden: getComputedStyle(group).display === "none",
      headSticky: getComputedStyle(t.querySelector("thead")!).position,
    };
  });
  expect(card).toEqual({ display: "grid", nameBesideCode: true, descBelow: true, groupHidden: true, headSticky: "sticky" });
  await expect(dialog.getByRole("button", { name: /^Code/ })).toBeVisible();
  await expect.poll(() => marked(page)).toEqual({ codes: ["G1"], inView: true });
});

// The tool preview card never outlives its table (machine day F22, P4-3):
// the card is teleported to <body>, the Tools tab is v-show — a tab switch
// used to hide the table and leave the card floating over the next tab. It
// closes with the tab (also a hover still waiting for its 300 ms — Codex
// R433), on any press outside its row and on any scroll (it is placed from
// the row's rect).
import { test, expect } from "./test";
import { ctl, publishToolTable } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { installHoldClock, onPageClock } from "./holdClock";

const TOOLS = Array.from({ length: 40 }, (_, i) => i + 5)
  .map(T => ({ T, P: T, D: 6, Z: -40, type: "endmill", description: `Mill ${T}` }));

async function openTools(page: import("./test").Page, touch: boolean) {
  await openLayout(page, PROFILES[1]!, touch ? VIEWPORTS[2]! : VIEWPORTS[0]!);
  await publishToolTable(TOOLS);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(page.locator(".toolsTab").getByRole("button", { name: "Edit T5", exact: true })).toBeVisible();
}

const card = (page: import("./test").Page) => page.locator(".toolHoverPreview");
const tCell = (page: import("./test").Page, t: number) =>
  page.locator(".toolsTab tbody tr").filter({ has: page.getByRole("button", { name: `Edit T${t}`, exact: true }) }).locator("td.colT");

/** Switch the side tab by KEYBOARD — no press anywhere, the pointer stays
 *  over the hovered cell: only the tab's own close can end the card. */
async function leaveToolsByKeyboard(page: import("./test").Page) {
  const tools = page.getByRole("tab", { name: "Tools", exact: true });
  await tools.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(tools).toHaveAttribute("aria-selected", "false");
}

test("a hover card closes with its tab", async ({ page }) => {
  await openTools(page, false);
  await tCell(page, 5).hover();
  await expect(card(page)).toBeVisible();
  await leaveToolsByKeyboard(page);
  await expect(card(page), "the card left with the Tools tab").toHaveCount(0);
});

test("a hover still waiting for its 300 ms never opens after the tab was left", async ({ page }) => {
  await installHoldClock(page);
  await openTools(page, false);
  await onPageClock(page, async () => {
    await tCell(page, 6).hover();
    await page.clock.runFor(100);         // the timer is pending
    await expect(card(page)).toHaveCount(0);
    await leaveToolsByKeyboard(page);
    await page.clock.runFor(1_000);       // well past its 300 ms
    await expect(card(page), "the pending timer was cancelled with the tab").toHaveCount(0);
  });
});

test("a tapped card closes on a press outside its row and on a scroll", async ({ page }) => {
  await openTools(page, true);
  const row5 = page.locator(".toolsTab tbody tr").first();
  // the row's own tap pins it, a second tap on the row unpins it
  await row5.locator("td.colDesc").click();
  await expect(card(page)).toBeVisible();
  await row5.locator("td.colDesc").click();
  await expect(card(page)).toHaveCount(0);

  // a press outside the row closes it
  await row5.locator("td.colDesc").click();
  await expect(card(page)).toBeVisible();
  await page.locator(".panelObject").filter({ visible: true }).first().click();
  await expect(card(page), "a press outside the row").toHaveCount(0);

  // a scroll closes it (the card is placed from the row's rect)
  await row5.locator("td.colDesc").click();
  await expect(card(page)).toBeVisible();
  await page.locator(".toolsTab .tableWrap").evaluate(el => { el.scrollTop = 40; });
  await expect(card(page), "a scroll under the card").toHaveCount(0);

  // and with its tab (the table back at its top first: a row the click
  // scrolls into view would close its card by that scroll)
  await page.locator(".toolsTab .tableWrap").evaluate(el => { el.scrollTop = 0; });
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await row5.locator("td.colDesc").click();
  await expect(card(page)).toBeVisible();
  await leaveToolsByKeyboard(page);
  await expect(card(page), "the pinned card left with the tab").toHaveCount(0);
  await ctl({ op: "reset" });
});

test("the tab alone closes the card (no scroll, no press, no hover)", async ({ page }) => {
  // the other closes stay out: a tapped card (no hover — Chromium's hover
  // update after the layout would end a hover card by its mouseleave), and
  // every scroll stopped before the page sees it (a tab switch may scroll
  // the side pane) — only the tab's own close can end the card (the P4-3
  // mutation guard)
  await page.addInitScript(() => {
    window.addEventListener("scroll", e => e.stopImmediatePropagation(), true);
  });
  await openTools(page, true);
  await page.locator(".toolsTab tbody tr").first().locator("td.colDesc").click();
  await expect(card(page)).toBeVisible();
  await leaveToolsByKeyboard(page);
  await expect(card(page), "the card left with the Tools tab").toHaveCount(0);
});

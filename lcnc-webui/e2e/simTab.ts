// The side pane's Simulation tab (operator 2026-10-05): the findings list
// with its filter and steps moved there from the scrub bar's findings row.
// Specs reach the old per-kind steps ("Next collision", "Previous limit
// violation" …) by filtering the list to that kind.
import { expect, type Locator, type Page } from "@playwright/test";

export type SimKind = "all" | "clash" | "limit" | "tool";

/** Opens the Simulation tab — the tab, or the narrow pane's select. */
export async function openSimTab(page: Page): Promise<void> {
  const tab = page.getByRole("tab", { name: "Sim", exact: true });
  const select = page.getByRole("combobox", { name: "Side panel" });
  // one of the two is there once the pane is rendered — asked for, never
  // probed once (under load the one look came before the tab was back, and
  // the helper waited for the narrow pane's select: P6-d0 gate 1)
  await expect(tab.or(select).first()).toBeVisible();
  if (await tab.isVisible()) await tab.click();
  else await select.selectOption("sim");
  await expect(page.locator(".simPanel")).toBeVisible();
}

/** Opens the tab with its list filtered to one kind. */
export async function simShow(page: Page, kind: SimKind): Promise<void> {
  await openSimTab(page);
  await page.locator('.simPanel select[name="simFilter"]').selectOption(kind);
}

/** The step button of the shown kind, by its name. */
export const simStepBtn = (page: Page, name: string): Locator => page.locator(`.simPanel [aria-label="${name}"]`);

/** Where the simulation stands: the line readout ("L7", "L7 →", "entry"). */
export const simLine = (page: Page): Locator => page.locator(".simPanel .simLine");

/** One row of the list by its key (C…/E… a collision, L<line> a limit,
 *  T<line> a tool change). */
export const simRow = (page: Page, key: string): Locator => page.locator(`.simPanel [data-sim-row="${key}"]`);

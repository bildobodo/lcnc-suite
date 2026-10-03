// The "More" disclosure (MoreMenu.vue, operator 2026-10-02): a tab's
// management sits in a popover behind the More button at the right end of
// its action row. For a spec: open it (when closed) and press an item — the
// way an operator does.
import type { Locator } from "@playwright/test";

/** The More trigger inside `scope` (its name starts with "More"). */
export function moreTrigger(scope: Locator): Locator {
  return scope.getByRole("button", { name: /^More\b/ });
}

/** The item `name` of the More panel inside `scope`, the panel opened (by a
 *  tap in a touch spec). */
export async function moreItem(scope: Locator, name: string, how: "click" | "tap" = "click"): Promise<Locator> {
  const trigger = moreTrigger(scope);
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await (how === "tap" ? trigger.tap() : trigger.click());
  const panel = scope.page().locator(`[id="${await trigger.getAttribute("aria-controls")}"]`);
  return panel.getByRole("button", { name, exact: true });
}

/** Open More inside `scope` and press its item `name`. */
export async function clickMore(scope: Locator, name: string): Promise<void> {
  await (await moreItem(scope, name)).click();
}

/** The same by touch. */
export async function tapMore(scope: Locator, name: string): Promise<void> {
  await (await moreItem(scope, name, "tap")).tap();
}

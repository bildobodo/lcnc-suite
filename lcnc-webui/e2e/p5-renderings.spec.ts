import { test, expect, type Page } from "./test";
import { openLayout, PROFILES, settleLayout, VIEWPORTS, type LayoutViewport } from "./layout-fixtures";

// P5 PROTOTYPE — renderings for the operator (never merged). Every state the
// P5 plan proposes, set through the prototype's window.__p5set, shot at the
// machine panel's size (Full HD landscape, touch) and at a narrow side pane.
const OUT = process.env.P5_OUT ?? "/home/cnc/claude-work/p5/renderings";
const CAL = ["idle", "pending", "applied", "applied_saved", "discarded", "failed", "stale"] as const;
const FIELD = ["draft", "saved", "confirmed", "refused"] as const;
const FULLHD = VIEWPORTS.find(v => v.name === "touch-fullhd")!;
const NARROW: LayoutViewport = { name: "narrow", width: 900, height: 1200, touch: true };

async function openCal(page: Page, vp: LayoutViewport) {
  await openLayout(page, PROFILES[0]!, vp);
  // the narrow side pane: 150 % portrait, as the layout specs reach it
  if (vp.name === "narrow") {
    await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
    await settleLayout(page);
  }
  const side = page.locator(".sidePane");
  if (await side.getByRole("tab", { name: "Probing", exact: true }).isVisible()) {
    await side.getByRole("tab", { name: "Probing", exact: true }).click();
  } else {
    await side.getByRole("combobox", { name: "Side panel" }).selectOption({ label: "Probing" });
  }
  const calTab = side.getByRole("tab", { name: "Calibrate", exact: true });
  if (await calTab.isVisible()) await calTab.click();
  else await side.getByRole("combobox").nth(1).selectOption({ label: "Calibrate" });
  await expect(side.locator('[data-p5="cal"]')).toBeVisible();
  return side;
}

async function set(page: Page, st: Record<string, string>) {
  await page.evaluate((s) => (window as unknown as { __p5set: (x: unknown) => void }).__p5set(s), st);
  await page.waitForTimeout(100);
}

for (const vp of [FULLHD, NARROW]) {
  test(`P5 renderings at ${vp.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    const side = await openCal(page, vp);
    const narrow = await side.evaluate(el => el.classList.contains("narrow"));
    console.log(`p5 ${vp.name}: side pane ${Math.round((await side.boundingBox())!.width)} px, narrow=${narrow}`);
    for (const cal of CAL) {
      await set(page, { cal, field: "confirmed" });
      // the cells' box from its "Calibrate On" row down to the block under it
      const block = side.locator('[data-p5="cal"]');
      await block.evaluate(el => el.scrollIntoView({ block: "end" }));
      await page.waitForTimeout(100);
      if (vp === FULLHD) await page.screenshot({ path: `${OUT}/cal-${cal}-fullhd-page.png` });
      const radio = side.locator("#probeCalAxisLabel");
      const a = (await radio.boundingBox())!;
      const b = (await block.boundingBox())!;
      await page.screenshot({ path: `${OUT}/cal-${cal}-${vp.name}.png`,
        clip: { x: b.x - 8, y: a.y - 12, width: b.width + 16, height: b.y + b.height - a.y + 20 } });
    }
    await set(page, { cal: "idle" });
    for (const field of FIELD) {
      await set(page, { field });
      const line = side.locator('[data-p5="line"]');
      await side.locator(".formGrid .sub").filter({ hasText: "Parameters" }).evaluate(el => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(100);
      const grid = side.locator('.formGrid:has([data-p5="line"])');
      const box = (await grid.boundingBox())!;
      const lineBox = (await line.boundingBox())!;
      // the section head, its machine line and the first four fields
      await page.screenshot({ path: `${OUT}/field-${field}-${vp.name}.png`,
        clip: { x: box.x - 8, y: lineBox.y - 40, width: box.width + 16, height: Math.min(box.height + 8, vp === FULLHD ? 330 : 420) } });
    }
  });
}

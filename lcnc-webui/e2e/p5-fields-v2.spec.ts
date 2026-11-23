import { test, expect, type Page } from "./test";
import { ctl } from "./ctl";
import { openLayout, PROFILES, settleLayout, VIEWPORTS, type LayoutViewport } from "./layout-fixtures";

// P5 PROTOTYPE — W1 field states after the operator's feedback (2026-11-23):
// no text under a field, one section line, disarmed = the fields' own gate.
const OUT = process.env.P5_OUT ?? "/home/cnc/claude-work/p5/renderings-v2";
const FULLHD = VIEWPORTS.find(v => v.name === "touch-fullhd")!;
const NARROW: LayoutViewport = { name: "narrow", width: 900, height: 1200, touch: true };
const FIELD = ["draft", "saved", "confirmed", "disarmed", "refused"] as const;

async function openCal(page: Page, vp: LayoutViewport) {
  await openLayout(page, PROFILES[0]!, vp);
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
  await expect(side.locator('[data-p5="line"]')).toBeAttached();
  return side;
}

for (const vp of [FULLHD, NARROW]) {
  test(`P5 field states at ${vp.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    const side = await openCal(page, vp);
    const heights: string[] = [];
    for (const field of FIELD) {
      await ctl({ op: "status_delta", data: {}, armed: field !== "disarmed" });
      await page.evaluate((f) => (window as unknown as { __p5set: (x: unknown) => void })
        .__p5set({ field: f === "disarmed" ? "confirmed" : f }), field);
      await page.waitForTimeout(200);
      const line = side.locator('[data-p5="line"]');
      await side.locator(".formGrid .sub").filter({ hasText: "Parameters" }).evaluate(el => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(100);
      const grid = side.locator('.formGrid:has([data-p5="line"])');
      const box = (await grid.boundingBox())!;
      const lb = (await line.boundingBox())!;
      const cells = await grid.locator(".formField").evaluateAll(els => els.slice(0, 4).map(e => Math.round(e.getBoundingClientRect().height)));
      heights.push(`${field}: line ${Math.round(lb.height)} cells ${cells.join("/")}`);
      await page.screenshot({ path: `${OUT}/field-${field}-${vp.name}.png`,
        clip: { x: box.x - 8, y: lb.y - 40, width: box.width + 16, height: vp === FULLHD ? 330 : 420 } });
    }
    await ctl({ op: "status_delta", data: {}, armed: true });
    console.log(`p5fields ${vp.name}: ${heights.join(" | ")}`);
  });
}

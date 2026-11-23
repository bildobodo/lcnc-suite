import { test } from "./test";
import { openLayout, PROFILES, settleLayout } from "./layout-fixtures";

// P5 PROTOTYPE: does the narrow pane's sideways scrollbar come from the block?
test("p5 narrow sideways overflow, with and without the block", async ({ page }) => {
  await openLayout(page, PROFILES[0]!, { name: "narrow", width: 900, height: 1200, touch: true });
  await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
  await settleLayout(page);
  const side = page.locator(".sidePane");
  await side.getByRole("combobox", { name: "Side panel" }).selectOption({ label: "Probing" });
  await side.getByRole("combobox").nth(1).selectOption({ label: "Calibrate" });
  const measure = () => page.evaluate(() => [...document.querySelectorAll(".sidePane *")]
    .filter(e => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1; })
    .map(e => `${e.className}:${e.scrollWidth}/${e.clientWidth}`));
  for (const cal of ["failed", "idle"]) {
    await page.evaluate((c) => (window as unknown as { __p5set: (x: unknown) => void }).__p5set({ cal: c, field: "refused" }), cal);
    await page.waitForTimeout(150);
    console.log(`p5 overflow cal=${cal}:`, JSON.stringify(await measure()));
  }
  await page.evaluate(() => { for (const e of document.querySelectorAll('[data-p5]')) (e as HTMLElement).style.display = "none"; });
  await page.waitForTimeout(150);
  console.log("p5 overflow without the prototype blocks:", JSON.stringify(await measure()));
});

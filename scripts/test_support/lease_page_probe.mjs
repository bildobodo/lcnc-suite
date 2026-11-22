// The jog lease's page probe on the REAL gateway (P1b, plan MT423-04): a real
// page (headless Chromium, the run tree's own build served by its gateway)
// holds a jog button — healthy for 3 s, then held again while its MAIN thread
// is blocked for 2.5 s (what the panel's long tasks did). The worker's
// heartbeat goes on; the page's renewals stop. The native stage reads the
// gateway's trace and the status frames; this script only drives the page and
// prints its own wall-clock marks (ms) as ONE JSON line.
//
//   node lease_page_probe.mjs <tree> <url>
import { createRequire } from "node:module";
import path from "node:path";

const [tree, url] = process.argv.slice(2);
const require = createRequire(path.join(tree, "lcnc-webui", "package.json"));
const { chromium } = require("@playwright/test");

const out = { marks: {}, hints: [], errors: [] };
const mark = (k) => { out.marks[k] = Date.now(); };
const browser = await chromium.launch();
try {
  // The VM has no GPU: headless Chromium renders the 3D view in software,
  // ~1.5 s a frame once the machine moves — the page itself would hang and
  // its lease would rightly end. A pixel ratio of 0.25 cuts the canvas to a
  // sixteenth (the layout and the controls stay in CSS px); the evaluators
  // still judge a hold only on a page without a long task.
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 0.25 });
  page.on("console", (m) => { if (m.type() === "error") out.errors.push(m.text().slice(0, 300)); });
  await page.goto(url);
  await page.locator("input.setupInput").first().waitFor({ timeout: 30_000 });
  out.dpr = await page.evaluate(() => window.devicePixelRatio);
  const arm = page.getByRole("button", { name: "Arm", exact: true });
  await arm.click();
  await page.locator(".pill.armed").waitFor({ timeout: 10_000 });
  // the step is a choice group or, where the strip is short of room, a select
  const group = page.getByRole("radiogroup", { name: "Jog step", exact: true });
  const select = page.getByRole("combobox", { name: "Jog step", exact: true });
  await group.or(select).first().waitFor({ timeout: 10_000 });
  if (await group.count()) await group.getByRole("radio", { name: "Cont", exact: true }).click();
  else await select.selectOption({ label: "Cont" });
  const strip = page.locator('[data-strip="jog"]');
  const hold = async (name) => {
    const b = strip.getByRole("button", { name, exact: true });
    await b.waitFor({ timeout: 10_000 });
    await b.hover();
    await page.mouse.down();
  };
  // A: healthy — renewed throughout, never interrupted
  await hold("X-");
  mark("a_down");
  await page.waitForTimeout(3000);
  mark("a_up");
  await page.mouse.up();
  await page.waitForTimeout(1500);
  // B: the main thread blocked while the jog is held
  await hold("X+");
  mark("b_down");
  await page.waitForTimeout(1000);
  mark("block_start");
  await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 2500) { /* busy */ } });
  mark("block_end");
  await page.waitForTimeout(300);
  const hint = await page.locator("[data-btn-hint]").textContent({ timeout: 1000 }).catch(() => null);
  if (hint) out.hints.push(hint.trim());
  await page.mouse.up();
  mark("b_up");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Disarm", exact: true }).click().catch((e) => out.errors.push(String(e)));
} catch (e) {
  out.errors.push(String(e).slice(0, 500));
} finally {
  await browser.close();
}
console.log(JSON.stringify(out));

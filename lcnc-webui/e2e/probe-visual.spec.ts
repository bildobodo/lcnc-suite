import { test, expect, type Page } from "./test";
import { ctl } from "./ctl";
import { openLayout, PROFILES, settleLayout, VIEWPORTS } from "./layout-fixtures";
import { PROBE_VIEWS, type ProbeView } from "../src/probeViews";

// The probing procedures' reference images (test strategy TS248 d, plan
// vor-maschine R385): ONE image per procedure — eight, in Chromium and in
// the pinned Firefox core, each browser with its own references — and each
// procedure's grid cells counted and measured. The cells are the size check
// that holds without an image: Firefox 159/160 sized a probe glyph's
// percentage-wide SVG at zero and the grid fell to 10 px cells ("nur 9
// Punkte", operator 2026-11-02; natively red in the pin at the CSS before
// 769760ce). Surface and Toolsetter have no grid: counted as zero cells.
//
// The references are made where they are reviewed (visual.spec.ts): Linux on
// arm64, the dev VM. Another platform compares no image, says so in an
// annotation and still runs every size check (R385 F1 b) — the test runs,
// a comparison not made is no skip.
const REF_PLATFORM = "linux/arm64";
const HERE_PLATFORM = `${process.platform}/${process.arch}`;
const compareImages = HERE_PLATFORM === REF_PLATFORM;

/** Each procedure's grid: its cell count, ALL EIGHT named (a procedure
 *  without an entry fails below, never passes unmeasured). */
const CELLS: Record<ProbeView, number> = {
  outside: 9, inside: 9, angle: 9, boss: 6, ridge: 6, surface: 0, cal: 4, toolsetter: 0,
};

/** The surface view's two reads answered — the LATEST of each, as the panel
 *  correlates its replies with its latest request: no points, no grid. */
async function answerSurfaceReads(page: Page) {
  const sent = async () => (((await ctl({ op: "lastCmds" })) as { cmds?: { cmd?: string; req_id?: string }[] }).cmds ?? []);
  const last = async (cmd: string) => [...(await sent())].reverse().find(c => c.cmd === cmd);
  // the mock keeps the last 50 commands: fresh reads, asked for now
  await ctl({ op: "clearCmds" });
  await page.locator(".sidePane").getByRole("button", { name: /Reload Data|Loading…/ }).click();
  await expect.poll(async () => Boolean(await last("get_probe_results")) && Boolean(await last("get_comp_grid"))).toBe(true);
  const emptyShown = async () => await page.getByText("No surface map recorded yet", { exact: true }).isVisible()
    && await page.getByText("No compensation grid yet", { exact: true }).isVisible();
  await expect.poll(async () => {
    const grid = await last("get_comp_grid"), points = await last("get_probe_results");
    await ctl({ op: "raw", frame: { type: "reply", cmd: "get_comp_grid", req_id: grid!.req_id, ok: true, comp_grid: null, reason: "no grid file" } });
    await ctl({ op: "raw", frame: { type: "reply", cmd: "get_probe_results", req_id: points!.req_id, ok: true, points: [] } });
    return emptyShown();
  }, { message: "the surface view shows its empty state" }).toBe(true);
}

test("every procedure has its grid entry", () => {
  expect(Object.keys(CELLS).sort()).toEqual(PROBE_VIEWS.map(v => v.id).sort());
});

for (const view of PROBE_VIEWS) {
  test(`${view.label}: the procedure's grid cells and its reference image`, async ({ page }, info) => {
    await openLayout(page, PROFILES[0]!, VIEWPORTS[0]!);
    const side = page.locator(".sidePane");
    await side.getByRole("tab", { name: "Probing", exact: true }).click();
    await side.getByRole("tab", { name: view.label, exact: true }).click();
    const panel = side.locator(".probePanel");
    await expect(panel).toBeVisible();
    // Surface reads its points and grid from the gateway; the mock answers
    // neither, and "Loading…" turns into a failed read after 15 s — an image
    // that would depend on the run's pace. Its state is SET: the latest
    // requests answered with no points and no grid (touchoff.spec's way).
    if (view.id === "surface") await answerSurfaceReads(page);
    await settleLayout(page);

    const cells = await panel.locator(".gridCell").evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
    }));
    // Soft: a failed size check does not stop the image — the glyph collapse
    // is red in the image AND in the size check (TS248-05), each on its own.
    expect.soft(cells.length, `${view.label}: grid cells`).toBe(CELLS[view.id]);
    // the collapse gave 10 px cells: every cell keeps a touch-size square
    expect.soft(cells.filter(([w, h]) => w < 44 || Math.abs(w - h) > 1), `${view.label}: square cells of at least 44 px ${JSON.stringify(cells)}`)
      .toEqual([]);

    if (!compareImages) {
      const why = `references are ${REF_PLATFORM}, this is ${HERE_PLATFORM}`;
      info.annotations.push({ type: "images not compared", description: why });
      console.log(`probe-visual: ${view.label} — the image is not compared (${why}); the cells are checked`);
      return;
    }
    await panel.evaluate(el => el.scrollTo(0, 0));
    await settleLayout(page);
    await expect(panel).toHaveScreenshot(`probe-${view.id}.png`, {
      animations: "disabled", caret: "hide", scale: "css",
      threshold: 0.2, maxDiffPixelRatio: 0.002,
      // a WebGL surface is no part of the layout contract
      mask: [panel.locator("canvas")],
    });
  });
}

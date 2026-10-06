// The Simulation tab (operator 2026-10-05, variant A of the renders): the
// scrub bar is ONE row — Sim, play, the timeline, the time — and the
// findings live in the side pane's tab: the collision check with its
// progress, one list of the timeline's marks (× collision, ▲ soft limit,
// ● tool change), a filter, the steps. Stepping through collisions used to
// change the findings row's text width and the bar folded and unfolded under
// the operator's finger; the list's rows are the bar's own targets.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";
import { openSimTab, simLine, simShow, simStepBtn } from "./simTab";

const FEED = Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
FEED[17]![0] = 110;   // line 20 out of the X window
FEED[29]![0] = 120;   // line 32 out of the X window
const PREVIEW = Buffer.from(encode({ file: "/sim.ngc", preview_schema: 10, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.map(p => (p[0]! > 100 ? 1 : 0))),
  feed_tcum: new Uint8Array(new Float32Array(FEED.map((_, i) => i * 4)).buffer),
  violations: [{ line: 20, axis: "X", value: 110, limit: 100, kind: "max" }, { line: 32, axis: "X", value: 120, limit: 100, kind: "max" }],
  violations_total: 2 }));
const TEXT = Array.from({ length: 34 }, (_, i) => i === 0 ? "(sim)" : i === 9 ? "T3 M6" : `G1 X${i} F100`).join("\n");

async function prepare(page: Page, context: BrowserContext, vp = "desktop") {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: TEXT }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === vp)!);
  await ctl({ op: "status_delta", data: { active_file: "/sim.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5100, file: "/sim.ngc" } });
  await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
  // The sweep's verdict, then two collisions on the swept track (L12 feed, L26 rapid).
  await expect.poll(() => page.locator(".simPanel .checkVerdict").count(), { timeout: 30_000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(
    [{ line: 12, frac: 9 / 29 }, { line: 26, frac: 23 / 29, rapid: true }]) ?? false)).toBe(true);
  await openSimTab(page);
}
const rows = (page: Page) => page.locator(".simPanel tbody tr");
const rowKeys = (page: Page) => rows(page).evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")));

test("the list is the timeline's marks: one row each, in timeline order, each kind in its words", async ({ page, context }) => {
  await prepare(page, context);
  const marks = await page.locator(".scrubBar .scrubTick").evaluateAll(ts => ts.map(t => ({
    kind: ["clash", "limit", "tool"].find(k => t.classList.contains(k)), left: t.getBoundingClientRect().left })));
  const byKind = (k: string) => marks.filter(m => m.kind === k).length;
  const kinds = await rows(page).evaluateAll(trs => trs.map(t => ["clash", "limit", "tool"].find(k => t.querySelector(`.colKind.${k}`))));
  expect(kinds.filter(k => k === "clash").length, "a row per collision mark").toBe(byKind("clash"));
  expect(kinds.filter(k => k === "limit").length, "a row per limit mark").toBe(byKind("limit"));
  expect(kinds.filter(k => k === "tool").length, "a row per tool-change mark").toBe(byKind("tool"));
  expect(kinds, "timeline order").toEqual([...marks].sort((a, b) => a.left - b.left).map(m => m.kind));
  await expect(page.locator('.simPanel [data-sim-row="L20"] .colWhat')).toContainText("X 110 mm > max 100 mm");
  await expect(page.locator('.simPanel [data-sim-row="T10"] .colWhat')).toContainText("Tool change → T3");
  await expect(page.locator(".simPanel tr").filter({ hasText: "L26" }).locator(".colMove")).toHaveText("Rapid");
  // the filter counts and narrows
  await expect(page.locator('.simPanel select[name="simFilter"] option[value="clash"]')).toHaveText("Collisions (2)");
  await simShow(page, "limit");
  expect(await rowKeys(page)).toEqual(["L20", "L32"]);
  // the collision check: its progress and its verdict, the tools in its "?"
  await expect(page.locator(".simPanel .checkPct")).toHaveText("100 %");
  await expect(page.locator(".simPanel .checkVerdict")).toHaveText("2 collisions");
});

test("a row shows its finding; the steps go through the shown kind; the next row follows the position", async ({ page, context }) => {
  await prepare(page, context);
  await simShow(page, "all");
  const first = page.locator('.simPanel tr[data-sim-row^="C"]').first();
  const key = await first.getAttribute("data-sim-row");
  await first.click();
  await expect(page.locator(".simBanner"), "a row enters the simulation").toBeVisible();
  await expect(page.locator(`.simPanel [data-sim-row="${key}"]`)).toHaveClass(/shownRow/);
  await expect(page.locator(`.simPanel [data-sim-row="${key}"] .rowPick`)).toHaveAttribute("aria-current", "true");
  await expect(simLine(page)).toHaveText(/^L12\b/);
  // the steps of one kind: the old "Next limit violation" from here
  await simShow(page, "limit");
  await simStepBtn(page, "Next limit violation").click();
  await expect(simLine(page)).toHaveText(/^L20\b/);
  await simStepBtn(page, "Next limit violation").click();
  await expect(simLine(page)).toHaveText(/^L32\b/);
  await simStepBtn(page, "Previous limit violation").click();
  await expect(simLine(page)).toHaveText(/^L20\b/);
  // a manual position: no finding shown, the next row ahead of it marked
  await simShow(page, "all");
  await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
    el.value = "50"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(page.locator(".simPanel .shownRow")).toHaveCount(0);
  const next = await page.locator(".simPanel .nextRow").getAttribute("data-sim-row");
  const all = await page.locator(".simPanel tbody tr").evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")));
  expect(all.indexOf(next), "the next row is the first past the position").toBeGreaterThan(0);
});

// Keyboard jog ON with the navigation keys bound to jog (tabs.spec's map): a
// key a row failed to keep would move the machine.
const KEYBOARD = { keyboard: { jogEnabled: true, buttonsEnabled: true, mapping: {
  "jog_x+": "ArrowRight", "jog_x-": "ArrowLeft", "jog_y+": "ArrowUp", "jog_y-": "ArrowDown",
  "jog_z+": "Home", "jog_z-": "End", estop: "Escape", cycle: " ", abort: "Backspace",
} } };
const jogs = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string }[]).map(c => c.cmd).filter(c => /jog/.test(c));

test("the rows' keys move the focus, never a jog; Enter shows; the machine on explains at the row", async ({ page, context }) => {
  await prepare(page, context);
  await simShow(page, "all");
  // The machine on (homed by the layout fixture) and the keyboard jog live.
  await ctl({ op: "status_delta", data: { is_enabled: true, enabled: true } });
  await expect(page.locator(".statusBanner")).toContainText("IDLE");
  await ctl({ op: "raw", frame: { type: "settings_init", settings: KEYBOARD } });
  await page.waitForTimeout(150); // review-only: allow the queued settings frame to be applied
  // Control: an arrow on the unfocused page jogs.
  await ctl({ op: "clearCmds" });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.down("ArrowRight");
  await expect.poll(jogs, "control: an arrow on the unfocused page jogs").toContain("jog_cont");
  await page.keyboard.up("ArrowRight");
  await expect.poll(jogs).toContain("jog_stop");
  await ctl({ op: "clearCmds" });
  const picks = page.locator(".simPanel .rowPick");
  await picks.first().focus();
  for (const key of ["ArrowDown", "ArrowDown", "Control+ArrowDown", "ArrowUp", "End", "Home", "ArrowLeft", "ArrowRight"]) await page.keyboard.press(key);
  await expect(picks.first(), "Home brought the focus back to the first row").toBeFocused();
  await page.waitForTimeout(300);
  expect(await jogs(), "no key on a row reached the jog map").toEqual([]);
  // the machine on: Enter on a row says why at the row, nothing else happens
  await page.keyboard.press("Enter");
  await expect(page.locator(".btnHint")).toHaveText("Machine on — power off to simulate");
  await expect(page.locator(".simBanner")).toHaveCount(0);
  // the machine off: Enter shows the row
  await ctl({ op: "status_delta", data: { is_enabled: false, enabled: false } });
  await expect(page.locator(".statusBanner")).toContainText("MACHINE OFF");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.locator(".simBanner")).toBeVisible();
  await expect(page.locator(".simPanel .shownRow .rowPick")).toBeFocused();
});

test("stepping through the findings never changes the bar: the same box, the same timeline", async ({ page, context }) => {
  for (const [vp, zoom] of [["desktop", 1], ["touch-landscape", 1], ["touch-portrait", 1.5]] as const) {
    await prepare(page, context, vp);
    if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
    await settleLayout(page);
    await simShow(page, "all");
    // Layout px (CSS zoom aside): the bar, the timeline, the bar's content box.
    const bar = () => page.locator(".scrubBar").evaluate(el => {
      const b = el as HTMLElement, cs = getComputedStyle(b);
      return { w: b.offsetWidth, h: b.offsetHeight, slider: (b.querySelector(".sliderWrap") as HTMLElement).offsetWidth,
        content: b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), narrow: !!b.closest(".narrowViewer") };
    });
    const step = simStepBtn(page, "Next on the timeline");
    await step.click();
    await expect(page.locator(".simBanner")).toBeVisible();
    await settleLayout(page);
    const at = await bar();
    expect(at.narrow, `${vp}: a narrow viewer only at 150 % portrait`).toBe(vp === "touch-portrait");
    expect(at.slider, `${vp}: the timeline keeps its room`).toBeGreaterThanOrEqual(120);
    if (at.narrow) expect(at.slider, `${vp}: a narrow viewer gives the timeline a row of its own`).toBeGreaterThanOrEqual(at.content - 1);
    for (let i = 0; i < 6; i++) {
      await step.click();
      expect(await bar(), `${vp}: step ${i + 2} — the bar as it was`).toEqual(at);
    }
    await ctl({ op: "reset" });
  }
});

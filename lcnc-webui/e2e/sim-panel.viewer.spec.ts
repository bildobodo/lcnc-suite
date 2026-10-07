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
const PREVIEW_FIELDS = { file: "/sim.ngc", preview_schema: 10, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.map(p => (p[0]! > 100 ? 1 : 0))),
  feed_tcum: new Uint8Array(new Float32Array(FEED.map((_, i) => i * 4)).buffer),
  violations: [{ line: 20, axis: "X", value: 110, limit: 100, kind: "max" }, { line: 32, axis: "X", value: 120, limit: 100, kind: "max" }],
  violations_total: 2 };
const PREVIEW = Buffer.from(encode(PREVIEW_FIELDS));
// T3 on line 10; T5 on line 20 — the same moment as line 20's limit
const TEXT = Array.from({ length: 34 }, (_, i) => i === 0 ? "(sim)" : i === 9 ? "T3 M6" : i === 19 ? "T5 M6" : `G1 X${i} F100`).join("\n");

async function prepare(page: Page, context: BrowserContext, vp = "desktop", preview = PREVIEW) {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
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
/** The machine on or off — waited for in the CLIENT (the strip's power
 *  button names the next action), not only in the mock's reply. By the
 *  button's NAME: its stable width keeps both words in the DOM, the other
 *  one hidden, so the strip's text held both in either state (Codex R79
 *  VP-I40). */
async function machine(page: Page, on: boolean) {
  await ctl({ op: "status_delta", data: { is_enabled: on, enabled: on } });
  await expect(page.locator(".safetyStrip").getByRole("button", { name: on ? "Power off" : "Power on", exact: true })).toBeVisible();
}
/** The machine on (homed by the layout fixture), the keyboard jog bound to
 *  the arrows — and proven live: an arrow on the unfocused page jogs. */
async function jogLive(page: Page) {
  await machine(page, true);
  await ctl({ op: "raw", frame: { type: "settings_init", settings: KEYBOARD } });
  await ctl({ op: "clearCmds" });
  await expect.poll(async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(100);
    await page.keyboard.up("ArrowRight");
    return jogs();
  }, { message: "control: an arrow on the unfocused page jogs" }).toEqual(expect.arrayContaining(["jog_cont", "jog_stop"]));
  await ctl({ op: "clearCmds" });
}

test("the rows' keys move the focus, never a jog; Enter shows; the machine on explains at the row", async ({ page, context }) => {
  await prepare(page, context);
  await simShow(page, "all");
  await jogLive(page);
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
  await machine(page, false);
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

// Codex R78 VP-I37: a result change removed the focused row (or re-rendered a
// focused step button) and the focus fell to BODY — the next arrow jogged.
// The panel owns its focus: the row now at its place, else the list filter.
test("a result change under the focus keeps it in the panel; no arrow jogs", async ({ page, context }) => {
  await prepare(page, context);
  await simShow(page, "all");
  await jogLive(page);
  const inPanel = () => page.evaluate(() => !!document.activeElement?.closest(".simPanel"));
  const tryJog = async () => {
    for (const k of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"]) await page.keyboard.press(k);
    await page.waitForTimeout(300);
    return jogs();
  };
  // a focused collision row, then a result without collisions
  await page.locator('.simPanel tr[data-sim-row^="C"] .rowPick').first().focus();
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([]) ?? false)).toBe(true);
  await expect(page.locator('.simPanel tr[data-sim-row^="C"]')).toHaveCount(0);
  expect(await inPanel(), "the focus stays in the panel").toBe(true);
  await expect(page.locator(".simPanel .rowPick:focus"), "on the row now at its place").toHaveCount(1);
  expect(await tryJog(), "no arrow reached the jog map").toEqual([]);
  // the list filtered to collisions, a focused row, then the list empties
  await page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([{ line: 12, frac: 9 / 29 }]));
  await simShow(page, "clash");
  await page.locator(".simPanel .rowPick").first().focus();
  await page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([]));
  await expect(page.locator(".simPanel tbody tr")).toHaveCount(0);
  await expect(page.locator('.simPanel select[name="simFilter"]'), "an empty list: the filter holds the focus").toBeFocused();
  expect(await tryJog(), "no arrow reached the jog map").toEqual([]);
});

// Codex R87 VP-I46: a part left out of the check (no facet with area) is
// named in the result's `uncertified`; with no moving pair left the view
// returned "No moving pairs" before it read that note — no marker, no "not
// certified" in the name, and the help began "nothing to check".
test("a part left out of the check stays marked, with or without moving pairs", async ({ page, context }) => {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: TEXT }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: "/sim.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5101, file: "/sim.ngc" } });
  await expect.poll(() => page.locator(".simPanel .checkVerdict").count(), { timeout: 30_000 }).toBe(1);
  await openSimTab(page);
  const item = page.locator(".simPanel .simSummary .sumItem").first();
  const help = async () => {
    await page.getByRole("button", { name: "Help: Collision check", exact: true }).click();
    const text = await page.locator(".helpPopover:popover-open").innerText();
    await page.keyboard.press("Tab");   // light dismiss without Escape (E-Stop)
    await page.mouse.click(5, 5);
    return text;
  };
  // Control: the layout mock's model has no moving pair and nothing left out.
  await expect(item).toHaveAttribute("aria-label", "No moving pairs");
  await expect(item.locator('span[title^="Not certified"]')).toHaveCount(0);
  const note = "damaged: no facet with area — not checked";
  expect(await page.evaluate(n => window.__viewerDiag?.setCollisionNote?.(n) ?? false, note)).toBe(true);
  await expect(item, "no moving pair, a part left out").toHaveAttribute("aria-label", "Not checked (not certified)");
  await expect(item.locator('span[title^="Not certified"]'), "the marker").toHaveCount(1);
  const text = await help();
  expect(text).toContain(note);
  expect(text, "never \"nothing to check\" over a part that could not be checked").not.toContain("nothing to check");
  // With a moving pair the same note marks the clear verdict.
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([]) ?? false)).toBe(true);
  await page.evaluate(n => window.__viewerDiag?.setCollisionNote?.(n), note);
  await expect(item).toHaveAttribute("aria-label", "Clear (not certified)");
  await expect(item.locator('span[title^="Not certified"]')).toHaveCount(1);
});

// Codex R78 VP-I38: the steps sorted by position alone — where a tool change,
// a limit and a collision share one moment, "Next on the timeline" went down
// the list and back up. One order for both, ties and the wrap included.
test("the steps through mixed kinds follow the list's own order, ties included", async ({ page, context }) => {
  await prepare(page, context);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(
    [{ line: 12, frac: 9 / 29 }, { line: 20, frac: 64 / 116 }, { line: 26, frac: 23 / 29, rapid: true }]) ?? false)).toBe(true);
  await simShow(page, "all");
  const list = await rows(page).evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")!.split("|")[0]));
  expect(list, "the list: the tool, the limit and the collision of L20 at one moment").toEqual(["T10", "C12", "T20", "L20", "C20", "C26", "L32"]);
  const shownKey = () => page.locator(".simPanel .shownRow").getAttribute("data-sim-row").then(k => k?.split("|")[0]);
  await page.locator('.simPanel tr[data-sim-row^="C12"]').click();
  await expect.poll(shownKey).toBe("C12");
  const next = simStepBtn(page, "Next on the timeline"), prev = simStepBtn(page, "Previous on the timeline");
  for (const want of ["T20", "L20", "C20", "C26", "L32", "T10", "C12"]) {
    await next.click();
    await expect.poll(shownKey, `next → ${want}`).toBe(want);
  }
  for (const want of ["T10", "L32", "C26", "C20", "L20", "T20", "C12"]) {
    await prev.click();
    await expect.poll(shownKey, `previous → ${want}`).toBe(want);
  }
});

// Codex R78 VP-I39: a jump to a tool change kept the previous finding's
// reveal — its move and the line "Toolpath shown for this finding" stayed at
// the tool change. A tool change ends it; the stored layer stays off.
test("a tool change shown after a finding ends the finding's reveal, the stored layer untouched", async ({ page, context }) => {
  await prepare(page, context);
  await simShow(page, "all");
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { toolpath: false } } } } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.projectRole!("feed"))).toBeNull();
  const reveal = page.locator("[data-path-reveal]");
  // by a row
  await page.locator('.simPanel tr[data-sim-row^="C12"]').click();
  await expect(reveal).toHaveText("Toolpath shown for this finding — hidden in Layers");
  await page.locator('.simPanel tr[data-sim-row="T20"]').click();
  await expect(reveal, "a row's tool change ends the reveal").toHaveCount(0);
  // by a step: from the collision the next on the timeline is the tool change
  await page.locator('.simPanel tr[data-sim-row^="C12"]').click();
  await expect(reveal).toHaveCount(1);
  await simStepBtn(page, "Next on the timeline").click();
  await expect(page.locator(".simPanel .shownRow")).toHaveAttribute("data-sim-row", "T20");
  await expect(reveal, "a step to a tool change ends it").toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.projectRole!("feed")), { message: "the stored layer stays off" }).toBeNull();
});

// The same on a hidden RAPID (Codex R78 VP-I39: feed and rapid): line 14's
// rapid runs out of the X window; T3 M6 on line 5.
const RAPID_FEED = Array.from({ length: 10 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
const RAPID_PREVIEW = Buffer.from(encode({ file: "/simrapid.ngc", preview_schema: 10, feed: RAPID_FEED,
  feed_lines: RAPID_FEED.map((_, i) => i + 3), feed_seq: RAPID_FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(RAPID_FEED.length),
  rapid: [[27, 20, 0], [150, 20, 5]], rapid_lines: [13, 14], rapid_seq: [13, 14],
  rapid_outside: new Uint8Array([0, 1]),
  violations: [{ line: 14, axis: "X", value: 150, limit: 100, kind: "max" }], violations_total: 1 }));
const RAPID_TEXT = Array.from({ length: 16 }, (_, i) => i === 0 ? "(simrapid)" : i === 4 ? "T3 M6" : `G1 X${i} F100`).join("\n");

test("a tool change shown after a finding on a hidden rapid ends the rapids' reveal", async ({ page, context }) => {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: RAPID_PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: RAPID_TEXT }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: "/simrapid.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5200, file: "/simrapid.ngc" } });
  await simShow(page, "all");
  await expect(page.locator('.simPanel tr[data-sim-row="T5"]')).toBeVisible({ timeout: 15_000 });
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: false } } } } });
  const rapidShown = () => page.evaluate(() => window.__viewerDiag!.projectRole!("rapid") != null);
  await expect.poll(rapidShown, { message: "the Rapids layer hides the rapid lines" }).toBe(false);
  const reveal = page.locator("[data-path-reveal]");
  // by a row
  await page.locator('.simPanel tr[data-sim-row="L14"]').click();
  await expect(reveal).toHaveText("Rapids shown for this finding — hidden in Layers");
  await page.locator('.simPanel tr[data-sim-row="T5"]').click();
  await expect(reveal, "a row's tool change ends the reveal").toHaveCount(0);
  await expect.poll(rapidShown, { message: "the rapids hidden again" }).toBe(false);
  // by a step of the tool changes, from the finding
  await page.locator('.simPanel tr[data-sim-row="L14"]').click();
  await expect(reveal).toHaveCount(1);
  await simShow(page, "tool");
  await simStepBtn(page, "Previous tool change").click();
  await expect(page.locator(".simPanel .shownRow")).toHaveAttribute("data-sim-row", "T5");
  await expect(reveal, "a step to a tool change ends it").toHaveCount(0);
  await expect.poll(rapidShown, { message: "the stored layer stays off" }).toBe(false);
});

// The list FOLLOWS the position (operator 2026-10-06: "like the code panel
// when the program runs"): a list longer than its view keeps the marked row
// — the next one ahead — in the middle while the simulation scrubs.
const LONG_FEED = Array.from({ length: 60 }, (_, i) => [i * 2, i % 2 ? 20 : 0, 0]);
const LONG_PREVIEW = Buffer.from(encode({ file: "/long.ngc", preview_schema: 10, feed: LONG_FEED,
  feed_lines: LONG_FEED.map((_, i) => i + 3), feed_seq: LONG_FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(LONG_FEED.length),
  feed_tcum: new Uint8Array(new Float32Array(LONG_FEED.map((_, i) => i * 4)).buffer),
  violations: Array.from({ length: 50 }, (_, i) => ({ line: i + 8, axis: "X", value: 110, limit: 100, kind: "max" })),
  violations_total: 50 }));
const LONG_TEXT = Array.from({ length: 64 }, (_, i) => i === 0 ? "(long)" : `G1 X${i} F100`).join("\n");

test("the list follows the position: the marked row stays in the middle of its view", async ({ page, context }) => {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: LONG_PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: LONG_TEXT }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: "/long.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5300, file: "/long.ngc" } });
  await simShow(page, "all");
  await expect(page.locator('.simPanel tr[data-sim-row="L57"]')).toHaveCount(1, { timeout: 15_000 });
  const view = () => page.evaluate(() => {
    const sc = document.querySelector(".simPanel .simTable") as HTMLElement;
    const tr = sc.querySelector<HTMLElement>("tr.shownRow, tr.nextRow");
    const head = sc.querySelector("thead")!.getBoundingClientRect(), b = sc.getBoundingClientRect();
    const r = tr?.getBoundingClientRect();
    return { key: tr?.dataset.simRow ?? null, overflows: sc.scrollHeight > sc.clientHeight + 1,
      inView: !!r && r.top >= head.bottom - 1 && r.bottom <= b.bottom + 1,
      offCentre: r ? Math.abs((r.top + r.bottom) / 2 - (head.bottom + b.bottom) / 2) : Infinity, rowH: r?.height ?? 0 };
  });
  expect((await view()).overflows, "the list is longer than its view").toBe(true);
  // Into the simulation by the first row, then scrub.
  await page.locator('.simPanel tr[data-sim-row="L8"]').click();
  await expect(page.locator(".simBanner")).toBeVisible();
  const scrub = (f: number) => page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement, at) => {
    el.value = String(Number(el.max) * at);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, f);
  for (const f of [0.7, 0.25, 0.5]) {
    await scrub(f);
    await expect.poll(async () => { const v = await view(); return v.inView && v.offCentre <= v.rowH; },
      { message: `scrubbed to ${f}: the next row in the middle of the list` }).toBe(true);
  }
  // Back to the start: the first row, the list at its top.
  await scrub(0.01);
  await expect.poll(async () => (await view()).inView, { message: "back at the start: the first rows in view" }).toBe(true);
});

// Codex R81 VP-I41: the follow restarted a browser smooth scroll per row —
// at ×100 playback it fell behind and the marked row sat below the view for
// 1.5 s (openLayout emulates reduced motion, where it snapped: the scrub test
// above never saw it). It glides the code panel's way now, from inside the
// row's visible band: with NORMAL motion, playing at ×100, the marked row is
// wholly in view at every sample.
test("playback at ×100 with normal motion: the marked row never leaves the list's view", async ({ page, context }) => {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: LONG_PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: LONG_TEXT }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ctl({ op: "status_delta", data: { active_file: "/long.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5400, file: "/long.ngc" } });
  await simShow(page, "limit");
  await expect(page.locator('.simPanel tr[data-sim-row="L57"]')).toHaveCount(1, { timeout: 15_000 });
  await settleLayout(page);
  await page.locator('.simPanel tr[data-sim-row="L8"]').click();
  await expect(page.locator(".simBanner")).toBeVisible();
  await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
    el.value = String(Number(el.max) * 0.15);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator('.simPanel select[name="simSpeed"]').selectOption("100");
  await page.locator('.scrubBar [title="Play the program through the machine model"]').click();
  const samples: { key: string | null; inView: boolean; below: number }[] = [];
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(50);
    samples.push(await page.evaluate(() => {
      const sc = document.querySelector(".simPanel .simTable") as HTMLElement;
      const tr = sc.querySelector<HTMLElement>("tr.shownRow, tr.nextRow");
      const head = sc.querySelector("thead")!.getBoundingClientRect(), b = sc.getBoundingClientRect();
      const r = tr?.getBoundingClientRect();
      return { key: tr?.dataset.simRow ?? null, inView: !!r && r.top >= head.bottom - 1 && r.bottom <= b.bottom + 1,
        below: r ? Math.round(r.bottom - b.bottom) : 0 };
    }));
  }
  const marked = samples.filter(s => s.key);
  expect(new Set(marked.map(s => s.key)).size, "the playback moved through many rows").toBeGreaterThan(5);
  expect(marked.filter(s => !s.inView), "every sample: the marked row wholly in the list's view").toEqual([]);
});

// Operator 2026-10-06 (live): the collision verdict came in with the
// check's result — and left with every re-check — and the filter and the
// steps under it jumped. ONE summary line is always there: × the check's
// verdict, ▲ the program's limit records, ● the tool changes.
test("the summary line is always there: a re-check moves nothing under it", async ({ page, context }) => {
  await prepare(page, context);
  // Every frame: where the list head sits, and whether a verdict shows.
  await page.evaluate(() => {
    const w = window as unknown as { __sumFrames: { y: number; verdict: boolean }[] };
    w.__sumFrames = [];
    const tick = () => {
      const head = document.querySelector(".simPanel .listHead"), panel = document.querySelector(".simPanel");
      if (head && panel) w.__sumFrames.push({ y: Math.round((head.getBoundingClientRect().top - panel.getBoundingClientRect().top) * 10) / 10,
        verdict: !!document.querySelector(".simPanel .checkVerdict") });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.waitForTimeout(300);
  // A new version of the program clears the check's result; the check starts
  // again once the payload is decoded: no verdict for a while, then back.
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5101, file: "/sim.ngc" } });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sumFrames: { verdict: boolean }[] }).__sumFrames.some(f => !f.verdict)),
    { message: "the re-check cleared the verdict for a while", timeout: 15_000 }).toBe(true);
  await expect(page.locator(".simPanel .checkVerdict")).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(300);
  const ys = await page.evaluate(() => [...new Set((window as unknown as { __sumFrames: { y: number }[] }).__sumFrames.map(f => f.y))]);
  expect(ys, "the filter and the steps never moved, in any frame").toHaveLength(1);
});

test("the summary names each kind: words in the wide pane, the glyph and the number narrow; a capped list says so", async ({ page, context }) => {
  await prepare(page, context);
  const items = page.locator(".simPanel .simSummary [role=img]");
  await expect(items).toHaveCount(3);
  expect(await items.evaluateAll(els => els.map(e => e.getAttribute("aria-label")))).toEqual(["2 collisions", "2 limit violations", "2 tool changes"]);
  await expect(page.locator(".simPanel .simSummary .sumWide").first()).toBeVisible();
  await expect(page.locator(".simPanel .simSummary .sumShort").first()).toBeHidden();
  await ctl({ op: "reset" });
  // The gateway's list holds its first 200 records; the summary says the total.
  await prepare(page, context, "touch-portrait", Buffer.from(encode({ ...PREVIEW_FIELDS, violations_total: 9000 })));
  await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
  await settleLayout(page);
  await expect(page.locator(".sidePane.narrow"), "150 % portrait: the narrow pane").toHaveCount(1);
  expect(await items.evaluateAll(els => els.map(e => e.getAttribute("aria-label"))))
    .toEqual(["2 collisions", "9000 limit violations · the first 2 lines listed", "2 tool changes"]);
  const shorts = page.locator(".simPanel .simSummary .sumShort");
  expect(await shorts.allInnerTexts(), "narrow: the number").toEqual(["2", "9000", "2"]);
  for (let i = 0; i < 3; i++) await expect(shorts.nth(i), "narrow: each number shows").toBeVisible();
  await expect(page.locator(".simPanel .simSummary .sumWide").first()).toBeHidden();
  const box = await page.locator(".simPanel .simSummary").evaluate(el => ({ w: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) || 0 }));
  expect(box.w, "narrow: the whole line fits").toBeLessThanOrEqual(box.cw);
  // Codex R82 VP-I42: narrow, the cap was said only in a name and a mouse
  // tooltip. The line's own "?" says it — by keyboard and by a tap.
  const help = page.locator('.simPanel .simSummaryRow [aria-label="Help: Summary"]');
  const said = /^9000 limit violations, a line and an axis each\. The parse sends the first 2; the list shows their 2 lines\.$/;
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".helpPopover:popover-open"), "keyboard: the cap in words").toHaveText(said);
  await page.keyboard.press("Enter");
  await expect(page.locator(".helpPopover:popover-open")).toHaveCount(0);
  await help.click();
  await expect(page.locator(".helpPopover:popover-open"), "a tap: the cap in words").toHaveText(said);
});

// Codex R83 VP-I43: with a full summary line the "?" sat at the tab
// content's clipping edge and the outer 4 px of its 24 px hit area were cut
// off — a tap there landed on the side pane. The row keeps the reach.
test("the summary's \"?\" answers in its whole hit area, at the right edge of a full line", async ({ page, context }) => {
  // A FULL line (Codex's case: 1600 × 1000): twelve collisions and a
  // sixteen-digit total — the limit text gives way, the "?" ends the line.
  // A ten-digit total fitted in Firefox (283 px of 283) and the guard never
  // reached its case there (Codex R85 VP-I44); the precondition below stays.
  await prepare(page, context, "desktop", Buffer.from(encode({ ...PREVIEW_FIELDS, violations_total: Number.MAX_SAFE_INTEGER })));
  await page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(Array.from({ length: 12 }, (_, i) => ({ line: 5 + i, frac: (2 + i) / 29 }))));
  await settleLayout(page);
  expect(await page.locator(".simPanel .sumLimit .sumWide").evaluate(el => el.scrollWidth > el.clientWidth), "the line is full: its limit text gives way").toBe(true);
  const help = page.locator('.simPanel .simSummaryRow [aria-label="Help: Summary"]');
  const g = await help.evaluate(el => {
    const r = el.getBoundingClientRect(), tab = el.closest(".tab-content")!.getBoundingClientRect();
    const z = r.width / (el as HTMLElement).offsetWidth;
    const hit = parseFloat(getComputedStyle(el, "::before").width);
    return { right: r.right, cy: (r.top + r.bottom) / 2, reach: (hit * z - r.width) / 2, tabRight: tab.right };
  });
  expect(g.reach, "the hit area reaches past the glyph").toBeGreaterThan(1);
  expect(g.tabRight - g.right, "the \"?\" ends the full line, its reach inside the tab").toBeLessThanOrEqual(g.reach + 1);
  await page.mouse.click(g.right + g.reach - 1, g.cy);
  await expect(page.locator(".helpPopover:popover-open"), "a tap at the hit area's outer edge").toHaveCount(1);
});

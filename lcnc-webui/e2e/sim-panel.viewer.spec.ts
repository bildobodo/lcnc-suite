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
import { FIRST_ROWS } from "../src/viewer/simListRange";

const FEED = Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
FEED[17]![0] = 110;   // line 20 out of the X window
FEED[29]![0] = 120;   // line 32 out of the X window
const PREVIEW_FIELDS = { file: "/sim.ngc", preview_schema: 11, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.map(p => (p[0]! > 100 ? 1 : 0))),
  feed_tcum: new Uint8Array(new Float32Array(FEED.map((_, i) => i * 4)).buffer),
  violations: [{ line: 20, axis: "X", value: 110, limit: 100, kind: "max" }, { line: 32, axis: "X", value: 120, limit: 100, kind: "max" }],
  violations_total: 2 };
const PREVIEW = Buffer.from(encode(PREVIEW_FIELDS));
// T3 on line 10; T5 on line 20 — the same moment as line 20's limit
const TEXT = Array.from({ length: 34 }, (_, i) => i === 0 ? "(sim)" : i === 9 ? "T3 M6" : i === 19 ? "T5 M6" : `G1 X${i} F100`).join("\n");

async function prepare(page: Page, context: BrowserContext, vp = "desktop", preview = PREVIEW, setHits = true) {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: TEXT }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === vp)!);
  await ctl({ op: "status_delta", data: { active_file: "/sim.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5100, file: "/sim.ngc" } });
  await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
  // The sweep's verdict, then two collisions on the swept track (L12 feed, L26 rapid).
  await expect.poll(() => page.locator(".simPanel .checkVerdict").count(), { timeout: 30_000 }).toBe(1);
  if (setHits) await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(
    [{ line: 12 }, { line: 26, rapid: true }]) ?? false)).toBe(true);
  await openSimTab(page);
}
const rows = (page: Page) => page.locator(".simPanel tbody tr[data-sim-row]");
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
  // The run stops at the first soft limit at the latest (operator 2026-10-08):
  // the boundary is the first point a move ends beyond the window at (the
  // gateway's flag — L20's end); its row says so, every row after it is
  // marked, a tool change at L20's start and a row before it are not — and
  // every row stays listed.
  await expect(page.locator('.simPanel [data-sim-row="L20"] .colWhat')).toContainText("first predicted limit crossing — where the run stops is not determined");
  await expect(page.locator(".simPanel tr").filter({ hasText: "L26" }).locator(".colWhat")).toContainText("after the first limit crossing at L20");
  await expect(page.locator('.simPanel [data-sim-row="L32"] .colWhat')).toContainText("after the first limit crossing at L20");
  await expect(page.locator('.simPanel [data-sim-row="T20"] .colWhat')).not.toContainText("limit crossing");
  await expect(page.locator(".simPanel tr").filter({ hasText: "L12" }).locator(".colWhat")).not.toContainText("limit crossing");
  // the filter counts and narrows
  await expect(page.locator('.simPanel select[name="simFilter"] option[value="clash"]')).toHaveText("Collisions (2)");
  await simShow(page, "limit");
  expect(await rowKeys(page)).toEqual(["L20", "L32"]);
  // the collision check: its progress and its verdict, the tools in its "?"
  await expect(page.locator(".simPanel .checkPct")).toHaveText("100 %");
  await expect(page.locator(".simPanel .checkVerdict")).toHaveText("2 collisions · checked in full");
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
  const all = await page.locator(".simPanel tbody tr[data-sim-row]").evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")));
  expect(all.indexOf(next), "the next row is the first past the position").toBeGreaterThan(0);
});

// Step 4 package 2, plan 4.4: the list is a WINDOW of at most 400 rows around
// the shown (else the next) row; the count and ‹ › reach every target, and the
// timeline marks one occupied column, never one target each — at the budget a
// row and a mark per target held the page for minutes.
test("a long list is a window: 400 rows, the count and the steps reach every target, one mark per column (plan 4.4)", async ({ page, context }) => {
  await prepare(page, context, "desktop", PREVIEW, false);
  const N = 1000, key = (k: number) => `C0|${k}|0`;
  await expect.poll(() => page.evaluate(n => window.__viewerDiag?.setCollisionHits?.(
    Array.from({ length: n }, (_, k) => ({ line: 12, frac: 0.01 + (0.98 * k) / n }))) ?? false, N)).toBe(true);
  await simShow(page, "clash");
  const option = page.locator('.simPanel select[name="simFilter"] option[value="clash"]');
  const more = page.locator(".simPanel .windowMore");
  await expect(option).toHaveText(`Collisions (${N})`);
  await expect(rows(page)).toHaveCount(400);
  await expect(more, "what lies after the window, counted; nothing before it").toHaveText(["600 later"]);
  expect((await rowKeys(page))[0]).toBe(key(0));
  await expect(more.locator(".rowPick, [data-sim-row]"), "the count rows are no list rows").toHaveCount(0);
  // the marks: one per occupied column, each at its own place — fewer than the targets
  const ticks = await page.locator(".scrubBar .scrubTick.clash").evaluateAll(ts => ts.map(t => t.getBoundingClientRect().left));
  expect(ticks.length, "marks").toBeGreaterThan(50);
  expect(ticks.length, "never one per target").toBeLessThan(N);
  const sorted = [...ticks].sort((a, b) => a - b);
  expect(sorted.every((x, i) => !i || x - sorted[i - 1]! > 0.4), "no two marks in one column").toBe(true);
  // ‹ › reach a target outside the window: back from the start wraps to the last
  await simStepBtn(page, "Previous collision").click();
  await expect(page.locator(`.simPanel [data-sim-row="${key(N - 1)}"]`)).toHaveClass(/shownRow/);
  await expect(rows(page)).toHaveCount(400);
  await expect(more, "the window moved to it").toHaveText(["600 earlier"]);
  await expect(option, "the count stays every target").toHaveText(`Collisions (${N})`);
  // a focused row the window moves away from: the focus goes to the row now
  // at its place, held inside the window — never to the page (R78: an arrow
  // on the page would jog)
  await page.locator(`.simPanel [data-sim-row="${key(600)}"] .rowPick`).focus();
  await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
    el.value = "0.5"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await expect(more, "the window follows the position back to the start").toHaveText(["600 later"]);
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-sim-row]")?.getAttribute("data-sim-row") ?? document.activeElement?.tagName))
    .toBe(key(399));
  // and on from the shown one: the first again
  await simStepBtn(page, "Previous collision").click();
  await simStepBtn(page, "Next collision").click();
  await expect(page.locator(`.simPanel [data-sim-row="${key(0)}"]`)).toHaveClass(/shownRow/);
  await expect(more).toHaveText(["600 later"]);
  // a new result under a focused row in a moved window: the row at its place
  // in the WHOLE list takes the focus (its global index, not its place on
  // screen) — the same targets, every key new
  await simStepBtn(page, "Previous collision").click();
  await expect(more).toHaveText(["600 earlier"]);
  await page.locator(`.simPanel [data-sim-row="${key(650)}"] .rowPick`).focus();
  await expect.poll(() => page.evaluate(n => window.__viewerDiag?.setCollisionHits?.(
    Array.from({ length: n }, (_, k) => ({ line: 12, frac: 0.01 + (0.98 * k) / n, ordinal: 5000 + k }))) ?? false, N)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-sim-row]")?.getAttribute("data-sim-row") ?? document.activeElement?.tagName))
    .toBe(key(5650));
  await expect(more).toHaveText(["600 earlier"]);
});

/** The fill of the list in portions, as the page saw it (Codex R164 VP-I120):
 *  the rows in the DOM at their first appearance (a MutationObserver — before
 *  any frame), then every frame's rows, table height and column widths until
 *  the list is complete; `onFirst` runs at the first appearance, between the
 *  first portion and the next. */
async function watchFill(page: Page, onFirst: string | null = null) {
  await page.evaluate(onFirst => {
    const w = window as unknown as Record<string, unknown> & { __fill: { first: number | null; frames: Array<{ n: number; h: number; w: string }>; ran: unknown } };
    w.__fill = { first: null, frames: [], ran: null };
    const f = w.__fill;
    const count = () => document.querySelectorAll(".simPanel tbody tr[data-sim-row]").length;
    const mo = new MutationObserver(() => {
      if (f.first !== null || !count()) return;
      f.first = count();
      mo.disconnect();
      if (onFirst) f.ran = new Function(onFirst)();
      const frame = () => {
        const sc = document.querySelector<HTMLElement>(".simTable");
        if (sc) f.frames.push({ n: count(), h: sc.scrollHeight, w: [...sc.querySelectorAll("thead th")].map(th => th.getBoundingClientRect().width.toFixed(1)).join(",") });
        if (sc?.dataset.listComplete !== "1" || f.frames.length < 2) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    mo.observe(document.querySelector(".simPanel")!, { childList: true, subtree: true });
  }, onFirst);
}
const fillOf = (page: Page) => page.evaluate(() => (window as unknown as { __fill: { first: number | null; frames: Array<{ n: number; h: number; w: string }>; ran: unknown } }).__fill);
const complete = (page: Page) => expect(page.locator(".simPanel .simTable[data-list-complete='1']")).toHaveCount(1);
/** n collisions in timeline order — on line 5 up to the 300th, then on line
 *  30: the later portions bring a wider line label (the columns must not
 *  move for it). */
const hits = (page: Page, n: number, ordinal = 0) => expect.poll(() => page.evaluate(([n, o]) => window.__viewerDiag?.setCollisionHits?.(
  Array.from({ length: n }, (_, k) => ({ line: k < 300 ? 5 : 30, frac: 0.01 + (0.98 * k) / n, ...(o ? { ordinal: o + k } : {}) }))) ?? false, [n, ordinal] as const)).toBe(true);

test("a long list fills in portions: the first at once, the rest a portion a frame — the height and the columns never move (Codex R164 VP-I120)", async ({ page, context }) => {
  await prepare(page, context, "desktop", PREVIEW, false);
  await simShow(page, "clash");
  await watchFill(page);
  await hits(page, 1000);
  await complete(page);
  await expect(rows(page)).toHaveCount(400);
  const f = await fillOf(page);
  expect(f.first, "the first portion, never the whole window at once").toBe(FIRST_ROWS);
  expect(f.frames.length, "a portion a frame").toBeGreaterThanOrEqual(4);
  for (const fr of f.frames.slice(1)) {
    expect(Math.abs(fr.h - f.frames[0]!.h), `the table's height at ${fr.n} rows`).toBeLessThanOrEqual(1);
    expect(fr.w, `the columns at ${fr.n} rows`).toBe(f.frames[0]!.w);
  }
  // the tab stop is a rendered row from the first portion on, and the first row is it
  expect(await rows(page).first().locator(".rowPick").getAttribute("tabindex")).toBe("0");
});

test("between the portions: the keys reach a row not yet rendered, a filter change and a new program begin anew, nothing stale stays (Codex R164 VP-I120)", async ({ page, context }) => {
  await prepare(page, context, "desktop", PREVIEW, false);
  await simShow(page, "clash");
  await jogLive(page);
  // End on the first row at the first portion: the last row of the window is
  // rendered (a portion of its own) and takes the focus — never the page
  await watchFill(page, `const p = document.querySelector(".simPanel tbody tr[data-sim-row] .rowPick"); p.focus();
    p.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true, cancelable: true }));
    return document.querySelectorAll(".simPanel tbody tr[data-sim-row]").length;`);
  await hits(page, 1000);
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("[data-sim-row]")?.getAttribute("data-sim-row") ?? document.activeElement?.tagName))
    .toBe("C0|399|0");
  await complete(page);
  await expect(page.locator('.simPanel [data-sim-row="C0|399|0"] .rowPick'), "the focus stays across the fill").toBeFocused();
  for (const key of ["Home", "ArrowDown", "End", "ArrowUp"]) await page.keyboard.press(key);
  await expect(page.locator('.simPanel [data-sim-row="C0|398|0"] .rowPick')).toBeFocused();
  await page.waitForTimeout(300);
  expect(await jogs(), "no key on a row reached the jog map").toEqual([]);
  // a filter change between the portions: the new list fills, no row of the old one stays
  await simShow(page, "clash");
  await watchFill(page, `const s = document.querySelector('.simPanel select[name="simFilter"]'); s.value = "all"; s.dispatchEvent(new Event("change", { bubbles: true })); return s.value;`);
  await hits(page, 1000, 7000);
  await complete(page);
  const keys = await rowKeys(page);
  expect(keys.length).toBe(400);
  expect(keys.every(k => /^C0\|7\d{3}\|0$/.test(k!) || /^[LT]/.test(k!)), "only the new list's rows").toBe(true);
  // a new program between the portions: the list goes with its result
  await simShow(page, "clash");
  await watchFill(page, `window.__fillProgram = true; return 1;`);
  await hits(page, 1000, 9000);
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5101, file: "/sim.ngc" } });
  await expect.poll(() => rowKeys(page).then(k => k.filter(x => /^C0\|9\d{3}\|0$/.test(x!)).length), { timeout: 15_000 }).toBe(0);
});

test("a moved window keeps the picture: the row shown before stays where it was, then the list glides (plan 4.4)", async ({ page, context }) => {
  await prepare(page, context, "desktop", PREVIEW, false);
  // the list glides (openLayout emulates reduced motion, where it snaps), and
  // the browser's own scroll anchoring is off: the panel keeps the picture
  // itself — a browser without it (Safari) gets the same list
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addStyleTag({ content: ".simPanel .simTable { overflow-anchor: none; }" });
  const N = 1000, key = (k: number) => `C0|${k}|0`;
  await expect.poll(() => page.evaluate(n => window.__viewerDiag?.setCollisionHits?.(
    Array.from({ length: n }, (_, k) => ({ line: 12, frac: 0.01 + (0.98 * k) / n }))) ?? false, N)).toBe(true);
  await simShow(page, "clash");
  // the last row before the window's margin, shown and settled in the middle of the list
  await page.locator(`.simPanel [data-sim-row="${key(349)}"]`).click();
  await expect(page.locator(`.simPanel [data-sim-row="${key(349)}"]`)).toHaveClass(/shownRow/);
  const yOf = (k: string) => page.evaluate(k => {
    const sc = document.querySelector(".simPanel .simTable")!, tr = sc.querySelector(`tr[data-sim-row="${k}"]`);
    return tr ? tr.getBoundingClientRect().top - sc.getBoundingClientRect().top : null;
  }, k);
  let last = NaN;
  await expect.poll(async () => { const y = await yOf(key(349)); const still = y === last; last = y ?? NaN; return still; }, { intervals: [200] }).toBe(true);
  const y0 = last, rowH = await page.locator(`.simPanel [data-sim-row="${key(349)}"]`).evaluate(e => e.getBoundingClientRect().height);
  // every frame from here: where that row is, and whether the window has moved
  await page.evaluate(k => {
    const w = window as any;
    w.__frames = [];
    const tick = () => {
      const sc = document.querySelector(".simPanel .simTable")!, tr = sc.querySelector(`tr[data-sim-row="${k}"]`);
      w.__frames.push({ y: tr ? tr.getBoundingClientRect().top - sc.getBoundingClientRect().top : null,
                        moved: /150 earlier/.test(sc.querySelector(".windowMore")?.textContent ?? "") });
      if (w.__frames.length < 90) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, key(349));
  await simStepBtn(page, "Next collision").click();
  await expect(page.locator(".simPanel .windowMore"), "the next row passed the margin: the window moved").toHaveText(["150 earlier", "450 later"]);
  await expect.poll(() => page.evaluate(() => (window as any).__frames.length)).toBe(90);
  const frames: Array<{ y: number | null; moved: boolean }> = await page.evaluate(() => (window as any).__frames);
  const at = frames.findIndex(f => f.moved);
  expect(at, "a frame after the move").toBeGreaterThan(0);
  expect(Math.abs(frames[at]!.y! - y0), "the first frame after the move: the row where it was").toBeLessThan(3);
  for (let i = at + 1; i < frames.length; i++) {
    expect(Math.abs(frames[i]!.y! - frames[i - 1]!.y!), `frame ${i}: a glide, never a jump`).toBeLessThan(rowH);
  }
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
  await page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([{ line: 12 }]));
  await simShow(page, "clash");
  await page.locator(".simPanel .rowPick").first().focus();
  await page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([]));
  await expect(page.locator(".simPanel tbody tr[data-sim-row]")).toHaveCount(0);
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
  await expect(item).toHaveAttribute("aria-label", "Clear · checked to the end (not certified)");
  await expect(item.locator('span[title^="Not certified"]')).toHaveCount(1);
});

// Codex R78 VP-I38: the steps sorted by position alone — where a tool change,
// a limit and a collision share one moment, "Next on the timeline" went down
// the list and back up. One order for both, ties and the wrap included.
test("the steps through mixed kinds follow the list's own order, ties included", async ({ page, context }) => {
  await prepare(page, context);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(
    // L20's collision where L20's move begins: the tool change and the limit's moment
    [{ line: 12 }, { line: 20, frac: 64 / 116 }, { line: 26, rapid: true }]) ?? false)).toBe(true);
  await simShow(page, "all");
  // the row's kind and line (a collision's key is its identity: pair and number, round B3)
  const list = await rows(page).evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-at")));
  expect(list, "the list: the tool, the limit and the collision of L20 at one moment").toEqual(["T10", "C12", "T20", "L20", "C20", "C26", "L32"]);
  const shownKey = () => page.locator(".simPanel .shownRow").getAttribute("data-sim-at");
  await page.locator('.simPanel tr[data-sim-at="C12"]').click();
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
  await page.locator('.simPanel tr[data-sim-at="C12"]').click();
  await expect(reveal).toHaveText("Toolpath shown for this finding — hidden in Layers");
  await page.locator('.simPanel tr[data-sim-row="T20"]').click();
  await expect(reveal, "a row's tool change ends the reveal").toHaveCount(0);
  // by a step: from the collision the next on the timeline is the tool change
  await page.locator('.simPanel tr[data-sim-at="C12"]').click();
  await expect(reveal).toHaveCount(1);
  await simStepBtn(page, "Next on the timeline").click();
  await expect(page.locator(".simPanel .shownRow")).toHaveAttribute("data-sim-row", "T20");
  await expect(reveal, "a step to a tool change ends it").toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.projectRole!("feed")), { message: "the stored layer stays off" }).toBeNull();
});

// The same on a hidden RAPID (Codex R78 VP-I39: feed and rapid): line 14's
// rapid runs out of the X window; T3 M6 on line 5.
const RAPID_FEED = Array.from({ length: 10 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
const RAPID_PREVIEW = Buffer.from(encode({ file: "/simrapid.ngc", preview_schema: 11, feed: RAPID_FEED,
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
const LONG_PREVIEW = Buffer.from(encode({ file: "/long.ngc", preview_schema: 11, feed: LONG_FEED,
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
  expect(await items.evaluateAll(els => els.map(e => e.getAttribute("aria-label")))).toEqual(["2 collisions · checked in full", "2 limit violations", "2 tool changes"]);
  // wide: the words (the form is measured — Codex R136 VP-I94)
  await expect(page.locator(".simPanel .simSummary")).toHaveAttribute("data-sum-form", "0");
  expect((await items.allInnerTexts()).map(t => t.trim())).toEqual(["2 collisions · checked in full", "2 limit violations", "2 tool changes"]);
  await ctl({ op: "reset" });
  // The gateway's list holds its first 200 records; the summary says the total.
  await prepare(page, context, "touch-portrait", Buffer.from(encode({ ...PREVIEW_FIELDS, violations_total: 9000 })));
  await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
  await settleLayout(page);
  await expect(page.locator(".sidePane.narrow"), "150 % portrait: the narrow pane").toHaveCount(1);
  // Narrow, the move joins the What text BEFORE the note: the limit crossing's
  // note (on every row after L20) never cuts "Rapid" off the line.
  const move = await page.locator(".simPanel tr").filter({ hasText: "L26" }).evaluate(tr => {
    const cell = tr.querySelector(".colWhat")!, inl = tr.querySelector(".moveInline")!;
    const c = cell.getBoundingClientRect(), m = inl.getBoundingClientRect();
    return { shown: getComputedStyle(inl).display !== "none", text: inl.textContent,
      inside: m.right <= c.right - parseFloat(getComputedStyle(cell).paddingRight) + 0.5 };
  });
  expect(move, "narrow: the move whole in its row").toEqual({ shown: true, text: " · Rapid", inside: true });
  expect(await items.evaluateAll(els => els.map(e => e.getAttribute("aria-label"))))
    .toEqual(["2 collisions · checked in full", "9000 limit violations · the first 2 lines listed", "2 tool changes"]);
  // narrow: the other kinds as their numbers — and the result as a count
  // too where its words do not fit (the form is measured); its coverage kept
  const form = await page.locator(".simPanel .simSummary").getAttribute("data-sum-form");
  expect(form, "narrow: a shorter form").not.toBe("0");
  expect((await items.allInnerTexts()).map(t => t.trim()), "narrow: the numbers")
    .toEqual([form === "3" ? "2 · in full" : form === "2" ? "2 · checked in full" : "2 collisions · checked in full", "9000", "2"]);
  for (let i = 0; i < 3; i++) await expect(items.nth(i), "narrow: each item shows").toBeVisible();
  const box = await page.locator(".simPanel .simSummary").evaluate(el => ({ w: el.scrollWidth, cw: el.clientWidth, h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) || 0 }));
  expect(box.w, "narrow: the whole line fits").toBeLessThanOrEqual(box.cw);
  // Codex R82 VP-I42: narrow, the cap was said only in a name and a mouse
  // tooltip. The line's own "?" says it — by keyboard and by a tap.
  const help = page.locator('.simPanel .simSummaryRow [aria-label="Help: Summary"]');
  // the line's whole statement: each kind, the cap explained (Codex R137 VP-I94)
  const said = /^× 2 collisions · checked in full\. ▲ 9000 limit violations, a line and an axis each — the parse sends the first 2; the list shows their 2 lines\. ● 2 tool changes\.$/;
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".helpPopover:popover-open"), "keyboard: the cap in words").toHaveText(said);
  await page.keyboard.press("Enter");
  await expect(page.locator(".helpPopover:popover-open")).toHaveCount(0);
  await help.click();
  await expect(page.locator(".helpPopover:popover-open"), "a tap: the cap in words").toHaveText(said);
});

test("a predicted measurement: the summary's \"?\" says where the toolsetter values come from", async ({ page, context }) => {
  await prepare(page, context, "desktop", Buffer.from(encode({ ...PREVIEW_FIELDS, toollen_table: [[12, 5, 65.04]],
    toolsetter_basis: { state: "assumed", routine: true, values: { "3009": 3 } } })));
  const help = page.locator('.simPanel .simSummaryRow [aria-label="Help: Summary"]');
  await help.click();
  await expect(page.locator(".helpPopover:popover-open")).toContainText(
    "Toolsetter values assumed from the parameter file — not verified.");
});

// M600 in the preview (docs/reviews/m600-preview.plan.md): a tool measurement
// the preview cannot predict bounds every verdict — the summary and its "?"
// say so, the time says there is more, and a tool-change row says where its
// length comes from (the table's, assumed) or why it is not predicted.
test("a tool measurement the preview cannot predict: the summary, the time and the rows say what is not known", async ({ page, context }) => {
  await prepare(page, context, "desktop", Buffer.from(encode({ ...PREVIEW_FIELDS,
    // [seq, tool, …, the verified call line] (Codex R105 VP-I63)
    probe_unpredicted: [[20, 3, "length", 10]], toollen_table: [[12, 5, 65.04, 20]] })));
  const items = page.locator(".simPanel .simSummary [role=img]");
  await expect(items.nth(1)).toHaveAttribute("aria-label", "2 limit violations · checked to the tool measurement");
  await expect(page.locator(".simPanel .simSummary .sumLimit .text-warn")).toHaveText("*");
  const help = page.locator('.simPanel .simSummaryRow [aria-label="Help: Summary"]');
  await help.click();
  // the stop first — it bounds all three — then the line's whole statement
  await expect(page.locator(".helpPopover:popover-open")).toHaveText(new RegExp(
    "^Tool measurement not predicted \\(T3 has no length in the table\\): from there no path, no time, no collision or limit check\\. "
    + "× .+\\. ▲ 2 limit violations · checked to the tool measurement\\. ● 2 tool changes\\.$"));
  await help.click();
  const pos = await page.locator(".scrubBar .posSlot").evaluate(e => ({
    text: (e as HTMLElement).innerText, whole: e.scrollWidth <= e.clientWidth + 1, title: e.getAttribute("title") }));
  expect(pos.text, "the total is the time to the measurement").toMatch(/^\d\d:\d\d\/\d\d:\d\d\+$/);
  expect(pos.whole, "the slot holds the +").toBe(true);
  expect(pos.title).toMatch(/after it unknown/);
  await expect(page.locator('.simPanel [data-sim-row="T10"] .colWhat')).toContainText("measurement not predicted: T3 has no length in the table");
  await expect(page.locator('.simPanel [data-sim-row="T20"] .colWhat')).toContainText("65.040 mm from the table (assumed)");
  await expect(page.locator(".simPanel")).not.toContainText(/\bmeasured\b/);
});

// Codex R105 VP-I63: a note belongs to its CALL — a measurement whose call
// line is not verified (two M600 lines) is on no row of its tool: Program
// Stats lists it, the summary's "?" says where.
test("a measurement without a verified call line is on no row: the \"?\" points to Program Stats", async ({ page, context }) => {
  await prepare(page, context, "desktop", Buffer.from(encode({ ...PREVIEW_FIELDS,
    toollen_table: [[12, 5, 65.04, 0]] })));
  await expect(page.locator('.simPanel [data-sim-row="T20"] .colWhat')).toHaveText("Tool change → T5");
  const help = page.locator('.simPanel .simSummaryRow [aria-label="Help: Summary"]');
  await help.click();
  await expect(page.locator(".helpPopover:popover-open")).toContainText("Tool lengths: Program Stats.");
  await help.click();
});

// Codex R83 VP-I43: with a full summary line the "?" sat at the tab
// content's clipping edge and the outer 4 px of its 24 px hit area were cut
// off — a tap there landed on the side pane. The row keeps the reach.
test("the summary's \"?\" answers in its whole hit area, at the right edge of a full line", async ({ page, context }) => {
  // A FULL line: twelve collisions and a sixteen-digit total at 150 %
  // portrait, the window 820 px wide (a 241 px pane) — even the counts and the
  // coverage's fewest words take the line, the coverage gives way, the "?"
  // ends it. (The form is measured since Codex R136/R137 VP-I94: neither a
  // wide pane nor the 900 px portrait fills the line any more.) A ten-digit
  // total fitted in Firefox and the guard never reached its case there (Codex
  // R85 VP-I44); the precondition below stays.
  await prepare(page, context, "touch-portrait", Buffer.from(encode({ ...PREVIEW_FIELDS, violations_total: Number.MAX_SAFE_INTEGER })));
  await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
  await page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(Array.from({ length: 12 }, (_, i) => ({ line: 5 + i }))));
  await page.setViewportSize({ width: 820, height: 1200 });
  await settleLayout(page);
  await expect(page.locator(".simPanel .simSummary")).toHaveAttribute("data-sum-form", "3");
  expect(await page.locator(".simPanel .checkVerdict").evaluate(el => el.scrollWidth > el.clientWidth), "the line is full: the coverage gives way").toBe(true);
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

// Step 4 plan 1c: the card "Check basis" by touch — a tap opens it inside the
// window, the trigger and a tap outside close it, nothing reaches the machine.
test.describe("the check basis card by touch (step 4 plan 1c)", () => {
  test.use({ hasTouch: true });
  test("a tap opens the card in the window; its trigger and a tap outside close it; nothing is sent", async ({ page, context }) => {
    await prepare(page, context, "touch-landscape");
    const trigger = page.getByRole("button", { name: "Check basis", exact: true });
    const card = page.locator(".helpPopover:popover-open");
    await ctl({ op: "clearCmds" });
    await trigger.tap();
    await expect(card).toContainText("The machine when the check started");
    await expect(card).toContainText("Program kinematics");
    await expect(card).toContainText("Work offset");
    const box = (await card.boundingBox())!;
    const vp = page.viewportSize()!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    await trigger.tap();
    await expect(card, "its trigger closes it").toHaveCount(0);
    await trigger.tap();
    await expect(card).toBeVisible();
    await page.touchscreen.tap(5, 5);
    await expect(card, "a tap outside closes it").toHaveCount(0);
    const sent = ((await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] }).cmds ?? []).map(c => c.cmd ?? "")
      .filter(c => !["hello", "heartbeat", "get_tool_table", "timing_log", "tab_visibility"].includes(c));
    expect(sent, "reading the card moves nothing").toEqual([]);
  });
});

// Codex R136 VP-I94: at 1600 × 1000 the side pane is regular (540 px, not
// narrow) — the result words of a mixed result took 709 px, and the coverage
// and the other two kinds fell out of the clipped line. The form is measured:
// whatever the words, every item and the coverage stay in the line, which
// keeps its height. (Round B3: the views read the contact tables, which hold
// every contact — the record list's cap and its words are gone; the
// fixture's findings go in through the seam.)
test.describe("the summary keeps every statement in its line (Codex R136 VP-I94)", () => {
  async function mixed(page: Page) {
    const hits: Array<{ line: number; frac: number; rapid?: boolean; possible?: boolean; near?: number }> =
      [{ line: 12, frac: 0.1, rapid: true }, { line: 16, frac: 0.2, possible: true }, { line: 18, frac: 0.3, near: 1.5 }];
    for (let i = 0; i < 197; i++) hits.push({ line: 19, frac: 0.35 + i * 0.003, rapid: true });
    await expect.poll(() => page.evaluate(h => window.__viewerDiag?.setCollisionHits?.(h) ?? false, hits)).toBe(true);
  }
  const measure = (page: Page) => page.locator(".simPanel .simSummary").evaluate(el => {
    const r = el.getBoundingClientRect();
    const items = [...el.querySelectorAll(".sumItem")].map(e => {
      const b = e.getBoundingClientRect();
      return { text: (e as HTMLElement).innerText.trim(), left: b.left, right: b.right };
    });
    const verdict = el.querySelector(".checkVerdict") as HTMLElement;
    return { form: el.getAttribute("data-sum-form"), left: r.left, right: r.right, sw: el.scrollWidth, cw: el.clientWidth,
      rowH: (el.parentElement as HTMLElement).offsetHeight, items,
      verdictCut: verdict.scrollWidth > verdict.clientWidth + 0.5, pane: document.querySelector(".sidePane")!.clientWidth,
      narrow: document.querySelector(".sidePane")!.classList.contains("narrow") };
  });
  for (const [vp, zoom] of [["desktop", 1], ["touch-landscape", 1], ["touch-portrait", 1.5]] as const) {
    test(`a mixed result of 200 findings — ${vp}${zoom !== 1 ? ` at ${zoom * 100} %` : ""}`, async ({ page, context }) => {
      await prepare(page, context, vp, PREVIEW, false);
      await mixed(page);
      if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
      await settleLayout(page);
      const clash = page.locator(".simPanel .simSummary .sumItem").first();
      await expect(clash, "the fixture's 200 findings").toHaveAttribute("aria-label",
        /^198 collisions · 1 possible contact · 1 near miss · checked in full$/);
      const m = await measure(page);
      expect(m.sw, "the line fits").toBeLessThanOrEqual(m.cw);
      for (const it of m.items) {
        expect(it.left, it.text).toBeGreaterThanOrEqual(m.left - 0.5);
        expect(it.right, it.text).toBeLessThanOrEqual(m.right + 0.5);
      }
      // the other two kinds, whole
      expect(m.items.slice(1).map(x => x.text)).toEqual(m.form === "0" ? ["2 limit violations", "2 tool changes"] : ["2", "2"]);
      // the count and the check's state whole — no ellipsis with ordinary
      // numbers, at 150 % portrait too (Codex R137 VP-I94)
      expect(m.verdictCut, "the collision item whole").toBe(false);
      if (Number(m.form) >= 2) expect(m.items[0]!.text.startsWith("200 "), "the count").toBe(true);
      expect(m.items[0]!.text).toMatch(m.form === "3" ? / · in full$/ : / · checked in full$/);
      if (vp === "desktop") {
        expect(m.narrow, "the regular pane").toBe(false);
        // the result shortened before the coverage: the coverage in words
        expect(m.form).not.toBe("3");
      }
      // the "?" says the line's whole statement — the touch way to what a short form leaves out
      const name = (await clash.getAttribute("aria-label"))!;
      await page.locator('.simPanel .simSummaryRow [aria-label="Help: Summary"]').click();
      const help = page.locator(".helpPopover:popover-open");
      await expect(help).toContainText(name);
      await expect(help).toContainText("2 limit violations");
      await expect(help).toContainText("2 tool changes");
      await page.locator('.simPanel .simSummaryRow [aria-label="Help: Summary"]').click();
      await expect(help).toHaveCount(0);
      // one height whatever the form: the same row with the plain result
      await page.evaluate(() => window.__viewerDiag!.setCollisionHits!([]));
      await expect(page.locator(".simPanel .checkVerdict")).toHaveText(/^Clear/);
      await settleLayout(page);
      expect((await measure(page)).rowH, "the row's height").toBe(m.rowH);
      await ctl({ op: "reset" });
    });
  }
});

// The simulation's beginning (P6-b, machine day 2026-11-21 F11/F10; plan
// maschinentag.r456.p6-plan-v2, agreed by Codex R456). Position 0 of a track
// WITH an entry move is the program's beginning — the machine where it
// stands, nothing run: the code view shows the program's top (line 1, scroll
// 0) with nothing marked and no band, at once (a snap), and the bar's
// readout stays at the start. The scrub fully left used to leave the view on
// the line the drag passed last ("~line 5000"). Back to start (⏮) beside
// Play returns there by a tap — also when the position already stood at 0
// and the code was scrolled away by hand. A null line elsewhere (an
// untrusted point, leaving the simulation) keeps the view where it is; a
// track without an entry move marks its first line at 0. ⏮ enters the
// simulation by Play's own rules: never in a run, never refused entry. Every
// form of the bar keeps its rows inside it; in the two-row form ⏮ takes the
// Sim tab link's room (measured: the link beside it went to a third row).
import { test, expect, type Page, type BrowserContext } from "./test";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";
import { fulfillPreview, publishFile, routeText } from "./programFixture";

// 6001 lines: a comment, one feed point per line 2…6000, M2 (the end's line).
// Points 2400…3599 (lines 2402…3601) carry no line trust: a null line in
// the middle of the program.
const N = 6000;
const FEED = Array.from({ length: N - 1 }, (_, i) => [i % 100, Math.floor(i / 100), -1]);
const LINEOK = new Uint8Array(FEED.map((_, i) => (i >= 2400 && i < 3600 ? 0 : 1)));
// `head` comment lines after the first: the first move's line is head + 2
const preview = (file: string, head = 0) => Buffer.from(encode({ file, preview_schema: 11, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 2 + head), feed_seq: FEED.map((_, i) => i + 2), feed_lineok: LINEOK,
  feed_tcum: new Uint8Array(new Float32Array(FEED.map((_, i) => i * 0.5)).buffer) }));
const textOf = (head = 0) => ["(long)", ...Array.from({ length: head }, (_, i) => `(head ${i + 1})`),
  ...Array.from({ length: N - 1 }, (_, i) => `G1 X${i % 100} Y${Math.floor(i / 100)} Z-1 F1000`), "M2"].join("\n");
const ZERO = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/** The program loaded with the machine OFF, standing away from the first
 *  point (an entry move) — or ON it (`atFirst`: no entry move). Motion as
 *  the operator sees it (no reduced motion): a glide would show. */
async function prepare(page: Page, context: BrowserContext, vp: string,
                       o: { atFirst?: boolean; version?: number; zoom?: number; head?: number } = {}) {
  const file = `/start-${o.version ?? 7300}.ngc`;
  await context.route(/\/preview(\?|$)/, r => fulfillPreview(r, { contentType: "application/octet-stream", body: preview(file, o.head) }));
  await routeText(context, textOf(o.head));
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === vp)!);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const at = o.atFirst ? [0, 0, -1] : [40, 30, 20];
  await ctl({ op: "status_delta", data: { active_file: file, is_enabled: false, enabled: false,
    g5x_offset: ZERO, g92_offset: ZERO, tool_offset: ZERO, rotation_xy: 0, joint_pos: at, actual_position: at } });
  await publishFile(file, o.version ?? 7300);
  await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
  if (o.zoom) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, o.zoom);
  await expect(page.locator(".codeViewer .codeLine").first()).toBeVisible({ timeout: 15_000 });
}
const bar = (page: Page) => page.locator(".viewerPane .scrubBar");
const slider = (page: Page) => bar(page).locator(".sliderInput");
const backBtn = (page: Page) => bar(page).getByRole("button", { name: "Back to start", exact: true });
const simOn = (page: Page) => bar(page).getByRole("checkbox", { name: "Sim", exact: true });
/** A user's move of the thumb: the value and its `input` event. */
async function scrubTo(page: Page, frac: number) {
  await slider(page).evaluate((el, f) => {
    const i = el as HTMLInputElement;
    i.value = String(Number(i.max) * f);
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }, frac);
}
/** The thumb to a line's point: the feed's own seconds (0.5 s a point)
 *  counted back from the end — the entry move's length aside. */
async function scrubToLine(page: Page, line: number) {
  await slider(page).evaluate((el, [l, n]) => {
    const i = el as HTMLInputElement;
    i.value = String(Number(i.max) - (n - l) * 0.5);
    i.dispatchEvent(new Event("input", { bubbles: true }));
  }, [line, N] as const);
}
type View = { first: number | null; last: number | null; active: string | null; band: boolean; scrollTop: number };
/** What the code panel shows: the line numbers in its view, the marked one,
 *  the follow band, the scroll. */
const codeView = (page: Page): Promise<View> => page.evaluate(() => {
  const sc = [...document.querySelectorAll(".codeViewer")].find(e => e.getBoundingClientRect().height > 0)!;
  const r = sc.getBoundingClientRect();
  const nums = [...sc.querySelectorAll(".codeLine")].filter(l => {
    const b = l.getBoundingClientRect();
    return b.bottom > r.top + 1 && b.top < r.bottom - 1;
  }).map(l => Number(l.querySelector(".lineNumber")?.textContent));
  return { first: nums[0] ?? null, last: nums[nums.length - 1] ?? null,
           active: sc.querySelector(".codeLine.active .lineNumber")?.textContent ?? null,
           band: !!sc.querySelector(".codeFollowBand"), scrollTop: sc.scrollTop };
});
/** The code scrolled away by hand — and come to rest (a wheel's scroll may
 *  still run its course: two frames with one position). */
async function scrollAway(page: Page, what: string) {
  await page.locator(".codeViewer").filter({ visible: true }).hover();
  await page.mouse.wheel(0, 60_000);
  await expect.poll(() => page.evaluate(() => new Promise<boolean>(res => {
    const sc = [...document.querySelectorAll(".codeViewer")].find(e => e.getBoundingClientRect().height > 0)!;
    const a = sc.scrollTop;
    requestAnimationFrame(() => requestAnimationFrame(() => res(a > 30_000 && sc.scrollTop === a)));
  })), { message: `${what}: scrolled away by hand, at rest` }).toBe(true);
  expect((await codeView(page)).first, `${what}: away from the top`).toBeGreaterThan(1000);
}
/** A line followed: marked and in view, the step done. */
async function atLine(page: Page, frac: number, line?: number): Promise<View> {
  if (line != null) await scrubToLine(page, line);
  else await scrubTo(page, frac);
  await expect.poll(async () => {
    const v = await codeView(page);
    return v.active != null && v.first! <= Number(v.active) && Number(v.active) <= v.last! && !v.band;
  }, { message: `a line followed at ${line ?? frac}`, timeout: 10_000 }).toBe(true);
  return codeView(page);
}
/** Every frame from the action until the code view's top: the start is a
 *  SNAP — the first frame after it already shows line 1 at scroll 0, nothing
 *  marked, no band (a glide or a band on the way is red). */
async function framesTo(page: Page, act: () => Promise<unknown>, what: string) {
  await page.evaluate(() => {
    const w = window as unknown as { __p6b: { t: number; top: number; band: boolean; active: boolean }[]; __p6bOn: boolean; __p6bAt: number };
    w.__p6b = []; w.__p6bOn = true; w.__p6bAt = Infinity;
    // the action's moment: its click (a button acts on it) or input event
    for (const ev of ["click", "input"]) addEventListener(ev, () => { w.__p6bAt = Math.min(w.__p6bAt, performance.now()); }, { capture: true, once: true });
    const loop = (t: number) => {
      const sc = [...document.querySelectorAll(".codeViewer")].find(e => e.getBoundingClientRect().height > 0);
      if (sc) w.__p6b.push({ t, top: sc.scrollTop, band: !!sc.querySelector(".codeFollowBand"), active: !!sc.querySelector(".codeLine.active") });
      if (w.__p6bOn) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await act();
  await expect.poll(async () => { const v = await codeView(page); return v.first === 1 && v.scrollTop === 0; },
    { message: `${what}: the program's top`, timeout: 10_000 }).toBe(true);
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __p6b: { t: number; top: number; band: boolean; active: boolean }[]; __p6bOn: boolean; __p6bAt: number };
    w.__p6bOn = false;
    return w.__p6b.filter(f => f.t > w.__p6bAt);
  });
  expect(frames.length, `${what}: frames after the action`).toBeGreaterThan(0);
  expect(frames.filter(f => f.top !== 0 || f.band || f.active), `${what}: a snap — every frame at the top, nothing marked, no band`).toEqual([]);
  const v = await codeView(page);
  expect(v, `${what}: line 1 first, scroll 0, nothing marked, no band`).toMatchObject({ first: 1, scrollTop: 0, active: null, band: false });
  await expect(bar(page).locator(".posSlot"), `${what}: the readout at the start`).toHaveText(/^00:00(\/|$)/, { useInnerText: true });
  expect(await page.locator(".simPanel .simLine").evaluate(e => e.textContent), `${what}: the line readout`).toBe("entry");
  expect(Number(await slider(page).inputValue()), `${what}: the timeline at 0`).toBe(0);
}

for (const vp of ["desktop", "touch-fullhd"]) {
  test(`${vp}: the start — middle and end to 0, by the timeline and by Back to start: line 1 at the top, nothing marked, at once`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await prepare(page, context, vp);
    await simOn(page).check();
    // middle → 0 by the timeline
    const mid = await atLine(page, 0.83);
    expect(mid.first, "the middle shows the middle").toBeGreaterThan(4000);
    await framesTo(page, () => scrubTo(page, 0), "middle → 0 (timeline)");
    // end (the M2 line marked) → 0 by the timeline
    await scrubTo(page, 1);
    await expect.poll(async () => (await codeView(page)).active, { message: "the end marks M2" }).toBe("6001");
    await framesTo(page, () => scrubTo(page, 0), "end → 0 (timeline)");
    // middle → 0 by Back to start
    await atLine(page, 0.83);
    await framesTo(page, () => backBtn(page).click(), "middle → Back to start");
    // end → 0 by Back to start
    await scrubTo(page, 1);
    await expect.poll(async () => (await codeView(page)).active, { message: "the end marks M2" }).toBe("6001");
    await framesTo(page, () => backBtn(page).click(), "end → Back to start");
    // at 0 already, the code scrolled away by hand: Back to start returns
    // (an unchanged position must not swallow the return)
    await scrollAway(page, "at 0");
    expect(Number(await slider(page).inputValue()), "the position still at 0").toBe(0);
    await framesTo(page, () => backBtn(page).click(), "Back to start again at 0");
    // twice in a row: the second return comes back too
    await scrollAway(page, "at 0 again");
    await framesTo(page, () => backBtn(page).click(), "Back to start a third time");
    // a line NEAR the top (a step there would glide, with its band): the
    // start is a snap from there too — by the timeline and by Back to start
    for (const [how, act] of [["timeline", () => scrubTo(page, 0)], ["Back to start", () => backBtn(page).click()]] as const) {
      const near = await atLine(page, 0, 40);
      expect(near.scrollTop, `near the top (${how}): the code scrolled`).toBeGreaterThan(0);
      await framesTo(page, act, `line ${near.active} → 0 (${how})`);
    }
  });
}

test("Back to start with the Sim tab open: the Program tab shows the top when it comes back; a height change keeps a scroll by hand", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context, "desktop");
  await simOn(page).check();
  await atLine(page, 0.83);
  await page.getByRole("tab", { name: "Sim", exact: true }).click();
  await expect(page.locator(".simPanel")).toBeVisible();
  await backBtn(page).click();
  await expect(page.locator(".simPanel .simLine"), "the position at the start").toHaveText("entry");
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await expect.poll(() => codeView(page), { message: "the Program tab at the top", timeout: 10_000 })
    .toMatchObject({ first: 1, scrollTop: 0, active: null, band: false });
  // still at the start: the code scrolled by hand, then the view's height
  // changes (a smaller window) — the scroll by hand stays
  await scrollAway(page, "at the start");
  const away = await codeView(page);
  const h0 = await page.locator(".codeViewer").filter({ visible: true }).evaluate(e => e.clientHeight);
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect.poll(() => page.locator(".codeViewer").filter({ visible: true }).evaluate(e => e.clientHeight),
    { message: "the view's height changed" }).not.toBe(h0);
  // the resize observer has run once two frames have passed after the layout
  await page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))));
  const after = await codeView(page);
  expect(after.first, `a height change keeps the scroll by hand: ${JSON.stringify({ away, after })}`).toBeGreaterThan(1000);
});

// Codex R456: a null line ELSEWHERE keeps its meaning — the view stays.
test("counter-controls: a null line in the middle and leaving the simulation keep the view; a re-entry starts at the top", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context, "desktop");
  await simOn(page).check();
  const mid = await atLine(page, 0.83);
  // into the untrusted stretch: no line to show, the view stays
  await scrubTo(page, 0.5);
  await expect(page.locator(".simPanel .simLine"), "the untrusted stretch").toHaveText("···");
  await expect.poll(async () => (await codeView(page)).active, { message: "nothing marked there" }).toBeNull();
  const untrusted = await codeView(page);
  expect(untrusted.first, `the view stays at the middle: ${JSON.stringify({ mid, untrusted })}`).toBe(mid.first);
  expect(untrusted.scrollTop).toBe(mid.scrollTop);
  // leaving the simulation: no line any more, the view stays
  await atLine(page, 0.83);
  const before = await codeView(page);
  await simOn(page).uncheck();
  await expect(page.locator(".simBanner")).toHaveCount(0);
  await expect.poll(async () => (await codeView(page)).active, { message: "the line goes with the simulation" }).toBeNull();
  const left = await codeView(page);
  expect(left.first, `leaving keeps the view: ${JSON.stringify({ before, left })}`).toBe(before.first);
  expect(left.scrollTop).toBe(before.scrollTop);
  // entering again: position 0 — the program's top at once
  await framesTo(page, () => simOn(page).check(), "Sim on again");
});

// The first move on line 302 (300 comment lines before it): past the first
// view, so its line in view is the follow's, not the top's.
test("counter-control: a track without an entry move marks its first line at 0, in view", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context, "desktop", { atFirst: true, version: 7310, head: 300 });
  const first = async (what: string) => {
    await expect.poll(async () => { const v = await codeView(page); return v.active != null && v.first! <= 302 && 302 <= v.last! && !v.band ? v.active : null; },
      { message: `${what}: the first point's line marked and in view` }).toBe("302");
    expect((await codeView(page)).scrollTop, `${what}: not the program's top`).toBeGreaterThan(0);
  };
  await simOn(page).check();
  await first("position 0");
  await expect(page.locator(".simPanel .simLine")).toHaveText(/^L302\b/);
  await atLine(page, 0.83);
  await scrubTo(page, 0);
  await first("back at 0 (timeline)");
  await atLine(page, 0.83);
  await backBtn(page).click();
  await first("Back to start");
});

// Play's entry rules: ⏮ is dimmed with Play in a run and with the machine
// on, and where it is open but the entry is refused (the interpreter not
// idle with the machine off) its press starts nothing.
test("Back to start never begins a simulation in a run: dimmed like Play; an entry refused starts nothing", async ({ page, context }) => {
  test.setTimeout(90_000);
  await prepare(page, context, "desktop");
  const play = bar(page).getByTitle("Play the program through the machine model", { exact: true });
  const noSim = async (what: string) => {
    await expect(page.locator(".simBanner"), `${what}: no simulation`).toHaveCount(0);
    await expect(simOn(page), `${what}: the Sim switch off`).not.toBeChecked();
    expect(await page.evaluate(() => window.__viewerDiag!.getScrubPose!()), `${what}: the model stays live`).toBeNull();
  };
  // a run: the machine on, the interpreter busy
  await ctl({ op: "status_delta", data: { is_enabled: true, enabled: true, task_mode: 2, interp_state: 2 } });
  await expect(play, "in a run Play is dimmed").toBeDisabled();
  await expect(backBtn(page), "in a run Back to start is dimmed like Play").toBeDisabled();
  await noSim("a run");
  // the machine on at idle
  await ctl({ op: "status_delta", data: { task_mode: 1, interp_state: 1 } });
  await expect(backBtn(page), "the machine on: dimmed like Play").toBeDisabled();
  // the machine off, the interpreter not idle: open like Play, the entry refused
  await ctl({ op: "status_delta", data: { is_enabled: false, enabled: false, task_mode: 2, interp_state: 2 } });
  await expect(play, "the machine off: Play open").toBeEnabled();
  await expect(backBtn(page), "open like Play").toBeEnabled();
  await backBtn(page).click();
  await noSim("an entry refused");
  // idle again: Back to start enters the simulation at its start, like Play
  await ctl({ op: "status_delta", data: { task_mode: 1, interp_state: 1 } });
  await framesTo(page, () => backBtn(page).click(), "Back to start from outside the simulation");
  await expect(page.locator(".simBanner")).toBeVisible();
  await expect(simOn(page)).toBeChecked();
});

// The narrow form (a bar under 620 px, two rows): ⏮ beside Play in the first
// row, the link's room; the Sim tab through the side pane.
for (const zoom of [1, 1.5]) {
  test(`portrait ${zoom * 100} %: the two-row bar — Back to start beside Play, no link, the Sim tab in the side pane; the start at the top`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await prepare(page, context, "touch-portrait", { zoom });
    await settleLayout(page);
    const g = await bar(page).evaluate(b => {
      const box = (e: Element | null) => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null; };
      return { w: b.getBoundingClientRect().width, play: box(b.querySelector('button[title^="Play"]')), back: box(b.querySelector('button[aria-label="Back to start"]')),
               speed: box(b.querySelector("select")), link: box(b.querySelector('button[aria-label="Open the Sim tab"]')), slider: box(b.querySelector(".sliderWrap")) };
    });
    const mid = (x: { t: number; b: number }) => (x.t + x.b) / 2;
    expect(g.w, "the two-row form").toBeLessThan(620 * zoom);
    expect(g.back, "Back to start shown").not.toBeNull();
    expect(Math.abs(mid(g.back!) - mid(g.play!)), "Back to start in Play's row").toBeLessThan(4);
    expect(g.back!.l, "right of Play").toBeGreaterThan(g.play!.r);
    expect(g.speed!.l, "the speed right of Back to start").toBeGreaterThan(g.back!.r);
    expect(g.link, "the link's room is Back to start's").toBeNull();
    expect(g.slider!.t, "the timeline below").toBeGreaterThanOrEqual(g.play!.b);
    // the Sim tab through the side pane's navigation
    const tab = page.getByRole("tab", { name: "Sim", exact: true });
    if (await tab.isVisible()) await tab.click();
    else await page.getByRole("combobox", { name: "Side panel" }).selectOption("sim");
    await expect(page.locator(".simPanel"), "the Sim tab reachable").toBeVisible();
    if (await page.getByRole("tab", { name: "Program", exact: true }).isVisible()) await page.getByRole("tab", { name: "Program", exact: true }).click();
    else await page.getByRole("combobox", { name: "Side panel" }).selectOption("gcode");
    await simOn(page).check();
    await atLine(page, 0.83);
    await framesTo(page, () => backBtn(page).click(), `portrait ${zoom * 100} %: Back to start`);
  });
}

// Every form of the bar, measured: its rows inside it (one row; two under
// 620 px), Back to start right of Play, the link only in the one-row form,
// live and dimmed (a dimmed button stands in its .btnTip); a press on Back
// to start moves nothing in the bar.
const FORMS = [["desktop", 1], ["compact", 1], ["touch-landscape", 1], ["touch-portrait", 1], ["touch-portrait", 1.25],
               ["touch-portrait", 1.5], ["touch-fullhd", 1], ["touch-fullhd-window", 1]] as const;
test("every bar form: its rows inside the bar, Back to start right of Play, the link only in one row; a press moves nothing", async ({ page, context }) => {
  test.setTimeout(600_000);
  let version = 7400;
  for (const [vp, zoom] of FORMS) {
    await prepare(page, context, vp, { zoom, version: version++ });
    await settleLayout(page);
    const where = `${vp} ${zoom * 100} %`;
    const form = () => bar(page).evaluate(b => {
      const row = b.querySelector(".scrubRow") as HTMLElement;
      const z = parseFloat(document.documentElement.style.zoom || "1");
      const cs = getComputedStyle(b);
      const br = b.getBoundingClientRect();
      const inner = { l: br.left + (parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)) * z,
                      r: br.right - (parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth)) * z };
      const kids = [...row.children].map(e => ({ e, r: e.getBoundingClientRect() })).filter(k => k.r.width > 0 && k.r.height > 0);
      // a button by its name, any other child by its first class (a title
      // can carry the readout)
      const named = (e: Element) => {
        const btn = e.matches("button") ? e : e.querySelector(":scope > button");
        return (btn && (btn.getAttribute("aria-label") ?? btn.getAttribute("title"))) || e.className.split(" ")[0] || e.tagName;
      };
      // rows: the children's centres, a new row past a 10 px step
      const mids = kids.map(k => (k.r.top + k.r.bottom) / 2).sort((a, c) => a - c);
      const rows = mids.reduce((n, m, i) => (i && m - mids[i - 1]! > 10 * z ? n + 1 : n), mids.length ? 1 : 0);
      const find = (sel: string) => kids.find(k => k.e.matches(sel) || !!k.e.querySelector(sel));
      const play = find('button[title^="Play"], button[title^="Pause"]'), back = find('button[aria-label="Back to start"]');
      return {
        width: (inner.r - inner.l) / z, rows,
        out: kids.filter(k => k.r.left < inner.l - 0.5 || k.r.right > inner.r + 0.5).map(k => named(k.e)),
        overflow: row.scrollWidth - row.clientWidth,
        // where each child stands: across for all (an empty readout slot
        // keeps its width), up and down for the controls (a readout's
        // height is its text's)
        boxes: [...row.children].map(e => ({ e, r: e.getBoundingClientRect() })).filter(k => k.r.width > 0).map(k => {
          const text = k.e.matches(".val-slot, .posSlot");
          return [named(k.e), Math.round(k.r.left), Math.round(k.r.width), text ? null : Math.round(k.r.top), text ? null : Math.round(k.r.height)];
        }),
        backAfterPlay: !!play && !!back && Math.abs((play.r.top + play.r.bottom) - (back.r.top + back.r.bottom)) < 4
          && back.r.left >= play.r.right && back.r.left - play.r.right <= 8.5 * z,
        link: !!find('button[aria-label="Open the Sim tab"]'),
      };
    });
    for (const state of ["live", "dimmed"] as const) {
      if (state === "dimmed") {
        await ctl({ op: "status_delta", data: { is_enabled: true, enabled: true } });
        await expect(backBtn(page), `${where}: the machine on — dimmed`).toBeDisabled();
        await settleLayout(page);
      }
      const f = await form();
      const dump = `${where} ${state}: ${JSON.stringify(f)}`;
      expect(f.rows, `${dump} — rows`).toBe(f.width < 620 ? 2 : 1);
      expect(f.out, `${dump} — every control inside the bar`).toEqual([]);
      expect(f.overflow, `${dump} — no row runs out`).toBeLessThanOrEqual(1);
      expect(f.backAfterPlay, `${dump} — Back to start right of Play`).toBe(true);
      expect(f.link, `${dump} — the link only in one row`).toBe(f.width >= 620);
    }
    // a press on Back to start (the machine off again) moves nothing in the bar
    await ctl({ op: "status_delta", data: { is_enabled: false, enabled: false } });
    await expect(backBtn(page)).toBeEnabled();
    await settleLayout(page);
    const before = (await form()).boxes;
    const b = (await backBtn(page).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    expect((await form()).boxes, `${where}: under the press`).toEqual(before);
    await page.mouse.up();
    await expect(page.locator(".simBanner"), `${where}: the press entered the simulation`).toBeVisible();
    await settleLayout(page);
    expect((await form()).boxes, `${where}: after the click`).toEqual(before);
    await page.evaluate(() => { document.documentElement.style.zoom = ""; });
  }
});

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
// track without an entry move marks its first line at 0. ⏮ sits directly
// LEFT of Play (a player's skip back; the speed stays directly beside Play,
// operator 2026-10-29/31) and enters the simulation by Play's own rules:
// never in a run, never refused entry. Every form of the bar keeps its rows
// inside it; in the two-row form ⏮ takes the Sim tab link's room (measured:
// the link beside it went to a third row). A real touch tap acts like a click
// and sends nothing to the machine.
import { test, expect, type Page, type BrowserContext } from "./test";
import { encode, decode } from "@msgpack/msgpack";
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
                       o: { atFirst?: boolean; version?: number; zoom?: number; head?: number; untrusted?: boolean } = {}) {
  const file = `/start-${o.version ?? 7300}.ngc`;
  await context.route(/\/preview(\?|$)/, r => fulfillPreview(r, { contentType: "application/octet-stream", body: o.untrusted ? Buffer.from(encode({ ...(decode(preview(file, o.head)) as object), lines_untrusted: true, feed_lineok: undefined })) : preview(file, o.head) }));
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
    // each frame stamped when it is read (a frame's own timestamp is its
    // start — earlier than an event handled in it)
    const loop = () => {
      const sc = [...document.querySelectorAll(".codeViewer")].find(e => e.getBoundingClientRect().height > 0);
      if (sc) w.__p6b.push({ t: performance.now(), top: sc.scrollTop, band: !!sc.querySelector(".codeFollowBand"), active: !!sc.querySelector(".codeLine.active") });
      if (w.__p6bOn) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  await act();
  await expect.poll(async () => { const v = await codeView(page); return v.first === 1 && v.scrollTop === 0; },
    { message: `${what}: the program's top`, timeout: 10_000 }).toBe(true);
  // the frames after the action: at least two drawn (a loaded page may reach
  // the top before its next frame — gate round 1 read none)
  await expect.poll(() => page.evaluate(() => {
    const w = window as unknown as { __p6b: { t: number }[]; __p6bAt: number };
    return w.__p6b.filter(f => f.t > w.__p6bAt).length;
  }), { message: `${what}: frames after the action` }).toBeGreaterThanOrEqual(2);
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


// Codex R458: no-entry keeps its first line, including an explicit return
// while the numeric scrub position (and emitted line) already equals zero.
for (const vp of ["desktop", "touch-fullhd"]) test(`Codex R458: repeated return without entry (${vp})`, async ({page,context}, info) => {
  await prepare(page,context,vp,{atFirst:true,version:8490,head:300});
  await simOn(page).check();
  await expect.poll(async()=> (await codeView(page)).active).toBe("302");
  const before=await codeView(page);
  await scrollAway(page,"first point, manual scroll");
  const away=await codeView(page);
  expect(Number(await slider(page).inputValue())).toBe(0);
  await backBtn(page).click();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const after=await codeView(page);
  await info.attach('observations',{body:JSON.stringify({before,away,after},null,2),contentType:'application/json'});
  console.log(JSON.stringify({vp,before,away,after}));
  await expect.poll(async()=>{ const v=await codeView(page); return v.active==='302' && v.first!<=302 && v.last!>=302 && !v.band; },
    {message:'explicit Back to start restores the first marked line to view',timeout:1500}).toBe(true);
});

test("Codex R458: positive repeat with entry and playback stops", async ({page,context})=>{
  await prepare(page,context,"desktop",{version:8491});
  await simOn(page).check();
  await scrollAway(page,"entry at zero");
  await framesTo(page,()=>backBtn(page).click(),"entry explicit return");
  await bar(page).getByTitle("Play the program through the machine model",{exact:true}).click();
  await expect.poll(async()=> Number(await slider(page).inputValue())).toBeGreaterThan(0);
  await framesTo(page,()=>backBtn(page).click(),"return stops playback");
  await expect(bar(page).getByTitle("Play the program through the machine model",{exact:true})).toBeVisible();
});

test("Codex R458: explicit start of a bound program with globally untrusted motion lines", async ({page,context},info)=>{
 await prepare(page,context,"desktop",{version:8492,untrusted:true});
 await simOn(page).check();
 await scrubTo(page,0.83);
 await scrollAway(page,"untrusted lines, manual scroll");
 const away=await codeView(page);
 await backBtn(page).click();
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const after=await codeView(page);
 console.log(JSON.stringify({untrusted:true,away,after}));
 await info.attach('observations',{body:JSON.stringify({away,after}),contentType:'application/json'});
 await expect.poll(()=>codeView(page),{message:'explicit beginning needs program identity, not motion line trust',timeout:1500}).toMatchObject({first:1,scrollTop:0,active:null,band:false});
});

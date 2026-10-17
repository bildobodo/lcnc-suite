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


/** The fill of the list in portions, as the page saw it (Codex R164 VP-I120):
 *  the rows in the DOM at their first appearance (a MutationObserver — before
 *  any frame), then every frame's rows, table height and column widths until
 *  the list is complete; `onFirst` runs at the first appearance, between the
 *  first portion and the next. */
interface Fill { first: number | null; ref: string | null; frames: Array<{ n: number; h: number; w: string; y: number | null; at: number | null }>; ran: unknown }
/** Every frame from the first rendered row of a new list until it is
 *  complete: the rows rendered, the table's height, the column widths, where
 *  the first portion's first row (`ref`) lies in the table's content
 *  (scroll-free: it must never move while the portions arrive) and where row
 *  `track` stands on screen. */
async function watchFill(page: Page, onFirst: string | null = null, track: string | null = null) {
  await page.evaluate(([onFirst, track]) => {
    const w = window as unknown as Record<string, unknown> & { __fill: Fill };
    w.__fill = { first: null, ref: null, frames: [], ran: null };
    const f = w.__fill;
    const trs = () => [...document.querySelectorAll(".simPanel tbody tr[data-sim-row]")];
    const count = () => trs().length;
    // a NEW list: its first row not on screen before (a list already there
    // changes its nodes for other reasons — a readout, a shown row)
    const before = new Set(trs().map(t => t.getAttribute("data-sim-row")));
    const mo = new MutationObserver(() => {
      if (f.first !== null || !trs().some(t => !before.has(t.getAttribute("data-sim-row")))) return;
      f.first = count();
      f.ref = document.querySelector(".simPanel tbody tr[data-sim-row]")!.getAttribute("data-sim-row");
      mo.disconnect();
      if (onFirst) f.ran = new Function(onFirst)();
      const frame = () => {
        const sc = document.querySelector<HTMLElement>(".simTable");
        const tr = sc?.querySelector(`tr[data-sim-row="${f.ref}"]`), tt = track ? sc?.querySelector(`tr[data-sim-row="${track}"]`) : null;
        if (sc) f.frames.push({ n: count(), h: sc.scrollHeight, w: [...sc.querySelectorAll("thead th")].map(th => th.getBoundingClientRect().width.toFixed(1)).join(","),
                                y: tr ? tr.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop : null,
                                at: tt ? tt.getBoundingClientRect().top - sc.getBoundingClientRect().top : null });
        if (sc?.dataset.listComplete !== "1" || f.frames.length < 2) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    mo.observe(document.querySelector(".simPanel")!, { childList: true, subtree: true });
  }, [onFirst, track] as const);
}
const fillOf = (page: Page) => page.evaluate(() => (window as unknown as { __fill: Fill }).__fill);
/** A fill that kept the table still: the first portion, never the whole
 *  window; then in every frame the height (±1 px), the columns and the first
 *  portion's place. */
function expectStillFill(f: Fill, what: string) {
  expect(f.first, `${what}: the first portion, never the whole window at once`).toBe(FIRST_ROWS);
  expect(f.frames.length, `${what}: a portion a frame`).toBeGreaterThanOrEqual(4);
  for (const fr of f.frames.slice(1)) {
    expect(Math.abs(fr.h - f.frames[0]!.h), `${what}: the table's height at ${fr.n} rows`).toBeLessThanOrEqual(1);
    expect(fr.w, `${what}: the columns at ${fr.n} rows`).toBe(f.frames[0]!.w);
    expect(fr.y, `${what}: the first portion's place at ${fr.n} rows`).not.toBeNull();
    expect(Math.abs(fr.y! - f.frames[0]!.y!), `${what}: the first portion's place at ${fr.n} rows`).toBeLessThanOrEqual(1);
  }
}
const complete = (page: Page) => expect(page.locator(".simPanel .simTable[data-list-complete='1']")).toHaveCount(1);
/** A first portion in the MIDDLE of the window — around the 200th row, which
 *  holds the focus (shown, then reached the keyboard's way), when a new result
 *  brings new rows: the focus goes to the row now at its place (R78), the
 *  first portion around it, and the rows above are a spacer of their height
 *  from the first frame on — the portion stands where its rows will stand and
 *  nothing moves while the rest arrives. */
async function midFill(page: Page, what: string) {
  const shown = page.locator('.simPanel [data-sim-row="C0|200|0"]');
  await shown.click();
  await expect(shown).toHaveClass(/shownRow/);
  await shown.locator(".rowPick").focus();
  await expect(shown.locator(".rowPick")).toBeFocused();
  await complete(page);
  await watchFill(page);
  await hits(page, 1000, 5000);
  await complete(page);
  const mid = await fillOf(page), keys = await rowKeys(page);
  expect(keys.length).toBe(400);
  await expect(page.locator(`.simPanel [data-sim-row="${keys[200]}"] .rowPick`), `${what}: the focus on the row now at its place`).toBeFocused();
  expect(keys.indexOf(mid.ref), `${what}: the first portion begins below the window's first row`).toBeGreaterThanOrEqual(FIRST_ROWS);
  expectStillFill(mid, what);
}
/** n collisions in timeline order — on line 5 up to the 300th, then on line
 *  30: the later portions bring a wider line label (the columns must not
 *  move for it). */
const hits = (page: Page, n: number, ordinal = 0) => expect.poll(() => page.evaluate(([n, o]) => window.__viewerDiag?.setCollisionHits?.(
  Array.from({ length: n }, (_, k) => ({ line: k < 300 ? 5 : 30, frac: 0.01 + (0.98 * k) / n, ...(o ? { ordinal: o + k } : {}) }))) ?? false, [n, ordinal] as const)).toBe(true);


import { writeFileSync } from 'node:fs';
for (const vp of ['desktop','touch-portrait']) test(`R165 focus separate from the selected/tab-stop row ${vp}`, async ({page,context}) => {
  await prepare(page,context,vp,PREVIEW,false);
  await simShow(page,'clash'); await hits(page,1000); await complete(page);
  await page.locator('.simPanel [data-sim-row="C0|200|0"] .rowPick').focus();
  await page.evaluate(() => {
    const w=window as any; w.__r165=[];
    const take=() => {
      const sc=document.querySelector('.simTable') as HTMLElement;
      const keys=[...sc.querySelectorAll('[data-sim-row]')].map(e=>e.getAttribute('data-sim-row'));
      w.__r165.push({time:performance.now(),complete:sc.dataset.listComplete,keys,
        stops:[...sc.querySelectorAll('.rowPick[tabindex="0"]')].map(e=>e.closest('[data-sim-row]')?.getAttribute('data-sim-row')),
        active:document.activeElement?.closest('[data-sim-row]')?.getAttribute('data-sim-row'),
        next:sc.querySelector('.nextRow')?.getAttribute('data-sim-row'),
        shown:sc.querySelector('.shownRow')?.getAttribute('data-sim-row')});
    };
    let seen=false;
    const mo=new MutationObserver(()=>{
      if(seen||!document.querySelector('[data-sim-row="C0|5200|0"]'))return;
      seen=true;mo.disconnect();take();
      const frame=()=>{take();if(document.querySelector('.simTable')?.getAttribute('data-list-complete')!=='1')requestAnimationFrame(frame);};
      requestAnimationFrame(frame);
    });
    mo.observe(document.querySelector('.simPanel')!,{childList:true,subtree:true});
  });
  await hits(page,1000,5000); await complete(page);
  await page.waitForTimeout(50);
  const data=await page.evaluate(()=>(window as any).__r165);
  writeFileSync(`${process.env.R165_OUT}/focus-${vp}.json`,JSON.stringify(data,null,2));
  expect(data.length).toBeGreaterThan(2);
  expect(data.every((x:any)=>x.active==='C0|5200|0'),'focus preserved at every portion').toBe(true);
  expect(data.every((x:any)=>x.stops.length===1),'the list has one rendered tab stop at every portion').toBe(true);
});
for (const vp of ['touch-portrait','desktop']) test(`R165 middle portion geometry ${vp} zoom150`,async ({page,context})=>{
  await prepare(page,context,vp,PREVIEW,false);
  await page.addStyleTag({content:':root {zoom:1.5}'});
  await simShow(page,'clash');await hits(page,1000);await complete(page);
  await midFill(page,`${vp} zoom150`);
  writeFileSync(`${process.env.R165_OUT}/geometry-${vp}.json`,JSON.stringify(await fillOf(page),null,2));
});

test('R165 real Tab reaches a row in the filling list',async ({page,context})=>{
  await prepare(page,context,'desktop',PREVIEW,false);
  await simShow(page,'clash');await hits(page,1000);await complete(page);
  await page.locator('.simPanel [data-sim-row="C0|200|0"] .rowPick').focus();
  const before=await page.evaluate(()=>new Promise(resolve=>{
    const mo=new MutationObserver(()=>{
      if(!document.querySelector('[data-sim-row="C0|5200|0"]'))return;
      mo.disconnect();
      (document.querySelector('.listHead .helpIcon') as HTMLElement).focus();
      resolve({complete:document.querySelector('.simTable')?.getAttribute('data-list-complete'),
        stops:document.querySelectorAll('.simTable .rowPick[tabindex="0"]').length,
        active:document.activeElement?.tagName + "." + (document.activeElement as HTMLElement)?.className,time:performance.now()});
    });
    mo.observe(document.querySelector('.simPanel')!,{childList:true,subtree:true});
    window.__viewerDiag!.setCollisionHits!(Array.from({length:1000},(_,k)=>({line:k<300?5:30,frac:.01+.98*k/1000,ordinal:5000+k})));
  }));
  await page.keyboard.press('Tab');
  const after=await page.evaluate(()=>({complete:document.querySelector('.simTable')?.getAttribute('data-list-complete'),
    active:document.activeElement?.tagName + "." + (document.activeElement as HTMLElement)?.className,row:document.activeElement?.closest('[data-sim-row]')?.getAttribute('data-sim-row'),time:performance.now()}));
  await page.keyboard.press('Tab');
  const second=await page.evaluate(()=>({complete:document.querySelector('.simTable')?.getAttribute('data-list-complete'),
    active:document.activeElement?.tagName + '.' + (document.activeElement as HTMLElement)?.className,
    label:document.activeElement?.getAttribute('aria-label'),
    row:document.activeElement?.closest('[data-sim-row]')?.getAttribute('data-sim-row'),time:performance.now()}));
  await complete(page);
  await page.locator('.listHead .helpIcon').focus();
  await page.keyboard.press('Tab');
  const full=await page.evaluate(()=>({active:document.activeElement?.tagName + "." + (document.activeElement as HTMLElement)?.className,row:document.activeElement?.closest('[data-sim-row]')?.getAttribute('data-sim-row')}));
  writeFileSync(`${process.env.R165_OUT}/tab.json`,JSON.stringify({before,after,second,full},null,2));
  expect(full.row,'control: after filling, Tab enters the list').toBe('C0|5000|0');
  expect(after.row,'Tab during filling enters the list too').toBeTruthy();
});
test('R165 changing zoom after the first row-pitch measurement',async ({page,context})=>{
  await prepare(page,context,'desktop',PREVIEW,false);
  await simShow(page,'clash');await hits(page,1000);await complete(page);
  await page.addStyleTag({content:':root {zoom:1.5}'});
  try { await midFill(page,'after changing zoom with a cached pitch'); }
  finally {writeFileSync(`${process.env.R165_OUT}/geometry-zoom-change.json`,JSON.stringify(await fillOf(page),null,2));}
});

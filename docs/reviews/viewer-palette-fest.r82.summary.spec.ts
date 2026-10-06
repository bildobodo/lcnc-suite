// The Simulation tab (operator 2026-10-05, variant A of the renders): the
// scrub bar is ONE row — Sim, play, the timeline, the time — and the
// findings live in the side pane's tab: the collision check with its
// progress, one list of the timeline's marks (× collision, ▲ soft limit,
// ● tool change), a filter, the steps. Stepping through collisions used to
// change the findings row's text width and the bar folded and unfolded under
// the operator's finger; the list's rows are the bar's own targets.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";
import { openSimTab, simLine, simShow, simStepBtn } from "./simTab";

const FEED = Array.from({ length: 130 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
FEED[17]![0] = 110;   // line 20 out of the X window
FEED[29]![0] = 120;   // line 32 out of the X window
const PREVIEW_FIELDS = { file: "/sim.ngc", preview_schema: 10, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.map(p => (p[0]! > 100 ? 1 : 0))),
  feed_tcum: new Uint8Array(new Float32Array(FEED.map((_, i) => i * 4)).buffer),
  violations: [{ line: 20, axis: "X", value: 110, limit: 100, kind: "max" }, { line: 32, axis: "X", value: 120, limit: 100, kind: "max" }],
  violations_total: 2 };
const CAPPED = {...PREVIEW_FIELDS, violations: Array.from({length:100},(_,i)=>['X','Y'].map(axis=>({line:i+8,axis,value:110,limit:100,kind:'max'}))).flat(), violations_total:200636};
const PREVIEW = Buffer.from(encode(CAPPED));
// T3 on line 10; T5 on line 20 — the same moment as line 20's limit
const TEXT = Array.from({ length: 134 }, (_, i) => i === 0 ? "(sim)" : i === 9 ? "T3 M6" : i === 19 ? "T5 M6" : `G1 X${i} F100`).join("\n");

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

test.use({hasTouch:true});
const save=(n:string,d:unknown)=>writeFileSync(`../evidence/viewer-palette-fest.r82.${process.env.R82_BROWSER||'chromium'}-${n}.json`,JSON.stringify(d,null,2)+'\n');
const summary=(page:Page)=>page.locator('.simSummary').evaluate(el=>{
 const box=el.getBoundingClientRect();
 const items=Array.from(el.querySelectorAll<HTMLElement>('.sumItem')).map(s=>{
  const r=s.getBoundingClientRect(),wide=s.querySelector<HTMLElement>('.sumWide')!,short=s.querySelector<HTMLElement>('.sumShort')!;
  return {name:s.getAttribute('aria-label'),text:s.innerText,left:r.left,right:r.right,height:r.height,
   visibleText:getComputedStyle(wide).display==='none'?short.innerText:wide.innerText,
   textWidth:wide.clientWidth,textScroll:wide.scrollWidth,shortShown:getComputedStyle(short).display!=='none',tabIndex:s.tabIndex};
 });
 return {width:el.clientWidth,scrollWidth:el.scrollWidth,height:box.height,left:box.left,right:box.right,
  narrow:el.closest('.sidePane')!.classList.contains('narrow'),listHead:el.parentElement!.querySelector('.listHead')!.getBoundingClientRect().top-box.top,items};
});
test.afterEach(async()=>{await ctl({op:'reset'});});

test('R82: summary stays one line across themes, zoom and counts axes separately from lines',async({page,context})=>{
 await prepare(page,context);
 await expect(page.locator('.sumLimit')).toHaveAttribute('aria-label','200636 limit violations · the first 100 lines listed');
 const measurements=[];
 for(const theme of ['light','dark','hc-light','hc-dark']){
  await page.evaluate(v=>document.documentElement.setAttribute('data-theme',v),theme);
  for(const [width,height,zoom] of [[1600,1000,1],[1600,1000,1.5],[900,1200,1],[900,1200,1.5]]){
   await page.setViewportSize({width:width!,height:height!});
   await page.evaluate(z=>{document.documentElement.style.zoom=String(z);document.documentElement.classList.add('touch-device');},zoom);
   await settleLayout(page);
   measurements.push({theme,zoom,...await summary(page)});
  }
 }
 save('summary-matrix',measurements);
 expect(measurements.every(m=>m.scrollWidth<=m.width+1)).toBe(true);
 expect(measurements.every(m=>Math.max(...m.items.map(i=>i.height))-Math.min(...m.items.map(i=>i.height))<1)).toBe(true);
 await page.locator('.sidePane').screenshot({path:`../evidence/viewer-palette-fest.r82.${process.env.R82_BROWSER||'chromium'}-summary-narrow.png`});
});

test('R82: capped-list explanation is reachable with the keyboard through the existing help',async({page,context})=>{
 await prepare(page,context,'touch-portrait');
 await page.evaluate(()=>document.documentElement.style.zoom='1.5');await settleLayout(page);
 const before=await summary(page),limit=page.locator('.sumLimit');
 const accessible=await page.locator('.simSummary').ariaSnapshot();
 await limit.tap();
 const afterTap={popoverCount:await page.locator('.helpPopover:visible,.btnHint:visible').count(),...await summary(page)};
 await page.getByRole('button',{name:'Help: Timeline list',exact:true}).focus();await page.keyboard.press('Enter');
 const help=page.locator('.helpPopover:visible');await expect(help).toBeVisible();
 const helpText=await help.innerText();
 save('summary-disclosure',{before,accessible,afterTap,helpText});
 await page.locator('.sidePane').screenshot({path:`../evidence/viewer-palette-fest.r82.${process.env.R82_BROWSER||'chromium'}-summary-help.png`});
 expect(helpText,'the existing keyboard/touch help must explain why 200636 violations give only 100 listed lines').toMatch(/first 100|200636|capped|truncat|limited to|records/i);
});

// A fixture at the existing collision worker boundary, not a product edit:
// the result has the documented partial/caveat shape, so the real formatter
// and layout exercise their long verdict without running a costly sweep.
test('R82: a long partial verdict and caveat keep the summary height',async({page,context})=>{
 await page.addInitScript(()=>{
  const Native=window.Worker;
  window.Worker=class extends Native{
   constructor(url:URL|string,options?:WorkerOptions){
    super(url,options);
    this.addEventListener('message',(e:MessageEvent)=>{
     const result=e.data?.result;
     if(result&&'pairCount' in result){
      result.truncated={covered:.99,reason:'time'};
      result.uncertified='R82 fixture: incomplete collision certification';
     }
    });
   }
  };
 });
 await prepare(page,context);
 await page.evaluate(()=>window.__viewerDiag?.setCollisionHits?.(Array.from({length:30},(_,i)=>({line:i+10,frac:(i+1)/100}))));
 await expect(page.locator('.checkVerdict')).toHaveText('30 collisions in 99 % swept');
 const measurements=[];
 for(const [width,height,zoom] of [[1600,1000,1],[900,1200,1.5]]){
  await page.setViewportSize({width:width!,height:height!});
  await page.evaluate(z=>{document.documentElement.style.zoom=String(z);document.documentElement.classList.add('touch-device');},zoom);
  await settleLayout(page);measurements.push({zoom,...await summary(page)});
 }
 save('summary-partial',measurements);
 expect(measurements.every(m=>m.scrollWidth<=m.width+1)).toBe(true);
 expect(measurements.map(m=>m.height/m.zoom!)).toEqual([18,18]);
});

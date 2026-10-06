import {writeFileSync} from 'node:fs';
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


test.use({hasTouch:false});
test('R85: guard fixture geometry and actual outer click before and after padding removal',async({page,context})=>{
 const help=page.getByRole('button',{name:'Help: Summary',exact:true});
 const card=page.locator('.helpPopover:popover-open');
 const rows=[];
 for(const total of [1234567890,Number.MAX_SAFE_INTEGER]){
  const width=1600;
  await prepare(page,context,'desktop',Buffer.from(encode({...PREVIEW_FIELDS,violations_total:total})));
  await page.evaluate(()=>window.__viewerDiag?.setCollisionHits?.(Array.from({length:12},(_,i)=>({line:5+i,frac:(2+i)/29}))));
  await settleLayout(page);
  for(const padding of ['as-built','without-padding']){
   if(padding==='without-padding')await page.locator('.simSummaryRow').evaluate(el=>(el as HTMLElement).style.paddingInlineEnd='0px');
   await settleLayout(page);
   const m=await help.evaluate(el=>{
    const r=el.getBoundingClientRect(),tab=el.closest('.tab-content')!.getBoundingClientRect();
    const limit=el.closest('.simPanel')!.querySelector<HTMLElement>('.sumLimit .sumWide')!;
    const hit=parseFloat(getComputedStyle(el,'::before').width),z=r.width/(el as HTMLElement).offsetWidth,reach=(hit*z-r.width)/2;
    const x=r.right+reach-1,y=(r.top+r.bottom)/2,got=document.elementFromPoint(x,y);
    return {x,y,reach,tabRight:tab.right,glyphRight:r.right,clipped:limit.scrollWidth>limit.clientWidth,limitClient:limit.clientWidth,limitScroll:limit.scrollWidth,reaches:!!got&&(got===el||el.contains(got))};
   });
   await page.mouse.click(m.x,m.y);
   const opened=(await help.getAttribute('aria-expanded'))==='true'?1:0;
   const openText=await card.allTextContents();
   // Reset only the diagnostic popover between independent taps.
   await card.evaluateAll(els=>els.forEach(el=>(el as HTMLElement).hidePopover()));
   rows.push({total,width,padding,...m,opened,openText});
   if(padding==='without-padding')await page.locator('.simSummaryRow').evaluate(el=>(el as HTMLElement).style.paddingInlineEnd='');
  }
 }
 writeFileSync(`../evidence/viewer-palette-fest.r85.${process.env.R85_BROWSER||'firefox'}-edge-control.json`,JSON.stringify(rows,null,2)+'\n');
 expect(rows.filter(r=>r.padding==='as-built').every(r=>r.reaches&&r.opened===1)).toBe(true);
 expect(rows.find(r=>r.total===Number.MAX_SAFE_INTEGER&&r.padding==='as-built')!.clipped).toBe(true);
 expect(rows.find(r=>r.total===Number.MAX_SAFE_INTEGER&&r.padding==='without-padding')!.opened).toBe(0);
 await ctl({op:'reset'});
});

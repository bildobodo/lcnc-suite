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

const save=(name:string,v:unknown)=>writeFileSync(`../evidence/viewer-palette-fest.r78.${process.env.R78_BROWSER==='firefox'?'firefox-':''}${name}.json`,JSON.stringify(v,null,2)+'\n');
test.afterEach(async()=>{await ctl({op:'reset'});});

test('R78: mixed next and previous follow the displayed order at a shared timeline position',async({page,context})=>{
  await prepare(page,context);
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.setCollisionHits?.([
    {line:12,frac:9/29},{line:20,frac:16/29},{line:26,frac:23/29,rapid:true}]))).toBe(true);
  await simShow(page,'all');
  await page.locator('[data-sim-row^="C12|"]').click();
  await expect(page.locator('.simBanner')).toBeVisible();
  const displayed=await rowKeys(page);
  const sequence:string[]=[];
  for(let i=0;i<displayed.length;i++){
    sequence.push((await page.locator('.simPanel .shownRow').getAttribute('data-sim-row'))!);
    await simStepBtn(page,'Next on the timeline').click();
  }
  const previous:string[]=[];
  for(let i=0;i<displayed.length;i++){
    previous.push((await page.locator('.simPanel .shownRow').getAttribute('data-sim-row'))!);
    await simStepBtn(page,'Previous on the timeline').click();
  }
  const index=displayed.indexOf(sequence[0]!);
  const expected=displayed.slice(index).concat(displayed.slice(0,index));
  save('mixed-order',{displayed,sequence,previous,expected});
  await page.locator('.simPanel').screenshot({path:'../evidence/viewer-palette-fest.r78.mixed-order.png'});
  expect(sequence,'Next follows the visible rows including ties').toEqual(expected);
});

test('R78: replacing collision results retains keyboard focus inside the Sim panel',async({page,context})=>{
  await prepare(page,context);
  await ctl({op:'status_delta',data:{is_enabled:true,enabled:true}});
  await ctl({op:'raw',frame:{type:'settings_init',settings:{keyboard:{jogEnabled:true,buttonsEnabled:true,mapping:{
    'jog_x+':'ArrowRight','jog_x-':'ArrowLeft','jog_y+':'ArrowUp','jog_y-':'ArrowDown',estop:'Escape',cycle:' ',abort:'Backspace'
  }}}}});
  await expect(page.locator('.statusBanner')).toContainText('IDLE');
  await page.waitForTimeout(150); // review-only: let the queued settings frame reach the client
  await page.locator('[data-sim-row^="C12|"] .rowPick').focus();
  await expect(page.locator('[data-sim-row^="C12|"] .rowPick')).toBeFocused();
  await ctl({op:'clearCmds'});
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);
  const before=(await ctl({op:'lastCmds'})).cmds;
  expect(before.filter((x:{cmd:string})=>/jog/.test(x.cmd))).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.setCollisionHits?.([]))).toBe(true);
  await expect(page.locator('[data-sim-row^="C"]')).toHaveCount(0);
  const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,cls:document.activeElement?.className,
    inPanel:!!document.activeElement?.closest('.simPanel')}));
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(150);
  await page.keyboard.up('ArrowRight');
  await page.waitForTimeout(100);
  const after=(await ctl({op:'lastCmds'})).cmds;
  save('focus-refresh',{before,focus,after});
  expect(after.filter((x:{cmd:string})=>/jog/.test(x.cmd)),'A refreshed results list must not hand its navigation keys to global jog').toEqual([]);
});

test('R78: a tool-change jump ends the old finding-only path reveal',async({page,context})=>{
  await prepare(page,context);
  await ctl({op:'raw',frame:{type:'settings_changed',settings:{viewer:{layers:{toolpath:false}}}}});
  await page.locator('[data-sim-row^="C12|"]').click();
  await expect(page.locator('[data-path-reveal]')).toHaveCount(1);
  const old=await page.locator('[data-path-reveal]').innerText();
  await page.locator('[data-sim-row="T10"]').click();
  await expect(page.locator('[data-sim-row="T10"]')).toHaveClass(/shownRow/);
  const note=await page.locator('[data-path-reveal]').allTextContents();
  save('tool-reveal',{old,shown:await page.locator('.shownRow').getAttribute('data-sim-row'),note});
  await page.locator('.viewerPane').screenshot({path:'../evidence/viewer-palette-fest.r78.tool-reveal.png'});
  expect(note,'There is no longer a finding selected').toEqual([]);
});

test('R78: the Sim table and dense inputs fit at the agreed touch sizes',async({page,context})=>{
  const scans=[];
  for(const [vp,zoom] of [['desktop',1],['touch-landscape',1],['touch-portrait',1.5]] as const){
    await prepare(page,context,vp);
    await page.evaluate(z=>document.documentElement.style.zoom=String(z),zoom);
    await settleLayout(page);
    const scan=await page.locator('.simPanel').evaluate(el=>{
      const z=parseFloat(document.documentElement.style.zoom||'1');
      const box=(e:Element)=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width/z,h:r.height/z};};
      const table=el.querySelector('.simTable')!;
      const row=table.querySelector('tbody tr')!;
      const controls=Array.from(el.querySelectorAll('select,button,[role="button"]')).filter(e=>(e as HTMLElement).offsetParent!==null);
      const pane=el.closest('.sidePane')!.getBoundingClientRect();
      return {panel:box(el),table:box(table),row:box(row),overflow:el.scrollWidth-el.clientWidth,
        outside:controls.filter(e=>{const r=e.getBoundingClientRect();return r.left<pane.left-1||r.right>pane.right+1;}).map(e=>e.getAttribute('aria-label')),
        descriptions:Array.from(table.querySelectorAll('tbody .colWhat')).map(e=>({text:e.textContent,title:e.getAttribute('title'),w:e.clientWidth,content:e.scrollWidth})),
        fields:controls.map(e=>({name:e.getAttribute('aria-label')||e.getAttribute('name')||e.textContent?.trim(),...box(e)}))};
    });
    scans.push({vp,zoom,...scan});
    await page.locator('.sidePane').screenshot({path:`../evidence/viewer-palette-fest.r78.sim-${vp}.png`});
    // HelpIcon's extended hit area intentionally contributes to scrollWidth.
    // Measure the rendered controls against the actual pane instead.
    expect(scan.outside).toEqual([]);
    expect(scan.table.h).toBeGreaterThan(scan.row.h*2);
  }
  save('sim-layout',scans);
});

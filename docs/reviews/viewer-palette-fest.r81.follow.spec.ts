import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";
import { openSimTab, simShow } from "./simTab";
const LONG_FEED = Array.from({ length: 60 }, (_, i) => [i * 2, i % 2 ? 20 : 0, 0]);
const LONG_PREVIEW = Buffer.from(encode({ file: "/long.ngc", preview_schema: 10, feed: LONG_FEED,
  feed_lines: LONG_FEED.map((_, i) => i + 3), feed_seq: LONG_FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(LONG_FEED.length),
  feed_tcum: new Uint8Array(new Float32Array(LONG_FEED.map((_, i) => i * 4)).buffer),
  violations: Array.from({ length: 50 }, (_, i) => ({ line: i + 8, axis: "X", value: 110, limit: 100, kind: "max" })),
  violations_total: 50 }));
const LONG_TEXT = Array.from({ length: 64 }, (_, i) => i === 0 ? "(long)" : `G1 X${i} F100`).join("\n");


const save=(name:string,data:unknown)=>writeFileSync(`../evidence/viewer-palette-fest.r81.${process.env.R81_BROWSER||'chromium'}-${name}.json`,JSON.stringify(data,null,2)+'\n');
async function prepare(page:Page,context:BrowserContext){
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:LONG_PREVIEW}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:LONG_TEXT}));
 await openLayout(page,PROFILES[0]!,VIEWPORTS[0]!);
 await ctl({op:'status_delta',data:{active_file:'/long.ngc',is_enabled:false,enabled:false,g5x_offset:[0,0,0,0,0,0,0,0,0],g92_offset:[0,0,0,0,0,0,0,0,0],tool_offset:[0,0,0,0,0,0,0,0,0],rotation_xy:0,joint_pos:[0,0,0]}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:8100,file:'/long.ngc'}});
 await simShow(page,'limit');
 await expect(page.locator('[data-sim-row="L57"]')).toBeAttached();
}
const scrub=(page:Page,f:number)=>page.locator('.scrubBar .sliderInput').evaluate((el:HTMLInputElement,at)=>{el.value=String(Number(el.max)*at);el.dispatchEvent(new Event('input',{bubbles:true}));},f);
const view=(page:Page)=>page.locator('.simTable').evaluate(sc=>{
 const tr=sc.querySelector<HTMLElement>('tr.shownRow,tr.nextRow'), head=sc.querySelector('thead')!.getBoundingClientRect(),box=sc.getBoundingClientRect(),r=tr?.getBoundingClientRect();
 return {key:tr?.dataset.simRow,scrollTop:sc.scrollTop,height:sc.clientHeight,headBottom:head.bottom,boxBottom:box.bottom,rowTop:r?.top,rowBottom:r?.bottom,rowH:r?.height??0,inView:!!r&&r.top>=head.bottom-1&&r.bottom<=box.bottom+1,offCentre:r?Math.abs((r.top+r.bottom)/2-(head.bottom+box.bottom)/2):99999,focus:document.activeElement?.getAttribute('aria-label'),pageY:window.scrollY};
});
async function centered(page:Page){await expect.poll(async()=>{const v=await view(page);return v.inView&&v.offCentre<=v.rowH;}).toBe(true);}
test.afterEach(async()=>{await ctl({op:'reset'});});

test('R81: follow catches up on reopening, resizing and zoom without moving focus',async({page,context})=>{
 await prepare(page,context);await page.locator('[data-sim-row="L8"]').click();
 const snapshots=[];
 await page.getByRole('tab',{name:'Program',exact:true}).click();
 await scrub(page,.75);await openSimTab(page);await centered(page);snapshots.push({phase:'reopen',...await view(page)});
 await expect(page.getByRole('tab',{name:'Sim',exact:true})).toBeFocused();
 await page.setViewportSize({width:900,height:1200});
 await page.evaluate(()=>{document.documentElement.classList.add('touch-device');document.documentElement.style.zoom='1.5';});
 await settleLayout(page);await centered(page);snapshots.push({phase:'portrait150',...await view(page)});
 await page.getByRole('combobox',{name:'Playback speed'}).focus();
 await page.emulateMedia({reducedMotion:'no-preference'});await scrub(page,.35);await centered(page);snapshots.push({phase:'smooth',...await view(page)});
 await expect(page.getByRole('combobox',{name:'Playback speed'})).toBeFocused();
 save('follow-transitions',snapshots);await page.locator('.sidePane').screenshot({path:`../evidence/viewer-palette-fest.r81.${process.env.R81_BROWSER||'chromium'}-follow.png`});
});

test('R81: the list follows mock run positions without simulation or focus movement',async({page,context})=>{
 await prepare(page,context);await page.getByRole('combobox',{name:'Show on the list'}).focus();
 await ctl({op:'status_delta',data:{is_enabled:true,enabled:true,interp_state:2,task_mode:2}});
 const samples=[];
 let previous=(await view(page)).key;
 for(const idx of [10,30,42]){
  await ctl({op:'status_delta',data:{joint_pos:LONG_FEED[idx],motion_line:idx+3}});
  await expect.poll(async()=>(await view(page)).key).not.toBe(previous);
  await centered(page);samples.push({idx,...await view(page)});previous=samples.at(-1)!.key;
 }
 await expect(page.locator('.simBanner')).toHaveCount(0);
 await expect(page.getByRole('combobox',{name:'Show on the list'})).toBeFocused();
 save('run-follow',samples);
 expect(new Set(samples.map(s=>s.key)).size).toBe(3);
});

test('R81: continuous normal-motion playback keeps the current marker visible',async({page,context})=>{
 await prepare(page,context);await page.emulateMedia({reducedMotion:process.env.R81_REDUCED?'reduce':'no-preference'});
 await page.setViewportSize({width:1280,height:800});await settleLayout(page);
 await page.locator('.scrubBar input.toggle').check();await expect(page.locator('.simBanner')).toBeVisible();
 await scrub(page,.15);await centered(page);
 await page.getByRole('combobox',{name:'Playback speed'}).selectOption('100');
 await page.locator('.scrubBar [title="Play the program through the machine model"]').click();
 const samples=[]; const started=Date.now(); let captured=false;
 for(let i=0;i<42;i++){
  await page.waitForTimeout(50);const sample={at:Date.now()-started,...await view(page)};samples.push(sample);
  if(process.env.R81_CAPTURE&&!captured&&sample.rowTop!=null&&sample.rowTop>sample.boxBottom+50){
   captured=true; await page.locator('.sidePane').screenshot({path:`../evidence/viewer-palette-fest.r81.${process.env.R81_BROWSER||'chromium'}-playback-hidden.png`});
  }
 }
 save('playback'+(process.env.R81_REDUCED?'-reduced':process.env.R81_CAPTURE?'-capture':''),samples);
 // Allow transient lag during a glide; sustained loss for >500 ms is not following.
 let since:number|null=null,longest=0;
 for(const s of samples){
  if(s.key&&!s.inView){if(since==null)since=s.at;longest=Math.max(longest,s.at-since);}else since=null;
 }
 expect(longest,'the followed marker must not remain clipped or outside for over 500 ms').toBeLessThanOrEqual(500);
});

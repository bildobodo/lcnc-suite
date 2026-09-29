// Codex R34: actual joints establish an entry track; synthetic preview, own mock only.
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { encode } from '@msgpack/msgpack';
import { writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';
const OUT = process.env.R34_EVIDENCE || '../evidence';
async function prepare(page:Page,context:BrowserContext,entry:boolean,short:boolean,close=false) {
 const feed=[[0,0,0],[0,10,0],[10,10,0]];
 const payload={file:'/targets.ngc',preview_schema:9,feed,feed_lines:[7,7,8],feed_seq:[1,2,3],
   feed_outside:new Uint8Array([0,1,0]),rapid:[],
   ...(short?{feed_tcum:new Uint8Array(new Float32Array([0,1,close?1.005:1.0001,2]).buffer)}:{}),
   violations:[{line:7,axis:'Y',value:short?0.01:10,limit:short?0.005:5,kind:'max'},...(close?[{line:8,axis:'X',value:20,limit:15,kind:'max'}]:[])],violations_total:close?2:1};
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode(payload))}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:Array.from({length:10},(_,i)=>`G1 X${i} F100`).join('\n')}));
 await openLayout(page,PROFILES[0]!,VIEWPORTS.find(v=>v.name==='desktop')!);
 await ctl({op:'status_delta',data:{active_file:'/targets.ngc',joint_pos:[entry?-100:0,0,0],actual_position:[entry?-100:0,0,0],
   g5x_offset:[0,0,0],g92_offset:[0,0,0],tool_offset:[0,0,0],rotation_xy:0,is_enabled:false,enabled:false}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:2032,file:'/targets.ngc'}});
 await expect(page.locator('.scrubBar [aria-label="Next limit violation"]')).toBeVisible();
 await page.evaluate(()=>window.__viewerDiag!.setViewDirection!([0,0,1]));
 await ctl({op:'raw',frame:{type:'settings_changed',settings:{viewer:{layers:{toolpath:false,rapids:false}}}}});
 await expect.poll(()=>page.evaluate(()=>window.__viewerDiag!.projectRole!('feed'))).toBeNull();
 return payload;
}
async function read(page:Page) {
 return {line:await page.locator('.scrubBar .lineSlot').textContent(),
  slider:await page.locator('.scrubBar .sliderInput').evaluate((el:HTMLInputElement)=>({value:el.value,max:el.max})),
  reveal:await page.locator('[data-path-reveal]').allTextContents(),
  roles:await page.evaluate(()=>Object.fromEntries(['feed','rapid','limit'].map(role=>[role,window.__viewerDiag!.projectRole!(role)]))),
  simulation:await page.locator('.simBanner').isVisible()};
}
for(const mode of ['entry'] as const) {
 test(`R34 limit keeps program origin when its first line spans multiple points`,async({page,context})=>{
  const payload=await prepare(page,context,mode==='entry',mode==='short-time'||mode==='close-targets',mode==='close-targets');
  const before=await read(page);
  await page.locator('.scrubBar [aria-label="Next limit violation"]').click();
  await expect(page.locator('.simBanner')).toBeVisible();
  await page.waitForTimeout(150);
  const first=await read(page);
  await page.screenshot({path:`${OUT}/r34.limit-origin-${mode}.png`});
  await page.locator('.scrubBar [aria-label="Next limit violation"]').click();
  const second=await read(page);
  writeFileSync(`${OUT}/r34.limit-origin-${mode}.json`,JSON.stringify({mode,payload,before,first,second},null,2)+'\n');
  expect(first.line,'First click must show the requested line, including after constructing the entry track').toMatch(/^L7\b/);
  expect(first.roles.feed,'The finding itself must be revealed').not.toBeNull();
  expect(Number(first.slider.value),'The program finding starts AFTER the 100 mm entry move').toBeGreaterThan(100);
  expect(Number(first.slider.value),'The sample stays inside the 10 mm program move').toBeLessThan(110);

 });
}

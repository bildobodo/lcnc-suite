import fs from 'node:fs';
import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {decode,encode} from '@msgpack/msgpack';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS} from './layout-fixtures';
import {openSimTab,simShow} from './simTab';
const DIR='/tmp/codex-r180-97htg9m6';
const TEXT='G21 G90\nG0 X0 Y0 Z0\no<r177_child> call\nG1 X20 F100\nG1 X30\nG1 X40\nM2\n';
async function prepare(page:Page,context:BrowserContext,payload:string,text:string){
 const raw=decode(fs.readFileSync(payload)) as any;raw.file='/sim.ngc';
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode(raw))}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:text}));
 await openLayout(page,PROFILES[0]!,VIEWPORTS[0]!);
 await ctl({op:'status_delta',data:{active_file:'/sim.ngc',is_enabled:false,enabled:false}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:5178,file:'/sim.ngc'}});
 await expect(page.locator('.scrubBar')).toBeVisible();await openSimTab(page);await simShow(page,'limit');
 await expect(page.locator('.simPanel [data-sim-row]')).toHaveCount(1);
 return raw;
}
const codeMarks=(page:Page)=>page.locator('.codeLine.violation').evaluateAll(els=>els.map(e=>({line:e.querySelector('.lineNumber')?.textContent,text:e.querySelector('.lineContent')?.textContent,title:e.getAttribute('title')})));
for(const which of ['legacy','unmarked'] as const)test(`Codex R178: ${which} limit has no invented main-file code mark`,async({page,context})=>{
 const text=which==='unmarked'?TEXT.replace('r177_child','lim_child').replace('G1 X30','(a comment)'):TEXT;
 const file=which==='legacy'?'/home/cnc/lcnc-suite/docs/reviews/viewer-palette-fest.r177.codex-native.msgpack':'../scripts/test_fixtures/limit_origin_payloads/lim_unmarked.msgpack';
 const raw=await prepare(page,context,file,text);
 const row=await page.locator('.simPanel [data-sim-row]').innerText();
 await page.getByRole('tab',{name:'Program',exact:true}).click();await expect(page.locator('.codeLine').first()).toBeVisible();
 const marks=await codeMarks(page);fs.writeFileSync(`${DIR}/marks-${which}.json`,JSON.stringify({violation:raw.violations[0],row,marks},null,2));
 await page.screenshot({path:`${DIR}/marks-${which}.png`,fullPage:true});
 expect(marks,'no main-file location is known; in the unmarked case L5 is only a comment').toEqual([]);
});
test('Codex R178: the original native R177 case now jumps to the subroutine move',async({page,context})=>{
 await prepare(page,context,`${DIR}/native.msgpack`,TEXT);
 const row=page.locator('.simPanel [data-sim-row]');await expect(row).toContainText('L3');await row.locator('.rowPick').click();await expect(page.locator('.simBanner')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.getScrubPose?.()?.cum)).toBeCloseTo(6.001,2);
 const pose=await page.evaluate(()=>window.__viewerDiag?.getScrubPose?.());fs.writeFileSync(`${DIR}/native-browser.json`,JSON.stringify({row:await row.innerText(),pose},null,2));
 await page.getByRole('tab',{name:'Program',exact:true}).click();const marks=await codeMarks(page);expect(marks.map(x=>x.line?.trim())).toEqual(['3']);
});
test('Codex R178: a capped run list says that later violating stretches have no band',async({page,context})=>{
 const raw=await prepare(page,context,`${DIR}/cap.msgpack`,'G21 G90\nG0 X0 Y0 Z0\n#1=0\no100 while [#1 LT 40]\no<lim_child> call\nG0 Z1\n#1=[#1+1]\no100 endwhile\nM2\n');
 const rows=await page.locator('.simPanel [data-sim-row]').innerText();
 const bands=await page.locator('.scrubBand.limit').count();
 await page.locator('.simPanel [aria-label="Help: Summary"]').click();
 const help=await page.locator('.helpPopover:popover-open').allTextContents();
 fs.writeFileSync(`${DIR}/cap-browser.json`,JSON.stringify({record:raw.violations[0],bands,rows,help},null,2));
 await page.screenshot({path:`${DIR}/cap-browser.png`,fullPage:true});
 expect(rows+' '+help.join(' '),'32 of 40 stretches: the UI must expose omitted bands').toMatch(/32|40|stretch|band.*(limit|cap|omit)/i);
});

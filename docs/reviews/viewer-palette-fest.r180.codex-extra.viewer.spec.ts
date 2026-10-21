import fs from 'node:fs';
import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {decode,encode} from '@msgpack/msgpack';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS} from './layout-fixtures';
import {simShow} from './simTab';
const DIR='/tmp/codex-r180-97htg9m6';
async function begin(page:Page,context:BrowserContext,read:()=>any,text:string){
 await context.route(/\/preview(\?|$)/,r=>{const raw={...read(),file:'/sim.ngc'};return r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode(raw))});});
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:text}));
 await openLayout(page,PROFILES[0]!,VIEWPORTS[0]!);
 await ctl({op:'status_delta',data:{active_file:'/sim.ngc',is_enabled:false,enabled:false}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:5179,file:'/sim.ngc'}});
 await expect(page.locator('.scrubBar')).toBeVisible();
}
test('Codex R179: cap words describe a multi-axis row rather than only one record',async({page,context})=>{
 const raw=decode(fs.readFileSync(`${DIR}/two-axes.msgpack`)) as any;
 await begin(page,context,()=>raw,'G21 G90\nG0 X0 Y0 Z0\n#100=0\no100 while [#100 LT 80]\no<lim_child> call\n#100=[#100+1]\no100 endwhile\nM2\n');
 await simShow(page,'limit');const row=page.locator('.simPanel [data-sim-row]');await expect(row).toHaveCount(1);
 const text=await row.innerText(),bands=await page.locator('.scrubBand.limit').count();
 await page.locator('.simPanel [aria-label="Help: Summary"]').click();
 const help=await page.locator('.helpPopover:popover-open').innerText();
 fs.writeFileSync(`${DIR}/two-axes-browser.json`,JSON.stringify({records:raw.violations.map((v:any)=>({axis:v.axis,nruns:v.nruns,sent:v.runs.length})),bands,row:text,help},null,2));
 await page.screenshot({path:`${DIR}/two-axes-browser.png`,fullPage:true});
 expect(bands).toBe(64);
 const m=/timeline shows the first (\d+) of (\d+) stretches/.exec(text);
 if(m)expect(Number(m[1]),'the row has 64 disjoint timeline bands').toBe(bands);
 else expect(text+' '+help).toMatch(/axis|axes|limited|omitted/i);
});
test('Codex R179: code marks follow replacement and clear without an old-program mark',async({page,context})=>{
 let raw=decode(fs.readFileSync(`${DIR}/native.msgpack`)) as any;
 await begin(page,context,()=>raw,'G21 G90\nG0 X0 Y0 Z0\no<r177_child> call\nG1 X20 F100\nG1 X30\nG1 X40\nM2\n');
 const marks=page.locator('.codeLine.violation .lineNumber');await expect(marks).toHaveText(['3']);
 raw={...raw,violations:raw.violations.map(({runs,nruns,sub,site,...v}:any)=>v)};
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:5180,file:'/sim.ngc'}});
 await simShow(page,'limit');await expect(page.locator('.simPanel [data-sim-row]')).toContainText('place not known');
 await page.getByRole('tab',{name:'Program',exact:true}).click();await expect(marks).toHaveCount(0);
 raw=decode(fs.readFileSync(`${DIR}/native.msgpack`)) as any;
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:5181,file:'/sim.ngc'}});await expect(marks).toHaveText(['3']);
 raw={...raw,feed:[],rapid:[],feed_lines:[],rapid_lines:[],violations:[],violations_total:0};
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:5182,file:'/sim.ngc'}});await expect(marks).toHaveCount(0);
 fs.writeFileSync(`${DIR}/marks-lifecycle.json`,JSON.stringify({steps:['bound L3','legacy no mark','bound L3','empty no mark'],passed:true},null,2));
});

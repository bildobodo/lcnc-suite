import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {encode} from '@msgpack/msgpack';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS,settleLayout} from './layout-fixtures';
const OUT='/tmp/codex-r239-rqpnnrp6';
const FEED=Array.from({length:30},(_,i)=>[i*3,i%2?20:0,0]);
const TEXT=Array.from({length:34},(_,i)=>i===9?'T3 M6':i===19?'T5 M6':`G1 X${i} F100`).join('\n');
async function prepare(page:Page,context:BrowserContext,seconds:number,vp:string,unknown=false){
 const stats={feedMoves:30,rapidMoves:0,linearMoves:30,arcMoves:0,feedDist:1,rapidDist:0,linearDist:1,arcDist:0,feedTime:seconds,rapidTime:0,totalTime:seconds,feedRates:[100],toolChanges:2,toolsUsed:[3,5],unit:'mm',fileSize:1};
 const data={file:'/r237.ngc',preview_schema:11,feed:FEED,feed_lines:FEED.map((_,i)=>i+3),feed_seq:FEED.map((_,i)=>i+3),
 rapid_rate:1,feed_tcum:new Uint8Array(new Float32Array(FEED.map((_,i)=>i*seconds/29)).buffer),stats,
 ...(unknown?{probe_unpredicted:[[20,3,'length',10]]}: {})};
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode(data))}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:TEXT}));
 await openLayout(page,PROFILES[1],VIEWPORTS.find(v=>v.name===vp)!);
 await ctl({op:'status_delta',data:{active_file:'/r237.ngc',enabled:false,is_enabled:false}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:7237,file:'/r237.ngc'}});
 await expect(page.locator('.scrubBar')).toBeVisible({timeout:15000});
 await page.getByRole('tab',{name:'Sim',exact:true}).click();
 await expect(page.locator('.simPanel .checkVerdict')).toBeVisible({timeout:30000});
 await settleLayout(page);
}
const barSnapshot=(page:Page)=>page.locator('.scrubBar').evaluate(el=>{
 const box=(s:string)=>{const r=el.querySelector(s)!.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};};
 const slot=el.querySelector('.posSlot') as HTMLElement;
 const cs=getComputedStyle(slot);
 const details=Array.from(slot.querySelectorAll('span')).map(x=>({text:x.textContent,w:x.getBoundingClientRect().width,display:getComputedStyle(x).display}));
 return {slider:box('.sliderWrap'),slot:box('.posSlot'),play:box('button'),select:box('select'),link:box('.simTabLink'),
   font:{family:cs.fontFamily,size:cs.fontSize,weight:cs.fontWeight,variant:cs.fontVariantNumeric,kerning:cs.fontKerning},details,
   max:Number((el.querySelector('.sliderInput') as HTMLInputElement).max),
   text:slot.innerText,title:slot.title,template:slot.querySelector('.alt')?.textContent,
   whole:slot.scrollWidth<=slot.clientWidth+1,sim:document.querySelector('.simPanel .simTime')?.textContent};
});


const payload=(seconds:number,file='/r237.ngc',distance=false)=>({file,preview_schema:11,
 feed:distance?[[0,0,0],[4000,0,0]]:FEED,
 feed_lines:distance?[3,4]:FEED.map((_,i)=>i+3),feed_seq:distance?[3,4]:FEED.map((_,i)=>i+3),
 ...(distance?{}:{feed_tcum:new Uint8Array(new Float32Array(FEED.map((_,i)=>i*seconds/29)).buffer)}),rapid_rate:1,
 stats:{feedMoves:30,rapidMoves:0,linearMoves:30,arcMoves:0,feedDist:4000,rapidDist:0,linearDist:4000,arcDist:0,
 feedTime:seconds,rapidTime:0,totalTime:seconds,feedRates:[100],toolChanges:2,toolsUsed:[3,5],unit:'mm',fileSize:1}});
async function publish(page:Page,context:BrowserContext,data:ReturnType<typeof payload>,version:number){
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode(data))}));
 await ctl({op:'status_delta',data:{active_file:data.file}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version,file:data.file}});
 await expect.poll(()=>page.locator('.scrubBar .sliderInput').getAttribute('max')).toBe(data.feed.length===2?'4000':String(data.stats.totalTime));
 await settleLayout(page);
}
async function programClock(page:Page){
 await page.getByRole('tab',{name:'Program',exact:true}).click();
 const t=await page.locator('.elapsedLabel').innerText();
 await page.getByRole('tab',{name:'Sim',exact:true}).click();
 return t;
}

test('R239 publication while Sim is open: reset, then grow from the new entry',async({page,context})=>{
 await prepare(page,context,7200,'desktop');
 await ctl({op:'status_delta',data:{joint_pos:[-50,0,0,0,0]}});
 await page.waitForTimeout(200);
 await page.locator('.scrubBar input.toggle').check();
 await expect(page.locator('.simBanner')).toBeVisible();
 await expect.poll(()=>page.locator('.scrubBar .posSlot').innerText()).toBe('0:00:00/2:00:50');
 const old=await barSnapshot(page);
 await publish(page,context,payload(3580,'/next.ngc'),7238);
 await expect(page.locator('.simBanner')).toBeHidden();
 const fresh=await barSnapshot(page),freshClock=await programClock(page);
 expect(fresh.text).toBe('00:00/59:40');expect(freshClock).toBe('00:00');
 await page.locator('.scrubBar input.toggle').check();
 await expect(page.locator('.simBanner')).toBeVisible();
 await expect.poll(()=>page.locator('.scrubBar .posSlot').innerText()).toBe('0:00:00/1:00:30');
 const entry=await barSnapshot(page),entryClock=await programClock(page);
 expect(entryClock).toBe('0:00:00');
 writeFileSync(`${OUT}/active-publication.json`,JSON.stringify({old,fresh,freshClock,entry,entryClock},null,2));
});
test('R239 distance axis without an estimate forgets the old hours form',async({page,context})=>{
 await prepare(page,context,7200,'desktop');
 await ctl({op:'status_delta',data:{joint_pos:[-50,0,0,0,0]}});
 await page.waitForTimeout(200);
 await page.locator('.scrubBar input.toggle').check();
 await expect(page.locator('.simBanner')).toBeVisible();
 const next:any=payload(120,'/untimed.ngc',true);delete next.stats;
 await publish(page,context,next,7238);
 await expect(page.locator('.simBanner')).toBeHidden();
 const bar=await barSnapshot(page),clock=await programClock(page);
 writeFileSync(`${OUT}/distance-no-estimate.json`,JSON.stringify({bar,clock},null,2));
 expect(bar.text).toBe('0 %');expect(clock).toBe('00:00');
});
test.afterAll(async()=>{await ctl({op:'reset'});});

import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {encode} from '@msgpack/msgpack';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS,settleLayout} from './layout-fixtures';
const OUT='/tmp/codex-r238-5zz6_vg6';
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
for(const c of [{name:'same file after Sim',entry:true,file:'/r237.ngc'},{name:'other file after Sim',entry:true,file:'/short.ngc'},
 {name:'same file without Sim',entry:false,file:'/r237.ngc'}]) test(`R238 a new publication resets the form: ${c.name}`,async({page,context})=>{
 await prepare(page,context,7200,'desktop');
 if(c.entry){
  await ctl({op:'status_delta',data:{joint_pos:[-50,0,0,0,0]}});
  await page.waitForTimeout(200);
  await page.locator('.scrubBar input.toggle').check();
  await expect(page.locator('.simBanner')).toBeVisible();
  await page.locator('.scrubBar input.toggle').uncheck();
  await expect(page.locator('.simBanner')).toBeHidden();
  await settleLayout(page);
 }
 const before=await barSnapshot(page);
 await publish(page,context,payload(120,c.file),7238);
 const after=await barSnapshot(page),clock=await programClock(page);
 writeFileSync(`${OUT}/publication-${c.entry?'entry':'base'}-${c.file==='/short.ngc'?'other':'same'}.json`,JSON.stringify({before,after,clock},null,2));
 expect.soft(after.text,'the new 120-second program takes its own form').toBe('00:00/02:00');
 expect.soft(clock,'the Program clock takes the new publication\'s form').toBe('00:00');
});
test('R238 a distance fallback never sets an hours form from millimetres',async({page,context})=>{
 await prepare(page,context,120,'desktop');
 await publish(page,context,payload(120,'/distance.ngc',true),7238);
 const bar=await barSnapshot(page),clock=await programClock(page);
 writeFileSync(`${OUT}/distance-form.json`,JSON.stringify({bar,clock,estimateSeconds:120,lengthMm:4000},null,2));
 expect(bar.text).toMatch(/%$/);
 expect(clock,'4000 mm is not 4000 seconds').toBe('00:00');
});
test('R238 the hidden forms bound mixed digits',async({page,context})=>{
 await prepare(page,context,6960,'desktop');
 const result=await page.locator('.posSlot').evaluate(el=>{
  const slot=el.getBoundingClientRect().width;
  const span=document.createElement('span');span.style.cssText='position:absolute;visibility:hidden;white-space:nowrap';el.append(span);
  let max=0,maxText='',count=0;
  for(let s=0;s<=6960;s+=17){
   const h=Math.floor(s/3600),m=String(Math.floor(s%3600/60)).padStart(2,'0'),ss=String(s%60).padStart(2,'0');
   span.textContent=`~${h}:${m}:${ss}/1:56:00`;
   const w=span.getBoundingClientRect().width;if(w>max){max=w;maxText=span.textContent;}count++;
  }
  span.remove();return {slot,max,maxText,count};
 });
 writeFileSync(`${OUT}/mixed-digits.json`,JSON.stringify(result,null,2));
 expect(result.max).toBeLessThanOrEqual(result.slot);
});
test.afterAll(async()=>{await ctl({op:'reset'});});

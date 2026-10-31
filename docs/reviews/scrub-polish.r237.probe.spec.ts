import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {encode} from '@msgpack/msgpack';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS,settleLayout} from './layout-fixtures';
const OUT='/tmp/codex-r237-ymzu9z_z';
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

for(const cfg of [
 {name:'short',seconds:116,vp:'desktop',zoom:1,unknown:false},
 {name:'two-hour',seconds:6960,vp:'desktop',zoom:1,unknown:false},
 {name:'30h-unknown',seconds:108000,vp:'desktop',zoom:1,unknown:true},
 {name:'30h-narrow-unknown',seconds:108000,vp:'touch-portrait',zoom:1.5,unknown:true},
]) test(`R237 stable time slot: ${cfg.name}`,async({page,context})=>{
 await prepare(page,context,cfg.seconds,cfg.vp,cfg.unknown);
 if(cfg.zoom!==1){await page.evaluate(z=>document.documentElement.style.zoom=String(z),cfg.zoom);await settleLayout(page);}
 await page.locator('.scrubBar input.toggle').check();
 await expect(page.locator('.simBanner')).toBeVisible();
 await settleLayout(page);
 const initial=await barSnapshot(page); const records:unknown[]=[{state:'sim start',...initial}];
 for(const frac of [0.01,0.25,0.75,1,0]){
   await page.locator('.scrubBar .sliderInput').evaluate((el:HTMLInputElement,f)=>{el.value=String(Number(el.max)*f);el.dispatchEvent(new Event('input',{bubbles:true}));},frac);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const now=await barSnapshot(page);records.push({state:`scrub ${frac}`,...now});
   expect(now.slider,`slider at ${frac}`).toEqual(initial.slider);expect(now.slot,`slot at ${frac}`).toEqual(initial.slot);expect(now.whole).toBe(true);
   expect(now.sim).toBe(now.title.startsWith('The time')?now.sim:now.title);
 }
 await page.locator('.scrubBar input.toggle').uncheck();
 await expect(page.locator('.simBanner')).toBeHidden();
 await settleLayout(page);
 const beforeRun=await barSnapshot(page);
 await ctl({op:'status_delta',data:{enabled:true,is_enabled:true,interp_state:2,task_mode:2,motion_line:4,program_elapsed_ms:20000}});
 await expect.poll(()=>page.locator('.scrubBar .posSlot').innerText()).toMatch(/^~/);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const run=await barSnapshot(page); records.push({state:'before run',...beforeRun},{state:'run',...run});
 // A change of track/entry basis is separately visible in max; only a fixed basis claims fixed width.
 writeFileSync(`${OUT}/${cfg.name}.json`,JSON.stringify(records,null,2));
 if(run.max===beforeRun.max){expect.soft(run.slot.w, `run-start width: ${beforeRun.text} -> ${run.text}`).toBe(beforeRun.slot.w);expect.soft(run.slider, 'timeline stays still at run start').toEqual(beforeRun.slider);}
 expect(run.whole).toBe(true);
 writeFileSync(`${OUT}/${cfg.name}.json`,JSON.stringify(records,null,2));
});

test('R237 a program close to one hour: Program and Sim use one time form',async({page,context})=>{
 await prepare(page,context,3580,'desktop');
 await ctl({op:'status_delta',data:{joint_pos:[-50,0,0,0,0]}});
 await page.waitForTimeout(200);
 await page.locator('.scrubBar input.toggle').check();
 await expect(page.locator('.simBanner')).toBeVisible();
 await settleLayout(page);
 const bar=await barSnapshot(page);
 const times=await page.locator('.simPanel tbody .colAt').allInnerTexts();
 await page.getByRole('tab',{name:'Program',exact:true}).click();
 const elapsed=await page.locator('.elapsedLabel').innerText();
 const record={statsTotal:3580,bar,rows:times,elapsed};
 writeFileSync(`${OUT}/hour-boundary.json`,JSON.stringify(record,null,2));
 await page.screenshot({path:`${OUT}/hour-boundary.png`});
 const barsColons=bar.text.split('/')[0]!.split(':').length;
 expect(elapsed.split(':').length,'one time form for the same loaded program').toBe(barsColons);
});
test.afterAll(async()=>{await ctl({op:'reset'});});

test('R237 rendered widest text diagnostics',async({page,context})=>{
 await prepare(page,context,6960,'desktop');
 const widths=await page.locator('.posSlot .stable-width').evaluate(el=>{
  const span=document.createElement('span');span.style.cssText='position:absolute;visibility:hidden;display:inline-block';el.append(span);
  const results=[];
  for(const kerning of ['auto','none']) {
   span.style.fontKerning=kerning;
   for(const text of ['~1:56:00/1:56:00',...Array.from({length:60},(_,i)=>`~0:00:${String(i).padStart(2,'0')}/1:56:00`)]) {
    span.textContent=text;results.push({kerning,text,width:span.getBoundingClientRect().width});
   }
  }
  span.remove();return results;
 });
 writeFileSync(`${OUT}/text-widths.json`,JSON.stringify(widths,null,2));
});

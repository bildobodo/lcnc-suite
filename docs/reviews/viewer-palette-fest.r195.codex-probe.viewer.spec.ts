import {test,expect} from '@playwright/test';
import {ctl} from './ctl';
import {prepare,basis,builds,setZ,parse,publish,waitDrawn,waitHold,pastDebounce,boxZ} from './r195-codex-support';
import {writeFileSync} from 'node:fs';
const save=(name:string,data:unknown)=>writeFileSync(`/tmp/codex-r195-fd5ymume/${name}.json`,JSON.stringify(data,null,2));

for(const [name,mode] of [['auto-no-run-basis',2],['mdi-active',3]] as const){
 test(`Codex admission: ${name} is not idle and must not hold`,async({page,context})=>{
  await prepare(page,context);
  await ctl({op:'status_delta',envelope:{run_basis:null},data:{task_mode:mode,interp_state:2}});
  await parse(1);
  await setZ(page,-10);await pastDebounce(page);
  const b=await basis(page);save(name,{input:{task_mode:mode,interp_state:2,run_basis:null},basis:b});
  expect(b.hold,'an executing interpreter must not enter a hold').toBe('free');
 });
}

test('Codex: a superseded part-frame reply cannot fulfil the newly adopted payload',async({page,context})=>{
 await prepare(page,context);const n=await builds(page),z=await boxZ(page);
 await page.evaluate(()=>window.__viewerDiag!.holdPartFrameReplies!(true));
 await setZ(page,-10);await pastDebounce(page);
 await publish(101);
 await expect.poll(async()=>JSON.parse((await basis(page)).want!)[1]).toBe(101);
 await pastDebounce(page);
 await page.evaluate(()=>window.__viewerDiag!.holdPartFrameReplies!(false));
 const released=await page.evaluate(()=>window.__viewerDiag!.releasePartFrameReplies!());
 await waitDrawn(page);const b=await basis(page),after=await builds(page),newz=await boxZ(page);
 save('superseded-reply',{released,basis:b,buildsBefore:n,buildsAfter:after,zBefore:z,zAfter:newz});
 expect(released).toBe(2);expect(after).toBe(n+1);expect(JSON.parse(b.drawn!)[1]).toBe(101);expect(newz).toBeCloseTo(z-10,3);
});

test('Codex: unmount cancels the hold deadline and does not create another worker',async({page,context})=>{
 await page.addInitScript(()=>{
  const w=window as any;w.__codexWorkers=[];
  const Real=window.Worker;
  window.Worker=class extends Real{
   private label:string;
   constructor(url:string|URL,opts?:WorkerOptions){super(url,opts);this.label=String(url);w.__codexWorkers.push({kind:'create',url:this.label});}
   terminate(){w.__codexWorkers.push({kind:'terminate',url:this.label});super.terminate();}
  } as typeof Worker;
 });
 await prepare(page,context);await parse(1);await waitHold(page,'parsing');
 await setZ(page,-10);await pastDebounce(page);await parse(null);await waitHold(page,'after_parse');
 const b=await basis(page);
 const before=await page.evaluate(()=>{
  const w=window as any;const app=(document.getElementById('app') as any)?.__vue_app__;
  if(!app)throw Error('Vue root not found');app.unmount();return w.__codexWorkers;
 });
 await page.waitForTimeout(7000);
 const after=await page.evaluate(()=>(window as any).__codexWorkers);
 save('unmount',{basisBeforeUnmount:b,before,after});
 const creates=(arr:any[])=>arr.filter(x=>x.kind==='create'&&x.url.includes('partFrameWorker')).length;
 expect(creates(after),'no delayed part-frame worker after component teardown').toBe(creates(before));
});

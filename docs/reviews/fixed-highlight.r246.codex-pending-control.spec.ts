import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { encode } from '@msgpack/msgpack';
import { writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from './layout-fixtures';
import { simShow } from './simTab';
import { withLimitRuns } from './limitRuns';
const OUT='/tmp/codex-r246-6qxa2x4w';
const SEL='.codeViewer:not(.mdiHistoryList)';
const FEED=Array.from({length:60},(_,i)=>[i*2,i%2?20:0,0]);
const PREVIEW=Buffer.from(encode(withLimitRuns({file:'/long.ngc',preview_schema:11,feed:FEED,feed_lines:FEED.map((_,i)=>i+3),feed_seq:FEED.map((_,i)=>i+3),feed_outside:new Uint8Array(FEED.length),feed_tcum:new Uint8Array(new Float32Array(FEED.map((_,i)=>i*4)).buffer),violations:Array.from({length:50},(_,i)=>({line:i+8,axis:'X',value:110,limit:100,kind:'max'})),violations_total:50})));
async function sim(page:Page,context:BrowserContext){
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:PREVIEW}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:Array.from({length:64},(_,i)=>`G1 X${i} F100`).join('\n')}));
 await openLayout(page,PROFILES[1]!,VIEWPORTS[0]!);await page.emulateMedia({reducedMotion:'no-preference'});await page.setViewportSize({width:1280,height:800});
 await ctl({op:'status_delta',data:{active_file:'/long.ngc',is_enabled:false,enabled:false}});await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:24101,file:'/long.ngc'}});
 await simShow(page,'limit');await expect(page.locator('.simPanel tr[data-sim-row="L57@57"]')).toHaveCount(1,{timeout:15000});await settleLayout(page);
 await page.locator('.simPanel tr[data-sim-row="L8@8"]').click();await expect(page.locator('.simBanner')).toBeVisible();
}
async function scrub(page:Page,f:number){await page.locator('.scrubBar .sliderInput').evaluate((el:HTMLInputElement,f)=>{el.value=String(Number(el.max)*f);el.dispatchEvent(new Event('input',{bubbles:true}));},f);}

test('R245 control after the waiting period: the Sim follow rechecks visibility after a scroll and new target',async({page,context})=>{
 await sim(page,context); const trials:any[]=[];
 for(let trial=0;trial<5;trial++) {
  await scrub(page,.60);await page.waitForTimeout(250);
  trials.push(await page.evaluate(async trial=>{
   const sc=document.querySelector<HTMLElement>('.simPanel .simTable')!;
   const slider=document.querySelector<HTMLInputElement>('.scrubBar .sliderInput')!;
   const wait=(t:number)=>new Promise(r=>setTimeout(r,t));
   const move=(f:number)=>{slider.value=String(Number(slider.max)*f);slider.dispatchEvent(new Event('input',{bubbles:true}));};
   const read=()=>{
    const tr=sc.querySelector<HTMLElement>('tr.shownRow,tr.nextRow');
    const band=sc.querySelector<HTMLElement>('.simFollowBand');
    const hasBand=!!band?.getClientRects().length;
    const r=(hasBand?band:tr)?.getBoundingClientRect();
    const h=sc.querySelector('thead')!.getBoundingClientRect(),v=sc.getBoundingClientRect();
    return{t:performance.now(),key:tr?.dataset.simRow,band:hasBand,top:r?.top,bottom:r?.bottom,head:h.bottom,viewBottom:v.bottom,st:sc.scrollTop,inView:!!r&&r.top>=h.bottom-1&&r.bottom<=v.bottom+1};
   };
   move(.62);await wait(24+trial);
   move(.64);await wait(250);
   const before=read();
   const band=sc.querySelector<HTMLElement>('.simFollowBand');
   const tr=sc.querySelector<HTMLElement>('tr.shownRow,tr.nextRow')!;
   const r=(band?.getClientRects().length?band:tr).getBoundingClientRect(),v=sc.getBoundingClientRect();
   sc.scrollTop-=v.bottom-r.top+r.height;
   const off=read();
   const frames:ReturnType<typeof read>[]=[];
   const start=performance.now();let on=true;let targetAt:number|null=null;
   const sample=()=>{setTimeout(()=>{frames.push(read());if(performance.now()-start>200)on=false;},0);if(on)requestAnimationFrame(sample);};
   // Begin sampling only once the target's DOM update was delivered.
   // Its post-flush follow has had the opportunity to queue its own rAF
   // BEFORE this recorder, so we do not sample a new row before its first follow frame.
   const observer=new MutationObserver(()=>{if(read().key!==before.key){targetAt=performance.now();observer.disconnect();requestAnimationFrame(sample);}});
   observer.observe(sc,{attributes:true,childList:true,subtree:true});
   move(.66);await wait(250);on=false;observer.disconnect();
   return{trial,before,off,targetAt,frames};
  },trial));
 }
 const result=trials.map(t=>({...t,hidden:t.frames.filter((f:any)=>f.key&&f.key!==t.before.key&&!f.inView)}));
 writeFileSync(`${OUT}/sim-pending-control.json`,JSON.stringify(result,null,2));
 console.log('pending Sim',result.map(r=>({trial:r.trial,beforeBand:r.before.band,off:r.off.inView,hidden:r.hidden.length,ms:r.hidden.map((f:any)=>f.t-r.off.t)})));
 expect(result.every(r=>r.targetAt!==null&&r.frames.length>5),'new DOM target observed and multiple frames collected').toBe(true);
 expect(result.every(r=>!r.off.inView),'each trial really scrolls the existing highlight out of view').toBe(true);
 expect(result.flatMap(r=>r.hidden),'the new target snaps instead of waiting with an invisible band').toEqual([]);
});

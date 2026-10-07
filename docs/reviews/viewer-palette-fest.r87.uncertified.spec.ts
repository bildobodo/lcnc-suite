import {test,expect} from '@playwright/test';
import {encode} from '@msgpack/msgpack';
import {writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS,settleLayout} from './layout-fixtures';
import {openSimTab} from './simTab';
const note='damaged: no facet with area — not checked';
for(const pairs of [1,0])test(`missing body remains visibly uncertified with ${pairs} remaining moving pairs`,async({page,context})=>{
 await page.addInitScript(({pairs,note})=>{
  const Base=window.Worker;
  window.Worker=class extends Base {
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);if(String(url).includes('collisionWorker'))this.addEventListener('message',(e:MessageEvent)=>{
    if(e.data.result){Object.assign(e.data.result,{uncertified:note,pairCount:pairs,hits:[],staticContacts:[],coarsened:false,truncated:null});(window as any).__r87WorkerResult=e.data.result;}
   });}
  };
 },{pairs,note});
 const feed=Array.from({length:5},(_,i)=>[i*3,0,0]);
 const preview=Buffer.from(encode({file:'/sim.ngc',preview_schema:10,feed,feed_lines:feed.map((_,i)=>i+3),feed_seq:feed.map((_,i)=>i+3),feed_outside:new Uint8Array(5),feed_tcum:new Uint8Array(new Float32Array([0,4,8,12,16]).buffer),violations:[],violations_total:0}));
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:preview}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:'G21\nG90\nG1 X0 F100\nG1 X3\nG1 X6\nG1 X9\nG1 X12'}));
 await openLayout(page,PROFILES[1]!,VIEWPORTS.find(v=>v.name==='desktop')!);
 await ctl({op:'status_delta',data:{active_file:'/sim.ngc',is_enabled:false,enabled:false}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:8700,file:'/sim.ngc'}});
 await expect.poll(()=>page.evaluate(()=>(window as any).__r87WorkerResult?.uncertified??null),{timeout:30000}).toBe(note);
 await openSimTab(page);await settleLayout(page);
 const summary=page.locator('.simPanel .simSummary .sumItem').first();
 const label=await summary.getAttribute('aria-label'),text=await summary.innerText();
 const warning=await summary.locator('.text-warn').count();
 const help=page.getByRole('button',{name:'Help: Collision check',exact:true});await help.click();
 const helpText=await page.locator('.helpPopover:popover-open').innerText();
 await page.screenshot({path:`../evidence/viewer-palette-fest.r87.uncertified-${pairs}.png`});
 writeFileSync(`../evidence/viewer-palette-fest.r87.uncertified-${pairs}.json`,JSON.stringify({pairs,label,text,warning,helpText,workerResult:await page.evaluate(()=>(window as any).__r87WorkerResult)},null,2)+'\n');
 expect(helpText).toContain(note);expect(label).toContain('not certified');expect(warning).toBeGreaterThan(0);
});

// Codex R35: actual XYZAC geometry, independent entry and program contacts.
import {test,expect} from '@playwright/test';
import {encode} from '@msgpack/msgpack';
import {readFileSync,writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS} from './layout-fixtures';
import {mergeEntryResult} from '../src/viewer/sweepMerge';
import {clashTargets} from '../src/viewer/clashTargets';
const OUT=process.env.R35_EVIDENCE||'../evidence';
const MODEL=new URL('../../examples/sim_config/machine-5axis-xyzac/',import.meta.url);
const machine=JSON.parse(readFileSync(new URL('machine.json',MODEL),'utf8'));
for(const beginsInContact of [false,true]) {
const feed=beginsInContact?[[240,0,-380],[0,0,-380],[240,0,-380],[240,0,-100]]:[[0,0,-380],[240,0,-380],[0,0,-380],[240,0,-380],[240,0,-100]];
const pose=beginsInContact?[0,0,-380,0,0]:[-100,0,-380,0,0];
const shift=beginsInContact?240:100,baseLen=beginsInContact?760:1000;
const payload={file:'/entry-repeat.ngc',preview_schema:9,feed,feed_lines:feed.map((_,i)=>i===feed.length-1?8:7),
 feed_seq:feed.map((_,i)=>i+1),feed_outside:new Uint8Array(feed.length),rapid:[],violations:[],violations_total:0};
test(`R35 separated contacts on the same line remain separate: ${beginsInContact?'contact at first point':'clear first point (control)'}`,async({page,context})=>{
 test.setTimeout(90000);
 // Observe worker results without changing their delivery or content.
 await context.addInitScript(()=>{
  const W=window.Worker;
  (window as any).__r35Results=[];
  window.Worker=class extends W {
   constructor(url:string|URL,opts?:WorkerOptions){super(url,opts);this.addEventListener('message',(e)=>{
    if(e.data?.result?.hits) (window as any).__r35Results.push(JSON.parse(JSON.stringify({id:e.data.id,result:e.data.result})));
   });}
  };
 });
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode(payload))}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:Array.from({length:10},(_,i)=>`G1 X${i} F100`).join('\n')}));
 await context.route('**/xyzac-model/*.stl',r=>r.fulfill({contentType:'application/octet-stream',body:readFileSync(new URL(new URL(r.request().url()).pathname.split('/').pop()!,MODEL))}));
 await openLayout(page,PROFILES[1]!,VIEWPORTS.find(v=>v.name==='desktop')!);
 await ctl({op:'setViewerInit',data:{units:'mm',stl_base_url:'/xyzac-model/',axes:['X','Y','Z','A','C'],parts:machine.parts,
  groups:machine.groups,kinematics:machine.kinematics,workGroup:machine.workGroup,toolGroup:machine.toolGroup}});
 await ctl({op:'status_delta',data:{active_file:'/entry-repeat.ngc',joint_pos:pose,actual_position:pose,
  g5x_offset:Array(9).fill(0),g92_offset:Array(9).fill(0),tool_offset:Array(9).fill(0),rotation_xy:0,is_enabled:false,enabled:false}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:3301,file:'/entry-repeat.ngc'}});
 await expect.poll(()=>page.evaluate(()=>(window as any).__r35Results.some((r:any)=>r.id>0&&r.result.hits.some((h:any)=>h.line===7))),{timeout:60000}).toBe(true);
 const next=page.locator('.scrubBar [aria-label="Next collision"]');
 await expect(next).toBeVisible();await next.click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__r35Results.some((r:any)=>r.id<0)),{timeout:60000}).toBe(true);
 const records=await page.evaluate(()=>(window as any).__r35Results);
 const base=records.findLast((r:any)=>r.id>0&&r.result.hits.some((h:any)=>h.line===7)).result;
 const entry=records.findLast((r:any)=>r.id<0).result;
 const merged=mergeEntryResult(entry,base,shift,baseLen);
 const before=clashTargets(base.hits),after=clashTargets(merged.hits);
 const steps=[];
 for(let i=0;i<after.length+2;i++) {
  steps.push({line:await page.locator('.scrubBar .lineSlot').textContent(),next:await page.locator('.scrubBar .navTarget').last().textContent(),
   pos:await page.locator('.scrubBar .sliderInput').inputValue()});
  await next.click();
 }
 const mode=beginsInContact?'start-contact':'control';
 writeFileSync(`${OUT}/r35.merge-${mode}.json`,JSON.stringify({payload,pose,shift,baseLen,entry,base,merged,before,after,steps},null,2)+'\n');
 await page.screenshot({path:`${OUT}/r35.merge-${mode}.png`});
 // Each of the two body pairs leaves the yoke at X0 and enters it again.
 // The first onset may merge with the entry, but the second is independent.
 expect(before.length,'Two separated onsets per pair on the base program').toBe(4);
 expect(after.length,'Merging the initial continuous contact preserves all later onsets').toBe(4);
});
}

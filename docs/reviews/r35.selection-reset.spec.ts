// Codex R35: actual XYZAC geometry, independent entry and program contacts.
import {test,expect} from '@playwright/test';
import {encode} from '@msgpack/msgpack';
import {readFileSync,writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS} from './layout-fixtures';
import {mergeEntryResult} from '../src/viewer/sweepMerge';
import {clashTargets} from '../src/viewer/clashTargets';
import {targetAfter,sampleCum} from '../src/viewer/findingNav';
const OUT=process.env.R35_EVIDENCE||'../evidence';
const MODEL=new URL('../../examples/sim_config/machine-5axis-xyzac/',import.meta.url);
const machine=JSON.parse(readFileSync(new URL('machine.json',MODEL),'utf8'));
const payload={file:'/entry-repeat.ngc',preview_schema:9,feed:[[0,0,-380],[240,0,-380],[240,0,-100]],
 feed_lines:[7,7,8],feed_seq:[1,2,3],feed_outside:new Uint8Array(3),rapid:[],rapid_rate:300,feed_tcum:new Uint8Array(new Float32Array([0,0.5,1]).buffer),violations:[],violations_total:0};

test('R35 manual scrub away and back permanently ends finding identity',async({page,context})=>{
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
 await ctl({op:'status_delta',data:{active_file:'/entry-repeat.ngc',joint_pos:[300,0,-380,0,0],actual_position:[300,0,-380,0,0],
  g5x_offset:Array(9).fill(0),g92_offset:Array(9).fill(0),tool_offset:Array(9).fill(0),rotation_xy:0,is_enabled:false,enabled:false}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:3301,file:'/entry-repeat.ngc'}});
 await expect.poll(()=>page.evaluate(()=>(window as any).__r35Results.some((r:any)=>r.id>0&&r.result.hits.some((h:any)=>h.line===7))),{timeout:60000}).toBe(true);
 const next=page.locator('.scrubBar [aria-label="Next collision"]');
 await expect(next).toBeVisible();await next.click();
 await expect.poll(()=>page.evaluate(()=>(window as any).__r35Results.some((r:any)=>r.id<0)),{timeout:60000}).toBe(true);
 const records=await page.evaluate(()=>(window as any).__r35Results);
 const base=records.findLast((r:any)=>r.id>0&&r.result.hits.some((h:any)=>h.line===7)).result;
 const entry=records.findLast((r:any)=>r.id<0).result;
 const merged=mergeEntryResult(entry,base,1,1);
 const targets=clashTargets(merged.hits);
 const slider=page.locator('.scrubBar .sliderInput');
 await expect(slider).toHaveAttribute('max','2');
 await expect(slider).toHaveAttribute('step','0.001');
 // Manual origin followed by Next selects the first entry contact. Its
 // sample is exactly one unmodified slider step, so keyboard away/back
 // below returns to the same coordinate without altering the control.
 await slider.fill('0');
 await next.click();
 await expect(slider).toHaveValue('0.001');
 const snapshot=async()=>({line:await page.locator('.scrubBar .lineSlot').textContent(),
  next:await page.locator('.scrubBar .navTarget').last().textContent(),pos:await slider.inputValue()});
 const selected=await snapshot();
 await slider.focus();
 await page.keyboard.press('ArrowRight');
 await expect(slider).toHaveValue('0.002');
 const away=await snapshot();
 await page.keyboard.press('ArrowLeft');
 await expect(slider).toHaveValue('0.001');
 const returned=await snapshot();
 const byPosition=targetAfter(targets,0.001,null)!;
 await next.click();
 const actual=await snapshot();
 writeFileSync(`${OUT}/r35.selection-reset.json`,JSON.stringify({payload,entry,base,targets,selected,away,returned,
  byPosition,expectedSample:sampleCum(byPosition),actual},null,2)+'\n');
 await page.screenshot({path:`${OUT}/r35.selection-reset.png`});
 expect(Number(actual.pos),'After manual movement navigation must use position, not the old selected identity').toBeGreaterThan(1);
});

import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';
const out = new URL('../../evidence/', import.meta.url);
const modelRoot = new URL('../../examples/sim_config/machine-5axis-xyzac/', import.meta.url);
const model = JSON.parse(readFileSync(new URL('machine.json', modelRoot), 'utf8'));
const setup = {touchX:150,touchY:0,touchZ:-300,fastFeed:2000,slowFeed:200,traverseFeed:6000,maxZTravel:180,retractDist:2,spindleZeroHeight:180};
async function ready(page:Page) {
 await page.route('**/r46-model/*.stl', r=>r.fulfill({contentType:'application/octet-stream',
  body:readFileSync(new URL(new URL(r.request().url()).pathname.split('/').pop()!, modelRoot))}));
 await openLayout(page,PROFILES[1]!,VIEWPORTS.find(v=>v.name==='desktop')!);
 await ctl({op:'setViewerInit',data:{units:'mm',stl_base_url:'/r46-model/',axes:['X','Y','Z','A','C'],
  parts:model.parts,groups:model.groups,kinematics:model.kinematics,workGroup:model.workGroup,toolGroup:model.toolGroup,
  machine_bounds:{origin:[-250,-200,-400],size:[500,400,400]}}});
 await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.ready ? window.__viewerDiag.getAppearance?.().parts.length : 0),{timeout:30000}).toBe(model.parts.length);
 await ctl({op:'quiet',on:true});
 await ctl({op:'status_delta',data:{joint_pos:[150,0,-235,0,0],actual_position:[150,0,-235,0,0],
  tool_number:13,tool_length:65,tool_table_z:65,tool_diameter:6,tool_offset:[0,0,65,0,0,0,0,0,0],kins_type:0,
  g5x_offset:Array(9).fill(0),g92_offset:Array(9).fill(0),rotation_xy:0,interp_state:1,
  joint_limits:[[-250,250],[-200,200],[-400,0],[-110,110],[-360,360]]}});
}

test('R46: actual XYZAC part reach segment lengths and two-tone visibility',async({page})=>{
 test.setTimeout(60000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await ready(page);
 await ctl({op:'raw',frame:{type:'settings_changed',settings:{display:{theme:'light'},viewer:{layers:{
  toolsetter:false,reachRoom:false,reachPart:true,hud:false,groundGrid:false,bounds:false,toolpath:false,tool:false,machine:false,workzero:false,backplot:false}}}}});
 await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.projectRoleSegments?.('reachAlt').length??0),{timeout:20000}).toBeGreaterThan(100);
 const states:any[]=[];
 for(const view of ['top','iso']) {
  if(view==='top')await page.evaluate(()=>window.__viewerDiag!.setView!('top'));
  else await page.evaluate(()=>window.__viewerDiag!.setViewDirection!([1,2,.7]));
  for(const theme of ['light','dark']) {
   await ctl({op:'raw',frame:{type:'settings_changed',settings:{display:{theme},viewer:{layers:{toolsetter:false,reachRoom:false,reachPart:true,hud:false,groundGrid:false,bounds:false,toolpath:false,tool:false,machine:false,workzero:false,backplot:false}}}}});
   await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
   await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.projectRoleSegments?.('reachAlt').length??0),{timeout:20000}).toBeGreaterThan(100);
   await page.waitForTimeout(800);
   const state=await page.evaluate(()=>{
    const d=window.__viewerDiag!;const rect=document.querySelector('.viewerPane canvas')!.getBoundingClientRect();
    const all=d.projectRoleSegments!('reachAlt');
    const visible=all.filter(e=>e.x>=rect.left&&e.x<=rect.right&&e.y>=rect.top&&e.y<=rect.bottom);
    const lens=visible.map(e=>e.length).sort((a,b)=>a-b);
    return {palette:d.getPalette!(),camera:d.getCamera!(),rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},
     allCount:all.length,visibleCount:visible.length,segmentsUnder3px:visible.filter(e=>e.length<=3).length,
     min:lens[0],median:lens[Math.floor(lens.length/2)],max:lens.at(-1),shortSegmentExamples:visible.filter(e=>e.length<=3).slice(0,24),longSegmentExamples:visible.filter(e=>e.length>3).slice(0,12)};
   });
   expect(state.visibleCount, 'the reach is actually in the viewer').toBeGreaterThan(100);
   states.push({view,theme,...state});
   await page.locator('.viewerPane').screenshot({path:new URL(`viewer-palette-fest.r46.reach-${view}-${theme}.png`,out).pathname});
  }
 }
 writeFileSync(new URL('viewer-palette-fest.r46.reach.json',out),JSON.stringify({commit:'95aaf08',dashPx:3,states,errors},null,2));
 expect(errors).toEqual([]);
});

test('R46: signed tool offset retains the existing G43 coordinate contract',async({page})=>{
 test.setTimeout(60000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await ready(page);
 await ctl({op:'raw',frame:{type:'settings_changed',settings:{toolsetter:setup,display:{theme:'light'},viewer:{layers:{
  toolsetter:true,reachRoom:false,reachPart:false,hud:true,groundGrid:false,bounds:false,toolpath:false,tool:true,machine:false,workzero:false,backplot:true}}}}});
 await page.evaluate(()=>window.__viewerDiag!.setViewDirection!([0,-1,.18],550));
 const tip=()=>page.evaluate(()=>window.__viewerDiag!.getToolTip!());
 const record=()=>page.evaluate(()=>({tip:window.__viewerDiag!.getToolTip!(),setter:window.__viewerDiag!.getToolsetter!(),backplot:window.__viewerDiag!.getBackplot!()}));
 await expect.poll(async()=>(await tip())?.[2]).toBe(-300);
 const positive=await record();
 await ctl({op:'status_delta',data:{tool_offset:Array(9).fill(0)}});
 await page.waitForTimeout(350);
 const g49=await record();
 await page.locator('.viewerPane').screenshot({path:new URL('sim-toolsetter.r46.contact-g49.png',out).pathname});
 // Exact Gateway payload from original StatusRuntime with scripted STAT, no live connection.
 const status=JSON.parse(readFileSync(new URL('sim-toolsetter.r46.status.json',out),'utf8'));
 const negative=status.cases.find((r:any)=>r.case==='negative');
 await ctl({op:'status_delta',data:{tool_length:negative.tool_length,tool_table_z:negative.tool_table_z,tool_offset:negative.tool_offset,work_pos:negative.work_pos}});
 await page.waitForTimeout(350);
 const negativePose=await record();
 await page.locator('.viewerPane').screenshot({path:new URL('sim-toolsetter.r46.negative-offset.png',out).pathname});

 const followups:any[]=[];
 for(const [name,table,offset,length,want] of [
  ['negative-g49',-65,0,65,-170],['table-sign-only',65,0,65,-300],
  ['zero-table',0,-65,0,-235],['no-table-g43',null,-65,65,-170],['no-table-g49',null,0,0,-235]
 ] as const) {
  await ctl({op:'status_delta',data:{tool_table_z:table,tool_offset:[0,0,offset,0,0,0,0,0,0],tool_length:length}});
  await expect.poll(async()=>(await tip())?.[2],{message:name}).toBe(want);
  const row=await record();expect(row.backplot.segments,'no segment caused by a basis change').toBe(g49.backplot.segments);
  followups.push({name,table,offset,length,want,...row});
 }

 // Keep the marker-reference decision independently visible.
 await ctl({op:'raw',frame:{type:'settings_changed',settings:{toolsetter:{...setup,touchZ:-280}}}});
 await expect.poll(async()=>(await record()).setter?.top[2]).toBe(-280);
 const changedReference=await record();
 writeFileSync(new URL('sim-toolsetter.r46.viewer.json',out),JSON.stringify({commit:'95aaf08',jointZ:-235,positive,g49,
  negativeStatus:negative,negativePose,expectedG43TipZ:negative.work_pos[2],followups,changedReference,errors},null,2));
 expect(errors).toEqual([]);expect(g49.tip).toEqual(positive.tip);expect(g49.backplot).toEqual(positive.backplot);
 expect(negativePose.tip![2], 'G43 using the spindle tool own negative offset: same coordinate convention as before ST-I03').toBe(negative.work_pos[2]);
});

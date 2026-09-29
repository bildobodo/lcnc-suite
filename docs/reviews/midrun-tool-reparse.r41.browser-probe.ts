import { test, expect } from '@playwright/test';
import { encode } from '@msgpack/msgpack';
import { readFileSync, writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';
const out = new URL('../../evidence/', import.meta.url);
const MODEL = new URL('../../examples/sim_config/machine-5axis-xyzac/', import.meta.url);
const machine = JSON.parse(readFileSync(new URL('machine.json', MODEL), 'utf8'));

test('R41: mid-run publication follows position; collision checking resumes on idle', async ({page,context}) => {
 test.setTimeout(60000);
 const file='/r41.ngc';
 const payload=Buffer.from(encode({file,preview_schema:9,
   feed:[[0,0,-100],[0,0,-380],[240,0,-380],[240,0,-100]],feed_lines:[1,6,7,8],
   feed_seq:[1,2,3,4],feed_outside:new Uint8Array(4),rapid:[],violations:[],violations_total:0}));
 await context.route(/\/preview(\?|$)/, r=>r.fulfill({contentType:'application/octet-stream',body:payload}));
 await context.route(/\/gcode(\?|$)/, r=>r.fulfill({contentType:'text/plain',body:Array.from({length:10},(_,i)=>`G1 X${i} F100`).join('\n')}));
 await context.route('**/xyzac-model/*.stl',r=>r.fulfill({contentType:'application/octet-stream',
  body:readFileSync(new URL(new URL(r.request().url()).pathname.split('/').pop()!,MODEL))}));
 await openLayout(page,PROFILES[1]!,VIEWPORTS.find(v=>v.name==='desktop')!);
 await ctl({op:'setViewerInit',data:{units:'mm',stl_base_url:'/xyzac-model/',axes:['X','Y','Z','A','C'],
  parts:machine.parts,groups:machine.groups,kinematics:machine.kinematics,workGroup:machine.workGroup,toolGroup:machine.toolGroup}});
 await ctl({op:'status_delta',data:{active_file:file,joint_pos:[-100,0,0,0,0],actual_position:[-100,0,0,0,0],
  g5x_offset:Array(9).fill(0),g92_offset:Array(9).fill(0),tool_offset:Array(9).fill(0),rotation_xy:0,is_enabled:true,enabled:true,interp_state:1}});
 const publish=async(version:number)=>ctl({op:'raw',frame:{type:'viewer_gcode_ready',version,file}});
 const next=page.locator('.scrubBar [aria-label="Next collision"]');
 const slider=page.locator('.scrubBar .sliderInput');
 const state=async()=>({text:await page.locator('.scrubBar').innerText(),
  playhead:Number(await slider.inputValue()),hits:await next.count(),activeLine:await page.locator('.codeLine.active').allTextContents()});
 await publish(4001);
 await expect(next).toBeVisible({timeout:20000});
 await expect(page.locator('.scrubBar')).not.toContainText('so far');
 const before=await state();
 await ctl({op:'clearCmds'});
 await ctl({op:'quiet',on:true});
 const run={interp_state:2,task_mode:2,motion_line:6,joint_pos:[0,0,-200,0,0],actual_position:[0,0,-200,0,0]};
 await ctl({op:'status_delta',data:run});
 await expect.poll(async()=>Number(await slider.inputValue())).toBeGreaterThan(0);
 await publish(4002);
 await expect(next).toHaveCount(0);
 await page.waitForTimeout(750); // > collision auto timer 400 ms
 await ctl({op:'status_delta',data:{...run,joint_pos:[0,0,-210,0,0],actual_position:[0,0,-210,0,0]}});
 await expect.poll(async()=>Number(await slider.inputValue())).toBeGreaterThan(0);
 await expect(page.locator('.simBanner')).toHaveCount(0);
 const during=await state();
 await ctl({op:'status_delta',data:{interp_state:1,current_vel:0,motion_line:0}});
 await page.waitForTimeout(2500);
 const afterIdle=await state();
 await page.screenshot({path:new URL('midrun-tool-reparse.r41.after-idle.png',out).pathname});
 // Positive control: same program published while idle re-runs the sweep.
 await publish(4003);
 await expect(next).toBeVisible({timeout:20000});
 await expect(page.locator('.scrubBar')).not.toContainText('so far');
 const idleControl=await state();
 const cmds=(await ctl({op:'lastCmds'})).cmds;
 writeFileSync(new URL('midrun-tool-reparse.r41.midrun-client.json',out),JSON.stringify({before,during,afterIdle,idleControl,cmds},null,2));
 await ctl({op:'reset'});
 expect(afterIdle.hits,'a mid-run publication must not leave the automatic collision result absent after idle').toBeGreaterThan(0);
});

test('R41: a refused mid-run parse keeps the old preview visibly stale for another tool', async ({page,context})=>{
 const evidence=JSON.parse(readFileSync(new URL('midrun-tool-reparse.r41.refusal-probe.json',out),'utf8'));
 const file='/refused.ngc';
 const preview=Buffer.from(encode({file,preview_schema:9,
  feed:[[0,0,0],[10,0,0],[10,10,0]],feed_lines:[1,2,3],feed_seq:[1,2,3],rapid:[],
  parse_tlos:evidence.parse_tlos,violations:[],violations_total:0}));
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:preview}));
 await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:'G0 X0\nG1 X10 F100\nG1 Y10\nM2\n'}));
 await openLayout(page,PROFILES[0]!,VIEWPORTS.find(v=>v.name==='desktop')!);
 await ctl({op:'quiet',on:true});
 await ctl({op:'status_delta',data:{active_file:file,interp_state:2,task_mode:2,tool_number:1,tool_length:10,
   g5x_offset:Array(9).fill(0),g92_offset:Array(9).fill(0),rotation_xy:0}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:4101,file}});
 const palette=()=>page.evaluate(()=>window.__viewerDiag!.getPalette!());
 await expect.poll(async()=>(await palette()).drawn.feed).toBeTruthy();
 const fresh=await palette();
 await ctl({op:'raw',frame:{type:'status_delta',data:{},preview_refresh:evidence.during_refresh}});
 await expect.poll(async()=>(await palette()).drawn.feed).not.toBe(fresh.drawn.feed);
 const during=await palette();
 await ctl({op:'raw',frame:{type:'status_delta',data:{},preview_refresh:evidence.after_refresh}});
 await expect(page.locator('.hudWarn').filter({hasText:'Re-parsing'})).toHaveCount(0);
 await page.waitForTimeout(200);
 const after=await palette();
 const warnings=await page.locator('.hudWarn').allTextContents();
 writeFileSync(new URL('midrun-tool-reparse.r41.refusal-client.json',out),JSON.stringify({fresh,during,after,warnings,pipeline:evidence},null,2));
 await page.screenshot({path:new URL('midrun-tool-reparse.r41.refused.png',out).pathname});
 await ctl({op:'reset'});
 expect(after.drawn.feed,'refusal must not make unchanged old preview look fresh').not.toBe(fresh.drawn.feed);
});

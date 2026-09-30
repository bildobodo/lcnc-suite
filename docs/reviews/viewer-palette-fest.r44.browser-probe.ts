import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';
const out = new URL('../../evidence/', import.meta.url);
const modelRoot = new URL('../../examples/sim_config/machine-5axis-xyzac/', import.meta.url);
const model = JSON.parse(readFileSync(new URL('machine.json', modelRoot), 'utf8'));
const setup = {touchX:150,touchY:0,touchZ:-300,fastFeed:2000,slowFeed:200,traverseFeed:6000,maxZTravel:180,retractDist:2,spindleZeroHeight:180};

test('R44: real XYZAC palette, reaches and the setter during G49 measurement', async ({page, context}) => {
 test.setTimeout(90000);
 const errors:string[]=[];
 page.on('pageerror', e=>errors.push(e.message));
 await context.route('**/r44-model/*.stl', r=>r.fulfill({contentType:'application/octet-stream',
  body:readFileSync(new URL(new URL(r.request().url()).pathname.split('/').pop()!, modelRoot))}));
 await openLayout(page,PROFILES[1]!,VIEWPORTS.find(v=>v.name==='desktop')!);
 await ctl({op:'setViewerInit',data:{units:'mm',stl_base_url:'/r44-model/',axes:['X','Y','Z','A','C'],
  parts:model.parts,groups:model.groups,kinematics:model.kinematics,workGroup:model.workGroup,toolGroup:model.toolGroup,
  machine_bounds:{origin:[-250,-200,-400],size:[500,400,400]}}});
 await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.getAppearance?.().parts.length),{timeout:30000}).toBe(model.parts.length);
 await ctl({op:'quiet',on:true});
 await ctl({op:'status_delta',data:{joint_pos:[150,0,-235,0,0],actual_position:[150,0,-235,0,0],
  tool_number:13,tool_length:65,tool_diameter:6,tool_offset:[0,0,65,0,0,0,0,0,0],kins_type:0,
  g5x_offset:Array(9).fill(0),g92_offset:Array(9).fill(0),rotation_xy:0,interp_state:1,
  joint_limits:[[-250,250],[-200,200],[-400,0],[-110,110],[-360,360]]}});
 const states:any[]=[];
 for(const theme of ['light','dark','hc-light','hc-dark']){
  await ctl({op:'raw',frame:{type:'settings_changed',settings:{toolsetter:setup,display:{theme},viewer:{layers:{toolsetter:true,reachRoom:true,reachPart:true,hud:false,groundGrid:false}}}}});
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.getRoleMaterials?.().filter(m=>m.role.startsWith('reach')).length)).toBe(2);
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.getToolsetter?.()?.visible)).toBe(true);
  await page.waitForTimeout(150);
  states.push(await page.evaluate(()=>({palette:window.__viewerDiag!.getPalette!(),materials:window.__viewerDiag!.getRoleMaterials!(),setter:window.__viewerDiag!.getToolsetter!()})));
  await page.locator('.viewerPane').screenshot({path:new URL(`viewer-palette-fest.r44.xyzac-${theme}.png`,out).pathname});
 }
 await ctl({op:'raw',frame:{type:'settings_changed',settings:{toolsetter:setup,display:{theme:'light'},viewer:{layers:{toolsetter:true,reachRoom:false,reachPart:false,bounds:false,groundGrid:false,hud:true,machine:false,workzero:false,tool:true}}}}});
 await page.evaluate(()=>window.__viewerDiag!.setViewDirection!([0,-1,0.18],550));
 await page.waitForTimeout(250);
 await page.locator('.viewerPane').screenshot({path:new URL('sim-toolsetter.r44.contact-g43.png',out).pathname});
 const atG43=await page.evaluate(()=>({setter:window.__viewerDiag!.getToolsetter!(),camera:window.__viewerDiag!.getCamera!()}));
 // tool_touch_off cancels compensation (G49). Physical tool length remains 65.
 await ctl({op:'status_delta',data:{tool_offset:Array(9).fill(0)}});
 await page.waitForTimeout(250);
 await page.locator('.viewerPane').screenshot({path:new URL('sim-toolsetter.r44.contact-g49.png',out).pathname});
 const atG49=await page.evaluate(()=>({setter:window.__viewerDiag!.getToolsetter!(),camera:window.__viewerDiag!.getCamera!()}));
 writeFileSync(new URL('viewer-palette-fest.r44.xyzac.json',out),JSON.stringify({commit:'f82c323',states,errors},null,2));
 writeFileSync(new URL('sim-toolsetter.r44.marker.json',out),JSON.stringify({commit:'f82c323',jointZ:-235,physicalLength:65,physicalTipZ:-300,atG43,atG49,errors},null,2));
 await ctl({op:'reset'});
 expect(errors).toEqual([]);
});

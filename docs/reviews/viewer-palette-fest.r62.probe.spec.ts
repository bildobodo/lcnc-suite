import {test,expect} from '@playwright/test';
import {readFileSync,writeFileSync} from 'node:fs';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS} from './layout-fixtures';

const MODEL=new URL('../../examples/sim_config/machine-5axis-xyzac/',import.meta.url);
const machine=JSON.parse(readFileSync(new URL('machine.json',MODEL),'utf8'));
const nine=(z:number)=>[0,0,z,0,0,0,0,0,0];

test('R62: tool offset words and layer changes without a new status',async({page,context})=>{
  await context.route('**/xyzac-model/*.stl',r=>r.fulfill({contentType:'application/octet-stream',
    body:readFileSync(new URL(new URL(r.request().url()).pathname.split('/').pop()!,MODEL))}));
  const received:any[]=[];
  page.on('websocket', ws=>ws.on('framereceived', f=>{try {received.push(JSON.parse(String(f.payload)));}catch{}}));
  await openLayout(page,PROFILES[1],VIEWPORTS[0]);
  await ctl({op:'setViewerInit',data:{units:'mm',stl_base_url:'/xyzac-model/',axes:['X','Y','Z','A','C'],
    parts:machine.parts,groups:machine.groups,kinematics:machine.kinematics,workGroup:machine.workGroup,toolGroup:machine.toolGroup}});
  await expect.poll(()=>page.evaluate(()=>window.__viewerDiag?.ready ? window.__viewerDiag.getAppearance?.().parts.length : 0)).toBe(machine.parts.length);
  await ctl({op:'quiet',on:true});
  await page.waitForTimeout(700);
  const rows:any[]=[];
  const save=()=>writeFileSync('../evidence/viewer-palette-fest.r62.tool-state.json',JSON.stringify({commit:'fec40e5',rows},null,2)+'\n');
  const pin=()=>page.evaluate(()=>window.__viewerDiag?.getControlPoint?.());
  const row=page.locator('[data-strip="tool"] .statusRow').filter({hasText:'Z Offset'});
  const settle=()=>page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
  for(const [name,table,applied,gcode] of [
    ['G49',65,0,490],['G43',65,65,430],['negative G43',-65,-65,430],
    ['zero tool under G49',0,0,490],['G43.1 equal to table',65,65,431],['other offset',65,42,431],
  ] as const){
    const start=received.length;
    await ctl({op:'status_delta',data:{tool_number:13,tool_length:Math.abs(table),tool_table_z:table,tool_diameter:6,
      tool_offset:nine(applied),gcodes:[gcode],joint_pos:[150,0,-235,0,0],actual_position:[150,0,-235,0,0]}});
    await expect.poll(()=>received.slice(start).some(f=>f.type==='status_delta'&&f.data?.gcodes?.[0]===gcode)).toBe(true);
    await page.waitForTimeout(200);await settle();
    rows.push({name,table,applied,gcode,text:await row.innerText(),pin:await pin()});save();
    if(name==='zero tool under G49') await page.locator('[data-strip="tool"]').screenshot({path:'../evidence/viewer-palette-fest.r62.g49-label.png'});
  }
  await ctl({op:'status_delta',data:{tool_table_z:65,tool_length:65,tool_offset:nine(0),gcodes:[490]}});
  await expect.poll(async()=>(await pin())?.visible).toBe(true);
  await page.waitForTimeout(700);await settle();
  // Observe each switch before and after a new machine status. Settings must
  // actually have reached the page before checking the resulting visibility.
  for(const on of [false,true,false,true]){
    const start=received.length;
    await ctl({op:'raw',frame:{type:'settings_changed',settings:{viewer:{layers:{tool:on}}}}});
    await expect.poll(()=>received.slice(start).some(f=>f.type==='settings_changed'&&f.settings?.viewer?.layers?.tool===on)).toBe(true);
    await page.waitForTimeout(700);await settle();
    rows.push({name:`tool layer ${on}, no next status`,pin:await pin(),frames:received.slice(start).map(f=>f.type)});save();
    if(!on) await page.screenshot({path:'../evidence/viewer-palette-fest.r62.tool-layer-off.png'});
    await ctl({op:'status_delta',data:{}});await settle();
    await expect.poll(async()=>(await pin())?.visible).toBe(on);
    rows.push({name:`tool layer ${on}, after next status`,pin:await pin()});save();
  }
  // Measure the new text in the supported narrow layouts.
  const layouts=[];
  for(const viewport of VIEWPORTS){
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.evaluate(t=>document.documentElement.classList.toggle('touch-device',t),viewport.touch);await settle();
    await page.locator('[data-strip="tool"]').scrollIntoViewIfNeeded();
    layouts.push({viewport:viewport.name,...await row.evaluate(el=>{
      const field=el as HTMLElement, strip=field.closest('[data-strip="tool"]')!;
      return {text:field.innerText,row:field.getBoundingClientRect().toJSON(),strip:strip.getBoundingClientRect().toJSON(),
        scrollWidth:field.scrollWidth,clientWidth:field.clientWidth,html:field.innerHTML};
    })});
  }
  writeFileSync('../evidence/viewer-palette-fest.r62.tool-layout.json',JSON.stringify(layouts,null,2)+'\n');
  await ctl({op:'quiet',on:false});await ctl({op:'reset'});
  // Assertions of the desired behaviour, after saving all observations.
  for(const name of ['zero tool under G49','G43.1 equal to table'])
    expect.soft(rows.find(r=>r.name===name).text,`${name}: do not report a G43 mode that is not active`).not.toMatch(/· G43$/);
  expect.soft(rows.filter(r=>r.name==='tool layer false, no next status').map(r=>r.pin.visible),
    'hiding the Tool layer also hides its control-point marker without another status').toEqual([false,false]);
});

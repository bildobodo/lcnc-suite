// R34: native pointer input, real MachineSlider and callers, isolated mock only.
import {test,expect,type Page,type Locator} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {encode} from '@msgpack/msgpack';
import {ctl} from './ctl';
import {openLayout,PROFILES,VIEWPORTS,setLayoutState} from './layout-fixtures';
const OUT=process.env.R34_EVIDENCE||'../evidence';
test.use({hasTouch:true});
async function drag(page:Page,s:Locator,touch:boolean) {
 await s.scrollIntoViewIfNeeded();
 const info=await s.evaluate((e:HTMLInputElement)=>({min:+e.min,max:+e.max,value:+e.value,vertical:getComputedStyle(e).writingMode.startsWith('vertical')}));
 const b=(await s.boundingBox())!;
 const point=(f:number)=>info.vertical?{x:b.x+b.width/2,y:b.y+b.height-8-f*(b.height-16)}:{x:b.x+8+f*(b.width-16),y:b.y+b.height/2};
 const start=point((info.value-info.min)/(info.max-info.min));
 const cdp=touch?await page.context().newCDPSession(page):null;
 if(cdp) await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...start,id:1,radiusX:1,radiusY:1}]});
 else {await page.mouse.move(start.x,start.y);await page.mouse.down();}
 const steps=[];
 for(const f of [0.25,0.5,0.75]) {
  const p=point(f);
  if(cdp) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,id:1,radiusX:1,radiusY:1}]});
  else await page.mouse.move(p.x,p.y,{steps:4});
  await page.waitForTimeout(30);
  const value=Number(await s.inputValue());
  // Unrelated status render during the held pointer must not reset the thumb.
  await ctl({op:'status_delta',data:{work_pos:[f*10,2.222,3.333]}});
  await page.waitForTimeout(60);
  const after=Number(await s.inputValue());
  steps.push({fraction:f,value,after,aria:await s.getAttribute('aria-valuetext')});
 }
 const beforeRelease=await ctl({op:'lastCmds'});
 if(cdp){await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
 else await page.mouse.up();
 return {info,steps,beforeRelease:beforeRelease.cmds};
}
for(const touch of [false,true]) test(`R34 sliders preserve live local values and commit on release: ${touch?'touch':'mouse'}`,async({page,context})=>{
 test.setTimeout(90000);
 await openLayout(page,PROFILES[0]!,VIEWPORTS.find(v=>v.name===(touch?'touch-portrait':'desktop'))!);
 await ctl({op:'status_delta',data:{feed_override:1,spindle_override:1,rapid_override:1,feed_override_enabled:true,spindle_override_enabled:true}});
 const records=[];
 for(const [name,cmd,factor] of [['Jog speed',null,60],['Feed override','set_feed_override',1],['Spindle override','set_spindle_override',1],['Rapid override','set_rapid_override',1]] as const){
  const s=page.getByRole('slider',{name,exact:true});await expect(s).toBeEnabled();
  await ctl({op:'clearCmds'});
  const r=await drag(page,s,touch);
  if(cmd)await expect.poll(async()=>((await ctl({op:'lastCmds'})).cmds??[]).filter((x:any)=>x.cmd===cmd).length).toBe(1);
  const commands=(await ctl({op:'lastCmds'})).cmds;
  records.push({name,...r,commands});
  writeFileSync(`${OUT}/r34.sliders-${touch?'touch':'mouse'}.json`,JSON.stringify(records,null,2)+'\n');
  expect(r.steps[2]!.value,'native drag changes the value').toBeGreaterThan(r.steps[0]!.value);
  for(const step of r.steps){expect(step.after).toBe(step.value);expect(parseFloat(step.aria!)).toBe(Math.round(step.value*factor));}
  if(cmd){expect(r.beforeRelease.filter((x:any)=>x.cmd===cmd)).toHaveLength(0);expect(commands.find((x:any)=>x.cmd===cmd).scale).toBe(r.steps[2]!.value/100);}
 }
 // Scrub also receives its local position immediately during the gesture.
 const payload={file:'/slider.ngc',preview_schema:9,feed:[[0,0,0],[10,0,0],[20,0,0]],feed_lines:[1,2,3],feed_seq:[1,2,3],feed_outside:new Uint8Array(3),rapid:[],violations:[],violations_total:0};
 await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode(payload))}));
 await ctl({op:'status_delta',data:{active_file:'/slider.ngc',joint_pos:[0,0,0],actual_position:[0,0,0],g5x_offset:[0,0,0],g92_offset:[0,0,0],tool_offset:[0,0,0],rotation_xy:0,is_enabled:false,enabled:false}});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:3401,file:'/slider.ngc'}});
 await expect(page.locator('.scrubBar')).toBeVisible();
 await page.locator('.scrubBar').getByRole('checkbox',{name:'Sim',exact:true}).click();
 const scrub=page.locator('.scrubBar .sliderInput');await expect(scrub).toBeEnabled();
 const sr=await drag(page,scrub,touch);records.push({name:'scrub',...sr,commands:[]});
 writeFileSync(`${OUT}/r34.sliders-${touch?'touch':'mouse'}.json`,JSON.stringify(records,null,2)+'\n');
 expect(sr.steps[2]!.value).toBeGreaterThan(sr.steps[0]!.value);
 for(const step of sr.steps)expect(step.after).toBe(step.value);
 await expect(page.locator('.scrubBar .lineSlot')).toHaveText('L3');
 await page.screenshot({path:`${OUT}/r34.sliders-${touch?'touch':'mouse'}.png`});
});

import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};

type Sent = { cmd?: string; [k: string]: unknown };
async function sent(): Promise<Sent[]> {
  return ((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [];
}

async function open(page: Page, viewport: { width: number; height: number }) {
  await ctl({ op: "reset" });
  await page.setViewportSize(viewport);
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", armed: true, data: { active_file: "/A.ngc", permissions: PERMS_ALL } });
  await expect(page.locator(".pill.armed")).toHaveCount(1);
  await ctl({ op: "clearCmds" });
}

import { GATE_NAMES } from '../src/permissions';
test.use({hasTouch:true});
const rect = async (l: import('@playwright/test').Locator) => { const b=(await l.boundingBox())!;return {x:b.x,y:b.y,width:b.width,height:b.height}; };
const center = (b:{x:number;y:number;width:number;height:number},id=1) => ({id,x:b.x+b.width/2,y:b.y+b.height/2});
for (const control of ['arm','estop','machineOn']) {
 test(`first touch on ${control} stays until its click and delivers exactly once`,async({page})=>{
  await open(page,{width:1280,height:800});
  const button=page.locator(`.safetyBtns [data-control="${control}"]`), before=await rect(button);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[center(before)]});
  await page.waitForTimeout(650);
  expect(await rect(button)).toEqual(before);
  await expect(page.locator('html')).not.toHaveClass(/touch-device/);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect(page.locator('html')).toHaveClass(/touch-device/);
  const cmds=()=>sent().then(a=>a.filter(c=>control==='arm'?c.cmd==='arm':control==='estop'?c.cmd==='estop':c.cmd==='machine_on'||c.cmd==='machine_off'));
  await expect.poll(async()=> (await cmds()).length).toBe(1);
  console.log('FIRST_SAFETY',JSON.stringify({control,before,commands:await cmds()}));
 });
}
test('first-touch layout waits for the other finger too',async({page})=>{
 await open(page,{width:1280,height:800});
 const button=page.locator('[data-strip="setup"]').getByRole('button',{name:/^(Home|Unhome) X$/});
 const before=await rect(button);const cdp=await page.context().newCDPSession(page);const p=center(before);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p,{id:2,x:2,y:2}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[p]});
 await page.waitForTimeout(900);
 await expect(page.locator('html')).not.toHaveClass(/touch-device/);expect(await rect(button)).toEqual(before);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.locator('html')).toHaveClass(/touch-device/);
 console.log('MULTI',JSON.stringify({before,commands:await sent()}));
});
for(const zoom of [1,1.5]){
 test(`portrait first touch opens complete jogging help, zoom ${zoom}`,async({page})=>{
  await open(page,{width:900,height:1200});
  await page.evaluate(z=>document.documentElement.style.zoom=String(z),zoom);
  await ctl({op:'setJointJog',jointJog:{enabled:true,fraction:.1,reason:null,axes:['X','Y','Z'].map((letter,joint)=>({letter,joint,reason:null}))}});
  await ctl({op:'status_delta',data:{homed:false,homed_joints:[false,false,false]}});
  const help=page.getByRole('button',{name:'Help: Jogging before homing'});
  await expect(help).toBeVisible();await help.scrollIntoViewIfNeeded();
  const b=await rect(help);
  expect(await help.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
  await help.tap();await expect(page.locator('html')).toHaveClass(/touch-device/);
  const pop=page.locator('.helpPopover:popover-open');
  await expect(pop).toHaveText('Not homed: each button moves its own joint, without soft limits, at most 10 % of its speed.');
  await page.waitForTimeout(100);
  const pb=await rect(pop);expect(pb.x).toBeGreaterThanOrEqual(0);expect(pb.y).toBeGreaterThanOrEqual(0);expect(pb.x+pb.width).toBeLessThanOrEqual(900);expect(pb.y+pb.height).toBeLessThanOrEqual(1200);
  expect((await sent()).filter(c=>/^(jog_|home|unhome|auto_)/.test(String(c.cmd)))).toEqual([]);
  console.log('HELP',JSON.stringify({zoom,trigger:b,popover:pb}));
  await page.screenshot({path:`/tmp/codex-r231-jezxg0l0/help-${zoom}.png`});
 });
}
for(const field of ['MDI','Search tools']) {
 test(`first touch into ${field} sets inputmode none before focus`,async({page})=>{
  await open(page,{width:1280,height:800});
  await page.getByRole('tab',{name:field==='MDI'?'MDI':'Tools',exact:true}).click();
  const input=field==='MDI'?page.locator('.mdiInput'):page.getByRole('textbox',{name:'Search tools',exact:true});
  await input.evaluate(el=>{
   (window as any).r231Focus=[];
   el.addEventListener('focus',()=>{(window as any).r231Focus.push({tag:el.tagName,cls:el.className,inputmode:el.getAttribute('inputmode'),touch:document.documentElement.classList.contains('touch-device')});},true);
  });
  await input.tap();
  await expect(page.locator('.tkStrip')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/touch-device/);
  const result=await page.evaluate(()=>(window as any).r231Focus);
  console.log('FIRST_TEXT_FOCUS',JSON.stringify({field,focus:result,after:await input.getAttribute('inputmode')}));
  expect(result[0]?.inputmode).toBe('none');
 });
}
test('each named diagonal starts its two named directions',async({page})=>{
 await open(page,{width:1280,height:800});
 await ctl({op:'status_delta',data:{homed:true,homed_joints:[true,true,true],permissions:Object.fromEntries(GATE_NAMES.map(k=>[k,true]))}});
 for(const [name,dx,dy] of [['Jog X- Y+',-1,1],['Jog X+ Y+',1,1],['Jog X- Y-',-1,-1],['Jog X+ Y-',1,-1]] as const){
  const button=page.getByRole('button',{name,exact:true});await ctl({op:'clearCmds'});
  const b=await rect(button);await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.up();
  await expect.poll(async()=>(await sent()).some(c=>c.cmd==='jog_cont_multi')).toBe(true);
  const commands=await sent();console.log('DIAGONAL',JSON.stringify({name,dx,dy,commands}));
  const start=commands.find(c=>c.cmd==='jog_cont_multi')!;
  expect((start.axes as {axis:number;vel:number}[]).map(a=>({axis:a.axis,dir:Math.sign(a.vel)}))).toEqual([{axis:0,dir:dx},{axis:1,dir:dy}]);
 }
});

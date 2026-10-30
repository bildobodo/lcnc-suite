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


import { publishToolTable } from './ctl';
import { clickMore } from './more';
test.use({hasTouch:true});
async function loaded(page:Page){
 await page.route('**/gcode?*',route=>route.fulfill({contentType:'text/plain',body:'(R232)\nG0 X0\nG1 X10 F100\nM2\n'}));
 await open(page,{width:1440,height:1000});
 await ctl({op:'raw',frame:{type:'viewer_gcode_ready',file:'/A.ngc',version:12}});
 await expect(page.locator('.codeLine').first()).toContainText('(R232)');
}
const center=async(l:import('@playwright/test').Locator)=>{const b=(await l.boundingBox())!;return {id:1,x:b.x+Math.min(40,b.width/2),y:b.y+Math.min(10,b.height/2)};};
test('an already mounted editor suppresses native text input at the first touch, before focus and before size change',async({page})=>{
 await loaded(page);await clickMore(page.locator('.ctrlRow'),'Edit');
 const content=page.locator('.cm-content');await expect(content).toBeVisible();
 await page.mouse.click(2,2);await expect(page.locator('.tkStrip')).toHaveCount(0);
 await expect(content).not.toBeFocused();await expect(content).not.toHaveAttribute('inputmode','none');
 await content.evaluate(el=>{(window as any).r232Focus=[];el.addEventListener('focus',()=>{(window as any).r232Focus.push({mode:el.getAttribute('inputmode'),touch:document.documentElement.classList.contains('touch-device')});},true);});
 const before=await content.boundingBox();const point=await center(content);const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
 await expect(content).toHaveAttribute('inputmode','none');await expect(page.locator('html')).not.toHaveClass(/touch-device/);
 expect(await content.boundingBox()).toEqual(before);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(content).toBeFocused();await expect(page.locator('.tkStrip')).toBeVisible();await expect(page.locator('html')).toHaveClass(/touch-device/);
 const focuses=await page.evaluate(()=>(window as any).r232Focus);console.log('EDITOR',JSON.stringify({focuses,atDown:'none',sizesAtDown:false}));
 expect(focuses.length).toBeGreaterThan(0);expect(focuses[0].mode).toBe('none');
 expect((await sent()).filter(c=>/^(mdi|auto_|jog_|home|unhome)/.test(String(c.cmd)))).toEqual([]);
});
test('the first tool-row touch uses the tap path while sizes wait; retap hides and no late hover reopens it',async({page})=>{
 await open(page,{width:1440,height:1000});
 await publishToolTable([{T:5,P:5,D:6,Z:-40,type:'endmill',description:'R232 tool'}]);
 await page.getByRole('tab',{name:'Tools',exact:true}).click();
 const row=page.locator('.toolsTab tbody tr').filter({hasText:'R232 tool'});await expect(row).toHaveCount(1);
 await expect(page.locator('.toolHoverPreview')).toHaveCount(0);
 const cdp=await page.context().newCDPSession(page);const before=await row.boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[await center(row.locator('.colDesc'))]});
 await page.waitForTimeout(400);await expect(page.locator('html')).not.toHaveClass(/touch-device/);expect(await row.boundingBox()).toEqual(before);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.locator('.toolHoverPreview')).toBeVisible();await expect(page.locator('html')).toHaveClass(/touch-device/);
 await row.locator('.colDesc').tap();await expect(page.locator('.toolHoverPreview')).toHaveCount(0);
 await page.waitForTimeout(400);await expect(page.locator('.toolHoverPreview')).toHaveCount(0);
 console.log('TOOL_TAP',JSON.stringify({opened:true,retapClosed:true,afterHoverDelayClosed:true}));
});
test('virtual code pitch changes with CSS after release, while text inputmode changes during the press',async({page})=>{
 await loaded(page);
 const lines=page.locator('.codeLine');const pitch=()=>lines.evaluateAll(els=>els.slice(0,3).map(el=>{const b=el.getBoundingClientRect();return {top:b.top,height:b.height};}));
 const before=await pitch();expect(before[0].height).toBe(23);expect(before[1].top-before[0].top).toBe(23);
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:2,y:2}]});
 await page.waitForTimeout(200);
 await expect(page.locator('html')).not.toHaveClass(/touch-device/);expect(await pitch()).toEqual(before);
 // MDI is mounted even when hidden: it gets inputmode immediately without reflowing code.
 await expect(page.locator('.mdiInput')).toHaveAttribute('inputmode','none');
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect(page.locator('html')).toHaveClass(/touch-device/);
 await expect.poll(async()=>(await pitch())[0].height).toBe(32);
 const after=await pitch();expect(after[1].top-after[0].top).toBe(32);console.log('CODE_PITCH',JSON.stringify({before,after}));
});

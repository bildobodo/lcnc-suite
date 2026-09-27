/** R16: built frontend against ONLY the local mock on 4196. No live controller.
 * Start: MOCK_HOST=127.0.0.1 MOCK_PORT=4196 node lcnc-webui/e2e/mock-gateway.mjs
 * Run: node docs/reviews/xyzac-z0-m600.r16.browser-probe.mjs
 * Delayed replies are broadcast with the real request's req_id, never guessed.
 */
import { chromium, expect } from '../../lcnc-webui/node_modules/@playwright/test/index.mjs';
import WebSocket from '../../lcnc-webui/node_modules/ws/wrapper.mjs';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const ROOT = new URL('../../', import.meta.url);
const BASE = 'http://127.0.0.1:4196/';
const result = { head: execFileSync('git', ['rev-parse','HEAD'], {cwd: ROOT, encoding:'utf8'}).trim(), cases:[] };
const PERMS = { idle:true, jog:true, override:true, ready:true, run:true, pause:false, resume:false,
  step:true, abort:true, probe:true, zero:true, machineFrame:true, goZero:true, planeFrame:true,
  touchoff:true, touchoffRotary:true, twpCapture:true, surfaceComp:true, safety:true, setup:true, armed:true, always:true };
const SETUP = {touchX:0,touchY:0,touchZ:-300,fastFeed:200,slowFeed:0,traverseFeed:500,maxZTravel:180,retractDist:2,spindleZeroHeight:180};
const SETTINGS = {machine:{toolChangeMode:'m600', runFromLine:true, rflSpindleDir:'off'}, toolsetter:SETUP};
const A = '(program A)\nT5 M600\nG90 G54 G0 X10 Y20\nG1 X11 F100\nM2\n';
const B = '(program B)\nT8 M600\nG90 G54 G0 X80 Y90\nG1 X81 F100\nM2\n';
function ctl(op) {return new Promise((resolve,reject)=>{const ws = new WebSocket('ws://127.0.0.1:4196/ctl');
  ws.once('open',()=>ws.send(JSON.stringify(op))); ws.once('message',d=>{ws.close();resolve(JSON.parse(String(d)));});ws.once('error',reject);});}
const sent = async () => (await ctl({op:'lastCmds'})).cmds.filter(c=>!['hello','arm','client_diag','tab_visibility','get_tool_table'].includes(c.cmd));
async function hold(page, button) {await expect(button).toBeEnabled();const b=await button.boundingBox();
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.waitForTimeout(650);await page.mouse.up();}
async function replyTo(request, extra={ok:true,file_saved:true,mdi_set:true}) {
  await ctl({op:'raw',frame:{type:'reply',cmd:request.cmd,req_id:request.req_id,...extra}});
}
const browser = await chromium.launch({headless:true});
async function run(name, fn) {
  const page = await browser.newPage({viewport:{width:1600,height:1000}});
  page.setDefaultTimeout(8000);
  try {
    await ctl({op:'reset'});
    await page.route('**/gcode?*',route=>route.fulfill({contentType:'text/plain',body:new URL(route.request().url()).searchParams.get('v')==='701'?B:A}));
    await page.goto(BASE);
    await expect(page.locator('input.setupInput').first()).toBeVisible();
    await ctl({op:'status_delta',data:{permissions:PERMS,tool_number:5,active_file:'/A.ngc',homed:[1,1,1]}});
    await ctl({op:'raw',frame:{type:'settings_init',settings:SETTINGS}});
    await ctl({op:'clearCmds'});
    const data=await fn(page);
    result.cases.push({name,...data}); console.log(JSON.stringify(result.cases.at(-1)));
  } catch(e) {result.cases.push({name,harness_error:String(e),commands:await sent()});console.log(JSON.stringify(result.cases.at(-1)));}
  finally {await page.close();}
}
try {
  await run('measure_positive_control',async page=>{
    await page.getByRole('tab',{name:'Tools',exact:true}).click();
    await hold(page,page.getByRole('button',{name:'Measure Current',exact:true}));
    await expect.poll(async()=> (await sent()).filter(c=>c.cmd==='set_probe_vars').length).toBe(1);
    const before=await sent(); await replyTo(before.find(c=>c.cmd==='set_probe_vars'));
    await expect.poll(async()=> (await sent()).some(c=>c.cmd==='mdi')).toBe(true);
    return {before_reply:before,after_reply:await sent()};
  });
  await run('measure_abort_before_reply',async page=>{
    await page.getByRole('tab',{name:'Tools',exact:true}).click();
    await hold(page,page.getByRole('button',{name:'Measure Current',exact:true}));
    await expect.poll(async()=> (await sent()).filter(c=>c.cmd==='set_probe_vars').length).toBe(1);
    const vars=(await sent()).find(c=>c.cmd==='set_probe_vars');
    await page.getByRole('button',{name:'Abort',exact:true}).first().click();
    await expect.poll(async()=> (await sent()).some(c=>c.cmd==='abort')).toBe(true);
    await replyTo(vars);
    await page.waitForTimeout(350);
    return {commands:await sent(),motion_after_abort:(await sent()).some(c=>c.cmd==='mdi')};
  });
  await run('measure_setup_cleared_before_reply',async page=>{
    await page.getByRole('tab',{name:'Tools',exact:true}).click();
    await hold(page,page.getByRole('button',{name:'Measure Current',exact:true}));
    await expect.poll(async()=> (await sent()).filter(c=>c.cmd==='set_probe_vars').length).toBe(1);
    const vars=(await sent()).find(c=>c.cmd==='set_probe_vars');
    await ctl({op:'raw',frame:{type:'settings_changed',settings:{...SETTINGS,toolsetter:{}}}});
    await expect(page.getByRole('button',{name:'Measure Current',exact:true})).toBeDisabled();
    await replyTo(vars);await page.waitForTimeout(350);
    return {commands:await sent(),motion_after_reset:(await sent()).some(c=>c.cmd==='mdi')};
  });
  await run('rfl_program_changed_before_reply',async page=>{
    await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:700,file:'/A.ngc'}});
    await expect(page.locator('.codeLine').first()).toContainText('(program A)');
    await page.locator('.codeLine').nth(3).click();
    await page.getByRole('button',{name:'Start L4',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Run from Line 4',exact:true});
    await hold(page,dialog.getByRole('button',{name:'Measure T5 + Run from Line 4',exact:true}));
    await expect.poll(async()=> (await sent()).filter(c=>c.cmd==='set_probe_vars').length).toBe(1);
    const vars=(await sent()).find(c=>c.cmd==='set_probe_vars');
    await ctl({op:'status_delta',data:{active_file:'/B.ngc'}});
    await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:701,file:'/B.ngc'}});
    await expect(page.locator('.codeLine').first()).toContainText('(program B)');
    await replyTo(vars);await page.waitForTimeout(350);
    return {confirmed_program:A,displayed_before_reply:B,commands:await sent(),stale_auto_run:(await sent()).find(c=>c.cmd==='auto_run')??null};
  });
} finally {
  await browser.close();
  await writeFile(new URL('./xyzac-z0-m600.r16.browser-probe.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
}

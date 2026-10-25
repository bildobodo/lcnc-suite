import { chromium, expect } from '@playwright/test';
import WebSocket from 'ws';
import { writeFile } from 'node:fs/promises';
// Run after npm run build, against an isolated MOCK_PORT=4188 server.
const base='http://127.0.0.1:4188';
const output=process.env.R205_OUT || '/tmp/button-gates.r205.browser.json';
async function ctl(op) {return new Promise((resolve,reject)=>{const w=new WebSocket(base.replace('http','ws')+'/ctl');w.once('open',()=>w.send(JSON.stringify(op)));w.once('message',v=>{w.close();resolve(JSON.parse(String(v)))});w.once('error',reject)});}
const kb=(mapping={})=>({keyboard:{jogEnabled:true,buttonsEnabled:true,mapping}});
const settings=async (s)=>ctl({op:'raw',frame:{type:'settings_changed',settings:s}});
const cmds=async()=>((await ctl({op:'lastCmds'})).cmds??[]).filter(c=>!['heartbeat','timing_log','tab_visibility'].includes(c.cmd));
const jogs=async()=>(await cmds()).filter(c=>c.cmd.startsWith('jog_'));
const browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage']});
const results=[];
async function ready(){
 await ctl({op:'reset'});
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 await page.goto(base);
 await expect(page.locator('input.setupInput').first()).toBeVisible();
 await ctl({op:'quiet',on:true}); await settings(kb());
 const steps=page.getByRole('radiogroup',{name:'Jog step',exact:true});
 await steps.getByRole('radio',{name:'Cont',exact:true}).click();
 await page.evaluate(()=>document.activeElement?.blur());
 await ctl({op:'clearCmds'});
 return {page,steps};
}
async function scenario(name,fn){const ctx=await ready();try{results.push({name,...await fn(ctx)})}catch(e){results.push({name,harness_error:String(e)});throw e}finally{await ctx.page.close();await ctl({op:'reset'});}}
try{
 await scenario('control_step_changed',async({page,steps})=>{
  await page.keyboard.down('ArrowRight');await expect.poll(jogs).toContainEqual(expect.objectContaining({cmd:'jog_cont',axis:0}));
  await steps.getByRole('radio',{name:'1',exact:true}).click();await page.keyboard.up('ArrowRight');
  await expect.poll(jogs).toContainEqual(expect.objectContaining({cmd:'jog_stop',axis:0}));
  return {commands:await jogs()};
 });
 await scenario('remote_remap_while_held',async({page})=>{
  await page.keyboard.down('ArrowRight');await expect.poll(jogs).toContainEqual(expect.objectContaining({cmd:'jog_cont',axis:0}));
  await settings(kb({'jog_x+':'q'}));await page.waitForTimeout(350);
  await page.keyboard.up('ArrowRight');await page.waitForTimeout(450);
  const after_release=await jogs();
  // Confirm that the new mapping actually arrived, without changing focus.
  // The old gesture is still active, so q cannot start it a second time;
  // q's keyup then finds that old logical action and finally stops it.
  await page.keyboard.press('q');await page.waitForTimeout(200);
  return {after_release,after_new_key:await jogs(),expected_release_stop:after_release.some(c=>c.cmd==='jog_stop'&&c.axis===0)};
 });
 await scenario('disarm_while_held_control',async({page})=>{
  await page.keyboard.down('ArrowRight');await expect.poll(jogs).toContainEqual(expect.objectContaining({cmd:'jog_cont',axis:0}));
  await ctl({op:'raw',frame:{type:'armed',armed:false}});
  await expect(page.locator('.jogBtn').filter({hasText:'Z+'})).toBeDisabled();
  await page.keyboard.up('ArrowRight');
  await expect.poll(jogs).toContainEqual(expect.objectContaining({cmd:'jog_stop',axis:0}));return {commands:await jogs()};
 });
 await scenario('pointer_cont_to_step_control',async({page,steps})=>{
  const button=page.locator('.jogBtn').filter({hasText:'Z+'});
  const box=await button.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await expect.poll(jogs).toContainEqual(expect.objectContaining({cmd:'jog_cont',axis:2}));
  // Change the preselection without moving the held pointer off its button.
  await steps.getByRole('radio',{name:'1',exact:true}).evaluate(el=>el.click());
  await expect(steps.getByRole('radio',{name:'1',exact:true})).toHaveAttribute('aria-checked','true');
  await page.mouse.up();await expect.poll(jogs).toContainEqual(expect.objectContaining({cmd:'jog_stop',axis:2}));
  return {commands:await jogs()};
 });
 await scenario('confirm_unchanged_request_control',async({page})=>{
  await ctl({op:'status_delta',data:{tool_change_requested:true,tool_change_tool:7,permissions:{armed:true,toolChangeConfirm:true,abort:true}}});
  const dialog=page.locator('.dialogOverlay').filter({hasText:'Load Tool into Spindle'});
  const confirm=dialog.getByRole('button',{name:'Confirm',exact:true});
  await expect(confirm).toBeEnabled();await expect(dialog).toContainText('T7');
  await ctl({op:'clearCmds'});await confirm.click();
  await expect.poll(cmds).toContainEqual(expect.objectContaining({cmd:'confirm_tool_change'}));
  return {commands:await cmds()};
 });
 await scenario('confirm_request_changes_between_press_and_release',async({page})=>{
  const req=tool=>ctl({op:'status_delta',data:{tool_change_requested:true,tool_change_tool:tool,permissions:{armed:true,toolChangeConfirm:true,abort:true}}});
  await req(7);
  const dialog=page.locator('.dialogOverlay').filter({hasText:'Load Tool into Spindle'});
  const confirm=dialog.getByRole('button',{name:'Confirm',exact:true});
  await expect(confirm).toBeEnabled();await expect(dialog).toContainText('T7');
  const box=await confirm.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await req(9);await expect(dialog).toContainText('T9');await ctl({op:'clearCmds'});
  await page.mouse.up();await page.waitForTimeout(400);
  const after_release=await cmds();
  return {after_release,obsolete_confirmation_discarded:!after_release.some(c=>c.cmd==='confirm_tool_change')};
 });
}finally{await browser.close();await writeFile(output,JSON.stringify({head:'a46fb237',mock:base,results},null,2));}
console.log(JSON.stringify(results,null,2));

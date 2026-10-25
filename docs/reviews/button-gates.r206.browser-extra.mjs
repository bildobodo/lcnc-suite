import { chromium, expect } from '@playwright/test';
import WebSocket from 'ws';
import { writeFile } from 'node:fs/promises';
// R206: extra controls for physical key identity and same-tool request generations.
// Run after npm run build, against an isolated MOCK_PORT=4188 server.
const base='http://127.0.0.1:4188';
const output=process.env.R206_OUT || '/tmp/button-gates.r206.browser-extra.json';
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
try {
 await scenario('uppercase_release_same_physical_key',async({page})=>{
  await settings(kb({'jog_x+':'q'}));await page.waitForTimeout(350);
  await page.evaluate(()=>{window.__keys=[];for(const n of ['keydown','keyup'])window.addEventListener(n,e=>window.__keys.push({type:e.type,key:e.key,code:e.code}));});
  await page.keyboard.down('q');await expect.poll(jogs).toContainEqual(expect.objectContaining({cmd:'jog_cont',axis:0}));
  await page.keyboard.down('Shift');await page.keyboard.up('Q');await page.keyboard.up('Shift');
  await expect.poll(jogs).toContainEqual(expect.objectContaining({cmd:'jog_stop',axis:0}));
  return {commands:await jogs(),events:await page.evaluate(()=>window.__keys)};
 });
 await scenario('space_on_old_generation_of_same_tool',async({page})=>{
  const req=seq=>ctl({op:'status_delta',data:{tool_change_requested:true,tool_change_tool:7,tool_change_seq:seq,permissions:{armed:true,toolChangeConfirm:true,abort:true}}});
  await req(41);
  const dialog=page.locator('.dialogOverlay').filter({hasText:'Load Tool into Spindle'});
  const confirm=dialog.getByRole('button',{name:'Confirm',exact:true});
  await expect(confirm).toBeEnabled();await confirm.focus();await page.keyboard.down(' ');
  await req(42);await page.waitForTimeout(200);await ctl({op:'clearCmds'});await page.keyboard.up(' ');await page.waitForTimeout(200);
  const obsolete=(await cmds()).filter(c=>c.cmd==='confirm_tool_change');expect(obsolete).toEqual([]);
  await confirm.click();await expect.poll(cmds).toContainEqual(expect.objectContaining({cmd:'confirm_tool_change',request:42}));
  return {obsolete,after_deliberate_press:await cmds()};
 });
} finally {await browser.close();await writeFile(output,JSON.stringify({head:'7d356229',mock:base,results},null,2));}
console.log(JSON.stringify(results,null,2));

import { chromium } from '@playwright/test';
import WebSocket from 'ws';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const ROOT=process.env.R202_ROOT || '/tmp/codex-r202-5mwofpc4';
const ctl=o=>new Promise((resolve,reject)=>{const w=new WebSocket('ws://127.0.0.1:4188/ctl');w.once('open',()=>w.send(JSON.stringify(o)));w.once('message',x=>{w.close();resolve(JSON.parse(String(x)))});w.once('error',reject)});
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1600,height:1100}});const errors=[];p.on('pageerror',e=>errors.push(String(e)));
try {
await ctl({op:'reset'}); await p.goto('http://127.0.0.1:4188/');await p.locator('.safetyStrip').waitFor();await ctl({op:'quiet',on:true});
const q=JSON.parse(fs.readFileSync(ROOT+'/policy-matrix.json','utf8')).idle;
await ctl({op:'status_delta',armed:true,data:{permissions:q.permissions,permission_reasons:q.reasons,is_estop:false,is_enabled:true,enabled:true,homed:true,interp_state:1,task_mode:1}});
await ctl({op:'raw',frame:{type:'settings_init',settings:{keyboard:{jogEnabled:true,buttonsEnabled:true}}}});await p.waitForTimeout(500);
const cmds=async()=> (await ctl({op:'lastCmds'})).cmds.filter(c=>c.cmd?.startsWith('jog_'));
const steps=p.getByRole('radiogroup',{name:'Jog step',exact:true});
await steps.getByRole('radio',{name:'Cont',exact:true}).click();await p.evaluate(()=>document.activeElement?.blur());await ctl({op:'clearCmds'});
await p.keyboard.down('ArrowRight');await p.waitForTimeout(100);await p.keyboard.up('ArrowRight');await p.waitForTimeout(100);
const baseline=await cmds();assert(baseline.some(c=>c.cmd==='jog_cont'));assert(baseline.some(c=>c.cmd==='jog_stop'));
await ctl({op:'clearCmds'});await p.evaluate(()=>document.activeElement?.blur());
await p.keyboard.down('ArrowRight');await p.waitForTimeout(100);
const before=await cmds();assert(before.some(c=>c.cmd==='jog_cont'));
await steps.getByRole('radio',{name:'1',exact:true}).click();await p.waitForTimeout(100);
await p.keyboard.up('ArrowRight');await p.waitForTimeout(300);
const after=await cmds();assert(after.some(c=>c.cmd==='jog_cont'));assert(!after.some(c=>c.cmd==='jog_stop'));
const result={time:new Date().toISOString(),head:'b2ded6d1',scope:'Own mock only; no LinuxCNC commands',baseline,continuous_then_increment_then_release:after,errors};
fs.writeFileSync(ROOT+'/jog.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
} finally { await b.close(); }

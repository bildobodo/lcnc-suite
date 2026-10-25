import { chromium } from '@playwright/test';
import WebSocket from 'ws';
import fs from 'node:fs';
const ROOT='/tmp/codex-r202-5mwofpc4';
const matrix=JSON.parse(fs.readFileSync(ROOT+'/policy-matrix.json','utf8'));
const ctl=o=>new Promise((resolve,reject)=>{const w=new WebSocket('ws://127.0.0.1:4188/ctl'); w.once('open',()=>w.send(JSON.stringify(o)));w.once('message',x=>{w.close();resolve(JSON.parse(String(x)))});w.once('error',reject)});
const b=await chromium.launch({headless:true,args:['--no-sandbox']});
const p=await b.newPage({viewport:{width:1600,height:1100}});
const errors=[];p.on('pageerror',e=>errors.push(String(e)));
await p.route('**/gcode?*',r=>r.fulfill({contentType:'text/plain',body:'G21 G90\nG0 X0\nM2\n'}));
await p.route('**/files*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({nc_dir:'/nc_files',subdir:'',entries:[{name:'subfolder',path:'subfolder',type:'directory'},{name:'audit.ngc',path:'/nc_files/audit.ngc',type:'file',size:24}]})}));
await ctl({op:'reset'});
await p.goto('http://127.0.0.1:4188/');
await p.locator('.safetyStrip').waitFor();
const result={time:new Date().toISOString(),head:'b2ded6d1',source:'Archive frontend with backend-generated permissions; mock only, no real machine commands',states:{},errors};
async function setState(name,armed=true,extra={}){
 const q=matrix[name],s=q.state;
 await ctl({op:'status_delta',armed,data:{permissions:q.permissions,permission_reasons:q.reasons,estop:s.is_estop,is_estop:s.is_estop,enabled:s.is_enabled,is_enabled:s.is_enabled,homed:s.is_homed,homed_joints:[s.is_homed,s.is_homed,s.is_homed],task_mode:name==='running'||name==='paused'?2:1,interp_state:s.is_running?2:s.is_paused?3:1,paused:s.is_paused,kins_type:s.kins_type,g5x_index:s.g5x_index,twp_defined:s.twp_defined,twp_active:s.twp_active,eoffset_enabled:s.eoffset_enabled,active_file:'/nc_files/audit.ngc',...extra}});
 await p.locator('.pill.'+(armed?'armed':'disarmed')).waitFor();
 await p.waitForTimeout(200);
}
async function controls(){return p.locator('button,input,select,[role="radio"]').evaluateAll(els=>els.filter(e=>e.getClientRects().length).map(e=>({tag:e.tagName,role:e.getAttribute('role'),name:e.getAttribute('aria-label')||e.textContent?.trim().replace(/\s+/g,' ')||e.getAttribute('title')||e.getAttribute('name'),disabled:e.matches(':disabled'),ariaDisabled:e.getAttribute('aria-disabled'),disabledAncestors:[...document.querySelectorAll('fieldset[disabled]')].filter(f=>f.contains(e)).map(f=>f.getAttribute('data-gate')),title:e.getAttribute('title')})));}
await setState('idle');
result.states.idle=await controls();
await setState('unhomed');result.states.unhomed=await controls();
await p.screenshot({path:ROOT+'/unhomed.png'});
await setState('off');result.states.off=await controls();
await setState('running',false);result.states.observer_running=await controls();
await p.screenshot({path:ROOT+'/observer-running.png'});
await setState('estop');
await ctl({op:'status_delta',envelope:{safety_trip:{reason:'R202 simulated trip',time:Date.now(),kind:'heartbeat_stall'}}});await p.waitForTimeout(250);
result.states.unacked_trip=await controls();
await ctl({op:'status_delta',envelope:{safety_trip:null}});
await setState('stranded_plane');result.states.stranded_plane=await controls();
await setState('idle');
const more=p.getByRole('button',{name:'More program actions',exact:true});await more.click();
const files=p.getByRole('button',{name:'Files',exact:true});
if(await files.count())await files.click();
else {const browse=p.getByRole('button',{name:/Browse/,exact:false});if(await browse.count())await browse.first().click();}
await p.waitForTimeout(250);
await setState('estop');result.states.estop_browser_open=await controls();
fs.writeFileSync(ROOT+'/browser.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({states:Object.keys(result.states),counts:Object.fromEntries(Object.entries(result.states).map(([k,v])=>[k,v.length])),errors}));
await b.close();

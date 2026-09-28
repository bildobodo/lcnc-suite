// R25: one browser, own mock at 127.0.0.1:4188; no live gateway traffic.
// Build webui first. Start mock with MOCK_HOST=127.0.0.1 MOCK_PORT=4188.
import { chromium, expect } from '../../lcnc-webui/node_modules/@playwright/test/index.mjs';
import WebSocket from '../../lcnc-webui/node_modules/ws/wrapper.mjs';
import { writeFile } from 'node:fs/promises';
const URL = 'http://127.0.0.1:4188/';
const ctl = data => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://127.0.0.1:4188/ctl');
  ws.once('open', () => ws.send(JSON.stringify(data)));
  ws.once('message', msg => { ws.close(); resolve(JSON.parse(String(msg))); });
  ws.once('error', reject);
});
const PERMS = Object.fromEntries(['idle','jog','override','ready','run','step','abort','probe','zero','machineFrame','goZero','planeFrame','touchoff','touchoffRotary','twpCapture','surfaceComp','safety','setup','armed','always'].map(k => [k, true]));
const STORED = { X: 100, Y: 0, Z: -26.275 };
const SETTINGS = { keyboard: { jogEnabled: true, buttonsEnabled: true }, toolsetter: {
  touchX: 0, touchY: 0, touchZ: -300, fastFeed: 200, slowFeed: 20,
  traverseFeed: 500, maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180,
} };
const results = [];
const browser = await chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--renderer-process-limit=1'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(8000);
await page.route('**/g30*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, values: STORED, units: 'mm' }) }));
const field = l => page.getByLabel(`G30 ${l}`, { exact: true });
const group = name => page.getByRole('radiogroup', { name, exact: true });
const option = (g, name) => group(g).getByRole('radio', { name, exact: true });
async function enterG30(l, value) {
  await field(l).click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(String(value));
  await page.keyboard.press('Enter');
  await expect(field(l)).toHaveValue(String(value));
}
const cmds = async () => (await ctl({op:'lastCmds'})).cmds.filter(c => !['hello','arm','heartbeat','client_diag','tab_visibility','get_tool_table'].includes(c.cmd));
async function open(g30 = false) {
  await ctl({op:'reset'});
  await page.goto(URL);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'status_delta', armed:true, data:{ permissions:PERMS, kins_type:0,
    task_mode:1, interp_state:1, homed:true, enabled:true, estop:false,
    is_enabled:true, is_estop:false, emc_enable_in:true, motion_mode:1 }});
  await ctl({op:'raw', frame:{type:'settings_init', settings:SETTINGS}});
  if (g30) {
    await page.getByRole('tab',{name:'Probing',exact:true}).click();
    await page.getByRole('tab',{name:'Toolsetter',exact:true}).click();
    await expect(field('X')).toHaveValue('100');
  }
  await page.waitForTimeout(300);
  await ctl({op:'clearCmds'});
}
async function command(name) {
  await expect.poll(async () => (await cmds()).some(c => c.cmd === name)).toBe(true);
  return (await cmds()).find(c => c.cmd === name);
}
async function reply(c, result) { await ctl({op:'raw', frame:{type:'reply',cmd:c.cmd,req_id:c.req_id,...result}}); }
async function run(name, fn) {
  try { const observed = await fn(); results.push({name,...observed}); console.log(name, JSON.stringify(observed)); }
  catch (e) { results.push({name,harness_error:String(e)}); console.log(name, String(e)); }
}
try {
  await run('g30_save_ack_overwrites_new_edit', async () => {
    await open(true);
    await enterG30('X',110);
    await page.getByRole('button',{name:'Save G30',exact:true}).click();
    const c = await command('set_g30');
    await page.waitForTimeout(300);
    await expect(field('X')).toBeEnabled();
    await enterG30('X',120);
    const beforeReply = await field('X').inputValue();
    await reply(c,{ok:true,confirmed:true,values:{...STORED,X:110}});
    await expect(page.locator('.g30Stored')).toHaveText('Stored: confirmed by LinuxCNC');
    const afterReply = await field('X').inputValue();
    return {sent:c.values, beforeReply, afterReply, matches_contract:afterReply==='120'};
  });
  await run('g30_late_capture_after_frame_change', async () => {
    await open(true);
    await page.getByRole('button',{name:'Use Current Position',exact:true}).click();
    const c = await command('capture_g30');
    await ctl({op:'status_delta', data:{kins_type:1,permissions:{...PERMS,machineFrame:false}}});
    await expect(page.getByRole('button',{name:'Save G30',exact:true})).toBeDisabled();
    // Wait for the worker's status frame and Vue's watcher, not merely the
    // already-disabled busy button, before delivering a delayed reply.
    await page.waitForTimeout(400);
    await reply(c,{ok:true,confirmed:true,values:STORED,current:{X:10,Y:20,Z:-5},units:'mm'});
    await page.waitForTimeout(250);
    const current = await field('X').inputValue();
    const note = await page.locator('.tsPanel .statusNote').allTextContents();
    return {kins_type_at_request:0,kins_type_at_reply:1,displayedX:current,note,matches_contract:current==='100'};
  });
  await run('choice_rejection_stays_pending', async () => {
    await open();
    await ctl({op:'replies',replies:{set_mode:{ok:false,error:'R25: controller refused this mode'}}});
    await option('Task mode','MDI').click();
    await command('set_mode');
    await page.waitForTimeout(600);
    const pending = await option('Task mode','MDI').getAttribute('aria-busy');
    const hints = await page.locator('.btnHint').allTextContents();
    const errors = await page.getByText('R25: controller refused this mode',{exact:false}).allTextContents();
    return {pending,hints,errors,matches_contract:pending!=='true'&&hints.some(s=>s.includes('controller refused'))};
  });
  await run('step_representation_loses_focus_and_arrow_jogs', async () => {
    await open();
    await ctl({op:'setIncrements',increments:[1,10]});
    await expect(group('Jog step').getByRole('radio')).toHaveCount(3);
    await option('Jog step','Cont').focus();
    await page.keyboard.press('ArrowRight');
    await expect(option('Jog step','1')).toBeFocused();
    await ctl({op:'setIncrements',increments:[0.001,0.01,0.1,1,10,100,1000,5000]});
    await expect(page.getByRole('combobox',{name:'Jog step',exact:true})).toBeVisible();
    const active = await page.evaluate(()=>({tag:document.activeElement.tagName,role:document.activeElement.getAttribute('role')}));
    await ctl({op:'clearCmds'});
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const sent = await cmds();
    return {active, sent, matches_contract:active.tag==='SELECT'&&!sent.some(c=>c.cmd.startsWith('jog_'))};
  });
  await run('step_resize_loses_focus_and_arrow_jogs', async () => {
    await open();
    await ctl({op:'setIncrements',increments:[0.001,0.01,0.1,1]});
    await page.setViewportSize({width:900,height:1200});
    await expect(group('Jog step').getByRole('radio')).toHaveCount(5);
    await option('Jog step','Cont').focus();
    await page.keyboard.press('ArrowRight');
    await expect(option('Jog step','0.001')).toBeFocused();
    await page.setViewportSize({width:1600,height:1000});
    await expect(page.getByRole('combobox',{name:'Jog step',exact:true})).toBeVisible();
    const active = await page.evaluate(()=>({tag:document.activeElement.tagName,role:document.activeElement.getAttribute('role')}));
    await ctl({op:'clearCmds'});
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const sent = await cmds();
    return {trigger:'portrait to landscape; standard increments',active,sent,
      matches_contract:active.tag==='SELECT'&&!sent.some(c=>c.cmd.startsWith('jog_'))};
  });
  await run('tools_spacing_and_sticky_head_control', async () => {
    await open();
    await page.locator('.sidePane').getByRole('tab',{name:'Tools',exact:true}).click();
    const tools = Array.from({length:40},(_,i)=>({T:i+1,P:i+1,Z:-40-i,D:6,type:'endmill',description:`R25 cutter ${i+1}`}));
    await expect.poll(async()=>{
      await ctl({op:'raw',frame:{type:'reply',cmd:'get_tool_table',ok:true,tools}});
      return page.locator('.toolsTab tbody tr').count();
    }).toBe(40);
    const observed = await page.locator('.toolsTab').evaluate(async root=>{
      const head=root.querySelector('.toolsHead').getBoundingClientRect();
      const search=root.querySelector('input.toolSearch').getBoundingClientRect();
      const w=root.querySelector('.tableWrap');
      w.scrollTop=250; w.scrollLeft=20;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const h=w.querySelector('thead').getBoundingClientRect(),wb=w.getBoundingClientRect();
      const top=document.elementFromPoint(wb.left+8,h.top+8);
      return {head_to_search:search.top-head.bottom,scrollTop:w.scrollTop,
        scrollPadding:getComputedStyle(w).scrollPaddingTop,theadHeight:h.height,
        headerTopmost:!!top?.closest('thead'),topFade:getComputedStyle(w,'::before').display};
    });
    return {...observed,matches_contract:observed.head_to_search>=7.5&&observed.headerTopmost&&observed.topFade==='none'};
  });
  await run('offsets_canonical_unknown_and_lock_focus', async () => {
    await open();
    await ctl({op:'setAxes',axes:['X','Y','Z','A','C']});
    await ctl({op:'status_delta',data:{g92_offset:[1,0,0,0,5,6,0,0,0],tool_offset:[0,0,45.7,0,7,8,0,0,0],eoffset_enabled:null,eoffset_z:0}});
    await page.locator('.sidePane').getByRole('tab',{name:'Offsets',exact:true}).click();
    const rows=await page.locator('.offsetPanel tr.auxRow').evaluateAll(els=>els.map(el=>[...el.querySelectorAll('td')].map(c=>c.textContent.trim())));
    const summary=await page.locator('.offsetSummary').innerText();
    const edit=page.getByRole('button',{name:'Edit G54 C',exact:true});
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.nkStrip > .sub')).toHaveText('G54 · C · °');
    await page.getByRole('button',{name:'Close keyboard',exact:true}).click();
    await expect(edit).toBeFocused();
    const before=await edit.boundingBox();
    await ctl({op:'status_delta',data:{permissions:{...PERMS,probe:false}}});
    await expect(edit).toHaveCount(0);
    const active=await page.evaluate(()=>document.activeElement.tagName);
    const spans=await page.locator('.offsetPanel [data-layout-slot]').count();
    return {rows,summary,keyboardContext:'G54 · C · °',before,lockedSlots:spans,active_after_lock:active,
      canonical_and_unknown_pass:rows[0]?.[5]==='6.0000'&&rows[1]?.[5]==='8.0000'&&summary==='Offset status unknown — comp',
      focus_retained:active!=='BODY'};
  });
} finally {
  await browser.close();
  await writeFile(new globalThis.URL('./operator-punkte.r25.ui-probe.json',import.meta.url),JSON.stringify({head:'5212c83',isolation:URL,results},null,2)+'\n');
}

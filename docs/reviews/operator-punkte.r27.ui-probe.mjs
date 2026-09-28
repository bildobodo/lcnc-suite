// R27: one browser, own mock at 127.0.0.1:4188; no live gateway traffic.
// Build webui first. Start mock with MOCK_HOST=127.0.0.1 MOCK_PORT=4188.
import { chromium, expect } from '../../lcnc-webui/node_modules/@playwright/test/index.mjs';
import WebSocket from '../../lcnc-webui/node_modules/ws/wrapper.mjs';
import { readFile, writeFile } from 'node:fs/promises';
const URL = 'http://127.0.0.1:4188/';
const ctl = data => new Promise((resolve, reject) => {
  const ws = new WebSocket('ws://127.0.0.1:4188/ctl');
  ws.once('open', () => ws.send(JSON.stringify(data)));
  ws.once('message', msg => { ws.close(); resolve(JSON.parse(String(msg))); });
  ws.once('error', reject);
});
const PERMS = Object.fromEntries(['idle','jog','override','ready','run','step','abort','probe','zero','machineFrame','g30Capture','goZero','planeFrame','touchoff','touchoffRotary','twpCapture','surfaceComp','safety','setup','armed','always'].map(k => [k, true]));
const STORED = { X: 100, Y: 0, Z: -26.275 };
const SETTINGS = { keyboard: { jogEnabled: true, buttonsEnabled: true }, toolsetter: {
  touchX: 0, touchY: 0, touchZ: -300, fastFeed: 200, slowFeed: 20,
  traverseFeed: 500, maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180,
} };
const results = [];
// Match the repository's layout gate: reserve visible scrollbar bands.
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs:['--hide-scrollbars'], args: ['--disable-dev-shm-usage', '--renderer-process-limit=1'] });
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
async function open(g30 = false, waitForStored = true) {
  await ctl({op:'reset'});
  await page.setViewportSize({width:1600,height:1000});
  await page.goto(URL);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'status_delta', armed:true, data:{ permissions:PERMS, kins_type:0,
    task_mode:1, interp_state:1, homed:true, enabled:true, estop:false,
    is_enabled:true, is_estop:false, emc_enable_in:true, motion_mode:1 }});
  await ctl({op:'raw', frame:{type:'settings_init', settings:SETTINGS}});
  if (g30) {
    await page.getByRole('tab',{name:'Probing',exact:true}).click();
    await page.getByRole('tab',{name:'Toolsetter',exact:true}).click();
    if (waitForStored) await expect(field('X')).toHaveValue('100');
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
  if (process.argv[2] && process.argv[2] !== name) return;
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
    await expect(page.locator('.g30Stored')).toHaveText(/^Stored: confirmed by LinuxCNC/);
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
  await run('step_representation_loses_focus_and_arrow_jogs', async () => {
    await open();
    await ctl({op:'setIncrements',increments:[1,10]});
    await expect(group('Jog step').getByRole('radio')).toHaveCount(3);
    await option('Jog step','Cont').focus();
    await page.keyboard.press('ArrowRight');
    await expect(option('Jog step','1')).toBeFocused();
    await ctl({op:'setIncrements',increments:[0.001,0.01,0.1,1,10,100,1000,5000]});
    await expect(page.locator('.stepBlock select, .stepBlock .choiceGroup')).toHaveCount(1);
    await page.waitForTimeout(200);
    const active = await page.evaluate(()=>({tag:document.activeElement.tagName,role:document.activeElement.getAttribute('role')}));
    await ctl({op:'clearCmds'});
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const sent = await cmds();
    return {active, sent, matches_contract:(active.tag==='SELECT'||active.role==='radio')&&!sent.some(c=>c.cmd.startsWith('jog_'))};
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
    await expect(page.locator('.stepBlock select, .stepBlock .choiceGroup')).toHaveCount(1);
    await page.waitForTimeout(200);
    const active = await page.evaluate(()=>({tag:document.activeElement.tagName,role:document.activeElement.getAttribute('role')}));
    await ctl({op:'clearCmds'});
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const sent = await cmds();
    return {trigger:'portrait to landscape; standard increments',active,sent,
      matches_contract:(active.tag==='SELECT'||active.role==='radio')&&!sent.some(c=>c.cmd.startsWith('jog_'))};
  });
  await run('step_removed_option_same_representation', async () => {
    await open();
    await ctl({op:'setIncrements',increments:[1,10]});
    await option('Jog step','10').focus();
    await page.keyboard.press('Space');
    await expect(option('Jog step','10')).toHaveAttribute('aria-checked','true');
    await ctl({op:'setIncrements',increments:[1,20]});
    await expect(option('Jog step','20')).toBeVisible();
    await expect(option('Jog step','1')).toHaveAttribute('aria-checked','true');
    await expect(option('Jog step','1')).toBeFocused();
    const active=await page.evaluate(()=>({tag:document.activeElement.tagName,role:document.activeElement.getAttribute('role')}));
    await ctl({op:'clearCmds'});
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const sent=await cmds();
    return {before:[1,10],after:[1,20],fallback:1,active,sent,matches_contract:active.role==='radio'&&!sent.some(c=>c.cmd.startsWith('jog'))};
  });
  await run('step_focus_is_not_reclaimed_after_leaving', async () => {
    await open();
    await ctl({op:'setIncrements',increments:[1,10]});
    await option('Jog step','10').focus();
    await option('Task mode','Manual').focus();
    await ctl({op:'setIncrements',increments:[1,20]});
    await expect(option('Jog step','20')).toBeVisible();
    await expect(option('Task mode','Manual')).toBeFocused();
    return {focusGroup:'Task mode',matches_contract:true};
  });
  await run('old_file_response_after_reconnect_must_not_supply_basis', async () => {
    await page.unroute('**/g30*');
    let releaseOld,releaseNew;
    const oldHold = new Promise(r=>releaseOld=r), newHold=new Promise(r=>releaseNew=r);
    let reads=0;
    await page.route('**/g30*', async route=>{
      const number=++reads;
      await (number===1?oldHold:newHold);
      await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,values:{...STORED,X:number===1?100:105},units:'mm'})});
    });
    try {
      await open(true,false);
      await expect.poll(()=>reads).toBe(1);
      await ctl({op:'refuseWs',on:true});
      await ctl({op:'shutdownClose'});
      await expect(page.getByText('Server shutting down')).toBeVisible();
      await ctl({op:'refuseWs',on:false});
      await expect(page.locator('.pill.armed')).toBeVisible({timeout:12000});
      await expect.poll(()=>reads).toBe(2);
      await page.waitForTimeout(300);
      await enterG30('X',120);
      await enterG30('Y',0);
      await enterG30('Z',-30);
      const before=await page.locator('.g30Stored').innerText();
      releaseOld();
      await page.waitForTimeout(400);
      const after=await page.locator('.g30Stored').innerText();
      const save=page.getByRole('button',{name:'Save G30',exact:true});
      const saveEnabled=await save.isEnabled();
      await expect(save).toBeDisabled();
      releaseNew();
      await expect(save).toBeEnabled();
      let sentSave=null;
      await save.click(); sentSave=await command('set_g30');
      return {reads,before,afterOld:after,draftX:await field('X').inputValue(),saveEnabledAfterOld:saveEnabled,sentSave,
        matches_contract:after.includes('unknown')&&!saveEnabled&&sentSave.based_on.X===105};
    } finally { releaseOld(); releaseNew(); await ctl({op:'refuseWs',on:false}); }
  });

} finally {
  await browser.close();
  const output=new globalThis.URL('./operator-punkte.r27.ui-probe.json',import.meta.url);
  let all=results;
  if (process.argv[2]) {
    const prior=JSON.parse(await readFile(output,'utf8'));
    all=[...prior.results.filter(r=>!results.some(n=>n.name===r.name)),...results];
  }
  await writeFile(output,JSON.stringify({head:'603e384',isolation:URL,results:all},null,2)+'\n');
}

// R26: one browser, own mock at 127.0.0.1:4188; no live gateway traffic.
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
  await run('choice_rejection_stays_pending', async () => {
    await open();
    await ctl({op:'replies',replies:{set_mode:{ok:false,error:'R26: controller refused this mode'}}});
    await option('Task mode','MDI').click();
    await command('set_mode');
    await page.waitForTimeout(600);
    const pending = await option('Task mode','MDI').getAttribute('aria-busy');
    const hints = await page.locator('.btnHint').allTextContents();
    const errors = await page.getByText('R26: controller refused this mode',{exact:false}).allTextContents();
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
    const active=await page.evaluate(()=>({tag:document.activeElement.tagName,role:document.activeElement.getAttribute('role')}));
    await ctl({op:'clearCmds'});
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
    const sent=await cmds();
    return {before:[1,10],after:[1,20],active,sent,matches_contract:active.role==='radio'&&!sent.some(c=>c.cmd.startsWith('jog'))};
  });
  await run('tools_spacing_and_sticky_head_control', async () => {
    await open();
    await page.locator('.sidePane').getByRole('tab',{name:'Tools',exact:true}).click();
    const tools = Array.from({length:40},(_,i)=>({T:i+1,P:i+1,Z:-40-i,D:6,type:'endmill',description:`R26 cutter ${i+1}`}));
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
    await ctl({op:'clearCmds'});
    for (const key of ['ArrowRight','Space','Enter']) await page.keyboard.press(key);
    const lockedCmds=await cmds();
    await ctl({op:'status_delta',data:{permissions:PERMS}});
    await expect(edit).toBeFocused();
    return {rows,summary,keyboardContext:'G54 · C · °',before,lockedSlots:spans,active_after_lock:active,
      canonical_and_unknown_pass:rows[0]?.[5]==='6.0000'&&rows[1]?.[5]==='8.0000'&&summary==='Offset status unknown — comp',
      lockedCmds, focus_retained:active!=='BODY'&&lockedCmds.length===0};
  });
  await run('old_file_response_after_reconnect_must_not_supply_basis', async () => {
    await page.unroute('**/g30*');
    let release;
    const hold = new Promise(r=>release=r);
    let readStarted=false;
    await page.route('**/g30*', async route=>{
      readStarted=true;
      await hold;
      await route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,values:STORED,units:'mm'})});
    });
    try {
      await open(true,false);
      await expect.poll(()=>readStarted).toBe(true);
      await ctl({op:'refuseWs',on:true});
      await ctl({op:'shutdownClose'});
      await expect(page.getByText('Server shutting down')).toBeVisible();
      await ctl({op:'refuseWs',on:false});
      await expect(page.locator('.pill.armed')).toBeVisible({timeout:12000});
      await page.waitForTimeout(300);
      await enterG30('X',120);
      await enterG30('Y',0);
      await enterG30('Z',-30);
      const before=await page.locator('.g30Stored').innerText();
      release();
      await page.waitForTimeout(400);
      const after=await page.locator('.g30Stored').innerText();
      const save=page.getByRole('button',{name:'Save G30',exact:true});
      const saveEnabled=await save.isEnabled();
      let sentSave=null;
      if (saveEnabled) { await save.click(); sentSave=await command('set_g30'); }
      return {before,after,draftX:await field('X').inputValue(),saveEnabled,sentSave,
        matches_contract:after.includes('unknown')||after.includes('not confirmed')};
    } finally { release(); await ctl({op:'refuseWs',on:false}); }
  });
  await run('custom_contrast_control', async () => {
    await open();
    await ctl({op:'raw',frame:{type:'settings_init',settings:{display:{theme:'light'},viewer:{paletteMode:'custom',paletteOrigin:'operator',colors:{feed:'#22b8cf'}}}}});
    await page.getByTitle('Settings',{exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
    await dialog.getByRole('tab',{name:'3D Viewer',exact:true}).click();
    const hint=dialog.locator('[data-contrast-hint]');
    await expect(hint.locator('tbody tr')).toHaveCount(7);
    const before=await hint.locator('[data-role="feed"]').innerText();
    const feed=dialog.locator('[data-viewer-legend] input[type="color"]').first();
    await feed.fill('#1f3f7f');
    await expect(hint.locator('[data-role="feed"]')).not.toContainText('low');
    const after=await hint.locator('[data-role="feed"]').innerText();
    const value=await feed.inputValue();
    return {before,after,value,matches_contract:before.includes('low')&&!after.includes('low')&&value==='#1f3f7f'};
  });
  await run('layout_budget_matrix', async () => {
    const profiles=[['3axis',['X','Y','Z'],null],['xyzac',['X','Y','Z','A','C'],{module:'xyzac-trt-kins',type:'xyzac-trt',identity_first:true,params:{}}],['twp',['X','Y','Z','A','B','C'],{module:'xyzacb_trsrn',type:'xyzacb-trsrn',identity_first:false,params:{}}]];
    const vps=[['desktop',1600,1000,false],['touch-landscape',1280,800,true],['touch-portrait',900,1200,true]];
    const budgets={ '3axis':{desktop:1678.5,'touch-landscape':1705.5,'touch-portrait':960},xyzac:{desktop:2148.5,'touch-landscape':2170.5,'touch-portrait':1148.5},twp:{desktop:2206.5,'touch-landscape':2228.5,'touch-portrait':1262.5}};
    const rows=[];
    for (const [name,axes,kins] of profiles) for (const [vp,width,height,touch] of vps) {
      await open();
      await ctl({op:'setAxes',axes}); await ctl({op:'setKins',kins});
      await ctl({op:'setIncrements',increments:[]});
      await ctl({op:'status_delta',data:{kins_type:kins?0:null,permissions:PERMS}});
      await page.evaluate(t=>document.documentElement.classList.toggle('touch-device',t),touch);
      await page.setViewportSize({width,height});
      await page.waitForTimeout(250);
      const m=await page.evaluate(()=>{
        const sections=[...document.querySelectorAll('[data-strip]')];
        const blk=document.querySelector('.stepBlock');
        const controls=[...document.querySelectorAll('[data-strip] [role="radio"]')];
        return {sections:sections.map(e=>({name:e.dataset.strip,height:e.getBoundingClientRect().height})),width:sections.reduce((a,e)=>a+e.getBoundingClientRect().width,0),
          height:['jog','setup'].reduce((a,n)=>a+document.querySelector(`[data-strip="${n}"]`).getBoundingClientRect().height,0),
          step:blk.querySelector('select')?'select':blk.querySelector('.choiceGroup .grid')?'grid':'row',
          minW:Math.min(...controls.map(e=>e.getBoundingClientRect().width)),minH:Math.min(...controls.map(e=>e.getBoundingClientRect().height)),
          overflow:sections.filter(e=>e.scrollHeight>e.clientHeight+1).map(e=>e.dataset.strip)};
      });
      const budget=budgets[name][vp], floor=touch?36:24;
      rows.push({profile:name,viewport:vp,...m,budget,pass:(vp==='touch-portrait'?m.height:m.width)<=budget+1&&m.minW>=floor&&m.minH>=floor&&m.overflow.length===0});
    }
    return {rows,matches_contract:rows.every(r=>r.pass)};
  });
} finally {
  await browser.close();
  const output=new globalThis.URL('./operator-punkte.r26.ui-probe.json',import.meta.url);
  let all=results;
  if (process.argv[2]) {
    const prior=JSON.parse(await readFile(output,'utf8'));
    all=[...prior.results.filter(r=>!results.some(n=>n.name===r.name)),...results];
  }
  await writeFile(output,JSON.stringify({head:'12341cb',isolation:URL,results:all},null,2)+'\n');
}

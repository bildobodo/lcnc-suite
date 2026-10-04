// R73 review probes. Built archive, private mock only; no live controller.
import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { ctl, publishToolTable } from './ctl';
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from './layout-fixtures';
import { sidewaysOverflow } from './layout-audit';
const evidence = (name: string, row: unknown) => writeFileSync(`../evidence/viewer-palette-fest.r73.${name}.json`, JSON.stringify(row, null, 2)+'\n');
const tool = (n: number) => ({T:n,P:n,D:6,Z:-40,type:'endmill',description:`Review tool ${n}`});
async function reads() {
  return ((await ctl({op:'lastCmds'})).cmds as {cmd:string;req_id:string}[]).filter(c=>c.cmd==='get_tool_table').map(c=>c.req_id);
}
const reply = (req_id: string, data: object) => ctl({op:'raw',frame:{type:'reply',cmd:'get_tool_table',req_id,...data}});

test('R73: newer table wins over old success and refusal in both consumers', async ({page}) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await page.getByRole('tab',{name:'Tools',exact:true}).click();
  await ctl({op:'status_delta',data:{tool_in_spindle:6,tool_number:6}});
  await page.waitForTimeout(800);
  await ctl({op:'replyFor',cmd:'get_tool_table',reply:'silent'});
  await ctl({op:'clearCmds'});
  await ctl({op:'raw',frame:{type:'tool_table_changed',version:73101}});
  await expect.poll(reads).toHaveLength(2);
  const old = await reads();
  await ctl({op:'raw',frame:{type:'tool_table_changed',version:73102}});
  await expect.poll(reads).toHaveLength(4);
  const fresh = (await reads()).slice(2);
  for (const id of fresh) await reply(id,{ok:true,tools:[tool(6)]});
  const panel=page.locator('.toolsTab'), strip=page.locator('[data-strip="tool"]');
  await expect(panel.getByRole('button',{name:'Edit T6',exact:true})).toBeVisible();
  await expect(strip).toContainText('Review tool 6');
  await reply(old[0]!,{ok:false,error:'Old table read refused'});
  await reply(old[1]!,{ok:true,tools:[tool(5)]});
  await page.waitForTimeout(300);
  await expect(panel.getByRole('button',{name:'Edit T6',exact:true})).toBeVisible();
  await expect(panel.getByRole('button',{name:'Edit T5',exact:true})).toHaveCount(0);
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(strip.getByRole('alert')).toHaveCount(0);
  await expect(strip).toContainText('Review tool 6');
  evidence('out-of-order',{old,fresh,oldReplies:['refusal','success T5'],shown:'T6 in table and strip',alerts:0});
});

test('R73: real 60-second deadline, expired replies ignored, retry recovers', async ({page}) => {
  test.setTimeout(85000);
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await page.getByRole('tab',{name:'Tools',exact:true}).click();
  await page.waitForTimeout(800);
  await ctl({op:'replyFor',cmd:'get_tool_table',reply:'silent'});
  await ctl({op:'clearCmds'});
  const start=Date.now();
  await ctl({op:'raw',frame:{type:'tool_table_changed',version:73103}});
  await expect.poll(reads).toHaveLength(2);
  const ids=await reads();
  const panel=page.locator('.toolsTab'), strip=page.locator('[data-strip="tool"]');
  const note=panel.getByRole('alert');
  await expect(note).toContainText('No reply from the gateway yet — retry',{timeout:12000});
  const slowAfterMs=Date.now()-start;
  await expect(note).toContainText('No reply from the gateway — retry',{timeout:62000});
  const expiredAfterMs=Date.now()-start;
  await expect(panel.locator('.emptyState.loading')).toHaveCount(0);
  await expect(panel.locator('.emptyState')).toHaveText('Tool table not read.');
  await expect(strip.getByRole('alert')).toContainText('no reply from the gateway');
  for(const id of ids) await reply(id,{ok:true,tools:[tool(8)]});
  await page.waitForTimeout(250);
  await expect(panel.getByRole('button',{name:'Edit T8',exact:true})).toHaveCount(0);
  await ctl({op:'replyFor',cmd:'get_tool_table',reply:{ok:true,tools:[tool(7)]}});
  await note.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(panel.getByRole('button',{name:'Edit T7',exact:true})).toBeVisible();
  await expect(note).toHaveCount(0);
  await strip.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(strip.getByRole('alert')).toHaveCount(0);
  evidence('timeout',{slowAfterMs,expiredAfterMs,ignoredExpiredReply:true,retryTable:'T7',stripRetryCleared:true});
});

test('R73: messages with an active E-Stop banner and long text remain readable narrow',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('lcnc-messages',JSON.stringify([
    {id:1,kind:1,text:'A long controller message: '+ 'axis limit and tool offset '.repeat(14),ts:Date.UTC(2026,9,4,14,34),source:'linuxcnc'},
    {id:2,kind:6,text:'Saved program.ngc',ts:Date.UTC(2026,9,4,14,35),source:'webui'}
  ])));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v=>v.name==='touch-portrait')!);
  await page.evaluate(()=>document.documentElement.style.zoom='1.5');
  await ctl({op:'raw',frame:{type:'status_delta',armed:true,data:{estop:true,enabled:false},safety_trip:{reason:'hal_heartbeat_timeout'}}});
  await page.getByTitle(/^Messages \(\d+\)$/).click();
  const dialog=page.getByRole('dialog',{name:/^Messages/});
  await expect(dialog.locator('.msgContent > .statusNote')).toBeVisible();
  await settleLayout(page);
  const over=await sidewaysOverflow(dialog);
  expect(over).toEqual([]);
  await dialog.screenshot({path:'../evidence/viewer-palette-fest.r73.messages-narrow.png'});
  const table=await dialog.locator('.msgTable').evaluate(t=>({clientHeight:t.clientHeight,scrollHeight:t.scrollHeight}));
  expect(table.clientHeight).toBeGreaterThan(80);
  await page.setViewportSize({width:1600,height:1000});
  await page.evaluate(()=>document.documentElement.style.zoom='1');
  await settleLayout(page);
  await dialog.screenshot({path:'../evidence/viewer-palette-fest.r73.messages-desktop.png'});
  evidence('messages-layout',{over,table});
});

test('R73: memoized Gamepad choice remains editable while the pad and status update',async({page})=>{
  await page.addInitScript(()=>{
    const pad={id:'Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)',index:0,connected:true,mapping:'standard',timestamp:0,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,touched:false,value:0}))};
    (window as any).__reviewPad=pad;
    Object.defineProperty(navigator,'getGamepads',{value:()=>[pad,null,null,null]});
  });
  await openLayout(page,PROFILES[1]!,VIEWPORTS[0]!);
  await ctl({op:'raw',frame:{type:'settings_init',settings:{gamepad:{jogEnabled:true,buttonsEnabled:true}}}});
  await page.getByTitle('Settings',{exact:true}).click();
  await page.getByRole('dialog',{name:'Settings',exact:true}).getByRole('tab',{name:'Gamepad',exact:true}).click();
  const select=page.getByRole('combobox',{name:'A action',exact:true});
  await select.selectOption('none');
  await expect(select).toHaveValue('none');
  for(let i=0;i<20;i++){
    await ctl({op:'status_delta',data:{position:[i,0,0,0,0,0,0,0,0]}});
    await page.evaluate(i=>{(window as any).__reviewPad.axes[0]=i%2?.6:-.6;(window as any).__reviewPad.timestamp=i;},i);
  }
  await expect(select).toHaveValue('none');
  await select.selectOption('start');
  await expect(select).toHaveValue('start');
  evidence('gamepad-edits',{first:'none',after20Packets:'none',second:'start',browser:test.info().project.use.browserName});
});

test('R73: a system banner leaves messages reachable on a short landscape display',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('lcnc-messages',JSON.stringify([
    {id:1,kind:1,text:'Review: reach this controller message',ts:Date.UTC(2026,9,4,14,34),source:'linuxcnc'},
    {id:2,kind:6,text:'Review: second message',ts:Date.UTC(2026,9,4,14,35),source:'webui'}
  ])));
  await openLayout(page,PROFILES[1]!,VIEWPORTS.find(v=>v.name==='touch-landscape')!);
  await ctl({op:'raw',frame:{type:'status_delta',armed:true,data:{},safety_trip:{reason:'hal_heartbeat_timeout'}}});
  await page.getByTitle(/^Messages \(\d+\)$/).click();
  const dialog=page.getByRole('dialog',{name:/^Messages/});
  const results=[];
  for(const zoom of [1,1.5]){
    await page.evaluate(z=>document.documentElement.style.zoom=String(z),zoom);
    await settleLayout(page);
    const sizes=await dialog.evaluate(d=>{
      const t=d.querySelector('.msgTable')!,head=t.querySelector('thead')!;
      const tb=t.getBoundingClientRect(),hb=head.getBoundingClientRect();
      return {tableHeight:tb.height,headHeight:hb.height,bodyRoom:tb.height-hb.height,dialogHeight:d.getBoundingClientRect().height,
        contentClientHeight:d.querySelector('.msgContent')!.clientHeight,contentScrollHeight:d.querySelector('.msgContent')!.scrollHeight};
    });
    results.push({zoom,...sizes});
    await dialog.screenshot({path:`../evidence/viewer-palette-fest.r73.messages-landscape-${zoom}.png`});
  }
  evidence('messages-short',results);
  for(const r of results) expect(r.bodyRoom,JSON.stringify(r)).toBeGreaterThan(20);
});

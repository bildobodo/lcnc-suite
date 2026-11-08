import {test,expect,type Route} from './test';
import {ctl,MOCK} from './ctl';
import {encode} from '@msgpack/msgpack';

async function settings(page:any) {
  await page.getByTitle('Settings',{exact:true}).click();
  const dlg=page.getByRole('dialog',{name:'Settings',exact:true});
  await dlg.getByRole('tab',{name:'Devices',exact:true}).click();
  return dlg;
}

test('a focused timeline link also hands focus back when simulation goes off', async({page})=>{
  await page.route(/\/preview(\?|$)/, r => r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode({
    file:'/leak.ngc',preview_schema:11,feed:[[0,0,0],[10,0,0],[10,10,0]],feed_lines:[1,2,3],
    feed_seq:[1,2,3],feed_outside:new Uint8Array(3),rapid:[],violations:[],violations_total:0
  }))}));
  await page.route(/\/gcode(\?|$)/, r => r.fulfill({contentType:'text/plain',body:'G0 X0\nG1 X10 F100\nG1 Y10\nM2\n'}));
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  const keyboard={jogEnabled:true,buttonsEnabled:true};
  await ctl({op:'raw',frame:{type:'settings_init',settings:{simulation:{enabled:true},keyboard}}});
  await ctl({op:'status_delta',data:{active_file:'/leak.ngc'}});
  await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:8901,file:'/leak.ngc'}});
  const link=page.getByRole('button',{name:'Open the Sim tab',exact:true});
  await expect(link).toBeVisible(); await link.focus(); await expect(link).toBeFocused();
  await ctl({op:'raw',frame:{type:'settings_changed',settings:{simulation:{enabled:false},keyboard}}});
  await expect(link).toHaveCount(0);
  const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,role:document.activeElement?.getAttribute('role')}));
  await ctl({op:'clearCmds'});
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(100); await page.keyboard.up('ArrowRight');
  const commands=((await ctl({op:'lastCmds'})) as {cmds:any[]}).cmds;
  console.log('TIMELINE_FOCUS',JSON.stringify({focus,commands}));
  expect(commands.filter(c=>c.cmd.startsWith('jog'))).toEqual([]);
});

test('a newly created bound profile keeps its own controls available beside the notice', async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('lcnc-device-token','a'.repeat(32)));
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'raw',frame:{type:'settings_init',settings:{simulation:{enabled:false}},
    device:{id:'NEW',name:'',created:true},revs:{simulation:0}}});
  const dlg=await settings(page);
  await expect(dlg.locator('[data-device-new]')).toBeVisible();
  console.log('RECREATED',await dlg.locator('[data-devices=this]').innerText());
  expect(await dlg.locator('[data-devices=this]').getByRole('checkbox').count()).toBe(1);
  expect(await dlg.locator('[data-devices=this]').getByLabel('Name').count()).toBe(1);
});

test('an old device-list response cannot replace the list of a newer binding', async({page})=>{
  let old:Route|undefined; let n=0;
  const row=(id:string,own:boolean)=>({id,name:id,created:null,last_seen:null,last_address:null,
    changed:true,simulation:false,simulation_rev:0,online:true,tabs:1,this:own});
  await page.route('**/devices',async route=>{
    n++;
    if(n===1){old=route;return;}
    await route.fulfill({json:{ok:true,devices:[row('A',false),row('B',true)]}});
  });
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'raw',frame:{type:'settings_init',settings:{simulation:{enabled:false}},device:{id:'A',name:'A'}}});
  const dlg=await settings(page);
  await expect.poll(()=>!!old).toBe(true);
  // Actual storage-triggered token rebind; the old HTTP response is still pending.
  await page.evaluate(()=>{
    localStorage.setItem('lcnc-device-token','b'.repeat(32));
    window.dispatchEvent(new StorageEvent('storage',{key:'lcnc-device-token'}));
  });
  await expect.poll(async()=>((await ctl({op:'lastHellos'})) as any).hellos.some((h:any)=>h.device_token==='b'.repeat(32))).toBe(true);
  await ctl({op:'raw',frame:{type:'settings_init',settings:{simulation:{enabled:false}},device:{id:'B',name:'B'}}});
  await ctl({op:'raw',frame:{type:'devices_changed'}});
  await expect(dlg.locator('[data-device-row=A]')).toBeVisible();
  await expect(dlg.locator('[data-device-row=B]')).toHaveCount(0);
  await old!.fulfill({json:{ok:true,devices:[row('A',true),row('B',false)]}});
  // A settled response is the boundary: the stale list wrongly shows self B as other.
  await page.waitForTimeout(100);
  console.log('DEVICE_LIST_AFTER_OLD_REPLY',await dlg.locator('[data-devices=others]').innerText());
  expect(await dlg.locator('[data-device-row=B]').count()).toBe(0);
  expect(await dlg.locator('[data-device-row=A]').count()).toBe(1);
});

test('an old device-list response cannot replace a new INI list after a socket reconnect', async({page})=>{
  let old:Route|undefined; let n=0;
  const row=(id:string,own:boolean)=>({id,name:id,created:null,last_seen:null,last_address:null,
    changed:true,simulation:false,simulation_rev:0,online:true,tabs:1,this:own});
  await page.route('**/devices',async route=>{
    n++;
    if(n===1){old=route;return;}
    await route.fulfill({json:{ok:true,devices:[row('A',false),row('B',true)]}});
  });
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'raw',frame:{type:'settings_init',settings:{simulation:{enabled:false}},device:{id:'A',name:'A'}}});
  const dlg=await settings(page);
  await expect.poll(()=>!!old).toBe(true);
  const before=((await ctl({op:'lastHellos'})) as any).hellos.length;
  await ctl({op:'shutdownClose'});
  await expect.poll(async()=>((await ctl({op:'lastHellos'})) as any).hellos.length,{timeout:10000}).toBeGreaterThan(before);
  // The new gateway's first snapshot binds the same browser token to its INI.
  await ctl({op:'raw',frame:{type:'settings_init',settings:{simulation:{enabled:false}},device:{id:'B',name:'B'}}});
  await ctl({op:'raw',frame:{type:'devices_changed'}});
  await expect(dlg.locator('[data-device-row=A]')).toBeVisible();
  await expect(dlg.locator('[data-device-row=B]')).toHaveCount(0);
  await old!.fulfill({json:{ok:true,devices:[row('A',true),row('B',false)]}});
  // A settled response is the boundary: the stale list wrongly shows self B as other.
  await page.waitForTimeout(100);
  console.log('DEVICE_LIST_AFTER_OLD_REPLY',await dlg.locator('[data-devices=others]').innerText());
  expect(await dlg.locator('[data-device-row=B]').count()).toBe(0);
  expect(await dlg.locator('[data-device-row=A]').count()).toBe(1);
});

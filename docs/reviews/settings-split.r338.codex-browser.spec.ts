import {test,expect} from './test';
import {ctl,MOCK} from './ctl';

test('foreign conflict must not show Sim on the local device',async({page})=>{
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'raw',frame:{type:'settings_init',settings:{simulation:{enabled:false}},
    revs:{simulation:0},device:{id:'A',name:'Panel A'}}});
  await expect(page.getByRole('tab',{name:'Sim',exact:true})).toHaveCount(0);
  // Exact server reply from _ws_save_settings for a foreign stale save.
  // It names only the section, not the device; R338 backend probe pins it.
  await ctl({op:'raw',frame:{type:'reply',ok:false,cmd:'save_settings',req_id:'foreign-conflict',
    section:'simulation',stale:true,data:{enabled:true},rev:1,error:'simulation changed elsewhere — reloaded'}});
  // Wait for dispatch rather than a negative assertion before the frame.
  await expect(page.getByText('simulation changed elsewhere — reloaded',{exact:false}).first()).toBeVisible();
  expect(await page.getByRole('tab',{name:'Sim',exact:true}).count()).toBe(0);
});

test('removing the selected Sim tab gives keyboard focus to its replacement',async({page})=>{
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'raw',frame:{type:'settings_changed',settings:{simulation:{enabled:true},keyboard:{jogEnabled:true,buttonsEnabled:true}}}});
  const tab = page.getByRole('tab',{name:'Sim',exact:true});
  await tab.click(); await tab.focus();
  await expect(tab).toBeFocused();
  await ctl({op:'raw',frame:{type:'settings_changed',settings:{simulation:{enabled:false},keyboard:{jogEnabled:true,buttonsEnabled:true}}}});
  const program = page.getByRole('tab',{name:'Program',exact:true});
  await expect(program).toHaveAttribute('aria-selected','true');
  const focused = await page.evaluate(()=>({tag:document.activeElement?.tagName,role:document.activeElement?.getAttribute('role')}));
  await ctl({op:'clearCmds'});
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(100); await page.keyboard.up('ArrowRight');
  const cmds = ((await ctl({op:'lastCmds'})) as {cmds:any[]}).cmds;
  console.log('FOCUS_AFTER_REMOVAL',JSON.stringify({focused,cmds}));
  expect(cmds.filter(c=>c.cmd.startsWith('jog'))).toEqual([]);
  expect(await page.locator('[role=tab]:focus').count()).toBe(1);
});

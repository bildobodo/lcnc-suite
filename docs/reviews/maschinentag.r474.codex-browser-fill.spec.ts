import { test, expect } from './test';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';

// The real handler's companion probe (test_restart_order.py) establishes:
// new io loaded P1 before the admitted commit published P8; old owner's
// reload fails, then rule R says complete under the new instance.
// Both controllers' scalar tool fields match, so this is a complete read.
const TOOL = { T: 1, P: 8, D: 6, Z: 50, type: 'endmill', description: 'first' };
const OLD = { path: '/cfg/tool.tbl', instance: '111:111' };
const NEW = { path: '/cfg/tool.tbl', instance: '222:222' };
const proof = { state: 'complete', proven: [1], differs: [], missing: [], extra: [], duplicates: [], why: null };

test('R474 restart before the file commit cannot prove that the written pocket loaded', async ({ page }) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  const read = (table: typeof OLD, pocket=8) => ctl({op:'replyFor', cmd:'get_tool_table', reply: {
    ok:true, tools:[{...TOOL, P:pocket}], table, proof, unread:[], edit_refusal:null}});
  await read(OLD, 1);
  await ctl({op:'raw',frame:{type:'tool_table_changed',version:2401}});
  await page.getByRole('tab',{name:'Tools',exact:true}).click();
  const tab=page.locator('.toolsTab');
  await tab.getByRole('button',{name:'Edit T1',exact:true}).click();
  await ctl({op:'replyFor',cmd:'save_tool',reply:{ok:true,reload:'reload failed'}});
  await ctl({op:'replyFor',cmd:'get_tool_table',reply:'silent'});
  await ctl({op:'clearCmds'});
  const editor=page.getByRole('dialog',{name:'Edit Tool T1',exact:true});
  await expect(editor.getByLabel('Pocket',{exact:true})).toHaveValue('1');
  await editor.getByLabel('Pocket',{exact:true}).fill('8');
  await editor.getByRole('button',{name:'Save',exact:true}).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => ((await ctl({op:'lastCmds'})).cmds as {cmd:string}[])
    .filter(c=>c.cmd==='get_tool_table').length).toBeGreaterThan(0);
  const sent=((await ctl({op:'lastCmds'})).cmds as {cmd:string; pocket?:number}[])
    .find(c=>c.cmd==='save_tool');
  expect(sent?.pocket).toBe(8);
  // The successful file-write reply reached the page before the old
  // gateway/socket ends. The new instance's start preceded that commit.
  await read(NEW);
  await ctl({op:'shutdownClose'});
  await expect(tab.getByRole('button',{name:'Edit T1',exact:true})).toHaveCount(0);
  await expect(tab.getByRole('button',{name:'Edit T1',exact:true})).toBeVisible({timeout:20000});
  const note=tab.locator('[data-write-state]');
  console.log('R474_EARLY_START', JSON.stringify({old:OLD, now:NEW, proof:proof.state,
    filePocket:8, loadedPocket:1, notes:await note.allTextContents()}));
  await page.screenshot({path:'/tmp/r474/early-start.png'});
  await expect(note,'the new instance started BEFORE this file commit; the old reload failed')
    .toContainText('load into LinuxCNC failed',{timeout:1000});
});

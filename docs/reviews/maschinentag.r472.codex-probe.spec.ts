import { test, expect } from './test';
import { ctl, publishToolTable } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';
const TOOL = { T: 5, P: 8, D: 6, Z: -40, type: 'endmill', description: 'Five mill' };
const IDENTITY = {path: '/cfg/tool.tbl', instance: '123:456'};
const READ = {ok: true, tools: [TOOL], table: IDENTITY,
  proof: {state:'complete', proven:[5], differs:[], missing:[], extra:[], duplicates:[], why:null}, unread:[], edit_refusal:null};
const NOTE = 'Table saved, load into LinuxCNC failed — restart loads it.';
for (const reconnect of [false, true]) {
 test(`R472 failed pocket reload keeps its note after ${reconnect ? 'socket-only reconnect' : 'ordinary reread'}`, async ({page}) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await ctl({op:'replyFor', cmd:'get_tool_table', reply: READ});
  await ctl({op:'raw', frame:{type:'tool_table_changed',version:2001}});
  await page.getByRole('tab',{name:'Tools',exact:true}).click();
  const tab=page.locator('.toolsTab');
  await tab.getByRole('button',{name:'Edit T5',exact:true}).click();
  await ctl({op:'replyFor',cmd:'save_tool',reply:{ok:true,reload:'reload failed'}});
  await page.getByRole('dialog',{name:'Edit Tool T5'}).getByRole('button',{name:'Save',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Edit Tool T5'})).toHaveCount(0);
  const note=tab.locator('[data-write-state]');
  await expect(note).toHaveText(NOTE);
  if (reconnect) {
    // ONLY the WebSocket closes. The mock process, config, instance and read
    // response stay unchanged. No reload was sent and no LinuxCNC restart.
    await ctl({op:'shutdownClose'});
    await expect(tab.getByRole('button',{name:'Edit T5',exact:true})).toHaveCount(0);
    await expect(tab.getByRole('button',{name:'Edit T5',exact:true})).toBeVisible({timeout:20000});
  } else {
    await ctl({op:'raw',frame:{type:'tool_table_changed',version:2002}});
    await expect(tab.getByRole('button',{name:'Edit T5',exact:true})).toBeVisible();
  }
  console.log(JSON.stringify({case:reconnect?'same-instance reconnect':'reread', identity:IDENTITY, read:READ.proof.state, note:await note.allTextContents()}));
  await expect(note,'A socket reconnect proves neither the old pocket nor a new LinuxCNC start').toHaveText(NOTE,{timeout:1000});
 });
}

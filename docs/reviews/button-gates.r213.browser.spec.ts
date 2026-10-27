// R213 independent checks. Run only against the isolated archive and mock :4188.
import { test, expect, type Page } from '@playwright/test';
import { ctl, MOCK } from './ctl';
import { GATE_NAMES } from '../src/permissions';
import { clickMore } from './more';
const perms = Object.fromEntries(GATE_NAMES.map(k=>[k,true]));
async function state(page:Page, armed:boolean, extra:Record<string,unknown>={}) {
 await ctl({op:'status_delta', armed, data:{permissions:perms,enabled:true,is_enabled:true,estop:false,is_estop:false,homed:true,homed_joints:[true,true,true],interp_state:1,task_mode:1,paused:false,...extra}});
 await expect(page.locator(armed?'.pill.armed':'.pill.disarmed')).toHaveCount(1);
}
async function open(page:Page, armed=false, settings:Record<string,unknown>={}) {
 await ctl({op:'reset'}); await page.goto(MOCK);
 await expect(page.locator('input.setupInput').first()).toBeVisible();
 await ctl({op:'quiet',on:true}); await ctl({op:'raw',frame:{type:'settings_init',settings}}); await state(page,armed);
}
async function commands() {return (await ctl({op:'lastCmds'})).cmds as any[];}
async function settings(page:Page, tab:string) {
 await page.getByTitle('Settings',{exact:true}).click();
 const s=page.getByRole('dialog',{name:'Settings',exact:true});
 await s.getByRole('tab',{name:tab,exact:true}).click(); return s;
}
async function pressDisabled(page:Page, selector:string) {
 const box=await page.locator(selector).boundingBox(); expect(box).not.toBeNull();
 await page.mouse.click(box!.x+box!.width/2,box!.y+box!.height/2);
}
test('RPM preselection remains editable during a run and a turning spindle',async({page})=>{
 await open(page);
 for(const data of [{interp_state:2},{interp_state:1,spindle_enabled:true,spindle_direction:1,spindle_speed:1500}]) {
  await state(page,false,data);
  console.log('RPM',data,await page.locator('.spRpmInput').evaluate(e=>({disabled:(e as HTMLInputElement).disabled,title:e.getAttribute('title')})));
  await expect.soft(page.locator('.spRpmInput'),'BG-05: free preselection, actual spindle speed is separate').toBeEnabled();
 }
});
test('a protected reset opened armed explains the closed enclosing Gate after disarm; display reset stays free',async({page})=>{
 await open(page,true); const s=await settings(page,'Machine');
 await s.getByRole('button',{name:'Reset Machine',exact:true}).click();
 const confirm=page.getByRole('dialog',{name:'Reset Machine settings?',exact:true});
 await expect(confirm).toBeVisible(); await state(page,false); await ctl({op:'clearCmds'});
 const reset=confirm.getByRole('button',{name:'Reset',exact:true}); await expect(reset).toBeDisabled();
 await confirm.locator('.btnTip').click(); await expect(page.locator('.btnHint')).toHaveText(/Not armed/);
 expect((await commands()).filter(c=>c.cmd==='save_settings')).toEqual([]);
 await confirm.getByRole('button',{name:'Cancel',exact:true}).click();
 await s.getByRole('tab',{name:'Display',exact:true}).click();
 await s.getByRole('button',{name:'Reset Display',exact:true}).click();
 const d=page.getByRole('dialog',{name:'Reset Display settings?',exact:true});
 await expect(d.getByRole('button',{name:'Reset',exact:true})).toBeEnabled();
 await d.getByRole('button',{name:'Reset',exact:true}).click();
 await expect.poll(async()=> (await commands()).filter(c=>c.cmd==='save_settings').map(c=>c.section)).toContain('display');
 expect((await commands()).filter(c=>c.cmd==='save_settings'&&c.section!=='display')).toEqual([]);
 await s.getByRole('button',{name:'Close settings',exact:true}).click();
});
test('protected keypad closes at disarm without applying or writing',async({page})=>{
 await open(page,true); await page.getByRole('tab',{name:'Probing',exact:true}).click();
 const field=page.locator('input.inputField[data-control="probeParam"]').first(); await field.click();
 await expect(page.locator('.nkStrip')).toBeVisible(); await page.locator('.nkStrip').getByRole('button',{name:'7',exact:true}).click();
 await ctl({op:'clearCmds'}); await state(page,false);
 await expect(page.locator('.nkStrip')).toBeHidden(); await expect(field).toBeDisabled();
 expect((await commands()).filter(c=>c.cmd==='save_settings')).toEqual([]);
});
test('keyboard capture ends with disarm and the next key cannot update the mapping',async({page})=>{
 await open(page,true,{keyboard:{jogEnabled:true,buttonsEnabled:true}}); const s=await settings(page,'Keyboard');
 const cell=s.locator('.kbKeyCell').first(); await cell.click(); await expect(cell).toHaveText('Press a key…');
 await ctl({op:'clearCmds'}); await state(page,false); await expect(cell).not.toHaveText('Press a key…');
 await page.keyboard.press('q'); await expect(cell).toHaveAttribute('aria-disabled','true');
 expect((await commands()).filter(c=>c.cmd==='save_settings'||c.cmd.startsWith('jog_'))).toEqual([]);
 await cell.click(); await expect(page.locator('.btnHint')).toHaveText(/Not armed/);
});
test('MDI strip edits disarmed, Apply explains refusal and keeps draft without history writes',async({page})=>{
 await open(page); await page.getByRole('tab',{name:'MDI',exact:true}).click();
 const mdi=page.getByRole('textbox',{name:'MDI command',exact:true}); await mdi.fill('G0 X1'); await mdi.focus();
 await page.locator('.inputAction').click(); await expect(page.locator('.tkStrip')).toBeVisible();
 await ctl({op:'clearCmds'}); await page.locator('.tkEnter').click();
 await expect(page.locator('.btnHint')).toHaveText(/Not armed/); await expect(mdi).toHaveValue('G0 X1');
 expect((await commands()).filter(c=>c.cmd==='mdi'||c.cmd==='save_settings')).toEqual([]);
 await page.locator('.tkStrip').getByRole('button',{name:'Close keyboard',exact:true}).click();
 await expect(page.locator('.tkStrip')).toBeHidden();
});
test('file row and mode choice explain the block by a real pointer tap',async({page})=>{
 await open(page); await page.route('**/files*',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,nc_dir:'/nc',subdir:'',entries:[{name:'part.ngc',path:'/nc/part.ngc',type:'file'}]})}));
 await clickMore(page.locator('.sidePane .container').filter({has:page.locator('.codeArea')}).locator('.ctrlRow'),'Files');
 await expect(page.getByRole('button',{name:'part.ngc',exact:true})).toBeVisible();
 await pressDisabled(page,'[aria-label="part.ngc"]'); await expect(page.locator('.btnHint')).toHaveText(/Not armed/);
 await pressDisabled(page,'[data-control="modeSelect"]:has-text("Auto")'); await expect(page.locator('.btnHint')).toHaveText(/Not armed/);
});

test('a free numeric draft survives disarm (RPM at idle)',async({page})=>{
 await open(page,true); const rpm=page.locator('.spRpmInput'); await rpm.click();
 const pad=page.locator('.nkStrip'); await expect(pad).toBeVisible();
 await pad.getByRole('button',{name:'7',exact:true}).click();
 await expect(pad.locator('.nkExpr')).toHaveText('7');
 await ctl({op:'clearCmds'}); await state(page,false);
 await expect(rpm).toBeEnabled();
 await expect.soft(pad,'a free field does not lose its editing session on disarm').toBeVisible();
 if(!(await pad.isVisible())) await rpm.click();
 await expect.soft(pad.locator('.nkExpr'),'the unconfirmed 7 must not be discarded by a global arm watcher').toHaveText('7');
 expect((await commands()).filter(c=>c.cmd==='mdi'||c.cmd.startsWith('spindle_'))).toEqual([]);
});
test('the jog centre Stop is operable with Enter, like the pointer',async({page})=>{
 await open(page); const stop=page.locator('[data-control="jogStop"]');
 await expect(stop).toBeEnabled(); await stop.focus(); await ctl({op:'clearCmds'});
 await page.keyboard.press('Enter');
 await expect.soft.poll(async()=>(await commands()).filter(c=>c.cmd==='jog_stop').length,{message:'Enter activation of the visible Stop',timeout:700}).toBeGreaterThan(0);
 await ctl({op:'clearCmds'}); await page.keyboard.press('Space');
 await expect.soft.poll(async()=>(await commands()).filter(c=>c.cmd==='jog_stop').length,{message:'Space activation of the visible Stop',timeout:700}).toBeGreaterThan(0);
 await ctl({op:'clearCmds'}); await stop.click();
 await expect.poll(async()=>(await commands()).filter(c=>c.cmd==='jog_stop').length,'pointer positive control').toBe(3);
});

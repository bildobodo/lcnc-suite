// R214 independent checks: all commands only to the isolated mock :4188.
import {test,expect,type Page} from '@playwright/test';
import {ctl,MOCK} from './ctl';
import {GATE_NAMES} from '../src/permissions';
const permissions=Object.fromEntries(GATE_NAMES.map(k=>[k,true]));
async function arm(page:Page,armed:boolean,extra:Record<string,unknown>={}) {
 await ctl({op:'status_delta',armed,data:{permissions,interp_state:1,task_mode:1,homed:true,enabled:true,estop:false,...extra}});
 await expect(page.locator(armed?'.pill.armed':'.pill.disarmed')).toHaveCount(1);
}
async function open(page:Page) {
 await ctl({op:'reset'});await page.goto(MOCK);
 await expect(page.locator('input.setupInput').first()).toBeVisible();
 await ctl({op:'quiet',on:true});await ctl({op:'raw',frame:{type:'settings_init',settings:{}}});
 await arm(page,false);
}
async function enterRpm(page:Page,text:string) {
 await page.locator('.spRpmInput').click();const pad=page.locator('.nkStrip');
 for(const digit of text) await pad.getByRole('button',{name:digit,exact:true}).click();
 await pad.getByRole('button',{name:'Apply',exact:true}).click();
 await expect(page.locator('.spRpmInput')).toHaveValue(text);
}
const cmds=async()=> (await ctl({op:'lastCmds'})).cmds as any[];
test('an RPM draft survives a late initial INI default',async({page})=>{
 await open(page);await enterRpm(page,'800');
 await ctl({op:'clearCmds'});
 // A slow viewer_init/configuration may follow the status and a free input.
 await ctl({op:'setViewerInit',data:{units:'mm',axes:['X','Y','Z'],parts:[],kinematics:[],stl_base_url:'/machine/',ini_config:{default_spindle_speed:2400,max_spindle_speed:4800}}});
 // Wait for this very INI to apply, not just for the control channel's ACK.
 await expect(page.locator('.spRpmInput')).toHaveAttribute('max','4800');
 console.log('RPM after late INI',await page.locator('.spRpmInput').inputValue());
 expect((await cmds()).filter(c=>c.cmd.startsWith('spindle_'))).toEqual([]);
 await expect(page.locator('.spRpmInput'),'an unrequested INI default must not replace the prepared 800').toHaveValue('800');
});
test('a prepared RPM survives Stop and a new run at another commanded value',async({page})=>{
 await open(page);await arm(page,false,{spindle_direction:1,spindle_speed:1500});
 await expect(page.locator('.spRpmInput')).toHaveValue('1500');await enterRpm(page,'800');
 await arm(page,false,{spindle_direction:0,spindle_speed:0});
 await expect(page.locator('.spNow')).toBeHidden();await expect(page.locator('.spRpmInput')).toHaveValue('800');
 await arm(page,true,{spindle_direction:1,spindle_speed:1900});
 await expect(page.locator('.spNow')).toHaveText(/1900/);await expect(page.locator('.spRpmInput')).toHaveValue('800');
});
test('held Stop keys do not repeat, and never start a jog',async({page})=>{
 await open(page);const stop=page.locator('[data-control="jogStop"]');await stop.focus();
 for(const key of ['Enter','Space']) {
  await ctl({op:'clearCmds'});await page.keyboard.down(key);await page.keyboard.down(key);await page.keyboard.down(key);await page.keyboard.up(key);
  await expect.poll(async()=>(await cmds()).filter(c=>c.cmd==='jog_stop').length).toBe(3);
  expect((await cmds()).filter(c=>/^jog_(?!stop)/.test(c.cmd))).toEqual([]);
 }
});

test('without an operator draft the INI default is adopted (positive control)',async({page})=>{
 await open(page);
 await ctl({op:'setViewerInit',data:{units:'mm',axes:['X','Y','Z'],parts:[],kinematics:[],stl_base_url:'/machine/',ini_config:{default_spindle_speed:2400,max_spindle_speed:4800}}});
 await expect(page.locator('.spRpmInput')).toHaveAttribute('max','4800');
 await expect(page.locator('.spRpmInput')).toHaveValue('2400');
});
test('a late INI default does not replace an already mirrored running speed',async({page})=>{
 await open(page);await arm(page,false,{spindle_direction:1,spindle_speed:1500});
 await expect(page.locator('.spRpmInput')).toHaveValue('1500');
 await ctl({op:'setViewerInit',data:{units:'mm',axes:['X','Y','Z'],parts:[],kinematics:[],stl_base_url:'/machine/',ini_config:{default_spindle_speed:2400,max_spindle_speed:4800}}});
 await expect(page.locator('.spRpmInput')).toHaveAttribute('max','4800');
 await expect(page.locator('.spNow')).toHaveText(/1500/);
 await expect(page.locator('.spRpmInput'),'no prepared value: keep the live commanded speed, not the default').toHaveValue('1500');
});

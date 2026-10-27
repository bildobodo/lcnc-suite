// Review R215. Only the isolated mock on 127.0.0.1:4188; no live machine.
import { test, expect, type Page } from '@playwright/test';
import { ctl, MOCK } from './ctl';
import { GATE_NAMES } from '../src/permissions';
const base = { units: 'mm', axes: ['X','Y','Z','A','C'], parts: [], kinematics: [], stl_base_url: '/machine/' };
async function open(page: Page) {
  await ctl({op:'reset'}); await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({op:'quiet',on:true});
  await ctl({op:'raw',frame:{type:'settings_init',settings:{}}});
  await ctl({op:'status_delta',armed:false,data:{permissions:Object.fromEntries(GATE_NAMES.map(k=>[k,true])),interp_state:1,task_mode:1,homed:true,enabled:true,estop:false}});
  await expect(page.locator('.pill.disarmed')).toHaveCount(1);
  await ctl({op:'setViewerInit',data:{...base,ini_config:{}}});
  await expect(page.getByRole('slider',{name:'Rotary jog speed',exact:true})).toHaveAttribute('aria-valuetext','600 °/min');
  await ctl({op:'clearCmds'});
}
async function ini(page: Page, max = 4800, speed = 20) {
  await ctl({op:'setViewerInit',data:{...base,ini_config:{default_spindle_speed:2400,max_spindle_speed:max,default_jog_velocity:speed,max_jog_velocity:50,default_angular_jog_velocity:speed+5,max_angular_jog_velocity:50}}});
  await expect(page.locator('.spRpmInput')).toHaveAttribute('max',String(max));
}
async function noMotion() {
  const sent = (await ctl({op:'lastCmds'})).cmds as {cmd:string}[];
  expect(sent.filter(c=>/^(jog_|spindle_)/.test(c.cmd))).toEqual([]);
}
const linear = (p: Page) => p.getByRole('slider',{name:'Linear jog speed',exact:true});
const rotary = (p: Page) => p.getByRole('slider',{name:'Rotary jog speed',exact:true});
test('a rotary edit is protected independently while untouched linear speed takes its default',async({page})=>{
  await open(page); await rotary(page).focus(); await page.keyboard.press('ArrowRight');
  await expect(rotary(page)).toHaveAttribute('aria-valuetext','606 °/min');
  await ini(page);
  await expect(rotary(page)).toHaveAttribute('aria-valuetext','606 °/min');
  await expect(linear(page)).toHaveAttribute('aria-valuetext','1200 mm/min');
  await noMotion();
});
test('both resets count as a choice even when resetting to the existing fallback',async({page})=>{
  await open(page);
  await page.getByRole('button',{name:'Reset linear jog speed to 600 mm/min',exact:true}).click();
  await page.getByRole('button',{name:'Reset rotary jog speed to 600 °/min',exact:true}).click();
  await ini(page);
  await expect(linear(page)).toHaveAttribute('aria-valuetext','600 mm/min');
  await expect(rotary(page)).toHaveAttribute('aria-valuetext','600 °/min');
  // A later explicit reset may choose the newly loaded INI default.
  await page.getByRole('button',{name:'Reset rotary jog speed to 1500 °/min',exact:true}).click();
  await expect(rotary(page)).toHaveAttribute('aria-valuetext','1500 °/min');
  await noMotion();
});
test('untouched defaults are adopted once for both jog types and RPM',async({page})=>{
  await open(page); await ini(page);
  await expect(linear(page)).toHaveAttribute('aria-valuetext','1200 mm/min');
  await expect(rotary(page)).toHaveAttribute('aria-valuetext','1500 °/min');
  await expect(page.locator('.spRpmInput')).toHaveValue('2400');
  await ini(page,4900,30);
  await expect(linear(page)).toHaveAttribute('aria-valuetext','1200 mm/min');
  await expect(rotary(page)).toHaveAttribute('aria-valuetext','1500 °/min');
  await noMotion();
});
test('a mirrored RPM equal to the old fallback is still written after Stop',async({page})=>{
  await open(page);
  await ctl({op:'status_delta',armed:false,data:{spindle_direction:1,spindle_speed:1000}});
  await expect(page.locator('.spNow')).toHaveText(/1000/);
  await expect(page.locator('.spRpmInput')).toHaveValue('1000');
  await ctl({op:'status_delta',armed:false,data:{spindle_direction:0,spindle_speed:0}});
  await expect(page.locator('.spNow')).toBeHidden();
  await ini(page);
  await expect(page.locator('.spRpmInput')).toHaveValue('1000');
  await noMotion();
});

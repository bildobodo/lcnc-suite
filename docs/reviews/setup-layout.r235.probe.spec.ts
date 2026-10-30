import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, setLayoutState, PROFILES, VIEWPORTS } from './layout-fixtures';

const S = '[data-strip="setup"]';
const out = '/tmp/codex-r235-720x5f32';
const records: unknown[] = [];
const sent = async () => ((await ctl({op:'lastCmds'})).cmds as any[]).filter(c => !['hello','arm','client_diag','tab_visibility','get_tool_table','heartbeat'].includes(c.cmd));

for (const portrait of [false, true]) for (const zoom of [1, 1.5]) {
  test(`TWP state changes: title, labels and coordinates ${portrait ? 'portrait' : 'landscape'} ${zoom}`, async ({page}) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(String(e)));
    const profile = PROFILES[2];
    await openLayout(page, profile, VIEWPORTS.find(v => v.name === (portrait ? 'touch-portrait' : 'touch-landscape'))!);
    await page.evaluate(z => document.documentElement.style.zoom = String(z), zoom);
    const geometry = () => page.locator(S).evaluate(el => {
      const sr = el.getBoundingClientRect();
      const box = (e: Element) => {const r=e.getBoundingClientRect(); return {x:r.x-sr.x,y:r.y-sr.y,w:r.width,h:r.height};};
      const setup = el.querySelector('.setupTitle')!;
      const wcs = el.querySelector('.wcsTitleInner')!;
      return {w:sr.width,h:sr.height,setup:box(setup),head:box(wcs),
        chip:el.querySelector('.kinsChip')?.textContent,
        fields:[...el.querySelectorAll<HTMLInputElement>('input.setupInput')].map(e=>({...box(e),value:e.value})),
        radios:[...el.querySelectorAll('[role=radio]')].map(e=>({text:e.textContent,...box(e)})),
        actions:[...el.querySelectorAll('.setupActions button')].map(e=>({text:(e as HTMLElement).innerText,...box(e)}))};
    });
    const start = await geometry();
    await ctl({op:'status_delta', data:{work_pos:[-999999.123, -777777.456, -888888.789, -359.99, -359.99, -359.99,0,0,0]}});
    await expect(page.locator(`${S} input.setupInput`).first()).toHaveValue('-999999.123');
    const long = await geometry();
    expect(long.fields.map(({value,...b})=>b)).toEqual(start.fields.map(({value,...b})=>b));
    expect(long.radios).toEqual(start.radios);
    for (const state of ['plane','plane-stale','homed'] as const) {
      await setLayoutState(page, profile, state);
      const g=await geometry();
      expect(g.fields.map(({value,...b})=>b)).toEqual(start.fields.map(({value,...b})=>b));
      expect(g.radios).toEqual(start.radios);
      expect(g.head.x).toBeGreaterThanOrEqual(-0.5);
      expect(g.head.x + g.head.w).toBeLessThanOrEqual(g.w + 0.5);
      if (!portrait) expect(g.head.x).toBeGreaterThanOrEqual(g.setup.x+g.setup.w+4*zoom);
      records.push({portrait,zoom,state,...g});
    }
    await ctl({op:'status_delta', data:{kins_type:0,g5x_index:1,wcs_prov_a:[0,0,0,0,0,0,0,0,0],rotary_abc:[20,0,0],twp_defined:true,twp_datum:[0,0,0]}});
    await expect(page.locator(`${S} .kinsChip`)).toContainText('off datum · datum moved');
    const g=await geometry();
    expect(g.radios).toEqual(start.radios);
    expect(g.head.x).toBeGreaterThanOrEqual(-0.5);
    if (!portrait) expect(g.head.x).toBeGreaterThanOrEqual(g.setup.x+g.setup.w+4*zoom);
    records.push({portrait,zoom,state:'long chip',...g});
    if (zoom===1) {
      await page.locator(`${S} .wcsTitle`).scrollIntoViewIfNeeded();
      await page.screenshot({path:`${out}/TWP-${portrait?'portrait':'landscape'}.png`});
    }
    expect(errors).toEqual([]);
  });
}

test('portrait WCS: one tab stop, complete rows, navigation never chooses, one explicit choice', async ({page}) => {
  await openLayout(page, PROFILES[0], VIEWPORTS.find(v=>v.name==='touch-portrait')!);
  const radios=page.locator(S).getByRole('radio');
  const names=['G54','G55','G56','G57','G58','G59','G59.1','G59.2','G59.3'];
  await ctl({op:'clearCmds'});
  const movements: unknown[]=[];
  for (let i=0;i<9;i++) for (const key of ['ArrowUp','ArrowDown']) {
    await radios.nth(i).focus();
    await page.keyboard.press(key);
    const target=key==='ArrowDown' ? (i+5<9?i+5:i) : (i>=5?i-5:i);
    await expect(radios.nth(target)).toBeFocused();
    await expect(page.locator(`${S} [role=radio][tabindex="0"]`)).toHaveCount(1);
    movements.push({from:names[i],key,to:names[target]});
  }
  expect(await sent()).toEqual([]);
  await page.locator(S).getByRole('radio',{name:'G59.3',exact:true}).focus();
  await page.keyboard.press('Enter');
  await expect.poll(async()=> (await sent()).length).toBe(1);
  expect(await sent()).toMatchObject([{cmd:'mdi',text:'G59.3'}]);
  records.push({WCSmovements:movements});
});

test('axis list changes with a keypad open: original target is cancelled', async ({page}) => {
  await openLayout(page, PROFILES[0], VIEWPORTS.find(v=>v.name==='touch-landscape')!);
  await page.locator(`${S} input.setupInput`).first().click();
  await expect(page.locator('.nkStrip')).toBeVisible();
  await ctl({op:'clearCmds'});
  await ctl({op:'setAxes',axes:['Z']});
  await expect(page.locator(`${S} input.setupInput`)).toHaveCount(1);
  await expect(page.locator('.nkStrip')).toHaveCount(0);
  expect(await sent()).toEqual([]);
});

test.afterAll(async()=>{writeFileSync(`${out}/probe.json`,JSON.stringify(records,null,2));await ctl({op:'reset'});});

import { test, expect, type Page } from './test';
import { ctl } from './ctl';
import { PROFILES, VIEWPORTS, openLayout } from './layout-fixtures';

const desktop = VIEWPORTS.find(v => v.name === 'desktop')!;
const method = (page: Page, name: string) => page.locator('.sidePane').getByRole('radio', { name, exact: true });
const toggle = (page: Page) => page.getByRole('checkbox', { name: 'Enable Compensation' });
const state = (page: Page) => page.locator('span', { hasText: /^Compensation:/ }).locator('b > span:not(.alt)');
const sent = async () => ((await ctl({ op: 'lastCmds' })).cmds as {cmd: string}[])
  .filter(c => ['set_compensation', 'set_compensation_method'].includes(c.cmd));

async function open(page: Page) {
  await openLayout(page, PROFILES[0]!, desktop);
  await page.locator('.sidePane').getByRole('tab', { name: 'Probing', exact: true }).click();
  await page.locator('.sidePane').getByRole('tab', { name: 'Surface', exact: true }).click();
  await ctl({ op: 'status_delta', data: { eoffset_enabled: false, comp_method: 1 } });
  await expect(state(page)).toHaveText('OFF');
  await expect(method(page, 'Linear')).toBeChecked();
  await ctl({ op: 'clearCmds' });
}

test('R277: failed and unclear method replies release pending, preserve the reported choice, and do not retry', async ({ page }) => {
  await open(page);
  for (const why of ['Compensation not sent — try again', 'Compensation unclear — check the display']) {
    await ctl({ op: 'replyFor', cmd: 'set_compensation_method', reply: { ok: false, error: why } });
    await ctl({ op: 'clearCmds' });
    await method(page, 'Cubic').click();
    await expect(page.locator('.btnHint')).toHaveText(why);
    await expect(method(page, 'Cubic')).not.toHaveAttribute('aria-busy', 'true');
    await expect(method(page, 'Cubic')).not.toBeChecked();
    await expect(method(page, 'Linear')).toBeChecked();
    await expect.poll(sent).toHaveLength(1);
  }
});

test('R277: method arrow navigation sends nothing; Enter sends once; selecting the confirmed choice sends nothing', async ({ page }) => {
  await open(page);
  await method(page, 'Linear').focus();
  await page.keyboard.press('ArrowRight');
  await expect(method(page, 'Cubic')).toBeFocused();
  await expect(method(page, 'Linear')).toBeChecked();
  expect(await sent()).toEqual([]);
  await page.keyboard.press('Enter');
  await expect.poll(sent).toEqual([expect.objectContaining({ cmd: 'set_compensation_method', method: 2 })]);
  await ctl({ op: 'status_delta', data: { comp_method: 2 } });
  await expect(method(page, 'Cubic')).toBeChecked();
  await ctl({ op: 'clearCmds' });
  await method(page, 'Cubic').click();
  expect(await sent()).toEqual([]);
});

test('R277: enable and disable wait for the status, rejection keeps the displayed state', async ({ page }) => {
  await open(page);
  await ctl({ op: 'replyFor', cmd: 'set_compensation', reply: { ok: false, error: 'Compensation unclear — check the display' } });
  await toggle(page).click();
  await expect(toggle(page)).not.toBeChecked();
  await page.getByRole('dialog').getByRole('button', { name: 'Enable', exact: true }).click();
  await expect.poll(sent).toEqual([expect.objectContaining({ cmd: 'set_compensation', enable: true })]);
  await expect(state(page)).toHaveText('OFF');
  await expect(toggle(page)).not.toBeChecked();
  await ctl({ op: 'status_delta', data: { eoffset_enabled: true } });
  await expect(toggle(page)).toBeChecked();
  await expect(state(page)).toHaveText('ON');
  await ctl({ op: 'clearCmds' });
  await toggle(page).click();
  await expect(toggle(page)).toBeChecked();
  await page.getByRole('dialog').getByRole('button', { name: 'Disable', exact: true }).click();
  await expect.poll(sent).toEqual([expect.objectContaining({ cmd: 'set_compensation', enable: false })]);
  await expect(state(page)).toHaveText('ON');
  await ctl({ op: 'status_delta', data: { eoffset_enabled: false } });
  await expect(state(page)).toHaveText('OFF');
  await expect(toggle(page)).not.toBeChecked();
});

test('R277: losing known pins removes both selected states; closed gates cannot send', async ({ page }) => {
  await open(page);
  await ctl({ op: 'status_delta', data: { eoffset_enabled: true, comp_method: 2 } });
  await expect(state(page)).toHaveText('ON');
  await expect(method(page, 'Cubic')).toBeChecked();
  await ctl({ op: 'status_delta', data: { eoffset_enabled: null, comp_method: null,
    permissions: { probe: false, surfaceComp: false, ready: true } } });
  await expect(state(page)).toHaveText('—');
  await expect(toggle(page)).not.toBeChecked();
  await expect(toggle(page)).toBeDisabled();
  for (const label of ['Nearest', 'Linear', 'Cubic']) {
    await expect(method(page, label)).not.toBeChecked();
    await expect(method(page, label)).toHaveAttribute('aria-disabled', 'true');
  }
  await method(page, 'Cubic').focus();
  await page.keyboard.press('Enter');
  expect(await sent()).toEqual([]);
});

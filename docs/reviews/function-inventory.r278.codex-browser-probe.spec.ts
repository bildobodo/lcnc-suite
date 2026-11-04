import { test, expect } from './test';
import { ctl } from './ctl';
import { PROFILES, VIEWPORTS, openLayout } from './layout-fixtures';

const desktop = VIEWPORTS.find(v => v.name === 'desktop')!;
async function commands() {
  return ((await ctl({ op: 'lastCmds' })).cmds as {cmd:string; [key:string]:unknown}[])
    .filter(c => ['set_optional_stop', 'set_block_delete', 'spindle_reverse'].includes(c.cmd))
    .map(({ req_id: _, ...c }) => c);
}

test('R278: M01 can turn OFF and block delete can turn ON from their reported states', async ({ page }) => {
  await openLayout(page, PROFILES[0]!, desktop);
  await ctl({ op: 'status_delta', data: { optional_stop: true, block_delete: false } });
  const trigger = page.locator('.sidePane').getByRole('button', { name: /^More program actions/ });
  await trigger.click();
  const panel = page.locator(`[id="${await trigger.getAttribute('aria-controls')}"]`);
  const m01 = panel.getByRole('checkbox', { name: 'M01', exact: true });
  const bd = panel.getByRole('checkbox', { name: '/BD', exact: true });
  await expect(m01).toBeChecked();
  await expect(bd).not.toBeChecked();
  await ctl({ op: 'clearCmds' });
  await m01.click();
  await expect.poll(commands).toEqual([{ cmd: 'set_optional_stop', value: false }]);
  await expect(m01).toBeChecked();
  await ctl({ op: 'clearCmds' });
  await bd.click();
  await expect.poll(commands).toEqual([{ cmd: 'set_block_delete', value: true }]);
  await expect(bd).not.toBeChecked();
  await ctl({ op: 'status_delta', data: { optional_stop: false, block_delete: true } });
  await expect(m01).not.toBeChecked();
  await expect(bd).toBeChecked();
});

test('R278: Reverse sends the edited RPM preselection rather than the initial default', async ({ page }) => {
  await openLayout(page, PROFILES[0]!, desktop);
  const sp = page.locator('[data-strip="spindle"]');
  const rpm = sp.locator('input.spRpmInput');
  await rpm.click();
  const keypad = page.locator('.nkStrip');
  for (const digit of '1700') await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(rpm).toHaveValue('1700');
  await ctl({ op: 'clearCmds' });
  const reverse = sp.getByRole('button', { name: 'Rev', exact: true });
  await expect(reverse).toBeEnabled();
  await reverse.scrollIntoViewIfNeeded();
  const box = (await reverse.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await expect.poll(commands).toEqual([{ cmd: 'spindle_reverse', speed: 1700 }]);
});

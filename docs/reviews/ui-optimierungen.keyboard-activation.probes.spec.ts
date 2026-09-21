// Review follow-up 2026-09-21, product HEAD 17ec849.
// Copy beside e2e/ctl.ts; use the regular built UI and localhost mock.
// npx playwright test audit-keyboard-activation.spec.ts --project=chromium --no-deps --workers=1 --repeat-each=3
import { test, expect, type Page } from '@playwright/test';
import { ctl, MOCK } from './ctl';

async function open(page: Page) {
  await ctl({ op: 'reset' });
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({ op: 'quiet', on: true });
  await ctl({ op: 'clearCmds' });
}
test.afterEach(async () => {
  await ctl({ op: 'quiet', on: false });
  await ctl({ op: 'reset' });
});

test('real Tab to numeric Cancel then Enter cancels without confirming the value', async ({ page }) => {
  await open(page);
  await page.locator('input.setupInput').first().click();
  const nk = page.locator('.nkStrip');
  await expect(nk).toBeFocused();
  await page.keyboard.type('17');
  const cancel = nk.getByRole('button', { name: 'Cancel', exact: true });
  let reached = false;
  for (let n = 0; n < 30; n++) {
    await page.keyboard.press('Tab');
    if (await cancel.evaluate(el => el === document.activeElement)) { reached = true; break; }
  }
  expect(reached, 'Cancel must be reached through real Tab navigation').toBe(true);
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(nk).toHaveCount(0);
  await page.waitForTimeout(100);
  const sent = (await ctl({ op: 'lastCmds' })).cmds ?? [];
  console.log('NUMERIC_CANCEL_ENTER', JSON.stringify({ focusedCancel: reached, commands: sent }));
  expect(sent.filter((c: { cmd: string }) => c.cmd === 'touchoff')).toEqual([]);
});

test('focused Close keyboard button responds to native Enter like its pointer action', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'MDI', exact: true }).click();
  await page.locator('.mdiInput').click();
  const tk = page.locator('.tkStrip');
  const close = tk.getByRole('button', { name: 'Close keyboard', exact: true });
  // Native focus, no injected state/handlers. Activation is a trusted key
  // event. Numeric Cancel above additionally exercises physical Tab order.
  await close.focus();
  await expect(close).toBeFocused();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(100);
  const countAfterEnter = await tk.count();
  await page.keyboard.press('Space');
  await page.waitForTimeout(100);
  const countAfterSpace = await tk.count();
  if (countAfterSpace) await close.click();
  await expect(tk).toHaveCount(0);
  console.log('TEXT_CLOSE_ACTIVATION', JSON.stringify({ countAfterEnter, countAfterSpace, closedByPointer: true }));
  expect(countAfterEnter, 'Enter should activate the focused Close button').toBe(0);
});

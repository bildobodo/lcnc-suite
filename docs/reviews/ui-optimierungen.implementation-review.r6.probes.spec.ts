// Independent follow-up, 7f50dd1 / product 570bd9f, 2026-09-22.
// Copy beside e2e/ctl.ts AFTER the regular suite; built frontend + local mock.
import { test, expect, type Page } from '@playwright/test';
import { ctl, MOCK } from './ctl';

async function open(page: Page) {
  await ctl({ op: 'reset' });
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({ op: 'quiet', on: true });
  await ctl({ op: 'raw', frame: { type: 'settings_init', settings: {} } });
  await ctl({ op: 'clearCmds' });
}
test.afterEach(async () => {
  await ctl({ op: 'quiet', on: false });
  await ctl({ op: 'reset' });
});

test('confirmed settings from a visibility flush must not stay Saving forever', async ({ page }) => {
  const beacons: any[] = [];
  await page.route('**/settings/keyboard*', async route => {
    beacons.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await open(page);
  await page.getByTitle('Settings', { exact: true }).click();
  const dialog = page.locator('.dialogOverlay').first();
  await dialog.getByRole('button', { name: 'Keyboard', exact: true }).click();
  const abort = dialog.locator('tr').filter({ hasText: 'Abort' }).locator('.kbKeyCell');
  const status = dialog.locator('.saveStatus');
  await abort.click();
  await page.keyboard.press('F9');
  await expect(status).toHaveText('Saving…');
  // Explicit lifecycle simulation: headless Chromium keeps tabs visible.
  // Only document visibility is simulated. The production listener, timers,
  // navigator.sendBeacon, HTTP request and WS cache update are unmodified.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Reflect.deleteProperty(document, 'visibilityState');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => beacons.length).toBe(1);
  expect(beacons[0].data.mapping.abort).toBe('F9');
  // The gateway publishes the full saved settings blob after the HTTP save.
  await ctl({ op: 'raw', frame: { type: 'settings_changed', settings: { keyboard: beacons[0].data } } });
  await page.waitForTimeout(650);
  const recorded = (await ctl({ op: 'lastCmds' })).cmds ?? [];
  const wsSaves = recorded.filter((c: any) => c.cmd === 'save_settings' && c.section === 'keyboard');
  const seen = { beacons, wsSaves, status: await status.innerText(), key: await abort.innerText() };
  console.log('VISIBILITY_FLUSH_STATUS', JSON.stringify(seen));
  expect(wsSaves).toHaveLength(0); // the lifecycle flush cancelled the debounce
  expect(seen.key).toBe('F9');
  expect(seen.status, 'no outstanding operation remains; server confirmed this current snapshot').toBe('Saved');
});

test.describe('help lifecycle', () => {
  test.use({ viewport: { width: 900, height: 1200 }, hasTouch: true });
  test('resize while open and reopen keep the help inside the viewport', async ({ page }, info) => {
    await open(page);
    await page.locator('header.hdr').tap({ position: { x: 10, y: 10 } });
    const help = page.getByRole('button', { name: 'Help: Go to positions', exact: true });
    await help.tap();
    const pop = page.locator('.helpPopover:popover-open');
    await expect(pop).toBeVisible();
    for (const [width, height] of [[900, 1200], [900, 700], [1280, 700], [900, 1200]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const g = await pop.evaluate(el => {
        const r = el.getBoundingClientRect();
        const id = el.id;
        const b = document.querySelector(`[popovertarget="${id}"]`)!.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
          triggerTop: b.top, triggerBottom: b.bottom, scrollable: el.scrollHeight > el.clientHeight + 1 };
      });
      console.log('RESIZED_HELP', JSON.stringify({ viewportWidth: width, viewportHeight: height, ...g }));
      expect.soft(g.x).toBeGreaterThanOrEqual(0);
      expect.soft(g.y).toBeGreaterThanOrEqual(0);
      expect.soft(g.right).toBeLessThanOrEqual(width + 0.5);
      expect.soft(g.bottom).toBeLessThanOrEqual(height + 0.5);
    }
    await help.tap();
    await expect(pop).toHaveCount(0);
    await help.tap();
    await expect(pop).toBeVisible();
    const g = await pop.boundingBox();
    expect(g!.y + g!.height).toBeLessThanOrEqual(1200);
    await page.screenshot({ path: info.outputPath('help-reopened.png') });
  });
});

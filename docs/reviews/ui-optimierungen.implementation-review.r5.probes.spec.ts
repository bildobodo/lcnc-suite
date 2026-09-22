// Independent review of WP-A–E, ac0f918, 2026-09-22.
// Copy beside e2e/ctl.ts AFTER the regular offline suite; built UI + local mock.
// npx playwright test audit-r5.probes.spec.ts --project=chromium --no-deps --workers=1 --reporter=list
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
async function saves() {
  return ((await ctl({ op: 'lastCmds' })).cmds ?? []).filter((c: any) => c.cmd === 'save_settings');
}
async function reply(req_id: string, ok: boolean, error?: string) {
  await ctl({ op: 'raw', frame: { type: 'reply', cmd: 'save_settings', req_id, ok, error } });
}
async function settings(page: Page) {
  await open(page);
  await page.getByTitle('Settings', { exact: true }).click();
  const dialog = page.locator('.dialogOverlay').first();
  await dialog.getByRole('button', { name: 'Keyboard', exact: true }).click();
  return { dialog, status: dialog.locator('.saveStatus'),
    abort: dialog.locator('tr').filter({ hasText: 'Abort' }).locator('.kbKeyCell') };
}
test.afterEach(async () => {
  await ctl({ op: 'quiet', on: false });
  await ctl({ op: 'reset' });
});

test('a successful unrelated save must not erase a failed keyboard save', async ({ page }) => {
  const { dialog, status, abort } = await settings(page);
  await abort.click();
  await page.keyboard.press('F9');
  await expect.poll(async () => (await saves()).find((c: any) => c.section === 'keyboard')?.req_id).toBeTruthy();
  const keyboard = (await saves()).find((c: any) => c.section === 'keyboard');
  await dialog.getByRole('button', { name: 'Display', exact: true }).click();
  await dialog.getByLabel('Start in fullscreen mode', { exact: true }).check();
  await expect.poll(async () => (await saves()).find((c: any) => c.section === 'display')?.req_id).toBeTruthy();
  const display = (await saves()).find((c: any) => c.section === 'display');
  await reply(keyboard.req_id, false, 'keyboard save rejected');
  await expect(status).toContainText('keyboard save rejected');
  await reply(display.req_id, true);
  await page.waitForTimeout(100);
  console.log('MIXED_SAVE_REPLIES', JSON.stringify({ keyboard, display, text: await status.innerText() }));
  await expect(status, 'the failed keyboard changes remain unsaved').toContainText('keyboard save rejected');
});

test('an old reply must not claim Saved while the next keyboard change is still debouncing', async ({ page }) => {
  const { status, abort } = await settings(page);
  await abort.click();
  await page.keyboard.press('F9');
  await expect.poll(async () => (await saves()).find((c: any) => c.section === 'keyboard')?.req_id).toBeTruthy();
  const first = (await saves()).find((c: any) => c.section === 'keyboard');
  await abort.click();
  await page.keyboard.press('F10');
  await expect(status).toHaveText('Saving…');
  const start = Date.now();
  await reply(first.req_id, true);
  await page.waitForTimeout(40);
  const snapshot = { elapsedMs: Date.now() - start, text: await status.innerText(),
    requests: (await saves()).filter((c: any) => c.section === 'keyboard'), key: await abort.innerText() };
  console.log('PENDING_SAVE_OLD_REPLY', JSON.stringify(snapshot));
  // Pin the pre-flush window, so waiting assertions cannot pass only after
  // the 300 ms timer has overwritten a false "Saved" with "Saving…" again.
  expect(snapshot.requests).toHaveLength(1);
  expect(snapshot.key).toBe('F10');
  expect(snapshot.text).toBe('Saving…');
});

for (const [width, height, zoom] of [[1280, 900, 1], [900, 1200, 1], [900, 1200, 1.5]]) {
  test.describe(`help ${width}x${height} zoom ${zoom}`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });
    test('the new Go to positions popover stays wholly readable on its first opening', async ({ page }, info) => {
      await open(page);
      await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
      await page.locator('header.hdr').tap({ position: { x: 10, y: 10 } });
      const help = page.getByRole('button', { name: 'Help: Go to positions', exact: true });
      await help.evaluate(el => {
        const p = document.getElementById(el.getAttribute('popovertarget')!)!;
        p.addEventListener('beforetoggle', () => {
          (window as any).auditBeforeToggle = { width: p.offsetWidth, height: p.offsetHeight,
            display: getComputedStyle(p).display };
        }, { once: true });
      });
      await help.tap();
      const pop = page.locator('.helpPopover:popover-open');
      await expect(pop).toBeVisible();
      const geometry = await pop.evaluate(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom,
          viewportWidth: innerWidth, viewportHeight: innerHeight,
          text: el.textContent, inline: (el as HTMLElement).style.cssText,
          beforeToggle: (window as any).auditBeforeToggle };
      });
      console.log('HELP_POPOVER_GEOMETRY', JSON.stringify({ zoom, ...geometry }));
      const screenshot = info.outputPath('help.png');
      await page.screenshot({ path: screenshot });
      await info.attach('help', { path: screenshot, contentType: 'image/png' });
      expect.soft(geometry.x).toBeGreaterThanOrEqual(0);
      expect.soft(geometry.y).toBeGreaterThanOrEqual(0);
      expect.soft(geometry.right).toBeLessThanOrEqual(width);
      expect.soft(geometry.bottom).toBeLessThanOrEqual(height);
    });
  });
}

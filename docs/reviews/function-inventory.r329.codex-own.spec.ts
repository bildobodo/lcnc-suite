import { test, expect } from './test';
import { ctl, MOCK } from './ctl';
import { toolsetterSetup, toolsetterVarMap } from '../src/toolsetterSetup';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SET_UP = { touchX: 0, touchY: 0, touchZ: -300, fastFeed: 200, slowFeed: 0,
  traverseFeed: 500, maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180 };

for (const form of [
  { name: 'portrait', width: 900, height: 1200, zoom: 1 },
  { name: 'portrait150', width: 900, height: 1200, zoom: 1.5 },
  { name: 'landscape', width: 1280, height: 800, zoom: 1 },
]) test(`R329 own: toolsetter help remains reachable ${form.name}`, async ({ page }) => {
  await page.setViewportSize(form);
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  if (form.zoom !== 1) await page.evaluate(z => document.documentElement.style.zoom = String(z), form.zoom);
  await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { toolsetter: SET_UP } } });
  if (await page.getByRole('combobox', { name: 'Side panel', exact: true }).isVisible())
    await page.getByRole('combobox', { name: 'Side panel', exact: true }).selectOption({ label: 'Probing' });
  else await page.getByRole('tab', { name: 'Probing', exact: true }).click();
  if (await page.getByRole('combobox', { name: 'Probing procedure', exact: true }).isVisible())
    await page.getByRole('combobox', { name: 'Probing procedure', exact: true }).selectOption({ label: 'Toolsetter' });
  else await page.getByRole('tab', { name: 'Toolsetter', exact: true }).click();
  const help = page.getByRole('button', { name: 'Help: LinuxCNC parameters', exact: true });
  await expect(help).toBeVisible();
  const setup = toolsetterSetup(SET_UP);
  if (!setup.ok) throw Error('bad own setup');
  const measurements = [];
  for (const origin of ['applied', 'read', 'assumed']) {
    const keys = Object.fromEntries(Object.entries(toolsetterVarMap(setup.values))
      .map(([k, v]) => [k, { value: origin === 'read' && k === '3102' ? -299 : v, origin }]));
    await ctl({ op: 'status_delta', data: {}, envelope: { toolsetter_booking: { version: 1, keys } } });
    await expect(page.locator('.tsMachine [role=status]')).toContainText(
      origin === 'applied' ? 'hold these values' : origin === 'read' ? 'Saved — not yet' : 'not confirmed');
    await help.scrollIntoViewIfNeeded();
    const g = await help.evaluate(el => {
      const h = el.getBoundingClientRect(), c = el.closest('.tsMachine')!.getBoundingClientRect();
      return { help: { x: h.x, y: h.y, right: h.right, bottom: h.bottom },
        card: { x: c.x, y: c.y, right: c.right, bottom: c.bottom },
        text: el.closest('.tsMachine')!.querySelector('[role=status]')!.textContent };
    });
    expect(g.help.x).toBeGreaterThanOrEqual(g.card.x);
    expect(g.help.right).toBeLessThanOrEqual(g.card.right);
    expect(g.help.bottom).toBeLessThanOrEqual(g.card.bottom);
    measurements.push({ origin, ...g });
  }
  await help.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.helpPopover:popover-open')).toContainText('#3100–#3115');
  await expect(help).toHaveAttribute('aria-expanded', 'true');
  // Escape is reserved for E-Stop by the existing operator contract.
  await page.keyboard.press('Enter');
  await expect(page.locator('.helpPopover:popover-open')).toHaveCount(0);
  await expect(help).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.tsMachine').screenshot({ path: `/tmp/r329-evidence/${form.name}.png` });
  writeFileSync(`/tmp/r329-evidence/${form.name}.json`, JSON.stringify(measurements, null, 2));
});

for (const scheme of ['light', 'dark'] as const)
test(`R329 own: forced colours keep question glyph and keyboard help (${scheme})`, async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', colorScheme: scheme, reducedMotion: 'reduce' });
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const help = page.locator('.helpIcon:visible').first();
  await help.scrollIntoViewIfNeeded();
  const drawn = await help.screenshot({ path: `/tmp/r329-evidence/forced-${scheme}.png`, animations: 'disabled' });
  const css = await help.evaluate(el => {
    const s = getComputedStyle(el, '::after');
    return { mask: s.maskImage, ink: s.backgroundColor, adjust: s.forcedColorAdjust };
  });
  expect(css.mask).toContain('data:image/svg+xml');
  expect(css.adjust).toBe('none');
  const tag = await page.addStyleTag({ content: '.helpIcon::after { visibility: hidden !important; }' });
  const hidden = await help.screenshot({ animations: 'disabled' });
  expect(drawn.equals(hidden), 'the glyph actually adds pixels in forced colors').toBe(false);
  await tag.evaluate(el => el.remove());
  await help.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.helpPopover:popover-open')).toHaveCount(1);
  writeFileSync(`/tmp/r329-evidence/forced-${scheme}.json`, JSON.stringify(css, null, 2));
});

test('R329 plan: the exact index alone does not prove the installed app boots', async ({ page }) => {
  const original = await page.request.get(MOCK);
  const body = await original.body();
  let blocked = 0;
  await page.route('**/static/*.js', route => { blocked++; return route.fulfill({ status: 404, body: 'missing' }); });
  const response = await page.goto(MOCK);
  expect(response!.status()).toBe(200);
  expect(await response!.body()).toEqual(body);
  expect(blocked).toBeGreaterThan(0);
  await expect(page.locator('input.setupInput')).toHaveCount(0);
  writeFileSync('/tmp/r329-evidence/index-alone.json', JSON.stringify({
    status: response!.status(), sha256: createHash('sha256').update(body).digest('hex'),
    sameIndex: true, blockedEntryScripts: blocked, appRendered: false,
  }, null, 2));
});

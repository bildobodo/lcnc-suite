import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';

test('R80: the exact power-button name distinguishes both states while the old text does not', async ({ page }) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === 'desktop')!);
  const strip = page.locator('.safetyStrip');
  const samples = [];
  for (const on of [true, false, true]) {
    await ctl({ op: 'status_delta', data: { is_enabled: on, enabled: on } });
    const expectedName = on ? 'Power off' : 'Power on';
    const wrongName = on ? 'Power on' : 'Power off';
    await expect(strip.getByRole('button', { name: expectedName, exact: true })).toBeVisible();
    await expect(page.locator('.statusBanner')).toContainText(on ? 'IDLE' : 'MACHINE OFF');
    await expect(strip.getByRole('button', { name: wrongName, exact: true })).toHaveCount(0);
    const text = await strip.textContent() ?? '';
    const sample = {
      on, banner: await page.locator('.statusBanner').innerText(), expectedName,
      expectedCount: await strip.getByRole('button', { name: expectedName, exact: true }).count(),
      wrongCount: await strip.getByRole('button', { name: wrongName, exact: true }).count(),
      oldOnPredicate: /power off/i.test(text), oldOffPredicate: /power on/i.test(text),
    };
    samples.push(sample);
    expect(sample.oldOnPredicate).toBe(true);
    expect(sample.oldOffPredicate).toBe(true);
  }
  writeFileSync(`../evidence/viewer-palette-fest.r80.${process.env.R80_BROWSER ?? 'chromium'}-states.json`, JSON.stringify(samples, null, 2) + '\n');
});

test.afterEach(async () => { await ctl({ op: 'reset' }); });

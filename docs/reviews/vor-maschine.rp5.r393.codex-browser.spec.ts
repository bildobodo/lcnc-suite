import type { Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { test, expect } from './test';
import { MOCK } from './ctl';
import { replayFile } from './mockFixture';

const neutral = `${MOCK}__e2e/target`;

test('R393 reused handler can be unregistered from its first URL', async ({ page }) => {
  await page.goto(neutral);
  const handler = (route: Route) => route.fulfill({ body: 'registered-handler' });
  await page.route('**/__codex/a', handler);
  await page.route('**/__codex/b', handler);
  await page.unroute('**/__codex/a', handler);
  const answer = await page.evaluate(() => fetch('/__codex/a').then(r => r.text()));
  expect(answer, 'unroute must remove the first registration even when its function was registered again').not.toBe('registered-handler');
});

test('R393 a fetch of the SPA fallback remains a fallback contact', async ({ page }) => {
  await page.goto(neutral);
  await page.route('**/g30', async route => {
    const response = await route.fetch();
    expect(response.headers()['content-type']).toContain('text/html');
    await route.fulfill({ response, json: { value: 'invented by the spec' } });
  });
  expect(await page.evaluate(() => fetch('/g30').then(r => r.json()))).toEqual({ value: 'invented by the spec' });
});

test('R393 a URL override does not serve the original gateway route', async ({ page }) => {
  await page.goto(neutral);
  await page.route('**/g30', route => route.continue({ url: `${MOCK}devices` }));
  const answer = await page.evaluate(() => fetch('/g30').then(r => r.json()));
  expect(answer).toHaveProperty('devices');
});

test('R393 an encoded slash in a path parameter does not leak its value', async ({ page, mock }) => {
  const invented = 'codex-r393-invented-path-value';
  await page.goto(neutral);
  await page.evaluate(t => fetch(`/settings/${t}%2Ftail`).then(r => r.text()), invented);
  const replay = replayFile(mock.instance)!;
  expect(readFileSync(replay, 'utf8')).not.toContain(invented);
});

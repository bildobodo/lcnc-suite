import { test, expect } from './test';
import { MOCK } from './ctl';

test('R394 query-only rewrite changes the projected upload variant', async ({page}) => {
  await page.goto(`${MOCK}__e2e/target`);
  await page.route('**/upload?*', r => r.continue({url: `${MOCK}upload?overwrite=0`}));
  expect(await page.evaluate(() => fetch('/upload?overwrite=1', {method: 'POST', body: 'invented'}).then(r => r.status))).toBe(200);
});

test('R394 query-only fetch rewrite changes the projected macro variant', async ({page}) => {
  await page.goto(`${MOCK}__e2e/target`);
  await page.route('**/macro?*', async r => {
    const response = await r.fetch({url: `${MOCK}macro?base=revision&rename_from=invented&rename_base=revision`});
    await r.fulfill({response});
  });
  expect(await page.evaluate(() => fetch('/macro?base=new', {method: 'PUT', body: 'invented'}).then(r => r.status))).toBe(200);
});

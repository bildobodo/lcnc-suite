import { readFileSync } from 'node:fs';
import { test, expect } from './test';
import { MOCK } from './ctl';
import { httpRecordFile } from './httpRecord';
import { replayFile } from './mockFixture';

test('R395 fallback rewrite remains visible when both parameter values mask to the same template', async ({page,mock}) => {
  const from='codex-r395-invented-from';
  const to='codex-r395-invented-to';
  await page.goto(`${MOCK}__e2e/target`);
  await page.route(`**/settings/${from}`, route => route.fallback({url:`${MOCK}settings/${to}`}));
  expect(await page.evaluate(u=>fetch(u).then(async r=>{await r.text();return r.status;}),`/settings/${from}`)).toBe(200);
  await expect.poll(()=>readFileSync(replayFile(mock.instance)!, 'utf8').includes('/settings/{section}')).toBe(true);
  for(const file of [httpRecordFile()!,replayFile(mock.instance)!]) {
    const raw=readFileSync(file,'utf8');
    expect(raw).not.toContain(from);
    expect(raw).not.toContain(to);
  }
});

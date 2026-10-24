import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { decode, encode } from '@msgpack/msgpack';
import { ctl } from './ctl';
import { prepare, basis, activity, holdLog, reparseLog, checkZ, waitChecked, setZ, parse, publish,
  waitHold, pastCheckDebounce, payload } from './r198-codex-support';

const save = (name: string, value: unknown) => writeFileSync(`/tmp/codex-r198-7siq0rmu/${name}.json`, JSON.stringify(value, null, 2));

test('Codex: a pre-existing debounce is held at firing, then adoption schedules exactly once', async ({page,context}) => {
  await prepare(page,context); await waitChecked(page);
  const s=(await activity(page)).starts;
  await setZ(page,-10);
  expect((await activity(page)).starts, 'the timer has not fired before the parse').toBe(s);
  await parse(1); await waitHold(page,'parsing'); await pastCheckDebounce(page);
  expect((await activity(page)).starts).toBe(s);
  expect((await basis(page)).checkHeld).toBe(true);
  await parse(null); await publish(101); await waitHold(page,'free');
  await expect.poll(async()=>(await activity(page)).starts).toBe(s+1);
  await waitChecked(page); await page.waitForTimeout(1000);
  save('pending-timer',{before:s,after:await activity(page),basis:await basis(page),log:await reparseLog(page),z:await checkZ(page)});
  expect((await activity(page)).starts).toBe(s+1); expect(await checkZ(page)).toBe(-10);
});

test('Codex: a failed decode ends the collision hold with exactly one retry of the shown version', async ({page,context}) => {
  await prepare(page,context,{bad:[101]}); await waitChecked(page);
  const s=(await activity(page)).starts;
  await parse(1); await waitHold(page,'parsing'); await setZ(page,-20); await pastCheckDebounce(page);
  expect((await basis(page)).checkHeld).toBe(true);
  await parse(null); await publish(101);
  await waitHold(page,'free');
  await expect.poll(async()=>(await activity(page)).starts,{timeout:4000}).toBe(s+1);
  await waitChecked(page); await page.waitForTimeout(1000);
  save('decode-failure',{before:s,after:await activity(page),basis:await basis(page),log:await reparseLog(page),z:await checkZ(page)});
  expect((await activity(page)).starts).toBe(s+1); expect(await checkZ(page)).toBe(-20);
});

test('Codex: changing the program discards the old check note and its old gap deadline', async ({page,context}) => {
  await prepare(page,context); await waitChecked(page);
  const s=(await activity(page)).starts;
  await parse(1); await waitHold(page,'parsing'); await setZ(page,-10); await pastCheckDebounce(page);
  expect((await basis(page)).checkHeld).toBe(true);
  await parse(null); await waitHold(page,'after_parse');
  const file='/nc/second.ngc';
  const body={...(decode(payload()) as object), file};
  await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode(body))}));
  await ctl({op:'status_delta',data:{active_file:file}});
  await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:102,file}});
  await expect.poll(async()=>(await basis(page)).drawn).toContain(file);
  await waitHold(page,'free');
  await expect.poll(async()=>(await activity(page)).starts).toBe(s+1);
  await waitChecked(page); await page.waitForTimeout(7000);
  save('program-change',{before:s,after:await activity(page),basis:await basis(page),log:await reparseLog(page)});
  expect((await activity(page)).starts).toBe(s+1);
  expect((await basis(page)).checkHeld).toBe(false);
});

test('Codex: entering simulation releases a pending check and checks on the live offsets', async ({page,context}) => {
  await prepare(page,context); await waitChecked(page);
  const s=(await activity(page)).starts;
  await parse(1); await waitHold(page,'parsing'); await setZ(page,-10); await pastCheckDebounce(page);
  expect((await basis(page)).checkHeld).toBe(true);
  await page.locator('.scrubBar input.toggle').check();
  await expect(page.locator('.simBanner')).toBeVisible(); await waitHold(page,'free');
  await expect.poll(async()=>(await activity(page)).starts,{timeout:5000}).toBe(s+1);
  await waitChecked(page); await page.waitForTimeout(1000);
  save('sim-entry',{before:s,after:await activity(page),basis:await basis(page),log:await reparseLog(page),z:await checkZ(page)});
  expect((await activity(page)).starts).toBe(s+1); expect(await checkZ(page)).toBe(-10);
});


test('Codex: Sim releases reparse but preserves a pending decode until its response arrives', async ({page,context}) => {
  await prepare(page,context); await waitChecked(page);
  let release!: () => void;
  const response = new Promise<void>(r => { release = r; });
  await context.route(/\/preview(\?|$)/, async r => {
    await response;
    await r.fulfill({contentType:'application/octet-stream',body:payload()});
  });
  const s=(await activity(page)).starts;
  await parse(1); await waitHold(page,'parsing'); await setZ(page,-10); await pastCheckDebounce(page);
  await parse(null); await publish(101); await waitHold(page,'loading');
  await page.locator('.scrubBar input.toggle').check();
  await expect(page.locator('.simBanner')).toBeVisible(); await waitHold(page,'free');
  await expect.poll(async()=>(await activity(page)).starts).toBe(s+1);
  await page.waitForTimeout(1500);
  const paused={activity:await activity(page),basis:await basis(page),log:await holdLog(page)};
  expect(paused.activity.busy).toBe(true);
  expect(paused.log.filter(l=>l.startsWith('decode')).at(-1)).toBe('decode on');
  release();
  await waitChecked(page); await page.waitForTimeout(1000);
  save('sim-decode',{before:s,paused,after:await activity(page),basis:await basis(page),log:await holdLog(page),z:await checkZ(page)});
  expect((await basis(page)).drawn).toContain('101');
  expect(await checkZ(page)).toBe(-10);
});

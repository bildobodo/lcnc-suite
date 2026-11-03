import { test, expect, type Page } from '@playwright/test';
import { ctl } from './ctl';
import { PROFILES, VIEWPORTS, openLayout } from './layout-fixtures';
import { PROBE_FALLBACK, calibrationVarMap, probeVarMap } from '../src/probeVars';

// A probe button sends its routine with the panel's values (test strategy
// step 2, Codex R251): no spec ever pressed one — every probe on every
// example was refused by the gateway (the var file declared none of the
// numbers) and no test saw it. Per send form (the grid, Boss/Pocket,
// Ridge/Valley, Angle, Calibrate), the first cell held: ONE `mdi` with
// `O<probe_…> CALL` and exactly the numbers its map names, every value
// finite. Calibrate adds its axis (#3036, calibrationVarMap) — the spec's
// first run found it sent beside the map and declared in no var file, so
// every calibration was refused. The replay (step 5) then holds the numbers
// against every example var file.

type Sent = { cmd?: string; text?: string; vars?: Record<string, number> };
const sent = async (): Promise<Sent[]> => ((await ctl({ op: 'lastCmds' })) as { cmds?: Sent[] }).cmds ?? [];

/** Press a hold button long enough to fire (HOLD_FIRE_MS 500). */
async function hold(page: Page, target: ReturnType<Page['locator']>) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}

const MAP = Object.keys(probeVarMap(PROBE_FALLBACK, 1)).sort();
const CAL = Object.keys(calibrationVarMap(PROBE_FALLBACK, 1, 0)).sort();
const FORMS: { sub: string; call: RegExp; numbers: string[] }[] = [
  { sub: 'Outside', call: /^O<probe_[a-z_]+> CALL$/, numbers: MAP },
  { sub: 'Boss/Pocket', call: /^O<probe_[a-z_]+> CALL$/, numbers: MAP },
  { sub: 'Ridge/Valley', call: /^O<probe_[a-z_]+> CALL$/, numbers: MAP },
  { sub: 'Angle', call: /^O<probe_[a-z_]+> CALL$/, numbers: MAP },
  { sub: 'Calibrate', call: /^O<probe_cal_[a-z_]+> CALL$/, numbers: CAL },
];

for (const form of FORMS) {
  test(`${form.sub}: a held probe button sends its routine with the panel's numbers`, async ({ page }) => {
    await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === 'desktop')!);
    const side = page.locator('.sidePane');
    await side.getByRole('tab', { name: 'Probing', exact: true }).click();
    await side.getByRole('tab', { name: form.sub, exact: true }).click();
    const cell = side.getByRole('tabpanel').locator('.gridCell').first();
    await expect(cell).toBeVisible();
    await expect(cell).toBeEnabled();
    await ctl({ op: 'clearCmds' });
    await hold(page, cell);
    await expect.poll(async () => (await sent()).filter(c => c.cmd === 'mdi').length, { message: 'one mdi' }).toBe(1);
    const mdi = (await sent()).find(c => c.cmd === 'mdi')!;
    expect(mdi.text, `${form.sub}: the routine's call`).toMatch(form.call);
    expect(Object.keys(mdi.vars ?? {}).sort(), `${form.sub}: exactly the numbers its map names`).toEqual(form.numbers);
    expect(Object.entries(mdi.vars!).filter(([, v]) => !Number.isFinite(v)), `${form.sub}: every value finite`).toEqual([]);
    expect([0, 1], `${form.sub}: #3030 is a mode`).toContain(mdi.vars!['3030']);
  });
}

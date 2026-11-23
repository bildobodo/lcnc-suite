import { test, expect, type Page } from "./test";
import { ctl } from './ctl';
import { holdMouse, installHoldClock } from './holdClock';
import { PROFILES, VIEWPORTS, openLayout } from './layout-fixtures';
import { readFileSync } from 'node:fs';
import { PROBE_FALLBACK, calibrationVarMap, probeVarMap, surfaceVarMap } from '../src/probeVars';
import type { ProbeDefaults } from '../src/defaults';

// A probe button sends its routine with the panel's values (test strategy
// step 2, Codex R251): no spec ever pressed one — every probe on every
// example was refused by the gateway (the var file declared none of the
// numbers) and no test saw it. Per send form (the grid, Boss/Pocket,
// Ridge/Valley, Angle, Calibrate), the first cell held: ONE `probe_run` job
// naming its `probe_…` routine with exactly the numbers its map names, every
// value finite (settings split package 3: the gateway builds the line, the
// numbers are the `probe` purpose's). Calibrate adds its axis (#3036, calibrationVarMap) — the spec's
// first run found it sent beside the map and declared in no var file, so
// every calibration was refused. The replay (step 5) then holds the numbers
// against every example var file.

type Sent = { cmd?: string; text?: string; routine?: string; vars?: Record<string, number> };
const sent = async (): Promise<Sent[]> => ((await ctl({ op: 'lastCmds' })) as { cmds?: Sent[] }).cmds ?? [];

/** Press a hold button long enough to fire (HOLD_FIRE_MS 500). */
async function hold(page: Page, target: ReturnType<Page['locator']>) {
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeVisible();   // read the geometry after the signal: shown
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await holdMouse(page, 700);   // on the page's clock (holdClock.ts): a stalled runner cannot end it
}

// every test here holds a probe button: the page's clock from the start
test.beforeEach(async ({ page }) => { await installHoldClock(page); });

const MAP = Object.keys(probeVarMap(PROBE_FALLBACK, 1)).sort();
const CAL = Object.keys(calibrationVarMap(PROBE_FALLBACK, 1, 0)).sort();
const SCAN = Object.keys(surfaceVarMap(PROBE_FALLBACK)).sort();
const FORMS: { sub: string; call: RegExp; numbers: string[] }[] = [
  { sub: 'Outside', call: /^probe_[a-z_]+$/, numbers: MAP },
  { sub: 'Boss/Pocket', call: /^probe_[a-z_]+$/, numbers: MAP },
  { sub: 'Ridge/Valley', call: /^probe_[a-z_]+$/, numbers: MAP },
  { sub: 'Angle', call: /^probe_[a-z_]+$/, numbers: MAP },
  { sub: 'Calibrate', call: /^probe_cal_[a-z_]+$/, numbers: CAL },
];

for (const form of FORMS) {
  test(`${form.sub}: a held probe button sends its routine with the panel's numbers`, async ({ page }) => {
    await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === 'desktop')!);
    const side = page.locator('.sidePane');
    await side.getByRole('tab', { name: 'Probing', exact: true }).click();
    await side.getByRole('tab', { name: form.sub, exact: true }).click();
    // Boss/Pocket: the first cell a default panel may run — the Round Boss
    // needs its diameter (P4-5), the Round Pocket runs at 0
    const cell = form.sub === 'Boss/Pocket'
      ? side.getByRole('tabpanel').getByRole('button', { name: /^Probe inside of round hole \(edge start\)/ })
      : side.getByRole('tabpanel').locator('.gridCell').first();
    await expect(cell).toBeVisible();
    await expect(cell).toBeEnabled();
    await ctl({ op: 'clearCmds' });
    await hold(page, cell);
    await expect.poll(async () => (await sent()).filter(c => c.cmd === 'probe_run').length, { message: 'one probe_run' }).toBe(1);
    const job = (await sent()).find(c => c.cmd === 'probe_run')!;
    expect(job.routine, `${form.sub}: the routine`).toMatch(form.call);
    expect(Object.keys(job.vars ?? {}).sort(), `${form.sub}: exactly the numbers its map names`).toEqual(form.numbers);
    expect(Object.entries(job.vars!).filter(([, v]) => !Number.isFinite(v)), `${form.sub}: every value finite`).toEqual([]);
    expect([0, 1], `${form.sub}: #3030 is a mode`).toContain(job.vars!['3030']);
    expect((await sent()).filter(c => c.cmd === 'mdi'), `${form.sub}: no client-built line`).toEqual([]);
  });
}

test("Surface: a held Start Scan sends the surface_scan_run job with the panel's numbers", async ({ page }) => {
  // The function inventory's F-SURFACE S1: the scan's values are the panel's
  // — one the server holds (X Probes 7) arrives as #3054, not the default 5.
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === 'desktop')!);
  await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { probe: { scanXProbes: 7 } } } });
  const side = page.locator('.sidePane');
  await side.getByRole('tab', { name: 'Probing', exact: true }).click();
  await side.getByRole('tab', { name: 'Surface', exact: true }).click();
  await expect(side.getByLabel('X Probes', { exact: true })).toHaveValue('7');
  await ctl({ op: 'clearCmds' });
  await hold(page, side.getByRole('button', { name: 'Start Scan', exact: true }));
  await expect.poll(async () => (await sent()).filter(c => c.cmd === 'surface_scan_run').length, { message: 'one scan job' }).toBe(1);
  const job = (await sent()).find(c => c.cmd === 'surface_scan_run')!;
  // exactly what surface_scan.ngc reads (the `surface` purpose): the grid
  // #3050–#3059, the probe tool #3014, the retract #3021
  expect(Object.keys(job.vars ?? {}).sort(), 'exactly the surface purpose').toEqual(SCAN);
  expect(SCAN).toEqual([...Array.from({ length: 10 }, (_, i) => String(3050 + i)), '3014', '3021'].sort());
  expect(job.vars!['3054'], 'X Probes from the panel').toBe(7);
  expect(Object.entries(job.vars!).filter(([, v]) => !Number.isFinite(v)), 'every value finite').toEqual([]);
});

// The native stage's two jobs (plan R380–R381, Codex VM380-01): with the
// panel state the fixture names, the button sends EXACTLY the fixture's job —
// every value, not only the numbers and the mode's range. The native stage
// runs the same job on the real task, so the page and the stage cannot part:
// a send site that rewrote #3030 to 1 (measure only) would still pass the
// numbers check above and the map guard, and this comparison refuses it.
type PanelJob = { view: string; button: string; panel: ProbeDefaults;
                  job: { cmd: string; routine?: string; vars: Record<string, number> } };
const PANEL_JOBS = JSON.parse(readFileSync(new URL("../../scripts/test_fixtures/probe_panel_jobs.json", import.meta.url),
                                           "utf8")) as Record<string, PanelJob>;

for (const key of ["z_surface", "surface_scan"]) {
  test(`${key}: the job the button sends is the native stage's whole job`, async ({ page }) => {
    const e = PANEL_JOBS[key]!;
    await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === 'desktop')!);
    await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { probe: e.panel } } });
    const side = page.locator('.sidePane');
    await side.getByRole('tab', { name: 'Probing', exact: true }).click();
    await side.getByRole('tab', { name: e.view, exact: true }).click();
    // the panel shows the fixture's state before the press
    if (e.job.cmd === 'probe_run') {
      const az = side.getByRole('checkbox', { name: 'Auto Zero', exact: true });
      await (e.panel.autoZero ? expect(az).toBeChecked() : expect(az).not.toBeChecked());
    } else {
      await expect(side.getByLabel('X Probes', { exact: true })).toHaveValue(String(e.panel.scanXProbes));
    }
    await ctl({ op: 'clearCmds' });
    await hold(page, side.getByRole('button', { name: e.button, exact: true }));
    await expect.poll(async () => (await sent()).filter(c => c.cmd === e.job.cmd).length, { message: `one ${e.job.cmd}` }).toBe(1);
    const job = (await sent()).find(c => c.cmd === e.job.cmd)!;
    expect({ cmd: job.cmd, routine: job.routine, vars: job.vars }, `${key}: the whole job`).toEqual(
      { cmd: e.job.cmd, routine: e.job.routine, vars: e.job.vars });
    expect((await sent()).filter(c => c.cmd === 'mdi'), `${key}: no client-built line`).toEqual([]);
  });
}

// The calibration cells say where their routine starts (machine day F28,
// P4-4, Codex R433): the boss routines start ABOVE THE CENTRE (they touch Z
// there, then step out by half the gauge plus Step Off) — the right cell sat
// under "Round Hole" and was titled "outside start". Each cell's name and
// caption against the routine it sends.
const CAL_CELLS: { name: string; caption: string; routine: string }[] = [
  { name: 'Round hole — edge start', caption: 'edge start', routine: 'probe_cal_round_pocket' },
  { name: 'Round boss — above centre', caption: 'above centre', routine: 'probe_cal_round_boss' },
  { name: 'Rect pocket — edge start', caption: 'edge start', routine: 'probe_cal_square_pocket' },
  { name: 'Rect boss — above centre', caption: 'above centre', routine: 'probe_cal_square_boss' },
];

for (const c of CAL_CELLS) {
  test(`Calibrate: "${c.name}" is named for its start and sends ${c.routine}`, async ({ page }) => {
    await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === 'desktop')!);
    const side = page.locator('.sidePane');
    await side.getByRole('tab', { name: 'Probing', exact: true }).click();
    await side.getByRole('tab', { name: 'Calibrate', exact: true }).click();
    const panel = side.getByRole('tabpanel');
    await expect(panel.locator('.sub').filter({ hasText: /^(Round|Rectangular)$/ })).toHaveText(['Round', 'Rectangular']);
    const cell = panel.getByRole('button', { name: c.name, exact: true });
    await expect(cell).toBeEnabled();
    // the visible caption under the cell says the same start
    await expect(cell.locator('xpath=ancestor::div[contains(@class,"stack-micro")][1]').locator('.calCaption'))
      .toHaveText(c.caption);
    await ctl({ op: 'clearCmds' });
    await hold(page, cell);
    await expect.poll(async () => (await sent()).filter(x => x.cmd === 'probe_run').length, { message: c.name }).toBe(1);
    expect((await sent()).find(x => x.cmd === 'probe_run')!.routine, c.name).toBe(c.routine);
  });
}

test("Surface: the compensation switch is named", async ({ page }) => {
  // machine day 8.7b–d: a recorder named it "INPUT" — its accessible name
  // is the label around it
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === 'desktop')!);
  const side = page.locator('.sidePane');
  await side.getByRole('tab', { name: 'Probing', exact: true }).click();
  await side.getByRole('tab', { name: 'Surface', exact: true }).click();
  await expect(side.getByRole('checkbox', { name: 'Enable Compensation', exact: true })).toHaveCount(1);
});

// The Boss/Pocket size contract at the cells (P4-5, machine day F25, Codex
// MT433-02): a boss needs its size — dimmed with the reason, nothing sent —
// a pocket at 0 runs and says its limited search at the cell; the cell and
// the press read the same field.
test("Boss/Pocket: a boss needs its size; a pocket at 0 says its limited search", async ({ page }) => {
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === 'desktop')!);
  const side = page.locator('.sidePane');
  await side.getByRole('tab', { name: 'Probing', exact: true }).click();
  await side.getByRole('tab', { name: 'Boss/Pocket', exact: true }).click();
  const panel = side.getByRole('tabpanel');
  const roundBoss = panel.getByRole('button', { name: 'Probe outside of round feature', exact: true });
  const rectBoss = panel.getByRole('button', { name: 'Probe outside of rectangular feature', exact: true });
  await expect(roundBoss).toBeDisabled();
  await expect(rectBoss).toBeDisabled();
  await ctl({ op: 'clearCmds' });
  await roundBoss.locator('xpath=..').click({ force: true });
  await expect(page.locator('.btnHint')).toHaveText('Diameter needed — enter the rough size');
  await rectBoss.locator('xpath=..').click({ force: true });
  await expect(page.locator('.btnHint')).toHaveText('X/Y sizes needed — enter the rough sizes');
  expect((await sent()).filter(c => c.cmd === 'probe_run'), 'nothing sent').toEqual([]);

  // a diameter opens the Round Boss; X alone does not open the Rect Boss
  await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { probe: { diameterHint: 25, xHintBP: 30 } } } });
  await expect(roundBoss).toBeEnabled();
  await expect(rectBoss).toBeDisabled();
  // a Rect Pocket with Y at 0: open, and its cell says the limited search
  await expect(panel.getByRole('button', { name: /^Probe inside of rectangular pocket \(edge start\) — Search limited to Max X\/Y Travel$/ }))
    .toBeEnabled();
  await hold(page, roundBoss);
  await expect.poll(async () => (await sent()).filter(c => c.cmd === 'probe_run').length).toBe(1);
  const job = (await sent()).find(c => c.cmd === 'probe_run')!;
  expect([job.routine, job.vars?.['3025']]).toEqual(['probe_round_boss', 25]);
});

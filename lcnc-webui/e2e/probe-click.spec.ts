import { test, expect, type Page } from "./test";
import { ctl } from './ctl';
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
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
}

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
    const cell = side.getByRole('tabpanel').locator('.gridCell').first();
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

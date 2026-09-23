// Review regressions for feat/twp 926dc6d. Copy into an isolated checkout's
// lcnc-webui/e2e directory alongside ctl.ts and run against its mock servers.
// These assert the desired behavior; both fail at the reviewed revision.
import { test, expect } from '@playwright/test';
import { ctl, MOCK } from './ctl';

const permissions = {
  idle: true, jog: true, override: true, ready: true, run: true,
  pause: false, resume: false, step: true, abort: true, probe: true,
  zero: true, machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};

test.beforeEach(async () => { await ctl({ op: 'reset' }); });
test.afterEach(async () => { await ctl({ op: 'reset' }); });

test('Space on a refusal explanation must not start the loaded program', async ({ page }) => {
  await page.goto(MOCK);
  const button = page.getByRole('button', { name: 'Go to WCS 0', exact: true });
  await expect(button).toBeVisible();
  await ctl({ op: 'quiet', on: true });
  await ctl({ op: 'status_delta', data: {
    active_file: '/loaded.ngc',
    permissions: { ...permissions, goZero: false },
    permission_reasons: { goZero: 'Go to WCS 0 under TCP: select the Machine frame or the Plane frame first' },
  } });
  await expect(button).toBeDisabled();
  const help = page.locator('.btnTip', { has: button });
  await help.focus();
  await expect(help).toBeFocused();
  await ctl({ op: 'clearCmds' });
  await page.keyboard.press(' ');
  // Opening Messages also waits for the explanation to have been handled.
  await page.getByRole('button', { name: /^Messages \(/ }).click();
  await expect(page.locator('.msgText').first()).toContainText('select the Machine frame');
  const sent = await ctl({ op: 'lastCmds' });
  const commands = sent.cmds.map((c: { cmd: string }) => c.cmd);
  console.log('Space on disabled-control help:', JSON.stringify(commands));
  // Read-only initialization requests (e.g. get_tool_table) may arrive too.
  expect(commands).not.toContain('cycle_start');
  expect(commands).not.toContain('cycle_pause');
  expect(commands).not.toContain('cycle_resume');
});

test('Space on an enabled Plane radio must select the Plane frame', async ({ page }) => {
  await page.goto(MOCK);
  await expect(page.getByRole('button', { name: 'Zero X', exact: true })).toBeVisible();
  await ctl({ op: 'quiet', on: true });
  await ctl({ op: 'setKins', kins: {
    module: 'xyzacb_trsrn', type: 'xyzacb-trsrn', identity_first: false, params: {},
  } });
  await ctl({ op: 'status_delta', data: {
    kins_type: 0, g5x_index: 1, twp_defined: true, twp_active: true,
    permissions,
  } });
  const plane = page.locator('input[name="jogFrame"][value="2"]');
  await expect(plane).toBeEnabled();
  await expect(plane).not.toBeChecked();
  await plane.focus();
  await ctl({ op: 'clearCmds' });
  await page.keyboard.press(' ');
  const keyboard = await ctl({ op: 'lastCmds' });
  const keyboardModes = keyboard.cmds.filter((c: { cmd: string }) => c.cmd === 'set_kins_mode')
    .map((c: { mode: number }) => c.mode);
  // Positive control: the same enabled radio works by pointer.
  await plane.click();
  await expect.poll(async () => {
    const pointer = await ctl({ op: 'lastCmds' });
    return pointer.cmds.filter((c: { cmd: string }) => c.cmd === 'set_kins_mode')
      .map((c: { mode: number }) => c.mode);
  }).toEqual([2]);
  console.log('Enabled Plane via Space:', JSON.stringify(keyboardModes), '; pointer: [2]');
  expect(keyboardModes).toEqual([2]);
});

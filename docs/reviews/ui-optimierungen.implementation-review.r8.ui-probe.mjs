// Independent round-8 boundary checks; built frontend, isolated mock :4188.
// Run only after the regular suite. No LinuxCNC or machine commands.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(resolve('lcnc-webui/package.json'));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const ctl = op => new Promise((res, rej) => {
  const ws = new WebSocket('ws://127.0.0.1:4188/ctl');
  ws.once('open', () => ws.send(JSON.stringify(op)));
  ws.once('message', data => { ws.close(); res(JSON.parse(String(data))); });
  ws.once('error', rej);
});
const browser = await chromium.launch({ headless: true });
const results = [];
async function ready(page) {
  await ctl({ op: 'reset' });
  await page.goto('http://127.0.0.1:4188/');
  await expect(page.locator('.pill.armed')).toBeVisible();
  await ctl({ op: 'raw', frame: { type: 'settings_init', settings: {} } });
  await ctl({ op: 'clearCmds' });
}
async function noMachineAction() {
  const { cmds } = await ctl({ op: 'lastCmds' });
  const allowed = ['hello', 'heartbeat', 'get_tool_table', 'halshow_live', 'timing_log', 'tab_visibility', 'save_settings'];
  expect(cmds.filter(c => !allowed.includes(c.cmd))).toEqual([]);
}
try {
  // Permanent failure must not replace the previous listing; a transient
  // failure keeps a usable Retry which can actually recover the listing.
  const files = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let transient = true;
  const calls = [];
  await files.route('**/files*', async route => {
    const dir = new URL(route.request().url()).searchParams.get('subdir') ?? '';
    calls.push(dir);
    if (dir === 'denied') return route.fulfill({ status: 400, json: { detail: 'Invalid directory' } });
    if (dir === 'temporary' && transient) return route.fulfill({ status: 503, json: { detail: 'Temporarily unavailable' } });
    return route.fulfill({ json: { nc_dir: '/mock/nc_files', subdir: dir, entries: dir ? [] :
      ['denied', 'temporary'].map(name => ({ name, path: name, type: 'directory' })) } });
  });
  await ready(files);
  await files.getByRole('button', { name: 'Browse', exact: true }).click();
  const fb = files.locator('.fileBrowser:visible');
  await fb.getByRole('button', { name: 'denied', exact: true }).click();
  await expect(fb.getByRole('alert')).toContainText('outside the allowed folder');
  await expect(fb.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(fb.getByRole('button', { name: 'temporary', exact: true })).toBeVisible();
  await expect(fb.locator('.browserPath')).toHaveText('/mock/nc_files');
  await fb.getByRole('button', { name: 'temporary', exact: true }).click();
  await expect(fb.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  transient = false;
  await fb.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(fb.getByRole('alert')).toHaveCount(0);
  await expect(fb.locator('.browserPath')).toHaveText('/mock/nc_files/temporary');
  await noMachineAction();
  results.push({ case: 'K15: permanent refusal, retained listing, transient retry/recovery', passed: true, calls });
  await files.close();

  // A macro draft in a HIDDEN Settings tab must still block closing Settings.
  const macro = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await ready(macro);
  await macro.getByTitle('Settings', { exact: true }).click();
  const settings = macro.locator('.dialogOverlay').filter({ has: macro.locator('.dialogTitle', { hasText: /^Settings$/ }) });
  await settings.getByRole('button', { name: 'Macros', exact: true }).click();
  await settings.getByRole('button', { name: 'Add Macro', exact: true }).click();
  await settings.locator('#macro-edit-name').fill('Retain hidden draft');
  await settings.getByRole('button', { name: 'Machine', exact: true }).click();
  await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
  const ask = macro.locator('.dialog').filter({ has: macro.locator('.dialogTitle', { hasText: 'Discard changes?' }) });
  await expect(ask).toContainText('macro you are editing');
  await ask.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await settings.getByRole('button', { name: 'Macros', exact: true }).click();
  await expect(settings.locator('#macro-edit-name')).toHaveValue('Retain hidden draft');
  // Returning a draft to its opening state must remove the discard question.
  await settings.locator('#macro-edit-name').fill('');
  await settings.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(ask).toHaveCount(0);
  await noMachineAction();
  results.push({ case: 'K16: hidden macro draft survives; reverted draft closes without prompt', passed: true });
  await macro.close();

  // The regular macro test does not cover the separately exposed wizard.
  const gamepad = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await gamepad.addInitScript(() => {
    const pad = { id: 'Review controller', index: 0, connected: true, mapping: 'standard',
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
  });
  await ready(gamepad);
  await gamepad.getByTitle('Settings', { exact: true }).click();
  await gamepad.getByRole('button', { name: 'Gamepad', exact: true }).click();
  await gamepad.getByRole('button', { name: 'Map Buttons…', exact: true }).click();
  const wizard = gamepad.locator('.gpWizard');
  await expect(wizard).toBeVisible();
  await wizard.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(wizard).toContainText('Step 2 of');
  await gamepad.getByTitle('G-code Reference', { exact: true }).click();
  const gpAsk = gamepad.locator('.dialog').filter({ has: gamepad.locator('.dialogTitle', { hasText: 'Discard changes?' }) });
  await expect(gpAsk).toContainText('gamepad mapping in progress');
  await gpAsk.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(wizard).toContainText('Step 2 of');
  await gamepad.getByTitle('G-code Reference', { exact: true }).click();
  await gpAsk.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(wizard).toHaveCount(0);
  await expect(gamepad.getByRole('textbox', { name: 'Search G-code reference', exact: true })).toBeVisible();
  await noMachineAction();
  results.push({ case: 'K16: gamepad wizard asks; Keep preserves step; Discard completes header navigation', passed: true });
  await gamepad.close();
} catch (error) {
  results.push({ passed: false, error: String(error) });
  throw error;
} finally {
  await browser.close();
  await ctl({ op: 'reset' });
  fs.writeFileSync('docs/reviews/ui-optimierungen.implementation-review.r8.ui-evidence.json',
    JSON.stringify({ date: '2026-09-23', productCommit: '9360439', scope: 'Chromium, mocked HTTP/WS/Gamepad API, no LinuxCNC', results }, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
}

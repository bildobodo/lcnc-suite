// Run from repository root against an isolated mock on loopback:4188.
// npm run build first. No LinuxCNC; network/storage failures are injected.
// The real HTTP handler / SettingsStore supplies the response and full state
// (temporary files). This is a boundary integration probe, not a live gateway.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
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
const results = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['success', 'disk-full', 'corrupt', 'missing']) {
    for (let repeat = 1; repeat <= 3; repeat++) {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      let store, beacons = 0;
      await page.route('**/settings/keyboard*', async route => {
        beacons++;
        const data = route.request().postDataJSON().data;
        store = JSON.parse(execFileSync('lcnc-gateway/.venv/bin/python3',
          ['docs/reviews/ui-optimierungen.implementation-review.r7.store-probe.py'],
          { input: JSON.stringify({ mode, data }), encoding: 'utf8', timeout: 15000 }));
        if (mode === 'missing') await route.abort('failed');
        else await route.fulfill({ status: store.httpStatus, contentType: 'application/json',
          body: JSON.stringify(store.response) });
      });
      await ctl({ op: 'reset' });
      await page.goto('http://127.0.0.1:4188/');
      await expect(page.locator('.pill.armed')).toBeVisible();
      await ctl({ op: 'quiet', on: true });
      await ctl({ op: 'raw', frame: { type: 'settings_init', settings:
        ['corrupt', 'missing'].includes(mode) ? {} : { keyboard: { mapping: { abort: 'F8' } } } } });
      await page.getByTitle('Settings', { exact: true }).click();
      const dialog = page.locator('.dialogOverlay').first();
      await dialog.getByRole('button', { name: 'Keyboard', exact: true }).click();
      const abort = dialog.locator('tr').filter({ hasText: 'Abort' }).locator('.kbKeyCell');
      const status = dialog.locator('.saveStatus');
      await ctl({ op: 'clearCmds' });
      await abort.click();
      await page.keyboard.press('F9');
      await expect(status).toHaveText('Saving…');
      // Headless does not hide the page: simulate only the visibility event.
      // The production flush, Beacon, request and status listener are intact.
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Reflect.deleteProperty(document, 'visibilityState');
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => beacons).toBe(1);
      await expect.poll(() => !!store).toBe(true);
      await expect(status).toHaveText('Sent on page hide — not yet confirmed (keyboard)');
      // Model the authoritative settings_init received on reconnect. It is
      // the exact full snapshot the real store returns after the HTTP attempt.
      await ctl({ op: 'raw', frame: { type: 'settings_init', settings: store.cacheAfterRequest } });
      await page.waitForTimeout(700);
      const actual = await status.innerText();
      const expected = mode === 'success' ? 'Saved' : 'Save failed / Not saved';
      const cmds = (await ctl({ op: 'lastCmds' })).cmds ?? [];
      const wsSaves = cmds.filter(c => c.cmd === 'save_settings' && c.section === 'keyboard');
      expect(wsSaves).toHaveLength(0);
      const allowed = ['hello', 'heartbeat', 'get_tool_table', 'halshow_live', 'timing_log',
        'tab_visibility', 'save_settings'];
      expect(cmds.filter(c => !allowed.includes(c.cmd))).toEqual([]);
      const row = { mode, repeat, beacons, httpStatus: store.httpStatus,
        response: store.response, sentKey: 'F9', field: await abort.innerText(),
        cacheKey: store.cacheAfterRequest.keyboard?.mapping?.abort ?? null,
        persistedKey: store.freshStoreAfterRequest.keyboard?.mapping?.abort ?? null,
        version: store.version, actual, expected,
        acceptancePassed: mode === 'success' ? actual === 'Saved' : /^(Save failed|Not saved)/.test(actual),
        wsSaves: wsSaves.length, unexpectedCommands: 0 };
      results.push(row);
      console.log(JSON.stringify(row));
      await page.close();
    }
  }
} finally {
  await browser.close();
  await ctl({ op: 'reset' });
  fs.writeFileSync('docs/reviews/ui-optimierungen.implementation-review.r7.browser-evidence.json',
    JSON.stringify({ date: '2026-09-23', productCommit: '691e642', scope:
      'Built frontend, Chromium, isolated mock; actual HTTP handler/store via temporary-file fixture; visibility and settings_init injection; no LinuxCNC', results }, null, 2) + '\n');
}

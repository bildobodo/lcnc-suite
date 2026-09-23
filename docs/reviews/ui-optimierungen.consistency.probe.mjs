// Read-only UI capture against the isolated mock gateway, never LinuxCNC.
// Build first; run MOCK_HOST=127.0.0.1 MOCK_PORT=4186 node e2e/mock-gateway.mjs
// from lcnc-webui, then run this file from the repository root.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const require = createRequire(resolve('lcnc-webui/package.json'));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const out = resolve('runlogs/ui-consistency-20260922');
await mkdir(out, { recursive: true });
const ctl = op => new Promise((res, rej) => {
  const ws = new WebSocket('ws://127.0.0.1:4186/ctl');
  ws.once('open', () => ws.send(JSON.stringify(op)));
  ws.once('message', data => { ws.close(); res(JSON.parse(String(data))); });
  ws.once('error', rej);
});
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const result = [];
const barrel = { T: 416, P: 7, Z: -42.3, D: 12, type: 'circlebarrel',
  description: 'Imported barrel cutter', oal: 80, flute_length: 20,
  shoulder_length: 20, shaft_diameter: 12, lower_radius: 1,
  upper_radius: 1, profile_radius: 48, axial_distance: 10 };
const profiles = [
  { name: 'desktop', width: 1600, height: 1000, touch: false },
  { name: 'touch-landscape', width: 1280, height: 800, touch: true },
  { name: 'touch-portrait', width: 900, height: 1200, touch: true },
];
try {
  for (const p of profiles) {
    await ctl({ op: 'reset' });
    const context = await browser.newContext({ viewport: { width: p.width, height: p.height },
      hasTouch: p.touch, colorScheme: 'light', reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:4186/');
    await expect(page.locator('.pill.armed')).toBeVisible();
    await ctl({ op:'raw', frame:{ type:'settings_init', settings:{ display:{theme:'light'} } } });
    if (p.touch) await page.evaluate(() => document.documentElement.classList.add('touch-device'));
    await ctl({ op: 'status_delta', data: { tool_number: 416, active_file: '/layout-example.ngc' } });
    await page.evaluate(() => document.fonts.ready);
    const capture = async (state, selectors = []) => {
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const metrics = await page.evaluate(selectors => {
        const measure = el => {
          const r = el.getBoundingClientRect(), s = getComputedStyle(el);
          return { tag: el.tagName, text: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().slice(0, 95),
            class: el.className, x: r.x, y: r.y, width: r.width, height: r.height,
            font: s.fontSize, padding: s.padding, radius: s.borderRadius,
            color: s.color, background: s.backgroundColor, opacity: s.opacity,
            role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'),
            labelledBy: el.getAttribute('aria-labelledby'), labels: el.labels ? [...el.labels].map(l => l.textContent.trim()) : undefined };
        };
        return Object.fromEntries(selectors.map(sel => [sel, [...document.querySelectorAll(sel)].filter(e => e.getClientRects().length).map(measure)]));
      }, selectors);
      const file = `${p.name}-${state}.png`;
      await page.screenshot({ path: resolve(out, file), animations: 'disabled' });
      result.push({ profile: p.name, state, screenshot: file, metrics });
      await writeFile(resolve(out, 'measurements.json'), JSON.stringify(result, null, 2));
      console.log(`${p.name}: ${state}`);
    };
    await capture('program', ['header.hdr', '.hdrBtns button', '.sidePane .header', '.sidePane .tabRow button', '.inputField']);
    await page.getByRole('button', { name: 'MDI', exact: true }).click();
    await capture('mdi', ['.mdiInput', '.mdiRow button', '.mdiHistoryHeader']);
    await page.locator('.mdiInput').click();
    if (!await page.locator('.tkStrip').count()) await page.getByRole('button', { name: 'Open keyboard', exact: true }).click();
    await expect(page.locator('.tkStrip')).toBeVisible();
    await capture('keyboard', ['.tkStrip', '.tkClose', '.tkEnter', '.tkPages']);
    await page.locator('.tkClose').click();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect.poll(async () => {
      await ctl({ op: 'raw', frame: { type: 'reply', cmd: 'get_tool_table', ok: true, tools: [barrel] } });
      return page.getByTitle('Edit tool', { exact: true }).count();
    }).toBe(1);
    await capture('tools', ['.toolSearch', '.toolTabActions', '.toolTabActions button', '.dataTable button']);
    await page.getByTitle('Edit tool', { exact: true }).click();
    await expect(page.locator('.editPreviewCanvas canvas')).toBeVisible();
    await capture('tool-editor', ['.editDialog', '.editDialog .inputField', '.editDialog label', '.editPreviewCol', '.dialogActions']);
    await page.locator('.editDialog input.inputField').first().click();
    await expect(page.locator('.nkStrip')).toBeVisible();
    await capture('numpad', ['.nkStrip', '.nkClose', '.nkOk', '.nkDisplay']);
    await page.locator('.nkClose').click();
    await page.getByRole('button', { name: 'Close tool editor', exact: true }).click();
    await page.getByTitle('Settings', { exact: true }).click();
    await capture('settings', ['.dialog', '.dialog .inputField', '.dialog .tabRow button', '.dialog label', '.helpIcon']);
    await context.close();
  }
} finally { await browser.close(); }
console.log(out);

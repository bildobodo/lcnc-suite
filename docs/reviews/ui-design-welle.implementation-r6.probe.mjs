// Independent review of D7–D10 at 000ceef. No live gateway or machine commands.
// Build lcnc-webui; start its mock with MOCK_HOST=127.0.0.1 MOCK_PORT=4188.
// Run from the repository root: nice -n 15 node docs/reviews/ui-design-welle.implementation-r6.probe.mjs
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../lcnc-webui/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const { encode } = require('@msgpack/msgpack');
const feed = Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
const preview = Buffer.from(encode({ file: '/leak.ngc', preview_schema: 9, feed,
  feed_lines: feed.map((_, i) => i + 3), feed_seq: feed.map((_, i) => i + 3),
  rapid: [[0, 0, 5], [0, 0, 0]], rapid_lines: [1, 2], rapid_seq: [1, 2],
}));
const origin = 'http://127.0.0.1:4188';
const out = fileURLToPath(new URL('./ui-design-welle.implementation-r6', import.meta.url));
function ctl(op) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ctl');
    const timer = setTimeout(() => { ws.terminate(); reject(Error('ctl timeout')); }, 5000);
    ws.once('open', () => ws.send(JSON.stringify(op)));
    ws.once('message', d => { clearTimeout(timer); ws.close(); resolve(JSON.parse(d)); });
    ws.once('error', reject);
  });
}
const result = { head: '000ceef', origin, layouts: [], errors: [] };
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.route('**/*', r => {
  const u = new URL(r.request().url());
  if (u.origin !== origin) return r.abort();
  if (u.pathname === '/preview') return r.fulfill({ contentType: 'application/octet-stream', body: preview });
  if (u.pathname === '/gcode') return r.fulfill({ contentType: 'text/plain', body: '(Review R6)\nG0 X0\nG1 X10 F100\nM2\n' });
  return r.continue();
});
const page = await context.newPage();
page.on('pageerror', e => result.errors.push(e.message));
const settings = async scale => ctl({ op: 'raw', frame: { type: 'settings_init', settings: {
  display: { theme: 'light' }, viewer: { hud: { scale, showMachine: true } },
} } });

async function sample(count = 25) {
  return page.evaluate(async count => {
    const seen = [];
    const started = performance.now();
    const rect = selector => {
      const e = document.querySelector(selector);
      if (!e || !e.getBoundingClientRect().height) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    for (let i = 0; i < count; i++) {
      seen.push({ elapsedMs: performance.now() - started, class: document.querySelector('.hudCard')?.className,
        fit: document.querySelector('.hudCard')?.getAttribute('data-hud-fit'),
        hud: rect('.hudCard'), bottom: rect('.viewerBottom'), notes: rect('.hudNotes') });
      await new Promise(r => setTimeout(r, 40));
    }
    const unique = [...new Set(seen.map(s => s.class))];
    const boxes = { pane: rect('.viewerWrapper'), hud: rect('.hudCard'),
      cube: rect('.viewCube'), quick: rect('.viewerQuickGrid'), notes: rect('.hudNotes'), scrub: rect('.scrubBar') };
    const overlaps = [];
    const els = Object.entries(boxes).filter(([k, v]) => k !== 'pane' && v);
    for (let a = 0; a < els.length; a++) for (let b = a + 1; b < els.length; b++) {
      const [ka, ra] = els[a], [kb, rb] = els[b];
      const w = Math.min(ra.right, rb.right) - Math.max(ra.x, rb.x);
      const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.y, rb.y);
      if (w > 1 && h > 1) overlaps.push({ a: ka, b: kb, width: w, height: h });
    }
    return { unique, transitions: seen.filter((s, i) => !i || s.class !== seen[i - 1].class),
      boxes, overlaps, warnings: [...document.querySelectorAll('.hudWarn')].map(e => e.textContent) };
  }, count);
}

try {
  await ctl({ op: 'reset' });
  await page.goto(origin);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({ op: 'setAxes', axes: ['X', 'Y', 'Z', 'A', 'C'] });
  await ctl({ op: 'setKins', kins: { module: 'xyzac-trt-kins', type: 'xyzac-trt', identity_first: true, params: {} } });
  await ctl({ op: 'status_delta', armed: true, data: { kins_type: 0, g5x_index: 1,
    active_file: '/leak.ngc', tool_number: 0, tool_diameter: 0, tool_length: 0,
    eoffset_enabled: true, eoffset_z: 0.123, rotation_xy: 12 } });
  await ctl({ op: 'loadGcode' });
  await expect(page.locator('.scrubBar')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await ctl({ op: 'quiet', on: true });
  await expect(page.locator('.hudWarn')).toHaveCount(2);

  const profiles = [
    { name: 'desktop', width: 1600, height: 1000, zoom: 1, touch: false },
    { name: 'compact', width: 1024, height: 768, zoom: 1, touch: false },
    { name: 'touch-landscape', width: 1280, height: 800, zoom: 1, touch: true },
    { name: 'touch-portrait', width: 900, height: 1200, zoom: 1, touch: true },
    { name: 'touch-portrait-150', width: 900, height: 1200, zoom: 1.5, touch: true },
  ];
  for (const axes of [['X', 'Y', 'Z', 'A', 'C'], ['X', 'Y', 'Z', 'A', 'B', 'C']]) {
    await ctl({ op: 'setAxes', axes });
    for (const vp of profiles) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.evaluate(v => {
        document.documentElement.style.zoom = String(v.zoom);
        document.documentElement.classList.toggle('touch-device', v.touch);
      }, vp);
      for (const scale of ['md', 'xl']) {
        await settings(scale);
        await page.waitForTimeout(350);
        const measured = await sample();
        const entry = { axes: axes.length, vp, scale, ...measured };
        result.layouts.push(entry);
        console.log(JSON.stringify({ axes: axes.length, vp: vp.name, scale,
          unique: measured.unique, overlaps: measured.overlaps }));
        if (measured.unique.length > 1 || measured.overlaps.length) {
          const name = `${out}-${axes.length}axis-${vp.name}-${scale}.png`;
          await page.screenshot({ path: name }); entry.screenshot = name.split('/').pop();
        }
        if (measured.unique.length > 1 && !result.oscillation) {
          result.oscillation = { axes: axes.length, vp, scale, ...await sample(200) };
        }
      }
    }
  }
  // A resize near a fitting threshold must settle: the notes share the
  // selected HUD scale but their previous height feeds the next decision.
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; document.documentElement.classList.remove('touch-device'); });
  await settings('xl');
  result.thresholds = [];
  for (let h = 768; h <= 1008; h += 12) {
    await page.setViewportSize({ width: 1280, height: h });
    await page.waitForTimeout(300);
    const m = await sample();
    result.thresholds.push({ height: h, ...m });
    if (m.unique.length > 1) {
      await page.screenshot({ path: `${out}-oscillation-${h}.png` });
      console.log(`OSCILLATION at 1280x${h}: ${JSON.stringify(m.unique)}`);
    }
  }
  // Hold a previously observed threshold with no resize, commands, or
  // settings changes. rAF layout changes must finish before this interval.
  await ctl({ op: 'setAxes', axes: ['X', 'Y', 'Z', 'A', 'C'] });
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.evaluate(() => document.documentElement.classList.add('touch-device'));
  await settings('xl');
  await page.waitForTimeout(2000);
  result.stationary = { axes: 5, viewport: '900x1200', zoom: 1, scale: 'xl', ...await sample(200) };
  await page.screenshot({ path: `${out}-stationary.png` });
  result.commands = (await ctl({ op: 'lastCmds' })).cmds;
} catch (e) { result.fatal = String(e.stack || e); process.exitCode = 1; }
finally { await writeFile(`${out}.json`, JSON.stringify(result, null, 2) + '\n'); await browser.close(); }

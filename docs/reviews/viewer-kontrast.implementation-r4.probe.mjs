// Independent R13 browser probe. Only the dedicated localhost mock is allowed.
// Run: nice -n 15 node docs/reviews/viewer-kontrast.implementation-r4.probe.mjs
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as THREE from '../../lcnc-webui/node_modules/three/build/three.module.js';
import { STLExporter } from '../../lcnc-webui/node_modules/three/examples/jsm/exporters/STLExporter.js';
const require = createRequire(new URL('../../lcnc-webui/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const { encode } = require('@msgpack/msgpack');
const origin = 'http://127.0.0.1:4189';
const prefix = fileURLToPath(new URL('./viewer-kontrast.implementation-r4', import.meta.url));
const result = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), origin,
  checks: [], samples: [], pageErrors: [] };
const save = () => writeFile(prefix + '.probe.json', JSON.stringify(result, null, 2) + '\n');
const ctl = op => new Promise((resolve, reject) => {
  const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ctl');
  const timer = setTimeout(() => { ws.terminate(); reject(Error('ctl timeout')); }, 6000);
  ws.once('open', () => ws.send(JSON.stringify(op)));
  ws.once('message', d => { clearTimeout(timer); ws.close(); resolve(JSON.parse(d)); });
  ws.once('error', e => { clearTimeout(timer); reject(e); });
});
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
// Observe the controller's pending range arrays without changing their contents.
// addUpdateRange delegates to Array.push({start,count}); stationary highlights
// can also use six-component ranges. The observed growing queue below follows
// actual tool motion while the program selection remains unchanged.
await context.addInitScript(() => {
  const original = Array.prototype.push, queues = new Set();
  Array.prototype.push = function (...xs) {
    const v = xs[0];
    if (xs.length === 1 && v && v.count === 6 && Number.isInteger(v.start)
        && Object.keys(v).length === 2) queues.add(this);
    return original.apply(this, xs);
  };
  window.__reviewPendingRanges = () => [...queues].map(q => ({ count: q.length,
    first: q[0] ?? null, last: q.at(-1) ?? null }));
});
const old = { feed: '#22b8cf', rapid: '#f5a623', backplot: '#ff00ff', bounds: '#ffffff',
  toolpathBounds: '#f5a623', tool: '#c0c0c0', cutter: '#ffdd00' };
let settings = { display: { theme: 'light' }, viewer: { paletteMode: 'auto', layers: { hud: true, backplot: true } } };
const positions = [[-100, -100, 0], [100, -100, 0], [100, 100, 0], [-100, 100, 0]];
const payload = Buffer.from(encode({ file: '/review.ngc', preview_schema: 9,
  feed: positions, feed_lines: [2, 3, 4, 5], feed_seq: [2, 3, 4, 5],
  feed_kinstype: new Uint8Array([2, 2, 2, 2]), feed_abc: positions.map(() => [0, 30, 0]),
  kins_frames: [[0, 0, 0, 30]], wcs_frames: [[0, 6, 0, 1, ...Array(12).fill(0)]],
  violations: [{ line: 4, axis: 'X', value: 100, limit: 90, kind: 'max' }], violations_total: 1,
  feed_outside: new Uint8Array([0, 0, 1, 1]), rapid: [], rapid_lines: [], rapid_seq: [] }));
const table = Buffer.from(new STLExporter().parse(new THREE.Mesh(new THREE.BoxGeometry(500, 500, 60)), { binary: true }).buffer);
await context.route('**/*', route => {
  const u = new URL(route.request().url());
  if (u.origin !== origin) return route.abort();
  if (u.pathname === '/settings') return route.fulfill({ json: { settings } });
  if (u.pathname === '/preview') return route.fulfill({ contentType: 'application/octet-stream', body: payload });
  if (u.pathname === '/gcode') return route.fulfill({ contentType: 'text/plain', body: '(R13)\nG1 X-100\nG1 X100\nG1 Y100\nG1 X-100\nM2\n' });
  if (u.pathname.endsWith('.stl')) return route.fulfill({ contentType: 'application/octet-stream', body: table });
  return route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(8000);
page.on('pageerror', e => result.pageErrors.push(e.message));
const check = async (name, f) => {
  try { await f(); result.checks.push({ name, pass: true }); }
  catch (e) { result.checks.push({ name, pass: false, error: String(e) }); }
  await save(); console.log(JSON.stringify(result.checks.at(-1)));
};
const settingsFrame = async () => { await ctl({ op: 'raw', frame: { type: 'settings_init', settings } }); await page.waitForTimeout(300); };
const plane = () => page.evaluate(() => window.__viewerDiag.getPlane());
const zeroWcs = Array.from({ length: 9 }, (_, i) => ({ name: `G${54+i}`, x: 0, y: 0, z: 0, a: 0, b: 0, c: 0, r: 0 }));
const live = { twp_plane: [0, 0, 0, 0, 0.5, 0.8660254, 1, 0, 0], twp_defined: true,
  twp_active: true, twp_pose_a: 0, twp_pose_b: 30, twp_pose_c: 0, rotary_abc: [0, 30, 0],
  twp_datum: [0, 0, 0], wcs_table: zeroWcs, wcs_prov_a: Array(9).fill(0), g5x_index: 6, kins_type: 2,
  joint_pos: [0, 0, 0, 0, 30, 0], tool_offset: Array(6).fill(0), g92_offset: Array(6).fill(0),
  homed: true, homed_joints: Array(6).fill(true), active_file: '/review.ngc' };
try {
  await ctl({ op: 'reset' }); await page.goto(origin);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
  await ctl({ op: 'setAxes', axes: ['X', 'Y', 'Z', 'A', 'B', 'C'] });
  await ctl({ op: 'setViewerInit', data: { units: 'mm', axes: ['X','Y','Z','A','B','C'], stl_base_url: '/machine/',
    parts: [{ id: 'base', file: 'base.stl', group: 'root', translate: [0, 0, -40] }],
    groups: [{ id: 'x', parent: 'root' }, { id: 'y', parent: 'x' }, { id: 'tool', parent: 'y' }],
    kinematics: [{ group: 'x', joint: 0, type: 'translate', direction: 'x', sign: 1 },
      { group: 'y', joint: 1, type: 'translate', direction: 'y', sign: 1 }],
    workGroup: 'root', toolGroup: 'tool', machine_bounds: { origin: [-250,-250,-50], size: [500,500,250] },
    kins: { module: 'xyzacb_trsrn', type: 'xyzacb-trsrn', identity_first: false, params: {} } } });
  await ctl({ op: 'status_delta', data: live }); await settingsFrame();
  await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: 1800, file: '/review.ngc' } });
  await expect(page.locator('.scrubBar')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await check('TWP state and live theme refresh, HUD hidden at portrait 150%', async () => {
    await page.setViewportSize({ width: 900, height: 1200 });
    await page.evaluate(() => { document.documentElement.style.zoom = '1.5'; document.documentElement.classList.add('touch-device'); });
    await ctl({ op: 'status_delta', data: { rotary_abc: [0, 10, 0], twp_datum: [5, 0, 0] } });
    settings.viewer.layers.hud = false;
    for (const theme of ['light', 'dark', 'hc-light', 'hc-dark']) {
      settings.display.theme = theme; await settingsFrame();
      await expect.poll(async () => (await plane()).label).toBe('Plane · head moved · datum moved');
      const p = await plane(), colour = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--viewer-plane-stale').trim());
      expect(p.edge.color).toBe(colour); expect(p.visible).toBe(true); expect(p.arrowStale).toBe(true);
      await page.waitForTimeout(250);
      await page.screenshot({ path: `${prefix}-plane-portrait-${theme}.png` });
      result.samples.push({ theme, plane: p });
    }
  });
  await check('Real Sim switch uses the program plane and restores the live plane', async () => {
    await page.evaluate(() => { document.documentElement.style.zoom = ''; document.documentElement.classList.remove('touch-device'); });
    await page.setViewportSize({ width: 1200, height: 900 });
    await ctl({ op: 'status_delta', data: { is_enabled: false, enabled: false } });
    await page.locator('.scrubBar input.toggle').check();
    await expect.poll(async () => (await plane()).label).toBe('Plane · simulated');
    expect((await plane()).visible).toBe(true);
    await page.screenshot({ path: `${prefix}-real-simulation.png` });
    await page.locator('.scrubBar input.toggle').uncheck();
    await expect.poll(async () => (await plane()).label).toBe('Plane · head moved · datum moved');
  });
  await check('Hidden backplot pending updates, Clear, then redraw', async () => {
    settings.viewer.layers.backplot = false; await settingsFrame();
    const before = await page.evaluate(() => window.__reviewPendingRanges());
    for (let i = 0; i < 120; i++) { await ctl({ op: 'status_delta', data: { joint_pos: [i, 0, 0, 0, 30, 0] } }); await page.waitForTimeout(22); }
    const hidden = await page.evaluate(() => window.__reviewPendingRanges());
    await page.getByRole('button', { name: 'Clear backplot', exact: true }).click();
    const cleared = await page.evaluate(() => window.__reviewPendingRanges());
    settings.viewer.layers.backplot = true; await settingsFrame();
    await ctl({ op: 'status_delta', data: { joint_pos: [140, 0, 0, 0, 30, 0] } }); await page.waitForTimeout(150);
    const shown = await page.evaluate(() => window.__reviewPendingRanges());
    result.pendingRanges = { before, hidden, cleared, shown };
    expect(Math.max(0, ...cleared.map(q => q.count)), 'Clear should discard pending work from the old trail').toBe(0);
  });
  await check('Legacy palette round-trip and narrow Settings hint', async () => {
    settings = { display: { theme: 'light' }, viewer: { colors: old } }; await settingsFrame();
    await page.setViewportSize({ width: 900, height: 1200 });
    await page.evaluate(() => { document.documentElement.style.zoom = '1.5'; document.documentElement.classList.add('touch-device'); });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await dialog.getByRole('tab', { name: '3D Viewer', exact: true }).click();
    const note = dialog.locator('[data-palette-note]');
    await note.scrollIntoViewIfNeeded(); await expect(note).toHaveAttribute('data-palette-note', 'legacy');
    await page.screenshot({ path: `${prefix}-legacy-portrait.png` });
    result.noteBox = await note.evaluate(e => {
      const button = e.querySelector('button'), label = button.querySelector('.btnLabel') || button;
      const r = document.createRange(); r.selectNodeContents(label);
      const rect = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, height: b.height }; };
      const buttonRect = rect(button), labelRect = rect(label), textRect = rect(r);
      return { width: e.clientWidth, scroll: e.scrollWidth, text: e.textContent,
        button: { text: button.textContent, box: buttonRect, label: labelRect, textBox: textRect,
          labelClientWidth: label.clientWidth, labelScrollWidth: label.scrollWidth,
          overflow: getComputedStyle(label).overflow, whiteSpace: getComputedStyle(label).whiteSpace } };
    });
    expect(result.noteBox.scroll).toBeLessThanOrEqual(result.noteBox.width + 1);
    await ctl({ op: 'clearCmds' });
    await dialog.getByRole('button', { name: 'Use automatic colors', exact: true }).click();
    await expect.poll(async () => (await ctl({ op: 'lastCmds' })).cmds.some(c => c.cmd === 'save_settings' && c.section === 'viewer')).toBe(true);
    settings.viewer = (await ctl({ op: 'lastCmds' })).cmds.filter(c => c.cmd === 'save_settings' && c.section === 'viewer').at(-1).data;
    expect(settings.viewer.paletteMode).toBe('auto'); expect(settings.viewer.paletteOrigin).toBe('operator'); expect(settings.viewer.colors).toEqual(old);
    await page.reload(); await settingsFrame();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await dialog.getByRole('tab', { name: '3D Viewer', exact: true }).click();
    await expect(note).toHaveCount(0);
    await dialog.getByRole('radio', { name: 'Custom', exact: true }).check();
    await expect(note).toHaveCount(0);
    await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: 1801, file: '/review.ngc' } });
    await expect.poll(() => page.evaluate(() => window.__viewerDiag.getPalette().drawn.feed)).toBe(old.feed);
  });
  await check('Legacy hint action label fits the visible button at portrait 150%', async () => {
    const b = result.noteBox.button;
    expect(b.textBox.left, 'whole label starts inside the button').toBeGreaterThanOrEqual(b.box.left);
    expect(b.textBox.right, 'whole label ends inside the button').toBeLessThanOrEqual(b.box.right);
    expect(b.labelScrollWidth).toBeLessThanOrEqual(b.labelClientWidth + 1);
  });
} catch (e) { result.fatal = String(e); }
finally { await save(); await context.close(); await browser.close(); }
console.log(JSON.stringify({ checks: result.checks, errors: result.pageErrors, fatal: result.fatal }));

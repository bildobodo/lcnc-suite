// Independent supplementary check: program limit findings with the timeline at 883465a. No live gateway or machine commands.
// Build lcnc-webui; start its mock with MOCK_HOST=127.0.0.1 MOCK_PORT=4188.
// Run from the repository root: nice -n 15 node docs/reviews/ui-design-welle.implementation-r7-limits.probe.mjs
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../lcnc-webui/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const { encode } = require('@msgpack/msgpack');
const feed = Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
const previewData = { file: '/leak.ngc', preview_schema: 9, feed,
  feed_lines: feed.map((_, i) => i + 3), feed_seq: feed.map((_, i) => i + 3),
  rapid: [[0, 0, 5], [0, 0, 0]], rapid_lines: [1, 2], rapid_seq: [1, 2],
};
let preview = Buffer.from(encode(previewData));
const origin = 'http://127.0.0.1:4188';
const out = fileURLToPath(new URL('./ui-design-welle.implementation-r7-limits', import.meta.url));
function ctl(op) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/ctl');
    const timer = setTimeout(() => { ws.terminate(); reject(Error('ctl timeout')); }, 5000);
    ws.once('open', () => ws.send(JSON.stringify(op)));
    ws.once('message', d => { clearTimeout(timer); ws.close(); resolve(JSON.parse(d)); });
    ws.once('error', reject);
  });
}
const result = { head: '883465a', origin, layouts: [], errors: [] };
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.route('**/*', r => {
  const u = new URL(r.request().url());
  if (u.origin !== origin) return r.abort();
  if (u.pathname === '/preview') return r.fulfill({ contentType: 'application/octet-stream', body: preview });
  if (u.pathname === '/gcode') return r.fulfill({ contentType: 'text/plain', body: '(Review R7)\nG0 X0\nG1 X10 F100\nM2\n' });
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
      boxes, overlaps, notesClass: document.querySelector('.hudNotes')?.className,
      axisValues: [...document.querySelectorAll('.hudWork:not(.hudFS)')].map(e => ({ text: e.textContent,
        font: getComputedStyle(e).fontSize, shown: e.getBoundingClientRect().height > 0 })),
      warnings: [...document.querySelectorAll('.hudWarn')].map(e => e.textContent) };
  }, count);
}

async function disclosure() {
  return page.evaluate(() => {
    const rect = e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
    const pane = rect(document.querySelector('.viewerWrapper'));
    const card = document.querySelector('.hudNotes'), button = card.querySelector('.notesToggle');
    const b = rect(button), at = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
    const inside = r => r.height > 0 && r.y >= pane.y && r.bottom <= pane.bottom && r.x >= pane.x && r.right <= pane.right;
    return { pane, card: rect(card), class: card.className, summary: card.querySelector('.hudNotesSummary').textContent,
      button: { ...b, name: button.getAttribute('aria-label'), expanded: button.getAttribute('aria-expanded'), hit: !!at && button.contains(at), inside: inside(b) },
      warnings: [...card.querySelectorAll('.hudWarn')].map(e => ({ text: e.textContent, rect: rect(e), inside: inside(rect(e)) })) };
  });
}

async function scrubDetails() {
  return page.locator('.scrubBar').evaluate(bar => {
    const r = e => { const b = e.getBoundingClientRect(); return { x:b.x, y:b.y, right:b.right, bottom:b.bottom, width:b.width, height:b.height }; };
    const pane = r(document.querySelector('.viewerWrapper'));
    const controls = [...bar.querySelectorAll('button,input,.helpIcon,.sweepTool,.lineSlot,.posSlot,.sliderWrap')].map(e => {
      const b = r(e), at = document.elementFromPoint(b.x + b.width/2, b.y + b.height/2);
      const target = e.closest('.btnTip') || e;
      return { tag:e.tagName, cls:e.className, name:e.getAttribute('aria-label'), title:e.getAttribute('title'),
        text:e.textContent, box:b, shown:b.width>0 && b.height>0,
        inPane:b.x>=pane.x && b.right<=pane.right && b.y>=pane.y && b.bottom<=pane.bottom,
        hit:!!at && target.contains(at) };
    });
    return { pane, box:r(bar), clientWidth:bar.clientWidth, scrollWidth:bar.scrollWidth,
      overflowX:getComputedStyle(bar).overflowX,
      rows:[...bar.querySelectorAll('.scrubRow')].map(e=>({box:r(e),clientWidth:e.clientWidth,scrollWidth:e.scrollWidth,overflowX:getComputedStyle(e).overflowX})),controls };
  });
}

try {
  await ctl({ op: 'reset' });
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.goto(origin);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await page.evaluate(() => { document.documentElement.classList.add('touch-device'); document.documentElement.style.zoom = '1.5'; });
  await ctl({ op: 'setAxes', axes: ['X', 'Y', 'Z', 'A', 'B', 'C'] });
  await ctl({ op: 'setKins', kins: { module: 'xyzacb_trsrn', type: 'xyzacb-trsrn', identity_first: false, params: {} } });
  await ctl({ op: 'status_delta', armed: true, data: { kins_type: 0, g5x_index: 1,
    active_file: '/leak.ngc', tool_number: 0, tool_diameter: 0, tool_length: 0,
    eoffset_enabled: true, eoffset_z: 0.123, rotation_xy: 12 } });
  await settings('md');
  await ctl({ op: 'loadGcode' });
  await expect(page.locator('.scrubBar')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  result.beforeLimit = await sample();
  result.beforeLimit.controls = await scrubDetails();
  await page.screenshot({ path: `${out}-before.png` });

  // Exactly one program endpoint exceeds the mock machine's X maximum.
  // Publish the parser's corresponding per-point flag and finding record.
  const points = feed.map(p => [...p]); points[29][0] = 120;
  preview = Buffer.from(encode({ ...previewData, feed: points,
    feed_outside: new Uint8Array(points.map(p => p[0] > 100 ? 1 : 0)),
    violations: [{ line: 32, axis: 'X', value: 120, limit: 100, kind: 'max' }], violations_total: 1,
  }));
  await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: 995, file: '/leak.ngc' } });
  await expect(page.locator('.scrubBar').getByRole('button', { name: 'Next limit violation', exact: true })).toBeVisible();
  await page.waitForTimeout(1000);
  result.withLimit = await sample(75);
  result.withLimit.disclosure = await disclosure();
  result.withLimit.controls = await scrubDetails();
  await page.screenshot({ path: `${out}-folded.png` });
  await page.getByRole('button', { name: 'Show viewer warnings', exact: true }).click();
  await page.waitForTimeout(500);
  result.expanded = await disclosure();
  await page.screenshot({ path: `${out}-expanded.png` });
  if (result.expanded.button.hit) {
    await page.getByRole('button', { name: 'Hide viewer warnings', exact: true }).click();
    result.closedByTap = true;
  } else {
    await page.locator('.notesToggle').evaluate(e => e.click());
    result.closedByTap = false;
  }
  // Same loaded program, fifth axis removed: the original 5-axis case too.
  await ctl({ op: 'setAxes', axes: ['X', 'Y', 'Z', 'A', 'C'] });
  await page.waitForTimeout(1000);
  result.fiveAxis = await sample();
  result.fiveAxis.controls = await scrubDetails();
  await page.screenshot({ path: `${out}-5axis.png` });
  // A client-local simulation at a stopped MOCK machine: the timeline is
  // enabled now, so the width cannot be excused as a disabled-only state.
  await ctl({ op: 'status_delta', data: { is_enabled: false, enabled: false,
    joint_pos: [0, 0, 0, 0, 0, 0], actual_position: [0, 0, 0],
    g5x_offset: [0, 0, 0], g92_offset: [0, 0, 0], tool_offset: [0, 0, 0] } });
  await page.locator('.scrubBar input.toggle').check();
  await expect(page.locator('.scrubBar .sliderInput')).toBeEnabled();
  await page.waitForTimeout(500);
  result.simulating = await scrubDetails();
  result.simulating.overlays = await page.evaluate(() => {
    const rect = e => { const b = e.getBoundingClientRect(); return { x:b.x, y:b.y, right:b.right, bottom:b.bottom, width:b.width, height:b.height }; };
    const banner = document.querySelector('.simBanner');
    const b = rect(banner), h = rect(document.querySelector('.hudCard'));
    return { pane:rect(document.querySelector('.viewerWrapper')), banner:b,
      text:banner.textContent.trim(), whiteSpace:getComputedStyle(banner).whiteSpace, hud:h,
      axes:[...document.querySelectorAll('.hudWork:not(.hudFS)')].map(e=>({text:e.textContent,box:rect(e)})),
      overlap:{width:Math.max(0,Math.min(b.right,h.right)-Math.max(b.x,h.x)),height:Math.max(0,Math.min(b.bottom,h.bottom)-Math.max(b.y,h.y))} };
  });
  await page.screenshot({ path: `${out}-simulation.png` });
  await page.locator('.scrubBar input.toggle').uncheck();
  result.commands = (await ctl({ op: 'lastCmds' })).cmds;
} catch (e) { result.fatal = String(e.stack || e); process.exitCode = 1; }
finally { await writeFile(`${out}.json`, JSON.stringify(result, null, 2) + '\n'); await browser.close(); }

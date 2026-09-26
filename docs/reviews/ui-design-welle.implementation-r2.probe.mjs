// Independent implementation review round 2, WP-DR / D0-D2, 2026-09-26.
// Run after a frontend build and starting a separate mock:
//   cd lcnc-webui
//   MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs
// In another terminal from the repo root:
//   node docs/reviews/ui-design-welle.implementation-r2.probe.mjs
// Diagnostic evidence, not a passing regression gate. No live LinuxCNC.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../lcnc-webui/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const origin = 'http://127.0.0.1:4188';
const out = fileURLToPath(new URL('./ui-design-welle.implementation-r2', import.meta.url));
const perms = { idle: true, jog: true, override: true, ready: true, run: true,
  pause: false, resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true, touchoff: true,
  touchoffRotary: true, twpCapture: true, surfaceComp: true, safety: true,
  setup: true, armed: true, always: true };
function ctl(msg) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:4188/ctl');
    const timer = setTimeout(() => { ws.terminate(); reject(Error('ctl timeout')); }, 5000);
    ws.on('open', () => ws.send(JSON.stringify(msg)));
    ws.on('message', data => { clearTimeout(timer); ws.close(); resolve(JSON.parse(data)); });
    ws.on('error', reject);
  });
}
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
// Every browser request is confined to this isolated mock.
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  if (url.origin === origin) return route.continue();
  return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(5000);
async function ready() {
  await ctl({ op: 'reset' });
  await page.goto(origin);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({ op: 'quiet', on: true });
  await ctl({ op: 'status_delta', data: { active_file: '/A.ngc', permissions: perms } });
  await ctl({ op: 'clearCmds' });
}
async function settle() {
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function snapshot() {
  await settle();
  return page.evaluate(() => {
    const a = document.activeElement;
    const title = el => el?.querySelector('.dialogTitle')?.textContent?.trim() ?? null;
    const r = a?.getBoundingClientRect();
    const hit = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
    return {
      top: title(document.getElementById(window.__modalRegistry.top())),
      focus: a?.getAttribute('aria-label') || a?.getAttribute('title') || a?.textContent?.trim().slice(0, 80),
      focusTag: a?.tagName,
      focusDialog: title(a?.closest('[role=dialog]')),
      visibleOverlayAtFocus: title(hit?.closest('.dialogOverlay')),
      dialogs: [...document.querySelectorAll('[role=dialog]')].map(d => ({
        title: title(d), zIndex: getComputedStyle(d.closest('.dialogOverlay')).zIndex,
      })),
    };
  });
}
const result = {};
try {
  await ready();
  await ctl({ op: 'status_delta', data: { tool_change_requested: true, tool_change_tool: 5 } });
  await expect(page.getByRole('dialog', { name: 'Load Tool into Spindle' })).toBeVisible();
  await page.getByTitle('Settings', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  result.flowThenSettings = await snapshot();
  await page.keyboard.press('Tab');
  result.flowThenSettingsAfterTab = await snapshot();

  await ready();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await expect.poll(async () => {
    await ctl({ op: 'raw', frame: { type: 'reply', cmd: 'get_tool_table', ok: true,
      tools: [{ T: 5, P: 5, Z: -40, D: 6, type: 'endmill', description: 'Test cutter' }] } });
    return page.getByTitle('Edit tool', { exact: true }).count();
  }).toBe(1);
  const add = page.getByRole('button', { name: '+ Add', exact: true });
  await add.click();
  const editor = page.getByRole('dialog', { name: 'Add Tool', exact: true });
  await editor.getByRole('button', { name: 'Add', exact: true }).click();
  let save;
  await expect.poll(async () => {
    save = (await ctl({ op: 'lastCmds' })).cmds.find(c => c.cmd === 'add_tool');
    return !!save;
  }).toBe(true);
  await page.getByTitle('Settings', { exact: true }).click();
  // The request is still pending after the command debounce has ended.
  await expect(add).toBeEnabled();
  result.beforeSaveReply = await snapshot();
  await ctl({ op: 'raw', frame: { type: 'reply', cmd: 'add_tool', req_id: save.req_id, ok: true } });
  await expect(editor).toHaveCount(0);
  result.afterSaveReply = await snapshot();
  await page.keyboard.press('Space');
  await settle();
  result.afterSpace = await snapshot();
  result.commands = (await ctl({ op: 'lastCmds' })).cmds;

  // A lower machine-flow dialog ends while another flow remains on top.
  await ready();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.locator('input.toolSearch').click();
  await ctl({ op: 'status_delta', data: { tool_change_requested: true, tool_change_tool: 5 } });
  await expect(page.getByRole('dialog', { name: 'Load Tool into Spindle' })).toBeVisible();
  await page.getByTitle('Shut Down LinuxCNC', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Shut Down LinuxCNC?', exact: true })).toBeVisible();
  result.beforeLowerFlowEnds = await snapshot();
  await ctl({ op: 'status_delta', data: { tool_change_requested: false } });
  await expect(page.getByRole('dialog', { name: 'Load Tool into Spindle' })).toHaveCount(0);
  result.afterLowerFlowEnds = await snapshot();
  await page.keyboard.type('invisible edit');
  result.hiddenSearchText = await page.locator('input.toolSearch').inputValue();

  // Persisted shape written by pushMessage(kind, text, 'log'). A quiet
  // entry must not become an unread notification after reloading the page.
  await page.evaluate(() => localStorage.setItem('lcnc-messages', JSON.stringify([
    { id: 1, kind: 6, text: 'Saved A.ngc', ts: Date.now(), quiet: true },
  ])));
  await ready();
  result.quietAfterReload = {
    header: await page.locator('.hdrBtns button').first().getAttribute('title'),
    bannerActions: await page.locator('.bannerActions').textContent(),
    persisted: await page.evaluate(() => JSON.parse(localStorage.getItem('lcnc-messages'))),
  };

  // Gate change with a normal dialog waiting under a machine flow.
  await ready();
  await ctl({ op: 'raw', frame: { type: 'settings_init', settings: {} } });
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.locator('input.toolSearch').click();
  await ctl({ op: 'status_delta', data: { tool_change_requested: true, tool_change_tool: 5 } });
  const flow = page.getByRole('dialog', { name: 'Load Tool into Spindle' });
  await expect(flow).toBeVisible();
  await page.getByTitle('Settings', { exact: true }).click();
  await expect(page.getByText('Waiting for server settings…', { exact: true })).toHaveCount(0);
  await ctl({ op: 'status_delta', armed: false, data: {} });
  await expect(page.locator('.pill.disarmed')).toHaveCount(1);
  result.disarmedBeforeFlowEnds = await snapshot();
  await ctl({ op: 'status_delta', data: { tool_change_requested: false } });
  await expect(flow).toHaveCount(0);
  result.disarmedAfterFlowEnds = await snapshot();
  result.disarmedFallback = await page.evaluate(() => ({
    candidateDisabled: document.querySelector('[role=dialog] button.selected')?.matches(':disabled'),
    activeTag: document.activeElement?.tagName,
    modalCount: window.__modalRegistry.count(), modalOpen: window.__modalRegistry.open(),
  }));
  await page.waitForTimeout(2200); // beyond the focus-return backstop
  result.disarmedAfterBackstop = await snapshot();
  await page.screenshot({ path: out + '-disarmed.png' });
  await ctl({ op: 'clearCmds' });
  await page.keyboard.press('Space');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Backspace');
  await settle();
  result.disarmedKeyCommands = (await ctl({ op: 'lastCmds' })).cmds;
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await ctl({ op: 'lastCmds' })).cmds.map(c => c.cmd)).toContain('estop');
  result.disarmedWithEscapeCommands = (await ctl({ op: 'lastCmds' })).cmds;

} finally {
  await writeFile(out + '.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

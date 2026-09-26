// Independent review round 5, WP-D3–D6, 2026-09-26.
// Build the frontend, then start an ISOLATED mock in lcnc-webui:
//   MOCK_HOST=127.0.0.1 MOCK_PORT=4188 node e2e/mock-gateway.mjs
// From the repository root:
//   node docs/reviews/ui-design-welle.implementation-r5.probe.mjs
// Adapted from the unchanged R4 evidence: Run-from-line may close, macro title follows its revision.
// Retest records + assertions; new output prefix preserves the R4 artifacts. No live LinuxCNC.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../lcnc-webui/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const WebSocket = require('ws');
const origin = 'http://127.0.0.1:4188';
const out = fileURLToPath(new URL('./ui-design-welle.implementation-r5', import.meta.url));
const perms = { idle: true, jog: true, override: true, ready: true, run: true,
  pause: false, resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true, touchoff: true,
  touchoffRotary: true, twpCapture: true, surfaceComp: true, safety: true,
  setup: true, armed: true, always: true };
const keyboard = { jogEnabled: true, buttonsEnabled: true, mapping: {
  'jog_x+': 'ArrowRight', 'jog_x-': 'ArrowLeft', 'jog_y+': 'ArrowUp',
  'jog_y-': 'ArrowDown', 'jog_z+': 'Home', 'jog_z-': 'End',
  estop: 'Escape', cycle: ' ', abort: 'Backspace' } };
const macro = { id: 'review-param', name: 'Review Move', command: 'G0 Z{depth} F{feed}',
  params: [{ name: 'depth', label: 'Depth', default: '5' },
    { name: 'feed', label: 'Feed', default: '100' }] };
const programA = '(revision A)\nG0 X0\nG1 X10 F100\nG1 Y10\nM2\n';
const programB = '(revision B)\nG0 X20\nG1 X30 F100\nG1 Y10\nM2\n';
let program = programA;
let version = 900;
let blockNextGcode = false;
let releaseGcode = null;

function ctl(msg) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${origin.replace('http:', 'ws:')}/ctl`);
    const timer = setTimeout(() => { ws.terminate(); reject(Error('ctl timeout')); }, 5000);
    ws.on('open', () => ws.send(JSON.stringify(msg)));
    ws.on('message', data => { clearTimeout(timer); ws.close(); resolve(JSON.parse(data)); });
    ws.on('error', reject);
  });
}
const sent = async () => (await ctl({ op: 'lastCmds' })).cmds;
const motion = async () => (await sent()).filter(c =>
  ['cycle_start', 'cycle_resume', 'auto_step', 'auto_run', 'mdi', 'jog_cont', 'jog_stop'].includes(c.cmd));
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname === '/gcode') {
    const body = program;
    if (blockNextGcode) {
      blockNextGcode = false;
      await new Promise(resolve => { releaseGcode = resolve; });
    }
    return route.fulfill({ contentType: 'text/plain', body });
  }
  return route.continue();
});
const page = await context.newPage();
page.setDefaultTimeout(5000);
const result = { head: '84a1cc5', origin, programHolds: [], errors: [] };
page.on('pageerror', e => result.errors.push(String(e)));

async function ready(settings = {}) {
  program = programA;
  await ctl({ op: 'reset' });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(origin);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({ op: 'status_delta', data: { active_file: '/A.ngc', permissions: perms } });
  await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { keyboard, ...settings } } });
  await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: ++version, file: '/A.ngc' } });
  await expect(page.locator('.codeLine').first()).toContainText('(revision A)');
  await page.evaluate(() => document.fonts.ready);
  await ctl({ op: 'clearCmds' });
}
async function beginHold(target) {
  const b = await target.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(target).toHaveClass(/holding/);
  return page.evaluate(() => performance.now());
}
async function finishHold() {
  await page.waitForTimeout(650);
  await page.mouse.up();
  await page.waitForTimeout(100);
}
async function hint() { return page.locator('[data-btn-hint]').allTextContents(); }

try {
  // The program's path is constant, but its published revision and text change.
  // Record text arrival before expiry and whether the hold was cancelled.
  for (const action of ['Start', 'Step', 'Resume', 'Run from Line 3']) {
    const rfl = action.startsWith('Run from');
    await ready(rfl ? { machine: { runFromLine: true, rflSpindleDir: 'off' } } : {});
    if (action === 'Resume') {
      await ctl({ op: 'status_delta', data: { paused: true,
        permissions: { ...perms, run: false, resume: true } } });
    }
    if (rfl) {
      await page.locator('.codeLine').nth(2).click();
      await page.getByRole('button', { name: 'Start L3', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Run from Line 3', exact: true })).toBeVisible();
    }
    const target = page.getByRole('button', { name: action, exact: true });
    const started = await beginHold(target);
    await page.waitForTimeout(100);
    program = programB;
    await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: ++version, file: '/A.ngc' } });
    await expect(page.locator('.codeLine').first()).toContainText('(revision B)');
    const atChange = await target.count()
      ? await target.evaluate((el, start) => ({ elapsedMs: performance.now() - start, targetGone: false,
          holding: el.classList.contains('holding'), content: document.querySelector('.codeLine')?.textContent }), started)
      : await page.evaluate(start => ({ elapsedMs: performance.now() - start, targetGone: true,
          holding: false, content: document.querySelector('.codeLine')?.textContent }), started);
    if (atChange.elapsedMs >= 450) throw Error(`${action}: change arrived too late for a valid mid-hold probe`);
    await finishHold();
    result.programHolds.push({ action, file: '/A.ngc', version, atChange, commands: await motion(), hint: await hint() });
  }

  // Arrival AND text landing must cancel: Resume stays available while
  // loading, but a hold started in that window cannot outlive the text change.
  await ready();
  await ctl({ op: 'status_delta', data: { paused: true,
    permissions: { ...perms, run: false, resume: true } } });
  blockNextGcode = true;
  program = programB;
  await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: ++version, file: '/A.ngc' } });
  await expect.poll(() => releaseGcode !== null).toBe(true);
  const resume = page.getByRole('button', { name: 'Resume', exact: true });
  const loading = {
    startDisabled: await page.getByRole('button', { name: 'Start', exact: true }).isDisabled(),
    stepDisabled: await page.getByRole('button', { name: 'Step', exact: true }).isDisabled(),
    resumeDisabled: await resume.isDisabled(),
    content: await page.locator('.codeLine').first().textContent(),
  };
  const loadingStart = await beginHold(resume);
  await page.waitForTimeout(100);
  releaseGcode();
  releaseGcode = null;
  await expect(page.locator('.codeLine').first()).toContainText('(revision B)');
  const landing = await resume.evaluate((el, start) => ({ elapsedMs: performance.now() - start,
    holding: el.classList.contains('holding') }), loadingStart);
  if (landing.elapsedMs >= 450) throw Error('Resume text landing arrived too late');
  await finishHold();
  result.resumeWhileLoading = { loading, landing, commands: await motion(), hint: await hint() };
  await beginHold(resume);
  await finishHold();
  result.resumeWhileLoading.afterNewHold = await motion();

  // Control: changing the path IS detected by the present holdKey.
  await ready();
  const start = page.getByRole('button', { name: 'Start', exact: true });
  await beginHold(start);
  await page.waitForTimeout(100);
  await ctl({ op: 'status_delta', data: { active_file: '/B.ngc' } });
  await finishHold();
  result.changedPathControl = { commands: await motion(), hint: await hint() };

  // A macro dialog must follow its live revision; a server revision must invalidate
  // an Execute hold just as it invalidates a parameterless macro's bar hold.
  await ready({ macros: { macros: [macro] } });
  await page.locator('.macroBar').getByRole('button', { name: macro.name, exact: true }).click();
  const dialog = page.getByRole('dialog');
  const execute = dialog.getByRole('button', { name: 'Execute', exact: true });
  const started = await beginHold(execute);
  await page.waitForTimeout(100);
  const nextMacro = { ...macro, name: 'Review Move Revised', command: 'G0 Z-{depth} F{feed}' };
  await ctl({ op: 'raw', frame: { type: 'settings_changed', settings: { keyboard, macros: { macros: [nextMacro] } } } });
  await expect(page.locator('.macroBar').getByRole('button', { name: nextMacro.name, exact: true })).toBeVisible();
  const macroChange = await execute.evaluate((el, start) => ({ elapsedMs: performance.now() - start,
    holding: el.classList.contains('holding'), preview: document.querySelector('.macroPreview')?.textContent }), started);
  if (macroChange.elapsedMs >= 450) throw Error('macro: change arrived too late');
  await finishHold();
  result.macroRevision = { atChange: macroChange, commands: await motion(), hint: await hint(),
    liveTitle: await dialog.getAttribute('aria-labelledby').then(async id => page.locator(`[id="${id}"]`).textContent()) };
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.macroBar').getByRole('button', { name: nextMacro.name, exact: true }).click();
  result.macroRevision.reopenedPreview = await page.locator('.macroPreview').textContent();

  // Compare the running-jog stop contract for a main tab and a procedure tab.
  result.jogTabSwitch = [];
  for (const which of ['procedure', 'main']) {
    await ready();
    await page.getByRole('tab', { name: 'Probing', exact: true }).click();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.down('ArrowRight');
    await expect.poll(async () => (await motion()).some(c => c.cmd === 'jog_cont')).toBe(true);
    await page.getByRole('tab', { name: which === 'procedure' ? 'Inside' : 'Tools', exact: true }).click();
    await page.waitForTimeout(150);
    const beforeRelease = await motion();
    await page.keyboard.up('ArrowRight');
    await page.waitForTimeout(100);
    result.jogTabSwitch.push({ which, beforeRelease, afterRelease: await motion() });
  }

  // Navigation keys with a modifier still belong to the focused tab,
  // never to the machine's global jog map.
  await ready();
  const tab = page.getByRole('tab', { name: 'Program', exact: true });
  result.modifiedTabKeys = [];
  for (const key of ['ArrowRight', 'Control+ArrowRight', 'Alt+ArrowRight', 'Meta+ArrowRight']) {
    await tab.focus();
    await ctl({ op: 'clearCmds' });
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
    result.modifiedTabKeys.push({ key, commands: await motion(),
      focus: await page.evaluate(() => document.activeElement?.textContent?.trim()) });
  }

  // The new run-dialog radios and the Settings defaults must be distinct
  // native radio groups even while both dialogs are mounted.
  await ready({ machine: { runFromLine: true, rflSpindleDir: 'forward' } });
  await page.locator('.codeLine').nth(2).click();
  await page.getByRole('button', { name: 'Start L3', exact: true }).click();
  const runDialog = page.getByRole('dialog', { name: 'Run from Line 3', exact: true });
  await runDialog.getByRole('radio', { name: 'Rev', exact: true }).check();
  const checked = () => runDialog.locator('input[type=radio]').evaluateAll(els =>
    els.map(el => ({ value: el.value, checked: el.checked, name: el.name })));
  result.spindleRadioGroups = { beforeSettings: await checked() };
  await page.getByTitle('Settings', { exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
  result.spindleRadioGroups.duringSettings = await checked();
  await page.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0);
  result.spindleRadioGroups.afterSettings = await checked();
  await page.screenshot({ path: `${out}-spindle-radios.png` });
  await ctl({ op: 'clearCmds' });
  await beginHold(runDialog.getByRole('button', { name: 'Run from Line 3', exact: true }));
  await finishHold();
  result.spindleRadioGroups.commands = await motion();

  // Actual narrow pane, with the new search row and populated table.
  await ready();
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.evaluate(() => { document.documentElement.classList.add('touch-device'); document.documentElement.style.zoom = '1.5'; });
  await expect(page.getByRole('combobox', { name: 'Side panel', exact: true })).toBeVisible();
  result.narrowProgram = await page.evaluate(() => {
    const bounds = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height,
      clientHeight: el.clientHeight, scrollHeight: el.scrollHeight }; };
    return Object.fromEntries(['.sidePane', '.sidePane .panelHead', '.codeArea', '.codeViewer']
      .map(s => [s, bounds(document.querySelector(s))]));
  });
  result.narrowVisibleCodeLines = await page.locator('.codeArea .codeViewer').evaluate(viewer => {
    const pane = document.querySelector('.sidePane').getBoundingClientRect();
    const v = viewer.getBoundingClientRect();
    return [...viewer.querySelectorAll('.codeLine')].map(el => {
      const r = el.getBoundingClientRect();
      const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { text: el.textContent, top: r.top, bottom: r.bottom,
        whole: r.top >= Math.max(v.top, pane.top) && r.bottom <= Math.min(v.bottom, pane.bottom),
        hit: !!at && el.contains(at) };
    });
  });
  await page.waitForTimeout(750); // let the status banner's text transition finish
  await page.screenshot({ path: `${out}-narrow-program.png` });
  // Check the new folded management and the reported scrolling tradeoff.
  const more = page.getByRole('button', { name: 'More program actions', exact: true });
  result.narrowProgramFold = { expandedBefore: await more.getAttribute('aria-expanded') };
  await more.click();
  const hitInfo = loc => loc.evaluate(el => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const target = el.closest('.btnTip') ?? el.closest('label') ?? el;
    return { x: r.x, y: r.y, width: r.width, height: r.height,
      hit: !!at && target.contains(at), hitText: at?.textContent?.trim().slice(0, 80) };
  });
  result.narrowProgramFold.expandedAfter = await more.getAttribute('aria-expanded');
  result.narrowProgramFold.controls = [];
  for (const name of ['Edit', 'Reload', 'Unload', 'Files', 'Upload', 'Abort']) {
    const b = page.locator('.sidePane').getByRole('button', { name, exact: true });
    await b.scrollIntoViewIfNeeded();
    result.narrowProgramFold.controls.push({ name, ...await hitInfo(b) });
  }
  for (const state of ['idle', 'running', 'paused']) {
    await ctl({ op: 'status_delta', data: { paused: state === 'paused',
      interp_state: state === 'running' ? 2 : state === 'paused' ? 3 : 1,
      permissions: { ...perms, idle: state === 'idle', run: state === 'idle',
        pause: state === 'running', resume: state === 'paused' } } });
    await page.waitForTimeout(150);
    await page.locator('.codeArea').evaluate(el => el.scrollIntoView({ block: 'end' }));
    result.narrowProgramFold[state] = {
      panelAbort: await hitInfo(page.locator('.sidePane').getByRole('button', { name: 'Abort', exact: true })),
      bannerAbort: await page.locator('.bannerActions').getByRole('button', { name: 'Abort', exact: true }).count()
        ? await hitInfo(page.locator('.bannerActions').getByRole('button', { name: 'Abort', exact: true })) : null,
      codeHeight: await page.locator('.codeArea .codeViewer').evaluate(el => el.clientHeight),
    };
  }
  await page.waitForTimeout(750);
  await page.screenshot({ path: `${out}-narrow-program-expanded.png` });
  await ctl({ op: 'status_delta', data: { paused: false, interp_state: 1, permissions: perms } });
  await page.waitForTimeout(750);
  await page.getByRole('combobox', { name: 'Side panel', exact: true }).selectOption('tools');
  await expect.poll(async () => {
    await ctl({ op: 'raw', frame: { type: 'reply', cmd: 'get_tool_table', ok: true,
      tools: [{ T: 5, P: 5, Z: -40.123456, D: 6, type: 'endmill', description: 'Test cutter' }] } });
    return page.getByRole('button', { name: 'Edit T5', exact: true }).count();
  }).toBe(1);
  result.narrowTools = await page.evaluate(() => {
    const bounds = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height,
      clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }; };
    return Object.fromEntries(['.sidePane', '.toolSearchRow', '.toolSearch', '.toolsTab .tableWrap', '.toolsTab .tableWrap table',
      '.toolsTab .tableWrap thead', '.toolsTab .tableWrap th.colDesc']
      .map(s => [s, bounds(document.querySelector(s))]));
  });
  await page.screenshot({ path: `${out}-narrow-tools.png` });
  const loadTool = page.locator('.toolsTab').getByRole('button', { name: 'T5', exact: true });
  await loadTool.evaluate(el => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  await page.waitForTimeout(100);
  result.narrowToolsAfterScroll = await loadTool.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { x: r.x, y: r.y, width: r.width, height: r.height, hit: el.contains(hit),
      hitTag: hit?.tagName, hitText: hit?.textContent?.trim().slice(0, 80),
      headerHeight: document.querySelector('.toolsTab thead').getBoundingClientRect().height,
      tableHeight: document.querySelector('.toolsTab .tableWrap').getBoundingClientRect().height };
  });
  await page.screenshot({ path: `${out}-narrow-tools-scrolled.png` });

  // Assertions on the original failing sequences. Layout details and the
  // unfolded-state tradeoff remain explicit measurements for human review.
  expect(result.programHolds.every(r => r.commands.length === 0 && !r.atChange.holding)).toBe(true);
  expect(result.programHolds.find(r => r.action === 'Run from Line 3').atChange.targetGone).toBe(true);
  expect(result.changedPathControl.commands).toEqual([]);
  expect(result.resumeWhileLoading.commands).toEqual([]);
  expect(result.resumeWhileLoading.afterNewHold.map(c => c.cmd)).toEqual(['cycle_resume']);
  expect(result.resumeWhileLoading.loading.stepDisabled).toBe(true);
  expect(result.macroRevision.commands).toEqual([]);
  expect(result.macroRevision.atChange.preview).toBe('G0 Z-5 F100');
  expect(result.modifiedTabKeys.every(r => r.commands.length === 0)).toBe(true);
  expect(result.jogTabSwitch.every(r => r.beforeRelease.some(c => c.cmd === 'jog_stop'))).toBe(true);
  expect(result.spindleRadioGroups.afterSettings.find(r => r.value === 'reverse').checked).toBe(true);
  expect(result.narrowProgram['.codeViewer'].clientHeight).toBeGreaterThanOrEqual(96);
  expect(result.narrowVisibleCodeLines.filter(r => r.whole && r.hit).length).toBeGreaterThanOrEqual(3);
  expect(result.narrowTools['.toolsTab .tableWrap thead'].height).toBeLessThan(100);
  expect(result.narrowProgramFold.controls.every(r => r.hit)).toBe(true);
  expect(result.errors).toEqual([]);
  result.assertionsPassed = true;
} catch (e) {
  result.failure = String(e);
  process.exitCode = 1;
} finally {
  await writeFile(`${out}.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

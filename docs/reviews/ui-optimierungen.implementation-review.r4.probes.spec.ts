// Independent fourth-audit additions, feat/ui-review-wave at 9b368f7.
// Copy beside e2e/ctl.ts AFTER the full offline suite; built UI + local mock.
// npx playwright test audit-r4.probes.spec.ts --project=chromium --no-deps --workers=1 --reporter=list
// Earlier round-1/2/3 probes are rerun unchanged (except the obsolete r2
// focus-gap test, replaced in r3). These additions check the new branches.
import { test, expect, type Page, type Locator } from '@playwright/test';
import { ctl, MOCK } from './ctl';

const ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true, touchoff: true,
  touchoffRotary: true, twpCapture: true, surfaceComp: true, safety: true,
  setup: true, armed: true, always: true,
};
async function open(page: Page) {
  await ctl({ op: 'reset' });
  await page.goto(MOCK);
  await expect(page.locator('input.setupInput').first()).toBeVisible();
  await ctl({ op: 'quiet', on: true });
  await ctl({ op: 'status_delta', data: { active_file: '/A.ngc', permissions: ALL } });
  await ctl({ op: 'clearCmds' });
}
async function cmds() { return (await ctl({ op: 'lastCmds' })).cmds ?? []; }
// Startup may still request the tool table after clearCmds; that is a read.
async function actions() { return (await cmds()).filter((c: { cmd: string }) => c.cmd !== 'get_tool_table'); }
async function tabTo(page: Page, target: Locator) {
  for (let n = 0; n < 60; n++) {
    if (await target.evaluate(el => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
async function centerHits(target: Locator) {
  return target.evaluate(el => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return (hit === el || el.contains(hit)) && r.top >= 0 && r.bottom <= innerHeight;
  });
}
test.afterEach(async () => {
  await ctl({ op: 'quiet', on: false });
  await ctl({ op: 'reset' });
});

test('native Space on tab-focused numeric Cancel discards without any command', async ({ page }) => {
  await open(page);
  const x = page.locator('input.setupInput').first();
  await x.click();
  await page.keyboard.type('17');
  const nk = page.locator('.nkStrip');
  const cancel = nk.getByRole('button', { name: 'Cancel', exact: true });
  await tabTo(page, cancel);
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Space');
  await expect(nk).toHaveCount(0);
  await expect(x).toBeFocused();
  await x.click();
  await expect(nk.locator('[data-draft]')).toHaveCount(0);
  expect(await actions()).toEqual([]);
  console.log('NUMERIC_CANCEL_SPACE', JSON.stringify({ draft: false, commands: await cmds() }));
});

for (const key of ['Enter', 'Space']) {
test(`${key} on text Close returns focus; the next Space must not start a program`, async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'MDI', exact: true }).click();
  const mdi = page.locator('.mdiInput');
  const tk = page.locator('.tkStrip');
  await mdi.click();
  await expect(mdi).toBeFocused();
  await tk.getByRole('button', { name: 'G', exact: true }).click();
  await tk.getByRole('button', { name: '1', exact: true }).click();
  await expect(mdi).toHaveValue('G1');
    await expect(tk).toBeVisible();
    const close = tk.getByRole('button', { name: 'Close keyboard', exact: true });
    // Start within the helper, then traverse its real Tab order. Tab out of
    // the MDI field itself intentionally hides it (covered by older probes).
    await tk.locator('button').first().focus();
    await tabTo(page, close);
    await expect(close).toBeFocused();
    await page.keyboard.press(key);
    await expect(tk).toHaveCount(0);
    await expect(mdi).toHaveValue('G1');
    // Observe where the real native activation leaves focus. Do not blur or
    // manipulate the guard. Then continue typing with one trusted Space.
    await page.waitForTimeout(50);
    const afterClose = await page.evaluate(() => ({
      body: document.activeElement === document.body,
      active: document.activeElement?.outerHTML.slice(0, 160),
      guard: (window as any).__modalRegistry?.open(),
    }));
    const beforeSpace = await actions();
    await page.keyboard.press('Space');
    await page.waitForTimeout(50);
    const afterSpace = await actions();
    console.log('TEXT_CLOSE_NEXT_SPACE', JSON.stringify({ key, afterClose, beforeSpace, afterSpace, value: await mdi.inputValue() }));
    expect(beforeSpace).toEqual([]);
    expect(afterSpace, 'continuing text entry after closing its helper must not operate the machine').toEqual([]);
    await expect(mdi).toBeFocused();
});
}

test('physical MDI typing retains characters with either helper state; plain search is a control', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).auditInputEvents = [];
    document.addEventListener('input', e => {
      const el = e.target as HTMLInputElement;
      if (el.matches?.('.mdiInput')) (window as any).auditInputEvents.push({
        value: el.value, trusted: e.isTrusted, inputType: (e as InputEvent).inputType,
      });
    }, true);
  });
  await open(page);
  await page.getByRole('button', { name: 'MDI', exact: true }).click();
  const mdi = page.locator('.mdiInput');
  await mdi.click();
  await expect(mdi).toBeFocused();
  const seen = [];
  const finalValues = [];
  for (const helperOpen of [true, false]) {
    if (!helperOpen) await page.locator('.tkStrip').getByRole('button', { name: 'Close keyboard', exact: true }).click();
    await expect(mdi).toBeFocused();
    await mdi.selectText();
    for (const key of ['G', '1', ' ', 'X', '7']) {
      await page.keyboard.type(key);
      await page.waitForTimeout(20);
      seen.push({ helperOpen, ...await mdi.evaluate((el: HTMLInputElement) => ({ value: el.value,
        focused: document.activeElement === el, disabled: el.disabled, readonly: el.readOnly })) });
    }
    finalValues.push(await mdi.inputValue());
  }
  await page.getByTitle('G-code Reference', { exact: true }).click();
  const search = page.locator('.refSearch');
  await search.click();
  await page.keyboard.type('g1');
  await expect(search).toHaveValue('g1');
  console.log('PHYSICAL_MDI_ENTRY', JSON.stringify({ seen, finalValues,
    events: await page.evaluate(() => (window as any).auditInputEvents),
    searchValue: await search.inputValue(), commands: await cmds() }));
  expect(finalValues).toEqual(['G1 X7', 'G1 X7']);
  expect(await actions()).toEqual([]);
});

test.describe('portrait fold and readout', () => {
  test.use({ hasTouch: true, viewport: { width: 900, height: 1200 } });
  test('150 percent editor is usable; external run/pause brings back controls and retains the draft', async ({ page }, info) => {
    await page.route('**/gcode?*', route => route.fulfill({ contentType: 'text/plain', body: 'G0 X0\nM2\n' }));
    await open(page);
    await page.evaluate(() => { document.documentElement.style.zoom = '1.5'; });
    await page.locator('header.hdr').tap({ position: { x: 10, y: 10 } });
    await expect(page.locator('html')).toHaveClass(/touch-device/);
    await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: 7, file: '/A.ngc' } });
    await expect(page.locator('.codeLine').first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).tap();
    const content = page.locator('.cm-content');
    const tk = page.locator('.tkStrip');
    const panel = page.locator('.container').filter({ has: page.locator('.editorHost') });
    await expect(content).toBeVisible();
    await tk.getByRole('button', { name: ';', exact: true }).tap();
    await expect(content).toContainText(';');
    const draft = await content.innerText();
    const lines = await page.evaluate(() => document.querySelector('.cm-scroller')!.getBoundingClientRect().height / document.querySelector('.cm-line')!.getBoundingClientRect().height);
    expect(lines).toBeGreaterThanOrEqual(3);
    for (const target of [page.locator('.cm-line').first(), page.locator('.editActions button').first(), page.locator('.editActions button').last()]) {
      expect(await centerHits(target)).toBe(true);
    }
    console.log('PORTRAIT_EDITOR_R4', JSON.stringify({ lines, firstLineAndActionsHit: true }));
    const screenshot = info.outputPath('editor-150.png');
    await page.screenshot({ path: screenshot });
    await info.attach('editor-150', { path: screenshot, contentType: 'image/png' });
    await expect(panel.locator('.ctrlBtn')).toHaveCount(0);
    for (const paused of [false, true]) {
      // Emulate another operator's machine state, never issue a run command.
      await ctl({ op: 'status_delta', data: { interp_state: paused ? 3 : 2, paused,
        permissions: { ...ALL, idle: false, ready: false, run: false, setup: false,
          pause: !paused, resume: paused } } });
      const abort = panel.getByRole('button', { name: 'Abort', exact: true });
      const pauseResume = panel.locator('.ctrlBtn').filter({ hasText: 'Pause' });
      await expect(abort).toBeEnabled();
      await expect(pauseResume).toBeEnabled();
      expect(await centerHits(abort)).toBe(true);
      expect(await centerHits(pauseResume)).toBe(true);
      await expect(content).toHaveText(draft, { useInnerText: true });
      console.log('PORTRAIT_RUNNING_CONTROLS', JSON.stringify({ paused, abortAndPauseResumeHit: true }));
    }
    await ctl({ op: 'status_delta', data: { interp_state: 1, paused: false, permissions: ALL } });
    await expect(panel.locator('.ctrlBtn')).toHaveCount(0);
    await expect(content).toHaveText(draft, { useInnerText: true });
    expect(await centerHits(page.locator('.cm-line').first())).toBe(true);
    expect(await actions()).toEqual([]);
  });
});

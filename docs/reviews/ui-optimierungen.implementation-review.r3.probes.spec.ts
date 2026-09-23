// Independent third-audit probes, feat/ui-review-wave at 17ec849.
// Copy beside e2e/ctl.ts after the regular offline suite has finished.
// npx playwright test audit-r3.probes.spec.ts --project=chromium --no-deps --workers=1
// Built application + local mock only. DOM instrumentation OBSERVES events;
// it does not change application state, handlers, gates or focus timing.
import { test, expect, type Page } from '@playwright/test';
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
async function commands() {
  return ((await ctl({ op: 'lastCmds' })).cmds ?? []) as { cmd: string }[];
}
test.afterEach(async () => {
  await ctl({ op: 'quiet', on: false });
  await ctl({ op: 'reset' });
});

for (let attempt = 1; attempt <= 3; attempt++) {
  test(`focus return ${attempt}: trusted Space/Backspace on body stay guarded; Escape works`, async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as any;
      w.auditKeys = [];
      window.addEventListener('keydown', e => {
        if (![' ', 'Backspace', 'Escape'].includes(e.key)) return;
        w.auditKeys.push({ key: e.key, trusted: e.isTrusted,
          body: document.activeElement === document.body,
          guard: w.__modalRegistry?.open(),
          disabled: document.querySelector<HTMLInputElement>('input.setupInput')?.disabled });
      }, true);
    });
    await open(page);
    const x = page.locator('input.setupInput').first();
    await x.click();
    await page.keyboard.type('17');
    await page.keyboard.press('Enter');
    const started = Date.now();
    while (Date.now() - started < 500) {
      await page.keyboard.press('Space');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(8);
    }
    const observations = await page.evaluate(() => (window as any).auditKeys);
    console.log('BODY_KEY_OBSERVATIONS', JSON.stringify(observations));
    const bodyKeys = observations.filter((s: any) => s.body);
    expect(bodyKeys.length, 'must actually exercise the body-focus interval').toBeGreaterThan(0);
    expect(bodyKeys.every((s: any) => s.trusted && s.guard)).toBe(true);
    let sent = await commands();
    expect(sent.filter(c => c.cmd === 'touchoff')).toHaveLength(1);
    expect(sent.filter(c => ['cycle_start', 'abort', 'jog_cont', 'jog_incr'].includes(c.cmd))).toEqual([]);
    // Space can reopen the helper once focus has correctly returned to X.
    if (await page.locator('.nkStrip').count()) {
      await page.locator('.nkStrip').getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    await expect(x).toBeFocused();
    await x.click();
    await page.keyboard.type('18');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await commands()).map(c => c.cmd)).toContain('estop');
    await expect(x).toBeFocused();
    sent = await commands();
    expect(sent.filter(c => c.cmd === 'estop')).toHaveLength(1);
    expect(sent.filter(c => ['cycle_start', 'estop_reset'].includes(c.cmd))).toEqual([]);
    // A completed return must release the guard: explicit body focus is the
    // existing operating position, not a permanently disabled shortcut map.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press('Space');
    await expect.poll(async () => (await commands()).map(c => c.cmd)).toContain('cycle_start');
  });
}

test('a different field chosen during focus return keeps its focus and text session', async ({ page }) => {
  await open(page);
  // Search is writable during the numeric command's busy latch, unlike MDI.
  await page.getByTitle('G-code Reference', { exact: true }).click();
  const search = page.locator('.dialogOverlay input.inputField').first();
  const x = page.locator('input.setupInput').first();
  await x.click();
  await page.keyboard.type('17');
  await page.keyboard.press('Enter');
  await expect(x).toBeDisabled();
  await search.click();
  await expect(page.locator('.tkStrip')).toBeVisible();
  await page.waitForTimeout(400);
  await expect(search).toBeFocused();
  await page.locator('.tkStrip').getByRole('button', { name: 'g', exact: true }).click();
  await expect(search).toHaveValue('g');
  expect((await commands()).filter(c => ['cycle_start', 'mdi'].includes(c.cmd))).toEqual([]);
});

test('an offset cell that cannot hold focus falls back to the strip, never body', async ({ page }) => {
  await open(page);
  await ctl({ op: 'setAxes', axes: ['X', 'Y', 'Z'] });
  await page.getByRole('button', { name: 'Offsets', exact: true }).click();
  await page.locator('.offsetPanel td.editableCell').first().click();
  await page.keyboard.type('17');
  await page.keyboard.press('Enter');
  await expect(page.locator('.nkStrip')).toHaveCount(0);
  await expect(page.locator('.strip')).toBeFocused();
  await page.waitForTimeout(250);
  await page.keyboard.press('Space');
  const sent = await commands();
  expect(sent.filter(c => c.cmd === 'set_wcs')).toHaveLength(1);
  expect(sent.filter(c => c.cmd === 'cycle_start')).toEqual([]);
});

test('a real backend gate closure during the busy latch ends parked drafts', async ({ page }) => {
  await open(page);
  const x = page.locator('input.setupInput').nth(0);
  const y = page.locator('input.setupInput').nth(1);
  await x.click();
  await page.keyboard.type('17');
  await y.click();
  await page.keyboard.type('5');
  const started = Date.now();
  await page.keyboard.press('Enter');
  // Unlike a purely client-local busy latch, these are actual backend
  // permission changes. They must not disappear behind its display reason.
  await ctl({ op: 'status_delta', data: { permissions: { ...ALL, touchoff: false } } });
  await page.waitForTimeout(40);
  await ctl({ op: 'status_delta', data: { permissions: ALL } });
  const elapsed = Date.now() - started;
  expect(elapsed, 'the real gate close/reopen must occur within the 200 ms latch').toBeLessThan(180);
  await expect(y).toBeFocused();
  await x.click();
  const returned = await page.locator('.nkExpr').innerText();
  const drafts = await page.locator('.nkStrip [data-draft]').count();
  console.log('BACKEND_GATE_DURING_BUSY', JSON.stringify({ elapsed, returned, drafts }));
  await expect(page.locator('.nkStrip [data-draft]')).toHaveCount(0);
});

test.describe('portrait readout and real touch', () => {
  test.use({ hasTouch: true, viewport: { width: 900, height: 1200 } });
  for (const owner of ['MDI', 'editor', 'search'] as const) {
    test(`${owner}: readout and every keyboard page remain usable at 150 percent`, async ({ page }, info) => {
      await page.route('**/gcode?*', route => route.fulfill({ contentType: 'text/plain', body: 'G0 X0\nM2\n' }));
      await open(page);
      await page.evaluate(() => { document.documentElement.style.zoom = '1.5'; });
      // Establish touch sizing before targeting controls that change size
      // on the very first pointerdown (touchDetect.ts).
      await page.locator('header.hdr').tap({ position: { x: 10, y: 10 } });
      await expect(page.locator('html')).toHaveClass(/touch-device/);
      let target;
      if (owner === 'MDI') {
        await page.getByRole('button', { name: 'MDI', exact: true }).tap();
        target = page.locator('.mdiInput');
        await target.tap();
      } else if (owner === 'editor') {
        await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: 7, file: '/A.ngc' } });
        await expect(page.locator('.codeLine').first()).toBeVisible();
        await page.getByRole('button', { name: 'Edit', exact: true }).tap();
        await expect(page.locator('.cm-content')).toBeVisible();
        target = page.locator('.cm-line').first();
      } else {
        await page.getByTitle('G-code Reference', { exact: true }).tap();
        target = page.locator('.dialogOverlay input.inputField').first();
        await target.tap();
      }
      const tk = page.locator('.tkStrip');
      await expect(tk).toBeVisible();
      await expect(target).toBeInViewport({ ratio: 1 });
      for (const pageName of ['Code keys', 'ABC keys', '123 keys', '#+= keys']) {
        await tk.getByRole('button', { name: pageName, exact: true }).tap();
        const geometry = await tk.evaluate(el => {
          const r = el.getBoundingClientRect();
          const strip = el.closest('.strip')!;
          const misses = [...el.querySelectorAll('button')].filter(button => {
            const b = button.getBoundingClientRect();
            return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('button') !== button;
          }).map(button => button.getAttribute('aria-label') || button.textContent);
          return { top: r.top, bottom: r.bottom, height: innerHeight,
            scroll: strip.scrollHeight - strip.clientHeight, misses };
        });
        console.log('PORTRAIT_OWNER_PAGE', JSON.stringify({ owner, pageName, ...geometry }));
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1);
        expect(geometry.scroll).toBeLessThanOrEqual(1);
        expect(geometry.misses).toEqual([]);
      }
      // A viewport rectangle alone misses clipping by an ancestor; hit-test
      // the actual text line / original field as well.
      const readout = await target.evaluate(el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON();
        return { hit: hit === el || el.contains(hit), target: r.toJSON(),
          covering: hit?.outerHTML.slice(0, 200), host: rect('.editorHost'),
          scroller: rect('.cm-scroller'), cursor: rect('.cm-cursor'), actions: rect('.editActions') };
      });
      console.log('PORTRAIT_READOUT', JSON.stringify({ owner, ...readout }));
      expect(readout.hit, 'the original field/text must not be covered or clipped').toBe(true);
      await tk.getByRole('button', { name: 'Code keys', exact: true }).tap();
      await tk.getByRole('button', { name: ';', exact: true }).tap();
      if (owner === 'editor') await expect(page.locator('.cm-content')).toContainText(';');
      else await expect(target).toHaveValue(';');
      await info.attach(`${owner}-150`, { body: await page.screenshot(), contentType: 'image/png' });
      expect((await commands()).filter(c => ['cycle_start', 'mdi', 'touchoff', 'set_wcs'].includes(c.cmd))).toEqual([]);
    });
  }
});

import { test, expect } from '@playwright/test';
import { ctl } from './ctl';
import { measureLayout, assertLayout, layoutChanges, measureFrame, frameChanges, type LayoutSnapshot } from './layout-audit';
import { PROFILES, VIEWPORTS, PANELS, openLayout, setLayoutState, settleLayout, type LayoutState,
  STRIP_STATES, enterStripState, leaveStripState, stripStateRefs, stripStateExempt } from './layout-fixtures';

test.afterEach(async () => { await ctl({ op: 'reset' }); });

for (const profile of PROFILES) {
  for (const viewport of VIEWPORTS) {
    test(`${profile.name} ${viewport.name}: control panels stay usable across machine states`, async ({ page }, info) => {
      await openLayout(page, profile, viewport);
      const baseline: Record<string, LayoutSnapshot> = {};
      const evidence: { state: string; panels: LayoutSnapshot[] }[] = [];
      const states: LayoutState[] = ['homed', 'unhomed', 'off', 'estop', 'disarmed', 'running', 'paused', 'homed'];
      if (profile.kins) states.push('tcp');
      if (profile.name === '6axis-twp') states.push('plane', 'plane-stale');
      try {
        for (const state of states) {
          await setLayoutState(page, profile, state);
          const panels: LayoutSnapshot[] = [];
          evidence.push({ state, panels });
          for (const [name, selector] of Object.entries(PANELS)) {
            const root = page.locator(selector);
            const snapshot = await measureLayout(root, name);
            panels.push(snapshot);
            // A kinematics mode adds a status label; the machine-state
            // transitions above must preserve control footprints exactly.
            const changes = baseline[name] && !['tcp', 'plane', 'plane-stale'].includes(state)
              ? layoutChanges(baseline[name], snapshot) : [];
            await assertLayout(root, snapshot, info, changes);
            baseline[name] ??= snapshot;
          }
        }
      } finally {
        await info.attach('layout-states.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
      }
    });
  }
}

test('layout guard detects the original shrinking disabled-button regression', async ({ page }) => {
  await openLayout(page, PROFILES[1], VIEWPORTS[0]);
  const root = page.locator('[data-strip="jog"]');
  const before = await measureLayout(root, 'jog');
  await setLayoutState(page, PROFILES[1], 'unhomed');
  await expect(root.locator('.jogBtn').first()).toHaveClass(/btnTip/);
  await settleLayout(page);
  expect(layoutChanges(before, await measureLayout(root, 'jog'))).toEqual([]);
  await page.addStyleTag({ content: '.btnTip > :disabled { flex: 0 1 auto !important; }' });
  const changes = layoutChanges(before, await measureLayout(root, 'jog'));
  expect(changes.some(issue => issue.kind === 'geometry-change' && issue.detail.includes('width'))).toBe(true);
});

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: program browser shows its root and uses the available panel`, async ({ page }, info) => {
    const ncDir = '/home/operator/linuxcnc/nc_files';
    const names = ['perfmatrix-big.ngc', 'twp_simple_example.ngc',
      ...Array.from({ length: 60 }, (_, i) => `program-${i}.ngc`)];
    await page.route('**/files*', route => {
      const subdir = new URL(route.request().url()).searchParams.get('subdir') ?? '';
      return route.fulfill({ json: { ok: true, nc_dir: ncDir, subdir,
        entries: subdir
          ? [{ name: 'tilted.ngc', type: 'file', path: `${ncDir}/twp/tilted.ngc`, size: 200 }]
          : [{ name: 'twp', type: 'directory', path: 'twp' },
            ...names.map(name => ({ name, type: 'file', path: `${ncDir}/${name}`, size: 4096 }))],
      } });
    });
    await openLayout(page, PROFILES[1], viewport);
    const panel = page.locator('.sidePane .container').filter({ has: page.locator('.codeArea') });
    const toolbar = panel.locator('.headerActions');
    const before = await measureLayout(toolbar, 'program-toolbar');
    await panel.getByRole('button', { name: 'Browse', exact: true }).click();
    const browser = panel.getByRole('region', { name: 'Server programs' });
    await expect(browser.locator('.browserPath')).toHaveText(ncDir);
    await expect(browser.getByText('perfmatrix-big.ngc', { exact: true })).toBeVisible();
    await expect(browser.getByText('twp_simple_example.ngc', { exact: true })).toBeVisible();
    await settleLayout(page);
    await assertLayout(toolbar, await measureLayout(toolbar, 'program-toolbar'), info,
      layoutChanges(before, await measureLayout(toolbar, 'program-toolbar')));
    const geometry = await panel.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      const browser = el.querySelector('.fileBrowser')!.getBoundingClientRect();
      const code = el.querySelector('.codeArea')!.getBoundingClientRect();
      const list = el.querySelector('.fileList')!;
      return { browserHeight: browser.height, codeHeight: code.height,
        bottom: browser.bottom, panelBottom: bounds.bottom, codeTop: code.top,
        scrolls: list.scrollHeight > list.clientHeight,
        overflowsX: list.scrollWidth > list.clientWidth + 1 };
    });
    // This fails with the old max-height:200px, even when all files are present.
    expect(geometry.browserHeight).toBeGreaterThan(geometry.codeHeight * 1.8);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.codeTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.panelBottom);
    expect(geometry.scrolls).toBe(true);
    expect(geometry.overflowsX).toBe(false);
    const last = browser.getByText(names.at(-1)!, { exact: true });
    await last.scrollIntoViewIfNeeded();
    expect(await last.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    await browser.getByText('twp', { exact: true }).click();
    await expect(browser.locator('.browserPath')).toHaveText(`${ncDir}/twp`);
    await browser.getByRole('button', { name: 'Parent folder' }).click();
    await expect(browser.locator('.browserPath')).toHaveText(ncDir);
    // With no loaded program, no empty code placeholder competes for space.
    await ctl({ op: 'status_delta', data: { active_file: null } });
    await expect(panel.locator('.codeArea')).toBeHidden();
    expect((await browser.boundingBox())!.height).toBeGreaterThan(geometry.browserHeight * 1.3);
    await panel.screenshot({ path: info.outputPath('program-browser.png') });
    await ctl({ op: 'clearCmds' });
    await browser.getByText('perfmatrix-big.ngc', { exact: true }).click();
    await expect(browser).toHaveCount(0);
    await expect.poll(async () => (await ctl({ op: 'lastCmds' })).cmds)
      .toContainEqual(expect.objectContaining({ cmd: 'load_file', path: `${ncDir}/perfmatrix-big.ngc` }));
    await expect(panel.locator('.codeArea')).toBeVisible();
  });

  test(`${viewport.name}: tools reuse the program file browser with a full tool table`, async ({ page }, info) => {
    const directory = '/home/operator/linuxcnc/nc_files';
    const entries = (extension: string) => Array.from({ length: 60 }, (_, i) => ({
      name: `example-${i}.${extension}`, type: 'file', path: `example-${i}.${extension}`, size: 4096,
    }));
    await page.route('**/files*', route => route.fulfill({ json: {
      ok: true, nc_dir: directory, subdir: '', entries: entries('ngc'),
    } }));
    await page.route('**/tool-library-files?*', route => route.fulfill({ json: {
      directory, subdir: '', entries: entries('json'),
    } }));
    await openLayout(page, PROFILES[1], viewport);
    await page.getByRole('button', { name: 'Browse', exact: true }).click();
    const program = page.getByRole('region', { name: 'Server programs' });
    await expect(program.getByRole('button', { name: 'example-0.ngc', exact: true })).toBeVisible();
    const fileStyle = (el: Element) => {
      const s = getComputedStyle(el);
      return { height: el.getBoundingClientRect().height, font: s.fontSize,
        padding: s.padding, border: s.borderWidth, radius: s.borderRadius, background: s.backgroundColor };
    };
    const programStyle = await program.locator('.fileItem').first().evaluate(fileStyle);
    await page.getByRole('button', { name: 'Hide Files', exact: true }).click();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    const tab = page.locator('.toolsTab');
    const table = tab.locator('.tableWrap');
    const tools = Array.from({ length: 36 }, (_, i) => ({ T: 1001 + i, P: 1001 + i, Z: 50, D: 6,
      type: 'endmill', description: `Example tool ${i}`, remark: `Example tool ${i}` }));
    await expect.poll(async () => {
      await ctl({ op: 'raw', frame: { type: 'reply', cmd: 'get_tool_table', ok: true, tools } });
      return table.locator('tbody tr').count();
    }).toBe(36);
    const actions = tab.locator('.toolTabManage');
    const before = await measureLayout(actions, 'tool-actions');
    expect(Math.abs((await actions.boundingBox())!.x
      - (await tab.getByRole('button', { name: 'Measure Current', exact: true }).boundingBox())!.x)).toBeLessThan(1);
    await expect(tab.getByRole('button', { name: /Refresh/ })).toHaveCount(0);
    await tab.getByRole('button', { name: 'Browse', exact: true }).click();
    const browser = tab.getByRole('region', { name: 'Server tool libraries' });
    await expect(browser.getByRole('button', { name: 'example-0.json', exact: true })).toBeVisible();
    await expect(browser.locator('.browserPath')).toHaveText(directory);
    await expect(table).toBeHidden();
    await expect(tab.getByPlaceholder('Search tools…')).toBeHidden();
    expect(await browser.locator('.fileItem').first().evaluate(fileStyle)).toEqual(programStyle);
    await assertLayout(actions, await measureLayout(actions, 'tool-actions'), info,
      layoutChanges(before, await measureLayout(actions, 'tool-actions')));
    const geometry = await browser.evaluate(el => {
      const box = el.getBoundingClientRect();
      const list = el.querySelector('.fileList')!;
      const panel = el.parentElement!.getBoundingClientRect();
      const row = el.querySelector('.fileItem')!.getBoundingClientRect();
      return { height: box.height, bottom: box.bottom, panelBottom: panel.bottom,
        visibleRows: list.clientHeight / row.height, scrolls: list.scrollHeight > list.clientHeight };
    });
    expect(Math.abs(geometry.bottom - geometry.panelBottom)).toBeLessThan(2);
    // The floor was 5 rows in a browser without scrollbar bands; the strip's
    // always-present band (WP4) takes 10 px from the pane, which at 800 px
    // height is a sixth of a row (touch-landscape: 4.83 rows).
    expect(geometry.visibleRows).toBeGreaterThanOrEqual(4.5);
    expect(geometry.scrolls).toBe(true);
    await tab.screenshot({ path: info.outputPath('tools-shared-browser.png') });
    const last = browser.getByRole('button', { name: 'example-59.json', exact: true });
    await last.scrollIntoViewIfNeeded();
    expect(await last.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    // The pane must keep its allocated height even with just one library file.
    await tab.getByRole('button', { name: 'Hide Files', exact: true }).click();
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(36);
    await page.route('**/tool-library-files?*', route => route.fulfill({ json: {
      directory, subdir: '', entries: entries('json').slice(0, 1),
    } }));
    await tab.getByRole('button', { name: 'Browse', exact: true }).click();
    await expect(browser.locator('.fileItem')).toHaveCount(1);
    expect((await browser.boundingBox())!.height).toBeCloseTo(geometry.height, 0);
  });
}

// ── Strip states: the frame never reacts to what the strip shows (WP4) ──
// Entering the keypad (setup field or a panel field), the G-code keyboard,
// a macro bar, each banner and the kins chip — and leaving again — must
// keep the strip / viewer / content boxes (outer and INNER sizes) and the
// always-visible reference controls exactly where the homed baseline had
// them. The only exemptions are the rows a macro bar legitimately takes.
for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: strip states keep the frame and the pinned controls invariant`, async ({ page }, info) => {
    const profile = PROFILES[1];
    await openLayout(page, profile, viewport);
    const frame0 = await measureFrame(page);
    const refs0: Record<string, LayoutSnapshot> = {};
    for (const sel of [PANELS.safety, PANELS.setup]) refs0[sel] = await measureLayout(page.locator(sel), sel);
    const evidence: { state: string; frame: unknown; issues: unknown[] }[] = [];
    try {
      for (const state of STRIP_STATES) {
        await enterStripState(page, profile, state);
        const issues = frameChanges(frame0, await measureFrame(page), stripStateExempt(state, viewport.height > viewport.width));
        for (const sel of stripStateRefs(state)) {
          const root = page.locator(sel);
          const snap = await measureLayout(root, sel);
          issues.push(...snap.issues, ...layoutChanges(refs0[sel]!, snap));
        }
        evidence.push({ state, frame: await measureFrame(page), issues });
        expect(issues, `${state}: ${issues.map(i => i.detail).join('\n')}`).toEqual([]);
        await leaveStripState(page, profile, state);
        const after = frameChanges(frame0, await measureFrame(page));
        expect(after, `after ${state}: ${after.map(i => i.detail).join('\n')}`).toEqual([]);
      }
    } finally {
      await info.attach('strip-states.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
    }
  });
}

test('negative control (landscape): an auto scrollbar band lets the keypad change the strip height', async ({ page }) => {
  // macOS overlay scrollbars have no band — the control cannot fire there.
  test.skip(process.platform === 'darwin', 'overlay scrollbars have no band to lose');
  await openLayout(page, PROFILES[1], VIEWPORTS[1]);
  const pre = await page.locator('.strip').evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(pre.scrollWidth, 'fixture must overflow horizontally for the band to matter').toBeGreaterThan(pre.clientWidth);
  const frameOk = await measureFrame(page);
  // The keypad from a PANEL field leaves Safety + keypad only: the strip no
  // longer overflows, so an auto band would vanish — exactly the regression.
  await enterStripState(page, PROFILES[1], 'keypad-panel');
  expect(frameChanges(frameOk, await measureFrame(page))).toEqual([]);
  await leaveStripState(page, PROFILES[1], 'keypad-panel');
  await page.addStyleTag({ content: '.strip { overflow-x: auto !important; }' });
  await settleLayout(page);
  const frameAuto = await measureFrame(page);
  await enterStripState(page, PROFILES[1], 'keypad-panel');
  const changes = frameChanges(frameAuto, await measureFrame(page));
  expect(changes.some(c => /strip\.height|viewer\.height/.test(c.detail)), changes.map(c => c.detail).join('\n')).toBe(true);
});

test('negative control (portrait): without the always-present band the keypad re-flows the pinned controls', async ({ page }) => {
  test.skip(process.platform === 'darwin', 'overlay scrollbars have no band to lose');
  await openLayout(page, PROFILES[1], VIEWPORTS[3]);
  const pre = await page.locator('.strip').evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  expect(pre.scrollHeight, 'fixture must overflow vertically for the band to matter').toBeGreaterThan(pre.clientHeight);
  const frameOk = await measureFrame(page);
  const safetyOk = await measureLayout(page.locator(PANELS.safety), 'safety');
  await enterStripState(page, PROFILES[1], 'keypad-panel');
  expect(frameChanges(frameOk, await measureFrame(page))).toEqual([]);
  expect(layoutChanges(safetyOk, await measureLayout(page.locator(PANELS.safety), 'safety'))).toEqual([]);
  await leaveStripState(page, PROFILES[1], 'keypad-panel');
  // `scrollbar-gutter: stable` would be the natural fix, but the strip is a
  // <fieldset> whose inner scroll box ignores it in Chromium — the control
  // removes the always-present band exactly as that "fix" would have.
  await page.addStyleTag({ content: '.wrap > .strip { overflow-y: auto !important; }' });
  await settleLayout(page);
  const frameAuto = await measureFrame(page);
  const safetyAuto = await measureLayout(page.locator(PANELS.safety), 'safety');
  await enterStripState(page, PROFILES[1], 'keypad-panel');
  // The strip is a <fieldset>: its `clientWidth` does NOT follow the band of
  // its anonymous inner scroll box (measured 268 px with and without the
  // band), so the frame measure cannot see this change — the pinned Safety
  // controls, which fill the inner width, are the witness (252 → 262 px).
  const safetyDiff = layoutChanges(safetyAuto, await measureLayout(page.locator(PANELS.safety), 'safety'));
  expect(safetyDiff.length, safetyDiff.map(c => c.detail).join('\n')).toBeGreaterThan(0);
  // …while the strip's OUTER box stays 280 px: the original UI-08 class, which
  // a bounding-box compare alone could never see.
  const outer = frameChanges(frameAuto, await measureFrame(page)).filter(c => /^strip\.(x|y|width|height) /.test(c.detail));
  expect(outer, outer.map(c => c.detail).join('\n')).toEqual([]);
});

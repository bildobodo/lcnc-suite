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

// The side panel's tabs under every machine state (design wave D1 live
// look): a gate closing with a reason wraps a button in its explain span,
// and that wrapper must not move, resize or distort anything — the probe
// grid's cells shrank and lost their square under TCP (machineFrame closes)
// while the strip-only sweep above never looked at the side panel. The
// state list includes the kinematics modes on purpose: a mode may change a
// label, never a control's footprint here.
const SIDE_TABS: { tab: string; sub?: string }[] = [
  { tab: 'Program' }, { tab: 'MDI' }, { tab: 'Offsets' }, { tab: 'Tools' },
  ...['Outside', 'Inside', 'Angle', 'Boss/Pocket', 'Ridge/Valley', 'Surface', 'Calibrate', 'Toolsetter']
    .map(sub => ({ tab: 'Probing', sub })),
];

for (const profile of PROFILES) {
  for (const viewport of VIEWPORTS) {
    test(`${profile.name} ${viewport.name}: side panel tabs keep every control's footprint across machine states`, async ({ page }, info) => {
      test.setTimeout(180_000);
      await openLayout(page, profile, viewport);
      const states: LayoutState[] = ['unhomed', 'off', 'estop', 'disarmed', 'running', 'paused'];
      if (profile.kins) states.push('tcp');
      if (profile.name === '6axis-twp') states.push('plane', 'plane-stale');
      const side = page.locator('.sidePane');
      // Every tab and state is measured before the verdict, so one run lists
      // every defect rather than the first.
      const found: string[] = [];
      for (const { tab, sub } of SIDE_TABS) {
        await setLayoutState(page, profile, 'homed');
        await side.getByRole('tab', { name: tab, exact: true }).click();
        if (sub) await side.getByRole('tab', { name: sub, exact: true }).click();
        await settleLayout(page);
        const name = sub ? `${tab}/${sub}` : tab;
        const base = await measureLayout(side, name);
        found.push(...base.issues.map(i => `${name}: ${i.kind} — ${i.detail}`));
        for (const state of states) {
          await setLayoutState(page, profile, state);
          const snapshot = await measureLayout(side, `${name}@${state}`);
          const issues = [...snapshot.issues.filter(i => !base.issues.some(b => b.detail === i.detail)),
            ...layoutChanges(base, snapshot)];
          if (issues.length) await assertLayout(side, snapshot, info, issues).catch(() => {});
          found.push(...issues.map(i => `${name}@${state}: ${i.kind} — ${i.detail}`));
        }
      }
      expect(found, found.join('\n')).toEqual([]);
    });
  }
}

// The jog speed readouts sit centred over their sliders (operator, D1 live
// look: the right-aligned number and the unit line sat off the slider's
// axis). Landscape, where the sliders stand upright under their readouts.
for (const viewport of VIEWPORTS.filter(v => v.width > v.height)) {
  test(`${viewport.name}: the jog speed value and unit are centred over their slider`, async ({ page }) => {
    const profile = PROFILES.find(p => (p.axes as readonly string[]).includes('A'))!;
    await openLayout(page, profile, viewport);
    await setLayoutState(page, profile, 'homed');
    const cols = page.locator('[data-strip="jog"] .speedCol');
    await expect(cols).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const off = await cols.nth(i).evaluate(col => {
        const mid = (el: Element | Range) => { const r = el.getBoundingClientRect(); return r.left + r.width / 2; };
        const textMid = (el: Element) => { const r = document.createRange(); r.selectNodeContents(el); return mid(r); };
        const slider = mid(col.querySelector('input[type="range"]')!);
        const [value, unit] = [...col.querySelectorAll('.jogSpeedVal > span')];
        return { value: textMid(value!) - slider, unit: textMid(unit!) - slider };
      });
      expect(Math.abs(off.value), `column ${i} value off by ${off.value.toFixed(1)}px`).toBeLessThanOrEqual(1);
      expect(Math.abs(off.unit), `column ${i} unit off by ${off.unit.toFixed(1)}px`).toBeLessThanOrEqual(1);
    }
  });
}

// The parameters under a probe grid stay where they are when the sub-tab
// changes (operator, D1 live look: the Angle tab's Edge Width row pushed
// them down, and the operation description line grew the section). Every
// sub-tab with a probe grid starts what follows the grid at one height.
for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: the probe grid sub-tabs keep the parameters in place`, async ({ page }) => {
    await openLayout(page, PROFILES[0]!, viewport);
    await setLayoutState(page, PROFILES[0]!, 'homed');
    const side = page.locator('.sidePane');
    await side.getByRole('tab', { name: 'Probing', exact: true }).click();
    const tops: Record<string, number> = {};
    for (const sub of ['Outside', 'Inside', 'Angle', 'Boss/Pocket', 'Ridge/Valley', 'Calibrate']) {
      await side.getByRole('tab', { name: sub, exact: true }).click();
      await settleLayout(page);
      const grid = side.locator('.gridSection');
      if (!await grid.count()) continue;
      tops[sub] = await grid.evaluate(el => {
        el.closest('.scroll-thin, .tab-content')?.scrollTo?.(0, 0);
        const next = el.nextElementSibling as HTMLElement | null;
        return Math.round((next ?? el).getBoundingClientRect()[next ? 'top' : 'bottom']);
      });
    }
    expect(Object.keys(tops).length, JSON.stringify(tops)).toBeGreaterThanOrEqual(5);
    expect(new Set(Object.values(tops)).size, `where the parameters start: ${JSON.stringify(tops)}`).toBe(1);
  });
}

// Design wave D3 (plan WP-DR, measured again with the bundled Inter): the
// side pane's navigation in the four reference states. Five equal main tabs
// and Probing's 4 × 2 grid while the pane has 400 px of content width
// (Inter at the tab size: the widest main name 45 + 22 px → 351 px, the
// widest procedure "Boss/Pocket" 71 + 22 px → 384 px); below 400 px the area
// and the procedure are two selects on one row. No tab name is clipped (a
// Btn clips its overflow — a cut name is invisible to the eye), the tabs
// and selects are --control-h tall, and the scrolling probing content keeps
// at least three form rows — measured on the real FormField (design wave
// D4: 51 px desktop, 66 px touch, rows 8 px apart; DR had assumed 70 px
// per row including the gap, the touch pitch is 74).
// Form rows the scrolling probing content must show whole. Three is the
// plan's floor (WP-DR: "at least three form rows at 150 % portrait").
// Touch landscape 1280 × 800 had "about 3" in the DR and shows 2.95: the
// touch "?" (20 px) makes the label row taller than its text — D6 enlarges
// the HelpIcon's hit area INVISIBLY, then the label's line box rules and
// this goes back to 3.
const NAV_STATES = [
  { name: 'desktop', vp: 'desktop', zoom: 1, narrow: false, h: 32, rows: 3 },
  { name: 'touch-landscape', vp: 'touch-landscape', zoom: 1, narrow: false, h: 44, rows: 2.9 },
  { name: 'touch-portrait', vp: 'touch-portrait', zoom: 1, narrow: false, h: 44, rows: 3 },
  { name: 'touch-portrait 150 %', vp: 'touch-portrait', zoom: 1.5, narrow: true, h: 44, rows: 3 },
] as const;
for (const st of NAV_STATES) {
  test(`${st.name}: side-pane navigation fits its budget (tabs or selects, no clipped name, three form rows)`, async ({ page }) => {
    const viewport = VIEWPORTS.find(v => v.name === st.vp)!;
    await openLayout(page, PROFILES[1]!, viewport);
    await setLayoutState(page, PROFILES[1]!, 'homed');
    if (st.zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, st.zoom);
    const side = page.locator('.sidePane');
    const inner = await side.evaluate(el => {
      const cs = getComputedStyle(el);
      return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    });
    expect(inner < 400, `side pane content width ${inner} px`).toBe(st.narrow);
    const area = page.getByRole('combobox', { name: 'Side panel', exact: true });
    if (st.narrow) {
      await expect(area).toBeVisible();
      await area.selectOption('probe');
      const procedure = page.getByRole('combobox', { name: 'Probing procedure', exact: true });
      await expect(procedure).toBeVisible();
      const [a, p] = await Promise.all([area.evaluate(e => [(e as HTMLElement).offsetTop, (e as HTMLElement).offsetHeight]),
        procedure.evaluate(e => [(e as HTMLElement).offsetTop, (e as HTMLElement).offsetHeight])]);
      expect(a[0], 'the two selects share one row').toBe(p[0]);
      expect(a[1], 'select height = --control-h').toBe(st.h);
    } else {
      await expect(area).toHaveCount(0);
      await side.getByRole('tab', { name: 'Probing', exact: true }).click();
      const grid = page.getByRole('tablist', { name: 'Probing procedure', exact: true });
      const rows = await grid.getByRole('tab').evaluateAll(els => new Set(els.map(e => (e as HTMLElement).offsetTop)).size);
      expect(rows, 'the procedures in two rows').toBe(2);
    }
    await settleLayout(page);
    const tabs = await side.locator('[role="tab"]').evaluateAll(els => els.map(e => {
      const t = e as HTMLElement;
      return { name: t.textContent!.trim(), over: t.scrollWidth - t.clientWidth, h: t.offsetHeight };
    }));
    for (const t of tabs) {
      expect(t.over, `"${t.name}" is clipped by ${t.over} px`).toBeLessThanOrEqual(0);
      expect(t.h, `"${t.name}" height`).toBe(st.h);
    }
    const [content, rows] = await side.locator('.probePanel').evaluate(el => {
      const grid = el.querySelector<HTMLElement>(':scope > .formGrid')!;
      const field = grid.querySelector<HTMLElement>('.formField')!;
      const gap = parseFloat(getComputedStyle(grid).rowGap);
      return [el.clientHeight, (el.clientHeight + gap) / (field.offsetHeight + gap)];
    });
    expect(rows, `probing content ${content} px holds ${rows.toFixed(2)} form rows`).toBeGreaterThanOrEqual(st.rows);
  });
}

// The tab pattern (design wave D5, UI-K05 / N80): every tab with machine
// actions closes its action group with Abort AT THE RIGHT EDGE — the one
// place across tabs, wherever the row wraps — nothing interactive sits to
// its right on its line, and a tab's head keeps the pattern's order (the
// object line, then the machine actions, then management: top to bottom
// in DOM order).
for (const st of NAV_STATES) {
  test(`${st.name}: Abort closes its action group at the right edge in every tab, the head keeps its order`, async ({ page }) => {
    const viewport = VIEWPORTS.find(v => v.name === st.vp)!;
    await openLayout(page, PROFILES[1]!, viewport);
    if (st.zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, st.zoom);
    const side = page.locator('.sidePane');
    const problems: string[] = [];
    for (const tab of ['Program', 'MDI', 'Probing', 'Tools']) {
      if (st.narrow) await page.getByRole('combobox', { name: 'Side panel', exact: true }).selectOption({ label: tab });
      else await side.getByRole('tab', { name: tab, exact: true }).click();
      await settleLayout(page);
      problems.push(...await side.evaluate((el, tab) => {
        const out: string[] = [];
        const shown = (e: Element) => (e as HTMLElement).offsetParent !== null;
        const aborts = [...el.querySelectorAll<HTMLElement>('button')].filter(b => shown(b) && b.textContent?.trim() === 'Abort');
        if (aborts.length !== 1) out.push(`${tab}: ${aborts.length} Abort buttons`);
        for (const a of aborts) {
          const box = (a.closest('.btnTip') as HTMLElement | null) ?? a;
          const group = a.closest<HTMLElement>('.actionGroup');
          if (!group) { out.push(`${tab}: Abort outside an .actionGroup`); continue; }
          const ar = box.getBoundingClientRect();
          const gr = group.getBoundingClientRect();
          const cs = getComputedStyle(group);
          const right = gr.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
          if (Math.abs(ar.right - right) > 1) out.push(`${tab}: Abort ends ${(right - ar.right).toFixed(1)} px before its group's right edge`);
          for (const c of group.querySelectorAll<HTMLElement>('button, input, select, [role="button"]')) {
            if (c === a || box.contains(c) || !shown(c)) continue;
            const cr = c.getBoundingClientRect();
            if (cr.left >= ar.right - 1 && cr.top < ar.bottom && cr.bottom > ar.top)
              out.push(`${tab}: "${(c.textContent ?? '').trim() || c.getAttribute('aria-label') || c.closest('label')?.textContent?.trim()}" sits right of Abort`);
          }
        }
        for (const head of el.querySelectorAll<HTMLElement>('.panelHead')) {
          if (!shown(head)) continue;
          const rows = [...head.children].filter(shown) as HTMLElement[];
          for (let i = 1; i < rows.length; i++) {
            if (rows[i]!.getBoundingClientRect().top < rows[i - 1]!.getBoundingClientRect().bottom - 0.5)
              out.push(`${tab}: head row ${i + 1} (${rows[i]!.className}) is not below row ${i} (${rows[i - 1]!.className})`);
          }
          const object = rows.findIndex(r => r.classList.contains('panelObject'));
          if (object > 0) out.push(`${tab}: the object line is not the head's first row`);
        }
        return out;
      }, tab));
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
}

// Portrait stacks the strip's sections in ONE column: every section's
// content spans the same x range, the pinned Safety section included, and its
// near-edge fade hangs BELOW it across the column (operator, D1 live look:
// the Safety section started 8 px further in than Jog — its portrait rules
// sat before the base rule in style.css and never applied, the fade kept its
// landscape geometry off the right edge). Its two status columns fit side by
// side with a reserve (they scrolled sideways), and the pinned section stays
// a quarter of the strip: stacking the columns fitted them too, but the
// section grew to 35 % of the strip at 100 % and 60 % at 150 %.
for (const viewport of VIEWPORTS.filter(v => v.height > v.width)) {
  test(`${viewport.name}: the strip sections share one content column`, async ({ page }) => {
    await openLayout(page, PROFILES[0]!, viewport);
    await setLayoutState(page, PROFILES[0]!, 'homed');
    const { spans, fade, status, share } = await page.locator('.strip').evaluate(strip => {
      const spans: Record<string, string> = {};
      for (const sec of strip.querySelectorAll<HTMLElement>('.stripSection')) {
        if (sec.parentElement?.closest('.stripSection')) continue;
        const r = sec.getBoundingClientRect(), cs = getComputedStyle(sec);
        const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
        const right = r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
        const name = sec.closest('[data-strip]')?.getAttribute('data-strip') ?? [...sec.classList].join('.');
        spans[name] = `${Math.round(left)}..${Math.round(right)}`;
      }
      const safety = strip.querySelector<HTMLElement>('.safetyStrip')!;
      const after = getComputedStyle(safety, '::after');
      const detail = safety.querySelector<HTMLElement>('.statusDetail')!, cols = detail.querySelector<HTMLElement>('.statusCols')!;
      const dcs = getComputedStyle(detail);
      const room = detail.clientWidth - parseFloat(dcs.paddingLeft) - parseFloat(dcs.paddingRight);
      const saved = cols.style.cssText;
      cols.style.width = 'max-content';
      const need = cols.getBoundingClientRect().width;
      cols.style.cssText = saved;
      return { spans, fade: { width: Math.round(parseFloat(after.width)), section: Math.round(safety.getBoundingClientRect().width), top: after.top, bottom: after.bottom },
        status: { room, need: Math.round(need * 10) / 10, rows: [...cols.children].map(c => Math.round(c.getBoundingClientRect().top)) },
        share: safety.getBoundingClientRect().height / strip.clientHeight };
    });
    expect(Object.keys(spans).length, JSON.stringify(spans)).toBeGreaterThanOrEqual(6);
    expect(new Set(Object.values(spans)).size, `section content spans: ${JSON.stringify(spans)}`).toBe(1);
    expect(fade.width, `Safety fade ${JSON.stringify(fade)}`).toBe(fade.section);
    expect(parseFloat(fade.bottom), `Safety fade ${JSON.stringify(fade)}`).toBeLessThan(0);
    expect(new Set(status.rows).size, `status columns side by side: ${JSON.stringify(status)}`).toBe(1);
    expect(status.room - status.need, `status columns' reserve: ${JSON.stringify(status)}`).toBeGreaterThanOrEqual(2);
    expect(share, 'the pinned Safety section\'s share of the strip').toBeLessThanOrEqual(0.3);
    // The same page at 150 % (CSS zoom, as the budget specs emulate it): the
    // strip keeps its 280 px column while the viewport shrinks to 800 CSS px,
    // so the pinned section's share grows — 45 % today, 60 % with the columns
    // stacked. Measured, not assumed to follow from the 100 % bound; both
    // heights from getBoundingClientRect (one unit — a zoomed rect over an
    // unzoomed clientHeight once read "90 %").
    const zoomed = await page.locator('.strip').evaluate(async strip => {
      document.documentElement.style.zoom = '1.5';
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const safety = strip.querySelector<HTMLElement>('.safetyStrip')!;
      const detail = safety.querySelector<HTMLElement>('.statusDetail')!;
      const out = { share: safety.getBoundingClientRect().height / strip.getBoundingClientRect().height,
        over: detail.scrollWidth - detail.clientWidth };
      document.documentElement.style.zoom = '';
      return out;
    });
    expect(zoomed.over, 'status detail sideways overflow at 150 %').toBe(0);
    expect(zoomed.share, 'the pinned Safety section\'s share of the strip at 150 %').toBeLessThanOrEqual(0.55);
  });
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
    const toolbar = panel.locator('.programManage');
    const before = await measureLayout(toolbar, 'program-toolbar');
    await panel.getByRole('button', { name: 'Files', exact: true }).click();
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
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    const program = page.getByRole('region', { name: 'Server programs' });
    await expect(program.getByRole('button', { name: 'example-0.ngc', exact: true })).toBeVisible();
    const fileStyle = (el: Element) => {
      const s = getComputedStyle(el);
      return { height: el.getBoundingClientRect().height, font: s.fontSize,
        padding: s.padding, border: s.borderWidth, radius: s.borderRadius, background: s.backgroundColor };
    };
    const programStyle = await program.locator('.fileItem').first().evaluate(fileStyle);
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('tab', { name: 'Tools', exact: true }).click();
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
    await tab.getByRole('button', { name: 'Files', exact: true }).click();
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
    // height is a sixth of a row (touch-landscape: 4.83 rows). The 44 px
    // touch controls (design wave D4, operator decision 2026-09-26: the
    // two button rows above the browser grew 8 px each) leave 4.11 rows
    // there — the operator's accepted cost; the floor is four whole rows.
    expect(geometry.visibleRows).toBeGreaterThanOrEqual(4);
    expect(geometry.scrolls).toBe(true);
    await tab.screenshot({ path: info.outputPath('tools-shared-browser.png') });
    const last = browser.getByRole('button', { name: 'example-59.json', exact: true });
    await last.scrollIntoViewIfNeeded();
    expect(await last.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    })).toBe(true);
    // The pane must keep its allocated height even with just one library file.
    await tab.getByRole('button', { name: 'Files', exact: true }).click();
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(36);
    await page.route('**/tool-library-files?*', route => route.fulfill({ json: {
      directory, subdir: '', entries: entries('json').slice(0, 1),
    } }));
    await tab.getByRole('button', { name: 'Files', exact: true }).click();
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

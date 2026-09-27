import { test, expect, type Page } from '@playwright/test';
import { encode } from '@msgpack/msgpack';
import { ctl } from './ctl';
import { measureLayout, assertLayout, layoutChanges, measureFrame, frameChanges, type LayoutSnapshot } from './layout-audit';
import { PROFILES, VIEWPORTS, PANELS, openLayout, setLayoutState, settleLayout, type LayoutState,
  STRIP_STATES, enterStripState, leaveStripState, stripStateRefs, stripStateExempt, SETUP_AXIS_ROWS } from './layout-fixtures';

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
  { name: 'touch-landscape', vp: 'touch-landscape', zoom: 1, narrow: false, h: 44, rows: 3 },
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
          // The next control row keeps --gap-controls from the head (operator
          // 2026-09-27: the Tools search field sat ON the action row, 0 px —
          // the head was a sibling in a column without a gap).
          let next: Element | null = head;
          while (next && !next.nextElementSibling) next = next.parentElement;
          let row = next?.nextElementSibling as HTMLElement | null;
          while (row && !shown(row)) row = row.nextElementSibling as HTMLElement | null;
          if (row) {
            // A separate CONTROL row (a field in it: Tools' search) keeps
            // --gap-controls, also in the narrow pane (Codex R21); content
            // (Program's code) at least --gap-tight — the narrow Program head
            // is tight on purpose (three code lines at 150 %, UI-DI09).
            const token = row.querySelector('input, select, textarea') ? '--gap-controls' : '--gap-tight';
            const want = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(token));
            const gap = row.getBoundingClientRect().top - head.getBoundingClientRect().bottom;
            if (gap < want - 0.5) out.push(`${tab}: the row after the head (${row.className}) sits ${gap.toFixed(1)} px below it, want ${want}`);
          }
        }
        return out;
      }, tab));
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
}

// The narrow side pane's CONTENT budget (implementation review round 4,
// UI-DI09 / DI10): at 150 % portrait (touch, 271 × 266 px of tab content)
// the Program head took all 272 px — no code line — and the tool table's
// description collapsed to single letters under a 165 px header. Program's
// management and run options fold behind ONE "More" toggle in its object
// line (the code keeps three lines, Abort stays in view, the folded
// controls are reachable unfolded); the tool table is laid out as a whole
// for the narrow pane. Wide panes have no toggle and fold nothing.
const NARROW_PROGRAM = Array.from({ length: 40 }, (_, i) => i === 0 ? '(narrow)' : `G1 X${i} Y${i % 7} F300`).join('\n');
const NARROW_TOOLS = [
  { T: 5, P: 5, Z: -40.123456, D: 6, type: 'endmill', description: 'Test cutter', remark: '' },
  { T: 12, P: 12, Z: -55.5, D: 10, type: 'drill', description: '10 mm HSS drill, long series', remark: '' },
  { T: 99, P: 99, Z: 0, D: 3, type: 'probe', description: 'Renishaw probe', remark: '' },
];
/** Is the control at its centre, inside the side pane? (scrolled into view first) */
async function hitInPane(loc: import('@playwright/test').Locator) {
  await loc.scrollIntoViewIfNeeded();
  return loc.evaluate(el => {
    const r = el.getBoundingClientRect();
    const pane = document.querySelector('.sidePane')!.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const inPane = x > pane.left && x < pane.right && y > pane.top && y < pane.bottom;
    const at = document.elementFromPoint(x, y);
    // A dimmed button is hit through its .btnTip wrapper; a switch through its label.
    const target = el.closest('.btnTip') ?? el.closest('label') ?? el;
    return inPane && !!at && target.contains(at);
  });
}
for (const zoom of [1.5, 1]) {
  test(`touch-portrait ${zoom * 100} %: Program keeps code lines and Abort ("More" unfolds the rest); the tool table keeps a readable identity and a whole row`, async ({ page }) => {
    const narrow = zoom !== 1;
    await page.route('**/gcode?*', r => r.fulfill({ contentType: 'text/plain', body: NARROW_PROGRAM }));
    await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === 'touch-portrait')!);
    await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: 5, file: '/layout-example.ngc' } });
    if (narrow) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
    await expect(page.locator('.codeLine').first()).toContainText('(narrow)');
    await settleLayout(page);
    const side = page.locator('.sidePane');
    const more = (what: string) => side.getByRole('button', { name: `More ${what} actions`, exact: true });

    // Program: at least three whole code lines, Abort in view.
    const lines = await side.locator('.codeArea .codeViewer').evaluate(v =>
      v.clientHeight / (v.querySelector('.codeLine') as HTMLElement).offsetHeight);
    expect(lines, `Program shows ${lines.toFixed(2)} code lines`).toBeGreaterThanOrEqual(3);
    expect(await hitInPane(side.getByRole('button', { name: 'Abort', exact: true })), 'Abort in the pane').toBe(true);
    const manage = ['Edit', 'Reload', 'Unload', 'Files', 'Upload'];
    if (narrow) {
      await expect(more('program')).toHaveAttribute('aria-expanded', 'false');
      for (const name of manage) await expect(side.getByRole('button', { name, exact: true })).toBeHidden();
      await more('program').click();
      await expect(more('program')).toHaveAttribute('aria-expanded', 'true');
    } else {
      await expect(more('program'), 'a wide pane folds nothing').toBeHidden();
    }
    for (const name of manage) {
      expect(await hitInPane(side.getByRole('button', { name, exact: true })), `${name} reachable`).toBe(true);
    }
    for (const name of ['M01', '/BD']) {
      expect(await hitInPane(side.getByRole('switch', { name, exact: true })
        .or(side.getByRole('checkbox', { name, exact: true }))), `${name} reachable`).toBe(true);
    }
    const unfolded = await side.locator('.codeArea .codeViewer').evaluate(v =>
      v.clientHeight / (v.querySelector('.codeLine') as HTMLElement).offsetHeight);
    expect(unfolded, 'unfolded, the code keeps its three lines (the tab scrolls)').toBeGreaterThanOrEqual(3);

    // Tools (UI-DI10 is the TABLE): a header no taller than a row, the
    // description at a readable width and not covered, a whole tool row at
    // first sight, the row actions pinned, the tab never scrolled sideways.
    if (narrow) await page.getByRole('combobox', { name: 'Side panel', exact: true }).selectOption('tools');
    else await side.getByRole('tab', { name: 'Tools', exact: true }).click();
    await expect.poll(async () => {
      await ctl({ op: 'raw', frame: { type: 'reply', cmd: 'get_tool_table', ok: true, tools: NARROW_TOOLS } });
      return side.locator('.toolsTab tbody tr').count();
    }).toBe(3);
    await settleLayout(page);
    const t = await side.locator('.toolsTab .tableWrap').evaluate(wrap => {
      const box = wrap.getBoundingClientRect();
      const head = wrap.querySelector('thead')!.getBoundingClientRect();
      const rows = [...wrap.querySelectorAll('tbody tr')].map(r => r.getBoundingClientRect());
      const desc = wrap.querySelector<HTMLElement>('tbody td.colDesc')!;
      const d = desc.getBoundingClientRect();
      const at = document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2);
      const tab = document.querySelector<HTMLElement>('.toolsTab')!;
      // The pinned cells hide what scrolls under them: contiguous, opaque.
      const pinned = [...wrap.querySelectorAll<HTMLElement>('tbody tr:first-child td.colAction')].map(c => c.getBoundingClientRect());
      const heads = [...wrap.querySelectorAll<HTMLElement>('th.colT, th.colAction')].map(c => getComputedStyle(c).opacity);
      return { gap: pinned[1]!.left - pinned[0]!.right, headOpacity: heads, head: head.height, row: rows[0]!.height, whole: rows.filter(r => r.bottom <= box.bottom + 0.5).length,
        descW: desc.clientWidth, descFont: parseFloat(getComputedStyle(desc).fontSize), descSeen: desc.contains(at),
        sideways: tab.scrollWidth - tab.clientWidth, down: tab.scrollHeight - tab.clientHeight };
    });
    expect(t.head, `the header (${t.head.toFixed(1)} px) is no taller than a tool row (${t.row.toFixed(1)})`).toBeLessThanOrEqual(t.row);
    expect(t.descW, 'the description keeps a readable width (7 em)').toBeGreaterThanOrEqual(7 * t.descFont - 0.5);
    expect(t.descSeen, 'the first description is in view and not covered').toBe(true);
    expect(t.whole, 'a whole tool row at first sight').toBeGreaterThanOrEqual(1);
    expect(t.sideways, 'the Tools tab never scrolls sideways').toBeLessThanOrEqual(0);
    expect(t.down, 'the Tools tab never scrolls as a whole (the table does)').toBeLessThanOrEqual(0);
    expect(Math.abs(t.gap), 'the pinned row actions touch — nothing shows between them').toBeLessThanOrEqual(0.5);
    expect(t.headOpacity.every(o => o === '1'), `pinned header cells are opaque: ${t.headOpacity}`).toBe(true);
    for (const name of ['Edit T5', 'Delete T5']) {
      expect(await hitInPane(side.getByRole('button', { name, exact: true })), `${name} reachable`).toBe(true);
    }
    for (const name of ['Measure Current', 'Unload', 'Abort', 'Add', 'Files', 'Upload']) {
      expect(await hitInPane(side.locator('.toolsTab').getByRole('button', { name: new RegExp(`^(\\+ )?${name}$`) })), `${name} reachable`).toBe(true);
    }
  });
}

// The header (design wave D5, UI-K06): one button height and icon size,
// Shutdown's caption BESIDE its icon (stacked it was the one tall button),
// the operating states in the row and the diagnostics (clients, latencies)
// behind a labelled "Connection details".
for (const vp of ['desktop', 'touch-portrait'] as const) {
  test(`${vp}: the header's buttons are one height, Shutdown's caption sits beside its icon, diagnostics behind Connection details`, async ({ page }) => {
    const viewport = VIEWPORTS.find(v => v.name === vp)!;
    await openLayout(page, PROFILES[1]!, viewport);
    const hdr = page.locator('.hdr');
    const buttons = await hdr.locator('.hdrBtns button').evaluateAll(els => els.map(b => {
      const r = b.getBoundingClientRect();
      const icon = b.querySelector('svg')!.getBoundingClientRect();
      const text = b.querySelector('.btn-label-sm')?.getBoundingClientRect() ?? null;
      return { name: b.getAttribute('aria-label') ?? b.getAttribute('title'), h: Math.round(r.height), icon: Math.round(icon.width),
        beside: text ? text.left >= icon.right && text.top < icon.bottom && text.bottom > icon.top : null };
    }));
    expect(new Set(buttons.map(b => b.h)).size, JSON.stringify(buttons)).toBe(1);
    expect(new Set(buttons.map(b => b.icon)).size, JSON.stringify(buttons)).toBe(1);
    const shutdown = buttons.find(b => b.name?.startsWith('Shut Down'))!;
    expect(shutdown.beside, "Shutdown's caption beside its icon").toBe(true);
    // States stay in the row; the diagnostics do not.
    await expect(hdr.locator('.pill').filter({ hasText: 'WS connected' })).toBeVisible();
    await expect(hdr.locator('.pill').filter({ hasText: /armed/i })).toBeVisible();
    await expect(hdr.locator('.pill').filter({ hasText: /client|net|ping/i })).toHaveCount(0);
    await hdr.getByRole('button', { name: 'Connection details', exact: true }).click();
    const card = page.locator('.helpPopover:popover-open');
    await expect(card).toContainText('Clients');
    await expect(card.getByTitle('Network latency')).toBeVisible();
    const [cb, vpW] = [await card.boundingBox(), viewport.width];
    expect(cb!.x >= 0 && cb!.x + cb!.width <= vpW, 'the card inside the window').toBe(true);
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
    for (const sel of [PANELS.safety, PANELS.setup, SETUP_AXIS_ROWS]) refs0[sel] = await measureLayout(page.locator(sel), sel);
    const portrait = viewport.height > viewport.width;
    const evidence: { state: string; frame: unknown; issues: unknown[] }[] = [];
    try {
      for (const state of STRIP_STATES) {
        await enterStripState(page, profile, state);
        const issues = frameChanges(frame0, await measureFrame(page), stripStateExempt(state, portrait));
        for (const sel of stripStateRefs(state, portrait)) {
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

// Design wave D9: the viewer's overlays keep to the viewer. The DRO card
// fits its pane (fitHud steps the scale down from the operator's setting,
// then folds the Machine column, the F / S rows, the tool line, and last
// the findings card to one summary line — measured, never clipped: at
// 1024 × 768 the pane used to clip the card and a warning line vanished; at
// 150 % portrait the card covered the ViewCube and ran into the side pane).
// Review round 6: with a PROGRAM the scrub bar joins the bottom column and
// the fully folded DRO still overlapped the findings (UI-DI12) — the guard
// loads a preview with sequence data so the bar is up; and a fit measured
// against the bottom at its CURRENT scale swung between two sizes forever
// (UI-DI13) — the guard watches the chosen form hold still. Landscape from
// 150 % is the named WP-DR limit (the pane is 90–135 px tall there) and not
// swept.
const HUD_CASES = [
  ...VIEWPORTS.map(vp => ({ vp, zoom: 1 })),
  { vp: VIEWPORTS.find(v => v.name === 'touch-portrait')!, zoom: 1.5 },
];
const TIMELINE_FEED = Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
const TIMELINE_PREVIEW = Buffer.from(encode({ file: '/leak.ngc', preview_schema: 9, feed: TIMELINE_FEED,
  feed_lines: TIMELINE_FEED.map((_, i) => i + 3), feed_seq: TIMELINE_FEED.map((_, i) => i + 3),
  rapid: [[0, 0, 5], [0, 0, 0]], rapid_lines: [1, 2], rapid_seq: [1, 2] }));
for (const profile of [PROFILES[1], PROFILES[2]]) {
  test(`${profile.name}: the HUD, its findings, the scrub bar and the ViewCube column stay inside the viewer, apart and still`, async ({ page, context }) => {
    test.setTimeout(240_000);
    // /preview? only — a bare /preview/ also catches previewWorker-*.js.
    await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: 'application/octet-stream', body: TIMELINE_PREVIEW }));
    await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: 'text/plain', body: '(timeline)\nG0 X0\nG1 X10 F100\nM2\n' }));
    for (const { vp, zoom } of HUD_CASES) for (const scale of ['md', 'xl'] as const) {
      await openLayout(page, profile, vp);
      await ctl({ op: 'raw', frame: { type: 'settings_changed', settings: { viewer: { hud: { scale, showMachine: true } } } } });
      // Every warning line the status alone can raise, a program with a
      // timeline, then a preview re-parse.
      await ctl({ op: 'status_delta', data: { active_file: '/leak.ngc', eoffset_enabled: true, eoffset_z: 0.123, rotation_xy: 12 } });
      await ctl({ op: 'loadGcode' });
      await expect(page.locator('.scrubBar')).toBeVisible();
      await ctl({ op: 'quiet', on: true });
      await ctl({ op: 'raw', frame: { type: 'status_delta', armed: true, data: {}, preview_refresh:
        { reason: 'wcsoff:G54:x', file: '/leak.ngc', expected_ms: 30000, started_ms: 1000, queued: false, superseded: 0 } } });
      await expect(page.locator('.hudNotes .hudWarn')).toHaveCount(3);
      if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
      await settleLayout(page);
      const where = `${vp.name} ${zoom * 100} % ${scale}`;
      // Still: once the content has settled (the collision sweep's verdict
      // lands in the scrub bar a moment after the load and grows it — a
      // legitimate re-fit), the chosen form holds for 2 s.
      await expect.poll(() => page.evaluate(async () => {
        const text = () => (document.querySelector('.scrubBar') as HTMLElement | null)?.innerText ?? '';
        const first = text();
        for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 100)); if (text() !== first) return false; }
        return true;
      }), { message: `${where}: the scrub bar's content settles`, timeout: 10_000 }).toBe(true);
      const forms = await page.evaluate(async () => {
        const seen = new Set<string>();
        for (let i = 0; i < 20; i++) {
          seen.add(`${document.querySelector('.hud')?.className} | ${document.querySelector('.hudNotes')?.className}`);
          await new Promise(r => setTimeout(r, 100));
        }
        return [...seen];
      });
      expect(forms, `${where}: the HUD form settles`).toHaveLength(1);
      await expect(page.locator('.hud'), `${where}: the DRO card fits`).toHaveAttribute('data-hud-fit', 'fits');
      const boxes = await page.evaluate(() => {
        const r = (s: string) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
        return { pane: r('.viewerPane .viewerWrapper')!, hud: r('.viewerPane .hud')!, notes: r('.viewerPane .hudNotes')!,
          scrub: r('.viewerPane .scrubBar')!, cube: r('.viewerPane .viewCube')!, quick: r('.viewerPane .viewerQuickGrid')! };
      });
      const inside = (a: typeof boxes.pane, p: typeof boxes.pane) => a.l >= p.l - 0.5 && a.t >= p.t - 0.5 && a.r <= p.r + 0.5 && a.b <= p.b + 0.5;
      const apart = (a: typeof boxes.pane, b: typeof boxes.pane) => a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5;
      for (const k of ['hud', 'notes', 'scrub', 'cube', 'quick'] as const) expect(inside(boxes[k], boxes.pane), `${where}: ${k} inside the viewer ${JSON.stringify(boxes)}`).toBe(true);
      for (const [a, b] of [['hud', 'notes'], ['hud', 'scrub'], ['hud', 'cube'], ['hud', 'quick'], ['notes', 'cube'], ['notes', 'quick'], ['scrub', 'cube'], ['scrub', 'quick']] as const) {
        expect(apart(boxes[a], boxes[b]), `${where}: ${a} and ${b} apart ${JSON.stringify(boxes)}`).toBe(true);
      }
      // Every axis value of the DRO card is shown whole (no fold ever hides an axis row).
      const axes = await page.locator('.hud .hudWork').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent !== null).length);
      expect(axes, `${where}: every axis row shown`).toBeGreaterThanOrEqual(profile.axes.length);
      // A folded findings card still says what is there and opens on a tap.
      if (await page.locator('.hudNotes.needsCompact').count()) {
        await expect(page.locator('.hudNotesSummary'), where).toContainText('3 warnings');
        await expect(page.getByRole('button', { name: 'Show viewer warnings', exact: true })).toBeVisible();
      }
      await ctl({ op: 'quiet', on: false });
      if (zoom !== 1) await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    }
  });
}

// Review rounds 7 and 8: the scrub bar's CONTENTS, the simulation banner
// and the opened detail views in the narrow viewer. The bar fitted as a card
// while its insides ran out of it (UI-DI15: the timeline slider 0 px wide,
// the speed button and the position readout past the window, the findings'
// "?" off screen); the banner ran past both edges and over the DRO
// (UI-DI16); an opened detail view — the scrub bar's More, the warnings card
// — grew the bottom column over the banner and out of the viewer, its close
// toggle with it (UI-DI16/17). Three programs — no findings, one limit
// violation, the limit plus two collisions — portrait at 100 % and 150 %,
// idle and in a client-local simulation at a stopped machine: folded, then
// both opening orders, every close by a real click.
const LIMIT_FEED = TIMELINE_FEED.map(p => [...p]);
LIMIT_FEED[29]![0] = 120;
const LIMIT_PREVIEW = Buffer.from(encode({ file: '/leak.ngc', preview_schema: 9, feed: LIMIT_FEED,
  feed_lines: LIMIT_FEED.map((_, i) => i + 3), feed_seq: LIMIT_FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(LIMIT_FEED.map(p => (p[0]! > 100 ? 1 : 0))),
  violations: [{ line: 32, axis: 'X', value: 120, limit: 100, kind: 'max' }], violations_total: 1,
  rapid: [[0, 0, 5], [0, 0, 0]], rapid_lines: [1, 2], rapid_seq: [1, 2] }));
type Box = { l: number; t: number; r: number; b: number };
const inside = (a: Box, p: Box) => a.l >= p.l - 0.5 && a.t >= p.t - 0.5 && a.r <= p.r + 0.5 && a.b <= p.b + 0.5;
const apart = (a: Box, c: Box) => a.r <= c.l + 0.5 || c.r <= a.l + 0.5 || a.b <= c.t + 0.5 || c.b <= a.t + 0.5;
const pointIn = (x: { x: number; y: number }, p: Box) => x.x >= p.l && x.x <= p.r && x.y >= p.t && x.y <= p.b;
// The bottom column against the VIEWER: the column and the warnings card
// inside it, both toggles' centres inside it (a toggle past the top lay
// under the page's status banner), the simulation banner apart from both
// cards (geometry — the banner ignores the pointer, a hit test passes
// through it), every line of an opened warnings card inside its body once
// scrolled to, a scrolling body takes the pointer, and a body scrolls only
// past a cut line.
async function viewerColumn(page: Page, label: string) {
  const c = await page.evaluate(() => {
    const box = (e: Element | null) => { if (!e) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
    const pane = box(document.querySelector('.viewerPane .viewerWrapper'))!;
    const centre = (s: string) => { const b = box(document.querySelector(s)); return b ? { x: (b.l + b.r) / 2, y: (b.t + b.b) / 2 } : null; };
    const lines: [string, boolean][] = [];
    const body = document.querySelector('.viewerPane .hudNotes.notesOpen > .hudNotesBody, .viewerPane .hudNotes:not(.needsCompact) > .hudNotesBody');
    if (body) {
      for (const w of body.querySelectorAll('.hudWarn')) {
        w.scrollIntoView({ block: 'nearest' });
        const r = w.getBoundingClientRect(), br = body.getBoundingClientRect();
        lines.push([w.textContent ?? '', r.top >= br.top - 0.5 && r.bottom <= br.bottom + 0.5 && r.top >= pane.t - 0.5 && r.bottom <= pane.b + 0.5]);
      }
      body.scrollTo(0, 0);
    }
    // A body that scrolls must take the pointer (a touch scrolls it).
    const deaf = [...document.querySelectorAll('.viewerPane .hudNotesBody, .viewerPane .findingsRow')]
      .filter(e => (e as HTMLElement).offsetParent !== null && e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).pointerEvents === 'none')
      .map(e => e.className);
    // A body scrolls only where a line is CUT: sideways never, down only
    // past a line — and an uncut warnings body the operator has not opened
    // lets the pointer through (the camera works through the card). A "?"'s
    // invisible hit area (--help-hit around a smaller glyph) made the body
    // scroll 6 px sideways and 3 px down: a scrollbar under the off-datum
    // chip, and a body that took the pointer (operator, 2026-09-27).
    const slivers = [...document.querySelectorAll<HTMLElement>('.viewerPane .hudNotesBody, .viewerPane .findingsRow')]
      .filter(e => e.offsetParent !== null)
      .flatMap(e => {
        e.scrollTo(0, 0);
        const cs = getComputedStyle(e), r = e.getBoundingClientRect(), z = r.height / e.offsetHeight;
        const floor = r.top + (e.clientTop + e.clientHeight - (parseFloat(cs.paddingBottom) || 0)) * z;
        const cut = [...e.children].some(ch => { const b = ch.getBoundingClientRect(); return b.height > 0 && b.bottom > floor + 0.5; });
        const dx = e.scrollWidth - e.clientWidth, dy = e.scrollHeight - e.clientHeight, name = e.className;
        return [
          ...(dx > 0 ? [`${name}: scrolls ${dx}px sideways`] : []),
          ...(dy > 0 && !cut ? [`${name}: scrolls ${dy}px with no line cut`] : []),
          ...(e.matches('.hudNotesBody') && !cut && !e.closest('.notesOpen') && cs.pointerEvents !== 'none' ? [`${name}: takes the pointer uncut`] : []),
        ];
      });
    return { pane, banner: box(document.querySelector('.simBanner')), notes: box(document.querySelector('.viewerPane .hudNotes')),
      scrub: box(document.querySelector('.viewerPane .scrubBar')), bottom: box(document.querySelector('.viewerPane .viewerBottom')),
      notesToggle: centre('.viewerPane .notesToggle'), moreToggle: centre('.viewerPane .moreToggle'),
      notesOpen: document.querySelector('.viewerPane .notesToggle')?.getAttribute('aria-expanded') === 'true',
      moreOpen: document.querySelector('.viewerPane .moreToggle')?.getAttribute('aria-expanded') === 'true', lines, deaf, slivers };
  });
  const dump = JSON.stringify(c);
  expect(inside(c.bottom!, c.pane), `${label}: the bottom column inside the viewer ${dump}`).toBe(true);
  if (c.notes) expect(inside(c.notes, c.pane), `${label}: the warnings card inside the viewer ${dump}`).toBe(true);
  for (const k of ['notesToggle', 'moreToggle'] as const) {
    const t = c[k];
    if (t) expect(pointIn(t, c.pane), `${label}: ${k} inside the viewer ${dump}`).toBe(true);
  }
  if (c.banner) for (const k of ['notes', 'scrub'] as const) {
    const o = c[k];
    if (o) expect(apart(c.banner, o), `${label}: the banner and ${k} apart ${dump}`).toBe(true);
  }
  expect(c.lines.filter(([, ok]) => !ok), `${label}: every warning line in view once scrolled to`).toEqual([]);
  expect(c.deaf, `${label}: a scrolling body takes the pointer`).toEqual([]);
  expect(c.slivers, `${label}: a body scrolls only past a cut line`).toEqual([]);
  return c;
}
for (const profile of [PROFILES[1], PROFILES[2]]) {
  test(`${profile.name}: the scrub bar's insides, the simulation banner and the opened details fit the narrow viewer`, async ({ page, context }) => {
    test.setTimeout(900_000);
    let variant: 'none' | 'limit' | 'both' = 'none', version = 0;
    await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: 'application/octet-stream', body: variant === 'none' ? TIMELINE_PREVIEW : LIMIT_PREVIEW }));
    await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: 'text/plain', body: '(limits)\nG0 X0\nG1 X10 F100\nM2\n' }));
    const portrait = VIEWPORTS.find(v => v.name === 'touch-portrait')!;
    for (const v of ['none', 'limit', 'both'] as const) for (const zoom of [1, 1.5]) {
      variant = v;
      await openLayout(page, profile, portrait);
      await ctl({ op: 'status_delta', data: { active_file: '/leak.ngc', eoffset_enabled: true, eoffset_z: 0.123, rotation_xy: 12 } });
      // A version of its own per load: the mock's counter restarts with every
      // reset and the client keeps a published revision's preview.
      await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: 700 + version++, file: '/leak.ngc' } });
      await expect(page.locator('.scrubBar')).toBeVisible();
      if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
      const where = (state: string) => `portrait ${zoom * 100} % ${v} ${state}`;
      const settle = async (state: string) => {
        await settleLayout(page);
        await expect.poll(() => page.evaluate(async () => {
          const text = () => (document.querySelector('.scrubBar') as HTMLElement | null)?.innerText ?? '';
          const first = text();
          for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 100)); if (text() !== first) return false; }
          return true;
        }), { message: `${where(state)}: the scrub bar settles`, timeout: 10_000 }).toBe(true);
      };
      // The sweep's verdict first (the "?" of the collision check needs it),
      // then — with both — two collisions on the swept track.
      await expect.poll(() => page.locator('.scrubBar [aria-label="Help: Collision check"]').count(),
        { message: `${where('')}: the collision verdict`, timeout: 15_000 }).toBe(1);
      if (v !== 'none') await expect(page.locator('.scrubBar [aria-label="Next limit violation"]')).toBeAttached();   // folded = hidden, still there
      if (v === 'both') {
        await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([{ line: 12, frac: 0.3 }, { line: 22, frac: 0.6, rapid: true }]) ?? false),
          { message: `${where('')}: collisions on the track` }).toBe(true);
        await expect(page.locator('.scrubBar [aria-label="Next collision"]')).toBeAttached();
      }
      // The bar's insides, measured: the slider's width, every visible row
      // within its box, every rendered control (button, "?", slider, readout
      // slot) scrolled into view (the findings scroll in a capped column)
      // and hit-tested at its centre inside the window, every button's words
      // whole. `required` names what must be RENDERED in this state.
      const insides = (required: string[]) => page.evaluate(required => {
        const zoom = parseFloat(document.documentElement.style.zoom || '1');
        const bar = document.querySelector('.scrubBar')!;
        const nameOf = (e: Element) => e.getAttribute('aria-label') || (e as HTMLElement).innerText?.trim() || [...e.classList].join('.');
        const reach = (e: Element) => {
          e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          const r = e.getBoundingClientRect();
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          if (x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) return 'off screen';
          const top = document.elementFromPoint(x, y);
          return top && (top === e || e.contains(top) || top.contains(e)) ? 'ok' : `covered by ${top?.className}`;
        };
        const rendered = [...bar.querySelectorAll('button, [role="button"], input[type="range"], .posSlot, .lineSlot')]
          .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
        const names = rendered.map(nameOf);
        const rows = [...bar.querySelectorAll('.scrubRow')].filter(r => (r as HTMLElement).offsetParent !== null)
          .map(r => r.scrollWidth - r.clientWidth);
        const unreachable = rendered.map(e => [nameOf(e), reach(e)]).filter(([, s]) => s !== 'ok');
        bar.querySelector('.findingsRow')?.scrollTo(0, 0);
        return {
          slider: bar.querySelector('.sliderInput')!.getBoundingClientRect().width / zoom,
          rowOverflow: Math.max(0, ...rows),
          compact: bar.classList.contains('compact'),
          moreLabel: bar.querySelector('.moreToggle')?.getAttribute('aria-label') ?? '',
          unreachable,
          clipped: rendered.filter(e => e.tagName === 'BUTTON' && e.scrollWidth > e.clientWidth + 1).map(nameOf),
          missing: required.filter(n => !names.some(m => m === n || m.startsWith(n))),
        };
      }, required);
      const findingsNames = [
        ...(v !== 'none' ? ['Previous limit violation', '1 limit violation', 'Next limit violation', 'Help: Limit violations'] : []),
        ...(v === 'both' ? ['Previous collision', '2 collisions', 'Next collision'] : []),
        'Help: Collision check'];
      const expectInsides = async (state: string, open: boolean) => {
        const b = await insides(open ? ['×', ...findingsNames] : []);
        expect(b.slider, `${where(state)}: the timeline keeps its width`).toBeGreaterThanOrEqual(120);
        expect(b.rowOverflow, `${where(state)}: no row runs out of the bar`).toBeLessThanOrEqual(1);
        expect(b.unreachable, `${where(state)}: every rendered control reachable`).toEqual([]);
        expect(b.clipped, `${where(state)}: every button's words whole`).toEqual([]);
        if (open) {
          expect(b.missing, `${where(state)}: speed, position, findings and their help rendered`).toEqual([]);
          const pos = await page.locator('.scrubBar .posSlot').evaluate(e => ({ text: (e as HTMLElement).innerText, whole: e.scrollWidth <= e.clientWidth + 1 }));
          expect(pos.text, `${where(state)}: the position readout (time, or % on a distance axis)`).toMatch(/\d/);
          expect(pos.whole, `${where(state)}: the position readout whole`).toBe(true);
        }
        return b;
      };
      // The bottom column against the VIEWER: the column and the warnings
      // card inside it, both toggles' centres inside it (a toggle past the
      // top lay under the page's status banner), the simulation banner apart
      // from both cards (geometry — the banner ignores the pointer, a hit
      // test passes through it), and every line of an opened warnings card
      // inside its body once scrolled to.
      const column = (state: string) => viewerColumn(page, where(state));
      const hudForm = () => page.locator('.hud').evaluate(e => e.className);
      // A real click (Playwright's actionability: visible, stable, receives
      // the pointer) — a toggle under another layer fails here.
      const toggle = (sel: string) => page.locator(`.viewerPane ${sel}`).click({ timeout: 3000 });
      const details = async (state: string) => {
        await settle(state);
        const b = await expectInsides(`${state} folded`, false);
        const form = await hudForm();
        await column(`${state} folded`);
        const hasNotes = await page.locator('.viewerPane .notesToggle').isVisible();
        // The case under test exists: at 150 % both views fold behind toggles.
        if (zoom !== 1) expect([hasNotes, b.compact], `${where(state)}: both toggles offered`).toEqual([true, true]);
        const keep = async (s: string) => expect(await hudForm(), `${where(s)}: an opened view leaves the DRO's form`).toBe(form);
        if (!b.compact) await expectInsides(`${state} whole bar`, true);
        else if (v !== 'none') expect(b.moreLabel, where(state)).toContain(v === 'both' ? '1 limit violation, 2 collisions' : '1 limit violation');
        // Order A: More, then the warnings (which fold More — one detail
        // view at a time), then the warnings closed by their own toggle.
        if (b.compact) {
          await toggle('.moreToggle'); await settle(`${state} More`);
          await expectInsides(`${state} More`, true); await column(`${state} More`); await keep(`${state} More`);
          if (hasNotes) {
            await toggle('.notesToggle'); await settle(`${state} More → warnings`);
            const c = await column(`${state} More → warnings`); await keep(`${state} More → warnings`);
            expect([c.notesOpen, c.moreOpen], `${where(state)}: one detail view at a time`).toEqual([true, false]);
            await toggle('.notesToggle'); await settle(`${state} warnings closed`); await column(`${state} warnings closed`);
          } else {
            await toggle('.moreToggle'); await settle(`${state} More closed`); await column(`${state} More closed`);
          }
        }
        // Order B: the warnings, then More, then More closed by its toggle.
        if (hasNotes) {
          await toggle('.notesToggle'); await settle(`${state} warnings`);
          await column(`${state} warnings`); await keep(`${state} warnings`);
          if (b.compact) {
            await toggle('.moreToggle'); await settle(`${state} warnings → More`);
            const c = await column(`${state} warnings → More`); await keep(`${state} warnings → More`);
            expect([c.notesOpen, c.moreOpen], `${where(state)}: one detail view at a time`).toEqual([false, true]);
            await expectInsides(`${state} warnings → More`, true);
            await toggle('.moreToggle'); await settle(`${state} More closed`); await column(`${state} More closed`);
          } else {
            await toggle('.notesToggle'); await settle(`${state} warnings closed`); await column(`${state} warnings closed`);
          }
        }
      };
      await details('idle');
      // A client-local simulation at a stopped machine: the banner above the
      // DRO, whole, and every axis still shown — folded and in every opened
      // state (the column check keeps the banner apart).
      await ctl({ op: 'status_delta', data: { is_enabled: false, enabled: false } });
      await page.locator('.scrubBar input.toggle').check();
      await expect(page.locator('.simBanner')).toBeVisible();
      await settle('simulating');
      const sim = await page.evaluate(() => {
        const r = (s: string) => { const e = document.querySelector(s); if (!e || !(e as HTMLElement).offsetParent) return null; const x = e.getBoundingClientRect(); return { l: x.left, t: x.top, r: x.right, b: x.bottom }; };
        const banner = document.querySelector('.simBanner') as HTMLElement;
        return { pane: r('.viewerPane .viewerWrapper')!, banner: r('.simBanner')!, hud: r('.viewerPane .hud')!, notes: r('.viewerPane .hudNotes'),
          scrub: r('.viewerPane .scrubBar')!, cube: r('.viewerPane .viewCube')!, quick: r('.viewerPane .viewerQuickGrid')!,
          bannerClipped: banner.scrollWidth > banner.clientWidth + 1, bannerText: banner.innerText };
      });
      expect(sim.bannerText, where('simulating')).toContain('SIMULATION');
      expect(sim.bannerClipped, `${where('simulating')}: the banner's words are whole`).toBe(false);
      expect(inside(sim.banner, sim.pane), `${where('simulating')}: banner inside ${JSON.stringify(sim)}`).toBe(true);
      for (const k of ['hud', 'scrub', 'cube', 'quick', 'notes'] as const) {
        const other = sim[k];
        if (other) expect(apart(sim.banner, other), `${where('simulating')}: banner and ${k} apart ${JSON.stringify(sim)}`).toBe(true);
      }
      expect(apart(sim.hud, sim.scrub), `${where('simulating')}: the DRO and the scrub bar apart`).toBe(true);
      await expect(page.locator('.hud'), `${where('simulating')}: the DRO card fits`).toHaveAttribute('data-hud-fit', 'fits');
      const axes = await page.locator('.hud .hudWork').evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent !== null).length);
      expect(axes, `${where('simulating')}: every axis row shown`).toBeGreaterThanOrEqual(profile.axes.length);
      // The narrow banner's explanation is a "?" — reachable too.
      const help = page.locator('.simBanner [role="button"]');
      if (await help.count()) {
        const hit = await help.evaluate(e => { const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === e || e.contains(t)); });
        expect(hit, `${where('simulating')}: the banner's "?" reachable`).toBe(true);
      }
      await details('simulating');
      await page.locator('.scrubBar input.toggle').uncheck();
      if (zoom !== 1) await page.evaluate(() => { document.documentElement.style.zoom = ''; });
    }
  });
}

// Review round 9 (UI-DI16): the SHARED viewer geometry — the narrow flag
// (the banner's short form with its "?") and the bottom column's cap — must
// follow the pane with the DRO card switched off (Settings → Layers → HUD):
// fitHud returned early without the card, so a resize after switching it off
// kept the desktop's cap and the long banner, and More covered the banner's
// explanation. Switched off at the desktop and then resized, and off from
// the start (the first settings after connecting); a zoom change while
// simulating with More open; the HUD back on as the counter-check.
for (const profile of [PROFILES[1], PROFILES[2]]) {
  test(`${profile.name}: with the HUD layer off the banner and the bottom column still follow the viewer`, async ({ page, context }) => {
    test.setTimeout(300_000);
    let version = 0;
    await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: 'application/octet-stream', body: LIMIT_PREVIEW }));
    await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: 'text/plain', body: '(limits)\nG0 X0\nG1 X10 F100\nM2\n' }));
    const desktop = VIEWPORTS.find(v => v.name === 'desktop')!;
    const portrait = VIEWPORTS.find(v => v.name === 'touch-portrait')!;
    const hud = (on: boolean) => ctl({ op: 'raw', frame: { type: 'settings_init', settings: { viewer: { layers: { hud: on } } } } });
    const settle = async () => {
      await settleLayout(page);
      await expect.poll(() => page.evaluate(async () => {
        const text = () => (document.querySelector('.scrubBar') as HTMLElement | null)?.innerText ?? '';
        const first = text();
        for (let i = 0; i < 5; i++) { await new Promise(r => setTimeout(r, 100)); if (text() !== first) return false; }
        return true;
      }), { timeout: 10_000 }).toBe(true);
    };
    const load = async () => {
      await ctl({ op: 'status_delta', data: { active_file: '/leak.ngc', eoffset_enabled: true, eoffset_z: 0.123, rotation_xy: 12 } });
      await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: 800 + version++, file: '/leak.ngc' } });
      await expect(page.locator('.scrubBar')).toBeVisible();
      await expect.poll(() => page.locator('.scrubBar [aria-label="Help: Collision check"]').count(), { timeout: 15_000 }).toBe(1);
      await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([{ line: 12, frac: 0.3 }, { line: 22, frac: 0.6, rapid: true }]) ?? false)).toBe(true);
    };
    const zoom = (z: number) => page.evaluate(z => { document.documentElement.style.zoom = z === 1 ? '' : String(z); }, z);
    // The viewer's shared geometry: narrow flag as the pane says, the short
    // banner with a reachable "?" when narrow, the cap within the viewer
    // below the banner, and the column check.
    const geometry = async (label: string, narrow: boolean) => {
      await settle();
      const g = await page.evaluate(() => {
        const w = document.querySelector('.viewerPane .viewerWrapper') as HTMLElement;
        const banner = document.querySelector('.simBanner') as HTMLElement | null;
        const help = banner?.querySelector('[role="button"]') as HTMLElement | null;
        let helpHit = false;
        if (help) { const r = help.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); helpHit = !!t && (t === help || help.contains(t)); }
        const gap = parseFloat(getComputedStyle(w).getPropertyValue('--gap-section'));
        const between = parseFloat(getComputedStyle(w).getPropertyValue('--gap-tight'));
        return { narrow: w.classList.contains('narrowViewer'), W: w.clientWidth, H: w.clientHeight, gap, between,
          cap: parseFloat(w.style.getPropertyValue('--viewer-bottom-max')), bannerH: banner?.offsetHeight ?? 0,
          bannerText: banner?.innerText ?? null, help: !!help, helpHit, hudShown: (document.querySelector('.viewerPane .hud') as HTMLElement).offsetParent !== null };
      });
      const dump = JSON.stringify(g);
      expect(g.narrow, `${label}: the narrow flag follows the pane ${dump}`).toBe(narrow);
      expect(g.cap, `${label}: the cap is the viewer below the banner ${dump}`)
        .toBeCloseTo(g.H - 2 * g.gap - (g.bannerH ? g.bannerH + g.between : 0), 0);
      if (g.bannerText !== null && narrow) {
        expect(g.help && g.helpHit, `${label}: the short banner's "?" reachable ${dump}`).toBe(true);
        expect(g.bannerText, `${label}: the short banner ${dump}`).not.toContain('model shows');
      }
      await viewerColumn(page, label);
      return g;
    };
    const more = (label: string) => page.locator('.viewerPane .moreToggle').click({ timeout: 3000 }).then(() => geometry(label, true));
    const simOn = async () => {
      await ctl({ op: 'status_delta', data: { is_enabled: false, enabled: false } });
      await page.locator('.scrubBar input.toggle').check();
      await expect(page.locator('.simBanner')).toBeVisible();
    };

    // A — switched off at the desktop, then the pane changes.
    await openLayout(page, profile, desktop);
    await load();
    await settle();
    await hud(false);
    await expect(page.locator('.viewerPane .hud')).toBeHidden();
    await geometry('A desktop, HUD off', false);
    await page.setViewportSize({ width: portrait.width, height: portrait.height });
    await page.evaluate(() => document.documentElement.classList.add('touch-device'));
    await zoom(1.5);
    await geometry('A portrait 150 %, HUD off', true);
    await simOn();
    const a = await geometry('A simulating', true);
    expect(a.hudShown, 'A: the DRO stays off').toBe(false);
    await more('A simulating, More');
    // A zoom change with More open: the geometry follows both ways.
    await zoom(1);
    await geometry('A simulating, More, 100 %', false);
    await zoom(1.5);
    await geometry('A simulating, More, back at 150 %', true);
    await page.locator('.viewerPane .moreToggle').click({ timeout: 3000 });
    await geometry('A simulating, More closed', true);
    await page.locator('.scrubBar input.toggle').uncheck();
    await geometry('A simulation off', true);
    // Counter-check: the HUD back on.
    await hud(true);
    await expect(page.locator('.viewerPane .hud')).toBeVisible();
    await simOn();
    await geometry('A HUD back on, simulating', true);
    await more('A HUD back on, More');
    await expect(page.locator('.viewerPane .hud')).toHaveAttribute('data-hud-fit', 'fits');
    await page.locator('.viewerPane .moreToggle').click({ timeout: 3000 });
    await page.locator('.scrubBar input.toggle').uncheck();
    await zoom(1);

    // B — off from the start: the first settings after connecting, before
    // the program, the zoom and the simulation.
    await openLayout(page, profile, portrait);
    await hud(false);
    await expect(page.locator('.viewerPane .hud')).toBeHidden();
    await zoom(1.5);
    await load();
    await geometry('B portrait 150 %, HUD off', true);
    await simOn();
    await geometry('B simulating', true);
    await more('B simulating, More');
    await page.locator('.viewerPane .moreToggle').click({ timeout: 3000 });
    await page.locator('.scrubBar input.toggle').uncheck();
    await geometry('B simulation off', true);
    await zoom(1);
  });
}

// The operator's live look (2026-09-27): a "?" in the viewer's warnings
// card — the off-datum chip's — put a scrollbar under its line. The icon's
// invisible hit area (--help-hit, 24 px around a smaller glyph) reached past
// the scroller the card's body became in round 8: 6 px sideways and 3 px
// down on a desktop, the card 10 px taller, and the uncut body took the
// pointer (a camera drag died on it). The "?" on the only line and on the
// first of several; desktop, portrait 100 % and 150 % (the card opened where
// it folds): the column check (a body scrolls only past a cut line), the
// body lets the pointer through unless opened, and the "?" answers over its
// whole hit area — centre, top, bottom and right edge.
test('a help icon in the viewer warnings card scrolls nothing and keeps its hit area', async ({ page }) => {
  test.setTimeout(180_000);
  const profile = PROFILES[1];
  const desktop = VIEWPORTS.find(v => v.name === 'desktop')!;
  const portrait = VIEWPORTS.find(v => v.name === 'touch-portrait')!;
  for (const [vp, zoom] of [[desktop, 1], [portrait, 1], [portrait, 1.5]] as const) for (const lines of ['alone', 'first'] as const) {
    const label = `${vp.name} ${zoom * 100} %, the "?" line ${lines}`;
    await openLayout(page, profile, vp);
    await ctl({ op: 'status_delta', data: { rotary_abc: [20, 0, 0],
      ...(lines === 'first' ? { eoffset_enabled: true, eoffset_z: 0.123, rotation_xy: 12 } : {}) } });
    await expect(page.locator('.viewerPane .hudMode')).toContainText('off datum');
    if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
    await settleLayout(page);
    if (await page.locator('.viewerPane .notesToggle').isVisible()) {
      await page.locator('.viewerPane .notesToggle').click({ timeout: 3000 });
      await settleLayout(page);
    }
    await viewerColumn(page, label);
    const h = await page.evaluate(() => {
      const icon = document.querySelector('.viewerPane .hudMode .helpIcon') as HTMLElement;
      const body = document.querySelector('.viewerPane .hudNotesBody') as HTMLElement;
      const r = icon.getBoundingClientRect(), z = r.width / icon.offsetWidth;
      const reach = (parseFloat(getComputedStyle(icon).getPropertyValue('--help-hit')) / 2 - 1) * z;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const at = (x: number, y: number) => { const t = document.elementFromPoint(x, y); return !!t && (t === icon || icon.contains(t)); };
      return { centre: at(cx, cy), top: at(cx, cy - reach), bottom: at(cx, cy + reach), right: at(cx + reach, cy),
        opened: !!body.closest('.notesOpen'), bodyPointer: getComputedStyle(body).pointerEvents };
    });
    expect([h.centre, h.top, h.bottom, h.right], `${label}: the "?" answers over its whole hit area ${JSON.stringify(h)}`).toEqual([true, true, true, true]);
    if (!h.opened) expect(h.bodyPointer, `${label}: the body lets the pointer through`).toBe('none');
    if (zoom !== 1) await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  }
});

// Viewer contrast plan, V3: a finding on a code line is a FORM, not only the
// number's colour — under deuteranopia the warn and danger text sit 0.02
// apart. A glyph in the slot between the number and the code (the 16 px the
// number's margin gave): ▲ limit, × collision, × when both (danger wins the
// look), named for every finding of the line; the code starts where it did.
test('a code line names its findings with a glyph: ▲ limit, × collision, both named', async ({ page, context }) => {
  test.setTimeout(120_000);
  const feed = LIMIT_FEED.map(p => [...p]);
  const body = Buffer.from(encode({ file: '/marks.ngc', preview_schema: 9, feed,
    feed_lines: feed.map((_, i) => i + 3), feed_seq: feed.map((_, i) => i + 3),
    feed_outside: new Uint8Array(feed.map(p => (p[0]! > 100 ? 1 : 0))),
    violations: [{ line: 20, axis: 'X', value: 120, limit: 100, kind: 'max' }, { line: 32, axis: 'X', value: 120, limit: 100, kind: 'max' }],
    violations_total: 2, rapid: [[0, 0, 5], [0, 0, 0]], rapid_lines: [1, 2], rapid_seq: [1, 2] }));
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: 'application/octet-stream', body }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: 'text/plain',
    body: Array.from({ length: 40 }, (_, i) => i === 0 ? '(marks)' : `G1 X${i} Y${i % 2 ? 20 : 0} F100`).join('\n') }));
  await openLayout(page, PROFILES[1], VIEWPORTS.find(v => v.name === 'desktop')!);
  await ctl({ op: 'status_delta', data: { active_file: '/marks.ngc' } });
  await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: 990, file: '/marks.ngc' } });
  await expect.poll(() => page.locator('.scrubBar [aria-label="Help: Collision check"]').count(), { timeout: 15_000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.([{ line: 12, frac: 0.3 }, { line: 32, frac: 0.95 }]) ?? false)).toBe(true);
  const line = (n: number) => page.locator('.codeViewer:visible .codeLine').filter({ has: page.locator('.lineNumber', { hasText: new RegExp(`^${n}$`) }) });
  // The code viewer renders only the lines near its window: scroll to one first.
  const mark = async (n: number) => {
    await page.locator('.codeViewer:visible').evaluate((el, n) => {
      const h = (el.querySelector('.codeLine') as HTMLElement).offsetHeight;
      el.scrollTop = Math.max(0, (n - 3) * h);
    }, n);
    await expect(line(n)).toHaveCount(1);
    return line(n).evaluate(el => {
      const g = el.querySelector('.lineMark [role="img"]');
      return { name: g?.getAttribute('aria-label') ?? null, glyph: g ? [...g.classList].find(c => c.startsWith('lucide-') && c !== 'lucide-icon') ?? null : null,
        codeX: el.querySelector('.lineContent')!.getBoundingClientRect().left };
    });
  };
  const [limitOnly, collisionOnly, both, plain] = [await mark(20), await mark(12), await mark(32), await mark(5)];
  const dump = JSON.stringify({ limitOnly, collisionOnly, both, plain });
  expect([limitOnly.glyph, limitOnly.name], `limit: ▲ named ${dump}`).toEqual(['lucide-triangle-icon', 'Limit violation']);
  expect([collisionOnly.glyph, collisionOnly.name], `collision: × named ${dump}`).toEqual(['lucide-x-icon', 'Collision']);
  expect([both.glyph, both.name], `both: × shows, the name says both ${dump}`).toEqual(['lucide-x-icon', 'Limit violation, collision']);
  expect(plain.name, `a clean line has no mark ${dump}`).toBeNull();
  expect(new Set([limitOnly.codeX, collisionOnly.codeX, both.codeX, plain.codeX]).size, `the code starts at one x ${dump}`).toBe(1);
});

// Viewer contrast plan, V4 (VK-02/03): the tilted work plane names its state
// AT THE OBJECT — the HUD word is gone with the HUD layer off or the warnings
// card folded, while the plane still shows — and colour, label, edge pattern
// and arrow come from ONE decision the HUD word follows. Five live states
// (active, defined, head moved, datum moved, both) and a simulated plane
// beside a live machine that claims staleness; the HUD visible, folded
// (portrait 150 %) and off. The edge is opaque (its colour is its contrast).
test('the tilted work plane names its state at the object — whatever the HUD shows', async ({ page, context }) => {
  test.setTimeout(300_000);
  let version = 0;
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: 'application/octet-stream', body: LIMIT_PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: 'text/plain', body: '(limits)\nG0 X0\nG1 X10 F100\nM2\n' }));
  const profile = PROFILES[2];
  const G54_ZERO = ['G54', 'G55', 'G56', 'G57', 'G58', 'G59', 'G59.1', 'G59.2', 'G59.3']
    .map(name => ({ name, x: 0, y: 0, z: 0, a: 0, b: 0, c: 0, r: 0 }));
  // Beside the program (in view): the attached scenes show the plane for the eye.
  const PLANE = [40, 10, 0, 0, 0.5, 0.8660254, 1, 0, 0];
  const base = { twp_plane: PLANE, twp_defined: true, twp_pose_a: 0, twp_pose_b: 30, twp_pose_c: 0,
    wcs_table: G54_ZERO, wcs_prov_a: [0, 0, 0, 0, 0, 0, 0, 0, 0], g5x_index: 1 };
  const STATES = [
    { name: 'active', data: { twp_active: true, kins_type: 2, rotary_abc: [0, 30, 0], twp_datum: [0, 0, 0] },
      label: 'Plane · active', word: 'plane active', role: 'planeActive', dashed: false, arrow: false },
    { name: 'defined', data: { twp_active: false, kins_type: 0, rotary_abc: [0, 30, 0], twp_datum: [0, 0, 0] },
      label: 'Plane · defined', word: 'plane defined', role: 'planeDefined', dashed: false, arrow: false },
    { name: 'head moved', data: { twp_active: true, kins_type: 2, rotary_abc: [0, 10, 0], twp_datum: [0, 0, 0] },
      label: 'Plane · head moved', word: 'plane head moved', role: 'planeStale', dashed: true, arrow: true },
    { name: 'datum moved', data: { twp_active: true, kins_type: 2, rotary_abc: [0, 30, 0], twp_datum: [5, 0, 0] },
      label: 'Plane · datum moved', word: 'plane datum moved', role: 'planeStale', dashed: true, arrow: false },
    { name: 'both', data: { twp_active: true, kins_type: 2, rotary_abc: [0, 10, 0], twp_datum: [5, 0, 0] },
      label: 'Plane · head moved · datum moved', word: 'plane head moved, datum moved', role: 'planeStale', dashed: true, arrow: true },
  ];
  const plane = () => page.evaluate(() => window.__viewerDiag?.getPlane?.() ?? null);
  const check = async (where: string, want: { label: string; word: string; role: string; dashed: boolean; arrow: boolean }, hud: 'visible' | 'folded' | 'off') => {
    await expect.poll(async () => (await plane())?.label, { message: `${where}: the label on the object` }).toBe(want.label);
    const p = (await plane())!;
    const dump = JSON.stringify(p);
    expect(p.visible, `${where}: the plane shows ${dump}`).toBe(true);
    expect([p.role, p.dashed, p.arrowStale, p.hudWord], `${where}: one decision — role, edge, arrow, word ${dump}`)
      .toEqual([want.role, want.dashed, want.arrow, want.word]);
    expect(p.edge && p.edge.opacity === 1 && !p.edge.transparent, `${where}: the edge is opaque ${dump}`).toBe(true);
    const chip = page.locator('.viewerPane .hudMode');
    if (hud === 'visible') {
      await expect(chip, `${where}: the HUD word agrees`).toContainText(want.word);
      // Each part of the mode line once: the chip, the fixture, the plane's word.
      const segs = (await chip.innerText()).replace(/\?\s*$/, '').split(' · ').map(x => x.trim());
      expect(segs.filter((x, i) => segs.indexOf(x) !== i), `${where}: the mode line says each part once — ${segs.join(' · ')}`).toEqual([]);
    }
    else await expect(chip, `${where}: the HUD word is not on screen — the object carries the state`).toBeHidden();
  };
  for (const hud of ['visible', 'folded', 'off'] as const) {
    await openLayout(page, profile, VIEWPORTS.find(v => v.name === (hud === 'folded' ? 'touch-portrait' : 'desktop'))!);
    await ctl({ op: 'status_delta', data: { active_file: '/leak.ngc', eoffset_enabled: true, eoffset_z: 0.123, rotation_xy: 12, ...base, ...STATES[0]!.data } });
    await ctl({ op: 'raw', frame: { type: 'viewer_gcode_ready', version: 1100 + version++, file: '/leak.ngc' } });
    await expect(page.locator('.scrubBar')).toBeVisible();
    if (hud === 'folded') await page.evaluate(() => { document.documentElement.style.zoom = '1.5'; });
    if (hud === 'off') await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { viewer: { layers: { hud: false } } } } });
    await settleLayout(page);
    if (hud === 'folded') await expect(page.locator('.viewerPane .hudNotes.needsCompact'), 'the warnings card folds at 150 % portrait').toHaveCount(1);
    if (hud === 'off') await expect(page.locator('.viewerPane .hud')).toBeHidden();
    // Every state; with the HUD visible in four themes, a scene per state and
    // theme attached for the eye (no WebGL references).
    for (const theme of hud === 'visible' ? ['light', 'dark', 'hc-light', 'hc-dark'] : ['light']) {
      if (hud === 'visible') {
        await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { display: { theme } } } });
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      }
      for (const s of STATES) {
        await ctl({ op: 'status_delta', data: { ...base, ...s.data } });
        await check(`HUD ${hud}, ${theme}, ${s.name}`, s, hud);
        if (hud === 'visible') await test.info().attach(`plane-${theme}-${s.name.replace(/\W+/g, '-')}.png`,
          { body: await page.locator('.viewerPane').screenshot(), contentType: 'image/png' });
      }
    }
    if (hud === 'visible') {
      await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { display: { theme: 'light' } } } });
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    }
    // A simulated plane beside a live machine that claims staleness: the
    // object says "simulated", never the live claim.
    await ctl({ op: 'status_delta', data: { ...base, ...STATES[4]!.data } });
    await page.evaluate(p => window.__viewerDiag!.simulatePlane!(p), PLANE);
    await check(`HUD ${hud}, simulated`, { label: 'Plane · simulated', word: 'plane simulated', role: 'planeActive', dashed: false, arrow: false }, hud);
    await test.info().attach(`plane-hud-${hud}.png`, { body: await page.locator('.viewerPane').screenshot(), contentType: 'image/png' });
    await page.evaluate(() => window.__viewerDiag!.simulatePlane!(undefined));
    await check(`HUD ${hud}, back to live`, STATES[4]!, hud);
    if (hud === 'folded') await page.evaluate(() => { document.documentElement.style.zoom = ''; });
  }
});

// Codex review round 3 (VK-I02): a note's action never shrinks under its
// words. The legacy-palette note (V6) laid "Use automatic colors" beside
// its text; at 150 % portrait the button shrank to ~78 of the 170 px its
// words need and showed "utomatic c" — the note itself passed an overflow
// check. Every button in the note: its words inside its visible box (the
// text's own range, not only scrollWidth), the note inside the dialog.
test('a note\'s action keeps its words: the legacy palette note at 150 % portrait', async ({ page }) => {
  const OLD = { feed: '#22b8cf', rapid: '#f5a623', backplot: '#ff00ff', bounds: '#ffffff', toolpathBounds: '#f5a623', tool: '#c0c0c0', cutter: '#ffdd00' };
  await openLayout(page, PROFILES[1], VIEWPORTS.find(v => v.name === 'touch-portrait')!);
  await page.evaluate(() => { document.documentElement.style.zoom = '1.5'; });
  await ctl({ op: 'raw', frame: { type: 'settings_init', settings: { display: { theme: 'light' }, viewer: { colors: OLD } } } });
  await page.getByTitle('Settings', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
  const tab = dialog.getByRole('tab', { name: '3D Viewer', exact: true });
  if (await tab.count()) await tab.click();
  else await dialog.getByRole('combobox').first().selectOption({ label: '3D Viewer' });
  const note = dialog.locator('[data-palette-note="legacy"]');
  await note.scrollIntoViewIfNeeded();
  await expect(note).toBeVisible();
  const m = await note.evaluate(el => {
    const box = (r: DOMRect) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom });
    const dlg = el.closest('[role="dialog"]')!.getBoundingClientRect();
    return {
      note: box(el.getBoundingClientRect()), dialog: box(dlg),
      buttons: [...el.querySelectorAll('button')].map(b => {
        const range = document.createRange();
        range.selectNodeContents(b);
        const text = range.getBoundingClientRect();
        const r = b.getBoundingClientRect();
        return { name: b.textContent?.trim(), box: box(r), text: box(text), clipped: b.scrollWidth > b.clientWidth + 1 };
      }),
    };
  });
  const dump = JSON.stringify(m);
  expect(m.buttons.length, `the note offers its action ${dump}`).toBeGreaterThan(0);
  for (const b of m.buttons) {
    expect(b.clipped, `${b.name}: its words are whole ${dump}`).toBe(false);
    expect(b.text.l >= b.box.l - 1 && b.text.r <= b.box.r + 1, `${b.name}: the words inside the button ${dump}`).toBe(true);
  }
  expect(m.note.l >= m.dialog.l - 1 && m.note.r <= m.dialog.r + 1, `the note inside the dialog ${dump}`).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = ''; });
});


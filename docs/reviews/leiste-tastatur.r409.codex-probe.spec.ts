// The bottom strip fits at Full HD with one to three linear axes (operator
// 2026-11-16: "zumindest bis 3 Achsen ohne Überlaufen"; plan leiste-tastatur
// R405/R406). The promise: X, XY and XYZ without a kinematics choice, at
// 1920 px in touch sizes (the machine's panel, full screen and in a
// maximised window) and in desktop sizes (before the first touch) — no
// sideways overflow, at least RESERVE px between the last section and the
// strip's content edge, every section one width in every state, nothing
// clipped sideways. A rotary axis (XYA), a kinematics choice and four or more
// axes keep scrolling: measured and reported, never required.
import { test, expect, type Page } from './test';
import { ctl, publishToolTable } from './ctl';
import { VIEWPORTS, openLayout, setLayoutState, enterStripState, leaveStripState, settleLayout,
  type Profile, type LayoutState, type LayoutViewport } from './layout-fixtures';

/** The least room the strip keeps free at its end (CSS px). The two
 *  engines measured 18 px apart on the VM (R405); the panel's fonts are
 *  calibrated on the machine day before this is tuned. */
const RESERVE = 24;

const LINEAR: Profile[] = [
  { name: '1axis-x', axes: ['X'], kins: null },
  { name: '2axis-xy', axes: ['X', 'Y'], kins: null },
  { name: '3axis-xyz', axes: ['X', 'Y', 'Z'], kins: null },
];
const FULLHD: LayoutViewport[] = [
  VIEWPORTS.find(v => v.name === 'touch-fullhd')!,
  VIEWPORTS.find(v => v.name === 'touch-fullhd-window')!,
  { name: 'fullhd-desktop', width: 1920, height: 1080, touch: false },
];
const STATES: LayoutState[] = ['homed', 'unhomed', 'off', 'estop', 'disarmed', 'running', 'paused', 'homed'];

/** The widest values a tool row shows (R405: "Other offset" is the widest
 *  offset word; the description keeps its ellipsis — its own rule). */
const TOOL = { T: 123, P: 123, D: 25.4, Z: -1234.567, type: 'cornerchamfer', description: 'Twelve mm three flute carbide roughing end mill' };
const OFFSETS: Record<string, Record<string, unknown>> = {
  'offset G43': { tool_offset: [0, 0, TOOL.Z, 0, 0, 0, 0, 0, 0], gcodes: [430] },
  'offset G43.1': { tool_offset: [0, 0, TOOL.Z, 0, 0, 0, 0, 0, 0], gcodes: [431] },
  'offset G49': { tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], gcodes: [490] },
  'offset other': { tool_offset: [0, 0, -2345.678, 0, 0, 0, 0, 0, 0], gcodes: [430] },
};

interface Fit {
  over: number; spare: number;
  sections: { name: string; width: number }[];
  clipped: string[];
  /** Tool rows on more than one line — required away only WITHOUT a note
   *  (Codex R407/R408: under a note's scrollbar a long type name may wrap) */
  wraps: string[];
  /** how far the Tool body scrolls (scrollHeight − clientHeight, CSS px) */
  toolScroll: number;
}

/** The strip's fit: overflow, the room after the last section (to the
 *  CONTENT edge — padding and border excluded), each section's width and
 *  every control or tool row cut sideways. A field's own value and the
 *  tool description's ellipsis are exempt (their own rules). */
async function measureFit(page: Page): Promise<Fit> {
  await settleLayout(page);
  return page.evaluate(() => {
    const strip = document.querySelector('.strip') as HTMLElement;
    const cs = getComputedStyle(strip);
    const sections = [...strip.children].filter(c => !c.classList.contains('stripFade') && c.getBoundingClientRect().width > 0) as HTMLElement[];
    const box = strip.getBoundingClientRect();
    const contentRight = box.left + strip.clientLeft + strip.clientWidth - parseFloat(cs.paddingRight);
    const last = sections[sections.length - 1]!.getBoundingClientRect().right;
    const clipped: string[] = [];
    const wraps: string[] = [];
    for (const sec of sections) {
      // What an element SHOWS against its own box: the rectangles of its
      // rendered contents (text and child boxes), never scrollWidth — a help
      // icon's invisible hit area overflows its heading by design (CLAUDE.md
      // lessons) and is no cut text. A text that ellipsizes on purpose (the
      // tool description, the jog head's note — its "?" says it whole) counts
      // with its own box, not its hidden words.
      const ellipsized = (e: Element) => { const c = getComputedStyle(e); return c.textOverflow === 'ellipsis' && c.overflowX !== 'visible'; };
      const shown = (node: Node, out: DOMRect[]) => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            const r = document.createRange(); r.selectNodeContents(child);
            out.push(...[...r.getClientRects()].filter(q => q.width > 0 && q.height > 0));
          } else if (child instanceof Element) {
            const cs = getComputedStyle(child);
            if (cs.display === 'none' || cs.visibility === 'hidden') continue;
            if (ellipsized(child)) { out.push(child.getBoundingClientRect()); continue; }
            if (child.children.length === 0 && !child.textContent?.trim()) { const b = child.getBoundingClientRect(); if (b.width > 0) out.push(b); continue; }
            shown(child, out);
          }
        }
        return out;
      };
      for (const el of sec.querySelectorAll<HTMLElement>('button, .choice, .label-muted, .val-status, .statusRow, .sub')) {
        if (ellipsized(el) || el.closest('[aria-hidden="true"]')) continue;
        if (el.offsetParent === null) continue;
        const b = el.getBoundingClientRect();
        const rects = shown(el, []);
        if (!rects.length) continue;
        const left = Math.min(...rects.map(q => q.left)), right = Math.max(...rects.map(q => q.right));
        if (left < b.left - 0.5 || right > b.right + 0.5) clipped.push(`${sec.dataset.strip ?? sec.className.split(' ')[0]}: ${el.className.split(' ')[0] || el.tagName} "${(el.textContent ?? '').trim().slice(0, 40)}" content ${Math.round(left)}–${Math.round(right)} past its box ${Math.round(b.left)}–${Math.round(b.right)}`);
        // how many lines a Tool row takes (R405: the offset word behind the
        // length made the widest row — the "In effect" row is the contract);
        // judged apart from a sideways cut (Codex R408 LT-I01)
        if (el.classList.contains('statusRow') && sec.dataset.strip === 'tool') {
          const fs = parseFloat(getComputedStyle(el).fontSize);
          const mids = rects.filter(q => q.height < 2 * fs).map(q => (q.top + q.bottom) / 2).sort((a, b) => a - b);
          const lines = 1 + mids.slice(1).filter((m, i) => m - mids[i]! > 0.6 * fs).length;
          if (lines > 1) wraps.push(`tool: statusRow "${(el.textContent ?? '').trim().slice(0, 40)}" wraps onto ${lines} lines`);
        }
      }
    }
    const body = document.querySelector('[data-strip="tool"] .toolBody') as HTMLElement | null;
    return {
      wraps,
      toolScroll: body ? body.scrollHeight - body.clientHeight : -1,
      over: strip.scrollWidth - strip.clientWidth,
      spare: Math.round((contentRight - last) * 10) / 10,
      sections: sections.map(s => ({ name: s.dataset.strip ?? s.className.split(' ')[0]!, width: Math.round(s.getBoundingClientRect().width * 100) / 100 })),
      clipped,
    };
  });
}

function judge(label: string, fit: Fit, widths: Fit['sections'] | null) {
  expect(fit.over, `${label}: the strip runs ${fit.over} px past its width`).toBeLessThanOrEqual(0);
  expect(fit.spare, `${label}: ${fit.spare} px free after the last section, ${RESERVE} required`).toBeGreaterThanOrEqual(RESERVE);
  expect(fit.clipped, `${label}: cut sideways`).toEqual([]);
  // without a note every Tool row is one line
  expect(fit.wraps, `${label}: a Tool row wraps without a note`).toEqual([]);
  if (widths) expect(fit.sections, `${label}: a section changed its width with the state`).toEqual(widths);
  // without a note the tool rows fit the section: its body has nothing to scroll
  expect(fit.toolScroll, `${label}: the Tool body scrolls ${fit.toolScroll} px without a note`).toBeLessThanOrEqual(0.5);
}

async function loadTool(page: Page, offset: Record<string, unknown>) {
  await ctl({ op: 'status_delta', data: { tool_in_spindle: TOOL.T, tool_number: TOOL.T, tool_diameter: TOOL.D,
    tool_length: TOOL.Z, tool_table_z: TOOL.Z, ...offset } });
  await expect(page.locator('[data-strip="tool"]')).toContainText(`T${TOOL.T}`);
  await expect(page.locator('[data-strip="tool"]')).toContainText('25.4');
}

for (const profile of LINEAR) {
  for (const viewport of FULLHD) {
    test(`codex R409: ${profile.name} @ ${viewport.name} — no overflow, ${RESERVE} px spare, one width per section in every state`, async ({ page }, info) => {
      test.setTimeout(120_000);
      const evidence: { state: string; fit: Fit }[] = [];
      try {
        await openLayout(page, profile, viewport);
        const first = await measureFit(page);
        evidence.push({ state: 'homed', fit: first });
        judge(`${viewport.name} homed`, first, null);
        for (const state of STATES) {
          await setLayoutState(page, profile, state);
          const fit = await measureFit(page);
          evidence.push({ state, fit });
          judge(`${viewport.name} ${state}`, fit, first.sections);
        }
        for (const state of ['joint-jog', 'spindle-preselect', 'banner-message'] as const) {
          await enterStripState(page, profile, state);
          const fit = await measureFit(page);
          evidence.push({ state, fit });
          judge(`${viewport.name} ${state}`, fit, first.sections);
          await leaveStripState(page, profile, state);
        }
        await publishToolTable([TOOL]);
        for (const [name, offset] of Object.entries(OFFSETS)) {
          await loadTool(page, offset);
          const fit = await measureFit(page);
          evidence.push({ state: name, fit });
          judge(`${viewport.name} ${name}`, fit, first.sections);
        }
        await setLayoutState(page, profile, 'running');
        const fit = await measureFit(page);
        evidence.push({ state: 'offset other, running', fit });
        judge(`${viewport.name} offset other, running`, fit, first.sections);
      } finally {
        await info.attach('strip-fit.json', { body: JSON.stringify(evidence, null, 1), contentType: 'application/json' });
      }
    });
  }
}

// Inch (the gateway reports "in"): its own step options and unit words.
// The sections keep the millimetre widths.
test('codex R409: 3axis-xyz @ touch-fullhd — inch keeps the millimetre widths', async ({ page }, info) => {
  const profile = LINEAR[2]!;
  const viewport = FULLHD[0]!;
  await openLayout(page, profile, viewport);
  const mm = await measureFit(page);
  judge('mm', mm, null);
  await ctl({ op: 'setViewerInit', data: { units: 'in', stl_base_url: '/machine/', parts: [], kinematics: [], axes: ['X', 'Y', 'Z'],
    machine_bounds: { origin: [0, 0, 0], size: [100, 100, 100] }, ini_config: { linear_units: 'in' } } });
  await expect(page.locator('[data-strip="jog"] .stepBlock')).toContainText('Step (in)');
  await setLayoutState(page, profile, 'homed');
  await publishToolTable([TOOL]);
  const evidence: { state: string; fit: Fit }[] = [];
  for (const [name, offset] of Object.entries(OFFSETS)) {
    await loadTool(page, offset);
    const fit = await measureFit(page);
    evidence.push({ state: name, fit });
    judge(`inch ${name}`, fit, mm.sections);
  }
  await setLayoutState(page, profile, 'running');
  judge('inch running', await measureFit(page), mm.sections);
  await info.attach('strip-fit-inch.json', { body: JSON.stringify(evidence, null, 1), contentType: 'application/json' });
});

// A checked option keeps every option's place (R405 S2): the selection moves
// no option of the step, the mode or the work offsets — not only the
// section's width.
test('codex R409: 3axis-xyz @ touch-fullhd — a checked choice moves no option', async ({ page }) => {
  const profile = LINEAR[2]!;
  await openLayout(page, profile, FULLHD[0]!);
  const options = (label: string) => page.getByRole('radiogroup', { name: label, exact: true }).getByRole('radio');
  const boxes = (label: string) => options(label).evaluateAll(els => els.map(e => {
    const r = e.getBoundingClientRect();
    return `${e.textContent?.trim()} ${Math.round(r.left * 100) / 100} ${Math.round(r.width * 100) / 100}`;
  }));
  const groups = ['Jog step', 'Task mode', 'Work offset'];
  const before: Record<string, string[]> = {};
  for (const g of groups) before[g] = await boxes(g);
  // the step: a local choice — every option in turn
  for (const name of await options('Jog step').allTextContents()) {
    await options('Jog step').filter({ hasText: new RegExp(`^${name.trim().replace('.', '\\.')}$`) }).click();
    await expect(options('Jog step').filter({ hasText: new RegExp(`^${name.trim().replace('.', '\\.')}$`) })).toHaveAttribute('aria-checked', 'true');
    for (const g of groups) expect(await boxes(g), `step ${name}: ${g}`).toEqual(before[g]);
  }
  // the mode and the work offset: what the status reports
  for (const [mode, word] of [[2, 'Auto'], [3, 'MDI'], [1, 'Manual']] as const) {
    await ctl({ op: 'status_delta', data: { task_mode: mode } });
    await expect(options('Task mode').filter({ hasText: word })).toHaveAttribute('aria-checked', 'true');
    for (const g of groups) expect(await boxes(g), `mode ${word}: ${g}`).toEqual(before[g]);
  }
  for (let i = 1; i <= 9; i++) {
    await ctl({ op: 'status_delta', data: { g5x_index: i } });
    await expect(options('Work offset').nth(i - 1)).toHaveAttribute('aria-checked', 'true');
    for (const g of groups) expect(await boxes(g), `work offset ${i}: ${g}`).toEqual(before[g]);
  }
});

// The tool table's error note (R405 LT405-01): a long path or a long message
// never widens the strip, and the note, its Retry and every tool row come
// fully into view by scrolling the Tool section's body — with and without a
// loaded tool.
// Gateway messages (the note shows "Tool table: " before them): a path (96
// characters), a long message of words (689), and Codex's R405 inputs — ONE
// unbroken path token of 108 and of 372 characters.
const CODEX_PATH = (n: number) => 'Tool table file unreadable: permission denied on /home/cnc/linuxcnc/configs/' + 'customer_fixture_123456/'.repeat(n) + 'tool.tbl';
const NOTES = {
  path: 'Tool table file unreadable: permission denied on /home/cnc/linuxcnc/configs/x/very/long/tool.tbl',
  long: 'Tool table file unreadable: ' + Array.from({ length: 12 }, (_, i) => `line ${i + 1} of a long gateway message about the tool table`).join('; '),
  'unbroken 108': CODEX_PATH(1),
  'unbroken 372': CODEX_PATH(12),
};
/** One error-note case: the note never widens the strip; each of its lines,
 *  Retry and every row (or the empty state) come whole into view by
 *  scrolling; Retry hit-testable. A row may wrap under the note (R408). */
async function noteCase(page: Page, loadedTool: typeof TOOL | null, error: string): Promise<Fit> {
  const profile = LINEAR[2]!;
  await openLayout(page, profile, FULLHD[0]!);
  if (loadedTool) { await publishToolTable([loadedTool]); await loadTool(page, OFFSETS['offset other']!); }
  const clean = await measureFit(page);
  await ctl({ op: 'replyFor', cmd: 'get_tool_table', reply: { ok: false, error } });
  await ctl({ op: 'raw', frame: { type: 'tool_table_changed', version: 9000 + (loadedTool ? 1 : 0) } });
  const tool = page.locator('[data-strip="tool"]');
  await expect(tool.locator('.statusNote')).toBeVisible();
  const fit = await measureFit(page);
  expect(fit.over, 'the note widens the strip').toBeLessThanOrEqual(clean.over);
  expect(fit.sections, 'the note changes a section width').toEqual(clean.sections);
  // the body's scrollbar, once it shows, cuts no row sideways; a row may
  // wrap there (Codex R407/R408) and is still reached whole below
  expect(fit.clipped, 'cut sideways under the note').toEqual([]);
  // The note, line by line (Codex R406): a note taller than the window is
  // read over successive scroll positions — each text line, brought to the
  // window's top, lies whole in the window and the strip.
  const lines = await tool.locator('.statusNote').evaluate(note => {
    const strip = document.querySelector('.strip') as HTMLElement;
    let scroller: HTMLElement | null = note.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!scroller || scroller === strip || !strip.contains(scroller)) return [{ ok: false, why: 'the note has no scroll area of its own in the Tool section' }];
    const area = scroller;
    const range = document.createRange();
    range.selectNodeContents(note.querySelector(':scope > span') ?? note);   // the note's words, without Retry
    const lineRects = () => {
      const byTop = new Map<number, { top: number; bottom: number; left: number; right: number }>();
      for (const q of range.getClientRects()) {
        if (q.width === 0) continue;
        const k = Math.round(q.top);
        const l = byTop.get(k);
        byTop.set(k, l ? { top: Math.min(l.top, q.top), bottom: Math.max(l.bottom, q.bottom), left: Math.min(l.left, q.left), right: Math.max(l.right, q.right) }
          : { top: q.top, bottom: q.bottom, left: q.left, right: q.right });
      }
      return [...byTop.values()].sort((x, y) => x.top - y.top);
    };
    const out: { ok: boolean; why: string }[] = [];
    const count = lineRects().length;
    for (let i = 0; i < count; i++) {
      area.scrollTop += lineRects()[i]!.top - (area.getBoundingClientRect().top + area.clientTop);   // line i to the window's top
      const line = lineRects()[i]!;
      const a = area.getBoundingClientRect(), st = strip.getBoundingClientRect();
      const win = { top: a.top + area.clientTop, bottom: a.top + area.clientTop + area.clientHeight, left: a.left + area.clientLeft, right: a.left + area.clientLeft + area.clientWidth };
      const within = (o: { top: number; bottom: number; left: number; right: number }) =>
        line.top >= o.top - 0.5 && line.bottom <= o.bottom + 0.5 && line.left >= o.left - 0.5 && line.right <= o.right + 0.5;
      const ok = within(win) && within(st);
      out.push({ ok, why: ok ? '' : `line ${i + 1}: ${Math.round(line.top)}–${Math.round(line.bottom)} × ${Math.round(line.left)}–${Math.round(line.right)}; window ${Math.round(win.top)}–${Math.round(win.bottom)} × ${Math.round(win.left)}–${Math.round(win.right)}` });
    }
    area.scrollTop = 0;
    return out;
  });
  expect(lines.length, 'the note has text lines').toBeGreaterThan(0);
  expect(lines.filter(l => !l.ok).map(l => l.why), 'a note line out of reach').toEqual([]);
  const targets = [tool.getByRole('button', { name: 'Retry', exact: true }),
    ...(loadedTool ? Array.from({ length: await tool.locator('.statusRow').count() }, (_, i) => tool.locator('.statusRow').nth(i)) : [tool.locator('.emptyState')])];
  for (const t of targets) {
    await t.evaluate(el => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    await settleLayout(page);
    const seen = await t.evaluate(el => {
      const r = el.getBoundingClientRect();
      const inside = (outer: DOMRect) => r.top >= outer.top - 0.5 && r.bottom <= outer.bottom + 0.5 && r.left >= outer.left - 0.5 && r.right <= outer.right + 0.5;
      let p: HTMLElement | null = el.parentElement;
      const clips: string[] = [];
      while (p) {
        const s = getComputedStyle(p);
        if ((s.overflowX !== 'visible' || s.overflowY !== 'visible') && !inside(p.getBoundingClientRect())) clips.push(p.className.split(' ')[0] || p.tagName);
        p = p.parentElement;
      }
      const vis = r.top >= 0 && r.bottom <= innerHeight + 0.5 && r.left >= 0 && r.right <= innerWidth + 0.5;
      return { clips, vis, text: (el.textContent ?? '').trim().slice(0, 30) };
    });
    expect(seen.clips, `"${seen.text}" cut by its scroller`).toEqual([]);
    expect(seen.vis, `"${seen.text}" off the screen`).toBe(true);
  }
  // Retry is operable where it shows: its centre hits the button itself
  const retry = tool.getByRole('button', { name: 'Retry', exact: true });
  await retry.evaluate(el => el.scrollIntoView({ block: 'nearest' }));
  expect(await retry.evaluate(el => {
    const r = el.getBoundingClientRect();
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!at && (at === el || el.contains(at));
  }), 'Retry hit-testable').toBe(true);
  return fit;
}

for (const loaded of [false, true]) {
  for (const [kind, error] of Object.entries(NOTES)) {
    test(`codex R409: 3axis-xyz @ touch-fullhd — the ${kind} error note${loaded ? ' over a loaded tool' : ''}: the strip keeps its width, note, Retry and rows reachable`, async ({ page }) => {
      await noteCase(page, loaded ? TOOL : null, error);
    });
  }
}

// The accepted wrap (Codex R407/R408): the longest built-in type name under
// the note's scrollbar may take two lines — nothing cut sideways, every
// row reached whole. Its wrap is reported, not required.
test('codex R409: 3axis-xyz @ touch-fullhd — the unbroken 372 error note over a corner chamfer end mill: its type may wrap, nothing cut, every row reachable', async ({ page }, info) => {
  const fit = await noteCase(page, { ...TOOL, type: 'cornerchamfer' }, NOTES['unbroken 372']);
  await expect(page.locator('[data-strip="tool"]')).toContainText('Corner Chamfer End Mill');
  info.annotations.push({ type: 'wraps', description: fit.wraps.join('; ') || 'none' });
});

// Named, not required: a rotary axis (XYA) keeps scrolling. The measurement
// is reported so a change in either direction is seen.
test('codex R409: 3axis-xya @ touch-fullhd — measured, not required', async ({ page }, info) => {
  const profile: Profile = { name: '3axis-xya', axes: ['X', 'Y', 'A'], kins: null };
  await openLayout(page, profile, FULLHD[0]!);
  const fit = await measureFit(page);
  info.annotations.push({ type: 'xya', description: `over ${fit.over} px, spare ${fit.spare} px, sections ${fit.sections.map(s => `${s.name} ${s.width}`).join(', ')}` });
  await info.attach('strip-fit-xya.json', { body: JSON.stringify(fit, null, 1), contentType: 'application/json' });
  expect(fit.sections.length).toBe(6);
});

// The lengths the record names are the guard's own (Codex R407: the report
// said 108 and 372 where the guard held 96 and 689).
test('codex R409: the error notes are the lengths the record names', () => {
  expect(Object.fromEntries(Object.entries(NOTES).map(([k, v]) => [k, v.length])))
    .toEqual({ path: 96, long: 689, 'unbroken 108': 108, 'unbroken 372': 372 });
});

// The Tool body scrolls under a real gesture (advisor 2026-11-19: the guard
// above set scrollTop): a touch drag and the mouse wheel inside it move the
// body, never the strip — on XYZAC, whose strip itself scrolls sideways.
// Chromium (CDP): the browser synthesizes the touch gesture, no touch context
// needed — this file is in the Firefox core, which takes no touch call; the
// core does not list this test.
test('codex R409: 5axis-xyzac @ touch-fullhd — a touch drag and the wheel scroll the Tool body, not the strip', async ({ page }) => {
    const profile: Profile = { name: '5axis-xyzac', axes: ['X', 'Y', 'Z', 'A', 'C'],
      kins: { module: 'xyzac-trt-kins', type: 'xyzac-trt', identity_first: true, params: {} } };
    await openLayout(page, profile, FULLHD[0]!);
    await publishToolTable([TOOL]);
    await loadTool(page, OFFSETS['offset other']!);
    await ctl({ op: 'replyFor', cmd: 'get_tool_table', reply: { ok: false, error: NOTES['unbroken 372'] } });
    await ctl({ op: 'raw', frame: { type: 'tool_table_changed', version: 9100 } });
    const tool = page.locator('[data-strip="tool"]');
    await expect(tool.locator('.statusNote')).toBeVisible();
    const strip = page.locator('.strip');
    await strip.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await settleLayout(page);
    const read = () => page.evaluate(() => ({
      body: (document.querySelector('[data-strip="tool"] .toolBody') as HTMLElement).scrollTop,
      strip: (document.querySelector('.strip') as HTMLElement).scrollLeft,
    }));
    const start = await read();
    expect(start.strip, 'the strip scrolled to its end').toBeGreaterThan(0);
    expect(start.body).toBe(0);
    const body = (await tool.locator('.toolBody').boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(body.x + body.width / 2), y: Math.round(body.y + body.height * 0.8),
      yDistance: -120, gestureSourceType: 'touch', speed: 600 });
    await expect.poll(async () => (await read()).body, { message: 'a touch drag scrolls the Tool body' }).toBeGreaterThan(0);
    expect((await read()).strip, 'the strip stays where it was').toBe(start.strip);
    const afterTouch = (await read()).body;
    await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2);
    await page.mouse.wheel(0, 120);
    await expect.poll(async () => (await read()).body, { message: 'the wheel scrolls the Tool body' }).toBeGreaterThan(afterTouch);
    expect((await read()).strip, 'the strip stays where it was').toBe(start.strip);
});

// S1 (plan R405): the gap before the end fade is gone, the fade is not. On
// XYZAC, whose strip overflows at 1920 px: shown at the strip's content edge
// (where it sat before S1) while more lies to the right, gone at the scroll end; in portrait the
// bottom fade keeps no horizontal shift.
test('codex R409: 5axis-xyzac @ touch-fullhd — the end fade shows at the content edge while more lies right, gone at the end', async ({ page }) => {
  const profile: Profile = { name: '5axis-xyzac', axes: ['X', 'Y', 'Z', 'A', 'C'],
    kins: { module: 'xyzac-trt-kins', type: 'xyzac-trt', identity_first: true, params: {} } };
  await openLayout(page, profile, FULLHD[0]!);
  const fade = () => page.evaluate(() => {
    const strip = document.querySelector('.strip') as HTMLElement;
    const f = strip.querySelector(':scope > .stripFade') as HTMLElement;
    const r = f.getBoundingClientRect(), s = strip.getBoundingClientRect();
    return { more: strip.classList.contains('strip-more'), opacity: getComputedStyle(f).opacity,
      right: Math.round(r.right * 10) / 10,
      // the content edge: the scrollport less the strip's end padding (where the
      // fade sat before S1 too — 1903 of 1911 px at 5c48a7e1 and at the head)
      edge: Math.round((s.left + strip.clientLeft + strip.clientWidth - parseFloat(getComputedStyle(strip).paddingRight)) * 10) / 10 };
  });
  const at0 = await fade();
  expect(at0.more, 'more lies to the right').toBe(true);
  await expect.poll(async () => (await fade()).opacity).toBe('1');
  expect(Math.abs(at0.right - at0.edge), `the fade at the strip's content edge (${at0.right} vs ${at0.edge})`).toBeLessThanOrEqual(0.5);
  await page.locator('.strip').evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await expect.poll(async () => (await fade()).more, { message: 'nothing more at the end' }).toBe(false);
  await expect.poll(async () => (await fade()).opacity).toBe('0');
  // portrait: the bottom fade, no horizontal shift
  await page.setViewportSize({ width: 900, height: 1200 });
  await settleLayout(page);
  expect(await page.locator('.strip > .stripFade').evaluate(f => getComputedStyle(f).marginLeft), 'portrait: no horizontal shift').toBe('0px');
});


// Independent reachability check: the approved type wraps but all its text
// and the entire row can still be brought into the real scroll window.
test('codex R409: approved wrapped type remains reachable', async ({page}, info) => {
  await openLayout(page, LINEAR[2]!, FULLHD[0]!);
  await publishToolTable([TOOL]); await loadTool(page, OFFSETS['offset other']!);
  await ctl({op:'replyFor',cmd:'get_tool_table',reply:{ok:false,error:NOTES['unbroken 372']}});
  await ctl({op:'raw',frame:{type:'tool_table_changed',version:9300}});
  const tool=page.locator('[data-strip="tool"]');
  await expect(tool.locator('.statusNote')).toContainText(NOTES['unbroken 372']);
  const row=tool.locator('.statusRow').filter({hasText:'Corner Chamfer End Mill'});
  await row.scrollIntoViewIfNeeded();
  const result=await row.evaluate(el=>{
    const body=el.closest('.toolBody') as HTMLElement, r=el.getBoundingClientRect(),b=body.getBoundingClientRect();
    const range=document.createRange(); range.selectNodeContents(el);
    return {height:r.height, rowWidth:r.width, bodyHeight:body.clientHeight,
      vertical:r.top>=b.top+body.clientTop-.5&&r.bottom<=b.top+body.clientTop+body.clientHeight+.5,
      horizontal:[...range.getClientRects()].every(q=>q.left>=r.left-.5&&q.right<=r.right+.5),
      bandOverflow:(document.querySelector('.strip') as HTMLElement).scrollWidth-(document.querySelector('.strip') as HTMLElement).clientWidth,
      text:el.textContent};
  });
  await info.attach('approved-wrapped-type.json',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  expect(result.height).toBe(39);
  expect(result.vertical).toBe(true);expect(result.horizontal).toBe(true);expect(result.bandOverflow).toBe(0);
});

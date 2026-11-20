// Stage B proof (answer to Codex R411 LA411-01/-02, R412): the scrolling
// forms F2–F4 as HARD assertions over the whole scroll path. Prototypes by
// injected CSS/DOM on dc9dc3e4 — nothing here ships.
//   today  dc9dc3e4 as merged (F4 for every case that overflows)
//   r411   the R411 prototypes (M2/M3 + mandatory snap), Codex's counter-cases
//   b1     the new construction: the form from base widths; pinned sections
//          LAST in visual order (F3: Spindle before Overrides via `order`);
//          a reserved jog Stop in Safety's free bottom row (F2–F4);
//          scroll-padding = the pinned sides
// Contract checked at every sample (start, 24 even steps, end, focus cases):
//   E-Stop whole and topmost; the reserved stop (b1) or — where none exists —
//   the pad's Stop whole whenever any part of a jog button is visible;
//   F2/F3: Overrides whole, its left edge constant over the path; F2 also
//   Spindle; every section's last control whole after focus().
import { appendFileSync } from 'node:fs';
import { test, expect, type Page } from './test';
import { PROFILES, openLayout, setLayoutState, type Profile } from './layout-fixtures';
import { ctl } from './ctl';

const OUT = process.env.SHOT_DIR!;
// b2old: b2 with the R413 focus handler (:focus-visible alone); b2occ: b2 with an
// intercepting layer over Safety — both must fail
const VARIANT = (process.env.STAGE_B ?? 'b2') as 'today' | 'r411' | 'b1' | 'b2' | 'b2old' | 'b2occ';
const B2 = VARIANT === 'b2' || VARIANT === 'b2old' || VARIANT === 'b2occ';
const XYZ: Profile = { name: 'XYZ', axes: ['X', 'Y', 'Z'], kins: null };
const XYZAC: Profile = { name: 'XYZAC', axes: ['X', 'Y', 'Z', 'A', 'C'], kins: PROFILES[1].kins };
const TWP: Profile = { name: 'TWP', axes: ['X', 'Y', 'Z', 'A', 'B', 'C'], kins: PROFILES[2].kins };
const ALL_CASES = [
  { name: 'TWP1900', profile: TWP, width: 1900 },
  { name: 'TWP1920', profile: TWP, width: 1920 },
  { name: 'XYZ1280', profile: XYZ, width: 1280 },
  { name: 'XYZAC1280', profile: XYZAC, width: 1280 },
  { name: 'TWP1280', profile: TWP, width: 1280 },
  { name: 'XYZ1000', profile: XYZ, width: 1000 },
  { name: 'XYZAC1600', profile: XYZAC, width: 1600 },
  { name: 'TWP1600', profile: TWP, width: 1600 },
  { name: 'XYZABC1920', profile: { name: 'XYZABC', axes: ['X', 'Y', 'Z', 'A', 'B', 'C'], kins: null } as Profile, width: 1920 },
];
const CASES = process.env.ONLY_CASE ? ALL_CASES.filter(c => c.name === process.env.ONLY_CASE) : ALL_CASES;

const HIDE_TOOL = `.strip > [data-strip="tool"] { display: none !important; }`;
const COVER = `background: var(--panel); box-shadow: var(--gap-controls) 0 0 var(--panel);`;
const B1 = {
  F2: `.strip > .stripFade { display: none !important; }
.strip > [data-strip="spindle"] { position: sticky; right: 0; z-index: var(--z-raised); ${COVER} }
.strip > [data-strip="overrides"] { position: sticky; z-index: var(--z-raised); ${COVER} }`,
  F3: `.strip > .stripFade { display: none !important; }
.strip > [data-strip="overrides"] { order: 1; position: sticky; right: 0; z-index: var(--z-raised); ${COVER} }`,
  F4: ``,
};
const SAFETY_BTN = `.safetyBtns > [data-probe="reserved-gate"] > [data-probe="reserved-stop"] { flex: 1 !important; width: auto !important; height: auto !important; min-height: 0 !important; max-height: none !important; aspect-ratio: auto !important; align-self: stretch !important; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--gap-tight); }`;
const STOP_ROW = `.probeStopRow { display: flex; align-items: center; gap: var(--gap-controls); }
.probeStopRow > .label-muted { flex: 1; }
.probeStopRow > [data-probe="reserved-stop"] { width: auto; height: var(--control-h); min-height: 0; padding: 0 var(--gap-section); flex: 0 0 auto; }
.probeStopRow > [data-probe="reserved-stop"] .jogInner { flex-direction: row; gap: var(--gap-tight); }`;

type Form = 'F1' | 'F2' | 'F3' | 'F4';
async function formOf(page: Page, widen = false): Promise<{ form: Form; widths: Record<string, number>; cw: number }> {
  return page.evaluate((widen) => {
    const strip = document.querySelector('.strip') as HTMLElement;
    const w = (sel: string) => (document.querySelector(sel) as HTMLElement).getBoundingClientRect().width;
    const widths = { safety: w('.safetyStrip'), jog: w('[data-strip="jog"]'), setup: w('[data-strip="setup"]'), overrides: w('[data-strip="overrides"]'), spindle: w('[data-strip="spindle"]') };
    const gap = parseFloat(getComputedStyle(strip).columnGap), padR = parseFloat(getComputedStyle(strip).paddingRight);
    const cw = strip.clientWidth;
    const fits = (ws: number[]) => ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1) + padR <= cw;
    const { safety: S, jog: J, setup: Se, overrides: O, spindle: Sp } = widths;
    // the fourth Safety button of the scrolling forms: one button and one gap
    const g1 = document.querySelector('.safetyBtns > .btnGate') as HTMLElement;
    const extra = widen ? g1.getBoundingClientRect().width + parseFloat(getComputedStyle(g1.parentElement!).columnGap) : 0;
    const S2 = S + extra;
    const form = fits([S, J, Se, O, Sp]) ? 'F1' : fits([S2, J, O, Sp]) ? 'F2' : fits([S2, J, O]) ? 'F3' : 'F4';
    return { form: form as 'F1' | 'F2' | 'F3' | 'F4', widths: { ...widths, extra }, cw };
  }, widen);
}

async function applyB1(page: Page, form: Form, mode: 'row' | 'button' = 'row') {
  if (form === 'F1') return;
  if (B1[form]) await page.addStyleTag({ content: B1[form] });
  await page.addStyleTag({ content: mode === 'row' ? STOP_ROW : SAFETY_BTN });
  await page.evaluate(([form, mode]) => {
    // the reserved stop: a visual clone of the pad's Stop in Safety's last row
    const pad = [...document.querySelectorAll('[data-strip="jog"] .jogBtn')].find(b => (b.textContent ?? '').trim() === 'Stop') as HTMLElement;
    const stop = pad.cloneNode(true) as HTMLElement; stop.setAttribute('data-probe', 'reserved-stop'); stop.setAttribute('aria-label', 'Stop jog');
    if (mode === 'row') {
      const row = document.createElement('div'); row.className = 'probeStopRow';
      const label = document.createElement('span'); label.className = 'label-muted md'; label.textContent = 'Jog';
      row.append(label, stop);
      document.querySelector('.safetyStrip')!.append(row);
    } else {
      const g1 = document.querySelector('.safetyBtns > .btnGate') as HTMLElement;
      const extra = g1.getBoundingClientRect().width + parseFloat(getComputedStyle(g1.parentElement!).columnGap);
      const gate = document.createElement('div'); gate.className = g1.className; gate.setAttribute('data-probe', 'reserved-gate');
      for (const a of g1.getAttributeNames()) if (a.startsWith('data-v-')) gate.setAttribute(a, '');
      const inner = stop.querySelector('.jogInner') as HTMLElement | null;
      if (inner) inner.textContent = '';
      stop.textContent = '';
      const icon = document.createElement('span'); icon.textContent = '\u25A0'; icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'btn-label-sm'; label.textContent = 'Jog stop';
      stop.append(icon, label);
      gate.append(stop);
      document.querySelector('.safetyBtns')!.append(gate);
      const ref = g1.querySelector('button') as HTMLElement;
      stop.style.setProperty('height', `${ref.getBoundingClientRect().height}px`, 'important');
      (document.querySelector('.safetyStrip') as HTMLElement).style.width = `calc(var(--strip-fixed-w) + ${extra}px)`;
    }
    const strip = document.querySelector('.strip') as HTMLElement;
    if ((window as any).__b2old) {
      strip.addEventListener('focusin', (ev) => {
        const t = ev.target as HTMLElement;
        if (t !== strip && t.matches(':focus-visible')) t.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      });
    } else {
      // Only real keyboard navigation (Tab / arrows since the last pointerdown)
      // scrolls a focused control into view, and never while a pointer press
      // still owes its click: deferred to the task after the last release,
      // and dropped unless that control still holds focus.
      const st = { kb: false, pointers: new Set<number>(), pending: null as HTMLElement | null };
      const NAV = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
      document.addEventListener('keydown', (e) => { if (NAV.has(e.key)) st.kb = true; }, true);
      document.addEventListener('pointerdown', (e) => { st.kb = false; st.pointers.add(e.pointerId); }, true);
      const flush = () => {
        const t = st.pending; st.pending = null;
        if (t && st.kb && document.activeElement === t) t.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      };
      const release = (e: PointerEvent) => { st.pointers.delete(e.pointerId); if (st.pointers.size === 0) setTimeout(flush, 0); };
      document.addEventListener('pointerup', release, true);
      document.addEventListener('pointercancel', release, true);
      strip.addEventListener('focusin', (ev) => {
        const t = ev.target as HTMLElement;
        if (t === strip || !st.kb) return;
        if (st.pointers.size > 0) { st.pending = t; return; }
        t.scrollIntoView({ inline: 'nearest', block: 'nearest' });
      });
      (window as any).__focusScroll = st;
    }
    const gap = parseFloat(getComputedStyle(strip).columnGap);
    const sr = strip.getBoundingClientRect();
    const safety = document.querySelector('.safetyStrip')!.getBoundingClientRect();
    strip.style.scrollPaddingLeft = `${safety.right - sr.left + gap}px`;
    if (form === 'F2') {
      const sp = document.querySelector('[data-strip="spindle"]') as HTMLElement;
      const ov = document.querySelector('[data-strip="overrides"]') as HTMLElement;
      ov.style.right = `${sp.getBoundingClientRect().width + gap}px`;
      strip.style.scrollPaddingRight = `${ov.getBoundingClientRect().width + gap + sp.getBoundingClientRect().width + gap}px`;
    } else if (form === 'F3') {
      const ov = document.querySelector('[data-strip="overrides"]') as HTMLElement;
      strip.style.scrollPaddingRight = `${ov.getBoundingClientRect().width + gap}px`;
    }
  }, [form, mode] as const);
}

const R411_M2 = `.strip > .stripFade { display: none !important; }
.strip > [data-strip="spindle"] { position: sticky; right: 0; z-index: var(--z-raised); ${COVER} }
.strip > [data-strip="overrides"] { position: sticky; z-index: var(--z-raised); ${COVER} }`;
const R411_M3 = `.strip > .stripFade { display: none !important; }
.strip > [data-strip="overrides"] { position: sticky; right: 0; z-index: var(--z-raised); ${COVER} }`;
async function applyR411(page: Page, form: Form) {
  if (form === 'F2') {
    await page.addStyleTag({ content: R411_M2 });
    await page.evaluate(() => {
      const strip = document.querySelector('.strip') as HTMLElement;
      const sp = document.querySelector('[data-strip="spindle"]') as HTMLElement;
      const ov = document.querySelector('[data-strip="overrides"]') as HTMLElement;
      ov.style.right = `${sp.getBoundingClientRect().width + parseFloat(getComputedStyle(strip).columnGap)}px`;
    });
  }
  if (form === 'F3') await page.addStyleTag({ content: R411_M3 });
  if (form === 'F2' || form === 'F3') {
    await page.addStyleTag({ content: `.strip {scroll-snap-type: x mandatory;} .strip > [data-strip="jog"], .strip > [data-strip="setup"] {scroll-snap-align:start;}` });
    await page.evaluate(() => {
      const s = document.querySelector('.strip') as HTMLElement;
      const saf = document.querySelector('.safetyStrip')!.getBoundingClientRect();
      const ov = document.querySelector('[data-strip="overrides"]')!.getBoundingClientRect();
      s.style.scrollPaddingLeft = `${saf.right - s.getBoundingClientRect().left + 8}px`;
      s.style.scrollPaddingRight = `${s.getBoundingClientRect().right - ov.left + 8}px`;
    });
  }
}

async function toolRowsIntoSpindle(page: Page) {
  await page.evaluate(() => {
    const sec = document.querySelector('[data-strip="spindle"]') as HTMLElement;
    const btn = [...document.querySelectorAll('[data-strip="tool"] button')].find(b => /Tool Table/.test(b.textContent ?? ''))!;
    const clone = btn.cloneNode(true) as HTMLElement; clone.setAttribute('data-probe', 'tool-btn');
    const label = [...clone.querySelectorAll('*')].reverse().find(e => e.childElementCount === 0 && /Tool Table/.test(e.textContent ?? '')) ?? clone;
    label.textContent = 'Tool T12';
    const wrap = document.createElement('div'); wrap.className = 'stack-tight';
    const row = document.createElement('div'); row.className = 'statusRow';
    row.innerHTML = '<span class="label-muted md">In effect</span><span class="val-status md">Off (G49)</span>';
    wrap.append(clone, row);
    const sep = document.createElement('div'); sep.className = 'sep';
    sec.append(sep, wrap);
  });
}

async function safetyRects(page: Page) {
  return page.evaluate(() => [...document.querySelectorAll('.safetyBtns > .btnGate:not([data-probe])')].map(g => { const r = g.getBoundingClientRect(); return [Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.height * 10) / 10]; }));
}

async function settled(page: Page) {
  await page.evaluate(async () => {
    const s = document.querySelector('.strip')!; let prev = -1, n = 0;
    for (let i = 0; i < 180 && n < 8; i++) { await new Promise(requestAnimationFrame); const x = s.scrollLeft; n = Math.abs(x - prev) < 0.01 ? n + 1 : 0; prev = x; }
  });
}

// One sample: every rule of the contract, as booleans plus the numbers behind them.
async function sample(page: Page, form: Form) {
  return page.evaluate((form) => {
    const strip = document.querySelector('.strip') as HTMLElement;
    const sr = strip.getBoundingClientRect();
    const visL = sr.left + strip.clientLeft, visR = visL + strip.clientWidth;
    const visT = sr.top + strip.clientTop, visB = visT + strip.clientHeight;
    // whole = inside the strip window and topmost at 3 × 3 points
    const whole = (e: Element | null | undefined) => {
      if (!e) return false;
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.left < visL - 0.5 || r.right > visR + 0.5 || r.top < visT - 0.5 || r.bottom > visB + 0.5) return false;
      const mx = (r.left + r.right) / 2, my = (r.top + r.bottom) / 2, qw = r.width / 4, qh = r.height / 4;
      const pts: Array<[number, number]> = [[r.left + 3, my], [r.right - 3, my], [mx, r.top + 3], [mx, r.bottom - 3]];
      for (const x of [mx - qw, mx, mx + qw]) for (const y of [my - qh, my, my + qh]) pts.push([x, y]);
      const tip = (e as HTMLButtonElement).disabled && e.parentElement?.matches('.btnTip') ? e.parentElement : null;
      return pts.every(([x, y]) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h) || h === tip); });
    };
    // any part visible = some point of the box inside the window and topmost
    const anyPart = (e: Element) => {
      const r = e.getBoundingClientRect();
      const y0 = Math.max(r.top, visT) + 1, y1 = Math.min(r.bottom, visB) - 1;
      for (let x = Math.max(r.left, visL) + 1; x < Math.min(r.right, visR) - 1; x += 4)
        for (const y of [y0, (y0 + y1) / 2, y1]) {
          if (y1 <= y0) continue;
          const h = document.elementFromPoint(x, y);
          if (h && (h === e || e.contains(h))) return true;
        }
      return false;
    };
    const jogBtns = [...document.querySelectorAll('[data-strip="jog"] .jogBtn')];
    const padStop = jogBtns.find(b => (b.textContent ?? '').trim() === 'Stop');
    const moving = jogBtns.filter(b => b !== padStop);
    const reserved = document.querySelector('[data-probe="reserved-stop"]');
    const estop = [...document.querySelectorAll('.safetyStrip button')].find(b => /E-?STOP/i.test(b.textContent ?? ''));
    const ov = document.querySelector('[data-strip="overrides"]') as HTMLElement;
    const sliders = [...ov.querySelectorAll('input[type="range"]')];
    const spBtns = [...document.querySelectorAll('[data-strip="spindle"] button')];
    const jogVisible = moving.some(anyPart);
    const stopOk = !jogVisible || whole(reserved) || whole(padStop);
    return {
      scroll: Math.round(strip.scrollLeft * 10) / 10, scrollTop: Math.round(strip.scrollTop * 10) / 10, max: strip.scrollWidth - strip.clientWidth,
      estop: whole(estop), jogVisible, stopOk, reservedWhole: reserved ? whole(reserved) : null, padStopWhole: whole(padStop),
      ovLeft: Math.round(ov.getBoundingClientRect().left * 10) / 10,
      overridesWhole: sliders.every(whole),
      spindleWhole: spBtns.every(whole),
      form,
    };
  }, form);
}

for (const c of CASES) test(`stage B ${VARIANT} ${c.name}`, async ({ page, browserName }, info) => {
  test.setTimeout(180_000);
  const touch = browserName === 'chromium';
  await openLayout(page, c.profile, { name: c.name, width: c.width, height: 800, touch });
  await toolRowsIntoSpindle(page);
  await page.addStyleTag({ content: HIDE_TOOL });
  await settled(page);
  const safetyBefore = await safetyRects(page);
  const { form, widths, cw } = await formOf(page, B2);
  if (VARIANT === 'b1') await applyB1(page, form);
  if (B2) {
    if (VARIANT === 'b2old') await page.evaluate(() => { (window as any).__b2old = true; });
    await applyB1(page, form, 'button');
    if (VARIANT === 'b2occ') await page.addStyleTag({ content: '.safetyStrip::before { content: ""; position: absolute; inset: 0; z-index: 999; pointer-events: auto; }' });
  }
  if (VARIANT === 'r411') await applyR411(page, form);
  await settled(page);
  const safetyAfter = await safetyRects(page);
  const samples: Array<Record<string, unknown> & { at: string }> = [];
  const max = await page.locator('.strip').evaluate(el => el.scrollWidth - el.clientWidth);
  for (let i = 0; i <= 24; i++) {
    await page.locator('.strip').evaluate((el, f) => { el.scrollLeft = (el.scrollWidth - el.clientWidth) * f; }, i / 24);
    await settled(page);
    samples.push({ at: `p${i}`, ...(await sample(page, form)) });
  }
  // during a smooth scroll (every frame) and after wheel steps over the strip
  await page.locator('.strip').evaluate(el => { el.scrollLeft = 0; }); await settled(page);
  await page.locator('.strip').evaluate(el => { (window as any).__during = []; el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' }); });
  for (let i = 0; i < 12; i++) {
    samples.push({ at: `during${i}`, ...(await sample(page, form)) });
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  await settled(page);
  await page.locator('.strip').evaluate(el => { el.scrollLeft = 0; }); await settled(page);
  const box = (await page.locator('.strip').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + 8); // inside the visible strip, over a section head
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 120); // a vertical wheel over the strip: whatever the page makes of it
    await page.mouse.wheel(120, 0);
    await settled(page);
    samples.push({ at: `wheel${i}`, ...(await sample(page, form)) });
  }
  // the last control of each section, brought in by the browser's own focus scroll
  const lasts: Record<string, boolean> = {};
  for (const sec of ['jog', 'setup', 'overrides', 'spindle']) {
    const loc = page.locator(`[data-strip="${sec}"] :is(button, input, select):not([disabled]):visible`).last();
    if (await loc.count() === 0) continue;
    const all = page.locator(`[data-strip="${sec}"] :is(button, input, select):not([disabled]):visible`);
    const n = await all.count();
    if (n >= 2) { await all.nth(n - 2).evaluate((el) => (el as HTMLElement).focus({ focusVisible: true } as FocusOptions)); await page.keyboard.press('Tab'); }
    else await loc.evaluate((el) => (el as HTMLElement).focus({ focusVisible: true } as FocusOptions));
    await settled(page);
    const onLast = await loc.evaluate(el => document.activeElement === el);
    (lasts as any)[`${sec}ByTab`] = n >= 2 && onLast;
    if (!onLast) await loc.evaluate((el) => (el as HTMLElement).focus({ focusVisible: true } as FocusOptions));
    await settled(page);
    samples.push({ at: `focus-${sec}`, ...(await sample(page, form)) });
    lasts[sec] = await loc.evaluate((e) => {
      const strip = document.querySelector('.strip') as HTMLElement; const sr = strip.getBoundingClientRect();
      const visL = sr.left + strip.clientLeft, visR = visL + strip.clientWidth;
      const r = e.getBoundingClientRect();
      const info = { tag: e.tagName, text: (e.textContent ?? '').trim().slice(0, 20), aria: e.getAttribute('aria-label'), l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), visL: Math.round(visL), visR: Math.round(visR), focused: document.activeElement === e };
      if (r.left < visL - 0.5 || r.right > visR + 0.5) { (window as any).__lastInfo = { ...info, why: 'outside' }; return false; }
      const xs = [r.left + 3, (r.left + r.right) / 2, r.right - 3];
      const tip = (e as HTMLButtonElement).disabled && e.parentElement?.matches('.btnTip') ? e.parentElement : null;
      const ok = xs.every(x => { const h = document.elementFromPoint(x, (r.top + r.bottom) / 2); return !!h && (h === e || e.contains(h) || h === tip); });
      (window as any).__lastInfo = { ...info, why: ok ? 'ok' : 'covered' };
      return ok;
    });
    (lasts as any)[`${sec}Info`] = await page.evaluate(() => (window as any).__lastInfo);
  }
  await page.locator('.strip').evaluate(el => { el.scrollLeft = 0; }); await settled(page);
  await page.locator('.strip').screenshot({ path: `${OUT}/${VARIANT}-${info.project.name}-${c.name}.png` });
  const ovLefts = samples.filter(s => s.at.startsWith('p')).map(s => s.ovLeft as number);
  const pinned = form === 'F2' || form === 'F3';
  const fail: string[] = [];
  for (const s of samples) {
    if (!s.estop) fail.push(`${s.at}: E-Stop not whole`);
    if (!s.stopOk) fail.push(`${s.at}: a jog button visible, no whole Stop (pad ${s.padStopWhole}, reserved ${s.reservedWhole})`);
    if (pinned && !s.overridesWhole) fail.push(`${s.at}: an override not whole`);
    if (form === 'F2' && !s.spindleWhole) fail.push(`${s.at}: a Spindle button not whole`);
  }
  if (pinned && Math.max(...ovLefts) - Math.min(...ovLefts) > 0.5) fail.push(`Overrides' left edge moved ${Math.min(...ovLefts)}..${Math.max(...ovLefts)}`);
  for (const [sec, ok] of Object.entries(lasts)) if (!sec.endsWith('ByTab') && ok === false) fail.push(`last ${sec} control not whole after focus`);
  if (B2 && form !== 'F1') {
    const four = await page.evaluate(() => [...document.querySelectorAll('.safetyBtns > .btnGate')].map(g => { const b = (g.querySelector('button') ?? g) as HTMLElement; const r = b.getBoundingClientRect(); return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
    const ws = four.map(f => f[0]), hs = four.map(f => f[1]);
    if (four.length !== 4 || Math.max(...ws) - Math.min(...ws) > 0.5 || Math.max(...hs) - Math.min(...hs) > 0.5) fail.push(`Safety's four buttons differ: ${JSON.stringify(four)}`);
  }
  if (JSON.stringify(safetyBefore) !== JSON.stringify(safetyAfter)) fail.push(`Safety's three buttons moved: ${JSON.stringify(safetyBefore)} -> ${JSON.stringify(safetyAfter)}`);
  appendFileSync(`${OUT}/stage-b.jsonl`, JSON.stringify({ variant: VARIANT, project: info.project.name, touch, case: c.name, form, widths, cw, max, lasts, safetyBefore, safetyAfter, fail, samples }) + '\n');
  expect(fail, `${VARIANT} ${c.name} (${form})`).toEqual([]);
});

// Safety holds the reserved stop row in every state, both densities.
for (const state of ['homed', 'estop', 'unhomed', 'off', 'disarmed'] as const) test(`stage B safety room ${state}`, async ({ page, browserName }) => {
  test.skip(VARIANT !== 'b1' && VARIANT !== 'b2');
  const touch = browserName === 'chromium';
  await openLayout(page, TWP, { name: 'room', width: 1280, height: 800, touch });
  await setLayoutState(page, TWP, state);
  await ctl({ op: 'status_delta', data: { gcodes: [10, 170, 210, 400, 490, 540, 610, 640, 800, 900, 940, 970, 991], mcodes: [0, 5, 9, 48, 53] } });
  await page.addStyleTag({ content: HIDE_TOOL });
  await settled(page);
  const before = await page.evaluate(() => { const d = document.querySelector('.statusDetail') as HTMLElement; return { over: d.scrollHeight - d.clientHeight, h: d.clientHeight }; });
  await applyB1(page, 'F4', VARIANT === 'b2' ? 'button' : 'row');
  await settled(page);
  const m = await page.evaluate(() => {
    const s = document.querySelector('.safetyStrip') as HTMLElement;
    const stop = document.querySelector('[data-probe="reserved-stop"]') as HTMLElement;
    const sr = s.getBoundingClientRect(), r = stop.getBoundingClientRect();
    const d = document.querySelector('.statusDetail') as HTMLElement;
    return { over: s.scrollHeight - s.clientHeight, stopInside: r.bottom <= sr.bottom - parseFloat(getComputedStyle(s).paddingBottom) + 0.5, stopH: r.height, stopW: r.width, room: Math.round((sr.bottom - r.bottom) * 10) / 10, detailOver: d.scrollHeight - d.clientHeight, detailH: d.clientHeight, safetyW: sr.width };
  });
  appendFileSync(`${OUT}/stage-b-safety.jsonl`, JSON.stringify({ variant: VARIANT, state, touch, before, ...m }) + '\n');
  await page.locator('.safetyStrip').screenshot({ path: `${OUT}/safety-${VARIANT}-${browserName}-${state}.png` });
  expect(m.over, `Safety overflows in ${state}`).toBeLessThanOrEqual(0);
  expect(m.stopInside).toBe(true);
  expect(m.detailOver, `the status detail lost room in ${state}`).toBeLessThanOrEqual(before.over);
  expect(m.detailH, `the status detail got lower in ${state}`).toBeGreaterThanOrEqual(before.h - 0.5);
});

// Portrait (not a stage B form): the strip is a column that scrolls
// vertically under the sticky Safety. Recorded for today only.
for (const prof of [XYZ, TWP]) test(`stage B portrait ${prof.name}`, async ({ page, browserName }) => {
  test.skip(VARIANT !== 'today');
  test.setTimeout(120_000);
  const touch = browserName === 'chromium';
  await openLayout(page, prof, { name: 'portrait', width: 900, height: 1200, touch });
  await settled(page);
  const samples: Array<Record<string, unknown>> = [];
  for (let i = 0; i <= 24; i++) {
    await page.locator('.strip').evaluate((el, f) => { el.scrollTop = (el.scrollHeight - el.clientHeight) * f; }, i / 24);
    await settled(page);
    samples.push({ at: `p${i}`, ...(await sample(page, 'F4')) });
  }
  const bad = samples.filter(s => !s.stopOk).map(s => s.at);
  const vmax = await page.locator('.strip').evaluate(el => el.scrollHeight - el.clientHeight);
  appendFileSync(`${OUT}/stage-b-portrait.jsonl`, JSON.stringify({ project: test.info().project.name, touch, profile: prof.name, vmax, bad, samples }) + '\n');
});

// LA413-01: the focus scroll never moves a control under a pointer press;
// real Tab brings a partly covered target in; Tab while a pointer is held
// waits for the release; a later focus is never taken back.
async function setupB2At(page: Page, browserName: string) {
  await openLayout(page, TWP, { name: 'TWP1280', width: 1280, height: 800, touch: browserName === 'chromium' });
  await toolRowsIntoSpindle(page); await page.addStyleTag({ content: HIDE_TOOL }); await settled(page);
  const { form } = await formOf(page, true);
  if (VARIANT === 'b2old') await page.evaluate(() => { (window as any).__b2old = true; });
  await applyB1(page, form, 'button'); await settled(page);
}
// a target partly hidden at the strip's right edge (its left 40 % visible)
async function partlyRight(page: Page, sel: string) {
  const loc = page.locator(sel).first();
  await loc.evaluate((el) => { const s = document.querySelector('.strip') as HTMLElement; const sr = s.getBoundingClientRect(); const visR = sr.left + s.clientLeft + s.clientWidth; const r = el.getBoundingClientRect(); s.scrollLeft += r.left + r.width * 0.4 - visR; });
  await settled(page);
  return loc;
}
const geo = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => { const s = document.querySelector('.strip') as HTMLElement; const r = el.getBoundingClientRect(); const sr = s.getBoundingClientRect(); return { scroll: s.scrollLeft, left: r.left, right: r.right, visR: sr.left + s.clientLeft + s.clientWidth, active: document.activeElement === el, fv: el.matches(':focus-visible') }; });

// Codex's R413 pointer case: the native step select half under Safety, pressed on its visible part
test('stage B pointer press does not scroll (select under Safety)', async ({ page, browserName }) => {
  test.skip(VARIANT !== 'b2' && VARIANT !== 'b2old');
  await setupB2At(page, browserName);
  const loc = page.locator('[data-strip="jog"] select').first();
  test.skip(await loc.count() === 0, 'Firefox renders the step as a radio group here (Codex R413)');
  await loc.evaluate(el => { const s = document.querySelector('.strip') as HTMLElement; const edge = document.querySelector('.safetyStrip')!.getBoundingClientRect().right; const r = el.getBoundingClientRect(); s.scrollLeft += (r.left + r.right) / 2 - edge - 6; });
  await settled(page);
  const point = await loc.evaluate(el => { const r = el.getBoundingClientRect(); const edge = document.querySelector('.safetyStrip')!.getBoundingClientRect().right; return { x: Math.max(edge + 3, r.left + 3), y: (r.top + r.bottom) / 2 }; });
  const before = await geo(loc);
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  const held = await geo(loc);
  await page.mouse.up(); await settled(page);
  const after = await geo(loc);
  appendFileSync(`${OUT}/stage-b-focus.jsonl`, JSON.stringify({ variant: VARIANT, browserName, case: 'pointer-select', before, held, after }) + '\n');
  expect(held.active).toBe(true);
  expect(held.scroll, 'the strip moved under the press').toBe(before.scroll);
  expect(after.scroll, 'the strip moved after a pointer focus').toBe(before.scroll);
});

// a Setup button half past the right edge, reached by Shift+Tab, re-placed, then Tab
const SETUP_BTN = '[data-strip="setup"] button:not([disabled])';
async function tabInto(page: Page) {
  const loc = await partlyRight(page, SETUP_BTN);
  await loc.evaluate(el => (el as HTMLElement).focus({ preventScroll: true }));
  await page.keyboard.press('Shift+Tab'); await settled(page);
  const again = await partlyRight(page, SETUP_BTN);
  return again;
}
test('stage B Tab brings a partly covered target in', async ({ page, browserName }) => {
  test.skip(VARIANT !== 'b2' && VARIANT !== 'b2old');
  await setupB2At(page, browserName);
  const loc = await tabInto(page);
  const before = await geo(loc);
  await page.keyboard.press('Tab'); await settled(page);
  const g = await geo(loc);
  appendFileSync(`${OUT}/stage-b-focus.jsonl`, JSON.stringify({ variant: VARIANT, browserName, case: 'tab', before, g }) + '\n');
  expect(before.right, 'precondition: past the right edge').toBeGreaterThan(before.visR);
  expect(g.active).toBe(true);
  expect(g.right).toBeLessThanOrEqual(g.visR + 0.5);
});

test('stage B Tab during a held pointer waits; a later focus is not taken back', async ({ page, browserName }) => {
  test.skip(VARIANT !== 'b2');
  await setupB2At(page, browserName);
  const head = (await page.locator('.safetyStrip .sub').first().boundingBox())!;
  const hold = async () => { await page.mouse.move(head.x + 4, head.y + head.height / 2); await page.mouse.down(); };
  // 1: a pointer held on Safety's head (the press moves focus to the strip),
  //    then the control before the target, then Tab: nothing moves until the release
  const loc = await tabInto(page);
  const prev = await page.evaluateHandle(() => document.activeElement as HTMLElement);
  const b0 = await geo(loc);
  await hold();
  await prev.evaluate(el => el.focus({ preventScroll: true }));
  await page.keyboard.press('Tab'); await settled(page);
  const held = await geo(loc);
  await page.mouse.up(); await settled(page);
  const after = await geo(loc);
  // 2: the same, but focus moves elsewhere before the release: no scroll back
  const loc2 = await tabInto(page);
  const prev2 = await page.evaluateHandle(() => document.activeElement as HTMLElement);
  await hold();
  await prev2.evaluate(el => el.focus({ preventScroll: true }));
  await page.keyboard.press('Tab');
  const tabbed = await geo(loc2);
  await page.locator('.safetyBtns button').first().evaluate(el => (el as HTMLElement).focus({ preventScroll: true }));
  const c0 = await geo(loc2);
  await page.mouse.up(); await settled(page);
  const c1 = await geo(loc2);
  appendFileSync(`${OUT}/stage-b-focus.jsonl`, JSON.stringify({ variant: VARIANT, browserName, case: 'held', b0, held, after, tabbed, c0, c1 }) + '\n');
  expect(b0.right, 'precondition: past the right edge').toBeGreaterThan(b0.visR);
  expect(held.active, 'Tab landed on the target').toBe(true);
  expect(held.scroll, 'scrolled while the pointer was held').toBe(b0.scroll);
  expect(after.right, 'not brought in after the release').toBeLessThanOrEqual(after.visR + 0.5);
  expect(tabbed.active, 'case 2: Tab landed on the target').toBe(true);
  expect(c1.scroll, 'a later focus was taken back').toBe(c0.scroll);
});

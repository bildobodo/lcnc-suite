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
// intercepting layer over Safety; b2r414: b2 without the Tab guard (R414) — all must fail
const VARIANT = (process.env.STAGE_B ?? 'b2') as 'today' | 'r411' | 'b1' | 'b2' | 'b2old' | 'b2occ' | 'b2r414';
const B2 = VARIANT === 'b2' || VARIANT === 'b2old' || VARIANT === 'b2occ' || VARIANT === 'b2r414';
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
      if (!(window as any).__noTabGuard) {
        // the app has no positive tabindex: the browser's order is DOM order of tab stops
        const tabbables = () => [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')]
          .filter(e => e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled && e.offsetParent !== null && !e.closest('[inert]'));
        document.addEventListener('keydown', (e) => {
          if (e.key !== 'Tab' || st.pointers.size === 0) return;
          const list = tabbables(); const i = list.indexOf(document.activeElement as HTMLElement);
          const next = list[i + (e.shiftKey ? -1 : 1)];
          if (!next) return;
          e.preventDefault(); st.kb = true; next.focus({ preventScroll: true });
        }, true);
        const focus0 = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function (opts?: FocusOptions) { return focus0.call(this, st.pointers.size > 0 ? { ...(opts ?? {}), preventScroll: true } : opts); };
      }
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


export {TWP,HIDE_TOOL,formOf,applyB1,toolRowsIntoSpindle,settled,sample};

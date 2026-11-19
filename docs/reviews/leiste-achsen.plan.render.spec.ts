// Many-axes proposals for the operator (2026-11-19, plan draft
// ~/claude-work/stripfit/axes-plan/plan.md). Prototypes by injected CSS/DOM
// on the shipped head (dc9dc3e4) — not a test, nothing here ships.
//   heute  the strip as merged
//   M1     Tool yields: its section hidden, "Tool T12" + "In effect G43"
//          injected as two rows into Spindle, Spindle takes the rest
//   M2     M1 + Overrides and Spindle pinned at the right edge (sticky),
//          Jog and Setup scroll between Safety and that group
//   W1/W2  wide screen: Tool capped, the rest as even gaps (W1) / Tool
//          capped wider with the tool's side view beside its data (W2)
import { appendFileSync } from 'node:fs';
import { test, expect, type Page } from './test';
import { ctl, publishToolTable } from './ctl';
import { PROFILES, openLayout, settleLayout, type Profile, type LayoutViewport } from './layout-fixtures';

const OUT = process.env.SHOT_DIR!;
test.use({ deviceScaleFactor: 2 });
const P = (name: string, axes: string[], kins: Profile['kins'] = null): Profile => ({ name, axes, kins });
const XYZ = P('XYZ', ['X', 'Y', 'Z']);
const XYA = P('XYA', ['X', 'Y', 'A']);
const XYZA = P('XYZA', ['X', 'Y', 'Z', 'A']);
const XYZAC = P('XYZAC', ['X', 'Y', 'Z', 'A', 'C'], PROFILES[1].kins as Profile['kins']);
const XYZABC = P('XYZABC', ['X', 'Y', 'Z', 'A', 'B', 'C']);
const TWP = P('TWP', ['X', 'Y', 'Z', 'A', 'B', 'C'], PROFILES[2].kins as Profile['kins']);
const VP = (name: string, width: number, height: number): LayoutViewport => ({ name, width, height, touch: true });
const FHD = VP('1920', 1920, 1080), SMALL = VP('1280', 1280, 800), WIDE = VP('2560', 2560, 1440);

type V = 'heute' | 'M1' | 'M2' | 'M3' | 'M1g' | 'W1' | 'W2';
type Case = { vp: LayoutViewport; c: Profile; v: V; helper?: 'rpm' | 'setup' };
const CASES: Case[] = [
  ...[XYA, XYZA, XYZAC].flatMap(c => (['heute', 'M1'] as V[]).map(v => ({ vp: FHD, c, v }))),
  ...[XYZABC, TWP].flatMap(c => (['heute', 'M1', 'M2'] as V[]).map(v => ({ vp: FHD, c, v }))),
  { vp: FHD, c: TWP, v: 'M2', helper: 'rpm' },
  { vp: FHD, c: TWP, v: 'M2', helper: 'setup' },
  ...(['heute', 'M1', 'M2'] as V[]).map(v => ({ vp: SMALL, c: XYZ, v })),
  ...(['heute', 'M1', 'M2'] as V[]).map(v => ({ vp: SMALL, c: XYZAC, v })),
  ...(['heute', 'M2'] as V[]).map(v => ({ vp: SMALL, c: TWP, v })),
  ...(['heute', 'W1', 'W2'] as V[]).map(v => ({ vp: WIDE, c: XYZ, v })),
  { vp: SMALL, c: XYZAC, v: 'M3' }, { vp: SMALL, c: TWP, v: 'M3' },
  { vp: FHD, c: XYA, v: 'M1g' }, { vp: FHD, c: XYZA, v: 'M1g' },
];

const M1_CSS = `
.strip > [data-strip="tool"] { display: none !important; }
.strip:not(:has(.nkStrip, .tkStrip)) > [data-strip="spindle"] { flex-grow: 1; }`;
// The pinned group: each section covers what scrolls under it (background),
// Spindle also the strip's 8 px end padding (the bleed-through Safety avoids
// by carrying its padding itself); the scroll fade moves to the group's
// inner edge.
const M2_CSS = `
.strip > .stripFade { display: none !important; }
.strip > [data-strip="spindle"] { position: sticky; right: 0; z-index: var(--z-raised); background: var(--panel); box-shadow: var(--gap-controls) 0 0 var(--panel); }
.strip > [data-strip="overrides"] { position: sticky; z-index: var(--z-raised); background: var(--panel); box-shadow: var(--gap-controls) 0 0 var(--panel); }
.strip.m2-more > [data-strip="overrides"]::before { content: ""; position: absolute; top: 0; bottom: 0; left: calc(-2 * var(--gap-panel) - 1px); width: calc(2 * var(--gap-panel)); background: var(--panel); pointer-events: none;
  -webkit-mask-image: linear-gradient(to left, black 0%, rgba(0,0,0,0.8) 12%, rgba(0,0,0,0.45) 30%, rgba(0,0,0,0.15) 60%, transparent 100%);
  mask-image: linear-gradient(to left, black 0%, rgba(0,0,0,0.8) 12%, rgba(0,0,0,0.45) 30%, rgba(0,0,0,0.15) 60%, transparent 100%); }`;
// M3: Tool yields, only Overrides pinned at the right edge (Spindle scrolls)
const M3_CSS = `
.strip > .stripFade { display: none !important; }
.strip > [data-strip="overrides"] { position: sticky; right: 0; z-index: var(--z-raised); background: var(--panel); box-shadow: var(--gap-controls) 0 0 var(--panel); }`;
// M1g: Tool yields, the rest as even gaps instead of a wider Spindle
const M1G_CSS = `
.strip > [data-strip="tool"] { display: none !important; }
.strip > .stripFade { display: none !important; }
.strip { justify-content: space-between; }`;
const W1_CSS = `
.strip > .stripFade { display: none !important; }
.strip { justify-content: space-between; }
@media (orientation: landscape) { .toolStrip { flex-grow: 0 !important; width: 360px !important; } }`;
const W2_CSS = `
.strip > .stripFade { display: none !important; }
.strip { justify-content: space-between; }
@media (orientation: landscape) { .toolStrip { flex-grow: 0 !important; width: 560px !important; } }
.w2Row { display: flex; gap: var(--gap-section); min-height: 0; }
.w2Row > :first-child { flex: 1; min-width: 0; }
.w2Pic { flex: 0 0 auto; border-radius: var(--radius-container); }`;

async function toolIntoSpindle(page: Page) {
  await page.evaluate(() => {
    const sec = document.querySelector('[data-strip="spindle"]')!;
    const wrap = document.createElement('div');
    wrap.className = 'stack-tight';
    wrap.innerHTML = '<div class="statusRow"><span class="label-muted md">Tool</span><span class="val-status md mono">T12</span></div>'
      + '<div class="statusRow"><span class="label-muted md">In effect</span><span class="val-status md">G43</span></div>';
    const sep = document.createElement('div'); sep.className = 'sep';
    sec.append(sep, wrap);
  });
}

async function pinGroup(page: Page) {
  await page.addStyleTag({ content: M2_CSS });
  await page.evaluate(() => {
    const strip = document.querySelector('.strip') as HTMLElement;
    const sp = document.querySelector('[data-strip="spindle"]') as HTMLElement;
    const ov = document.querySelector('[data-strip="overrides"]') as HTMLElement;
    const gap = parseFloat(getComputedStyle(strip).columnGap) || 8;
    ov.style.right = `${sp.getBoundingClientRect().width + gap}px`;
    const sync = () => strip.classList.toggle('m2-more', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1);
    strip.addEventListener('scroll', sync); sync();
  });
}

// The tool's side view from the Tools tab (a WebGL canvas, pinned by a tap
// on its row), copied as an image into Tool's section beside its data.
async function toolPicture(page: Page) {
  await page.getByRole('tab', { name: 'Tools', exact: true }).click();
  const row = page.locator('tr', { hasText: 'Twelve mm' }).first();
  await row.click();
  const canvas = page.locator('.toolHoverPreview canvas');
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(300);
  const png = (await canvas.screenshot()).toString('base64');
  await row.click();
  await expect(canvas).toHaveCount(0);
  await page.getByRole('tab', { name: 'Program', exact: true }).click();
  await page.evaluate((src) => {
    const body = document.querySelector('[data-strip="tool"] .toolBody') as HTMLElement;
    const card = body.lastElementChild as HTMLElement;
    const row = document.createElement('div'); row.className = 'w2Row';
    card.replaceWith(row); row.append(card);
    const img = document.createElement('img'); img.className = 'w2Pic inset-panel'; img.src = `data:image/png;base64,${src}`;
    row.append(img);
    img.style.height = `${card.getBoundingClientRect().height}px`; img.style.width = 'auto'; img.style.objectFit = 'contain';
  }, png);
}

async function measure(page: Page) {
  await settleLayout(page);
  return page.evaluate(() => {
    const strip = document.querySelector('.strip') as HTMLElement;
    const box = strip.getBoundingClientRect();
    const visL = box.left + strip.clientLeft, visR = visL + strip.clientWidth;
    const shown = [...strip.children].filter(e => !e.classList.contains('stripFade') && (e as HTMLElement).getBoundingClientRect().width > 0) as HTMLElement[];
    const cbox = (e: HTMLElement) => {
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      return { l: r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft), r: r.right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight) };
    };
    const first = cbox(shown[0]!), last = cbox(shown[shown.length - 1]!);
    // seen = inside the visible window AND the topmost element at its centre
    // (a pinned section over it counts as covered)
    const seen = (el: Element | null | undefined) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return null;
      if (r.left < visL - 0.5 || r.right > visR + 0.5) return false;
      const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      // a dimmed button sits in a .btnTip wrapper that takes the hit
      return !!hit && (el === hit || el.contains(hit) || (hit.contains(el) && hit.closest('[data-strip], .safetyStrip') === el.closest('[data-strip], .safetyStrip')));
    };
    const btn = (sec: string, name: string) => [...document.querySelectorAll(`[data-strip="${sec}"] button`)].find(e => (e.textContent ?? '').trim() === name);
    const safety = document.querySelector('.safetyStrip');
    return {
      over: Math.round(strip.scrollWidth - strip.clientWidth),
      insetLeft: Math.round((first.l - visL) * 10) / 10, insetRight: Math.round((visR - last.r) * 10) / 10,
      sections: shown.map(e => `${e.getAttribute('data-strip') ?? e.className.split(' ')[0]} ${Math.round(e.getBoundingClientRect().width * 10) / 10}`).join(', '),
      estop: seen(safety ? [...safety.querySelectorAll('button')].find(b => /E-STOP/i.test(b.textContent ?? '')) : null),
      spindleStop: seen(btn('spindle', 'Stop')), spindleFwd: seen(btn('spindle', 'Fwd')),
      feedOverride: seen(document.querySelector('[data-strip="overrides"] input[type="range"]')),
      jogStop: seen(btn('jog', 'Stop')),
    };
  });
}

for (const k of CASES) {
  const name = `${k.vp.name}-${k.c.name}-${k.v}${k.helper ? `-${k.helper}` : ''}`;
  test(`axes ${name}`, async ({ page }) => {
    test.setTimeout(90_000);
    await openLayout(page, k.c, k.vp);
    await publishToolTable([{ T: 12, P: 12, D: 12, Z: -123.456, type: 'endmill', description: 'Twelve mm three flute carbide roughing end mill' }]);
    await ctl({ op: 'status_delta', data: { tool_in_spindle: 12, tool_number: 12, tool_diameter: 12, tool_length: -123.456, tool_table_z: -123.456, tool_offset: [0, 0, -123.456, 0, 0, 0, 0, 0, 0], gcodes: [430] } });
    await expect(page.locator('[data-strip="tool"]')).toContainText('T12');
    if (k.v === 'M1' || k.v === 'M2') { await page.addStyleTag({ content: M1_CSS }); await toolIntoSpindle(page); }
    if (k.v === 'M2') await pinGroup(page);
    if (k.v === 'M3') { await page.addStyleTag({ content: M1_CSS.replace(/flex-grow: 1;/, 'flex-grow: 0;') }); await toolIntoSpindle(page); await page.addStyleTag({ content: M3_CSS }); }
    if (k.v === 'M1g') { await page.addStyleTag({ content: M1G_CSS }); await toolIntoSpindle(page); }
    if (k.v === 'W1') await page.addStyleTag({ content: W1_CSS });
    if (k.v === 'W2') { await toolPicture(page); await page.addStyleTag({ content: W2_CSS }); }
    if (k.helper === 'rpm') { await page.locator('.spRpmInput').click(); await expect(page.locator('.nkStrip')).toBeVisible(); }
    if (k.helper === 'setup') { await page.locator('input.setupInput').first().click(); await expect(page.locator('.nkStrip')).toBeVisible(); }
    const strip = page.locator('.strip');
    const at0 = await measure(page);
    appendFileSync(`${OUT}/axes.jsonl`, JSON.stringify({ name, at: 'start', ...at0 }) + '\n');
    await strip.screenshot({ path: `${OUT}/${name}.png` });
    if (at0.over > 0) {
      for (const [at, f] of [['mid', 0.5], ['end', 1]] as const) {
        await strip.evaluate((el, f) => { el.scrollLeft = (el.scrollWidth - el.clientWidth) * f; }, f);
        const m = await measure(page);
        appendFileSync(`${OUT}/axes.jsonl`, JSON.stringify({ name, at, ...m }) + '\n');
        await strip.screenshot({ path: `${OUT}/${name}-${at}.png` });
      }
    }
    if (k.vp === WIDE) await page.screenshot({ path: `${OUT}/${name}-page.png` });
  });
}

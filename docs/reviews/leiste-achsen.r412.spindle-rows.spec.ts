// Stage A probe (R411 answer): does Spindle hold the yielded Tool's rows —
// "Tool T…" as a FULL-HEIGHT button (a clone of Tool's own Tool Table
// button) and "In effect" with every offset word — without changing its
// width or overflowing its height? XYZA at 1920 (the F1 case). Not a test.
import { appendFileSync } from 'node:fs';
import { test, expect } from './test';
import { ctl, publishToolTable } from './ctl';
import { openLayout, settleLayout, type Profile, type LayoutViewport } from './layout-fixtures';

const OUT = process.env.SHOT_DIR!;
const XYZA: Profile = { name: 'XYZA', axes: ['X', 'Y', 'Z', 'A'], kins: null };
const touch = !process.env.LCNC_FIREFOX;
const VPS: LayoutViewport[] = [
  ...(touch ? [{ name: 'touch-1920', width: 1920, height: 1080, touch: true }] : []),
  { name: 'desktop-1920', width: 1920, height: 1080, touch: false },
];
const WORDS = ['G43', 'G43.1', 'Off (G49)', 'Other offset', '—'];
const TOOLS = ['T1', 'T12', 'T99999'];

for (const vp of VPS) {
  test(`spindle rows ${vp.name}`, async ({ page, browserName }) => {
    test.setTimeout(120_000);
    await openLayout(page, XYZA, vp);
    await publishToolTable([{ T: 12, P: 12, D: 12, Z: -123.456, type: 'endmill', description: 'probe' }]);
    await ctl({ op: 'status_delta', data: { tool_in_spindle: 12, tool_number: 12, tool_diameter: 12, tool_length: -123.456, tool_table_z: -123.456, tool_offset: [0, 0, -123.456, 0, 0, 0, 0, 0, 0], gcodes: [430] } });
    await expect(page.locator('[data-strip="tool"]')).toContainText('T12');
    await settleLayout(page);
    const base = await page.evaluate(() => (document.querySelector('[data-strip="spindle"]') as HTMLElement).getBoundingClientRect().width);
    await page.evaluate(() => {
      const sec = document.querySelector('[data-strip="spindle"]') as HTMLElement;
      const btn = [...document.querySelectorAll('[data-strip="tool"] button')].find(b => /Tool Table/.test(b.textContent ?? ''))!;
      const clone = btn.cloneNode(true) as HTMLElement; clone.setAttribute('data-probe', 'tool-btn');
      const wrap = document.createElement('div'); wrap.className = 'stack-tight'; wrap.setAttribute('data-probe', 'rows');
      const row = document.createElement('div'); row.className = 'statusRow';
      row.innerHTML = '<span class="label-muted md">In effect</span><span class="val-status md" data-probe="word"></span>';
      wrap.append(clone, row);
      const sep = document.createElement('div'); sep.className = 'sep';
      sec.append(sep, wrap);
      const style = document.createElement('style');
      style.textContent = '.strip > [data-strip="tool"] { display: none !important; }';
      document.head.append(style);
    });
    for (const t of TOOLS) for (const w of WORDS) {
      await page.evaluate(([t, w]) => {
        const b = document.querySelector('[data-probe="tool-btn"]') as HTMLElement;
        const label = [...b.querySelectorAll('*')].reverse().find(e => e.childElementCount === 0 && /Tool Table|Tool T/.test(e.textContent ?? '')) ?? b;
        label.textContent = `Tool ${t}`;
        (document.querySelector('[data-probe="word"]') as HTMLElement).textContent = w;
      }, [t, w] as const);
      await settleLayout(page);
      const m = await page.evaluate(() => {
        const sec = document.querySelector('[data-strip="spindle"]') as HTMLElement;
        const r = sec.getBoundingClientRect();
        const box = (sel: string) => { const e = document.querySelector(sel) as HTMLElement; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height, sw: e.scrollWidth, cw: e.clientWidth }; };
        const btn = box('[data-probe="tool-btn"]'), word = box('[data-probe="word"]');
        const rows = document.querySelector('[data-probe="rows"]') as HTMLElement;
        return {
          width: r.width, secScroll: sec.scrollHeight - sec.clientHeight,
          btnH: btn.h, btnInside: btn.l >= r.left - 0.5 && btn.r <= r.right + 0.5 && btn.b <= r.bottom + 0.5,
          wordCut: word.sw > word.cw + 0.5, wordInside: word.r <= r.right + 0.5 && word.b <= r.bottom + 0.5,
          rowsBottomGap: Math.round((r.bottom - rows.getBoundingClientRect().bottom) * 10) / 10,
        };
      });
      appendFileSync(`${OUT}/spindle-rows.jsonl`, JSON.stringify({ browser: browserName, vp: vp.name, tool: t, word: w, base, ...m }) + '\n');
      if (t === 'T99999' && w === 'Other offset') await page.locator('[data-strip="spindle"]').screenshot({ path: `${OUT}/spindle-rows-${browserName}-${vp.name}.png` });
    }
  });
}

// Measurement probe 2 (not a test): tool / units / error states and the Tool rows' natural widths.
import { writeFileSync } from 'node:fs';
import { test, expect } from './test';
import { ctl, publishToolTable } from './ctl';
import { PROFILES, VIEWPORTS, openLayout, setLayoutState } from './layout-fixtures';

const OUT = process.env.STRIP_MEASURE_OUT ?? '/tmp/strip-measure2';
async function measure(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const strip = document.querySelector('.strip') as HTMLElement;
    const secs = [...strip.children].map(c => ({ n: (c as HTMLElement).dataset.strip ?? (c as HTMLElement).className.split(' ')[0], w: Math.round(c.getBoundingClientRect().width * 10) / 10 })).filter(s => s.w > 0);
    const rows = [...document.querySelectorAll('[data-strip="tool"] .statusRow')].map(r => {
      const kids = [...r.children] as HTMLElement[];
      const nat = kids.map(k => { const range = document.createRange(); range.selectNodeContents(k); return range.getBoundingClientRect().width; });
      return { label: kids[0]?.textContent?.trim(), value: kids[1]?.textContent?.replace(/\s+/g, ' ').trim(), labelW: Math.round(nat[0]), valueW: Math.round(nat[1] ?? 0), rowW: Math.round(r.getBoundingClientRect().width), over: r.scrollWidth > r.clientWidth };
    });
    const note = document.querySelector('[data-strip="tool"] .statusNote') as HTMLElement | null;
    return { over: strip.scrollWidth - strip.clientWidth, secs, rows, note: note ? { w: note.getBoundingClientRect().width, h: note.getBoundingClientRect().height, text: note.textContent?.trim() } : null };
  });
}
const TOOL = { T: 123, P: 123, D: 25.4, Z: -1234.567, type: 'endmill', description: 'Twelve mm three flute carbide roughing end mill' };
for (const units of ['mm', 'inch']) {
  test(`tool states ${units}`, async ({ page }) => {
    test.setTimeout(120_000);
    const vp = VIEWPORTS.find(v => v.name === 'touch-fullhd')!;
    const profile = PROFILES[0];
    await openLayout(page, profile, vp);
    if (units === 'inch') {
      await ctl({ op: 'raw', frame: { type: 'viewer_init', data: { units: 'inch', stl_base_url: '/machine/', parts: [], kinematics: [], axes: ['X', 'Y', 'Z'],
        machine_bounds: { origin: [0, 0, 0], size: [100, 100, 100] }, ini_config: { linear_units: 'inch' } } } });
      await expect(page.locator('[data-strip="jog"]')).toContainText(/Step \((in|inch)\)/);
    }
    const res: Record<string, unknown> = {};
    await publishToolTable([TOOL]);
    const variants: Record<string, Record<string, unknown>> = {
      applied: { tool_offset: [0, 0, TOOL.Z, 0, 0, 0, 0, 0, 0], gcodes: [430], tool_diameter: TOOL.D, tool_length: TOOL.Z, tool_table_z: TOOL.Z },
      'applied431': { tool_offset: [0, 0, TOOL.Z, 0, 0, 0, 0, 0, 0], gcodes: [431] },
      off49: { tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], gcodes: [490] },
      other: { tool_offset: [0, 0, -2345.678, 0, 0, 0, 0, 0, 0], gcodes: [430] },
    };
    await ctl({ op: 'status_delta', data: { tool_in_spindle: 123, tool_number: 123 } });
    await expect(page.locator('[data-strip="tool"]')).toContainText('T123');
    for (const [k, d] of Object.entries(variants)) {
      await ctl({ op: 'status_delta', data: d });
      await page.waitForTimeout(300);
      res[k] = await measure(page);
    }
    await setLayoutState(page, profile, 'running');
    res['other-running'] = await measure(page);
    await ctl({ op: 'replyFor', cmd: 'get_tool_table', reply: { ok: false, error: 'Tool table file unreadable: permission denied on /home/cnc/linuxcnc/configs/x/tool.tbl' } });
    await ctl({ op: 'raw', frame: { type: 'tool_table_changed', version: 99 } });
    await expect(page.locator('[data-strip="tool"] .statusNote')).toBeVisible();
    res['error'] = await measure(page);
    await page.locator('.strip').screenshot({ path: `${OUT}-${units}-error.png` });
    writeFileSync(`${OUT}.${units}.json`, JSON.stringify(res, null, 1));
  });
}

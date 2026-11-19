import { writeFileSync } from 'node:fs';
import { test, expect } from './test';
import { ctl, publishToolTable } from './ctl';
import { PROFILES, VIEWPORTS, openLayout, setLayoutState } from './layout-fixtures';
const OUT = process.env.SHOT_OUT ?? '/tmp/shot';
test('proto shot', async ({ page, browserName }) => {
  const vp = VIEWPORTS.find(v => v.name === 'touch-fullhd')!;
  await openLayout(page, PROFILES[0], vp);
  await publishToolTable([{ T: 12, P: 12, D: 12.7, Z: -123.456, type: 'endmill', description: 'Twelve mm three flute carbide roughing end mill' }]);
  await ctl({ op: 'status_delta', data: { tool_in_spindle: 12, tool_number: 12, tool_diameter: 12.7, tool_length: -123.456, tool_table_z: -123.456, tool_offset: [0, 0, -50, 0, 0, 0, 0, 0, 0], gcodes: [430] } });
  await expect(page.locator('[data-strip="tool"]')).toContainText('Twelve');
  const res: Record<string, unknown> = {};
  for (const st of ['homed', 'running'] as const) {
    await setLayoutState(page, PROFILES[0], st);
    await page.waitForTimeout(200);
    res[st] = await page.evaluate(() => {
      const s = document.querySelector('.strip') as HTMLElement;
      const secs = [...s.children].map(c => Math.round(c.getBoundingClientRect().width * 10) / 10).filter(w => w > 0);
      const last = [...s.children].filter(c => c.getBoundingClientRect().width > 0).pop()!.getBoundingClientRect().right;
      const rows = [...document.querySelectorAll('[data-strip="tool"] .statusRow')].map(r => r.scrollWidth > r.clientWidth);
      return { over: s.scrollWidth - s.clientWidth, spare: Math.round(s.getBoundingClientRect().right - last), secs, toolRowOver: rows };
    });
    await page.screenshot({ path: `${OUT}-${browserName}-${st}.png`, clip: { x: 0, y: 1080 - 300, width: 1920, height: 300 } });
  }
  writeFileSync(`${OUT}-${browserName}.json`, JSON.stringify(res, null, 1));
});

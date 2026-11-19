// Measurement probe (not a test): the portrait keypad / keyboard against the strip column.
import { writeFileSync } from 'node:fs';
import { test, expect } from './test';
import { PROFILES, VIEWPORTS, openLayout, enterStripState, leaveStripState } from './layout-fixtures';

const OUT = process.env.KP_OUT ?? '/tmp/kp';
for (const vp of VIEWPORTS.filter(v => ['touch-portrait', 'touch-landscape', 'touch-fullhd'].includes(v.name))) {
  test(`keypad geometry @ ${vp.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    const profile = PROFILES[0];
    await openLayout(page, profile, vp);
    const res: Record<string, unknown> = {};
    for (const st of ['keypad-setup', 'gcode-keypad'] as const) {
      await enterStripState(page, profile, st);
      const sel = st === 'keypad-setup' ? '.nkStrip' : '.tkStrip';
      res[st] = await page.evaluate((sel) => {
        const strip = document.querySelector('.strip') as HTMLElement;
        const helper = document.querySelector(sel) as HTMLElement;
        const r = (e: Element) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left), w: Math.round(b.width * 10) / 10, h: Math.round(b.height) }; };
        const keys = [...helper.querySelectorAll('button')].map(b => ({ label: b.getAttribute('aria-label') ?? b.textContent?.trim(), ...r(b) }));
        return { strip: r(strip), stripClient: strip.clientWidth, stripPad: getComputedStyle(strip).paddingLeft + '/' + getComputedStyle(strip).paddingRight,
          helper: r(helper), keys: keys.slice(0, 12), maxRight: Math.max(...[...helper.querySelectorAll('button')].map(b => b.getBoundingClientRect().right)) - helper.getBoundingClientRect().left };
      }, sel);
      await page.locator(sel).screenshot({ path: `${OUT}-${vp.name}-${st}.png` });
      await page.locator('.strip').screenshot({ path: `${OUT}-${vp.name}-${st}-strip.png` });
      await leaveStripState(page, profile, st);
    }
    writeFileSync(`${OUT}-${vp.name}.json`, JSON.stringify(res, null, 1));
    expect(Object.keys(res).length).toBe(2);
  });
}

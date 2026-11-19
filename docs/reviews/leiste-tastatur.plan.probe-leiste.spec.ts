// Measurement probe (not a test): the bottom strip's width budget per section.
import { writeFileSync } from 'node:fs';
import { test, expect } from './test';
import { PROFILES, VIEWPORTS, openLayout, setLayoutState, enterStripState, leaveStripState, type LayoutState } from './layout-fixtures';

const OUT = process.env.STRIP_MEASURE_OUT ?? '/tmp/strip-measure.json';
const results: unknown[] = [];

async function measure(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const strip = document.querySelector('.strip') as HTMLElement;
    const cs = getComputedStyle(strip);
    const desc = (el: Element) => {
      const h = el as HTMLElement;
      const r = h.getBoundingClientRect();
      const s = getComputedStyle(h);
      return {
        tag: h.tagName.toLowerCase(),
        cls: (h.className && typeof h.className === 'string') ? h.className.split(/\s+/).filter(c => !c.startsWith('data-v')).join('.') : '',
        strip: h.dataset.strip ?? null,
        w: Math.round(r.width * 10) / 10,
        x: Math.round(r.left * 10) / 10,
        padL: s.paddingLeft, padR: s.paddingRight, bl: s.borderLeftWidth, ml: s.marginLeft,
        display: s.display, gtc: s.display.includes('grid') ? s.gridTemplateColumns : undefined,
        gap: s.columnGap,
        text: h.children.length === 0 ? (h.textContent ?? '').trim().slice(0, 40) : undefined,
      };
    };
    const sections = [...strip.children].filter(c => (c as HTMLElement).offsetParent !== null || getComputedStyle(c).position === 'sticky').map(sec => ({
      ...desc(sec),
      kids: [...sec.children].map(k => ({ ...desc(k), kids: [...k.children].map(g => ({ ...desc(g), kids: [...g.children].map(desc) })) })),
    }));
    return {
      clientW: strip.clientWidth, scrollW: strip.scrollWidth, over: strip.scrollWidth - strip.clientWidth,
      padL: cs.paddingLeft, padR: cs.paddingRight, gap: cs.columnGap, viewport: innerWidth,
      sections,
    };
  });
}

for (const profile of PROFILES) {
  for (const vp of VIEWPORTS.filter(v => ['touch-fullhd', 'desktop', 'touch-landscape', 'compact'].includes(v.name))) {
    test(`strip budget ${profile.name} @ ${vp.name}`, async ({ page }) => {
      test.setTimeout(120_000);
      await openLayout(page, profile, vp);
      for (const st of ['homed', 'unhomed', 'disarmed', 'off', 'estop', 'running', 'paused'] as LayoutState[]) {
        await setLayoutState(page, profile, st);
        results.push({ profile: profile.name, vp: vp.name, state: st, ...(await measure(page)) });
      }
      await setLayoutState(page, profile, 'homed');
      for (const st of ['joint-jog', 'spindle-preselect', 'keypad-setup'] as const) {
        await enterStripState(page, profile, st);
        results.push({ profile: profile.name, vp: vp.name, state: st, ...(await measure(page)) });
        await leaveStripState(page, profile, st);
      }
      expect(results.length).toBeGreaterThan(0);
      writeFileSync(OUT.replace('.json', `.${profile.name}.${vp.name}.json`), JSON.stringify(results.filter((r: any) => r.profile === profile.name && r.vp === vp.name), null, 1));
    });
  }
}

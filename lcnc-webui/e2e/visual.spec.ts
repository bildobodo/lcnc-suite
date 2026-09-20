import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { ctl } from './ctl';
import { assertLayout, measureLayout } from './layout-audit';
import { openLayout, PANELS, PROFILES, setLayoutState, settleLayout, VIEWPORTS, type LayoutState } from './layout-fixtures';

// Test-only font assets; production keeps its native system font. Pin both
// weights so a CI runner's installed fonts cannot silently change the goldens.
const font = (name: string) => readFileSync(new URL(`./fonts/${name}.ttf`, import.meta.url)).toString('base64');
const fontCss = `
  @font-face { font-family: LayoutReference; font-weight: 400;
    src: url(data:font/ttf;base64,${font('DejaVuSans')}); }
  @font-face { font-family: LayoutReference; font-weight: 700;
    src: url(data:font/ttf;base64,${font('DejaVuSans-Bold')}); }
  html, body, button, input, select, textarea, .strip * { font-family: LayoutReference !important; }
`;

test.afterEach(async () => { await ctl({ op: 'reset' }); });

for (const profile of PROFILES) {
  for (const viewport of [VIEWPORTS[0], VIEWPORTS[3]]) {
    test(`${profile.name} ${viewport.name}: Jog and Setup reference images`, async ({ page }, info) => {
      // One Linux reference set, not silently generated per developer OS.
      test.skip(process.platform !== 'linux', 'Visual references use Linux Chromium; geometry tests are portable.');
      await openLayout(page, profile, viewport);
      await page.addStyleTag({ content: fontCss });
      await page.evaluate(() => document.fonts.ready);
      const states: LayoutState[] = ['homed', 'unhomed'];
      if (profile.name === '6axis-twp') states.push('plane-stale');
      for (const state of states) {
        await setLayoutState(page, profile, state);
        for (const name of ['jog', 'setup'] as const) {
          const root = page.locator(PANELS[name]);
          await root.scrollIntoViewIfNeeded();
          await settleLayout(page);
          await assertLayout(root, await measureLayout(root, name), info);
          await expect(root).toHaveScreenshot(`${profile.name}-${viewport.name}-${state}-${name}.png`, {
            animations: 'disabled', caret: 'hide', scale: 'css',
            // Ignore tiny rasterisation differences, not moved or resized
            // controls (the independent geometry checks have a 1px limit).
            threshold: 0.2, maxDiffPixelRatio: 0.002,
            // The pinned Safety panel and scroll-edge shadows are outside
            // this component's contract and must not obscure its screenshot.
            stylePath: fileURLToPath(new URL('./visual-capture.css', import.meta.url)),
          });
        }
      }
    });
  }
}

// Tool edit dialog references (WP3): one per viewport, the preview canvas
// masked (WebGL rasterisation is not part of the layout contract).
const barrel = { T: 416, P: 7, Z: -42.3, D: 12, type: "circlebarrel",
  fusion_type: "circle segment barrel", description: "Imported barrel cutter",
  oal: 80, flute_length: 20, shoulder_length: 20, shaft_diameter: 12,
  lower_radius: 1, upper_radius: 1, profile_radius: 48, axial_distance: 10 };
for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: tool edit dialog reference image`, async ({ page }, info) => {
    test.skip(process.platform !== 'linux', 'Visual references use Linux Chromium; geometry tests are portable.');
    await openLayout(page, PROFILES[0], viewport);
    await page.addStyleTag({ content: fontCss });
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await expect.poll(async () => {
      await ctl({ op: 'raw', frame: { type: 'reply', cmd: 'get_tool_table', ok: true, tools: [barrel] } });
      return page.getByTitle('Edit tool', { exact: true }).count();
    }).toBe(1);
    await page.getByTitle('Edit tool', { exact: true }).click();
    const dialog = page.locator('.editDialog');
    await expect(dialog.locator('.editPreviewCanvas canvas')).toBeVisible();
    await settleLayout(page);
    await assertLayout(dialog, await measureLayout(dialog, `tool-edit-${viewport.name}`), info);
    await expect(dialog).toHaveScreenshot(`tool-edit-${viewport.name}.png`, {
      animations: 'disabled', caret: 'hide', scale: 'css',
      threshold: 0.2, maxDiffPixelRatio: 0.002,
      mask: [dialog.locator('.editPreviewCanvas canvas')],
    });
  });
}

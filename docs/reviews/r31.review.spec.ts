// Codex R31 independent review probe. Run only against an isolated mock.
// Copy to e2e/r31.review.spec.ts; ctl.ts must point to own mock (here :4188).
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { encode } from '@msgpack/msgpack';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';
const OUT = process.env.R31_EVIDENCE || '../evidence';
mkdirSync(OUT, {recursive:true});
const FEED = Array.from({ length: 10 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
const PREVIEW = Buffer.from(encode({ file: "/rapids.ngc", preview_schema: 9, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.length),   // the track takes the flags only from both streams
  rapid: [[27, 20, 0], [150, 20, 5]], rapid_lines: [13, 14], rapid_seq: [13, 14],
  rapid_outside: new Uint8Array([0, 1]),
  violations: [{ line: 14, axis: "X", value: 150, limit: 100, kind: "max" }], violations_total: 1 }));

const shown = (page:Page, role:string) => page.evaluate(r => window.__viewerDiag!.projectRole!(r) != null, role);
async function settings(data:Record<string,unknown>) {
  await ctl({op:'raw', frame:{type:'settings_changed', settings:data}});
}
async function prepare(page:Page, context:BrowserContext, hud:boolean) {
  await context.route(/\/preview(\?|$)/, r=>r.fulfill({contentType:'application/octet-stream',body:PREVIEW}));
  await context.route(/\/gcode(\?|$)/, r=>r.fulfill({contentType:'text/plain',body:Array.from({length:16},(_,i)=>i?`G1 X${i} F100`:'(rapids)').join('\n')}));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v=>v.name==='desktop')!);
  await ctl({op:'status_delta',data:{active_file:'/rapids.ngc'}});
  await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:1970,file:'/rapids.ngc'}});
  await expect(page.locator('.scrubBar [aria-label="Next limit violation"]')).toBeVisible();
  await expect.poll(()=>shown(page,'rapid')).toBe(true);
  await settings({display:{theme:'light'}, viewer:{layers:{rapids:false,hud}}});
  await expect.poll(()=>shown(page,'rapid')).toBe(false);
  await ctl({op:'status_delta',data:{is_enabled:false,enabled:false}});
}
async function jump(page:Page) {
  await page.locator('.scrubBar [aria-label="Next limit violation"]').click();
  await expect(page.locator('.simBanner')).toBeVisible();
  await expect.poll(()=>shown(page,'rapid')).toBe(true);
}
async function snapshot(page:Page) {
  return {rapidShown:await shown(page,'rapid'), limitShown:await shown(page,'limit'),
    noticeCount:await page.locator('[data-path-reveal]').count(),
    noticeVisible:await page.locator('[data-path-reveal]').isVisible(),
    noticeText:await page.locator('[data-path-reveal]').allTextContents(),
    hudNotes:await page.locator('.hudNotes').allTextContents(),
    theme:await page.locator('html').getAttribute('data-theme'),
    simulation:await page.locator('.simBanner').isVisible()};
}
test('R31 unrelated settings preserve the active finding reveal', async({page,context})=>{
  await prepare(page,context,true);
  await jump(page);
  await expect(page.locator('[data-path-reveal]')).toBeVisible();
  const before=await snapshot(page);
  await settings({display:{theme:'dark'}, viewer:{layers:{rapids:false,hud:true}}});
  await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.waitForTimeout(200);
  const after=await snapshot(page);
  writeFileSync(`${OUT}/r31.settings.json`, JSON.stringify({before,after},null,2)+'\n');
  await page.screenshot({path:`${OUT}/r31.settings.png`});
  expect.soft(after.rapidShown, 'Changing theme alone must not clear a finding reveal').toBe(true);
  expect.soft(after.noticeVisible, 'Reveal remains named until its defined end').toBe(true);
});
test('R31 a hidden HUD still explains the temporary reveal', async({page,context})=>{
  await prepare(page,context,false);
  await jump(page);
  const after=await snapshot(page);
  writeFileSync(`${OUT}/r31.hud-off.json`, JSON.stringify(after,null,2)+'\n');
  await page.screenshot({path:`${OUT}/r31.hud-off.png`});
  expect(after.noticeVisible,'The user must know why a hidden layer is visible').toBe(true);
});

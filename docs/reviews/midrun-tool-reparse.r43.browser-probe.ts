import { test, expect } from '@playwright/test';
import { encode } from '@msgpack/msgpack';
import { readFileSync, writeFileSync } from 'node:fs';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS } from './layout-fixtures';

const out = new URL('../../evidence/', import.meta.url);

test('R43: table staleness must open the warning card on XYZ without an unrelated warning', async ({page, context}) => {
 const evidence = JSON.parse(readFileSync(new URL('midrun-tool-reparse.r43.input-envelopes.json', out), 'utf8'));
 const file = '/r43-tool-table.ngc';
 const preview = Buffer.from(encode({file, preview_schema:9,
  feed:[[0,0,0],[10,0,0],[10,10,0]], feed_lines:[1,2,3], feed_seq:[1,2,3], rapid:[],
  parse_tlos:evidence.parse_tlos, violations:[], violations_total:0}));
 await context.route(/\/preview(\?|$)/, r => r.fulfill({contentType:'application/octet-stream', body:preview}));
 await context.route(/\/gcode(\?|$)/, r => r.fulfill({contentType:'text/plain', body:'G0 X0\nG1 X10 F100\nG1 Y10\nM2\n'}));
 await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === 'desktop')!);
 await ctl({op:'quiet', on:true});
 await ctl({op:'status_delta', data:{active_file:file, interp_state:2, task_mode:2,
  tool_number:1, tool_length:10, g5x_offset:Array(9).fill(0), g92_offset:Array(9).fill(0), rotation_xy:0}});
 await ctl({op:'raw', frame:{type:'viewer_gcode_ready', version:4201, file}});
 const palette = () => page.evaluate(() => window.__viewerDiag!.getPalette!());
 const snapshot = async () => ({palette:await palette(),
  cardCount:await page.locator('.hudNotes').count(),
  tableWarningCount:await page.locator('[data-table-stale]').count(),
  warnings:await page.locator('.hudWarn').allTextContents()});
 const send = async (key:string, data:Record<string, unknown> = {}) => {
  // Use the real BulkPipeline/build_status_envelope result, changing only the
  // envelope type to a delta so the mock's independent machine state survives.
  await ctl({op:'raw', frame:{...evidence[key], type:'status_delta', data}});
  await page.waitForTimeout(200);
 };
 await expect.poll(async () => (await palette()).drawn.feed).toBe('#00a83c');
 const fresh = await snapshot();
 await send('during');
 await expect(page.locator('.hudWarn').filter({hasText:'Preview re-parsing'})).toBeVisible();
 const during = await snapshot();
 await send('refused');
 await expect(page.locator('.hudWarn').filter({hasText:'Preview re-parsing'})).toHaveCount(0);
 const refusedOnly = await snapshot();
 await page.screenshot({path:new URL('midrun-tool-reparse.r43.refused-only.png', out).pathname});
 // Positive control: same table mark, an unrelated Rotation line now opens
 // the card; this proves the mark reached the viewer and identifies its gate.
 await send('refused', {rotation_xy:1});
 await expect(page.locator('[data-table-stale]')).toBeVisible();
 const refusedWithRotation = await snapshot();
 await page.screenshot({path:new URL('midrun-tool-reparse.r43.refused-with-rotation.png', out).pathname});
 await send('failed_idle', {rotation_xy:0, interp_state:1});
 const failedIdleOnly = await snapshot();
 await send('published_idle');
 await expect.poll(async () => (await palette()).drawn.feed).toBe(fresh.palette.drawn.feed);
 const publishedIdle = await snapshot();
 await send('no_basis', {interp_state:2});
 const noBasisOnly = await snapshot();
 await send('no_basis', {rotation_xy:1});
 await expect(page.locator('[data-table-stale]')).toBeVisible();
 const noBasisWithRotation = await snapshot();
 await send('unloaded', {rotation_xy:0, interp_state:1, active_file:null});
 await expect(page.locator('[data-table-stale]')).toHaveCount(0);
 const unloaded = await snapshot();
 const cmds = (await ctl({op:'lastCmds'})).cmds;
 writeFileSync(new URL('midrun-tool-reparse.r43.client.json', out), JSON.stringify({commit:'0d07dae',
  profile:'3axis-xyz', changedTool:2, loadedTool:1, fresh, during, refusedOnly,
  refusedWithRotation, failedIdleOnly, publishedIdle, noBasisOnly, noBasisWithRotation, unloaded, cmds}, null, 2));
 await ctl({op:'reset'});
 expect(refusedOnly.palette.drawn.feed).not.toBe(fresh.palette.drawn.feed);
 expect(failedIdleOnly.palette.drawn.feed).toBe(refusedOnly.palette.drawn.feed);
 expect(noBasisOnly.palette.drawn.feed).toBe(refusedOnly.palette.drawn.feed);
 expect(publishedIdle.tableWarningCount).toBe(0);
 expect.soft(refusedOnly.tableWarningCount, 'unsupported alone must explain the muted preview').toBe(1);
 expect.soft(failedIdleOnly.tableWarningCount, 'failed idle parse must retain the explanation').toBe(1);
 expect.soft(noBasisOnly.tableWarningCount, 'no-basis alone must explain the muted preview').toBe(1);
});

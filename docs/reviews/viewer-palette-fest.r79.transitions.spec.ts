// The Simulation tab (operator 2026-10-05, variant A of the renders): the
// scrub bar is ONE row — Sim, play, the timeline, the time — and the
// findings live in the side pane's tab: the collision check with its
// progress, one list of the timeline's marks (× collision, ▲ soft limit,
// ● tool change), a filter, the steps. Stepping through collisions used to
// change the findings row's text width and the bar folded and unfolded under
// the operator's finger; the list's rows are the bar's own targets.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { openSimTab, simStepBtn } from "./simTab";

const FEED = Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
FEED[17]![0] = 110;   // line 20 out of the X window
FEED[29]![0] = 120;   // line 32 out of the X window
const PREVIEW = Buffer.from(encode({ file: "/sim.ngc", preview_schema: 10, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.map(p => (p[0]! > 100 ? 1 : 0))),
  feed_tcum: new Uint8Array(new Float32Array(FEED.map((_, i) => i * 4)).buffer),
  violations: [{ line: 20, axis: "X", value: 110, limit: 100, kind: "max" }, { line: 32, axis: "X", value: 120, limit: 100, kind: "max" }],
  violations_total: 2 }));
const TEXT = Array.from({ length: 34 }, (_, i) => i === 0 ? "(sim)" : i === 9 ? "T3 M6" : `G1 X${i} F100`).join("\n");

async function prepare(page: Page, context: BrowserContext, vp = "desktop") {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: TEXT }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === vp)!);
  await ctl({ op: "status_delta", data: { active_file: "/sim.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5100, file: "/sim.ngc" } });
  await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
  // The sweep's verdict, then two collisions on the swept track (L12 feed, L26 rapid).
  await expect.poll(() => page.locator(".simPanel .checkVerdict").count(), { timeout: 30_000 }).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(
    [{ line: 12, frac: 9 / 29 }, { line: 26, frac: 23 / 29, rapid: true }]) ?? false)).toBe(true);
  await openSimTab(page);
}




const focusState=(page:Page)=>page.evaluate(()=>({tag:document.activeElement?.tagName,cls:document.activeElement?.className,label:document.activeElement?.getAttribute('aria-label'),inPanel:!!document.activeElement?.closest('.simPanel')}));
const commands=async()=>((await ctl({op:'lastCmds'})).cmds as {cmd:string}[]).filter(x=>/jog/.test(x.cmd));
const save=(name:string,v:unknown)=>writeFileSync(`../evidence/viewer-palette-fest.r79.${process.env.R79_BROWSER||'chromium'}-${name}.json`,JSON.stringify(v,null,2)+'\n');
async function jogLive(page:Page){
 await ctl({op:'status_delta',data:{is_enabled:true,enabled:true}});
 await expect(page.locator('.statusBanner')).toContainText('IDLE');
 await ctl({op:'raw',frame:{type:'settings_init',settings:{keyboard:{jogEnabled:true,buttonsEnabled:true,mapping:{'jog_x+':'ArrowRight','jog_x-':'ArrowLeft','jog_y+':'ArrowUp','jog_y-':'ArrowDown',estop:'Escape',cycle:' ',abort:'Backspace'}}}}});
 await ctl({op:'clearCmds'});
 await expect.poll(async()=>{
  await page.evaluate(()=>(document.activeElement as HTMLElement)?.blur());
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(100); await page.keyboard.up('ArrowRight');
  return (await commands()).map(c=>c.cmd);
 }).toEqual(expect.arrayContaining(['jog_cont','jog_stop']));
 await ctl({op:'clearCmds'});
}
async function arrows(page:Page){for(const k of ['ArrowRight','ArrowLeft','ArrowUp','ArrowDown','Control+ArrowRight']) await page.keyboard.press(k); await page.waitForTimeout(100);return commands();}
test.afterEach(async()=>{await ctl({op:'reset'});});

test('R79: empty program parks owned focus on the panel, navigation stays local',async({page,context})=>{
 await prepare(page,context); await jogLive(page);
 await page.locator('[data-sim-row^="C12|"] .rowPick').focus();
 await ctl({op:'raw',frame:{type:'viewer_gcode',data:{file:null}}});
 await expect(page.locator('.simPanel')).toContainText('Load a program to simulate it.');
 const focus=await focusState(page); const cmds=await arrows(page);save('empty-program',{focus,cmds});
 await expect(page.locator('.simPanel')).toBeFocused(); expect(cmds).toEqual([]);
});

test('R79: a focused step survives a new machine-on reason without jog',async({page,context})=>{
 await prepare(page,context); await jogLive(page);
 await ctl({op:'status_delta',data:{is_enabled:false,enabled:false}});
 await expect(page.locator('.statusBanner')).toContainText('MACHINE OFF');
 await simStepBtn(page,'Next on the timeline').focus();
 await ctl({op:'status_delta',data:{is_enabled:true,enabled:true}});
 await expect(page.locator('.statusBanner')).toContainText('IDLE');
 const focus=await focusState(page); const cmds=await arrows(page);save('step-reason',{focus,cmds});
 expect(focus.inPanel).toBe(true); expect(cmds).toEqual([]);
});

test('R79: refreshing results does not steal focus from outside the panel',async({page,context})=>{
 await prepare(page,context);
 const tab=page.getByRole('tab',{name:'Sim',exact:true}); await tab.focus();
 await page.evaluate(()=>window.__viewerDiag?.setCollisionHits?.([]));
 await expect(page.locator('[data-sim-row^="C"]')).toHaveCount(0);
 save('outside-focus',await focusState(page)); await expect(tab).toBeFocused();
});

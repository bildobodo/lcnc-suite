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
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";
import { openSimTab } from "./simTab";

const FEED = Array.from({ length: 130 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
FEED[17]![0] = 110;   // line 20 out of the X window
FEED[29]![0] = 120;   // line 32 out of the X window
const PREVIEW_FIELDS = { file: "/sim.ngc", preview_schema: 10, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.map(p => (p[0]! > 100 ? 1 : 0))),
  feed_tcum: new Uint8Array(new Float32Array(FEED.map((_, i) => i * 4)).buffer),
  violations: [{ line: 20, axis: "X", value: 110, limit: 100, kind: "max" }, { line: 32, axis: "X", value: 120, limit: 100, kind: "max" }],
  violations_total: 2 };
const CAPPED = {...PREVIEW_FIELDS, violations: Array.from({length:100},(_,i)=>['X','Y'].map(axis=>({line:i+8,axis,value:110,limit:100,kind:'max'}))).flat(), violations_total:200636};
const PREVIEW = Buffer.from(encode(CAPPED));
// T3 on line 10; T5 on line 20 — the same moment as line 20's limit
const TEXT = Array.from({ length: 134 }, (_, i) => i === 0 ? "(sim)" : i === 9 ? "T3 M6" : i === 19 ? "T5 M6" : `G1 X${i} F100`).join("\n");

async function prepare(page: Page, context: BrowserContext, vp = "desktop", preview = PREVIEW) {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
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


import { scan } from './r85.scan';
const save=(n:string,d:unknown)=>writeFileSync(`../evidence/viewer-palette-fest.r85.${process.env.R85_BROWSER||'chromium'}-${n}.json`,JSON.stringify(d,null,2)+'\n');
test.afterEach(async()=>{await ctl({op:'reset'});});

test('R85: one mark palette reaches the rendered surfaces in all six theme modes',async({page,context})=>{
 await prepare(page,context);
 const rows=[];
 for(const mode of ['light','dark','hc-light','hc-dark','auto-light','auto-dark']){
  await page.emulateMedia({colorScheme:mode==='auto-dark'?'dark':'light',reducedMotion:'reduce'});
  await page.evaluate(m=>{if(m.startsWith('auto'))document.documentElement.removeAttribute('data-theme');else document.documentElement.setAttribute('data-theme',m);},mode);
  await settleLayout(page);
  const colors=await page.evaluate(()=>{
   const sample=(s:string)=>Array.from(document.querySelectorAll(s)).map(el=>({tag:el.tagName,cls:el.getAttribute('class'),color:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
   return {clash:sample('.sumGlyph.clash,.sumKind.clash,.colKind.clash,.scrubTick.clash,.codeLine.collision .lineMark,.codeLine.collision .lineNumber'),
    limit:sample('.sumGlyph.limit,.sumKind.limit,.colKind.limit,.scrubTick.limit,.codeLine.violation:not(.collision) .lineMark,.codeLine.violation:not(.collision) .lineNumber,.hudMarkLimit'),
    tool:sample('.sumGlyph.tool,.sumKind.tool,.colKind.tool,.scrubTick.tool'),
    tokens:['--mark-clash','--mark-limit','--mark-tool','--warn-text','--danger-text','--info-text'].map(v=>[v,getComputedStyle(document.documentElement).getPropertyValue(v).trim()])};
  });
  rows.push({mode,...colors});
  for(const [kind,color] of [['clash','rgb(255, 51, 85)'],['limit','rgb(255, 160, 0)'],['tool','rgb(61, 139, 255)']] as const){
   expect(colors[kind].length,`${mode}: ${kind} has glyphs, text, list and ticks`).toBeGreaterThan(4);
   expect(colors[kind].every(c=>c.color===color),JSON.stringify({mode,kind,colors:colors[kind]})).toBe(true);
  }
  if(mode==='light'||mode==='dark')await page.locator('.sidePane').screenshot({path:`../evidence/viewer-palette-fest.r85.${process.env.R85_BROWSER||'chromium'}-marks-${mode}.png`});
 }
 save('mark-colors',rows);
});

test('R85: the contrast exception does not swallow other text or descendants',async({page})=>{
 await page.setContent(`<style>:root{--mark-clash:#ff3355;--mark-limit:#ffa000;--mark-tool:#3d8bff;--fg:#111}body{background:white;color:#111}#probe{background:white}</style><div id="probe"><p style="color:#ff3355">exact-red</p><p style="color:#ffa000">exact-orange</p><p style="color:#3d8bff">exact-blue</p><p style="color:#ff3155">different-red</p><p style="color:#eee">bad-text</p><p style="color:#111">readable-text</p><div style="color:#ff3355"><span style="color:#eee">descendant-bad-text</span></div></div>`);
 const result=await page.evaluate(scan,{rootSel:'#probe',floor:4.5});
 save('contrast-exception',result);
 expect(result.checked).toBe(4);
 expect(result.hits.map(h=>h.text).sort()).toEqual(['bad-text','descendant-bad-text','different-red'].sort());
});

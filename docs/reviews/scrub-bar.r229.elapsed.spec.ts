// The Simulation tab (operator 2026-10-05, variant A of the renders): the
// scrub bar is ONE row — Sim, play, the timeline, the time — and the
// findings live in the side pane's tab: the collision check with its
// progress, one list of the timeline's marks (× collision, ▲ soft limit,
// ● tool change), a filter, the steps. Stepping through collisions used to
// change the findings row's text width and the bar folded and unfolded under
// the operator's finger; the list's rows are the bar's own targets.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { decode, encode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";
import { openSimTab, simLine, simShow, simStepBtn } from "./simTab";
import { FIRST_ROWS } from "../src/viewer/simListRange";
import { withLimitRuns } from "./limitRuns";

const FEED = Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
FEED[17]![0] = 110;   // line 20 out of the X window
FEED[29]![0] = 120;   // line 32 out of the X window
const PREVIEW_FIELDS = withLimitRuns({ file: "/sim.ngc", preview_schema: 11, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.map(p => (p[0]! > 100 ? 1 : 0))),
  feed_tcum: new Uint8Array(new Float32Array(FEED.map((_, i) => i * 4)).buffer),
  violations: [{ line: 20, axis: "X", value: 110, limit: 100, kind: "max" }, { line: 32, axis: "X", value: 120, limit: 100, kind: "max" }],
  violations_total: 2 });
const PREVIEW = Buffer.from(encode(PREVIEW_FIELDS));
// T3 on line 10; T5 on line 20 — the same moment as line 20's limit
const TEXT = Array.from({ length: 34 }, (_, i) => i === 0 ? "(sim)" : i === 9 ? "T3 M6" : i === 19 ? "T5 M6" : `G1 X${i} F100`).join("\n");

async function prepare(page: Page, context: BrowserContext, vp = "desktop", preview = PREVIEW, setHits = true) {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: TEXT }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === vp)!);
  await ctl({ op: "status_delta", data: { active_file: "/sim.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5100, file: "/sim.ngc" } });
  await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
  // The sweep's verdict, then two collisions on the swept track (L12 feed, L26 rapid).
  await expect.poll(() => page.locator(".simPanel .checkVerdict").count(), { timeout: 30_000 }).toBe(1);
  if (setHits) await expect.poll(() => page.evaluate(() => window.__viewerDiag?.setCollisionHits?.(
    [{ line: 12 }, { line: 26, rapid: true }]) ?? false)).toBe(true);
  await openSimTab(page);
}
const rows = (page: Page) => page.locator(".simPanel tbody tr[data-sim-row]");
const rowKeys = (page: Page) => rows(page).evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")));



test('R229 narrow elapsed time stays whole and the slider fixed through the end of a 30 hour program',async({page,context},info)=>{
 const seconds=108000;
 const payload=Buffer.from(encode({...PREVIEW_FIELDS,feed_tcum:new Uint8Array(new Float32Array(FEED.map((_,i)=>seconds*i/(FEED.length-1))).buffer)}));
 await prepare(page,context,'touch-portrait',payload,false);
 await page.evaluate(()=>document.documentElement.style.zoom='1.5');await settleLayout(page);
 await page.locator('.scrubBar input.toggle').check();
 const values=[];
 for(const [at,expected] of [[0,'00:00'],[54000,'15:00:00'],[108000,'30:00:00']] as const) {
  await page.locator('.scrubBar .sliderInput').evaluate((el:HTMLInputElement,v)=>{el.value=String(v);el.dispatchEvent(new Event('input',{bubbles:true}));},at);
  await expect(page.locator('.scrubBar .posSlot')).toHaveText(new RegExp('^'+expected));
  const m=await page.locator('.scrubBar').evaluate(el=>{const p=el.querySelector('.posSlot') as HTMLElement; const slider=el.querySelector('.sliderWrap') as HTMLElement;
   return {text:p.innerText,title:p.title,scroll:p.scrollWidth,client:p.clientWidth,slider:slider.getBoundingClientRect().toJSON()};});
  expect(m.text).toBe(expected);expect(m.title).toBe(expected+'/30:00:00');expect(m.scroll).toBeLessThanOrEqual(m.client+1);
  expect(m.slider.width/1.5).toBeGreaterThanOrEqual(120);
  values.push(m);
 }
 expect(values[2]!.slider).toEqual(values[0]!.slider);
 console.log('R229 elapsed '+JSON.stringify(values));
 await page.screenshot({path:info.outputPath('elapsed-end.png')});
});

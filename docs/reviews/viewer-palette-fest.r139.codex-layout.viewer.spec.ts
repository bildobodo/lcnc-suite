// The Simulation tab (operator 2026-10-05, variant A of the renders): the
// scrub bar is ONE row — Sim, play, the timeline, the time — and the
// findings live in the side pane's tab: the collision check with its
// progress, one list of the timeline's marks (× collision, ▲ soft limit,
// ● tool change), a filter, the steps. Stepping through collisions used to
// change the findings row's text width and the bar folded and unfolded under
// the operator's finger; the list's rows are the bar's own targets.
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from "./layout-fixtures";
import { openSimTab, simLine, simShow, simStepBtn } from "./simTab";

const FEED = Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
FEED[17]![0] = 110;   // line 20 out of the X window
FEED[29]![0] = 120;   // line 32 out of the X window
const PREVIEW_FIELDS = { file: "/sim.ngc", preview_schema: 11, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.map(p => (p[0]! > 100 ? 1 : 0))),
  feed_tcum: new Uint8Array(new Float32Array(FEED.map((_, i) => i * 4)).buffer),
  violations: [{ line: 20, axis: "X", value: 110, limit: 100, kind: "max" }, { line: 32, axis: "X", value: 120, limit: 100, kind: "max" }],
  violations_total: 2 };
const PREVIEW = Buffer.from(encode(PREVIEW_FIELDS));
// T3 on line 10; T5 on line 20 — the same moment as line 20's limit
const TEXT = Array.from({ length: 34 }, (_, i) => i === 0 ? "(sim)" : i === 9 ? "T3 M6" : i === 19 ? "T5 M6" : `G1 X${i} F100`).join("\n");

async function prepare(page: Page, context: BrowserContext, vp = "desktop", preview = PREVIEW) {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: TEXT }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === vp)!);
  await ctl({ op: "status_delta", data: { active_file: "/sim.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5100, file: "/sim.ngc" } });
  await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
  // The sweep's verdict, then two collisions on the swept track (L12 feed, L26 rapid).
  await expect.poll(() => page.locator(".simPanel .checkVerdict").count(), { timeout: 30_000 }).toBe(1);
  await openSimTab(page);
}
const rows = (page: Page) => page.locator(".simPanel tbody tr");
const rowKeys = (page: Page) => rows(page).evaluateAll(trs => trs.map(t => t.getAttribute("data-sim-row")));


import fs from 'node:fs';
for (const [vp, zoom] of [['desktop',1],['touch-landscape',1],['touch-portrait',1.5]] as const)
test(`R137: mixed summary, ${vp} at ${zoom}`,  async ({page,context}) => {
  await page.addInitScript(() => {
    const Real = window.Worker;
    window.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url,options);
        if (!/collisionWorker/.test(String(url))) return;
        this.addEventListener('message', ev => {
          if (!ev.data?.result) return;
          const hit = (line: number, dist: number, extra = {}) => ({line,cum:line,cumEnd:line+1,a:'spindle',b:'vise',dist,rapid:true,...extra});
          const hits = [hit(12,0),hit(14,0,{entryMove:true}),hit(16,0,{possible:true}),hit(18,1.5)];
          for (let i=0;i<196;i++) hits.push(hit(19+i%10,0,{b:'fixture_'+i}));
          // 200 retained onsets, 2 additional onsets and 23 continuations
          // capped: consistent with MAX_HITS, solely a rendering fixture.
          Object.assign(ev.data.result, {pairCount:200,hits, capped:25,cappedOnsets:2});
        });
      }
    };
  });
  await prepare(page,context,vp);
  if(zoom!==1)await page.evaluate(z=>{document.documentElement.style.zoom=String(z);},zoom);
  await settleLayout(page);
  await expect(page.locator('.simSummary .sumItem').first()).toHaveAttribute('aria-label', /more contacts not listed/);
  const measurement = await page.locator('.simSummary').evaluate(el => {
    const rect = (e:Element) => {const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
    return {pane:rect(document.querySelector('.sidePane')!),narrow:document.querySelector('.sidePane')!.classList.contains('narrow'),
      form:el.getAttribute('data-sum-form'),
      verdict:{text:el.querySelector('.checkVerdict')!.textContent,sw:el.querySelector('.checkVerdict')!.scrollWidth,cw:el.querySelector('.checkVerdict')!.clientWidth},
      aria:el.querySelector('.sumItem')!.getAttribute('aria-label'),summary:rect(el),items:[...el.querySelectorAll('.sumItem')].map(e=>({text:e.textContent,rect:rect(e)}))};
  });
  await page.getByRole('button',{name:'Help: Summary',exact:true}).click();
  const help=await page.locator('.helpPopover:popover-open').innerText();
  fs.writeFileSync(`/tmp/codex-r139-p56dtkmu/summary-${vp}.json`,JSON.stringify({...measurement,help},null,2));
  await page.screenshot({path:`/tmp/codex-r139-p56dtkmu/summary-${vp}.png`});
  if(vp==='desktop')expect(measurement.narrow).toBe(false);
  expect(measurement.items[0]!.rect.right, 'result, coverage and cap must fit in the visible summary').toBeLessThanOrEqual(measurement.summary.right+1);
  {
    expect.soft(help,'touch help carries the hidden coverage').toContain('checked in full');
    expect.soft(help,'touch help carries the hidden cap').toContain('more contacts not listed');
  }
  await ctl({op:'reset'});
});

test('R138: continuation-only cap stays visibly marked in the last form',  async ({page,context}) => {
  const vp='touch-portrait', zoom=1.5;
  await page.addInitScript(() => {
    const Real = window.Worker;
    window.Worker = class extends Real {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url,options);
        if (!/collisionWorker/.test(String(url))) return;
        this.addEventListener('message', ev => {
          if (!ev.data?.result) return;
          const hit = (line: number, dist: number, extra = {}) => ({line,cum:line,cumEnd:line+1,a:'spindle',b:'vise',dist,rapid:true,...extra});
          const hits = [hit(12,0),hit(14,0,{entryMove:true}),hit(16,0,{possible:true}),hit(18,1.5)];
          for (let i=0;i<196;i++) hits.push(hit(19+i%10,0,{b:'fixture_'+i}));
          // 200 retained onsets, no additional onsets and 25 continuations
          // capped: consistent with MAX_HITS, solely a rendering fixture.
          Object.assign(ev.data.result, {pairCount:200,hits, capped:25,cappedOnsets:0});
        });
      }
    };
  });
  await prepare(page,context,vp);
  if(zoom!==1)await page.evaluate(z=>{document.documentElement.style.zoom=String(z);},zoom);
  await settleLayout(page);
  await expect(page.locator('.simSummary .sumItem').first()).toHaveAttribute('aria-label', /records cut/);
  const measurement = await page.locator('.simSummary').evaluate(el => {
    const rect = (e:Element) => {const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
    return {pane:rect(document.querySelector('.sidePane')!),narrow:document.querySelector('.sidePane')!.classList.contains('narrow'),
      form:el.getAttribute('data-sum-form'),
      verdict:{text:el.querySelector('.checkVerdict')!.textContent,sw:el.querySelector('.checkVerdict')!.scrollWidth,cw:el.querySelector('.checkVerdict')!.clientWidth},
      aria:el.querySelector('.sumItem')!.getAttribute('aria-label'),summary:rect(el),items:[...el.querySelectorAll('.sumItem')].map(e=>({text:e.textContent,rect:rect(e)}))};
  });
  await page.getByRole('button',{name:'Help: Summary',exact:true}).click();
  const help=await page.locator('.helpPopover:popover-open').innerText();
  fs.writeFileSync(`/tmp/codex-r139-p56dtkmu/summary-records-cut.json`,JSON.stringify({...measurement,help},null,2));
  await page.screenshot({path:`/tmp/codex-r139-p56dtkmu/summary-records-cut.png`});
  expect(measurement.form).toBe('3');
  expect.soft(measurement.items[0]!.text,'the final form needs a visible record-cap indication, distinct from the exact uncapped count').not.toBe('200 · in full');
  expect(measurement.items[0]!.rect.right, 'result, coverage and cap must fit in the visible summary').toBeLessThanOrEqual(measurement.summary.right+1);
  {
    expect.soft(help,'touch help carries the hidden coverage').toContain('checked in full');
    expect.soft(help,'touch help carries the hidden cap').toContain('records cut');
  }
  await ctl({op:'reset'});
});

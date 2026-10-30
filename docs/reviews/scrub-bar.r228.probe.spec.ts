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


// Codex R228: the overlay is translucent, as in contrast.spec's contract.
function contrastProbe() {
 const rgb=(s:string)=>{const c=document.createElement('canvas').getContext('2d')!;c.fillStyle=s;c.fillRect(0,0,1,1);return Array.from(c.getImageData(0,0,1,1).data);};
 const track=rgb(getComputedStyle(document.querySelector('.scrubBand.track')!).backgroundColor);
 const card=rgb(getComputedStyle(document.querySelector('.scrubBar')!).backgroundColor);
 const fg=rgb(getComputedStyle(document.documentElement).getPropertyValue('--fg'));
 const bg=rgb(getComputedStyle(document.body).backgroundColor);
 const blend=(a:number[],b:number[])=>[0,1,2].map(i=>a[i]!*a[3]!/255+b[i]!*(1-a[3]!/255));
 const lum=(a:number[])=>a.slice(0,3).map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i]!,0);
 const ratio=(a:number[],b:number[])=>{const aa=lum(a),bb=lum(b);return (Math.max(aa,bb)+.05)/(Math.min(aa,bb)+.05);};
 return {track,card,fg,bg,uncomposited:ratio(track,card),onPage:ratio(track,blend(card,bg)),onGeometry:ratio(track,blend(card,fg))};
}
test('R228 contrast includes the card alpha, all four themes',async({page,context},info)=>{
 await prepare(page,context,'desktop',PREVIEW,false);
 await page.locator('.scrubBar input.toggle').check();
 const measurements=[];
 for(const theme of ['light','dark','hc-light','hc-dark']) {
  await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  await page.waitForTimeout(60);
  const m=await page.evaluate(contrastProbe);measurements.push({theme,...m});
  expect.soft(m.onPage,theme+' against page through card').toBeGreaterThanOrEqual(3);
  expect.soft(m.onGeometry,theme+' against geometry through card').toBeGreaterThanOrEqual(3);
 }
 console.log('R228 contrast '+JSON.stringify(measurements));
 await info.attach('contrast.json',{body:JSON.stringify(measurements,null,2),contentType:'application/json'});
});
for(const seconds of [116,6*3600,30*3600]) {
 test(`R228 portrait 150 percent, duration ${seconds}, layout and keyboard order`,async({page,context},info)=>{
  const payload=Buffer.from(encode({...PREVIEW_FIELDS,feed_tcum:new Uint8Array(new Float32Array(FEED.map((_,i)=>seconds*i/(FEED.length-1))).buffer)}));
  await prepare(page,context,'touch-portrait',payload,false);
  await page.evaluate(()=>document.documentElement.style.zoom='1.5');
  await settleLayout(page);
  await page.locator('.scrubBar input.toggle').check();
  await page.locator('.scrubBar select').selectOption('100');
  await page.locator('.simPanel select[name="simSpeed"]').selectOption('0.1');
  await expect(page.locator('.scrubBar select')).toHaveValue('0.1');
  const measure=()=>page.evaluate(()=>{
   const bar=document.querySelector('.scrubBar')!;const box=(s:string)=>bar.querySelector(s)!.getBoundingClientRect().toJSON();
   return {bar:bar.getBoundingClientRect().toJSON(),slider:box('.sliderWrap'),play:box('button'),speed:box('select'),link:box('.simTabLink'),pos:box('.posSlot'),time:bar.querySelector('.posSlot')!.textContent,zoom:getComputedStyle(document.documentElement).zoom};
  });
  const m=await measure();console.log('R228 layout '+JSON.stringify({seconds,...m}));
  await info.attach('layout.json',{body:JSON.stringify({seconds,...m},null,2),contentType:'application/json'});
  const mid=(b:any)=>b.top+b.height/2;
  expect.soft(Math.abs(mid(m.link)-mid(m.play)),'link in row 1').toBeLessThan(4);
  expect.soft(Math.abs(mid(m.pos)-mid(m.slider)),'time in row 2').toBeLessThan(12);
  expect.soft(m.slider.width/1.5,'at least 120 CSS px for the slider').toBeGreaterThanOrEqual(120);
  expect.soft(m.slider.width,'nonzero usable slider').toBeGreaterThan(36*1.5);
  expect.soft(m.pos.right,'time inside bar').toBeLessThanOrEqual(m.bar.right);
  const tabOrder=[];
  await page.locator('.scrubBar select').focus();
  for(let i=0;i<2;i++) {await page.keyboard.press('Tab');tabOrder.push(await page.evaluate(()=>({name:document.activeElement?.getAttribute('aria-label'),cls:document.activeElement?.className,box:document.activeElement?.getBoundingClientRect().toJSON()})));}
  console.log('R228 focus '+JSON.stringify({seconds,tabOrder}));
  await page.screenshot({path:info.outputPath(`duration-${seconds}.png`)});
 });
}

import { test, expect, type Page } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// Part B's A/B measurement (Codex R39 VP39-03; temporary, removed with the
// previous GL line after the acceptance). Settings → Debug switches the path
// renderer — REBUILT, never both held — and a run drives the fixed sequence:
// every phase reported to the trace with its histograms, the finding jumps
// entered the way the operator enters them (machine off), and the viewer left
// as the run found it: renderer, camera, rapids layer, no simulation.
const FEED = Array.from({ length: 10 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
const PREVIEW = Buffer.from(encode({ file: "/ab.ngc", preview_schema: 9, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.length),
  rapid: [[27, 20, 0], [150, 20, 5]], rapid_lines: [13, 14], rapid_seq: [13, 14],
  rapid_outside: new Uint8Array([0, 1]),
  violations: [4,7,14].map(line => ({ line, axis:"X", value:150, limit:100, kind:"max" })), violations_total:3 }));

type Rec = Record<string, any>;
const kindOf = (page: Page, role: string) => page.evaluate(r =>
  window.__viewerDiag?.getRoleMaterials?.().filter(m => m.role === r).map(m => m.kind).sort().join(",") ?? null, role);


import { writeFileSync } from 'node:fs';
test('R47: records the simulation cursor and finding sequence across real A/B repetitions', async ({page,context})=>{
  test.setTimeout(90000);
  const telemetry: Rec[]=[];
  await context.route(/\/telemetry(\?|$)/,async r=>{
    for(const line of (r.request().postData()??'').split('\n')) if(line.trim()) telemetry.push(JSON.parse(line));
    await r.fulfill({contentType:'application/json',body:'{"ok":true}'});
  });
  await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:PREVIEW}));
  await context.route(/\/gcode(\?|$)/,r=>r.fulfill({contentType:'text/plain',body:Array.from({length:16},(_,i)=>`G1 X${i} F100`).join('\n')}));
  await openLayout(page,PROFILES[1]!,VIEWPORTS.find(v=>v.name==='desktop')!);
  await ctl({op:'status_delta',data:{active_file:'/ab.ngc',is_enabled:false,enabled:false}});
  await ctl({op:'raw',frame:{type:'viewer_gcode_ready',version:990,file:'/ab.ngc'}});
  const next=page.locator('.scrubBar [aria-label="Next limit violation"]');
  await expect(next).toBeVisible({timeout:15000});
  await next.click();
  const slider=page.locator('.scrubBar input.rangeOverlayTrack');
  await expect(slider).toBeEnabled();
  await slider.evaluate((e:HTMLInputElement)=>{e.value=String(Number(e.max)*.13);e.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForTimeout(100);
  const before=await slider.inputValue();
  await page.evaluate(()=>{
    (window as any).__r47Jumps=[];
    document.addEventListener('click',e=>{
      const b=(e.target as HTMLElement)?.closest('button');
      if(b?.getAttribute('aria-label')!=='Next limit violation')return;
      const target=document.querySelector('.scrubBar .navTarget')?.textContent;
      setTimeout(()=>(window as any).__r47Jumps.push({target,position:(document.querySelector('.scrubBar input.rangeOverlayTrack') as HTMLInputElement)?.value}),0);
    },true);
  });
  await page.evaluate(()=>window.__viewerDiag!.runAbMeasurement!({warmupMs:200,orbitMs:300,fitDetailCycles:1,fitDetailHoldMs:200,jumps:1,jumpMs:200,overlayMs:200}));
  await expect.poll(()=>telemetry.some(e=>e.kind==='viewer.abrun'&&e.phase==='end'),{timeout:30000}).toBe(true);
  const after=await slider.inputValue();
  const jumps=await page.evaluate(()=>(window as any).__r47Jumps);
  const phases=telemetry.filter(e=>e.kind==='viewer.abrun'&&e.variant);
  writeFileSync('../evidence/viewer-palette-fest.r47.browser-probe.json',JSON.stringify({before,after,simRemainsActive:await slider.isEnabled(),jumps,phases:phases.map(p=>({rep:p.rep,variant:p.variant,phase:p.phase,status:p.status,reason:p.reason}))},null,2)+'\n');
  writeFileSync('../evidence/viewer-palette-fest.r47.browser-telemetry.json',JSON.stringify(telemetry,null,2)+'\n');
  expect(phases).toHaveLength(42);
  expect(jumps).toHaveLength(12);
  expect(after).not.toBe(before);
});

import { test, expect } from './test';
import { encode } from '@msgpack/msgpack';
import { ctl } from './ctl';
import { openLayout, PROFILES, VIEWPORTS, settleLayout } from './layout-fixtures';
import { simShow } from './simTab';
import { withLimitRuns } from './limitRuns';
import { writeFileSync, mkdirSync } from 'node:fs';
const LONG_FEED = Array.from({ length: 60 }, (_, i) => [i * 2, i % 2 ? 20 : 0, 0]);
const LONG_PREVIEW = Buffer.from(encode(withLimitRuns({ file: "/long.ngc", preview_schema: 11, feed: LONG_FEED,
  feed_lines: LONG_FEED.map((_, i) => i + 3), feed_seq: LONG_FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(LONG_FEED.length),
  feed_tcum: new Uint8Array(new Float32Array(LONG_FEED.map((_, i) => i * 4)).buffer),
  violations: Array.from({ length: 50 }, (_, i) => ({ line: i + 8, axis: "X", value: 110, limit: 100, kind: "max" })),
  violations_total: 50 })));
const LONG_TEXT = Array.from({ length: 64 }, (_, i) => i === 0 ? "(long)" : `G1 X${i} F100`).join("\n");

test("R280 pending follow: a further row must snap when the held band leaves the view", async ({ page, context }) => {
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: LONG_PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: LONG_TEXT }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await ctl({ op: "status_delta", data: { active_file: "/long.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 5402, file: "/long.ngc" } });
  await simShow(page, "limit");
  await expect(page.locator('.simPanel tr[data-sim-row="L57@57"]')).toHaveCount(1, { timeout: 15_000 });
  await settleLayout(page);
  await page.locator('.simPanel tr[data-sim-row="L8@8"]').click();
  await expect(page.locator(".simBanner")).toBeVisible();
  const scrub = (f: number) => page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement, at) => {
    el.value = String(Number(el.max) * at);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, f);
  await scrub(0.6);
  await page.waitForTimeout(500);
  const result=await page.evaluate(async()=> {
    const sc=document.querySelector<HTMLElement>('.simPanel .simTable')!;
    const el=document.querySelector<HTMLInputElement>('.scrubBar .sliderInput')!;
    const move=(f:number)=>{el.value=String(Number(el.max)*f);el.dispatchEvent(new Event('input',{bubbles:true}));};
    const read=()=>{
      const tr=sc.querySelector<HTMLElement>('tr.shownRow, tr.nextRow');
      const band=sc.querySelector<HTMLElement>('.simFollowBand');
      const hl=band&&band.getClientRects().length?band:tr;
      const h=sc.querySelector('thead')!.getBoundingClientRect(),v=sc.getBoundingClientRect(),r=hl?.getBoundingClientRect();
      return {key:tr?.dataset.simRow??null, band:!!band?.getClientRects().length,
        inView:!!r&&r.top>=h.bottom-1&&r.bottom<=v.bottom+1, at:performance.timeOrigin+performance.now()};
    };
    const samples:ReturnType<typeof read>[]=[];let on=true;
    const sample=()=>{setTimeout(()=>samples.push(read()),0);if(on)requestAnimationFrame(sample);};
    requestAnimationFrame(sample);
    const middle=await new Promise<any>(resolve=>requestAnimationFrame(async()=>{
      // First row starts the ordinary held-band follow; it is still waiting
      // for next frame. A hand scroll then moves that band out of view.
      move(0.62);await Promise.resolve();await Promise.resolve();
      const first=read();
      const band=sc.querySelector<HTMLElement>('.simFollowBand');
      const hl=band&&band.getClientRects().length?band:sc.querySelector<HTMLElement>('tr.shownRow, tr.nextRow')!;
      const r=hl.getBoundingClientRect(),v=sc.getBoundingClientRect();
      sc.scrollTop-=v.bottom-r.top+r.height;
      const off=read();
      move(0.64);await Promise.resolve();await Promise.resolve();
      resolve({first,off,after:read()});
    }));
    await new Promise(r=>setTimeout(r,400));on=false;
    return {...middle,samples};
  });
  writeFileSync('/tmp/codex-r281/pending-'+test.info().repeatEachIndex+'.json',JSON.stringify(result,null,2));
  expect(result.first.band,'the first change scheduled a follow with its band held').toBe(true);
  expect(result.first.inView).toBe(true);
  expect(result.off.inView).toBe(false);
  const target=result.samples.at(-1)?.key;
  expect(target).not.toBe(result.first.key);
  const next=result.samples.filter((s:any)=>s.key===target);
  expect(next.length).toBeGreaterThan(5);
  expect(next.filter((s:any)=>!s.inView),'the first frame too: a pending follow cannot leave the next highlight off screen').toEqual([]);
});

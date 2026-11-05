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

test("R279 RAF input: the list scrolled away: the next marked row snaps to the middle, its highlight in view at once", async ({ page, context }) => {
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
  // Scrolled up by hand until the marked row stands a row below the view —
  // out of it, nearer than the snap distance.
  const off = await page.locator(".simPanel .simTable").evaluate(sc => {
    const r = sc.querySelector<HTMLElement>("tr.shownRow, tr.nextRow")!.getBoundingClientRect(), b = sc.getBoundingClientRect();
    sc.scrollTop -= b.bottom - r.top + r.height;
    return { below: sc.querySelector<HTMLElement>("tr.shownRow, tr.nextRow")!.getBoundingClientRect().top - b.bottom, view: sc.clientHeight };
  });
  expect(off.below, "the marked row below the view").toBeGreaterThan(0);
  await page.waitForTimeout(150);
  const before = await page.locator(".simPanel tr.shownRow, .simPanel tr.nextRow").getAttribute("data-sim-row");
  // Every painted frame from here (sampled after the paint): the highlight —
  // the band while it shows, else the marked row — and whether it is in view.
  await page.evaluate(() => {
    const sc = document.querySelector(".simPanel .simTable") as HTMLElement;
    const w = window as unknown as { __fh: { key: string | null; inView: boolean }[]; __fhOn: boolean };
    w.__fh = []; w.__fhOn = true;
    const markedKey = () => sc.querySelector<HTMLElement>("tr.shownRow, tr.nextRow")?.dataset.simRow ?? null;
    // `atFrame`: the marked row when the frame was drawn. A task that ran
    // between that paint and this sample (the scrub's) changed the DOM: what
    // the sample would read no frame showed — dropped (the merge gate of
    // 2026-11-05 read one such state, the new row before its next-frame snap).
    const sample = (atFrame: string | null) => {
      
      const tr = sc.querySelector<HTMLElement>("tr.shownRow, tr.nextRow");
      const band = sc.querySelector(".simFollowBand");
      const hl = band && band.getClientRects().length ? band : tr;
      const head = sc.querySelector("thead")!.getBoundingClientRect(), b = sc.getBoundingClientRect();
      const r = hl?.getBoundingClientRect();
      const row = { key: tr?.dataset.simRow ?? null, inView: !!r && r.top >= head.bottom - 1 && r.bottom <= b.bottom + 1 };
      const record={...row,atFrame,at:performance.timeOrigin+performance.now(),dropped:markedKey()!==atFrame};
      ((window as any).__fhAll ??= []).push(record);
      // Old sampler: every sample was kept.
      w.__fh.push(row);
    };
    const f = () => { const k = markedKey(); setTimeout(() => sample(k), 0); if (w.__fhOn) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => {
    const el = document.querySelector<HTMLInputElement>('.scrubBar .sliderInput')!;
    el.value=String(Number(el.max)*0.63); el.dispatchEvent(new Event('input',{bubbles:true})); resolve();
  })));
  await page.waitForTimeout(400);
  await page.evaluate(() => { (window as unknown as { __fhOn: boolean }).__fhOn = false; });
  const all=await page.evaluate(()=>(window as any).__fhAll);
  writeFileSync('/tmp/codex-r280/old-frame-probe-'+test.info().repeatEachIndex+'.json',JSON.stringify(all,null,2));
  console.log('FRAME-AUDIT',JSON.stringify(all));
  const frames = await page.evaluate(() => (window as unknown as { __fh: { key: string | null; inView: boolean }[] }).__fh);
  // the frames of the row the scrub went to (bound to that row, Codex R245)
  const target = frames.at(-1)?.key ?? null;
  expect(target, "the scrub moved to another marked row").not.toBe(before);
  const next = frames.filter(f => f.key === target);
  test.info().annotations.push({ type: "fh05", description: `${next.length} frames of ${target}, ${next.filter(f => !f.inView).length} with the highlight out of view` });
  expect(next.length, "the new row was drawn").toBeGreaterThan(5);
  expect(next.filter(f => !f.inView), "the next row's highlight in view in every painted frame").toEqual([]);
});


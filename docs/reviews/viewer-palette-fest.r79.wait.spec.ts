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
import { openSimTab } from "./simTab";

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





test('R79: the machine-state wait must distinguish ON from OFF',async({page,context})=>{
 await prepare(page,context);
 await ctl({op:'status_delta',data:{is_enabled:true,enabled:true}});
 await expect(page.locator('.statusBanner')).toContainText('IDLE');
 await expect(page.locator('.safetyStrip').getByRole('button',{name:'Power off',exact:true})).toBeVisible();
 const strip=page.locator('.safetyStrip');
 // These are both of the reviewed helper's waits, with no intervening state change.
 await expect(strip).toContainText(/power off/i);
 await expect(strip).toContainText(/power on/i);
 const sample=await strip.evaluate(el=>({text:el.textContent,powerLabels:Array.from(el.querySelectorAll('.stable-width span')).filter(e=>/power (on|off)/i.test(e.textContent||'')).map(e=>({text:e.textContent,cls:e.className,visibility:getComputedStyle(e).visibility,display:getComputedStyle(e).display}))}));
 const evidence={machineState:await page.locator('.statusBanner').innerText(),onWaitPassed:true,offWaitPassed:true,...sample};
 writeFileSync('../evidence/viewer-palette-fest.r79.power-wait.json',JSON.stringify(evidence,null,2)+'\n');
 expect(evidence.offWaitPassed,'OFF wait must not succeed while the machine is confirmed ON').toBe(false);
});

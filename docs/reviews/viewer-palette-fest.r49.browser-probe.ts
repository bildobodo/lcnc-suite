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
// Three findings (Codex R47 VP-I15: with one, every jump lands on it and a
// wandering sequence cannot show): two on feed lines, one on the rapid.
const FEED_OUT = new Uint8Array(FEED.length);
FEED_OUT[2] = 1; FEED_OUT[6] = 1;
const PREVIEW = Buffer.from(encode({ file: "/ab.ngc", preview_schema: 9, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: FEED_OUT,
  rapid: [[27, 20, 0], [150, 20, 5]], rapid_lines: [13, 14], rapid_seq: [13, 14],
  rapid_outside: new Uint8Array([0, 1]),
  violations: [{ line: 5, axis: "Y", value: 20, limit: 10, kind: "max" }, { line: 9, axis: "Y", value: 20, limit: 10, kind: "max" },
    { line: 14, axis: "X", value: 150, limit: 100, kind: "max" }], violations_total: 3 }));
const SHORT = { calibrateMs: 300, warmupMs: 300, orbitMs: 600, fitDetailCycles: 2, fitDetailHoldMs: 200, jumps: 3, jumpMs: 300, overlayMs: 300 };   // three jumps: L5, L9, L14 — ending on the rapid (the reveal)

type Rec = Record<string, any>;
const kindOf = (page: Page, role: string) => page.evaluate(r =>
  window.__viewerDiag?.getRoleMaterials?.().filter(m => m.role === r).map(m => m.kind).sort().join(",") ?? null, role);

async function setup(page: Page, context: import("@playwright/test").BrowserContext, telemetry: Rec[]) {
  await context.route(/\/telemetry(\?|$)/, async r => {
    for (const line of (r.request().postData() ?? "").split("\n")) if (line.trim()) telemetry.push(JSON.parse(line));
    await r.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 16 }, (_, i) => i === 0 ? "(ab)" : `G1 X${i} F100`).join("\n") }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: "/ab.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 990, file: "/ab.ngc" } });
  await expect(page.locator('.scrubBar [aria-label="Next limit violation"]')).toBeVisible({ timeout: 15_000 });
}

/** A short run to its end; the phase records. */
async function runShort(page: Page, telemetry: Rec[]) {
  await page.evaluate(d => window.__viewerDiag!.runAbMeasurement!(d), SHORT);
  await expect.poll(() => telemetry.some(e => e.kind === "viewer.abrun" && e.phase === "end"),
    { message: "the run ended and said so", timeout: 90_000 }).toBe(true);
  return telemetry.filter(e => e.kind === "viewer.abrun");
}

/** Codex R47 VP-I15: every repetition jumps through the SAME sequence. */
function sameJumpsEveryRepetition(phases: Rec[]) {
  for (const ph of ["jumps", "reveal"]) {
    const seqs = phases.filter(p => p.phase === ph).map(p => JSON.stringify(p.jumps_at));
    expect(seqs.length).toBe(6);
    expect(new Set(seqs).size, `${ph}: one sequence for all six repetitions ${seqs.join(" ")}`).toBe(1);
    expect(new Set(JSON.parse(seqs[0]!)).size, `${ph}: the jumps visit more than one finding`).toBeGreaterThan(1);
  }
}


import { writeFileSync } from 'node:fs';
test('R49: preserve a selected finding on the hidden rapid layer',async({page,context})=>{
 test.setTimeout(120000);
 const telemetry:Rec[]=[];
 await setup(page,context,telemetry);
 await ctl({op:'raw',frame:{type:'settings_changed',settings:{viewer:{layers:{rapids:false}}}}});
 const next=page.locator('.scrubBar [aria-label="Next limit violation"]');
 for(let i=0;i<3;i++) {await next.click(); await page.waitForTimeout(50);}
 const slider=page.locator('.scrubBar .sliderInput');
 const snapshot=async()=>({pos:await slider.inputValue(),tip:await page.evaluate(()=>window.__viewerDiag!.getToolTip!()),line:await page.locator('.scrubBar .lineSlot').textContent(),memory:await page.evaluate(()=>window.__viewerDiag!.getPathMemory!()),rapid:await page.evaluate(()=>window.__viewerDiag!.projectRole!('rapid'))});
 const before=await snapshot();
 expect(before.memory.cpu.reveal).toBeGreaterThan(0);
 expect(before.rapid).not.toBeNull();
 const calibration=await page.evaluate(async()=>{
   const samples:unknown[]=[];
   const timer=setInterval(()=>{
     if(document.body.textContent?.includes('calibrating')&&samples.length<3)samples.push({rapid:window.__viewerDiag!.projectRole!('rapid'),memory:window.__viewerDiag!.getPathMemory!()});
   },30);
   try {await window.__viewerDiag!.runAbMeasurement!({calibrateMs:300,warmupMs:200,orbitMs:300,fitDetailCycles:1,fitDetailHoldMs:200,jumps:3,jumpMs:180,overlayMs:200});}
   finally {clearInterval(timer);}
   return samples;
 });
 await expect.poll(()=>telemetry.some(e=>e.kind==='viewer.abrun'&&e.phase==='end')).toBe(true);
 const after=await snapshot();
 writeFileSync('../evidence/viewer-palette-fest.r49.browser-probe.json',JSON.stringify({before,after,calibration,phases:telemetry.filter(e=>e.kind==='viewer.abrun')},null,2)+'\n');
 writeFileSync('../evidence/viewer-palette-fest.r49.browser-telemetry.json',JSON.stringify(telemetry,null,2)+'\n');
 expect(telemetry.filter(e=>e.kind==='viewer.abrun'&&e.variant)).toHaveLength(49);
 // R49: the same finding and its visible hidden-layer section must return.
 expect(after.line).toBe(before.line);
 expect(after.pos).toBe(before.pos);
 expect(after.memory.cpu.reveal).toBe(before.memory.cpu.reveal);
 expect(after.memory.gpu.reveal).toBe(before.memory.gpu.reveal);
 expect(after.rapid).not.toBeNull();
});

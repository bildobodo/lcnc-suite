import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encode, decode } from "@msgpack/msgpack";
import { readFileSync, writeFileSync } from "node:fs";
import { ctl } from "./ctl";
import { openSimTab, simLine, simShow, simStepBtn } from "./simTab";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// COLLISION jumps on the real 5-axis model (examples/sim_config/machine-
// 5axis-xyzac, the XYZAC config's own machine.json and STLs): the sweep runs
// in the browser worker against the real bodies — the program's sweep on
// load, the entry move's own side sweep once a jump enters the simulation.
const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));

async function prepare(page: Page, context: BrowserContext, o: {
  file: string; version: number; feed: number[][]; lines: number[]; joints: number[]; extra?: Record<string, unknown>;
}) {
  const preview = Buffer.from(encode({ file: o.file, preview_schema: 11, feed: o.feed,
    feed_lines: o.lines, feed_seq: o.lines.map((_, i) => i + 1), feed_outside: new Uint8Array(o.feed.length), rapid: [],
    violations: [], violations_total: 0, ...o.extra }));
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 10 }, (_, i) => `G1 X${i} F100`).join("\n") }));
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await ctl({ op: "status_delta", data: { active_file: o.file, joint_pos: o.joints, actual_position: o.joints,
    g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    rotation_xy: 0, is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: o.version, file: o.file } });
  // The findings live in the side pane's Simulation tab, its list on the collisions.
  await simShow(page, "clash");
}
const nextHit = (page: Page) => simStepBtn(page, "Next collision");
/** The list's collision rows (the list is filtered to collisions). */
const clashRows = (page: Page) => page.locator(".simPanel tbody tr");
const slider = (page: Page) => page.locator(".scrubBar .sliderInput");
const at = async (page: Page) => Number(await slider(page).inputValue());
/** The collision count the findings button reads ("9 collisions"). */
const hitCount = async (page: Page) => clashRows(page).count();
/** The sweep has ended: the findings show from the live partial on ("… so far").
 *  Read from the summary's NAME — its line may show the result as a count
 *  ("3… · entry move still checking", the measured short form). */
const sweepDone = async (page: Page) =>
  !/so far/.test(await page.locator(".simPanel .simSummary .sumItem").first().getAttribute("aria-label") ?? "");

const RUN_FEED = [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]];
const Z9 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
/** The envelope's run_basis as the gateway sends it once the start was
 *  written (scripts/test_fixtures/run_check_wire.json). */
const runEnv = (file: string, over: Record<string, unknown> = {}) => ({ run_basis: {
  run_id: 7, state: "sent", file, source: "s", version: 4101, ctx_digest: "d", tool_basis_rev: 1,
  start: { g5x_index: 1, g5x_offset: Z9, g92_offset: Z9, rotation_xy: 0, wcs_table: null, tool_number: 0,
           tool_diameter: null, tool_length: null, tool_table_z: null, tool_offset: Z9 },
  verified: true, why: null, ...over } });
const basisOf = (page: Page) => page.evaluate(() => window.__viewerDiag?.getCollisionBasis?.() ?? null);
const g92z = (z: number) => [0, 0, z, 0, 0, 0, 0, 0, 0];

async function runReady(page: Page, context: BrowserContext, file: string, version: number,
  o: { lines?: number[]; extra?: Record<string, unknown> } = {}) {
  await prepare(page, context, { file, version, feed: RUN_FEED, lines: o.lines ?? [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
    extra: o.extra });
  await ctl({ op: "status_delta", data: { is_enabled: true, enabled: true, interp_state: 1, task_mode: 1 } });
  await expect(clashRows(page).first(), "the program's collisions, swept at load").toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sweepDone(page), { timeout: 30_000 }).toBe(true);
  const found = await hitCount(page);
  expect(found).toBeGreaterThan(0);
  return found;
}

const originEnv = (file: string, version: number, over: Record<string, unknown> = {}) => ({ preview_origin: {
  version, file, source: "s", reason: "file", pinned: false, for_run: null, table: { mtime: 5, rows: "r" },
  tool_basis_rev: 1, tool_basis_rev_now: 1, ...over } });
const pinnedFor = (runId: number) => ({ pinned: true, reason: "midrun:table_mtime",
  for_run: { run_id: runId, ctx_digest: "d", tool_basis_rev: 1 } });
const runLog = (page: Page) => page.evaluate(() => window.__viewerDiag?.getRunCheckLog?.() ?? []);
/** Publish `version` during the run and, once it is on screen, one status
 *  frame (the gateway sends 30 a second; `quiet` sends none): the run watcher
 *  attaches the position to the new track before the auto timer plans. */
async function publishInRun(page: Page, file: string, version: number, over: Record<string, unknown>) {
  await ctl({ op: "status_delta", envelope: originEnv(file, version, over), data: {} });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version, file } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getShownVersion?.() ?? null), { timeout: 10_000 }).toBe(version);
  await ctl({ op: "status_delta", data: { joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] } });
}
/** The run on screen at X 120 on L7 (the attached run position the provisional check starts from). */
async function runOnL7(page: Page, file: string, version: number) {
  await ctl({ op: "status_delta", envelope: { ...runEnv(file, { run_id: 9 }), ...originEnv(file, version) },
    data: { interp_state: 2, task_mode: 2, motion_line: 7, joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] } });
  await expect(simLine(page)).toHaveText(/L7/);
}


// R137 integration: real page, decode and main sweep. Only the side worker
// transport is intercepted, giving a known hit now and its completion later.
// No verdict computation or UI state is substituted.
test('R137: a run side contact reaches the Sim list before and after completion', async ({page,context})=>{
  test.setTimeout(120_000);
  await page.addInitScript(()=>{
    const tap:any={side:null,requests:[],deliver:null,first:null};(window as any).__r137=tap;
    const Real=window.Worker;
    const Tapped=function(url:string|URL,opts?:WorkerOptions){
      const w=new Real(url,opts);if(!/collisionWorker/.test(String(url)))return w;
      const post=w.postMessage.bind(w);let handler:any=null;
      Object.defineProperty(w,'onmessage',{configurable:true,get:()=>handler,set:(f)=>{handler=f;}});
      w.addEventListener('message',ev=>handler?.(ev));
      w.postMessage=((m:any,t?:Transferable[])=>{
        if(m?.track){tap.requests.push({id:m.id,side:!!m.side,count:m.track.count,depEnd:m.track.depEnd,range:m.options?.range});}
        if(m?.side && m.track){tap.side=m;tap.deliver=(d:any)=>handler?.(new MessageEvent('message',{data:{id:m.id,...d}}));return;}
        post(m,t??[]);
      }) as any;
      return w;
    } as any;
    Tapped.prototype=Real.prototype;window.Worker=Tapped;
  });
  const file='/r137-side.ngc';
  await runReady(page,context,file,7137);
  await ctl({op:'quiet',on:true});
  const start={...runEnv(file).run_basis.start,joints:[-100,0,-100,0,0],joints_why:null};
  await ctl({op:'status_delta',envelope:{...runEnv(file,{run_id:9,start}),...originEnv(file,7137)},
    data:{interp_state:2,task_mode:2,motion_line:7,joint_pos:[120,0,-380,0,0],actual_position:[120,0,-380,0,0]}});
  const native=decode(readFileSync(new URL('../../scripts/test_fixtures/start_dep_payloads/e_single.msgpack',import.meta.url))) as any;
  await context.route(/\/preview(\?|$)/,r=>r.fulfill({contentType:'application/octet-stream',body:Buffer.from(encode({...native,file}))}));
  await publishInRun(page,file,7138,pinnedFor(9));
  await expect.poll(()=>page.evaluate(()=>(window as any).__r137.side!==null),{timeout:30000}).toBe(true);
  await expect.poll(()=>runLog(page),{timeout:60000}).toContain('done');
  const read=async()=>({text:await page.locator('.simPanel .simSummary').innerText(),
    aria:await page.locator('.simPanel .simSummary .sumItem').first().getAttribute('aria-label'),
    rows:await clashRows(page).allTextContents(),log:await runLog(page),
    tap:await page.evaluate(()=>{const t=(window as any).__r137;return {requests:t.requests,side:{id:t.side.id,count:t.side.track.count,lines:[...t.side.track.lines],cum:[...t.side.track.cum]}};})});
  const before=await read();
  await page.evaluate(()=>{
    const t=(window as any).__r137; const i=1;
    t.first={line:t.side.track.lines[i]||2,cum:t.side.track.cum[i],cumEnd:t.side.track.cum[i],a:'spindle_nose',b:'a_yoke',dist:0,rapid:true};
    t.deliver({progress:0.2,first:t.first});
  });
  await page.waitForTimeout(200);
  const early=await read();await page.screenshot({path:'/tmp/codex-r137-0s9wgq_s/side-early.png'});
  await page.evaluate(()=>{const t=(window as any).__r137;t.deliver({result:{hits:[t.first],staticContacts:[],samples:10,coarsened:false,uncertified:null,pairCount:1,pairsPrescreened:0,bvhMs:0,sweepMs:100,truncated:null}});});
  await page.waitForTimeout(200);
  const done=await read();await page.screenshot({path:'/tmp/codex-r137-0s9wgq_s/side-done.png'});
  writeFileSync('/tmp/codex-r137-0s9wgq_s/side-browser.json',JSON.stringify({before,early,done},null,2));
  expect.soft(early.aria,'early contact in the actual summary').toMatch(/1 collision/);
  expect.soft(early.rows,'early contact in the actual list').toHaveLength(1);
  expect.soft(early.aria,'early coverage remains honest').toContain('start still checking');
  expect.soft(done.aria,'final side contact in the actual summary').toMatch(/1 collision/);
  expect.soft(done.rows,'final contact in the actual list').toHaveLength(1);
  expect.soft(done.aria,'bound beginning is now complete').toContain('checked in full');
  await ctl({op:'reset'});
});

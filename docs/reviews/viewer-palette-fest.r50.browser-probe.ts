import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// G30's stored tool-change position (operator point P4, Codex R21–R24):
// the fields are a DRAFT; "Use Current Position" fills it and writes nothing;
// Save is ONE set_g30 on the basis the draft started from, and the section
// shows only what LinuxCNC confirmed. A missing stored value is empty, never
// 0 (GET /g30 turned a missing row into 0.0). The old "Set Current Position"
// sent G30.1 and meant to show the position — the readout stayed old.
//
// Runs under `serial-guards`: mock-global state (status, replies, command log).

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, g30Capture: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};
const STORED = { X: 100, Y: 0, Z: -26.275 };
let reads = 0;
const SETTINGS = { toolsetter: { touchX: 0, touchY: 0, touchZ: -300, fastFeed: 200, slowFeed: 20, traverseFeed: 500,
  maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180 } };

async function open(page: Page, g30: Record<string, number | null>, replies: Record<string, unknown> = {},
                    hold?: Promise<void>) {
  await ctl({ op: "reset" });
  await page.route("**/g30*", async r => {
    reads++;
    if (hold) await hold;          // a late file read (Codex R25 OP-I03)
    await r.fulfill({ contentType: "application/json",
      body: JSON.stringify({ ok: true, values: g30, mtime_ms: Date.UTC(2026, 8, 28, 12, 5), units: "mm" }) });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL, kins_type: 0 } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: SETTINGS } });
  await ctl({ op: "replies", replies });
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  await page.getByRole("tab", { name: "Toolsetter", exact: true }).click();
  await ctl({ op: "clearCmds" });
}
const sent = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; [k: string]: unknown }[])
  .filter(c => !["hello", "arm", "client_diag", "tab_visibility", "get_tool_table", "heartbeat"].includes(c.cmd));
const field = (page: Page, l: string) => page.getByLabel(`G30 ${l}`, { exact: true });
const values = async (page: Page) => Promise.all(["X", "Y", "Z"].map(l => field(page, l).inputValue()));
const storedLine = (page: Page) => page.locator(".g30Stored");
/** Answer the request the page sent for `cmd` — a reply held back so the
 *  operator (or the status) can act while it is out. */
async function deliver(cmd: string, result: Record<string, unknown>) {
  await expect.poll(async () => (await sent()).some(c => c.cmd === cmd)).toBe(true);
  const c = (await sent()).find(x => x.cmd === cmd)!;
  await ctl({ op: "raw", frame: { type: "reply", cmd, req_id: c.req_id, ...result } });
}
/** An entry through the field's keypad, the operator's way. */
async function enter(page: Page, l: string, value: number) {
  await field(page, l).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
  await expect(field(page, l)).toHaveValue(String(value));
}


import {writeFileSync} from 'node:fs';
import {openLayout,PROFILES,VIEWPORTS} from './layout-fixtures';
const point=(page:Page)=>page.evaluate(()=>window.__viewerDiag!.getToolChange!());

test('R50: a confirmed Save G30 without a sampled busy edge must refresh the displayed point',async({page})=>{
 const stored={...STORED};
 reads=0;
 await open(page,stored,{set_g30:{ok:true,confirmed:true,values:{...STORED,X:110}}});
 await expect.poll(async()=>(await point(page))?.top).toEqual([100,0,-26.275]);
 await enter(page,'X',110);
 const before=await point(page),readsBefore=reads;
 // The confirmed reply means the file now contains the accepted coordinates.
 // There need not be a sampled busy state for a short parameter-only MDI.
 stored.X=110;
 await page.getByRole('button',{name:'Save G30',exact:true}).click();
 await expect(page.locator('.statusNote.ok')).toHaveText('G30 saved — confirmed by LinuxCNC');
 await expect(storedLine(page)).toHaveText('Stored: confirmed by LinuxCNC');
 await page.waitForTimeout(900);
 const afterSave=await point(page),readsAfterSave=reads;
 // Observation: the form is confirmed while the point is still at the old X.
 expect(afterSave?.top).toEqual([100,0,-26.275]);
 expect(readsAfterSave).toBe(readsBefore);
 await page.screenshot({path:'../evidence/viewer-palette-fest.r50.g30-save-stale.png'});
 // Positive control: an explicit sampled edge makes the same file visible.
 await ctl({op:'status_delta',data:{interp_state:2}});await page.waitForTimeout(150);
 await ctl({op:'status_delta',data:{interp_state:1}});
 await expect.poll(async()=>(await point(page))?.top).toEqual([110,0,-26.275]);
 writeFileSync('../evidence/viewer-palette-fest.r50.g30-save-probe.json',JSON.stringify({before,afterSave,afterEdge:await point(page),file:stored,readsBefore,readsAfterSave,readsAfterEdge:reads},null,2)+'\n');
});

test('R50: a late G30 read must not replace the newer displayed point',async({page,context})=>{
 type Pending={route:import('@playwright/test').Route;data:object};
 const queue:Pending[]=[];
 let hold=false, value=100;
 await context.route(/\/g30(\?|$)/,async route=>{
  const data={ok:true,values:{X:value,Y:0,Z:-20},mtime_ms:value,units:'mm'};
  if(hold){queue.push({route,data});return;}
  await route.fulfill({json:data});
 });
 await openLayout(page,PROFILES[1]!,VIEWPORTS.find(v=>v.name==='desktop')!);
 await expect.poll(async()=>(await point(page))?.top).toEqual([100,0,-20]);
 await page.waitForTimeout(500);
 hold=true;
 const edge=async()=>{await ctl({op:'status_delta',data:{interp_state:2}});await page.waitForTimeout(150);await ctl({op:'status_delta',data:{interp_state:1}});};
 value=110;await edge();await expect.poll(()=>queue.length).toBe(1);
 value=120;await edge();await expect.poll(()=>queue.length).toBe(2);
 await queue[1]!.route.fulfill({json:queue[1]!.data});
 await expect.poll(async()=>(await point(page))?.top).toEqual([120,0,-20]);
 const newer=await point(page);
 await queue[0]!.route.fulfill({json:queue[0]!.data});
 // Observation: the delayed older reply rolls the pin back.
 await expect.poll(async()=>(await point(page))?.top).toEqual([110,0,-20]);
 writeFileSync('../evidence/viewer-palette-fest.r50.g30-race-probe.json',JSON.stringify({requests:queue.map(x=>x.data),replyOrder:[2,1],newer,afterLate:await point(page)},null,2)+'\n');
});

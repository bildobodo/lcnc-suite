// P2b-F1 (Codex R449 MT449-02/03, R450 MT450-02/03, R451): the page never
// shows another program's preview or text as the active program's. The
// machine-day check found it (case c): RUNNING · PW_BIG_C.NGC with A2's path,
// code and timeline. Every frame from the active program's change to the
// adoption of its own data is watched, not only the end picture; with the
// simulation on and off; for a new program, the same path loaded again,
// A→B→A, late answers of the old load and a reconnect.
import { test, expect, type Page } from "./test";
import { ctl, MOCK } from "./ctl";
import { announcement, fulfillText, loadStatus, newLoad, type Load } from "./programFixture";

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
const A2 = "(A2)\nG53 G0 Z0\nG53 G1 X150 Y450 F3000\nG53 G0 Z0\nM2\n";
const C = "(C)\nG53 G0 Z0\nG53 G1 X200 Y200 F6000\nG53 G0 Z0\nM2\n";
const TEXTS: Record<string, string> = { "/a2.ngc": A2, "/c.ngc": C };
const IDLE = 1, READING = 2, MANUAL = 1, AUTO = 2;

/** Late answers: a path's text, or the preview, held until released. */
let holdText: Record<string, Promise<void> | undefined> = {};
let holdPreview: Promise<void> | null = null;

async function ready(page: Page, o: { sim?: boolean } = {}) {
  holdText = {};
  holdPreview = null;
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("**/gcode?*", async r => {
    const path = new URL(r.request().url()).searchParams.get("path") ?? "";
    if (holdText[path]) await holdText[path];
    await fulfillText(r, { contentType: "text/plain", body: TEXTS[path] ?? "(?)\n" });
  });
  await page.route(/\/preview(\?|$)/, async r => {
    if (holdPreview) await holdPreview;
    await r.continue();      // the mock serves the asked pair
  });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  if (o.sim === false) await ctl({ op: "raw", frame: { type: "settings_init", settings: { simulation: { enabled: false } } } });
  await ctl({ op: "status_delta", data: { homed: [1, 1, 1], permissions: PERMS_ALL, interp_state: IDLE, task_mode: MANUAL } });
  await page.getByRole("tab", { name: "Program", exact: true }).click();
}

/** The status names the load, then its publication is announced. */
async function show(load: Load, version: number) {
  await ctl({ op: "status_delta", data: loadStatus(load) });
  await ctl({ op: "raw", frame: announcement(load, version) });
}
const shown = (page: Page) => page.evaluate(() => window.__viewerDiag?.getShownVersion?.() ?? null);
const code = (page: Page) => page.locator(".codeArea .codeViewer");
const note = (page: Page) => page.locator("[data-text-note]");
const hud = (page: Page) => page.locator("[data-preview-wait]");


for (const order of ['reply-first', 'status-first']) {
  test(`R452 own reload adoption ${order}`, async ({page}, info) => {
    await ready(page);
    await ctl({op:'status_delta',armed:true,data:{}});
    await ctl({op:'replyFor',cmd:'load_file',reply:'silent'});
    const l1=newLoad('/a2.ngc',A2);
    await show(l1,810);
    await expect(code(page)).toContainText('(A2)');
    await page.locator('.panelHead').getByRole('button',{name:/^More/}).first().click();
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    const editor=page.locator('.cm-content');
    await expect(editor).toContainText('(A2)');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('(save1)');
    let release!:()=>void;
    let arrived!:()=>void;
    const gotSave=new Promise<void>(r=>arrived=r);
    const saveGate=new Promise<void>(r=>release=r);
    await page.route('**/save?*',async route=>{
      arrived(); await saveGate;
      await route.fulfill({json:{ok:true,path:'/a2.ngc',size:1}});
    });
    await ctl({op:'clearCmds'});
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await gotSave;
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('(newer draft)');
    release();
    let req:any;
    await expect.poll(async()=>{
      const r=await ctl({op:'lastCmds'}) as any;
      req=r.cmds?.find((c:any)=>c.cmd==='load_file');
      return !!req?.req_id;
    }).toBe(true);
    const l2=newLoad('/a2.ngc',A2);
    const reply=()=>ctl({op:'raw',frame:{type:'reply',cmd:'load_file',req_id:req.req_id,ok:true,path:'/a2.ngc',program_id:l2.id}});
    if(order==='reply-first') {
      await reply();
      await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled();
      await ctl({op:'status_delta',data:loadStatus(l2)});
    } else {
      await ctl({op:'status_delta',data:loadStatus(l2)});
      await expect(page.locator('[data-edit-conflict]')).toBeVisible();
      await reply();
      await expect(page.getByRole('button',{name:'Save',exact:true})).toBeEnabled();
      // Another delivered status of the SAME identity must suffice too.
      await ctl({op:'status_delta',data:loadStatus(l2)});
    }
    await expect(editor).toContainText('(newer draft)');
    await info.attach('order',{body:JSON.stringify({order,old:l1.id,own:l2.id,request:req}),contentType:'application/json'});
    await expect(page.locator('[data-edit-conflict]'),'the own reload is not a foreign program change').toHaveCount(0);
  });
}

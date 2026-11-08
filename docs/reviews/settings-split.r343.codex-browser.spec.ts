import { test, expect, type Page } from "./test";
import { ctl, MOCK } from "./ctl";
import { Folder, serve } from "./macroFolder";

// The switchable suite functions (settings split package 3, plan R335–R337,
// operator OP2): a function switched off LEAVES the UI — its tab, its
// buttons, its settings, its reading of the gamepad — not dimmed. The tab in
// use when its function goes off stays until it is left, with a note (a
// draft is never lost unasked, SS334-02). The switches are a machine section
// the server holds; the page has them from its first render.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
const ALL_ON = { probing: true, toolsetter: true, surfaceMap: true, camera: true, macros: true, gamepad: true };
const off = (...names: (keyof typeof ALL_ON)[]) => ({ ...ALL_ON, ...Object.fromEntries(names.map(n => [n, false])) });
const MACROS = { macroBar: { bar: ["park"] } };

const sent = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; [k: string]: unknown }[])
  .filter(c => !["hello", "client_diag", "tab_visibility", "get_tool_table"].includes(c.cmd));

/** The page with these server settings from its FIRST read (the bootstrap
 *  fetch answers with them), the status ready. */
async function open(page: Page, settings: Record<string, unknown>, status: Record<string, unknown> = {}) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await ctl({ op: "raw", frame: { type: "settings_init", settings } });   // the mock's store, before the load
  await serve(page, new Folder());
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL, tool_number: 5, eoffset_enabled: false, ...status } });
  await ctl({ op: "clearCmds" });
}

const side = (page: Page) => page.locator(".sidePane");
const mainTabs = (page: Page) => side(page).getByRole("tablist", { name: "Side panel" }).getByRole("tab");
const switchTo = (features: Record<string, boolean>, more: Record<string, unknown> = {}) =>
  ctl({ op: "raw", frame: { type: "settings_changed", settings: { features, ...more } } });


const focusNow = (page: Page) => page.evaluate(() => ({
  tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute('role'),
  text: document.activeElement?.textContent?.trim().slice(0,100),
}));

test('R343 a focused Measure Current removed by Toolsetter off returns focus', async ({page}) => {
  await open(page, {features: ALL_ON,keyboard:{jogEnabled:true}});
  await side(page).getByRole('tab', {name:'Tools',exact:true}).click();
  const b=side(page).getByRole('button',{name:'Measure Current',exact:true});
  // A disabled MachineBtn is focusable through its explanatory wrapper;
  // use a configured toolsetter to focus the actual enabled button.
  await ctl({op:'raw',frame:{type:'settings_changed',settings:{features:ALL_ON,keyboard:{jogEnabled:true},toolsetter:{touchX:150,touchY:10,touchZ:-300,fastFeed:2000,slowFeed:20,traverseFeed:500,maxZTravel:180,retractDist:3,spindleZeroHeight:180}}}});
  await expect(b).toBeEnabled();
  await b.focus();
  await expect(b).toBeFocused();
  await switchTo(off('toolsetter'),{keyboard:{jogEnabled:true}});
  await expect(b).toHaveCount(0);
  console.log('REMOVED_MEASURE_FOCUS',await focusNow(page));
  await ctl({op:'clearCmds'});
  await page.keyboard.press('ArrowRight');
  const jogs=(await sent()).filter(c=>c.cmd.startsWith('jog_'));
  console.log('AFTER_FOCUS_LOSS_ARROW',jogs);
  expect(jogs,'navigation must not become jog').toEqual([]);
  await expect(side(page).getByRole('tab',{name:'Tools',exact:true})).toBeFocused();
});

test('R343 a focused camera control removed by Camera off returns focus',async({page})=>{
  await open(page,{features:ALL_ON});
  const b=page.getByRole('button',{name:'Show camera',exact:true});
  await b.focus();
  await expect(b).toBeFocused();
  await switchTo(off('camera'));
  await expect(b).toHaveCount(0);
  console.log('REMOVED_CAMERA_FOCUS',await focusNow(page));
  expect((await focusNow(page)).tag).not.toBe('BODY');
});

test('R343 calibration reset records its emitted job for backend replay',async({page})=>{
  await open(page,{features:ALL_ON});
  await side(page).getByRole('tab',{name:'Probing',exact:true}).click();
  await side(page).getByRole('tab',{name:'Calibrate',exact:true}).click();
  await side(page).getByRole('button',{name:'Reset Calibration',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Reset',exact:true}).click();
  await expect.poll(async()=> (await sent()).filter(c=>c.cmd==='probe_run').length).toBe(1);
  console.log('CAL_RESET_JOB',(await sent()).filter(c=>c.cmd==='probe_run'));
});

test('R343 editing a Surface parameter transfers its own purpose with Probing on',async({page})=>{
  await open(page,{features:ALL_ON});
  await side(page).getByRole('tab',{name:'Probing',exact:true}).click();
  await side(page).getByRole('tab',{name:'Surface',exact:true}).click();
  const f=side(page).getByLabel('X Probes',{exact:true});
  await f.click();
  const pad=page.locator('.nkStrip');
  await pad.getByRole('button',{name:'9',exact:true}).click();
  await pad.getByRole('button',{name:'Apply',exact:true}).click();
  await expect.poll(async()=> (await sent()).filter(c=>c.cmd==='set_params').length).toBeGreaterThan(0);
  console.log('PARAMETER_JOBS',(await sent()).filter(c=>c.cmd==='set_params'));
  await expect.poll(async()=> (await sent()).some(c=>c.cmd==='set_params' && c.purpose==='surface')).toBe(true);
});

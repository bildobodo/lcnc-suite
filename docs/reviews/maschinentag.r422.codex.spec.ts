// A long press acts on its release; the E-Stop acts on the press (machine day
// 2026-11-21, F12; operator decisions for plan P1a, docs/reviews/maschinentag.review.md).
//
// On the operator's touch panel Chromium turns a long press into a long-press
// gesture: `contextmenu` after ≈ 650 ms (refused, touchDetect.ts), then the
// release — and NO click. Pause, Abort and the UI E-Stop did nothing on a long
// press, and so did every other control that acts on `click`. Headless
// Chromium never recognises a long press (it clicks after any touch length,
// probed 100 / 900 / 1500 ms), so the panel's sequence is dispatched here as
// the flight recorder captured it on the machine: pointerdown → contextmenu
// → pointerup, no click. Whether a trusted long touch the browser DOES click
// still acts once is checked with real CDP touch input.
//
// Every expectation is on the COMMAND the mock gateway received, never on a
// DOM callback.
import { test, expect, type Page, type Locator } from "./test";
import { ctl, MOCK } from "./ctl";

test.use({ hasTouch: true });

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: true,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};

type Sent = { cmd?: string; [k: string]: unknown };
const NOISE = ["hello", "client_diag", "tab_visibility", "get_tool_table", "heartbeat", "settings_flush"];
async function sent(): Promise<Sent[]> {
  const all = ((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [];
  return all.filter(c => !NOISE.includes(String(c.cmd)));
}
/** The commands after a settle: a release click may wait for the browser's own (≤ 120 ms). */
async function settled(page: Page): Promise<Sent[]> {
  await page.waitForTimeout(400);
  return sent();
}

async function open(page: Page, data: Record<string, unknown> = {}) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", armed: true, data: { active_file: "/A.ngc", permissions: PERMS_ALL, ...data } });
  await expect(page.locator(".pill.armed")).toHaveCount(1);
  // touch mode, as on the panel: the session's first touch
  await page.touchscreen.tap(2, 2);
  await expect(page.locator("html")).toHaveClass(/touch-device/);
  await ctl({ op: "clearCmds" });
}

async function centre(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}



// Codex R420: assertions state the requested behavior, no product modifications.


test('R422 Settings cycles do not accumulate window listeners or older detached nodes',async({page})=>{
  await open(page);
  const cdp=await page.context().newCDPSession(page);
  const dialog=page.getByRole('dialog',{name:'Settings',exact:true});
  async function counts(){
    const obj=await cdp.send('Runtime.evaluate',{expression:'window',objectGroup:'r422-window'});
    try {
      const {listeners}=await cdp.send('DOMDebugger.getEventListeners',{objectId:obj.result.objectId!});
      return {up:listeners.filter(l=>l.type==='pointerup').length,cancel:listeners.filter(l=>l.type==='pointercancel').length};
    } finally {await cdp.send('Runtime.releaseObjectGroup',{objectGroup:'r422-window'});}
  }
  async function show(){
    await page.getByTitle('Settings',{exact:true}).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.scroll-thin').first()).toBeVisible();
  }
  async function close(){
    await dialog.getByRole('button',{name:'Close settings',exact:true}).click();
    await expect(dialog).toHaveCount(0);
  }
  await show();await close();
  await show();await close(); // warm twice: the lazy viewer adds one global pointerup listener
  const before=await counts();
  await page.evaluate(()=>{(window as any).__scrollRefs=[];});
  const series=[];
  for(let n=0;n<3;n++){
    await show();
    await dialog.evaluate((el,n)=>{
      for(const node of el.querySelectorAll('.scroll-thin')) (window as any).__scrollRefs.push({cycle:n,ref:new WeakRef(node)});
    },n);
    await close();
    series.push(await counts());
  }
  await cdp.send('HeapProfiler.collectGarbage');
  const retained=await page.evaluate(()=>{
    const refs=(window as any).__scrollRefs as {cycle:number,ref:WeakRef<Element>}[];
    return {sampled:refs.length,alive:refs.filter(r=>r.ref.deref()).length,
      detached:refs.filter(r=>r.ref.deref()&&!r.ref.deref()!.isConnected).length,
      earlierDetached:refs.filter(r=>r.cycle<2&&r.ref.deref()&&!r.ref.deref()!.isConnected).length};
  });
  console.log('R422 lifetime',JSON.stringify({before,series,retained}));
  // The previous head also keeps the last dialog for now; only older cycles
  // are required to be collectable here. Window registrations must stop growing.
  expect.soft(series.at(-1)).toEqual(series.at(-2));
  expect.soft(retained.earlierDetached).toBe(0);
});

test('R422 a refused pen swipe leaves its next valid press usable',async({page})=>{
  await open(page);
  const stop=page.locator('[data-strip="jog"] [data-control="jogStop"]');
  const p=await centre(stop);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x+14,y:p.y,button:'left',buttons:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+14,y:p.y,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
  const afterSwipe=await settled(page);
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',buttons:1,clickCount:1,pointerType:'pen'});
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',buttons:0,clickCount:1,pointerType:'pen'});
  const afterValid=await settled(page);
  console.log('R422 next press',JSON.stringify({afterSwipe,afterValid}));
  expect(afterSwipe.filter(c=>String(c.cmd).startsWith('jog_stop'))).toHaveLength(0);
  expect(afterValid.filter(c=>c.cmd==='jog_stop')).toHaveLength(3);
});

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

async function logEvents(page:Page) {
  await page.evaluate(()=>{
    (window as any).__events=[];
    for(const kind of ['pointerdown','pointermove','pointerup','pointercancel','click','gotpointercapture'])
      document.addEventListener(kind,e=>{const p=e as PointerEvent;(window as any).__events.push({kind,id:p.pointerId,primary:p.isPrimary,x:p.clientX,y:p.clientY,trusted:p.isTrusted,target:(e.target as HTMLElement).className});},true);
  });
}

test('R421 second pointer cannot erase the first pointer scroll decision', async({page})=>{
  await open(page);
  await logEvents(page);
  const power=page.locator('.safetyBtns [data-control="machineOn"]');
  const title=page.locator('.safetyStrip > .sub').first();
  const p1={...(await centre(power)),id:1};
  const p2={...(await centre(title)),id:2};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p1]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p1,p2]});
  const moved={...p1,x:p1.x+8};
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[moved,p2]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[moved]});
  const got=await settled(page);
  const events=await page.evaluate(()=>(window as any).__events);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[p2]});
  console.log('R421 concurrent scroll',JSON.stringify({got,events}));
  expect(got.filter(c=>c.cmd==='machine_off'||c.cmd==='machine_on')).toHaveLength(0);
});

test('R421 a swipe on Jog Stop must not act through a native click',async({page})=>{
  await open(page);
  await logEvents(page);
  const stop=page.locator('[data-strip="jog"] [data-control="jogStop"]');
  const p={...(await centre(stop)),id:1};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...p,x:p.x+14}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const got=await settled(page);
  console.log('R421 jog swipe',JSON.stringify({got,events:await page.evaluate(()=>(window as any).__events)}));
  expect(got.filter(c=>String(c.cmd).startsWith('jog_stop'))).toHaveLength(0);
});

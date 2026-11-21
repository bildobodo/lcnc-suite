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
import { test, expect, type Page } from "./test";
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


const ESTOP = '.safetyBtns [data-control="estop"]';

test("R420 new pen Reset after a cancelled E-Stop press must be accepted",async({page})=>{
  await open(page);
  const target=page.locator(ESTOP);
  await target.evaluate(el=>{
    const r=el.getBoundingClientRect(), opts={bubbles:true,cancelable:true,pointerId:41,pointerType:'pen',isPrimary:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:0};
    el.dispatchEvent(new PointerEvent('pointerdown',opts));
    el.dispatchEvent(new PointerEvent('pointercancel',opts));
    (window as any).__cancelledAt=performance.now();
  });
  await ctl({op:'status_delta',data:{is_estop:true}});
  await expect(target).toHaveAttribute('aria-label','Reset E-Stop');
  const gap=await target.evaluate(el=>{
    const gap=performance.now()-(window as any).__cancelledAt;
    const r=el.getBoundingClientRect(),opts={bubbles:true,cancelable:true,pointerId:41,pointerType:'pen',isPrimary:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2,button:0,detail:1};
    el.dispatchEvent(new PointerEvent('pointerdown',opts));
    el.dispatchEvent(new PointerEvent('pointerup',opts));
    el.dispatchEvent(new PointerEvent('click',opts));
    return gap;
  });
  expect(gap).toBeLessThan(600);
  const got=await settled(page);
  console.log('R420 cancel then reset',JSON.stringify({gap,got}));
  expect(got.filter(c=>c.cmd==='estop_reset')).toHaveLength(1);
});

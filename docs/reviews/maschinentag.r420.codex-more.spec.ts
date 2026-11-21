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

/** The panel's long press, as recorded on the machine: pointerdown, the
 *  long-press contextmenu, the release — no click. `moveBy` swipes first. */
async function panelLongPress(target: Locator, opts: { ms?: number; moveBy?: number; id?: number } = {}) {
  await target.evaluate(async (el, o) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const ev = (type: string, cx: number, cy: number) => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerId: o.id, pointerType: "touch", isPrimary: true,
      clientX: cx, clientY: cy, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1,
    });
    el.dispatchEvent(ev("pointerdown", x, y));
    await new Promise(res => setTimeout(res, 650));
    if (o.moveBy) el.dispatchEvent(ev("pointermove", x + o.moveBy, y));
    el.dispatchEvent(ev("contextmenu", x, y));
    await new Promise(res => setTimeout(res, Math.max(0, o.ms - 650)));
    const ux = x + (o.moveBy ?? 0);
    (document.elementFromPoint(ux, y) ?? el).dispatchEvent(ev("pointerup", ux, y));
  }, { ms: opts.ms ?? 900, moveBy: opts.moveBy ?? 0, id: opts.id ?? 41 });
}

async function centre(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("no box");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

const ESTOP = '.safetyBtns [data-control="estop"]';


// Codex R420: assertions state the requested behavior, no product modifications.

test("R420 press ownership reaches the actual DOM buttons", async ({ page })=>{
  await open(page);
  const loc=page.locator(ESTOP);
  const jog=page.locator('[data-strip="jog"] .jogBtn').first();
  console.log('R420 owned',JSON.stringify({estop:await loc.getAttribute('data-press-owned'),jog:await jog.getAttribute('data-press-owned')}));
  expect.soft(await loc.getAttribute('data-press-owned')).not.toBeNull();
  expect.soft(await jog.getAttribute('data-press-owned')).not.toBeNull();
});

test("R420 a panel long press with a six-pixel scroll never powers off", async ({page})=>{
  await open(page);
  await panelLongPress(page.locator('.safetyBtns [data-control="machineOn"]'),{moveBy:6});
  const got=await settled(page);
  console.log('R420 panel scroll',JSON.stringify(got));
  expect(got.filter(c=>c.cmd==='machine_on'||c.cmd==='machine_off')).toHaveLength(0);
});

test("R420 the disabled Flood control stays inert on a long touch", async ({page})=>{
  await open(page);
  const control=page.locator('[data-strip="spindle"] input[data-control="coolant"]').first();
  await control.scrollIntoViewIfNeeded();
  await ctl({op:'status_delta',data:{permissions:{...PERMS_ALL,override:false}}});
  await expect(control).toBeDisabled();
  await page.evaluate(()=>{
    (window as any).__changes=[];
    document.addEventListener('change',e=>{ const t=e.target as HTMLInputElement; (window as any).__changes.push({target:t.getAttribute('data-control'),disabled:t.disabled,checked:t.checked,trusted:e.isTrusted}); },true);
  });
  const p={...(await centre(control)),id:1};
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[p]});
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const got=await settled(page);
  const changes=await page.evaluate(()=>(window as any).__changes);
  console.log('R420 disabled flood',JSON.stringify({got,changes}));
  expect(changes).toHaveLength(0);
});

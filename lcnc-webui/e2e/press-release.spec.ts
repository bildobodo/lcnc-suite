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
const ABORT = '.sidePane [data-control="abort"]:visible';
const PAUSE = '.sidePane [data-control="pause"]:visible';

test("a long press on a click control acts once, on its release — the panel's sequence", async ({ page }) => {
  await open(page);
  // Abort (Program tab), Pause, Disarm, Power: each a release
  const cases: Array<[string, Locator, (s: Sent[]) => boolean]> = [
    ["Abort", page.locator(ABORT).first(), s => s.filter(c => c.cmd === "abort").length === 1],
    ["Pause", page.locator(PAUSE).first(), s => s.filter(c => c.cmd === "cycle_pause").length === 1],
    ["Disarm", page.locator('.safetyBtns [data-control="arm"]'), s => s.filter(c => c.cmd === "arm" && c.armed === false).length === 1],
    ["Power", page.locator('.safetyBtns [data-control="machineOn"]'), s => s.filter(c => c.cmd === "machine_off" || c.cmd === "machine_on").length === 1],
  ];
  for (const [name, loc, ok] of cases) {
    await ctl({ op: "clearCmds" });
    await panelLongPress(loc);
    const s = await settled(page);
    expect(ok(s), `${name}: ${JSON.stringify(s)}`).toBe(true);
  }
});

test("a long press on a tab switches it on release", async ({ page }) => {
  await open(page);
  const mdi = page.getByRole("tab", { name: "MDI", exact: true });
  await panelLongPress(mdi);
  await expect(mdi).toHaveAttribute("aria-selected", "true");
});

test("a long press on Reset resets once, on its release", async ({ page }) => {
  await open(page, { is_estop: true });
  const reset = page.locator(ESTOP);
  await expect(reset).toHaveAttribute("aria-label", "Reset E-Stop");
  await panelLongPress(reset);
  const s = await settled(page);
  expect(s.filter(c => c.cmd === "estop_reset"), JSON.stringify(s)).toHaveLength(1);
  expect(s.filter(c => c.cmd === "estop")).toHaveLength(0);
});

test("a long touch the browser still clicks acts exactly once", async ({ page }) => {
  await open(page);
  const p = { ...(await centre(page.locator(ABORT).first())), id: 1 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  await page.waitForTimeout(900);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const s = await settled(page);
  expect(s.filter(c => c.cmd === "abort"), JSON.stringify(s)).toHaveLength(1);
});

test("a short tap acts once — nothing doubles it", async ({ page }) => {
  await open(page);
  await page.locator(ABORT).first().tap();
  const s = await settled(page);
  expect(s.filter(c => c.cmd === "abort"), JSON.stringify(s)).toHaveLength(1);
});

test("a swipe that starts on a click control acts nowhere", async ({ page }) => {
  await open(page);
  await panelLongPress(page.locator(ABORT).first(), { moveBy: 40 });
  await panelLongPress(page.locator('.safetyBtns [data-control="machineOn"]'), { moveBy: 40 });
  const s = await settled(page);
  expect(s, JSON.stringify(s)).toHaveLength(0);
});

test("the E-Stop stops at the press — and the same press never resets it", async ({ page }) => {
  await open(page);
  const estop = page.locator(ESTOP);
  const p = { ...(await centre(estop)), id: 1 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  // the stop went out while the finger is still down
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "estop").length, { timeout: 2000 }).toBe(1);
  // the machine confirms ESTOP before the release: the button reads Reset now
  await ctl({ op: "status_delta", data: { is_estop: true } });
  await expect(estop).toHaveAttribute("aria-label", "Reset E-Stop");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });   // headless clicks here
  const s = await settled(page);
  expect(s.filter(c => c.cmd === "estop"), JSON.stringify(s)).toHaveLength(1);
  expect(s.filter(c => c.cmd === "estop_reset"), JSON.stringify(s)).toHaveLength(0);
});

test("a tap on the E-Stop stops once; the next tap on Reset resets", async ({ page }) => {
  await open(page);
  await page.locator(ESTOP).tap();
  let s = await settled(page);
  expect(s.map(c => c.cmd), JSON.stringify(s)).toEqual(["estop"]);
  await ctl({ op: "status_delta", data: { is_estop: true } });
  await expect(page.locator(ESTOP)).toHaveAttribute("aria-label", "Reset E-Stop");
  await ctl({ op: "clearCmds" });
  await page.locator(ESTOP).tap();
  s = await settled(page);
  expect(s.map(c => c.cmd), JSON.stringify(s)).toEqual(["estop_reset"]);
});

test("the panel's long press on the E-Stop stops at the press and does nothing at the release", async ({ page }) => {
  await open(page);
  await panelLongPress(page.locator(ESTOP));
  const s = await settled(page);
  expect(s.map(c => c.cmd), JSON.stringify(s)).toEqual(["estop"]);
});

test("a swipe that starts on the E-Stop still stops (the press is the stop)", async ({ page }) => {
  await open(page);
  await panelLongPress(page.locator(ESTOP), { moveBy: 40 });
  const s = await settled(page);
  expect(s.map(c => c.cmd), JSON.stringify(s)).toEqual(["estop"]);
});

test("a second finger stops while the first holds a jog", async ({ page }) => {
  await open(page);
  const jog = page.locator('[data-strip="jog"] .jogBtn[aria-label*="X+"], [data-strip="jog"] .jogBtn:has-text("X+")').first();
  const p1 = { ...(await centre(jog)), id: 1 };
  const p2 = { ...(await centre(page.locator(ESTOP))), id: 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1] });
  await expect.poll(async () => (await sent()).some(c => String(c.cmd).startsWith("jog")), { timeout: 2000 }).toBe(true);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1, p2] });   // a second finger: not primary
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "estop").length, { timeout: 2000 }).toBe(1);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [p1] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const s = await settled(page);
  expect(s.filter(c => c.cmd === "estop_reset")).toHaveLength(0);
});

test("the mouse: the E-Stop stops at the button press; the click of that press never resets", async ({ page }) => {
  await open(page);
  const p = await centre(page.locator(ESTOP));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "estop").length, { timeout: 2000 }).toBe(1);
  await ctl({ op: "status_delta", data: { is_estop: true } });
  await expect(page.locator(ESTOP)).toHaveAttribute("aria-label", "Reset E-Stop");
  await page.mouse.up();
  const s = await settled(page);
  expect(s.map(c => c.cmd), JSON.stringify(s)).toEqual(["estop"]);
});

test("the keyboard: Enter on the E-Stop stops once; the held key's repeats never reset", async ({ page }) => {
  await open(page);
  await page.locator(ESTOP).focus();
  await page.keyboard.down("Enter");
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "estop").length, { timeout: 2000 }).toBe(1);
  await ctl({ op: "status_delta", data: { is_estop: true } });
  await expect(page.locator(ESTOP)).toHaveAttribute("aria-label", "Reset E-Stop");
  await page.keyboard.down("Enter");        // auto-repeat of the held key
  await page.keyboard.down("Enter");
  await page.keyboard.up("Enter");
  let s = await settled(page);
  expect(s.map(c => c.cmd), JSON.stringify(s)).toEqual(["estop"]);
  // a NEW key press on Reset resets
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("Enter");
  s = await settled(page);
  expect(s.map(c => c.cmd), JSON.stringify(s)).toEqual(["estop_reset"]);
});

// ── Codex R420: per-pointer gestures, scroll, keyboard, ownership, disabled, Jog Stop ──

test("two E-Stop presses (a finger and the mouse) never end in a Reset — either release order (MT-I01)", async ({ page }) => {
  for (const mouseFirst of [true, false]) {
    await open(page);
    const p = { ...(await centre(page.locator(ESTOP))), id: 1 };
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await expect.poll(async () => (await sent()).filter(c => c.cmd === "estop").length, { timeout: 2000 }).toBeGreaterThanOrEqual(1);
    await ctl({ op: "status_delta", data: { is_estop: true } });
    await expect(page.locator(ESTOP)).toHaveAttribute("aria-label", "Reset E-Stop");
    if (mouseFirst) { await page.mouse.up(); await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); }
    else { await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await page.mouse.up(); }
    const s = await settled(page);
    expect(s.filter(c => c.cmd === "estop_reset"), `mouse first ${mouseFirst}: ${JSON.stringify(s)}`).toHaveLength(0);
  }
});

test("a new Reset press of the same pointer after a cancelled E-Stop press resets (MT-I01)", async ({ page }) => {
  await open(page);
  const estop = page.locator(ESTOP);
  const ev = (type: string) => estop.evaluate((el, type) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 41, pointerType: "pen",
      isPrimary: true, detail: type === "click" ? 1 : 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      button: 0, buttons: type === "pointerdown" ? 1 : 0 }));
  }, type);
  await ev("pointerdown");                                   // E-Stop, sent at the press
  await ev("pointercancel");
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "estop").length, { timeout: 2000 }).toBe(1);
  await ctl({ op: "status_delta", data: { is_estop: true } });
  await expect(estop).toHaveAttribute("aria-label", "Reset E-Stop");
  await ev("pointerdown");                                   // a NEW press of pointer 41: it began on Reset
  await ev("pointerup");
  await ev("click");
  const s = await settled(page);
  expect(s.map(c => c.cmd), JSON.stringify(s)).toEqual(["estop", "estop_reset"]);
});

for (const [label, dx, back] of [["at the drag threshold (5 px)", 5, false], ["between threshold and slop (8 px)", 8, false], ["and back to its start", 8, true]] as const) {
  test(`a strip scroll that starts on Power acts nowhere — ${label} (MT-I02)`, async ({ page }) => {
    await open(page);
    const power = page.locator('.safetyBtns [data-control="machineOn"]');
    // the panel's long press without a browser click
    await power.evaluate(async (el, o) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const ev = (type: string, cx: number) => new PointerEvent(type, { bubbles: true, cancelable: true, composed: true,
        pointerId: 51, pointerType: "touch", isPrimary: true, clientX: cx, clientY: y, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1 });
      el.dispatchEvent(ev("pointerdown", x));
      el.dispatchEvent(ev("pointermove", x + o.dx));
      if (o.back) el.dispatchEvent(ev("pointermove", x));
      await new Promise(res => setTimeout(res, 700));
      el.dispatchEvent(ev("contextmenu", o.back ? x : x + o.dx));
      el.dispatchEvent(ev("pointerup", o.back ? x : x + o.dx));
    }, { dx, back });
    // real touch input: Chromium clicks after the drag unless it is swallowed
    const p = await centre(power);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...p, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: p.x + dx, y: p.y, id: 1 }] });
    if (back) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...p, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const s = await settled(page);
    expect(s, JSON.stringify(s)).toHaveLength(0);
  });
}

test("a keyboard activation after a long press acts on its own (MT-I03)", async ({ page }) => {
  await open(page);
  const abort = page.locator(ABORT).first();
  await panelLongPress(abort);
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "abort").length, { timeout: 2000 }).toBe(1);
  await abort.focus();
  await page.keyboard.press("Enter");
  const s = await settled(page);
  expect(s.filter(c => c.cmd === "abort"), JSON.stringify(s)).toHaveLength(2);
});

test("the press owners carry their mark in the DOM; Reset and the jog pad's Stop do not (MT-I04/06)", async ({ page }) => {
  await open(page);
  const owned = (sel: string) => page.locator(sel).first().evaluate(el => el.hasAttribute("data-press-owned"));
  expect(await owned(ESTOP)).toBe(true);
  expect(await owned('[data-strip="jog"] .jogBtn:not([data-control="jogStop"])')).toBe(true);
  expect(await owned('[data-strip="jog"] [data-control="jogStop"]')).toBe(false);
  expect(await owned(".sidePane button.holdable:visible")).toBe(true);
  await ctl({ op: "status_delta", data: { is_estop: true } });
  await expect(page.locator(ESTOP)).toHaveAttribute("aria-label", "Reset E-Stop");
  expect(await owned(ESTOP)).toBe(false);
});

test("a long press on a disabled control gives it no click (MT-I05)", async ({ page }) => {
  await open(page, { permissions: { ...PERMS_ALL, override: false } });
  const flood = page.locator('[data-strip="spindle"] input[data-control="coolant"]').first();
  await expect(flood).toBeDisabled();
  const before = await flood.isChecked();
  await page.evaluate(() => {
    (window as any).__changes = 0;
    document.addEventListener("change", () => { (window as any).__changes++; }, true);
  });
  await panelLongPress(flood);
  const p = await centre(flood);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...p, id: 1 }] });
  await page.waitForTimeout(700);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const s = await settled(page);
  expect(await page.evaluate(() => (window as any).__changes)).toBe(0);
  expect(await flood.isChecked()).toBe(before);
  expect(s, JSON.stringify(s)).toHaveLength(0);
});

test("the jog pad's Stop acts on its release — a long press and a second finger (MT-I06)", async ({ page }) => {
  await open(page);
  const stop = page.locator('[data-strip="jog"] [data-control="jogStop"]');
  const cdp = await page.context().newCDPSession(page);
  // a long touch: nothing at the press, the stop at the release
  const p = { ...(await centre(stop)), id: 1 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  await page.waitForTimeout(300);
  expect((await sent()).filter(c => c.cmd === "jog_stop")).toHaveLength(0);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "jog_stop").length, { timeout: 2000 }).toBeGreaterThan(0);
  // the panel's long press: the release acts
  await ctl({ op: "clearCmds" });
  await panelLongPress(stop);
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "jog_stop").length, { timeout: 2000 }).toBeGreaterThan(0);
  // a second finger while the first holds a jog: the stop at its release
  await ctl({ op: "clearCmds" });
  const jog = page.locator('[data-strip="jog"] .jogBtn:not([data-control="jogStop"])').first();
  const p1 = { ...(await centre(jog)), id: 1 };
  const p2 = { ...(await centre(stop)), id: 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1] });
  await expect.poll(async () => (await sent()).some(c => String(c.cmd).startsWith("jog_cont") || c.cmd === "jog_incr"), { timeout: 2000 }).toBe(true);
  const stops = async () => (await sent()).filter(c => String(c.cmd).startsWith("jog_stop")).length;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1, p2] });
  await page.waitForTimeout(100);
  expect(await stops()).toBe(0);                    // nothing at the second finger's press
  // CDP's touchEnd names the points that END: the second finger lifts while the first still holds its jog
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [p2] });
  await expect.poll(stops, { timeout: 2000 }).toBeGreaterThan(0);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [p1] });
});

// ── Codex R421: the scroll owner keeps every finger's decision; a refused press's own click ──

for (const [label, when] of [["the second finger lands first", "before"], ["the second finger lands while the first scrolls", "during"], ["the second finger lifts first", "liftFirst"]] as const) {
  test(`a second finger on the strip never undoes the first one's scroll — ${label} (MT-I02 rest A)`, async ({ page }) => {
    await open(page);
    const p1 = { ...(await centre(page.locator('.safetyBtns [data-control="machineOn"]'))), id: 1 };
    const p2 = { ...(await centre(page.locator('.strip .sub:text-is("Safety")').first())), id: 2 };
    const moved = { ...p1, x: p1.x + 8 };
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: string, touchPoints: object[]) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints } as never);
    await touch("touchStart", [p1]);
    if (when === "before") {
      await touch("touchStart", [p1, p2]);
      await touch("touchMove", [moved, p2]);
      await touch("touchEnd", [moved]);                 // the first finger lifts, the second still lies
    } else if (when === "during") {
      await touch("touchMove", [moved]);
      await touch("touchStart", [moved, p2]);
      await touch("touchEnd", [moved]);
    } else {
      await touch("touchStart", [p1, p2]);
      await touch("touchEnd", [p2]);                    // the second finger leaves first
      await touch("touchMove", [moved]);
      await touch("touchEnd", [moved]);
    }
    const s = await settled(page);
    expect(s, JSON.stringify(s)).toHaveLength(0);
    if (when !== "liftFirst") await touch("touchEnd", [p2]);
  });
}

test("a swipe inside the jog pad's Stop stops nothing — the browser's own click of it is refused (MT-I02/06 rest B)", async ({ page }) => {
  await open(page);
  const p = { ...(await centre(page.locator('[data-strip="jog"] [data-control="jogStop"]'))), id: 1 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...p, x: p.x + 14 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [{ ...p, x: p.x + 14 }] });
  const s = await settled(page);
  expect(s.filter(c => String(c.cmd).startsWith("jog_stop")), JSON.stringify(s)).toHaveLength(0);
});

// ── Codex R422 MT-I07: the scroll owner's release watcher never keeps a removed scroller ──

test("opening and closing scrollers adds no window listeners and keeps no earlier ones alive (MT-I07)", async ({ page }) => {
  await open(page);
  const cdp = await page.context().newCDPSession(page);
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  async function counts() {
    const obj = await cdp.send("Runtime.evaluate", { expression: "window", objectGroup: "mt-i07" });
    try {
      const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: obj.result.objectId! });
      return { up: listeners.filter(l => l.type === "pointerup").length, cancel: listeners.filter(l => l.type === "pointercancel").length };
    } finally { await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "mt-i07" }); }
  }
  const show = async () => {
    await page.getByTitle("Settings", { exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".scroll-thin").first()).toBeVisible();
  };
  const close = async () => {
    await dialog.getByRole("button", { name: "Close settings", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  await show(); await close();
  await show(); await close();            // warm: lazily loaded parts may add their own once
  await page.evaluate(() => { (window as any).__scrollRefs = []; });
  const series: Array<{ up: number; cancel: number }> = [];
  for (let n = 0; n < 3; n++) {
    await show();
    await dialog.evaluate((el, n) => {
      for (const node of el.querySelectorAll(".scroll-thin")) (window as any).__scrollRefs.push({ cycle: n, ref: new WeakRef(node) });
    }, n);
    await close();
    series.push(await counts());
  }
  await cdp.send("HeapProfiler.collectGarbage");
  const earlierAlive = await page.evaluate(() =>
    ((window as any).__scrollRefs as { cycle: number; ref: WeakRef<Element> }[])
      .filter(r => r.cycle < 2 && r.ref.deref() && !r.ref.deref()!.isConnected).length);
  expect(series[2], JSON.stringify(series)).toEqual(series[1]);
  expect(series[1], JSON.stringify(series)).toEqual(series[0]);
  expect(earlierAlive).toBe(0);
});

// ── Fable (P1a merge): the pad's Stop by keyboard sends only its stop ──

test("Enter and Space on the focused pad Stop send only the stop — never Cycle Start or Pause", async ({ page }) => {
  await open(page);
  const stop = page.locator('[data-strip="jog"] [data-control="jogStop"]');
  for (const key of ["Enter", " "]) {
    await ctl({ op: "clearCmds" });
    await stop.focus();
    await page.keyboard.press(key === " " ? "Space" : key);
    const s = await settled(page);
    const cmds = s.map(c => String(c.cmd));
    expect(cmds.some(c => c.startsWith("jog_stop")), `${key}: ${JSON.stringify(cmds)}`).toBe(true);
    expect(cmds.filter(c => !c.startsWith("jog_stop")), `${key}: ${JSON.stringify(cmds)}`).toEqual([]);
  }
});

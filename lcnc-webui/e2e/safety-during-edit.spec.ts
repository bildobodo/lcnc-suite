// The safety buttons while an input helper is open (operator 2026-10-28/29).
// With the number keypad or the text keyboard open, a press on Disarm, E-Stop
// or Power did nothing: the strip CENTRED its few visible sections, the
// pointerdown outside the input area hid the helper, the sections came back
// and Safety jumped to the left before the click. The same press on another
// control of the edited field's own section (a hold on Unhome All while the
// keypad edits a touch-off field) lost it the same way — the section moved
// right when Jog came back.
//
// The rules held here (operator decisions 2026-10-29):
//   - Safety stands at the left of the strip in every state and at every
//     width; a helper starts directly right of it (the number keypad right of
//     the section that owns its field) — the strip never centres.
//   - Nothing moves under a press: the helper still closes at the pointerdown
//     outside its area (the session rule), the strip's layout follows when the
//     press has ended — so the press lands on the control it began on.
//   - Portrait keeps the Safety section's machine info while a helper is open
//     wherever the helper fits with it; it folds only where it would not.
//
// Every press is REAL pointer input (`mouse`, or `tap` with hasTouch):
// Playwright hit-tests the control at its centre, so a control that moves
// away under the press fails here instead of being reached synthetically.
import { test, expect, type Page, type Locator } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};

type Sent = { cmd?: string; [k: string]: unknown };
async function sent(): Promise<Sent[]> {
  return ((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [];
}

async function open(page: Page, viewport: { width: number; height: number }) {
  await ctl({ op: "reset" });
  await page.setViewportSize(viewport);
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", armed: true, data: { active_file: "/A.ngc", permissions: PERMS_ALL } });
  await expect(page.locator(".pill.armed")).toHaveCount(1);
  await ctl({ op: "clearCmds" });
}
/** Touch mode: the session's first touch switches to touch sizes, which
 *  moves the strip — a neutral tap first (as input-session.spec). */
async function openTouch(page: Page, viewport: { width: number; height: number }) {
  await open(page, viewport);
  await page.touchscreen.tap(2, 2);
  await expect(page.locator("html")).toHaveClass(/touch-device/);
}

type Helper = "keyboard" | "keypad (strip field)" | "keypad (side-pane field)";
const HELPERS: Helper[] = ["keyboard", "keypad (strip field)", "keypad (side-pane field)"];

/** Open a helper the way the operator does: a deliberate press on its field. */
async function openHelper(page: Page, helper: Helper, touch: boolean): Promise<Locator> {
  const press = (l: Locator) => (touch ? l.tap() : l.click());
  if (helper === "keyboard") {
    await press(page.getByRole("tab", { name: "MDI", exact: true }));
    await press(page.locator(".mdiInput"));
    await expect(page.locator(".tkStrip")).toBeVisible();
    return page.locator(".tkStrip");
  }
  let field: Locator;
  if (helper === "keypad (strip field)") field = page.locator("input.setupInput").first();
  else {
    await press(page.getByRole("tab", { name: "Probing", exact: true }));
    field = page.locator(".probePanel .formGrid input").first();
  }
  await field.scrollIntoViewIfNeeded();
  await press(field);
  await expect(page.locator(".nkStrip")).toBeVisible();
  return page.locator(".nkStrip");
}

const box = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: Math.round(b.x * 2) / 2, y: Math.round(b.y * 2) / 2, w: Math.round(b.width * 2) / 2, h: Math.round(b.height * 2) / 2 };
};
const safetyBoxes = async (page: Page) => ({
  section: await box(page.locator(".safetyStrip")),
  buttons: await Promise.all(["arm", "estop", "machineOn"].map(c => box(page.locator(`.safetyBtns [data-control="${c}"]`)))),
});

const SAFETY_PRESSES = [
  { control: "arm", wants: (s: Sent[]) => s.some(c => c.cmd === "arm" && c.armed === false), what: "arm {armed: false}" },
  { control: "estop", wants: (s: Sent[]) => s.some(c => c.cmd === "estop"), what: "estop" },
  { control: "machineOn", wants: (s: Sent[]) => s.some(c => c.cmd === "machine_off" || c.cmd === "machine_on"), what: "machine_on/off" },
] as const;

for (const vp of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }, { width: 2560, height: 1440 }]) {
  test(`landscape ${vp.width} × ${vp.height}: Safety stays at the left in every helper state, each helper starts right of it or of its owner section`, async ({ page }) => {
    await open(page, vp);
    const strip = await box(page.locator(".strip"));
    const plain = await safetyBoxes(page);
    const jog = await box(page.locator('[data-strip="jog"]'));
    // at the strip's left edge (its own 8 px start), never centred
    expect(plain.section.x - strip.x, `Safety at the strip's start: ${JSON.stringify({ strip, plain })}`).toBeLessThanOrEqual(1.5);
    for (const helper of HELPERS) {
      const h = await openHelper(page, helper, false);
      expect(await safetyBoxes(page), `${helper}: Safety unmoved`).toEqual(plain);
      const hb = await box(h);
      if (helper === "keypad (strip field)") {
        // the owner section takes the first place, the keypad follows it
        const setup = await box(page.locator('[data-strip="setup"]'));
        expect(setup.x, `${helper}: the owner section right of Safety`).toBe(jog.x);
        expect(hb.x - (setup.x + setup.w), `${helper}: the keypad right of its owner section`).toBe(jog.x - (plain.section.x + plain.section.w));
      } else {
        expect(hb.x, `${helper}: the helper right of Safety, where Jog starts`).toBe(jog.x);
      }
      await page.mouse.click(2, 2);   // a press outside every input area closes it
      await expect(page.locator(".tkStrip, .nkStrip")).toHaveCount(0);
    }
  });
}

test.describe("a press on a safety button with a helper open lands (mouse, landscape)", () => {
  for (const helper of HELPERS) {
    for (const p of SAFETY_PRESSES) {
      test(`${helper}: ${p.control} sends ${p.what}`, async ({ page }) => {
        await open(page, { width: 1920, height: 1080 });
        await openHelper(page, helper, false);
        await ctl({ op: "clearCmds" });
        await page.locator(`.safetyBtns [data-control="${p.control}"]`).click();
        await expect.poll(async () => p.wants(await sent()), { timeout: 3000 }).toBe(true);
      });
    }
  }
});

for (const orient of [{ name: "landscape", width: 1280, height: 800 }, { name: "portrait", width: 900, height: 1200 }]) {
  test.describe(`a tap on a safety button with a helper open lands (touch, ${orient.name})`, () => {
    test.use({ hasTouch: true });
    for (const helper of HELPERS) {
      for (const p of SAFETY_PRESSES) {
        test(`${helper}: ${p.control} sends ${p.what}`, async ({ page }) => {
          await openTouch(page, orient);
          await openHelper(page, helper, true);
          await ctl({ op: "clearCmds" });
          await page.locator(`.safetyBtns [data-control="${p.control}"]`).tap();
          await expect.poll(async () => p.wants(await sent()), { timeout: 3000 }).toBe(true);
        });
      }
    }
  });
}

for (const orient of [{ name: "landscape", width: 1920, height: 1080 }, { name: "portrait", width: 900, height: 1200 }]) {
  test(`${orient.name}: a hold on a control of the owner section lands — the section does not move under the press`, async ({ page }) => {
    await open(page, orient);
    await openHelper(page, "keypad (strip field)", false);
    await ctl({ op: "clearCmds" });
    // the axis row's Home / Unhome X (a hold, 500 ms): the finger stays where it pressed
    const target = page.locator('[data-strip="setup"]').getByRole("button", { name: /^(Home|Unhome) X$/ });
    const b = (await target.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect.poll(async () => (await sent()).some(c => (c.cmd === "home" || c.cmd === "unhome") && c.joint === 0), { timeout: 3000 }).toBe(true);
  });
}

// ── The press ends with ITS pointer (Codex R224 SDE-01 / SDE-02) ──
// A press holds the strip until that pointer's own end — its click, its
// cancel, 500 ms after a release no click followed — never by its age, and
// never by another pointer's release. A long press on a plain control lands
// like a short one; a second finger leaves the first one's press alone.
const LONG_PRESS_MS = 3000;
/** The press targets read by the long-press and two-finger cases: a WCS
 *  choice (a click sends `mdi G55`) and Setup's help (a click opens it). */
const g55 = (page: Page) => page.getByRole("radio", { name: "G55", exact: true });
const setupHelp = (page: Page) => page.getByRole("button", { name: "Help: Go to positions", exact: true });
const jogShown = (page: Page) => page.locator('[data-strip="jog"]').evaluate(el => (el as HTMLElement).offsetParent !== null);

async function recordPointerEvents(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { sdeEvents: { type: string; pointerId?: number; target?: string }[] };
    w.sdeEvents = [];
    for (const type of ["pointerdown", "pointerup", "pointercancel", "click"]) {
      document.addEventListener(type, (e) => {
        const c = (e.target as Element | null)?.closest('button, input, [role="radio"]');
        w.sdeEvents.push({ type, pointerId: (e as PointerEvent).pointerId, target: (c?.getAttribute("aria-label") ?? c?.textContent ?? "").trim().slice(0, 40) });
      }, true);
    }
  });
}
const pointerEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as { sdeEvents: { type: string; pointerId?: number; target?: string }[] }).sdeEvents);

test.describe("a long press lands like a short one — the press is not ended by its age (mouse, landscape)", () => {
  test(`G55 held ${LONG_PRESS_MS} ms with the setup keypad open: unmoved before the release, mdi G55 sent once`, async ({ page }) => {
    await open(page, { width: 1920, height: 1080 });
    await openHelper(page, "keypad (strip field)", false);
    await ctl({ op: "clearCmds" });
    const before = await box(g55(page));
    await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2);
    await page.mouse.down();
    await page.waitForTimeout(LONG_PRESS_MS);
    expect(await box(g55(page)), "G55 where the press began, before the release").toEqual(before);
    await page.mouse.up();
    await expect.poll(async () => (await sent()).filter(c => c.cmd === "mdi" && c.text === "G55").length, { timeout: 3000 }).toBe(1);
    await expect.poll(() => jogShown(page), { timeout: 2000, message: "after the press the strip follows" }).toBe(true);
  });

  test(`Setup's help held ${LONG_PRESS_MS} ms with the setup keypad open: unmoved, the help opens`, async ({ page }) => {
    await open(page, { width: 1920, height: 1080 });
    await openHelper(page, "keypad (strip field)", false);
    const before = await box(setupHelp(page));
    await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2);
    await page.mouse.down();
    await page.waitForTimeout(LONG_PRESS_MS);
    expect(await box(setupHelp(page)), "the help where the press began").toEqual(before);
    await page.mouse.up();
    await expect(setupHelp(page)).toHaveAttribute("aria-expanded", "true");
  });

  test("a release no click follows (the right button) ends the press after its 500 ms — the strip follows while nothing is pressed", async ({ page }) => {
    await open(page, { width: 1920, height: 1080 });
    await openHelper(page, "keypad (strip field)", false);
    const head = await box(page.locator('[data-strip="setup"] .sectionHelp'));
    await page.mouse.move(head.x + 4, head.y + head.h / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.up({ button: "right" });
    await expect(page.locator(".nkStrip"), "the press outside the keypad closed it").toHaveCount(0);
    expect(await jogShown(page), "within the 500 ms the strip still holds").toBe(false);
    await expect.poll(() => jogShown(page), { timeout: 2000 }).toBe(true);
  });
});

test.describe("each pointer ends its own press (touch, landscape, two fingers)", () => {
  test.use({ hasTouch: true });

  async function touchSetup(page: Page) {
    await openTouch(page, { width: 1920, height: 1080 });
    await openHelper(page, "keypad (strip field)", true);
    await ctl({ op: "clearCmds" });
    await recordPointerEvents(page);
    const homeX = page.locator('[data-strip="setup"]').getByRole("button", { name: /^(Home|Unhome) X$/ });
    const cdp = await page.context().newCDPSession(page);
    return { homeX, cdp };
  }
  const centre = (b: { x: number; y: number; w: number; h: number }, id: number) => ({ id, x: b.x + b.w / 2, y: b.y + b.h / 2 });

  test("finger 2 taps elsewhere and lifts while finger 1 holds Home X: Home X stays, the strip follows only after finger 1", async ({ page }) => {
    const { homeX, cdp } = await touchSetup(page);
    const before = await box(homeX);
    const p1 = centre(before, 1);
    const p2 = { id: 2, x: 1850, y: 600 };   // the side pane
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1] });
    await page.waitForTimeout(80);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1, p2] });
    await page.waitForTimeout(50);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [p2] });
    await page.waitForTimeout(650);
    const ev = await pointerEvents(page);
    const downs = ev.filter(e => e.type === "pointerdown"), ups = ev.filter(e => e.type === "pointerup");
    expect(downs, JSON.stringify(ev)).toHaveLength(2);
    expect(ups.map(e => e.pointerId), "only finger 2 was released").toEqual([downs[1].pointerId]);
    expect(ev.filter(e => e.type === "pointercancel")).toHaveLength(0);
    expect(await box(homeX), "Home X under finger 1, still held").toEqual(before);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => (await sent()).filter(c => (c.cmd === "home" || c.cmd === "unhome") && c.joint === 0).length, { timeout: 3000 }).toBe(1);
    await expect.poll(() => jogShown(page), { timeout: 2000, message: "both presses over: the strip follows" }).toBe(true);
  });

  // A second finger makes no tap (Chrome's tap is a one-finger gesture, no
  // click), so its target here is a HOLD: Home Y fires from its own timer.
  // Finger 1 (the press that closes the keypad) rests on Setup's heading.
  test("finger 1 lifts while finger 2 holds Home Y: Home Y stays put and fires, the strip follows after finger 2", async ({ page }) => {
    const { cdp } = await touchSetup(page);
    const homeY = page.locator('[data-strip="setup"]').getByRole("button", { name: /^(Home|Unhome) Y$/ });
    const yBefore = await box(homeY);
    const head = await box(page.locator('[data-strip="setup"] .sectionHelp'));
    const p1 = { id: 1, x: head.x + 4, y: head.y + head.h / 2 };
    const p2 = centre(yBefore, 2);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1] });
    await page.waitForTimeout(100);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1, p2] });
    await page.waitForTimeout(50);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [p1] });
    await page.waitForTimeout(650);   // past finger 1's 500 ms; finger 2's hold fires meanwhile
    const ev = await pointerEvents(page);
    const downs = ev.filter(e => e.type === "pointerdown"), ups = ev.filter(e => e.type === "pointerup");
    expect(ups.map(e => e.pointerId), `only finger 1 was released ${JSON.stringify(ev)}`).toEqual([downs[0].pointerId]);
    expect(await box(homeY), "Home Y under finger 2, still held").toEqual(yBefore);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => (await sent()).filter(c => (c.cmd === "home" || c.cmd === "unhome") && c.joint === 1).length, { timeout: 3000 }).toBe(1);
    await expect.poll(() => jogShown(page), { timeout: 2000 }).toBe(true);
  });

  test("a cancelled touch ends its press at once (control: the browser took it)", async ({ page }) => {
    const { homeX, cdp } = await touchSetup(page);
    const p1 = centre(await box(homeX), 1);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [p1] });
    await page.waitForTimeout(100);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    expect((await pointerEvents(page)).some(e => e.type === "pointercancel"), "the browser reported the cancel").toBe(true);
    await expect.poll(() => jogShown(page), { timeout: 400 }).toBe(true);
    expect((await sent()).some(c => c.cmd === "home" || c.cmd === "unhome"), "the cancelled hold sent nothing").toBe(false);
  });
});

// ── An opening by another pointer waits too (Codex R225) ──
// The mouse holds G55 (the keypad closed at its pointerdown); a touch taps
// the MDI line and opens the keyboard. The keyboard used to replace Setup at
// once — the mouse's release then hit Backspace. Now the opening waits until
// every press has had its click (or its 500 ms without one): the mouse is
// released on G55, nothing else is hit, then the keyboard comes. Chrome
// dispatches no click for the mouse here — the tap's compatibility mouse
// events reset its click target — so G55's own action is the browser's to
// give; what is ours is that nothing else receives the release.
test.describe("an opening by another pointer waits for the press still down (mouse + touch)", () => {
  test.use({ hasTouch: true });
  test("a touch opens MDI while the mouse holds G55: G55 stays visible and unmoved, the release lands on it and nothing else, then the keyboard shows", async ({ page }) => {
    await openTouch(page, { width: 1920, height: 1080 });
    await page.getByRole("tab", { name: "MDI", exact: true }).tap();
    await openHelper(page, "keypad (strip field)", true);
    await ctl({ op: "clearCmds" });
    await recordPointerEvents(page);
    const target = await g55(page).elementHandle();
    const before = (await target!.boundingBox())!;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.locator(".mdiInput").tap();
    await page.waitForTimeout(150);
    const ev = await pointerEvents(page);
    expect(ev.filter(e => (e.type === "pointerup" || e.type === "pointercancel") && e.pointerId === 1), "the mouse is still down").toHaveLength(0);
    expect(await target!.boundingBox(), "G55 visible and where the mouse pressed it").toEqual(before);
    expect(await page.locator(".tkStrip").count(), "the keyboard waits for the mouse").toBe(0);
    await page.mouse.up();
    await expect(page.locator(".tkStrip"), "after the mouse's press the opening applies").toBeVisible();
    await expect(page.locator(".stripHelperPlace")).toHaveCount(0);
    const after = await pointerEvents(page);
    expect(after.find(e => e.type === "pointerup" && e.pointerId === 1)?.target, `the mouse released on G55 ${JSON.stringify(after)}`).toBe("G55");
    expect(after.filter(e => e.type === "click" && e.pointerId !== 5 && e.target !== "G55"), "no click on another control").toEqual([]);
    expect((await sent()).filter(c => !(c.cmd === "mdi" && c.text === "G55")), "no other command").toEqual([]);
  });
});

// ── A queued helper owns no place (Codex R226) ──
// The mouse holds G55 in a sideways-scrolled strip; a touch opens MDI (its
// keyboard queued, the keypad's place held). Closing that never-shown
// session again (a tap outside every input area) used to drop the KEYPAD's
// place — scrollLeft clamped to 0, G55 slid 150 px under the held mouse.
// Kept or cancelled, the place holds until the mouse's press ends; then the
// last wanted helper shows, or the normal strip returns, with no place left.
test.describe("a queued helper owns no place: closing it keeps the shown one's (mouse + touch, 150 %)", () => {
  test.use({ hasTouch: true });
  for (const cancel of [false, true]) {
    test(`the queued MDI keyboard ${cancel ? "closed again" : "kept"} while the mouse holds G55: target and scroll unchanged until the release`, async ({ page }) => {
      await openTouch(page, { width: 1280, height: 800 });
      await page.getByRole("tab", { name: "MDI", exact: true }).tap();
      await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
      await openHelper(page, "keypad (strip field)", true);
      const strip = page.locator(".strip");
      await strip.evaluate(el => { el.scrollLeft = 100; });
      const scroll = () => strip.evaluate(el => ({ left: el.scrollLeft, width: el.scrollWidth }));
      const scrollBefore = await scroll();
      expect(scrollBefore.left, "the strip is scrolled").toBeGreaterThan(0);
      await recordPointerEvents(page);
      const target = await g55(page).elementHandle();
      const before = (await target!.boundingBox())!;
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      await page.locator(".mdiInput").tap();
      await page.waitForTimeout(100);
      expect(await page.locator(".tkStrip").count(), "the keyboard is queued").toBe(0);
      expect(await page.locator(".stripHelperPlace").count(), "the keypad's place holds").toBe(1);
      if (cancel) await page.touchscreen.tap(2, 2);
      await page.waitForTimeout(650);
      expect((await pointerEvents(page)).filter(e => (e.type === "pointerup" || e.type === "pointercancel") && e.pointerId === 1), "the mouse is still down").toHaveLength(0);
      expect(await target!.boundingBox(), "G55 where the mouse pressed it").toEqual(before);
      expect(await scroll(), "the scroll range and position unchanged").toEqual(scrollBefore);
      await page.mouse.up();
      if (cancel) await expect.poll(() => jogShown(page), { timeout: 2000, message: "the normal strip returns" }).toBe(true);
      else await expect(page.locator(".tkStrip"), "the queued keyboard shows").toBeVisible();
      await expect(page.locator(".stripHelperPlace"), "no place left behind").toHaveCount(0);
      expect((await sent()).filter(c => !(c.cmd === "mdi" && c.text === "G55")), "no other command").toEqual([]);
    });
  }
});

// ── The keypad's place holds through a press too (Codex R224 SDE-03) ──
// The keypad leaves at the pointerdown (its session closed), but its place
// stays until the press has ended: with the strip scrolled sideways, the
// shrinking scroll range made the browser clamp scrollLeft and the press
// target slid away under a 100 ms click.
test("a sideways-scrolled strip keeps its scroll position under a press that closes the keypad (1280 × 800 at 150 %)", async ({ page }) => {
  await open(page, { width: 1280, height: 800 });
  await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
  await openHelper(page, "keypad (strip field)", false);
  const strip = page.locator(".strip");
  await strip.evaluate(el => { el.scrollLeft = 100; });
  const scroll = () => strip.evaluate(el => ({ left: el.scrollLeft, width: el.scrollWidth }));
  const scrollBefore = await scroll();
  expect(scrollBefore.left, "the strip is scrolled").toBeGreaterThan(0);
  await ctl({ op: "clearCmds" });
  const before = await box(g55(page));
  expect(await g55(page).evaluate(el => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  }), "G55 is hit-testable at its centre").toBe(true);
  await page.mouse.move(before.x + before.w / 2, before.y + before.h / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  expect(await scroll(), "the scroll range and position unchanged under the press").toEqual(scrollBefore);
  expect(await box(g55(page)), "G55 where the press began").toEqual(before);
  await page.mouse.up();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "mdi" && c.text === "G55").length, { timeout: 3000 }).toBe(1);
});

// At 150 % (600 × 800 CSS px) the keyboard (692 zoomed px) and the keypad
// under its owner section (Setup + keypad) end past the viewport with the
// info (76 / 89 CSS px); the keypad of a side-pane field alone fits with it.
const FOLDS_AT_150: Record<Helper, boolean> = {
  "keyboard": true, "keypad (strip field)": true, "keypad (side-pane field)": false,
};

test.describe("portrait: the machine info stays while the helper fits with it", () => {
  test.use({ hasTouch: true });
  for (const helper of HELPERS) {
    test(`${helper}: kept at 100 % (900 × 1200), ${FOLDS_AT_150[helper] ? "folded" : "kept"} at 150 % — the helper whole in the viewport, the safety buttons unmoved`, async ({ page }) => {
      await openTouch(page, { width: 900, height: 1200 });
      const plain = await safetyBoxes(page);
      const h = await openHelper(page, helper, true);
      await expect(page.locator(".safetyStrip .statusRow"), "100 %: the machine info stays").toHaveCount(8);
      await expect(page.locator(".safetyStrip .codesRow")).toHaveCount(1);
      expect((await safetyBoxes(page)).buttons, "100 %: the safety buttons unmoved").toEqual(plain.buttons);
      const fit = (l: Locator) => l.evaluate(el => {
        const strip = el.closest(".strip")!;
        return { bottom: el.getBoundingClientRect().bottom, inner: innerHeight, scroll: strip.scrollHeight - strip.clientHeight };
      });
      let f = await fit(h);
      expect(f.bottom, `100 %: the helper within the viewport ${JSON.stringify(f)}`).toBeLessThanOrEqual(f.inner + 1);
      expect(f.scroll, "100 %: no hidden strip part").toBeLessThanOrEqual(1);
      // 150 % (600 × 800 CSS px): folded only where the helper would not fit with the info
      await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
      if (FOLDS_AT_150[helper]) await expect(page.locator(".safetyStrip .statusDetail"), "150 %: folded").toHaveCount(0);
      else await expect(page.locator(".safetyStrip .statusRow"), "150 %: it fits — kept").toHaveCount(8);
      f = await fit(h);
      expect(f.bottom, `150 %: the helper within the viewport ${JSON.stringify(f)}`).toBeLessThanOrEqual(f.inner + 1);
      expect(f.scroll, "150 %: no hidden strip part").toBeLessThanOrEqual(1);
      // and back at 100 % it returns
      await page.evaluate(() => { document.documentElement.style.zoom = ""; });
      await expect(page.locator(".safetyStrip .statusRow"), "back at 100 %: the info returns").toHaveCount(8);
    });
  }
});

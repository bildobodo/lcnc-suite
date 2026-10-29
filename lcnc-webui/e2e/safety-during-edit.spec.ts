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

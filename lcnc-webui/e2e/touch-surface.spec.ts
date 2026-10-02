import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// The touch surface on the operator's machine (Chromium, touchscreen —
// reported 2026-09-26 on the development tree):
//
//   - a long press is a hold, never a right click: Chromium ends a long
//     press with `contextmenu` (a PointerEvent, pointerType "touch") — the
//     hold's action ran AND the browser's menu opened over the controls.
//     The app refuses it on touch everywhere but in editable text; a mouse
//     right click on a desktop keeps the browser's menu. (Headless Chromium
//     does not turn a synthesized long press into `contextmenu` — checked
//     with CDP Input.synthesizeTapGesture and raw touch events — so the
//     event is dispatched here as Chromium delivers it.)
//   - no tap highlight: Chromium's default grey box flashed over a slider's
//     track and the view cube; only buttons were exempt.
//   - an icon-only header pill is centred and as tall as a text pill.
//
// Runs under `serial-guards`: mock-global state, one file at a time.

// A touch-capable browser; the session is in touch mode only after a touch.
test.use({ hasTouch: true });

async function ready(page: Page) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { keyboard: { jogEnabled: true, buttonsEnabled: true } } } });
}

/** Dispatch the `contextmenu` Chromium raises; true when the app refused it. */
function refused(page: Page, selector: string, pointerType: "touch" | "mouse") {
  return page.locator(selector).first().evaluate((el, pointerType) => {
    const r = el.getBoundingClientRect();
    const ev = new PointerEvent("contextmenu", { bubbles: true, cancelable: true, pointerType,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, pointerType);
}

const HOLD_BUTTON = '[data-strip="setup"] button[aria-label="Home X"]';
const PLAIN_BUTTON = 'button[title="Settings"]';
// A dimmed control's wrapper: a hold button that just fired is latched busy
// for 200 ms and re-renders into it — the contextmenu at the END of the
// long press lands here, where the hold's own handler is not (the
// operator's "the action runs AND the menu pops up").
const DIMMED_WRAPPER = ".sidePane .btnTip:visible";
const SLIDER = '[data-strip="overrides"] input[type="range"]';
const CUBE = ".viewerPane canvas";
const LABEL = '[data-strip="jog"] .label-muted';
const TEXT_FIELD = ".sidePane input.mdiInput";

test("a long press on touch opens no browser menu — but in editable text; a mouse right click is left alone", async ({ page }) => {
  await ready(page);
  // Tools: "Measure Current" is dimmed (no tool loaded) — a .btnTip wrapper.
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(page.locator(DIMMED_WRAPPER).first()).toBeVisible();
  // A desktop session (no touch seen yet): a mouse right click keeps the menu.
  expect(await refused(page, PLAIN_BUTTON, "mouse")).toBe(false);
  // Chromium's long press arrives as a touch contextmenu.
  for (const sel of [HOLD_BUTTON, DIMMED_WRAPPER, PLAIN_BUTTON, SLIDER, CUBE, LABEL]) {
    expect(await refused(page, sel, "touch"), `${sel}: a long press is a hold`).toBe(true);
  }
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  expect(await refused(page, TEXT_FIELD, "touch"), "a text field keeps copy / paste").toBe(false);
  // A touch session: even a mouse-typed contextmenu is refused on a control.
  await page.touchscreen.tap(5, 400);
  await expect(page.locator("html")).toHaveClass(/touch-device/);
  expect(await refused(page, SLIDER, "mouse")).toBe(true);
  expect(await refused(page, TEXT_FIELD, "mouse")).toBe(false);
});

test("no tap highlight on any surface; an icon-only header pill is centred and as tall as a text pill", async ({ page }) => {
  await ready(page);
  for (const sel of [SLIDER, CUBE, LABEL, HOLD_BUTTON, ".hdr .pill"]) {
    const tap = await page.locator(sel).first().evaluate(e => getComputedStyle(e).getPropertyValue("-webkit-tap-highlight-color"));
    expect(tap, `${sel} tap highlight`).toBe("rgba(0, 0, 0, 0)");
  }
  const pills = await page.locator(".hdr .pill").evaluateAll(els => els.map(p => {
    const r = p.getBoundingClientRect();
    const svg = p.querySelector("svg")?.getBoundingClientRect();
    return { h: Math.round(r.height * 10) / 10, off: svg ? Math.abs(svg.top + svg.height / 2 - (r.top + r.height / 2)) : 0, icon: !!svg };
  }));
  expect(pills.filter(p => p.icon).length, "the keyboard pill is shown").toBeGreaterThan(0);
  const textHeight = pills.find(p => !p.icon)!.h;
  for (const p of pills) {
    expect(p.h, "one pill height").toBe(textHeight);
    expect(p.off, "icon centred").toBeLessThan(0.6);
  }
});

test("a help icon's target is a 24 px square around its glyph, and the glyph never makes a label row taller than its text", async ({ page }) => {
  // Design wave D6: the touch glyph was 20 px — every form label row grew
  // past its text (2.95 instead of 3 probing rows at 1280 × 800); now the
  // glyph fits the line and the finger's target is an invisible square.
  await ready(page);
  await page.touchscreen.tap(5, 400);
  await expect(page.locator("html")).toHaveClass(/touch-device/);
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  const field = page.locator(".probePanel .formGrid > .formField").first();
  await field.scrollIntoViewIfNeeded();
  const r = await field.evaluate(f => {
    const head = f.querySelector<HTMLElement>(".formFieldHead")!;
    const label = head.querySelector<HTMLElement>(".formLabel")!;
    const icon = head.querySelector<HTMLElement>(".helpIcon")!;
    const i = icon.getBoundingClientRect();
    const cx = i.left + i.width / 2, cy = i.top + i.height / 2;
    const hits = [[11, 0], [-11, 0], [0, 11], [0, -11]].map(([dx, dy]) => {
      const at = document.elementFromPoint(cx + dx, cy + dy);
      return at === icon ? true : `${dx},${dy}: ${at?.tagName}.${(at as HTMLElement | null)?.className}`;
    });
    const before = getComputedStyle(icon, "::before");
    const target = [parseFloat(before.width), parseFloat(before.height)];
    return { head: head.getBoundingClientRect().height, line: parseFloat(getComputedStyle(label).lineHeight), hits, target };
  });
  expect(r.target, "the invisible target is 24 px square").toEqual([24, 24]);
  expect(r.hits, "a press 11 px from the glyph's centre is on the help icon").toEqual([true, true, true, true]);
  expect(r.head, "the label row is its text's line").toBeLessThanOrEqual(r.line + 0.5);
});

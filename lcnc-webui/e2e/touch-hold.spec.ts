import { test, expect, type Page, type CDPSession } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// WP7 / UI-14 — hold-to-fire under REAL touch events. The layout fixtures
// only add the `touch-device` class; a hold is a pointer sequence, so this
// spec drives Chromium's touch input through CDP (Input.dispatchTouchEvent)
// in a hasTouch context and asserts the one thing that matters: exactly one
// command per complete hold, none for a tap, a slide-off, a cancel, a
// hidden page — and every cancelled hold says so at the control.
//
// Runs under `serial-guards` (mock-global status + recorded commands).

test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};

async function recorded(cmd: string): Promise<number> {
  const sent = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] };
  return (sent.cmds ?? []).filter(c => c.cmd === cmd).length;
}

async function open(page: Page) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("touch-device"));
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", homed: [1, 1, 1], permissions: PERMS_ALL } });
  await expect(page.getByRole("button", { name: "Unhome All", exact: true })).toBeEnabled();
  await ctl({ op: "clearCmds" });
  return page.context().newCDPSession(page);
}

async function centre(page: Page, name: string) {
  const box = (await page.getByRole("button", { name, exact: true }).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const touch = (cdp: CDPSession, type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel", pts: { x: number; y: number }[]) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });

test.afterEach(async () => {
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("a short tap sends nothing and says why; a complete hold sends exactly one command", async ({ page }) => {
  const cdp = await open(page);
  const p = await centre(page, "Unhome All");
  await touch(cdp, "touchStart", [p]);
  await page.waitForTimeout(120);
  await touch(cdp, "touchEnd", []);
  await expect(page.locator("[data-btn-hint]")).toHaveText("Hold to activate");
  await page.waitForTimeout(300);
  expect(await recorded("unhome_all")).toBe(0);
  await touch(cdp, "touchStart", [p]);
  await page.waitForTimeout(700);
  await touch(cdp, "touchEnd", []);
  await expect.poll(() => recorded("unhome_all")).toBe(1);
  await page.waitForTimeout(300);
  expect(await recorded("unhome_all")).toBe(1);
});

test("sliding off, a scroll-cancel and a hidden page cancel the hold; the next hold starts from zero", async ({ page }) => {
  const cdp = await open(page);
  const p = await centre(page, "Unhome All");
  // Slide beyond the slop — and the control says so (UX-12).
  await touch(cdp, "touchStart", [p]);
  await page.waitForTimeout(150);
  await touch(cdp, "touchMove", [{ x: p.x + 40, y: p.y }]);
  await expect(page.locator("[data-btn-hint]")).toHaveText("Hold to activate — stay on the button");
  await page.waitForTimeout(500);
  await touch(cdp, "touchEnd", []);
  expect(await recorded("unhome_all")).toBe(0);
  // The gate closes under the finger: the hint names the reason, nothing fires.
  await touch(cdp, "touchStart", [p]);
  await page.waitForTimeout(150);
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, zero: false }, permission_reasons: { zero: "Machine off" } } });
  await expect(page.locator("[data-btn-hint]")).toHaveText("Unavailable — Machine off");
  await page.waitForTimeout(500);
  await touch(cdp, "touchEnd", []);
  expect(await recorded("unhome_all")).toBe(0);
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL, permission_reasons: {} } });
  await expect(page.getByRole("button", { name: "Unhome All", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Unhome All", exact: true })).toHaveAttribute("title", "Hold to activate");
  // touchCancel (the browser took the gesture for a scroll).
  await touch(cdp, "touchStart", [p]);
  await page.waitForTimeout(150);
  await touch(cdp, "touchCancel", []);
  await page.waitForTimeout(500);
  expect(await recorded("unhome_all")).toBe(0);
  // Page hidden mid-hold: no timer fires later.
  await touch(cdp, "touchStart", [p]);
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await touch(cdp, "touchEnd", []);
  expect(await recorded("unhome_all")).toBe(0);
  // A fresh hold starts from zero: 300 ms after the interrupted ones is not enough.
  await touch(cdp, "touchStart", [p]);
  await page.waitForTimeout(300);
  await touch(cdp, "touchEnd", []);
  await page.waitForTimeout(300);
  expect(await recorded("unhome_all")).toBe(0);
  await touch(cdp, "touchStart", [p]);
  await page.waitForTimeout(700);
  await touch(cdp, "touchEnd", []);
  await expect.poll(() => recorded("unhome_all")).toBe(1);
});

test("teleported tool dialog under touch: scroll the form, keypad on a field, confirm from the strip, footer reachable", async ({ page }) => {
  const cdp = await open(page);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  const dialog = page.locator(".editDialog");
  await expect(dialog).toBeVisible();
  const content = dialog.locator(".dialogContent");
  // Scroll the form by touch drag.
  const box = (await content.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height - 40 };
  await touch(cdp, "touchStart", [start]);
  for (let i = 1; i <= 6; i++) await touch(cdp, "touchMove", [{ x: start.x, y: start.y - i * 30 }]);
  await touch(cdp, "touchEnd", []);
  // Open the keypad on a number field with a tap, type via the strip, confirm.
  const flutes = dialog.getByRole("textbox", { name: "Flutes", exact: true });
  await flutes.scrollIntoViewIfNeeded();
  const f = (await flutes.boundingBox())!;
  await touch(cdp, "touchStart", [{ x: f.x + f.width / 2, y: f.y + f.height / 2 }]);
  await touch(cdp, "touchEnd", []);
  const strip = page.locator(".nkStrip");
  await expect(strip).toBeVisible();
  for (const key of ["4"]) {
    const k = (await strip.getByRole("button", { name: key, exact: true }).boundingBox())!;
    await touch(cdp, "touchStart", [{ x: k.x + k.width / 2, y: k.y + k.height / 2 }]);
    await touch(cdp, "touchEnd", []);
  }
  const ok = (await strip.getByRole("button", { name: "Apply", exact: true }).boundingBox())!;
  await touch(cdp, "touchStart", [{ x: ok.x + ok.width / 2, y: ok.y + ok.height / 2 }]);
  await touch(cdp, "touchEnd", []);
  await expect(strip).toHaveCount(0);
  await expect(flutes).toHaveValue("4");
  // Save / Cancel reachable.
  const footer = dialog.locator(".dialogActions");
  await footer.scrollIntoViewIfNeeded();
  await expect(footer.getByRole("button", { name: "Add", exact: true })).toBeVisible();
  await expect(footer.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  const c = (await footer.getByRole("button", { name: "Cancel", exact: true }).boundingBox())!;
  await touch(cdp, "touchStart", [{ x: c.x + c.width / 2, y: c.y + c.height / 2 }]);
  await touch(cdp, "touchEnd", []);
  // The form was edited (flutes): Cancel asks first (UX-02); Discard by touch.
  const ask = page.locator(".dialogOverlay").last();
  await expect(ask.getByText("Discard changes?")).toBeVisible();
  const d = (await ask.getByRole("button", { name: "Discard", exact: true }).boundingBox())!;
  await touch(cdp, "touchStart", [{ x: d.x + d.width / 2, y: d.y + d.height / 2 }]);
  await touch(cdp, "touchEnd", []);
  await expect(dialog).toHaveCount(0);
});

import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// Design wave D8 (UI-K08 / K09, UI-D07): what the operator reads is never
// dimmed by opacity, motion is optional, and forced colours keep every
// signal —
//
//   - a pulse moves the BACKGROUND: the state banner (it pulses at idle,
//     unhomed, on a preview refresh …) used to fade its whole box to 50 %,
//     text included;
//   - prefers-reduced-motion stops every pulse and flash; the state stays
//     as a static fill;
//   - forced colours (Windows high contrast): the focus ring, the selected
//     tab and the state banner stay distinguishable — backgrounds and
//     shadows are dropped there, and the selection was a background plus
//     a shadow.
//
// Runs under `serial-guards`: mock-global state.

async function ready(page: Page) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  // Idle (on, homed): the banner pulses there.
  await ctl({ op: "status_delta", data: { estop: false, is_estop: false, enabled: true, is_enabled: true, homed: [1, 1, 1] } });
  await expect(page.locator(".statusBanner")).toContainText("IDLE");
}
/** Computed styles of the banner sampled over one pulse period — from the
 *  moment its state settled: a state change cross-fades the fill (0.4 s
 *  colour transition, not motion; the fade-in of the words is gone under
 *  reduced motion, so the new text no longer waits it out). */
async function sampleBanner(page: Page, n = 12, everyMs = 100) {
  await page.locator(".statusBanner").evaluate(b => Promise.all(b.getAnimations()
    .filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished)));
  const out: { opacity: string; animation: string; bg: string }[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await page.locator(".statusBanner").evaluate(b => {
      const cs = getComputedStyle(b);
      return { opacity: cs.opacity, animation: cs.animationName, bg: cs.backgroundColor };
    }));
    await page.waitForTimeout(everyMs);
  }
  return out;
}
const panelBg = (page: Page) => page.evaluate(() => {
  const p = document.createElement("div");
  p.style.background = "var(--panel)";
  document.body.appendChild(p);
  const c = getComputedStyle(p).backgroundColor;
  p.remove();
  return c;
});

test.afterEach(async () => { await ctl({ op: "reset" }); });

test("a pulse moves the background, never the text: the banner stays fully opaque while it pulses", async ({ page }) => {
  await ready(page);
  const s = await sampleBanner(page);
  // Scoped keyframes carry a hash suffix (banner-pulse-65deaf8e).
  expect(s.every(x => x.animation.startsWith("banner-pulse")), "the idle banner pulses").toBe(true);
  expect([...new Set(s.map(x => x.opacity))], "the banner's opacity through a pulse").toEqual(["1"]);
  expect(new Set(s.map(x => x.bg)).size, "its background moves").toBeGreaterThan(1);
});

test("reduced motion: no pulse and no flash — the state stays a static fill", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ready(page);
  const panel = await panelBg(page);
  let s = await sampleBanner(page, 4);
  expect(s.map(x => x.animation), "idle: no pulse").toEqual(["none", "none", "none", "none"]);
  expect(new Set(s.map(x => x.bg)).size, "one static fill").toBe(1);
  expect(s[0]!.bg, "the fill still carries the state").not.toBe(panel);
  // E-Stop: the banner and the E-Stop button flash — not here.
  await ctl({ op: "status_delta", data: { estop: true, is_estop: true, enabled: false, is_enabled: false } });
  await expect(page.locator(".statusBanner")).toContainText(/E-?STOP/i);
  s = await sampleBanner(page, 4);
  expect(s.map(x => x.animation), "E-Stop: no flash").toEqual(["none", "none", "none", "none"]);
  expect(s[0]!.bg).not.toBe(panel);
  const estop = page.locator(".safetyStrip").getByRole("button", { name: /E-Stop|Reset/i }).first();
  expect(await estop.evaluate(b => getComputedStyle(b).animationName), "the E-Stop button does not flash").toBe("none");
  // The probing dot: no pulse either.
  expect(await page.evaluate(() => {
    const d = document.createElement("span");
    d.className = "statusDot probing";
    document.body.appendChild(d);
    const a = getComputedStyle(d).animationName;
    d.remove();
    return a;
  })).toBe("none");
});

test("forced colours: the focus ring, the selected tab and the state banner stay distinguishable", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await ready(page);
  const side = page.getByRole("tablist", { name: "Side panel", exact: true });
  await side.getByRole("tab", { name: "Program", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  const focused = side.getByRole("tab", { name: "MDI", exact: true });
  await expect(focused).toBeFocused();
  const ring = await focused.evaluate(b => { const cs = getComputedStyle(b); return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }; });
  expect(ring.style, "the focus ring").not.toBe("none");
  expect(ring.width).toBeGreaterThanOrEqual(2);
  const look = (name: string) => side.getByRole("tab", { name, exact: true }).evaluate(b => {
    const cs = getComputedStyle(b);
    return `${cs.backgroundColor} ${cs.color}`;
  });
  expect(await look("Program"), "the selected tab differs from the others").not.toBe(await look("Tools"));
  const banner = await page.locator(".statusBanner").evaluate(b => parseFloat(getComputedStyle(b).borderTopWidth));
  expect(banner, "the state banner is outlined").toBeGreaterThanOrEqual(2);
});

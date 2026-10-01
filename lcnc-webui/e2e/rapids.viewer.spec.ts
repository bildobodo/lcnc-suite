import { test, expect } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, settleLayout, VIEWPORTS } from "./layout-fixtures";

// The Rapids layer and a finding on a hidden rapid (fixed viewer palette P3,
// Codex R29 VP29-04 / R30): the layer hides the rapid LINES, never the limit
// overlay on them; navigating to a finding on a hidden rapid shows the rapids
// for it and says so — without touching the stored choice; a manual scrub
// ends it, and so does the operator's own switch of the layer.
const FEED = Array.from({ length: 10 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
const PREVIEW = Buffer.from(encode({ file: "/rapids.ngc", preview_schema: 10, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.length),   // the track takes the flags only from both streams
  rapid: [[27, 20, 0], [150, 20, 5]], rapid_lines: [13, 14], rapid_seq: [13, 14],
  rapid_outside: new Uint8Array([0, 1]),
  violations: [{ line: 14, axis: "X", value: 150, limit: 100, kind: "max" }], violations_total: 1 }));

test("hidden rapids keep their limit finding; a jump to it shows them for the finding and says so", async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 16 }, (_, i) => i === 0 ? "(rapids)" : `G1 X${i} F100`).join("\n") }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: "/rapids.ngc" } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 970, file: "/rapids.ngc" } });
  const next = page.locator('.scrubBar [aria-label="Next limit violation"]');
  await expect(next).toBeVisible({ timeout: 15_000 });
  const shown = (role: string) => page.evaluate(r => window.__viewerDiag!.projectRole!(r) != null, role);
  await expect.poll(() => shown("rapid"), { message: "the rapids draw by default" }).toBe(true);

  // The operator hides the rapids: the lines go, the finding on them stays.
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: false } } } } });
  await expect.poll(() => shown("rapid"), { message: "the Rapids layer hides the rapid lines" }).toBe(false);
  expect(await shown("limit"), "the limit overlay on the hidden rapid stays").toBe(true);
  expect(await shown("feed"), "the feed stays").toBe(true);
  const reveal = page.locator("[data-path-reveal]");
  await expect(reveal).toHaveCount(0);

  // A jump to the finding on the hidden rapid (entering the simulation at a
  // stopped machine): the rapids show for it, named, the stored choice untouched.
  await ctl({ op: "status_delta", data: { is_enabled: false, enabled: false } });
  await next.click();
  await expect(page.locator(".simBanner")).toBeVisible();
  await expect(reveal).toHaveText("Rapids shown for this finding — hidden in Layers");
  await expect.poll(() => shown("rapid"), { message: "shown for the finding" }).toBe(true);

  // A manual scrub ends it: the stored choice stands again.
  await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
    el.value = String(Number(el.max) * 0.2);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(reveal).toHaveCount(0);
  await expect.poll(() => shown("rapid"), { message: "hidden again after a manual scrub" }).toBe(false);

  // Again. A settings refresh that leaves the layer as it is — a theme
  // switch, the same stored choice again — keeps it (Codex R31 VP-I01: every
  // refresh re-applies every layer, and each used to end the view).
  await next.click();
  await expect(reveal).toHaveCount(1);
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme: "dark" }, viewer: { layers: { rapids: false } } } } });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme: "light" }, viewer: { layers: { rapids: false } } } } });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(reveal, "an unchanged layer choice keeps the finding's view").toHaveCount(1);
  expect(await shown("rapid")).toBe(true);
  // A real change of the choice — here or from another client — ends it:
  // the layer is the operator's.
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: true } } } } });
  await expect(reveal).toHaveCount(0);
  await expect.poll(() => shown("rapid")).toBe(true);
});

// The view a finding opens on a hidden layer is told whatever else the
// viewer shows (Codex R31 VP-I02): with the HUD off the findings card held
// nothing, and folded it hid the line behind "N warnings" — a layer the
// operator switched off must never come back unexplained.
for (const form of ["hud-off", "folded"] as const) {
  test(`a finding's view on hidden rapids is told — ${form}`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
    await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
      body: Array.from({ length: 16 }, (_, i) => i === 0 ? "(rapids)" : `G1 X${i} F100`).join("\n") }));
    await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === (form === "folded" ? "touch-portrait" : "desktop"))!);
    await ctl({ op: "status_delta", data: { active_file: "/rapids.ngc", is_enabled: false, enabled: false,
      ...(form === "folded" ? { eoffset_enabled: true, eoffset_z: 0.123, rotation_xy: 12 } : {}) } });
    await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: form === "folded" ? 972 : 971, file: "/rapids.ngc" } });
    await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
    if (form === "folded") await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: false, ...(form === "hud-off" ? { hud: false } : {}) } } } } });
    await settleLayout(page);
    if (form === "hud-off") await expect(page.locator(".viewerPane .hud")).toBeHidden();
    else await expect(page.locator(".viewerPane .hudNotes.needsCompact"), "the warnings card folds at 150 % portrait").toHaveCount(1);
    // The findings row may sit behind the compact bar's More.
    const next = page.locator('.scrubBar [aria-label="Next limit violation"]');
    if (!(await next.isVisible())) await page.locator(".scrubBar .moreToggle").click();
    await next.click();
    await expect(page.locator(".simBanner")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__viewerDiag!.projectRole!("rapid") != null), { message: "shown for the finding" }).toBe(true);
    await expect(page.locator("[data-path-reveal]"), "the view is named on screen").toBeVisible();
    await expect(page.locator("[data-path-reveal]")).toHaveText("Rapids shown for this finding — hidden in Layers");
    if (form === "folded") {
      await expect(page.locator(".viewerPane .hudNotes.needsCompact"), "the other warnings stay folded").toHaveCount(1);
      // Comp Z, the rotation and the limit violation wait behind the count;
      // the pinned view is not counted (it read "4 warnings" before).
      await expect(page.locator(".hudNotesSummary"), "the count holds only what waits behind it").toContainText("· 3 warnings");
    }
  });
}

// Only the finding's SECTION shows, never the whole hidden layer (Codex R31
// VP-I03). Seen from the top: a remote 90 mm rapid along X at Y 80, a 71 mm
// rapid along X at Y 20 (line 13), then the finding — a 7 mm rapid along Y
// (line 14). The shown rapid must be the finding's own move: short AND along
// Y; the whole layer shows the 90 mm one, an off-by-one the 71 mm one.
const SECTION = Buffer.from(encode({ file: "/section.ngc", preview_schema: 10, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED.map((_, i) => (i === 4 ? 1 : 0))),   // line 7: (9,20)→(12,0)
  rapid: [[0, 80, 0], [90, 80, 0], [98, 20, 0], [98, 27, 0]], rapid_lines: [1, 2, 13, 14], rapid_seq: [1, 2, 13, 14],
  rapid_outside: new Uint8Array([0, 0, 0, 1]),
  violations: [{ line: 7, axis: "Y", value: 0, limit: 1, kind: "min" }, { line: 14, axis: "Y", value: 27, limit: 25, kind: "max" }],
  violations_total: 2 }));

test("a finding shows its own move of a hidden layer — not the layer", async ({ page, context }) => {
  test.setTimeout(90_000);
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: SECTION }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 16 }, (_, i) => i === 0 ? "(section)" : `G1 X${i} F100`).join("\n") }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: "/section.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 973, file: "/section.ngc" } });
  const next = page.locator('.scrubBar [aria-label="Next limit violation"]');
  await expect(next).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.__viewerDiag!.setViewDirection!([0, 0, 1]));
  const role = (r: string) => page.evaluate(x => window.__viewerDiag!.projectRole!(x), r);
  await expect.poll(async () => (await role("rapid"))?.length ?? 0).toBeGreaterThan(0);
  const all = (await role("rapid"))!;
  expect(Math.abs(all.dx), "with every rapid shown the longest runs along X").toBeGreaterThan(0.95);

  // Rapids off, jump to the finding on line 14 (the second finding in order).
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: false } } } } });
  await expect.poll(() => role("rapid")).toBeNull();
  await next.click();
  await expect(page.locator(".simBanner")).toBeVisible();
  await next.click();
  await expect(page.locator("[data-path-reveal]")).toHaveText("Rapids shown for this finding — hidden in Layers");
  const shown = (await role("rapid"))!;
  expect(shown, "the finding's move is shown").not.toBeNull();
  expect(Math.abs(shown.dy), "the finding's own move, along Y — not the 90 mm or the 71 mm rapid").toBeGreaterThan(0.95);
  expect(shown.length, "one short move, not the layer").toBeLessThan(all.length / 5);

  // The whole toolpath off, a finding on a feed (line 7): its move and its
  // limit mark — nothing of the rest of the path.
  await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
    el.value = "0";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: true, toolpath: false } } } } });
  await expect.poll(() => role("feed")).toBeNull();
  expect(await role("limit"), "the whole toolpath off hides its marks too").toBeNull();
  await next.click();
  await expect(page.locator("[data-path-reveal]")).toHaveText("Toolpath shown for this finding — hidden in Layers");
  // The jump lands IN the violating line's move — a point carries the line of
  // the move ending there, and the target used to be that end (read "L8").
  await expect(page.locator(".scrubBar .lineSlot")).toHaveText(/^L7\b/);
  const feed = (await role("feed"))!;
  expect(feed, "the finding's feed move is shown").not.toBeNull();
  expect(feed.length, "one move of the zigzag, not the long diagonal into it").toBeLessThan(all.length / 3);
  expect(await role("rapid"), "no rapid belongs to the feed finding's move").toBeNull();
  const mark = (await role("limit"))!;
  expect(mark, "its limit mark is shown with it").not.toBeNull();
  expect(Math.hypot(mark.x - feed.x, mark.y - feed.y), "the mark lies on the shown move").toBeLessThan(2);
});

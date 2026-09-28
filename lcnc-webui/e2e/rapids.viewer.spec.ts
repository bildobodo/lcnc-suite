import { test, expect } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// The Rapids layer and a finding on a hidden rapid (fixed viewer palette P3,
// Codex R29 VP29-04 / R30): the layer hides the rapid LINES, never the limit
// overlay on them; navigating to a finding on a hidden rapid shows the rapids
// for it and says so — without touching the stored choice; a manual scrub
// ends it, and so does the operator's own switch of the layer.
const FEED = Array.from({ length: 10 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
const PREVIEW = Buffer.from(encode({ file: "/rapids.ngc", preview_schema: 9, feed: FEED,
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

  // Again, then the operator's own switch ends it — the layer is theirs.
  await next.click();
  await expect(reveal).toHaveCount(1);
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { rapids: true } } } } });
  await expect(reveal).toHaveCount(0);
  await expect.poll(() => shown("rapid")).toBe(true);
});

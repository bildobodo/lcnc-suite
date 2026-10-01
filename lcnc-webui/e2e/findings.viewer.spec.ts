import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// A jump to a limit finding lands IN the finding and shows its move (Codex
// R32 VP-I05/I06): the first jump builds the simulation's entry move in front
// of the program and must still land on the chosen finding; a 0.1 ms
// violating move is not jumped past by a fixed nudge; a finding 5 ms after
// the one shown is "next", and "previous" comes back. The toolpath layer is
// off, so the finding's section (its move and its mark) is all the path the
// viewer draws — a wrong landing shows a wrong move or none.
async function prepare(page: Page, context: BrowserContext, o: { entry: boolean; short: boolean; close: boolean }) {
  const feed = o.short ? [[0, 0, 0], [10, 0, 0], [10, 0.01, 0], [20, 0.01, 0]] : [[0, 0, 0], [10, 0, 0], [10, 10, 0], [20, 10, 0]];
  const payload = { file: "/targets.ngc", preview_schema: 10, feed, feed_lines: [1, 6, 7, 8], feed_seq: [1, 2, 3, 4],
    feed_outside: new Uint8Array([0, 0, 1, o.close ? 1 : 0]), rapid: [],
    // the time axis (seconds, Float32 on the wire like the gateway's): L7
    // lasts 0.1 ms, or 5 ms before L8 when the two findings are close
    ...(o.short ? { feed_tcum: new Uint8Array(new Float32Array([0, 1, o.close ? 1.005 : 1.0001, 2]).buffer) } : {}),
    violations: [{ line: 7, axis: "Y", value: o.short ? 0.01 : 10, limit: o.short ? 0.005 : 5, kind: "max" },
      ...(o.close ? [{ line: 8, axis: "X", value: 20, limit: 15, kind: "max" }] : [])],
    violations_total: o.close ? 2 : 1 };
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: Buffer.from(encode(payload)) }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 10 }, (_, i) => `G1 X${i} F100`).join("\n") }));
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === "desktop")!);
  // The machine at X −100 builds a 100 mm entry move in front at sim entry.
  const x = o.entry ? -100 : 0;
  await ctl({ op: "status_delta", data: { active_file: "/targets.ngc", joint_pos: [x, 0, 0], actual_position: [x, 0, 0],
    g5x_offset: [0, 0, 0], g92_offset: [0, 0, 0], tool_offset: [0, 0, 0], rotation_xy: 0, is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 2100 + (o.entry ? 1 : 0) + (o.short ? 2 : 0) + (o.close ? 4 : 0), file: "/targets.ngc" } });
  await expect(page.locator('.scrubBar [aria-label="Next limit violation"]')).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.__viewerDiag!.setViewDirection!([0, 0, 1]));
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { toolpath: false, rapids: false } } } } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.projectRole!("feed"))).toBeNull();
}
const role = (page: Page, r: string) => page.evaluate(x => window.__viewerDiag!.projectRole!(x), r);
const line = (page: Page) => page.locator(".scrubBar .lineSlot");

for (const c of [
  { name: "no entry move (control)", entry: false, short: false, close: false },
  { name: "the first jump builds the entry move", entry: true, short: false, close: false },
  { name: "a 0.1 ms violating move on the time axis", entry: false, short: true, close: false },
  { name: "two findings 5 ms apart", entry: false, short: true, close: true },
]) {
  test(`a limit jump lands in the finding and shows its move — ${c.name}`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await prepare(page, context, c);
    const next = page.locator('.scrubBar [aria-label="Next limit violation"]');
    await next.click();
    await expect(page.locator(".simBanner")).toBeVisible();
    await expect(line(page), "the FIRST click lands on the chosen finding").toHaveText(/^L7\b/);
    await expect(page.locator("[data-path-reveal]")).toHaveText("Toolpath shown for this finding — hidden in Layers");
    const move = (await role(page, "feed"))!;
    expect(move, "the finding's own move is shown").not.toBeNull();
    // L7 runs along Y (L6 and L8 along X): a landing in a neighbour shows an X move
    expect(Math.abs(move.dy), "the move along Y — L7's own").toBeGreaterThan(0.95);
    expect(await role(page, "limit"), "its limit mark with it").not.toBeNull();
    if (c.close) {
      await next.click();
      await expect(line(page), "next reaches the finding 5 ms later").toHaveText(/^L8\b/);
      await page.locator('.scrubBar [aria-label="Previous limit violation"]').click();
      await expect(line(page), "previous comes back").toHaveText(/^L7\b/);
    }
  });
}

// The first source line spans two points (Codex R33 VP-I05): the entry move
// ends at the program's first point and carries its line, so by line number
// it was L7's "first move" — the jump sat on the entry move's start with the
// entry rapid shown. The finding is the program's move on the base track.
test("a limit on a first line of two points lands in the program's move, not on the entry move — first and second jump", async ({ page, context }) => {
  test.setTimeout(90_000);
  const payload = { file: "/first-line.ngc", preview_schema: 10, feed: [[0, 0, 0], [0, 10, 0], [10, 10, 0]],
    feed_lines: [7, 7, 8], feed_seq: [1, 2, 3], feed_outside: new Uint8Array([0, 1, 0]), rapid: [],
    violations: [{ line: 7, axis: "Y", value: 10, limit: 5, kind: "max" }], violations_total: 1 };
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: Buffer.from(encode(payload)) }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 10 }, (_, i) => `G1 X${i} F100`).join("\n") }));
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: "/first-line.ngc", joint_pos: [-100, 0, 0], actual_position: [-100, 0, 0],
    g5x_offset: [0, 0, 0], g92_offset: [0, 0, 0], tool_offset: [0, 0, 0], rotation_xy: 0, is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 2110, file: "/first-line.ngc" } });
  const next = page.locator('.scrubBar [aria-label="Next limit violation"]');
  await expect(next).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => window.__viewerDiag!.setViewDirection!([0, 0, 1]));
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { toolpath: false, rapids: false } } } } });
  await expect.poll(() => role(page, "feed")).toBeNull();
  const slider = page.locator(".scrubBar .sliderInput");
  for (const click of ["first", "second"]) {
    await next.click();
    await expect(page.locator(".simBanner")).toBeVisible();
    await expect(slider, "the entry move is 100 mm: the track runs to 120").toHaveAttribute("max", "120");
    // L7's own move, a feed (no rapid marker), behind the 100 mm entry move
    await expect(line(page), `${click} jump: L7's feed move`).toHaveText(/^L7$/);
    const at = Number(await slider.inputValue());
    expect(at, `${click} jump: past the entry move`).toBeGreaterThan(100);
    expect(at, `${click} jump: inside L7's 10 mm move`).toBeLessThan(110);
    await expect(page.locator("[data-path-reveal]")).toHaveText("Toolpath shown for this finding — hidden in Layers");
    const move = (await role(page, "feed"))!;
    expect(move, "the finding's own move is shown").not.toBeNull();
    expect(Math.abs(move.dy), "along Y — L7's move").toBeGreaterThan(0.95);
    expect(await role(page, "limit"), "its limit mark with it").not.toBeNull();
  }
});

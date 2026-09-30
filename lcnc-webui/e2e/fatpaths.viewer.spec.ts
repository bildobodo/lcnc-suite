import { test, expect } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// Part B (Codex R39, rasterisation cases): a 2 CSS px path segment that runs
// from BEHIND the camera through the near plane into the view. A screen-space
// line whose far end sits behind the camera must be trimmed at the near
// plane (LineMaterial's vertex shader) — untrimmed it turns into a triangle
// across the screen — and the chunk holding it must not be culled: its
// sphere contains the camera, the stroke is in view. Expected: a thin strip
// from the frame's edge toward the vanishing point, nothing more.
const FEED = [[-20000, 0, 0], [20000, 0, 0]];
const PREVIEW = Buffer.from(encode({ file: "/near.ngc", preview_schema: 9, feed: FEED,
  feed_lines: [1, 2], feed_seq: [1, 2], feed_outside: new Uint8Array(2), rapid: [],
  violations: [], violations_total: 0 }));
const OFF = { machine: false, bounds: false, toolpathBounds: false, groundGrid: false, tool: false, toolsetter: false,
  backplot: false, workzero: false, workplane: false, surface: false, hud: false, reachRoom: false, reachPart: false };

test("a path segment through the near plane: trimmed to a strip, never culled, never a screen-wide triangle", async ({ page, context }) => {
  test.setTimeout(60_000);
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: "G1 X-20000\nG1 X20000\n" }));
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { projection: "perspective", layers: OFF } } } });
  await ctl({ op: "status_delta", data: { active_file: "/near.ngc" } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 1201, file: "/near.ngc" } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getPathBox?.() ?? null), { timeout: 20_000 }).not.toBeNull();
  const box = (await page.evaluate(() => window.__viewerDiag!.getPathBox!()))!;
  const [y, z] = [box.min[1]!, box.min[2]!];
  const midX = (box.min[0]! + box.max[0]!) / 2;
  // In the middle of the segment, 40 beside and 10 above it, looking along +X.
  await page.evaluate(([p, t]) => window.__viewerDiag!.setCameraPose!(p!, t!),
    [[midX, y + 40, z + 10], [midX + 1000, y + 40, z + 10]]);
  const feed = await page.evaluate(() => window.__viewerDiag!.getPalette!().drawn.feed);
  const want = [1, 3, 5].map(i => parseInt(feed.slice(i, i + 2), 16));

  const canvas = page.locator(".viewerPane canvas, canvas").first();
  let count = 0, total = 0;
  // Pixels of the path's colour in a screenshot, decoded in the page.
  const measure = async () => {
    const png = (await canvas.screenshot()).toString("base64");
    const r = await page.evaluate(async ([b64, c]) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const cv = new OffscreenCanvas(img.width, img.height);
      const ctx = cv.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (Math.abs(px[i]! - c![0]!) + Math.abs(px[i + 1]! - c![1]!) + Math.abs(px[i + 2]! - c![2]!) < 40) n++;
      }
      return { n, total: img.width * img.height };
    }, [png, want] as const);
    count = r.n; total = r.total;
    return count;
  };
  await expect.poll(measure, { message: "the stroke in front of the camera is drawn (its chunk contains the camera — never culled)" }).toBeGreaterThan(50);
  expect(count / total, `a strip, not a screen-wide triangle (${count} of ${total} px)`).toBeLessThan(0.03);
});

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// Codex R45 VP-I12: the reach outlines are two-tone (a dark line, light dots
// over it) so one tone reads on any background — but the cage is thousands
// of SHORT segments, and each one restarting its dash began light: a ring of
// them read all light, invisible on the light scene. On the real XYZAC part
// reach, from above and at an angle, zoomed out and in, light and dark: the
// tone that stands off the scene shows at the middles of the short segments.
const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));
// Perspective: the zoomed view moves the camera closer (a parallel camera's
// distance changes nothing on screen).
const LAYERS = { toolsetter: false, reachRoom: false, reachPart: true, hud: false, groundGrid: false, bounds: false,
  toolpath: false, tool: false, machine: false, workzero: false, backplot: false };
const rgbOf = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** At the middle of every visible segment of at most 3 CSS px (Codex's
 *  class: wholly light before the fix), is the tone that STANDS OFF the
 *  scene there — the dark one on the light scene, the light one on the dark?
 *  Luminance over a five-pixel cross (a 1 px line lands between pixels): the
 *  darkest below / the brightest above the two tones' middle. The other tone
 *  sits near the scene's own colour and is no measure of legibility. */
async function contrastingToneAtShortSegments(page: Page, theme: "light" | "dark") {
  const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
  const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  const mid = (lum(rgbOf(drawn.reach!)) + lum(rgbOf(drawn.reachAlt!))) / 2;
  const shot = (await page.screenshot()).toString("base64");
  return page.evaluate(async ({ png, mid, theme }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(img, 0, 0);
    const rect = document.querySelector(".viewerPane canvas")!.getBoundingClientRect();
    const segs = window.__viewerDiag!.projectRoleSegments!("reachAlt")
      .filter(e => e.length <= 3 && e.x > rect.left + 3 && e.x < rect.right - 3 && e.y > rect.top + 3 && e.y < rect.bottom - 3);
    const lumAt = (x: number, y: number) => { const d = cx.getImageData(x, y, 1, 1).data; return 0.2126 * d[0]! + 0.7152 * d[1]! + 0.0722 * d[2]!; };
    let shown = 0;
    for (const e of segs) {
      const x = Math.floor(e.x), y = Math.floor(e.y);
      const ls = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => lumAt(x + dx!, y + dy!));
      if (theme === "light" ? Math.min(...ls) < mid : Math.max(...ls) > mid) shown++;
    }
    return { short: segs.length, shown, share: segs.length ? shown / segs.length : 0 };
  }, { png: shot, mid, theme });
}

test("the part reach's short segments keep both tones — from above and at an angle, zoomed, light and dark (Codex R45 VP-I12)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics, workGroup: machine.workGroup, toolGroup: machine.toolGroup,
    machine_bounds: { origin: [-250, -200, -400], size: [500, 400, 400] } } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready ? window.__viewerDiag.getAppearance?.().parts.length ?? 0 : 0),
    { timeout: 30_000 }).toBe(machine.parts.length);
  await ctl({ op: "status_delta", data: { joint_pos: [150, 0, -235, 0, 0], actual_position: [150, 0, -235, 0, 0],
    tool_number: 13, tool_length: 65, tool_table_z: 65, tool_diameter: 6, tool_offset: [0, 0, 65, 0, 0, 0, 0, 0, 0], kins_type: 0,
    joint_limits: [[-250, 250], [-200, 200], [-400, 0], [-110, 110], [-360, 360]] } });
  const failures: string[] = [];
  let measured = 0;
  for (const theme of ["light", "dark"] as const) {
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme }, viewer: { projection: "perspective", layers: LAYERS } } } });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect.poll(() => page.evaluate(() => window.__viewerDiag?.projectRoleSegments?.("reachAlt").length ?? 0),
      { timeout: 30_000, message: "the part reach is built" }).toBeGreaterThan(100);
    for (const view of ["top", "iso", "iso zoomed"] as const) {
      if (view === "top") await page.evaluate(() => window.__viewerDiag!.setView!("z+"));
      else {
        const cam = (await page.evaluate(() => window.__viewerDiag!.getCamera!()))!;
        const dist = Math.hypot(...cam.position.map((v, i) => v - cam.target[i]!));
        await page.evaluate(([d, k]) => window.__viewerDiag!.setViewDirection!([1, 2, 0.7], d! * k!), [dist, view === "iso" ? 1 : 0.5]);
      }
      await page.waitForTimeout(500);
      const t = await contrastingToneAtShortSegments(page, theme);
      const where = `${theme} ${view}: ${JSON.stringify(t)}`;
      test.info().annotations.push({ type: "reach tones", description: where });
      if (t.short < 40) continue;   // zoomed in, no segment is that short: nothing to lose
      measured++;
      // alternating tones: about half the short segments carry the standing-off tone
      if (t.share < 0.3) failures.push(`${where} — the ${theme === "light" ? "dark" : "light"} tone is missing on short segments`);
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
  expect(measured).toBeGreaterThanOrEqual(4);
});

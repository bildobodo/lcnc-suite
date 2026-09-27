import { test, expect, type Page } from "@playwright/test";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { encode } from "@msgpack/msgpack";
import { ctl, MOCK } from "./ctl";

// Design wave D8 (UI-K08, review round 6 UI-DI14): the viewer palette on a
// machine model, a DENSE and a THIN path, a selected line, limit overflow
// and the driven path, in the four themes. WebGL renders differ between
// machines (the tool dialog masks its canvas for the same reason), so the
// scenes are no pixel references: each asserts its STRUCTURE — the drawn
// colours are the theme's roles, the selected line is drawn wide (a shape
// cue besides the colour: >= 3 CSS px, segments in it, visible) — and
// attaches its image for the review by eye (the report; SCENE_OUT=<dir>
// writes them to a folder as well).
//
// Runs under `serial-viewer`: mock-global state.

const THEMES = ["light", "dark", "hc-light", "hc-dark"] as const;

function payload(kind: "dense" | "thin") {
  const feed: number[][] = [], lines: number[] = [], outside: number[] = [];
  let line = 3;
  if (kind === "dense") {
    for (let r = 0; r < 12; r++) {
      const y = -150 + r * 25;
      for (let c = 0; c <= 10; c++) {
        const x = -150 + (r % 2 === 0 ? c : 10 - c) * 38;
        feed.push([x, y, 0]); lines.push(line++); outside.push(x > 200 ? 1 : 0);
      }
    }
  } else {
    for (const p of [[-150, -150, 0], [150, -150, 0], [150, 150, 0], [-150, 150, 0]]) { feed.push(p); lines.push(line++); outside.push(0); }
  }
  return {
    lines: line,
    body: Buffer.from(encode({ file: `/${kind}.ngc`, preview_schema: 9, feed, feed_lines: lines, feed_outside: new Uint8Array(outside),
      rapid: [[0, 0, 60], [-150, -150, 60], [-150, -150, 5]], rapid_outside: new Uint8Array(3) })),
  };
}

async function loadProgram(page: Page, kind: "dense" | "thin", version: number) {
  await ctl({ op: "status_delta", data: { active_file: `/${kind}.ngc` } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version, file: `/${kind}.ngc` } });
  await expect(page.locator(".codeLine").nth(3)).toBeVisible();
}

test("the palette and the wide selection in four themes, on a model, a dense and a thin path", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  await ctl({ op: "reset" });
  const programs = { dense: payload("dense"), thin: payload("thin") };
  let current: "dense" | "thin" = "dense";
  // /preview? only — a bare /preview/ pattern also catches previewWorker-*.js.
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: programs[current].body }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: programs[current].lines + 1 }, (_, i) => i === 0 ? `(${current})` : `G1 X${i} Y${i}`).join("\n") }));
  const stl = (g: THREE.BufferGeometry) => Buffer.from(new STLExporter().parse(new THREE.Mesh(g), { binary: true }).buffer);
  await page.route("**/machine/base.stl", r => r.fulfill({ contentType: "application/octet-stream", body: stl(new THREE.BoxGeometry(500, 500, 60)) }));
  await page.route("**/machine/head.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: stl(new THREE.CylinderGeometry(40, 40, 160, 32).rotateX(Math.PI / 2)) }));
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(MOCK);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
  await ctl({ op: "setViewerInit", data: {
    units: "mm", stl_base_url: "/machine/", axes: ["X", "Y", "Z"],
    parts: [
      { id: "base", file: "base.stl", group: "root", translate: [0, 0, -40] },
      { id: "head", file: "head.stl", group: "slide", translate: [0, 0, 120] },
    ],
    groups: [{ id: "slide", parent: "root" }, { id: "tool", parent: "slide" }],
    kinematics: [{ group: "slide", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "root", toolGroup: "tool",
    machine_bounds: { origin: [-200, -200, -10], size: [400, 400, 200] },
  } });
  const token = (name: string) => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
  let version = 910;
  for (const kind of ["dense", "thin"] as const) {
    current = kind;
    await loadProgram(page, kind, version++);
    if (kind === "dense") {
      // The driven path: the tool moves along X.
      for (let i = 0; i <= 20; i++) {
        await ctl({ op: "status_delta", data: { joint_pos: [-150 + i * 10, 0, 0], actual_position: [-150 + i * 10, 0, 0] } });
        await page.waitForTimeout(30);
      }
    }
    // The selected line is the one the program is on (motion_line — a run
    // or a scrub; it lights the path behind it): mid-row on the dense path,
    // the second leg of the thin one.
    await ctl({ op: "status_delta", data: { motion_line: kind === "dense" ? 25 : 6 } });
    for (const theme of THEMES) {
      await ctl({ op: "raw", frame: { type: "settings_init", settings: { display: { theme }, viewer: { layers: { backplot: true, bounds: true } } } } });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const where = `${kind} ${theme}`;
      await expect.poll(async () => (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn.feed,
        { message: `${where}: the feed takes the theme's role` }).toBe(await token("--viewer-feed"));
      const sel = await page.evaluate(() => window.__viewerDiag!.getSelection!());
      expect(sel, `${where}: a wide selection`).not.toBeNull();
      expect(sel!.visible, `${where}: the wide selection shows`).toBe(true);
      expect(sel!.segments, `${where}: the selected line's segments are in it`).toBeGreaterThan(0);
      expect(sel!.widthPx, `${where}: wider than the 1 px path`).toBeGreaterThanOrEqual(3);
      const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
      expect(drawn.selection, `${where}: the selection's role`).toBe(await token("--viewer-selection"));
      if (kind === "dense") expect(drawn.limit, `${where}: the limit overflow's role`).toBe(await token("--viewer-limit"));
      await page.waitForTimeout(200);
      const shot = await page.locator(".viewerPane").screenshot();
      await testInfo.attach(`scene-${kind}-${theme}.png`, { body: shot, contentType: "image/png" });
      if (process.env.SCENE_OUT) await import("node:fs").then(fs => fs.writeFileSync(`${process.env.SCENE_OUT}/scene-${kind}-${theme}.png`, shot));
    }
  }
});

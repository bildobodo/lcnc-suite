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

test("the palette in four themes, on a model, a dense and a thin path — and no current line drawn", async ({ page, context }, testInfo) => {
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
    // The program is on a line (motion_line — a run or a scrub): mid-row on
    // the dense path, the second leg of the thin one. It is not drawn in 3D
    // (operator 2026-09-28): the code panel names it, the tool shows where.
    await ctl({ op: "status_delta", data: { motion_line: kind === "dense" ? 25 : 6 } });
    for (const theme of THEMES) {
      await ctl({ op: "raw", frame: { type: "settings_init", settings: { display: { theme }, viewer: { layers: { backplot: true, bounds: true } } } } });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const where = `${kind} ${theme}`;
      await expect.poll(async () => (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn.feed,
        { message: `${where}: the feed takes the theme's role` }).toBe(await token("--viewer-feed"));
      const materials = await page.evaluate(() => window.__viewerDiag!.getRoleMaterials!());
      expect(materials.filter(m => m.role.startsWith("selection")), `${where}: no current line drawn`).toEqual([]);
      expect(materials.filter(m => m.kind === "fat").map(m => m.role), `${where}: the backplot is the only screen-space line`)
        .toEqual(["backplot"]);
      const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
      if (kind === "dense") expect(drawn.limit, `${where}: the limit overflow's role`).toBe(await token("--viewer-limit"));
      await page.waitForTimeout(200);
      const shot = await page.locator(".viewerPane").screenshot();
      await testInfo.attach(`scene-${kind}-${theme}.png`, { body: shot, contentType: "image/png" });
      if (process.env.SCENE_OUT) await import("node:fs").then(fs => fs.writeFileSync(`${process.env.SCENE_OUT}/scene-${kind}-${theme}.png`, shot));
    }
  }
});

// The width ladder (viewer contrast plan, R1/E11): the pair table tells the
// backplot from the path and the limit overlay by WIDTH — path 1 px, backplot
// 2 CSS px — and that must hold in the rendered image, not only on the
// material. A top view onto a lit table: a programmed line, a line flagged
// outside the limits (the overlay), and the backplot driven between them. The
// drawn width across each line is the sum of each pixel's COVERAGE by the
// role colour against the local background (anti-aliasing counts as the
// fraction it is), in DEVICE pixels: a core WebGL line is one device pixel,
// the screen-space backplot 2 CSS px = 2 × DPR — so DPR 1 and 2 are both
// measured. A missing line reads ~0 and fails the lower bound.
const LADDER_THEMES = ["light", "dark", "hc-light", "hc-dark"] as const;

function ladderPayload() {
  // Two straight lines of the program joined by rapids (the seq numbers order
  // the streams, so the join is a rapid section, not a feed diagonal).
  const feed: number[][] = [], lines: number[] = [], seq: number[] = [], outside: number[] = [];
  let line = 3, s = 1;
  const rapid: number[][] = [], rapidLines: number[] = [], rapidSeq: number[] = [];
  for (const x of [-100, 200]) {
    if (x > 0) for (const p of [[-100, 150, 20], [200, -150, 20], [200, -150, 0]]) { rapid.push(p); rapidLines.push(line); rapidSeq.push(s++); }
    for (let i = 0; i <= 1; i++) { feed.push([x, x > 0 ? -150 + i * 300 : 150 - i * 300, 0]); lines.push(line++); seq.push(s++); outside.push(x > 150 ? 1 : 0); }
  }
  return {
    lines: line,
    body: Buffer.from(encode({ file: "/ladder.ngc", preview_schema: 9, feed, feed_lines: lines, feed_seq: seq, feed_outside: new Uint8Array(outside),
      rapid, rapid_lines: rapidLines, rapid_seq: rapidSeq, rapid_outside: new Uint8Array(rapid.length) })),
  };
}

/** In-page: the drawn width (device px) across the line through (x, y) CSS px along the unit normal (nx, ny). */
async function drawnWidth(page: Page, shot: Buffer, at: { x: number; y: number; dx: number; dy: number }, colour: string, dpr: number) {
  return page.evaluate(async ({ png, at, colour, dpr }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(img, 0, 0);
    const px = (x: number, y: number) => Array.from(cx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
    const nx = -at.dy, ny = at.dx, R = 8 * dpr;
    const cxp = at.x * dpr, cyp = at.y * dpr;
    const profile: number[][] = [];
    for (let t = -R; t <= R; t++) profile.push(px(cxp + nx * t, cyp + ny * t));
    const ends = [...profile.slice(0, 3), ...profile.slice(-3)];
    const bg = [0, 1, 2].map(i => ends.reduce((s, c) => s + c[i]!, 0) / ends.length);
    const n = parseInt(colour.slice(1), 16), role = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const d = role.map((v, i) => v - bg[i]!), dd = d.reduce((s, v) => s + v * v, 0);
    const width = profile.reduce((s, c) => s + Math.min(1, Math.max(0, c.reduce((t, v, i) => t + (v - bg[i]!) * d[i]!, 0) / dd)), 0);
    return { width, contrastSq: dd };
  }, { png: shot.toString("base64"), at, colour, dpr });
}

test("the width ladder is drawn: the path and the limit overlay 1 px, the backplot 2 CSS px — at DPR 1 and 2", async ({ browser }) => {
  test.setTimeout(240_000);
  const program = ladderPayload();
  let version = 950;
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: program.body }));
    await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
      body: Array.from({ length: program.lines + 1 }, (_, i) => i === 0 ? "(ladder)" : `G1 X${i} Y${i}`).join("\n") }));
    const stl = (g: THREE.BufferGeometry) => Buffer.from(new STLExporter().parse(new THREE.Mesh(g), { binary: true }).buffer);
    await context.route("**/machine/base.stl", r => r.fulfill({ contentType: "application/octet-stream", body: stl(new THREE.BoxGeometry(500, 500, 60)) }));
    await context.route("**/machine/head.stl", r => r.fulfill({ contentType: "application/octet-stream",
      body: stl(new THREE.CylinderGeometry(10, 10, 60, 16).rotateX(Math.PI / 2)) }));
    await ctl({ op: "reset" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(MOCK);
    await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
    await ctl({ op: "setViewerInit", data: {
      units: "mm", stl_base_url: "/machine/", axes: ["X", "Y", "Z"],
      parts: [
        { id: "base", file: "base.stl", group: "root", translate: [0, 0, -40] },
        { id: "head", file: "head.stl", group: "slideY", translate: [0, 0, 60] },
      ],
      groups: [{ id: "slideX", parent: "root" }, { id: "slideY", parent: "slideX" }, { id: "tool", parent: "slideY" }],
      kinematics: [
        { group: "slideX", joint: 0, type: "translate", direction: "x", sign: 1 },
        { group: "slideY", joint: 1, type: "translate", direction: "y", sign: 1 },
      ],
      workGroup: "root", toolGroup: "tool",
      // The bounds box and the table edge 50 mm from each line: nothing else
      // in the measured profile.
      machine_bounds: { origin: [-150, -200, -10], size: [300, 400, 200] },
    } });
    await ctl({ op: "status_delta", data: { active_file: "/ladder.ngc" } });
    await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: version++, file: "/ladder.ngc" } });
    await expect(page.locator(".codeLine").nth(3)).toBeVisible();
    // The backplot: the tool driven along Y at X 0, between the two lines.
    for (let i = 0; i <= 20; i++) {
      await ctl({ op: "status_delta", data: { joint_pos: [0, -150 + i * 15, 0], actual_position: [0, -150 + i * 15, 0] } });
      await page.waitForTimeout(30);
    }
    await page.evaluate(() => window.__viewerDiag!.setView!("top"));
    for (const theme of LADDER_THEMES) {
      await ctl({ op: "raw", frame: { type: "settings_init", settings: { display: { theme }, viewer: { layers: { backplot: true, bounds: true, hud: false } } } } });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.waitForTimeout(300);
      const where = `DPR ${dpr} ${theme}`;
      const mats = await page.evaluate(() => window.__viewerDiag!.getRoleMaterials!());
      const kindOf = (role: string) => mats.filter(m => m.role === role).map(m => `${m.kind}${m.widthPx ?? ""}`).sort().join(",");
      expect(kindOf("feed"), `${where}: the path is a 1 px line`).toBe("basic1");
      expect(kindOf("rapid"), `${where}: the rapid is dashed`).toBe("dashed1");
      expect(kindOf("limit"), `${where}: the limit overlay is a 1 px line`).toBe("basic1");
      expect(kindOf("backplot"), `${where}: the backplot is a 2 px screen-space line`).toBe("fat2");
      expect(mats.filter(m => m.kind !== "other" && (m.opacity !== 1 || m.transparent)), `${where}: every role line is opaque (its colour is its contrast)`).toEqual([]);
      const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
      const shot = await page.screenshot();
      const widths: Record<string, number> = {};
      for (const role of ["feed", "limit", "backplot"]) {
        const at = await page.evaluate(r => window.__viewerDiag!.projectRole!(r), role);
        expect(at, `${where}: a visible ${role} segment`).not.toBeNull();
        // The backplot is a trail of short segments along one straight line;
        // the program's lines are single long segments.
        if (role !== "backplot") expect(at!.length, `${where}: a ${role} segment long enough to measure across`).toBeGreaterThan(20);
        const m = await drawnWidth(page, shot, at!, drawn[role]!, dpr);
        expect(m.contrastSq, `${where}: ${role} differs from what lies behind it`).toBeGreaterThan(300);
        widths[role] = m.width;
      }
      const dump = JSON.stringify(widths);
      test.info().annotations.push({ type: `widths ${where}`, description: dump });
      for (const role of ["feed", "limit"]) {
        expect(widths[role]!, `${where}: the ${role} line is drawn ${dump}`).toBeGreaterThan(0.5);
        expect(widths[role]!, `${where}: the ${role} line is one device pixel ${dump}`).toBeLessThan(1.7);
      }
      expect(widths.backplot!, `${where}: the backplot is 2 CSS px ${dump}`).toBeGreaterThan(1.6 * dpr);
      expect(widths.backplot!, `${where}: the backplot is not wider than 2 CSS px ${dump}`).toBeLessThan(2.6 * dpr);
      await test.info().attach(`ladder-dpr${dpr}-${theme}.png`, { body: shot, contentType: "image/png" });
    }
    await context.close();
  }
});

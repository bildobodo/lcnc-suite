import { test, expect, type Page } from "@playwright/test";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { encode } from "@msgpack/msgpack";
import { ctl, MOCK } from "./ctl";
import { MACHINE_BOX_PX, TOOLPATH_BOX_PX, MACHINE_BOX_DASH_PX } from "../src/viewer/boxLines";

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

/** The viewer has BUILT this model: buildFromInit resets __viewerDiag to
 *  {ready: false} and replaces it when done — a diagnostic call or a
 *  status frame (the backplot's moves) before that lands in the old scene or
 *  in none (Codex R44 VP-I11). */
async function modelBuilt(page: Page, ids: string[]) {
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready
    ? window.__viewerDiag.getAppearance?.().parts.map(p => p.id).sort() ?? null : null),
    { message: "the viewer built the model", timeout: 20_000 }).toEqual(ids.slice().sort());
}

/** How much of `top` a pixel shows over `under` (0 = only `under`, 1 = only
 *  `top`): antialiasing mixes a line into its neighbour — a 1 px line on a
 *  pixel boundary reads half-and-half (Codex R44 VP-I11), never a full tone. */
const shareOf = (c: number[], top: number[], under: number[]) => {
  const d = top.map((v, i) => v - under[i]!);
  return c.reduce((s, v, i) => s + (v - under[i]!) * d[i]!, 0) / d.reduce((s, v) => s + v * v, 0);
};

// Codex R44 VP-I11's sample: a 1 px limit line on a pixel boundary over the
// 2 px backplot — half and half. The nearest FULL tone calls it backplot and
// failed the check; its share of the limit is a half.
test("a half-mixed pixel reads as half the limit, not as the backplot", () => {
  const [sample, limit, backplot] = [[243, 54, 128], [230, 107, 0], [255, 0, 255]];
  expect(nearestOf(sample, [["limit", limit], ["backplot", backplot]]), "the old rule's verdict").toBe("backplot");
  expect(shareOf(sample, limit, backplot)).toBeCloseTo(0.5, 1);
});

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
  await modelBuilt(page, ["base", "head"]);
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
      // Screen-space lines: every path line (part B — feed, rapid, the limit
      // overlay and the backplot, 2 CSS px) and the two two-tone boxes, a
      // dark line and its light dashes each (operator 2026-09-29).
      const fat = [...new Set(materials.filter(m => m.kind === "fat").map(m => m.role))].sort();
      const want = ["backplot", "bounds", "boundsAlt", "feed", "limit", "rapid", "toolpathBounds", "toolpathBoundsAlt"];
      expect(fat.filter(r => want.includes(r)), `${where}: the path lines and the two boxes`).toEqual(want.filter(r => kind === "dense" || r !== "limit"));
      expect(materials.filter(m => ["feed", "rapid", "limit", "backplot"].includes(m.role) && m.kind !== "fat"), `${where}: no thin path line left`).toEqual([]);
      const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
      if (kind === "dense") expect(drawn.limit, `${where}: the limit overflow's role`).toBe(await token("--viewer-limit"));
      await page.waitForTimeout(200);
      const shot = await page.locator(".viewerPane").screenshot();
      await testInfo.attach(`scene-${kind}-${theme}.png`, { body: shot, contentType: "image/png" });
      if (process.env.SCENE_OUT) await import("node:fs").then(fs => fs.writeFileSync(`${process.env.SCENE_OUT}/scene-${kind}-${theme}.png`, shot));
    }
  }
});

// The line widths (viewer contrast plan R1/E11; part B, operator 2026-09-29:
// every path line 2 CSS px) must hold in the rendered image, not only on the
// material. A top view onto a lit table: a programmed line, a line flagged
// outside the limits (the overlay), and the backplot driven between them. The
// drawn width across each line is the sum of each pixel's COVERAGE by the
// role colour against the local background (anti-aliasing counts as the
// fraction it is), in DEVICE pixels: 2 CSS px = 2 × DPR — so DPR 1 and 2 are
// both measured (a core WebGL line would read one device pixel at either).
// A missing line reads ~0 and fails the lower bound.
const LADDER_THEMES = ["light", "dark", "hc-light", "hc-dark"] as const;

function ladderPayload() {
  // Two straight lines of the program joined by rapids (the seq numbers order
  // the streams, so the join is a rapid section, not a feed diagonal).
  const feed: number[][] = [], lines: number[] = [], seq: number[] = [], outside: number[] = [];
  let line = 3, s = 1;
  const rapid: number[][] = [], rapidLines: number[] = [], rapidSeq: number[] = [];
  for (const x of [-100, 200]) {
    // The violating line (X 200) is the SHORTER one: the limit overlay draws
    // over it, so the feed is measured on the clean line at X -100.
    // The rapid leaves the first line sideways: retracing it (top view) would
    // lay its dashes over the feed that is measured.
    if (x > 0) for (const p of [[-130, -150, 20], [200, -120, 20], [200, -120, 0]]) { rapid.push(p); rapidLines.push(line); rapidSeq.push(s++); }
    for (let i = 0; i <= 1; i++) { feed.push([x, x > 0 ? -120 + i * 240 : 150 - i * 300, 0]); lines.push(line++); seq.push(s++); outside.push(x > 150 ? 1 : 0); }
  }
  return {
    lines: line,
    body: Buffer.from(encode({ file: "/ladder.ngc", preview_schema: 9, feed, feed_lines: lines, feed_seq: seq, feed_outside: new Uint8Array(outside),
      rapid, rapid_lines: rapidLines, rapid_seq: rapidSeq, rapid_outside: new Uint8Array(rapid.length) })),
  };
}

/** In-page: the pixel colours at `offsets` CSS px along the unit normal of the line through `at`. */
async function profileColours(page: Page, shot: Buffer, at: { x: number; y: number; dx: number; dy: number }, offsets: number[], dpr: number) {
  return page.evaluate(async ({ png, at, offsets, dpr }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(img, 0, 0);
    // Pixel i covers [i, i + 1): a point lies in pixel floor(x). Rounding
    // picked the neighbour for a line centred at .65 — a 65 % covered column
    // read as the other tone, and which of two equally long box edges
    // projectRole returned decided the verdict (1 run in 3 red).
    return offsets.map(o => Array.from(cx.getImageData(Math.floor((at.x - at.dy * o) * dpr), Math.floor((at.y + at.dx * o) * dpr), 1, 1).data.slice(0, 3)));
  }, { png: shot.toString("base64"), at, offsets, dpr });
}
const rgbOf = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbDist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
const nearestOf = (c: number[], named: [string, number[]][]) => named.slice().sort((a, b) => rgbDist(c, a[1]) - rgbDist(c, b[1]))[0]![0];

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

test("every path line is drawn 2 CSS px — the path, the limit overlay and the backplot, at DPR 1 and 2", async ({ browser }) => {
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
    await modelBuilt(page, ["base", "head"]);   // before the backplot's moves: they must reach the new scene
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
      const kindOf = (role: string) => mats.filter(m => m.role === role).map(m => `${m.kind}${m.widthPx ?? ""}${m.dashed ? " dashed" : ""}`).sort().join(",");
      expect(kindOf("feed"), `${where}: the path is a 2 px screen-space line`).toBe("fat2");
      expect(kindOf("rapid"), `${where}: the rapid is dashed, 2 px`).toBe("fat2 dashed");
      expect(kindOf("limit"), `${where}: the limit overlay is a 2 px line`).toBe("fat2");
      expect(kindOf("backplot"), `${where}: the backplot is a 2 px screen-space line`).toBe("fat2");
      expect(mats.filter(m => m.kind !== "other" && (m.opacity !== 1 || m.transparent)), `${where}: every role line is opaque (its colour is its contrast)`).toEqual([]);
      const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
      const shot = await page.screenshot();
      const widths: Record<string, number> = {};
      const where2: Record<string, unknown> = {};
      for (const role of ["feed", "limit", "backplot"]) {
        // The backplot at the MIDDLE of its trail: its last segment lies under
        // the head, which seen from above covers it — whole now that the
        // parallel eye no longer cuts it open at the near plane (ThreeViewer
        // _orthoEyeOutsideScene); the longest segment used to be read
        // through that cut.
        const at = role === "backplot"
          ? await page.evaluate(() => {
            const segs: { x: number; y: number; dx: number; dy: number; length: number }[] = [];
            window.__viewerDiag!.projectRoleSegments!("backplot").forEach(s => segs.push(s));
            segs.sort((a, b) => a.y - b.y);
            return segs.length ? segs[segs.length >> 1]! : null;
          })
          : await page.evaluate(r => window.__viewerDiag!.projectRole!(r), role);
        expect(at, `${where}: a visible ${role} segment`).not.toBeNull();
        // The backplot is a trail of short segments along one straight line;
        // the program's lines are single long segments.
        if (role !== "backplot") expect(at!.length, `${where}: a ${role} segment long enough to measure across`).toBeGreaterThan(20);
        where2[role] = { x: Math.round(at!.x), y: Math.round(at!.y), len: Math.round(at!.length) };
        const m = await drawnWidth(page, shot, at!, drawn[role]!, dpr);
        expect(m.contrastSq, `${where}: ${role} differs from what lies behind it`).toBeGreaterThan(300);
        widths[role] = m.width;
      }
      const dump = JSON.stringify({ widths, at: where2 });
      test.info().annotations.push({ type: `widths ${where}`, description: dump });
      for (const role of ["feed", "limit", "backplot"]) {
        expect(widths[role]!, `${where}: the ${role} line is 2 CSS px ${dump}`).toBeGreaterThan(1.6 * dpr);
        expect(widths[role]!, `${where}: the ${role} line is not wider than 2 CSS px ${dump}`).toBeLessThan(2.6 * dpr);
      }
      // The boxes (operator 2026-09-29): two-tone — a dark line and its light
      // dashes, one width, no casing. Across the machine box's edge one of its
      // tones, the scene beyond on either side.
      expect([kindOf("bounds"), kindOf("boundsAlt"), kindOf("toolpathBounds"), kindOf("toolpathBoundsAlt")], `${where}: the boxes`)
        .toEqual([`fat${MACHINE_BOX_PX}`, `fat${MACHINE_BOX_PX} dashed`, `fat${TOOLPATH_BOX_PX}`, `fat${TOOLPATH_BOX_PX} dashed`]);
      const edge = await page.evaluate(() => window.__viewerDiag!.projectRole!("bounds"));
      expect(edge, `${where}: a visible box edge`).not.toBeNull();
      const [dark, light] = [rgbOf(drawn.bounds!), rgbOf(drawn.boundsAlt!)];
      const [out1, out2] = await profileColours(page, shot, edge!, [-8, 8], dpr);
      const beyond = out1!.map((v, i) => (v + out2![i]!) / 2);
      const named: [string, number[]][] = [["dark", dark], ["light", light], ["beyond", beyond]];
      const steps = Array.from({ length: 6 * dpr + 1 }, (_, i) => -3 + i / dpr);
      const seen = (await profileColours(page, shot, edge!, steps, dpr)).map(c => nearestOf(c, named));
      const boxDump = JSON.stringify({ dark, light, beyond, seen });
      expect([seen[0], seen.at(-1)], `${where}: the scene beyond the edge ${boxDump}`).toEqual(["beyond", "beyond"]);
      expect(seen.some(n => n !== "beyond"), `${where}: the box drawn ${boxDump}`).toBe(true);
      await test.info().attach(`ladder-dpr${dpr}-${theme}.png`, { body: shot, contentType: "image/png" });
    }
    // The backplot OVER a limit violation (fixed palette P5, Codex R30): the
    // tool driven along the violating line — the finding draws over the
    // history, so the line's middle reads the limit's ochre, never only the
    // backplot's violet.
    for (let i = 0; i <= 20; i++) {
      await ctl({ op: "status_delta", data: { joint_pos: [200, -150 + i * 15, 0], actual_position: [200, -150 + i * 15, 0] } });
      await page.waitForTimeout(30);
    }
    for (const theme of ["light", "dark"] as const) {
      await ctl({ op: "raw", frame: { type: "settings_init", settings: { display: { theme }, viewer: { layers: { backplot: true, bounds: true, hud: false } } } } });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.waitForTimeout(300);
      const where = `DPR ${dpr} ${theme} backplot on the violation`;
      const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
      const at = await page.evaluate(() => window.__viewerDiag!.projectRole!("limit"));
      expect(at, `${where}: the violation line`).not.toBeNull();
      const shot = await page.screenshot();
      const samples = await profileColours(page, shot, at!, [-0.5, 0, 0.5], dpr);
      // The limit's SHARE over the backplot at the line: a limit line
      // narrower than the backplot mixes into it at a pixel boundary (1 px
      // over 2 px: half at worst); one as wide covers it at its centre.
      const mats = await page.evaluate(() => window.__viewerDiag!.getRoleMaterials!());
      const px = (role: string) => mats.find(m => m.role === role)?.widthPx ?? 1;
      const need = px("limit") >= px("backplot") ? 0.9 : 0.4;
      const shares = samples.map(c => shareOf(c, rgbOf(drawn.limit!), rgbOf(drawn.backplot!)));
      expect(Math.max(...shares), `${where}: the limit shows on top ${JSON.stringify({ samples, shares, need })}`).toBeGreaterThanOrEqual(need);
      await test.info().attach(`backplot-on-limit-dpr${dpr}-${theme}.png`, { body: shot, contentType: "image/png" });
    }
    await context.close();
  }
});

// The box edge measured ALONE (Codex R31 answer 2 — its isolated scene,
// kept as the guard; operator 2026-09-29: two-tone, no casing): everything
// but the machine box off, one edge with nothing within 8 CSS px. Across the
// edge, at several places along it, the profile is fitted pixel by pixel to
// background + ONE tone (dark or light) in quarter steps (the browser's four
// samples): nothing else is drawn near it and it covers MACHINE_BOX_PX CSS
// px. Along the edge both tones appear, in runs of MACHINE_BOX_DASH_PX CSS px
// (the dash is held in screen pixels) — in light and dark, at DPR 1 and 2.
test("the box edge alone: two tones, MACHINE_BOX_PX wide, dashes of MACHINE_BOX_DASH_PX — at DPR 1 and 2", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await ctl({ op: "reset" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(MOCK);
    await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
    await page.evaluate(() => window.__viewerDiag!.setViewDirection!([1, 2, 0.7]));
    for (const theme of ["light", "dark"] as const) {
      await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme }, viewer: { layers: {
        hud: false, bounds: true, toolpath: false, tool: false, machine: false, workzero: false, groundGrid: false } } } } });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.waitForTimeout(300);
      const where = `DPR ${dpr} ${theme}`;
      const edge = (await page.evaluate(() => window.__viewerDiag!.projectRole!("bounds")))!;
      expect(edge, `${where}: a visible box edge`).not.toBeNull();
      expect(edge.length, `${where}: an edge long enough for several dashes`).toBeGreaterThan(8 * MACHINE_BOX_DASH_PX);
      const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
      const tones = { dark: rgbOf(drawn.bounds!), light: rgbOf(drawn.boundsAlt!) };
      const shot = await page.screenshot();
      await test.info().attach(`box-edge-dpr${dpr}-${theme}.png`, { body: shot, contentType: "image/png" });
      // across the edge, at five places along it: background + one tone
      const offsets = Array.from({ length: 16 * dpr + 1 }, (_, i) => (i - 8 * dpr) / dpr);
      let cleanProfiles = 0;
      for (const t of [-0.35, -0.25, -0.15, -0.05, 0.05, 0.15, 0.25, 0.35]) {
        const at = { ...edge, x: edge.x + edge.dx * edge.length * t, y: edge.y + edge.dy * edge.length * t };
        const profile = await profileColours(page, shot, at, offsets, dpr);
        const bg = profile[0]!;
        // another edge crossing here (the far and near edges overlap in the
        // view): drawn pixels away from the line's own 2 px — not this edge's profile
        if (profile.some((px, i) => Math.abs(offsets[i]!) > 3 && rgbDist(px, bg) > 20)) continue;
        let best: { tone: string; sum: number; worst: number } | null = null;
        for (const [tone, rgb] of Object.entries(tones)) {
          const mixes = [0, 1, 2, 3, 4].map(k => ({ c: k / 4, rgb: [0, 1, 2].map(j => (k * rgb[j]! + (4 - k) * bg[j]!) / 4) }));
          let sum = 0, worst = 0;
          for (const px of profile) {
            const m = mixes.slice().sort((a, b) => rgbDist(px, a.rgb) - rgbDist(px, b.rgb))[0]!;
            sum += m.c;
            worst = Math.max(worst, ...px.map((v, j) => Math.abs(v - m.rgb[j]!)));
          }
          if (!best || worst < best.worst) best = { tone, sum, worst };
        }
        const dump = JSON.stringify({ t, best, profile });
        // at a dash boundary the pixel mixes both tones: skip it, the others decide
        if (best!.worst >= 6) continue;
        cleanProfiles++;
        expect(Math.abs(best!.sum / dpr - MACHINE_BOX_PX), `${where}: the box covers ${MACHINE_BOX_PX} CSS px ${dump}`).toBeLessThan(0.4);
      }
      // along the edge: runs of each tone, one dash long
      const along = Array.from({ length: Math.floor(edge.length * 0.8) }, (_, i) => i - Math.floor(edge.length * 0.4));
      const alongAt = { x: edge.x, y: edge.y, dx: -edge.dy, dy: edge.dx };   // profileColours samples along the normal of `at`
      const samples = await profileColours(page, shot, alongAt, along, dpr);
      const names = samples.map(c => (rgbDist(c, tones.dark) < rgbDist(c, tones.light) ? "dark" : "light"));
      const runs: number[] = [];
      let n = 1;
      for (let i = 1; i < names.length; i++) { if (names[i] === names[i - 1]) n++; else { runs.push(n); n = 1; } }
      const inner = runs.slice(1).sort((a, b) => a - b);   // the first run is cut by the window
      const median = inner[Math.floor(inner.length / 2)] ?? 0;
      const runDump = JSON.stringify({ runs, median });
      expect(new Set(names).size, `${where}: both tones along the edge ${runDump}`).toBe(2);
      expect(Math.abs(median - MACHINE_BOX_DASH_PX), `${where}: dashes of ${MACHINE_BOX_DASH_PX} CSS px ${runDump}`).toBeLessThan(MACHINE_BOX_DASH_PX * 0.3);
      expect(cleanProfiles, `${where}: clean profiles across the edge`).toBeGreaterThanOrEqual(2);
    }
    await context.close();
  }
});

// The dashes along EVERY projected box edge (Codex R44 VP-I10): a world dash
// scaled at the box's centre kept the zoom but not an edge's direction or
// depth — a Y edge read 5 px, a receding X edge under 1 px, where 10 were
// promised. Parallel and perspective, three directions (Codex's [1, 0.12,
// 0.25] among them): along the centre line of each edge long enough for six
// dashes, the distance between consecutive starts of a light dash is the
// period, 2 × MACHINE_BOX_DASH_PX CSS px (median, ±2 px).
test("box dashes hold MACHINE_BOX_DASH_PX along every projected edge — parallel and perspective, three directions", async ({ browser }) => {
  test.setTimeout(150_000);
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await ctl({ op: "reset" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(MOCK);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
  const failures: string[] = [];
  let measured = 0;
  for (const projection of ["parallel", "perspective"] as const) {
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme: "light" }, viewer: { projection, layers: {
      hud: false, bounds: true, toolpath: false, tool: false, machine: false, workzero: false, groundGrid: false, toolsetter: false } } } } });
    await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getCamera?.()?.ortho), { message: `the ${projection} camera` })
      .toBe(projection === "parallel");
    for (const dir of [[1, 2, 0.7], [1, 0.12, 0.25], [0.3, 1, 1.2]]) {
      await page.evaluate(d => window.__viewerDiag!.setViewDirection!(d), dir);
      await page.waitForTimeout(300);
      const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
      const tones = { dark: rgbOf(drawn.bounds!), light: rgbOf(drawn.boundsAlt!) };
      const edges = (await page.evaluate(() => window.__viewerDiag!.projectRoleSegments!("boundsAlt")))
        .filter(e => e.length > 6 * 2 * MACHINE_BOX_DASH_PX);
      const shot = await page.screenshot();
      for (const e of edges) {
        const where = `${projection} ${JSON.stringify(dir)} edge ${Math.round(e.length)} px at (${Math.round(e.x)}, ${Math.round(e.y)})`;
        const n = Math.floor(e.length) - 16;   // 8 px clear of each corner
        const along = Array.from({ length: n }, (_, i) => i - n / 2);
        const samples = await profileColours(page, shot, { x: e.x, y: e.y, dx: -e.dy, dy: e.dx }, along, 1);
        const cls = samples.map(c => {
          const dd = rgbDist(c, tones.dark), dl = rgbDist(c, tones.light);
          return Math.min(dd, dl) > 60 ? "o" : dd < dl ? "d" : "l";
        });
        const starts: number[] = [];
        for (let i = 1; i < cls.length; i++) if (cls[i] === "l" && cls[i - 1] !== "l") starts.push(i);
        const periods = starts.slice(1).map((s, k) => s - starts[k]!).sort((a, b) => a - b);
        const pattern = cls.join("");
        if (periods.length < 3) { failures.push(`${where}: fewer than four dashes — ${pattern}`); continue; }
        measured++;
        const median = periods[Math.floor(periods.length / 2)]!;
        if (Math.abs(median - 2 * MACHINE_BOX_DASH_PX) > 2) failures.push(`${where}: period ${median} px, want ${2 * MACHINE_BOX_DASH_PX} — ${pattern}`);
      }
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
  expect(measured, "edges measured over the six views").toBeGreaterThanOrEqual(12);
  await context.close();
});

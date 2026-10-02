import { test, expect, type Page } from "@playwright/test";
import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { encode } from "@msgpack/msgpack";
import { ctl, MOCK } from "./ctl";
import { MACHINE_BOX_PX, TOOLPATH_BOX_PX } from "../src/viewer/boxLines";

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
    body: Buffer.from(encode({ file: `/${kind}.ngc`, preview_schema: 10, feed, feed_lines: lines, feed_outside: new Uint8Array(outside),
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
    body: Buffer.from(encode({ file: "/ladder.ngc", preview_schema: 10, feed, feed_lines: lines, feed_seq: seq, feed_outside: new Uint8Array(outside),
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

/** In-page: at `n` evenly spaced points from `a` to `b` (CSS px), the
 *  DARKEST pixel within ±1.5 CSS px across the line — a 1 px line's centre is
 *  known to a pixel, and beside a light cell lies the light scene. */
async function alongDarkest(page: Page, shot: Buffer, a: { x: number; y: number }, b: { x: number; y: number }, n: number, dpr: number) {
  return page.evaluate(async ({ png, a, b, n, dpr }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(img, 0, 0);
    const len = Math.hypot(b.x - a.x, b.y - a.y), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0 : i / (n - 1);
      const x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
      // under an overlay (the cube, a button, a card) the scene is not what shows
      const top = document.elementFromPoint(x, y);
      if (!top || !(top as HTMLElement).dataset || !("viewerCanvas" in (top as HTMLElement).dataset)) { out.push(-1); continue; }
      let best = Infinity;
      for (const o of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) {
        const d = cx.getImageData(Math.floor((x + nx * o) * dpr), Math.floor((y + ny * o) * dpr), 1, 1).data;
        best = Math.min(best, 0.2126 * d[0]! + 0.7152 * d[1]! + 0.0722 * d[2]!);
      }
      out.push(best);
    }
    return out;
  }, { png: shot.toString("base64"), a, b, n, dpr });
}
/** Luminance of an sRGB triple. */
const lum = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;

// The box edge measured ALONE (Codex R31 answer 2 — its isolated scene,
// kept as the guard; operator 2026-09-29: two-tone, no casing): everything
// but the machine box off, one edge with nothing within 8 CSS px. Across the
// edge, at several places along it, the profile is fitted pixel by pixel to
// background + ONE tone (dark or light) in quarter steps (the browser's four
// samples): nothing else is drawn near it and it covers MACHINE_BOX_PX CSS
// px. Along the edge both tones appear in cells of the geometry pattern
// (package 4: 6 … 12 CSS px nominal, the hysteresis band 4.8 … 15) — in
// light and dark, at DPR 1 and 2.
test("the box edge alone: two tones, MACHINE_BOX_PX wide, cells within the pattern's band — at DPR 1 and 2", async ({ browser }) => {
  test.setTimeout(120_000);
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await ctl({ op: "reset" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(MOCK);
    await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
    // the pattern alone: the type labels (drawn on top at a corner) are their own guard
    await page.evaluate(() => window.__viewerDiag!.setBoxTypeLabelsShown!(false));
    await page.evaluate(() => window.__viewerDiag!.setViewDirection!([1, 2, 0.7]));
    for (const theme of ["light", "dark"] as const) {
      await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme }, viewer: { projection: "parallel", layers: {
        hud: false, bounds: true, toolpath: false, tool: false, machine: false, workzero: false, groundGrid: false } } } } });
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.waitForTimeout(300);
      const where = `DPR ${dpr} ${theme}`;
      const edge = (await page.evaluate(() => window.__viewerDiag!.projectRole!("bounds")))!;
      expect(edge, `${where}: a visible box edge`).not.toBeNull();
      expect(edge.length, `${where}: an edge long enough for several cells`).toBeGreaterThan(120);
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
        // at a cell boundary the pixel mixes both tones: skip it, the others decide
        if (best!.worst >= 6) continue;
        cleanProfiles++;
        expect(Math.abs(best!.sum / dpr - MACHINE_BOX_PX), `${where}: the box covers ${MACHINE_BOX_PX} CSS px ${dump}`).toBeLessThan(0.4);
      }
      // along the edge: runs of each tone, one cell long — under the
      // parallel projection every cell of an edge is equally long on screen
      const along = Array.from({ length: Math.floor(edge.length * 0.8) }, (_, i) => i - Math.floor(edge.length * 0.4));
      const alongAt = { x: edge.x, y: edge.y, dx: -edge.dy, dy: edge.dx };
      const samples = await profileColours(page, shot, alongAt, along, dpr);
      const names = samples.map(c => (rgbDist(c, tones.dark) < rgbDist(c, tones.light) ? "dark" : "light"));
      const runs: number[] = [];
      let n = 1;
      for (let i = 1; i < names.length; i++) { if (names[i] === names[i - 1]) n++; else { runs.push(n); n = 1; } }
      const inner = runs.slice(1).sort((a, b) => a - b);
      const median = inner[Math.floor(inner.length / 2)] ?? 0;
      const runDump = JSON.stringify({ runs, median });
      expect(new Set(names).size, `${where}: both tones along the edge ${runDump}`).toBe(2);
      expect(median >= 4 && median <= 16, `${where}: cells within 4.8 … 15 CSS px ${runDump}`).toBe(true);
      expect(cleanProfiles, `${where}: clean profiles across the edge`).toBeGreaterThanOrEqual(2);
    }
    await context.close();
  }
});

// The cells hang on the GEOMETRY (package 4, plan Fassungen 2–3.1, Codex
// R62–R65 — replacing R44 VP-I10's screen dash, whose dashes crawled along an
// edge as its projected length changed): along every projected box edge
// long enough to measure, each light / dark transition in the image sits at a
// world cell boundary k / N of that edge (projected, ±1.5 px), the first cell
// from the edge's fixed end dark. A zoom within a step keeps most edges' N; a
// zoom across one changes it — and the boundaries are again at k / N: the
// pattern follows the geometry, never the screen. Parallel and perspective,
// three directions.
test("the box cells hang on the geometry: every transition at a world cell boundary k / N — parallel and perspective, three directions, across a zoom", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await ctl({ op: "reset" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(MOCK);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
  // the pattern alone: the type labels (drawn on top at a corner) are their own guard
  await page.evaluate(() => window.__viewerDiag!.setBoxTypeLabelsShown!(false));
  const failures: string[] = [];
  let measured = 0;
  const LAYERS = { hud: false, bounds: true, toolpath: false, tool: false, machine: false, workzero: false, groundGrid: false, toolsetter: false, toolChange: false };
  const check = async (where: string) => {
    // the camera settles first (OrbitControls damping keeps it moving after a
    // pose or a zoom): the image and the projection must be one view
    const corners = async () => {
      const p = (await page.evaluate(() => window.__viewerDiag!.getBoundsPattern!("bounds")))!;
      return (await page.evaluate(q => window.__viewerDiag!.projectPoints!(q), p.segments.map(sg => sg.a))).map(v => (v ? [v.x, v.y] : [0, 0]));
    };
    let before = await corners();
    for (let k = 0; k < 20; k++) {
      await page.waitForTimeout(150);
      const now = await corners();
      const moved = Math.max(...now.map((c, i) => Math.hypot(c[0]! - before[i]![0]!, c[1]! - before[i]![1]!)));
      before = now;
      if (moved < 0.05) break;
    }
    const pat = (await page.evaluate(() => window.__viewerDiag!.getBoundsPattern!("bounds")))!;
    const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
    // a 1 px line mixes with the white scene: half a dark pixel reads ~130 —
    // dark below three quarters of the way to the light tone
    const ld = lum(rgbOf(drawn.bounds!)), ll = lum(rgbOf(drawn.boundsAlt!));
    const mid = ld + 0.75 * (ll - ld);
    const shot = await page.screenshot();
    // the same view without the box: whatever is dark there (an overlay over
    // the canvas, the cube, the axis triad) is not this edge's cell
    const rect = (await page.evaluate(() => window.__viewerDiag!.canvasRect!()))!;
    const ends = await page.evaluate(p => window.__viewerDiag!.projectPoints!(p), pat.segments.flatMap(sg => [sg.a, sg.b]));
    // settings_changed is the COMPLETE store: the projection rides along
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme: "light" }, viewer: { projection: proj, layers: { ...LAYERS, bounds: false } } } } });
    await page.waitForTimeout(250);
    const bare = await page.screenshot();
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme: "light" }, viewer: { projection: proj, layers: LAYERS } } } });
    await page.waitForTimeout(250);
    for (const seg of pat.segments) {
      const k = pat.segments.indexOf(seg);
      const n = pat.cells[seg.unit]!;
      const lerp = (f: number) => seg.a.map((v, i) => v + (seg.b[i]! - v) * f);
      const [pa, pb] = [ends[2 * k], ends[2 * k + 1]];
      if (!pa || !pb) continue;
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      if (len < 150) continue;
      const ux = (pb.x - pa.x) / len, uy = (pb.y - pa.y) / len;
      // the part on the canvas, 10 px in (Liang–Barsky in 2D), 6 px clear of either end
      let s0 = 6, s1 = len - 6;
      for (const [p0, d, lo, hi] of [[pa.x, ux, rect.left + 10, rect.right - 10], [pa.y, uy, rect.top + 10, rect.bottom - 10]] as const) {
        if (Math.abs(d) < 1e-9) { if (p0 < lo || p0 > hi) { s1 = -1; } continue; }
        const a1 = (lo - p0) / d, a2 = (hi - p0) / d;
        s0 = Math.max(s0, Math.min(a1, a2)); s1 = Math.min(s1, Math.max(a1, a2));
      }
      if (s1 - s0 < 120) continue;
      const bpts = await page.evaluate(p => window.__viewerDiag!.projectPoints!(p), Array.from({ length: n - 1 }, (_, i) => lerp((i + 1) / n)));
      const expected = bpts.filter(Boolean).map(p => (p!.x - pa.x) * ux + (p!.y - pa.y) * uy);
      // other edges near this one in the image (crossing it, or running
      // almost on top of it towards a shared corner): their pixels are not
      // this edge's cells — a sample within 3.5 px of another edge is out
      const others = pat.segments.map((_, m) => [ends[2 * m], ends[2 * m + 1]] as const)
        .filter((e, m) => m !== k && e[0] && e[1]) as unknown as [{ x: number; y: number }, { x: number; y: number }][];
      const nearOther = (d: number) => {
        const x = pa.x + ux * d, y = pa.y + uy * d;
        return others.some(([p, q]) => {
          const vx = q.x - p.x, vy = q.y - p.y, l2 = vx * vx + vy * vy;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - p.x) * vx + (y - p.y) * vy) / l2)) : 0;
          return Math.hypot(x - (p.x + t * vx), y - (p.y + t * vy)) < 3.5;
        });
      };
      const steps = Math.floor((s1 - s0) * 2);
      const from = { x: pa.x + ux * s0, y: pa.y + uy * s0 }, to = { x: pa.x + ux * s1, y: pa.y + uy * s1 };
      const dk = await alongDarkest(page, shot, from, to, steps, 1);
      const bg = await alongDarkest(page, bare, from, to, steps, 1);
      const pos = (i: number) => s0 + (i / (steps - 1)) * (s1 - s0);
      const cls = dk.map((v, i) => (v < 0 || nearOther(pos(i)) || bg[i]! < mid ? "x" : v < mid ? "d" : "l"));
      // runs of one class; a run under 2 px (4 samples) is a single pixel's
      // flicker inside a cell (a cell is ≥ 4.8 px) — merged into its neighbours
      const runs: { c: string; i: number; n: number }[] = [];
      for (let i = 0; i < cls.length; i++) {
        const r = runs[runs.length - 1];
        if (r && r.c === cls[i]) r.n++; else runs.push({ c: cls[i]!, i, n: 1 });
      }
      const kept = runs.filter(r => r.c === "x" || r.n >= 4);
      const observed: number[] = [];
      for (let k = 1; k < kept.length; k++) {
        const a = kept[k - 1]!, b = kept[k]!;
        if (a.c !== "x" && b.c !== "x" && a.c !== b.c && b.i === a.i + a.n) observed.push(pos(b.i) - 0.25);
      }
      const label = `${where} edge ${seg.unit} (${Math.round(len)} px, N ${n})`;
      // an edge lying on another in the image, or under an overlay, has no
      // measurable stretch: not measured (the count below asks for enough)
      if (cls.filter(c => c !== "x").length < 0.4 * cls.length) continue;
      if (observed.length < 3) { failures.push(`${label}: fewer than 3 transitions — ${cls.join("")}`); continue; }
      measured++;
      // A misplaced phase or a screen-held dash moves nearly every transition;
      // where another edge runs almost on top of this one in the image a
      // stray one can appear — at most 5 % (one at least). And the boundaries
      // themselves show: 80 % of those in the sampled stretch have a transition.
      const off = observed.filter(o => !expected.some(e => Math.abs(e - o) <= 1.5));
      if (off.length > Math.max(1, Math.floor(0.05 * observed.length))) failures.push(`${label}: ${off.length} of ${observed.length} transitions off the world cell boundaries at ${off.map(o => o.toFixed(1)).join(", ")} px (expected ${expected.slice(0, 6).map(e => e.toFixed(1)).join(", ")} …)`);
      const inRange = expected.filter(e => {
        if (e <= s0 + 2 || e >= s1 - 2) return false;
        const i = Math.round(((e - s0) / (s1 - s0)) * (steps - 1));
        return cls.slice(Math.max(0, i - 6), i + 7).every(c => c !== "x");   // only where the edge is in view
      });
      const shown = inRange.filter(e => observed.some(o => Math.abs(e - o) <= 1.5)).length;
      if (inRange.length && shown / inRange.length < 0.8) failures.push(`${label}: only ${shown} of ${inRange.length} world cell boundaries show a transition`);
      const first = cls.find(c => c !== "x");
      if (s0 === 6 && expected[0]! > 8 && cls[0] !== "x" && first !== "d") failures.push(`${label}: the first cell from the fixed end is ${first}, not dark`);
    }
    return pat.cells;
  };
  let proj: "parallel" | "perspective" = "parallel";
  for (const projection of ["parallel", "perspective"] as const) {
    proj = projection;
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme: "light" }, viewer: { projection, layers: LAYERS } } } });
    await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getCamera?.()?.ortho), { message: `the ${projection} camera` })
      .toBe(projection === "parallel");
    for (const dir of [[1, 2, 0.7], [1, 0.12, 0.25], [0.3, 1, 1.2]]) {
      await page.evaluate(d => window.__viewerDiag!.setViewDirection!(d), dir);
      const where = `${projection} ${JSON.stringify(dir)}`;
      const n0 = await check(where);
      await page.evaluate(() => window.__viewerDiag!.zoomBy!(1.05));
      const n1 = await check(`${where} ×1.05`);
      const kept = n0.filter((v, i) => v === n1[i]).length;
      if (kept < 10) failures.push(`${where}: a 5 % zoom changed ${12 - kept} of 12 steps — the hysteresis band holds within a step`);
      await page.evaluate(() => window.__viewerDiag!.zoomBy!(2.6));
      const n2 = await check(`${where} ×2.6`);
      if (!n2.some((v, i) => v >= 2 * n1[i]!)) failures.push(`${where}: a 2.6× zoom changed no step (${n1} → ${n2})`);
      await page.evaluate(() => window.__viewerDiag!.zoomBy!(1 / (1.05 * 2.6)));
    }
  }
  expect(failures, failures.join("\n")).toEqual([]);
  expect(measured, "edges measured over the views").toBeGreaterThanOrEqual(24);
  await context.close();
});

// Codex R63's near-plane case in the viewer (plan Fassung 3): an edge that
// comes from behind the eye and ends two near-plane distances in front of it,
// 11.3° off the line of sight — visible over a tiny parameter interval but
// ~100+ CSS px on screen. N comes from the VISIBLE interval (L_visible /
// (N · Δt)), so the visible piece holds many cells and shows both tones;
// without the Δt rule its N would follow the visible length alone and the
// whole piece would lie in one cell. Light and HC light (where the light
// tone is the background's white).
test("an edge cut by the near plane shows both tones on its visible part (Codex R63, plan Fassung 3)", async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await ctl({ op: "reset" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(MOCK);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
  // the pattern alone: the type labels (drawn on top at a corner) are their own guard
  await page.evaluate(() => window.__viewerDiag!.setBoxTypeLabelsShown!(false));
  for (const theme of ["light", "hc-light"] as const) {
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme }, viewer: { projection: "perspective", layers: {
      hud: false, bounds: true, toolpath: false, tool: false, machine: false, workzero: false, groundGrid: false, toolsetter: false, toolChange: false } } } } });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getCamera?.()?.ortho)).toBe(false);
    await page.evaluate(() => window.__viewerDiag!.setViewDirection!([1, 2, 0.7]));
    await page.waitForTimeout(300);
    const pat = (await page.evaluate(() => window.__viewerDiag!.getBoundsPattern!("bounds")))!;
    const seg = pat.segments.slice().sort((x, y) => Math.hypot(...y.b.map((v, i) => v - y.a[i]!)) - Math.hypot(...x.b.map((v, i) => v - x.a[i]!)))[0]!;
    const cam = (await page.evaluate(() => window.__viewerDiag!.getCamera!()))!;
    const sub = (p: number[], q: number[]) => p.map((v, i) => v - q[i]!);
    const add = (p: number[], q: number[], k = 1) => p.map((v, i) => v + q[i]! * k);
    const norm = (p: number[]) => { const l = Math.hypot(...p); return p.map(v => v / l); };
    const u = norm(sub(seg.b, seg.a));
    // a unit vector across the edge
    const ref = Math.abs(u[2]!) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const v = norm([u[1]! * ref[2]! - u[2]! * ref[1]!, u[2]! * ref[0]! - u[0]! * ref[2]!, u[0]! * ref[1]! - u[1]! * ref[0]!]);
    // the line of sight: the edge direction tilted 11.3° (R63's geometry)
    const th = Math.atan2(10.2, 51);
    const w = norm(add(u.map(x => x * Math.cos(th)), v, Math.sin(th)));
    const near = cam.near;
    const eye = add(seg.b, w, -2 * near);                         // b two near distances ahead
    const target = add(eye, w, Math.max(4 * near, 1.5 * (cam.minDistance || 0), 10));
    await page.evaluate(([e, t]) => window.__viewerDiag!.setCameraPose!(e!, t!), [eye, target]);
    await page.waitForTimeout(400);
    const after = (await page.evaluate(() => window.__viewerDiag!.getCamera!()))!;
    expect(Math.hypot(...sub(after.position, eye)), `${theme}: the eye stayed where it was put`).toBeLessThan(near * 0.05 + 1e-6);
    // the visible piece on screen: from b back towards the near plane
    const depthPt = (d: number) => add(eye, w, d);   // on the sight line; the edge point at that depth:
    const onEdge = (d: number) => { const s = (d - 2 * near) / Math.cos(th); return add(seg.b, u, s); };
    void depthPt;
    const [pb, pn] = await page.evaluate(p => window.__viewerDiag!.projectPoints!(p), [seg.b, onEdge(1.15 * near)]);
    expect(pb && pn, `${theme}: both ends of the visible piece on screen`).toBeTruthy();
    const len = Math.hypot(pn!.x - pb!.x, pn!.y - pb!.y);
    expect(len, `${theme}: the visible piece is clearly resolvable`).toBeGreaterThan(40);
    const drawn = (await page.evaluate(() => window.__viewerDiag!.getPalette!())).drawn;
    const shot = await page.screenshot();
    await test.info().attach(`near-plane-${theme}.png`, { body: shot, contentType: "image/png" });
    const ld = lum(rgbOf(drawn.bounds!)), ll = lum(rgbOf(drawn.boundsAlt!));
    const cls = (await alongDarkest(page, shot, pb!, pn!, Math.floor(len * 2), 1)).map(v => (v < ld + 0.75 * (ll - ld) ? "d" : "l"));
    const d = cls.filter(c => c === "d").length, l = cls.filter(c => c === "l").length;
    const pattern = `${cls.join("")} (cells ${pat.cells[seg.unit]} before the pose)`;
    expect(d / (d + l), `${theme}: dark cells on the visible piece ${pattern}`).toBeGreaterThan(0.15);
    expect(l / (d + l), `${theme}: light cells on the visible piece ${pattern}`).toBeGreaterThan(0.15);
  }
  await context.close();
});

/** WCAG contrast of two sRGB triples. */
const contrastOf = (a: number[], b: number[]) => {
  const rel = (c: number[]) => {
    const f = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
  };
  const [x, y] = [rel(a), rel(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** In-page: for each group of points (CSS px), the pixels of two shots — and
 *  whether the viewer canvas is what shows there (no overlay over it). */
async function pixelPairs(page: Page, shots: [Buffer, Buffer], groups: { x: number; y: number }[][]) {
  return page.evaluate(async ({ pngs, groups }) => {
    const read = async (png: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const cv = document.createElement("canvas");
      cv.width = img.width; cv.height = img.height;
      const cx = cv.getContext("2d", { willReadFrequently: true })!;
      cx.drawImage(img, 0, 0);
      return (x: number, y: number) => Array.from(cx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data.slice(0, 3));
    };
    const [a, b] = [await read(pngs[0]), await read(pngs[1])];
    return groups.map(g => g.map(p => {
      const top = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
      return { canvas: !!top?.dataset && "viewerCanvas" in top.dataset, a: a(p.x, p.y), b: b(p.x, p.y) };
    }));
  }, { pngs: [shots[0].toString("base64"), shots[1].toString("base64")], groups });
}

// Package 4 (plan Fassung 2 A'' and 3, Codex R62/R63): with ONE pattern for
// both boxes the toolpath box carries DIMENSION END MARKS — a bar across each
// end of every edge, its own contrast carrier (a light underlay under a dark
// core) — and each box a TYPE LABEL. The marks must stand off whatever lies
// behind them: at points on each arm (clear of every box edge) the most
// distinct pixel across the arm holds 3 : 1 (WCAG 1.4.11) against the SAME
// point with the bounds off — in light, dark, hc-light and hc-dark, over the
// scene's background (machine off) and over the model's surfaces (machine on,
// a view from above, so the box lies over the base). The labels stand at
// opposite corners (apart where the boxes coincide), over everything, and a
// test seam hides them for the operator's variant (i) render.
test("the toolpath box's end marks stand off the background and the model in four themes; the type labels stand apart", async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);
  await ctl({ op: "reset" });
  // a program with all three extents (a flat one has no Z edges to mark):
  // X −150 … 230 (past the window's 200 — its overflow drawn too), Y −150 … 125, Z 0 … 40
  const corners = [[-150, -150, 0], [230, -150, 0], [230, 125, 20], [-150, 125, 40], [-150, -150, 40]];
  const program = { lines: corners.length + 3, body: Buffer.from(encode({ file: "/dense.ngc", preview_schema: 10, feed: corners,
    feed_lines: corners.map((_, i) => 3 + i), feed_outside: new Uint8Array(corners.map(c => (c[0]! > 200 ? 1 : 0))),
    rapid: [[0, 0, 60], [-150, -150, 60], [-150, -150, 5]], rapid_outside: new Uint8Array(3) })) };
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: program.body }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: program.lines + 1 }, (_, i) => i === 0 ? "(dense)" : `G1 X${i} Y${i}`).join("\n") }));
  const stl = (g: THREE.BufferGeometry) => Buffer.from(new STLExporter().parse(new THREE.Mesh(g), { binary: true }).buffer);
  await page.route("**/machine/base.stl", r => r.fulfill({ contentType: "application/octet-stream", body: stl(new THREE.BoxGeometry(500, 500, 60)) }));
  await page.route("**/machine/head.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: stl(new THREE.CylinderGeometry(40, 40, 160, 32).rotateX(Math.PI / 2)) }));
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(MOCK);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready)).toBe(true);
  await ctl({ op: "setViewerInit", data: {
    units: "mm", stl_base_url: "/machine/", axes: ["X", "Y", "Z"],
    parts: [
      { id: "base", file: "base.stl", group: "root", translate: [0, 0, -40] },
      { id: "head", file: "head.stl", group: "slide", translate: [0, 0, 400] },
    ],
    groups: [{ id: "slide", parent: "root" }, { id: "tool", parent: "slide" }],
    kinematics: [{ group: "slide", joint: 0, type: "translate", direction: "x", sign: 1 }],
    workGroup: "root", toolGroup: "tool",
    machine_bounds: { origin: [-200, -200, -10], size: [400, 400, 200] },
  } });
  await modelBuilt(page, ["base", "head"]);
  await loadProgram(page, "dense", 960);
  const layers = (o: Record<string, boolean>) => ({ hud: false, toolpath: false, rapids: false, backplot: false, tool: false, workzero: false,
    groundGrid: false, toolsetter: false, toolChange: false, bounds: false, toolpathBounds: true, machine: false, ...o });
  const settle = async (theme: string, o: Record<string, boolean>) => {
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { display: { theme }, viewer: { projection: "parallel", layers: layers(o) } } } });
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await page.waitForTimeout(300);
  };
  // aimed at the box's centre from above, the box filling most of the view
  await page.evaluate(() => {
    const d = [1, -1.6, 1.1], l = Math.hypot(...d), t = [40, -12, 20];
    window.__viewerDiag!.setCameraPose!(t.map((v, i) => v + d[i]! / l * 1500), t);
    window.__viewerDiag!.zoomBy!(2.2);
  });
  await page.evaluate(() => window.__viewerDiag!.setBoxTypeLabelsShown!(false));   // the arms alone

  /** The sample points on every arm: 2.5 … 4 px from the corner, both ways,
   *  each with its across row (±1.5 px along the edge it marks — the core is
   *  2 px wide, the underlay 4), its centre 3 px clear of every other
   *  projected box edge (the row's reach + a 1 px line's antialiasing). */
  const armSamples = async () => {
    const bars = (await page.evaluate(() => window.__viewerDiag!.getBoxTicks!()))!;
    expect(bars, "the toolpath box carries its end marks").toHaveLength(24);
    const pat = (await page.evaluate(() => window.__viewerDiag!.getBoundsPattern!("toolpathBounds")))!;
    const ends = await page.evaluate(p => window.__viewerDiag!.projectPoints!(p), [
      ...bars.flatMap(b => [b.slice(0, 3), b.slice(3)]), ...pat.segments.flatMap(s => [s.a, s.b])]);
    const edges = pat.segments.map((_, i) => [ends[48 + 2 * i], ends[48 + 2 * i + 1]] as const);
    const distToSeg = (q: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2)) : 0;
      return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy);
    };
    const groups: { x: number; y: number }[][] = [], cornerOf: string[] = [];
    for (let i = 0; i < 24; i++) {
      const p0 = ends[2 * i], p1 = ends[2 * i + 1];
      if (!p0 || !p1 || !p0.inside || !p1.inside) continue;
      const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (len < 5) continue;   // an edge seen end-on has no bar to measure
      const n = { x: (p1.x - p0.x) / len, y: (p1.y - p0.y) / len }, c = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
      const own = Math.floor(i / 2);   // bar i marks edge floor(i / 2)
      const ea = edges[own]?.[0], eb = edges[own]?.[1];
      if (!ea || !eb || Math.hypot(eb.x - ea.x, eb.y - ea.y) < 40) continue;
      for (const s of [2.5, 3.25, 4]) for (const sign of [-1, 1]) {
        const q = { x: c.x + sign * s * n.x, y: c.y + sign * s * n.y };
        const clear = edges.every(([a, b], k) => k === own || !a || !b || distToSeg(q, a, b) >= 3);
        if (!clear) continue;
        groups.push([-1.5, -1, -0.5, 0, 0.5, 1, 1.5].map(o => ({ x: q.x - n.y * o, y: q.y + n.x * o })));
        cornerOf.push(`${Math.round(c.x)},${Math.round(c.y)}`);
      }
    }
    return { groups, cornerOf };
  };

  for (const theme of THEMES) {
    for (const machine of [false, true]) {
      await settle(theme, { machine });
      const { groups, cornerOf } = await armSamples();
      const marked = await page.screenshot();
      await testInfo.attach(`end-marks-${theme}-${machine ? "model" : "background"}.png`, { body: marked, contentType: "image/png" });
      if (process.env.SCENE_OUT) await import("node:fs").then(fs => fs.writeFileSync(`${process.env.SCENE_OUT}/end-marks-${theme}-${machine ? "model" : "background"}.png`, marked));
      await settle(theme, { machine, toolpathBounds: false });
      const bare = await page.screenshot();
      const px = await pixelPairs(page, [marked, bare], groups);
      // the scene's own background at each sample: is it the model behind?
      await settle(theme, { machine: false, toolpathBounds: false });
      const scene = await pixelPairs(page, [bare, await page.screenshot()], groups);
      await settle(theme, { machine });   // back, for the next pass
      let measured = 0, onModel = 0, byLight = 0, byDark = 0;
      const weak: string[] = [], corners = new Set<string>();
      px.forEach((row, gi) => {
        if (!row.every(p => p.canvas)) return;
        measured++;
        corners.add(cornerOf[gi]!);
        // the most distinct pixel across the arm, and which tone carries it
        const top = row.slice().sort((p, q) => contrastOf(q.a, q.b) - contrastOf(p.a, p.b))[0]!;
        const best = contrastOf(top.a, top.b);
        if (best < 3) weak.push(`${JSON.stringify(groups[gi]![3])} ${best.toFixed(2)} drawn ${JSON.stringify(row.map(p => p.a))} behind ${JSON.stringify(row[3]!.b)}`);
        else if (lum(top.a) > lum(top.b)) byLight++; else byDark++;
        // over the model where the bare image differs from the scene's background there
        if (machine && rgbDist(scene[gi]![3]!.a, scene[gi]![3]!.b) > 12) onModel++;
      });
      const where = `${theme} over ${machine ? "the model" : "the background"}`;
      expect(measured, `${where}: arm points measured`).toBeGreaterThanOrEqual(16);
      expect(corners.size, `${where}: corners measured`).toBeGreaterThanOrEqual(6);
      expect(weak, `${where}: every arm stands off what lies behind it (3 : 1)`).toEqual([]);
      if (machine) expect(onModel / measured, `${where}: the arms lie over the model's surfaces`).toBeGreaterThan(0.6);
      // both tones do their part: over the scene's background the underlay
      // carries the mark on a dark theme, the core on a light one (plan
      // Fassung 3, VP62-02 — ticks in the pair table alone prove nothing)
      if (!machine) expect(theme.endsWith("dark") ? byLight : byDark, `${where}: the ${theme.endsWith("dark") ? "light underlay" : "dark core"} carries the mark`).toBe(measured);
    }
  }

  // The type labels: opposite corners, over everything; the boxes made to
  // coincide (live joint limits = the program's box) keeps them apart.
  await ctl({ op: "status_delta", data: { joint_limits: [[-150, 230], [-150, 125], [0, 60]] } });
  await settle("light", { machine: true, bounds: true });
  await page.evaluate(() => window.__viewerDiag!.setBoxTypeLabelsShown!(true));
  await page.waitForTimeout(300);
  const labels = (await page.evaluate(() => window.__viewerDiag!.getBoxTypeLabels!()))!;
  expect(labels.machine?.visible && labels.program?.visible, "both type labels show").toBe(true);
  expect(labels.machine?.onTop && labels.program?.onTop, "drawn over everything").toBe(true);
  const apart = Math.hypot(labels.machine!.screen.x - labels.program!.screen.x, labels.machine!.screen.y - labels.program!.screen.y);
  expect(apart, "the labels stand apart where the boxes coincide").toBeGreaterThan(80);
  const withLabels = await page.screenshot();
  await testInfo.attach("type-labels-variant-ii.png", { body: withLabels, contentType: "image/png" });
  if (process.env.SCENE_OUT) await import("node:fs").then(fs => fs.writeFileSync(`${process.env.SCENE_OUT}/type-labels-variant-ii.png`, withLabels));
  // the text is drawn: the region right of each anchor changes when hidden
  await page.evaluate(() => window.__viewerDiag!.setBoxTypeLabelsShown!(false));
  await page.waitForTimeout(300);
  const hidden = (await page.evaluate(() => window.__viewerDiag!.getBoxTypeLabels!()))!;
  expect(hidden.machine?.visible || hidden.program?.visible, "the seam hides both").toBe(false);
  const without = await page.screenshot();
  await testInfo.attach("type-labels-variant-i.png", { body: without, contentType: "image/png" });
  if (process.env.SCENE_OUT) await import("node:fs").then(fs => fs.writeFileSync(`${process.env.SCENE_OUT}/type-labels-variant-i.png`, without));
  for (const [name, at] of [["machine", labels.machine!.screen], ["program", labels.program!.screen]] as const) {
    const pts = Array.from({ length: 60 }, (_, i) => ({ x: at.x + 8 + (i % 20) * 4, y: at.y - 8 - Math.floor(i / 20) * 4 }));
    const px = (await pixelPairs(page, [withLabels, without], [pts]))[0]!;
    expect(px.filter(p => p.canvas && rgbDist(p.a, p.b) > 40).length, `the ${name} label's text is drawn`).toBeGreaterThan(5);
  }
  // a box's label follows its layer
  await settle("light", { machine: true, bounds: false });
  await page.evaluate(() => window.__viewerDiag!.setBoxTypeLabelsShown!(true));
  const one = (await page.evaluate(() => window.__viewerDiag!.getBoxTypeLabels!()))!;
  expect([one.machine?.visible, one.program?.visible], "the machine box off: its label too").toEqual([false, true]);
  expect(one.count, "one label per box in the scene").toBe(2);
  // a rebuilt model (another viewer_init) leaves no old label behind
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/machine/", axes: ["X", "Y", "Z"],
    parts: [{ id: "base", file: "base.stl", group: "root", translate: [0, 0, -40] }],
    groups: [{ id: "tool", parent: "root" }], kinematics: [], workGroup: "root", toolGroup: "tool",
    machine_bounds: { origin: [-200, -200, -10], size: [400, 400, 200] } } });
  await modelBuilt(page, ["base"]);
  await expect.poll(async () => (await page.evaluate(() => window.__viewerDiag!.getBoxTypeLabels!()))?.count,
    { message: "after a rebuild: one label per box" }).toBe(2);
});

// P2b-F1 (Codex R449 MT449-02/03, R450 MT450-02/03, R451): the page never
// shows another program's preview or text as the active program's. The
// machine-day check found it (case c): RUNNING · PW_BIG_C.NGC with A2's path,
// code and timeline. Every frame from the active program's change to the
// adoption of its own data is watched, not only the end picture; with the
// simulation on and off; for a new program, the same path loaded again,
// A→B→A, late answers of the old load and a reconnect.
import { test, expect, type Page } from "./test";
import { encode } from "@msgpack/msgpack";
import { ctl, MOCK } from "./ctl";
import { withLimitRuns } from "./limitRuns";
import { announcement, fulfillPreview, fulfillText, loadStatus, newLoad, type Load } from "./programFixture";

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
const A2 = "(A2)\nG53 G0 Z0\nG53 G1 X150 Y450 F3000\nG53 G0 Z0\nM2\n";
const C = "(C)\nG53 G0 Z0\nG53 G1 X200 Y200 F6000\nG53 G0 Z0\nM2\n";
const TEXTS: Record<string, string> = { "/a2.ngc": A2, "/c.ngc": C };
const IDLE = 1, READING = 2, MANUAL = 1, AUTO = 2;

/** Late answers: a path's text, or the preview, held until released. */
let holdText: Record<string, Promise<void> | undefined> = {};
let holdPreview: Promise<void> | null = null;

async function ready(page: Page, o: { sim?: boolean } = {}) {
  holdText = {};
  holdPreview = null;
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("**/gcode?*", async r => {
    const path = new URL(r.request().url()).searchParams.get("path") ?? "";
    if (holdText[path]) await holdText[path];
    await fulfillText(r, { contentType: "text/plain", body: TEXTS[path] ?? "(?)\n" });
  });
  await page.route(/\/preview(\?|$)/, async r => {
    if (holdPreview) await holdPreview;
    await r.continue();      // the mock serves the asked pair
  });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  if (o.sim === false) await ctl({ op: "raw", frame: { type: "settings_init", settings: { simulation: { enabled: false } } } });
  await ctl({ op: "status_delta", data: { homed: [1, 1, 1], permissions: PERMS_ALL, interp_state: IDLE, task_mode: MANUAL } });
  await page.getByRole("tab", { name: "Program", exact: true }).click();
}

/** The status names the load, then its publication is announced. */
async function show(load: Load, version: number) {
  await ctl({ op: "status_delta", data: loadStatus(load) });
  await ctl({ op: "raw", frame: announcement(load, version) });
}
const shown = (page: Page) => page.evaluate(() => window.__viewerDiag?.getShownVersion?.() ?? null);
const code = (page: Page) => page.locator(".codeArea .codeViewer");
const note = (page: Page) => page.locator("[data-text-note]");
const hud = (page: Page) => page.locator("[data-preview-wait]");

/** Every frame from now: the file named, the code shown, the payload on
 *  screen — and what the viewer DRAWS (the scene, never the gate: P2b-F1
 *  scene, the pre-update check 2026-11-24 found A2's path drawn under C). */
type Frame = { file: string; code: string; shown: number | null; path: boolean };
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __idRec: unknown[]; __idRaf: number };
    w.__idRec = [];
    const tick = () => {
      w.__idRec.push({ file: document.querySelector(".fileName")?.textContent ?? "",
                       code: document.querySelector(".codeArea .codeViewer")?.textContent ?? "",
                       shown: window.__viewerDiag?.getShownVersion?.() ?? null,
                       path: window.__viewerDiag?.getPathBox?.() != null });
      w.__idRaf = requestAnimationFrame(tick);
    };
    tick();
  });
}
async function frames(page: Page): Promise<Frame[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __idRec: Frame[]; __idRaf: number };
    cancelAnimationFrame(w.__idRaf);
    return w.__idRec;
  });
}
/** No frame shows A2's code or payload under C's name, and no frame DRAWS a
 *  path while no preview is shown — with the positive control that the
 *  path is drawn while one is (A2's before, C's own after when given). */
function noA2UnderC(rec: Frame[], a2Version: number, cVersion?: number) {
  const bad = rec.filter(f => f.file === "c.ngc" && (f.code.includes("(A2)") || f.shown === a2Version));
  expect(bad, `${bad.length} of ${rec.length} frames showed A2 under C`).toEqual([]);
  const drawn = rec.filter(f => f.shown == null && f.path);
  expect(drawn.length, `${drawn.length} of ${rec.length} frames drew a path while no preview was shown`).toBe(0);
  expect(rec.some(f => f.shown === a2Version && f.path), "the positive control: A2's path drawn while shown").toBe(true);
  if (cVersion != null) expect(rec.some(f => f.shown === cVersion && f.path), "C's own path drawn once shown").toBe(true);
}
/** What the viewer draws of a program now: the path's world box, the path
 *  ledger's CPU and GPU bytes, the key a drawn path is vouched by, the HUD's
 *  limit line. */
async function scene(page: Page) {
  return page.evaluate(() => {
    const d = window.__viewerDiag;
    const m = d?.getPathMemory?.();
    return { box: d?.getPathBox?.() ?? null, cpu: m?.cpu.total ?? null, gpu: m?.gpu.total ?? null,
             drawn: d?.getPathBasis?.().drawn ?? null, limitLine: document.querySelectorAll(".hudMarkLimit").length };
  });
}
/** Nothing of a program drawn — what an unload leaves (the gateway's empty
 *  viewer_gcode frame). */
const NOTHING_DRAWN = { box: null, cpu: 0, gpu: 0, drawn: null, limitLine: 0 };
/** The path colour's pixels in the viewer canvas as RENDERED (a screenshot,
 *  decoded in the page — fatpaths.viewer.spec's measure). */
async function pathPixels(page: Page): Promise<number> {
  // the palette's path colour as RGB (a CSS colour, parsed by a 2D canvas)
  const want = await page.evaluate(() => {
    const css = window.__viewerDiag!.getPalette!().resolved.feed!;
    const cv = new OffscreenCanvas(1, 1), ctx = cv.getContext("2d")!;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  });
  const png = (await page.locator(".viewerPane canvas").first().screenshot()).toString("base64");
  return page.evaluate(async ([b64, c]) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const cv = new OffscreenCanvas(img.width, img.height);
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (Math.abs(px[i]! - c![0]!) + Math.abs(px[i + 1]! - c![1]!) + Math.abs(px[i + 2]! - c![2]!) < 40) n++;
    }
    return n;
  }, [png, want] as const);
}

// ── The viewer canvas as rendered (Fable on R455: hidden ≡ unloaded) ──
/** One fixed camera for every shot: whatever a program load or an unload does
 *  to the view, the comparison reads the scene, not the framing. */
const POSE = { position: [60, -160, 140], target: [60, 30, 0] };
/** The viewer's own canvas as rendered, at the fixed pose: the DOM overlays
 *  over it (the DRO card, the HUD's notes — "Preview waits…" differs between
 *  hidden and unloaded by design —, the ViewCube, the quick buttons, the
 *  scrub bar) are hidden for the shot, so only the 3D scene is compared. */
async function viewerShot(page: Page): Promise<Buffer> {
  await page.evaluate(p => window.__viewerDiag!.setCameraPose!(p.position, p.target), POSE);
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  return page.locator(".viewerHost canvas").first().screenshot({
    style: ".viewerWrapper > :not(.viewerHost) { visibility: hidden !important; }" });
}
/** Pixels that differ between two shots (any channel, decoded in the page). */
async function pixelDiff(page: Page, a: Buffer, b: Buffer): Promise<number> {
  return page.evaluate(async ([x, y]) => {
    const px = async (b64: string) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const cv = new OffscreenCanvas(img.width, img.height), ctx = cv.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, img.width, img.height).data;
    };
    const [p, q] = [await px(x), await px(y)];
    if (p.length !== q.length) return Number.POSITIVE_INFINITY;
    let n = 0;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2] || p[i + 3] !== q[i + 3]) n++;
    }
    return n;
  }, [a.toString("base64"), b.toString("base64")] as const);
}
/** Pixels of a palette role's colour in a shot (pathPixels' measure). */
async function rolePixels(page: Page, png: Buffer, role: "feed" | "rapid" | "limit"): Promise<number> {
  return page.evaluate(async ([b64, r]) => {
    const css = (window.__viewerDiag!.getPalette!().resolved as Record<string, string>)[r]!;
    const one = new OffscreenCanvas(1, 1).getContext("2d")!;
    one.fillStyle = css;
    one.fillRect(0, 0, 1, 1);
    const c = one.getImageData(0, 0, 1, 1).data;
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const cv = new OffscreenCanvas(img.width, img.height), ctx = cv.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, img.width, img.height).data;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (Math.abs(px[i]! - c[0]!) + Math.abs(px[i + 1]! - c[1]!) + Math.abs(px[i + 2]! - c[2]!) < 40) n++;
    }
    return n;
  }, [png.toString("base64"), role] as const);
}
/** A program with every drawn class on screen: the feed, a long rapid and the
 *  limit overlay on it (rapids.viewer.spec's shape — the mock's default
 *  preview has a 5 mm rapid and no flags). */
const FEED_ALL = Array.from({ length: 10 }, (_, i) => [i * 10, i % 2 ? 60 : 0, 0]);
const PREVIEW_ALL = Buffer.from(encode(withLimitRuns({ file: "/a2.ngc", preview_schema: 11, feed: FEED_ALL,
  feed_lines: FEED_ALL.map((_, i) => i + 3), feed_seq: FEED_ALL.map((_, i) => i + 3),
  feed_outside: new Uint8Array(FEED_ALL.length),
  rapid: [[90, 60, 0], [90, 60, 20], [0, 60, 20], [150, 60, 20]], rapid_lines: [13, 14, 15, 16], rapid_seq: [13, 14, 15, 16],
  rapid_outside: new Uint8Array([0, 0, 0, 1]),
  violations: [{ line: 16, axis: "X", value: 150, limit: 100, kind: "max" }], violations_total: 1 })));

test("a new program at idle: A2's path and code never show under C; Start stays open, Edit closed", async ({ page }) => {
  await ready(page);
  const a2 = newLoad("/a2.ngc", A2);
  await show(a2, 300);
  await expect(code(page)).toContainText("(A2)");
  await expect.poll(() => shown(page)).toBe(300);
  await expect.poll(() => pathPixels(page), "the positive control: A2's path rendered").toBeGreaterThan(50);
  await record(page);
  const c = newLoad("/c.ngc", C);
  await ctl({ op: "status_delta", data: loadStatus(c), envelope: { preview_wait: {
    program_id: c.id, file: "c.ngc", reasons: ["debounce"], since_ms: 1 } } });
  await expect(page.locator(".fileName")).toHaveText("c.ngc");
  await expect.poll(() => pathPixels(page), "A2's path no longer rendered under C").toBeLessThan(5);
  await expect(note(page)).toHaveText("Text and preview wait for the machine to settle");
  await expect(hud(page)).toContainText("Preview waits for the machine to settle");
  expect(await shown(page)).toBeNull();
  // the hidden state is no load in flight: Start, Step open; the text-bound Edit closed with its reason
  await expect(page.locator('[data-control="start"]').first()).toBeEnabled();
  await page.locator(".panelHead").getByRole("button", { name: /^More/ }).first().click();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeDisabled();
  await page.keyboard.press("Tab");   // (the menu closes on its own at the next press)
  // C's own publication: shown, the words gone
  await ctl({ op: "status_delta", data: {}, envelope: { preview_wait: null } });
  await ctl({ op: "raw", frame: announcement(c, 301) });
  await expect(code(page)).toContainText("(C)");
  await expect.poll(() => shown(page)).toBe(301);
  await expect(hud(page)).toHaveCount(0);
  await expect.poll(async () => (await scene(page)).box).not.toBeNull();
  noA2UnderC(await frames(page), 300, 301);
});

for (const sim of [true, false]) {
  test(`a run started before its preview: after the run — HUD, code panel and banner (simulation ${sim ? "on" : "off"})`, async ({ page }) => {
    await ready(page, { sim });
    const a2 = newLoad("/a2.ngc", A2);
    await show(a2, 400);
    await expect(code(page)).toContainText("(A2)");
    await expect.poll(() => shown(page)).toBe(400);
    await record(page);
    const c = newLoad("/c.ngc", C);
    await ctl({ op: "status_delta", data: { ...loadStatus(c), interp_state: READING, task_mode: AUTO,
                                            permissions: { ...PERMS_ALL, pause: true, run: false } },
                envelope: { preview_wait: { program_id: c.id, file: "c.ngc", reasons: ["running"], since_ms: 1 } } });
    await expect(note(page)).toHaveText("Text and preview after the run");
    await expect(hud(page)).toContainText("Preview after the run");
    await expect(page.locator(".statusBanner")).toContainText("PREVIEW AFTER THE RUN");
    expect(await scene(page), "case (c): nothing of A2 drawn through C's run").toEqual(NOTHING_DRAWN);
    // the run ends: its parse runs — named as the program's load, the banner's addition gone
    await ctl({ op: "status_delta", data: { interp_state: IDLE, task_mode: MANUAL, permissions: PERMS_ALL },
                envelope: { preview_wait: null, preview_refresh: { reason: "discarded:mode", file: "c.ngc", program_id: c.id,
                            phase: "running", first: true, expected_ms: 1000, started_ms: 5, job: 3, queued: false, superseded: 0 } } });
    await expect(page.locator(".statusBanner")).not.toContainText("PREVIEW AFTER THE RUN");
    await expect(note(page)).toHaveText("Text and preview loading");
    await ctl({ op: "status_delta", data: {}, envelope: { preview_refresh: null } });
    await ctl({ op: "raw", frame: announcement(c, 401) });
    await expect(code(page)).toContainText("(C)");
    await expect.poll(() => shown(page)).toBe(401);
    await expect.poll(async () => (await scene(page)).box).not.toBeNull();
    noA2UnderC(await frames(page), 400, 401);
  });
}

test("the same path loaded again and A→B→A are new loads: an old publication never shows again", async ({ page }) => {
  await ready(page);
  const l1 = newLoad("/a2.ngc", A2);
  await show(l1, 500);
  await expect.poll(() => shown(page)).toBe(500);
  expect((await scene(page)).box, "the positive control: the path drawn").not.toBeNull();
  const l2 = newLoad("/a2.ngc", A2);                   // the same path again
  await ctl({ op: "status_delta", data: loadStatus(l2) });
  await expect.poll(() => shown(page)).toBeNull();
  await expect(code(page)).toHaveCount(0);
  expect(await scene(page), "the same path reloaded: nothing of the old load drawn").toEqual(NOTHING_DRAWN);
  await ctl({ op: "raw", frame: announcement(l2, 501) });
  await expect.poll(() => shown(page)).toBe(501);
  await expect(code(page)).toContainText("(A2)");
  const b = newLoad("/c.ngc", C);
  await ctl({ op: "status_delta", data: loadStatus(b) });
  await expect.poll(() => shown(page)).toBeNull();
  expect(await scene(page), "A→B: nothing of A drawn").toEqual(NOTHING_DRAWN);
  const a3 = newLoad("/a2.ngc", A2);                   // back to A: a third load
  await ctl({ op: "status_delta", data: loadStatus(a3) });
  await page.waitForTimeout(300);
  expect(await shown(page), "501 is the second load's, not this one's").toBeNull();
  await expect(code(page)).toHaveCount(0);
  expect(await scene(page), "A→B→A: nothing of the earlier A drawn").toEqual(NOTHING_DRAWN);
  await ctl({ op: "raw", frame: announcement(a3, 502) });
  await expect.poll(() => shown(page)).toBe(502);
  await expect.poll(async () => (await scene(page)).box, "its own publication drawn").not.toBeNull();
  // hidden is drawn as an unload: the same scene as after the gateway's empty frame
  const hidden = newLoad("/c.ngc", C);
  await ctl({ op: "status_delta", data: loadStatus(hidden) });
  await expect.poll(() => shown(page)).toBeNull();
  const asHidden = await scene(page);
  expect(asHidden.drawn, "no key vouches for a drawn path").toBeNull();
  await ctl({ op: "status_delta", data: { active_file: null, program_id: null } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode", data: { file: null, feed: [], feed_lines: [], rapid: [] } } });
  await expect(page.locator(".fileName")).not.toHaveText("c.ngc");
  await expect.poll(async () => ({ ...(await scene(page)), drawn: "-" }), "hidden: the scene an unload leaves")
    .toEqual({ ...asHidden, drawn: "-" });
});

// Fable on R455 (1): hiding is destructive now (hidden is drawn as an
// unload), so the way back is guarded too: when the status names the SAME
// load again, the gate exposes its held payload again (bulkData
// `_exposeGcode`: a held payload is shown whenever its identity is the
// active one) and the viewer must DRAW it again — from the payload it holds,
// nothing fetched. The blink is driven here by the status itself: the
// gateway as built never follows a null program_id with the same id
// (gateway_util LoadedProgram: a pending change ends in `_adopt_pending` — a
// new generation — or in `abandon_change`, which clears `loaded_gen`; a
// refused open is unconfirmed, never the old load again), so this pins the
// page's half of the gate's contract, not a reproduced gateway sequence.
test("the same load shown again after a blink of its identity: drawn again, as before", async ({ page }) => {
  await ready(page);
  const a2 = newLoad("/a2.ngc", A2);
  await show(a2, 900);
  await expect.poll(() => shown(page)).toBe(900);
  await expect.poll(async () => { const s = await scene(page); return s.box != null && (s.gpu ?? 0) > 0; },
                    { message: "the positive control: the path drawn and uploaded" }).toBe(true);
  await expect.poll(() => pathPixels(page), "the positive control: the path rendered").toBeGreaterThan(50);
  const before = await scene(page);
  expect(before.drawn, "a key vouches for the drawn path").not.toBeNull();
  const previews: string[] = [];
  page.on("request", r => { if (/\/preview\?/.test(r.url())) previews.push(r.url()); });
  // the blink: no program proven for a moment — the load itself unchanged
  await ctl({ op: "status_delta", data: { program_id: null } });
  await expect.poll(() => shown(page)).toBeNull();
  expect(await scene(page), "the blink hid the path (the return's positive control)").toEqual(NOTHING_DRAWN);
  await expect.poll(() => pathPixels(page), "the blink: the path no longer rendered").toBeLessThan(5);
  // the same load with the same identity again
  await ctl({ op: "status_delta", data: loadStatus(a2) });
  await expect.poll(() => shown(page)).toBe(900);
  await expect.poll(() => scene(page), { message: "shown again: drawn again, as before the blink" }).toEqual(before);
  await expect.poll(() => pathPixels(page), "shown again: the path rendered again").toBeGreaterThan(50);
  expect(previews, "drawn from the held payload: nothing fetched").toEqual([]);
});

// Fable on R455 (2): hidden is drawn AS an unload — the whole viewer canvas
// as rendered, not only the path's green: the rapids, the limit overlay, a
// tint or mark anything leaves behind. The reference is a REAL unload frame
// from a drawn program (what an unload leaves of a drawn program — residue
// both would leave is not hidden by starting from a cleared scene); then the
// program is drawn again and hidden by another load. The comparison is
// pixel-exact: the same state rendered twice is pixel-identical here (the
// determinism control), so any differing pixel is a difference of the scene.
test("hidden is drawn as an unload: the viewer canvas pixel for pixel", async ({ page }) => {
  await ready(page);
  await page.route(/\/preview(\?|$)/, r => fulfillPreview(r, { contentType: "application/octet-stream", body: PREVIEW_ALL }));
  const drawnOnce = async (load: Load, version: number) => {
    await show(load, version);
    await expect.poll(() => shown(page)).toBe(version);
    await expect.poll(async () => { const s = await scene(page); return s.box != null && (s.gpu ?? 0) > 0 && s.limitLine > 0; },
                      { message: "the program drawn, uploaded and its limit named" }).toBe(true);
  };
  await drawnOnce(newLoad("/a2.ngc", A2), 950);
  const drawn = await viewerShot(page);
  expect(await pixelDiff(page, drawn, await viewerShot(page)), "the determinism control: the same state twice").toBe(0);
  for (const role of ["feed", "rapid", "limit"] as const)
    expect(await rolePixels(page, drawn, role), `the positive control: the ${role} on screen`).toBeGreaterThan(20);
  // the reference: a real unload of the drawn program (the gateway's empty frame)
  await ctl({ op: "status_delta", data: { active_file: null, program_id: null } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode", data: { file: null, feed: [], feed_lines: [], rapid: [] } } });
  await expect.poll(async () => (await scene(page)).box, "unloaded").toBeNull();
  expect(await shown(page)).toBeNull();
  const unloaded = await viewerShot(page);
  expect(await pixelDiff(page, drawn, unloaded), "the positive control: the comparison sees the drawn program")
    .toBeGreaterThan(500);
  // drawn again, then hidden: another program active, none of its own shown
  await drawnOnce(newLoad("/a2.ngc", A2), 951);
  await ctl({ op: "status_delta", data: loadStatus(newLoad("/c.ngc", C)) });
  await expect.poll(() => shown(page)).toBeNull();
  await expect.poll(async () => pixelDiff(page, await viewerShot(page), unloaded),
                    { message: "the hidden canvas is the unloaded canvas, pixel for pixel" }).toBe(0);
});

test("late answers of the old load — text and decode — never show under the new one", async ({ page }) => {
  await ready(page);
  let releaseText!: () => void, releasePreview!: () => void;
  holdText["/a2.ngc"] = new Promise<void>(r => { releaseText = r; });
  holdPreview = new Promise<void>(r => { releasePreview = r; });
  const a2 = newLoad("/a2.ngc", A2);
  await show(a2, 600);
  await page.waitForTimeout(200);                      // both answers out, held
  await record(page);
  const c = newLoad("/c.ngc", C);
  await ctl({ op: "status_delta", data: loadStatus(c) });
  await expect(page.locator(".fileName")).toHaveText("c.ngc");
  releaseText();
  releasePreview();
  await page.waitForTimeout(800);
  expect(await shown(page)).toBeNull();
  await expect(code(page)).toHaveCount(0);
  expect(await scene(page), "the old load's late decode draws nothing").toEqual(NOTHING_DRAWN);
  const rec = await frames(page);
  expect(rec.filter(f => f.path).length, "no frame drew the late decode").toBe(0);
});

test("a reconnect: unchanged, the view stays; another load meanwhile hides it from the first status", async ({ page }) => {
  await ready(page);
  const a2 = newLoad("/a2.ngc", A2);
  await show(a2, 700);
  await expect.poll(() => shown(page)).toBe(700);
  const previews: string[] = [];
  page.on("request", r => { if (/\/preview\?/.test(r.url())) previews.push(r.url()); });
  await ctl({ op: "shutdownClose" });
  await expect(page.locator(".pill").filter({ hasText: "WS connected" })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(500);
  expect(await shown(page), "unchanged identity and version: the view stays").toBe(700);
  expect(previews, "nothing fetched again").toEqual([]);
  expect((await scene(page)).box, "and its path stays drawn").not.toBeNull();
  // gone, a second client loads C meanwhile, back
  await ctl({ op: "refuseWs", on: true });
  await ctl({ op: "shutdownClose" });
  const c = newLoad("/c.ngc", C);
  await ctl({ op: "status_delta", data: loadStatus(c) });
  await ctl({ op: "refuseWs", on: false });
  await expect(page.locator(".fileName")).toHaveText("c.ngc", { timeout: 20_000 });
  await expect.poll(() => shown(page)).toBeNull();
  await expect(code(page)).toHaveCount(0);
  expect(await scene(page), "another load meanwhile: nothing of A2 drawn").toEqual(NOTHING_DRAWN);
});

test("the editor's session is its load: another load of the same path is a conflict, the buffer kept", async ({ page }) => {
  await ready(page);
  await ctl({ op: "status_delta", armed: true, data: {} });
  const l1 = newLoad("/a2.ngc", A2);
  await show(l1, 800);
  await expect(code(page)).toContainText("(A2)");
  await page.locator(".panelHead").getByRole("button", { name: /^More/ }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("(A2)");
  await expect(page.locator("[data-edit-conflict]")).toHaveCount(0);
  // another client loads the same path again: not the editor's load session
  const l2 = newLoad("/a2.ngc", A2);
  await ctl({ op: "status_delta", data: loadStatus(l2) });
  await expect(page.locator("[data-edit-conflict]")).toBeVisible();
  await expect(editor, "the buffer stays").toContainText("(A2)");
});

// Codex R452 MT-I30: the session's own reload is the session's load in
// EITHER order of its reply and the status that shows it; only the session
// that asked takes it, only for the load its reply named.
/** A session on `l1` saves; the operator types on while the save is in
 *  flight; the session's own reload goes out, its reply held. */
async function saveWhileTyping(page: Page, l1: Load, version: number) {
  await ctl({ op: "status_delta", armed: true, data: {} });
  await ctl({ op: "replyFor", cmd: "load_file", reply: "silent" });
  await show(l1, version);
  await expect(code(page)).toContainText("(A2)");
  await page.locator(".panelHead").getByRole("button", { name: /^More/ }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("(A2)");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("(save1)");
  let release!: () => void;
  let arrived!: () => void;
  const gotSave = new Promise<void>(r => { arrived = r; });
  const saveGate = new Promise<void>(r => { release = r; });
  await page.route("**/save?*", async route => {
    arrived();
    await saveGate;
    await route.fulfill({ json: { ok: true, path: l1.file, size: 1 } });
  });
  await ctl({ op: "clearCmds" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await gotSave;
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("(newer draft)");
  release();
  let req: { req_id?: string } | undefined;
  await expect.poll(async () => {
    const r = await ctl({ op: "lastCmds" }) as { cmds?: { cmd: string; req_id?: string }[] };
    req = r.cmds?.find(c => c.cmd === "load_file");
    return !!req?.req_id;
  }).toBe(true);
  const reply = (load: Load) => ctl({ op: "raw", frame: { type: "reply", cmd: "load_file", req_id: req!.req_id,
                                                           ok: true, path: l1.file, program_id: load.id } });
  return { editor, reply };
}
const conflict = (page: Page) => page.locator("[data-edit-conflict]");

for (const order of ["reply-first", "status-first"] as const) {
  test(`the session's own reload is its load, ${order}`, async ({ page }) => {
    await ready(page);
    const l1 = newLoad("/a2.ngc", A2);
    const { editor, reply } = await saveWhileTyping(page, l1, 810);
    const l2 = newLoad("/a2.ngc", A2);      // the reload's load
    if (order === "reply-first") {
      await reply(l2);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      await ctl({ op: "status_delta", data: loadStatus(l2) });
    } else {
      await ctl({ op: "status_delta", data: loadStatus(l2) });
      await expect(conflict(page), "before its reply the load is not yet known as the session's").toBeVisible();
      await reply(l2);
      await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
      // another delivered status of the SAME identity changes nothing
      await ctl({ op: "status_delta", data: loadStatus(l2) });
    }
    await expect(editor, "the newer draft stays").toContainText("(newer draft)");
    await expect(conflict(page), "the own reload is not a foreign program change").toHaveCount(0);
    // the session's LOAD moved too (R452): the next save completes as the
    // own program's — the session ends, nothing is said to be foreign
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".cm-content"), "the own load is the session's: the next save ends the session").toHaveCount(0);
  });
}

test("a foreign load shown before the own reload's reply stays a conflict", async ({ page }) => {
  await ready(page);
  const l1 = newLoad("/a2.ngc", A2);
  const { editor, reply } = await saveWhileTyping(page, l1, 820);
  const l2 = newLoad("/a2.ngc", A2);        // the reload's load ...
  const l3 = newLoad("/a2.ngc", A2);        // ... and another client's load after it
  await ctl({ op: "status_delta", data: loadStatus(l3) });
  await expect(conflict(page)).toBeVisible();
  await reply(l2);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await ctl({ op: "status_delta", data: loadStatus(l3) });
  await expect(conflict(page), "a foreign load is never the session's by an old reply").toBeVisible();
  await expect(editor, "the buffer stays").toContainText("(newer draft)");
});

test("a session opened after the own reload's reply does not take that load", async ({ page }) => {
  await ready(page);
  const l1 = newLoad("/a2.ngc", A2);
  const { reply } = await saveWhileTyping(page, l1, 830);
  const l2 = newLoad("/a2.ngc", A2);
  await reply(l2);                          // the reply first: the old session's
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.locator(".editActions").getByRole("button", { name: "Discard", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.locator(".cm-content")).toHaveCount(0);
  // a new session on the text on screen (still l1's)
  await page.locator(".panelHead").getByRole("button", { name: /^More/ }).first().click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("(A2)");
  await ctl({ op: "status_delta", data: loadStatus(l2) });
  await expect(conflict(page), "a new session never takes an old session's reply").toBeVisible();
});

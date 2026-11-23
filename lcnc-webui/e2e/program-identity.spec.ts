// P2b-F1 (Codex R449 MT449-02/03, R450 MT450-02/03, R451): the page never
// shows another program's preview or text as the active program's. The
// machine-day check found it (case c): RUNNING · PW_BIG_C.NGC with A2's path,
// code and timeline. Every frame from the active program's change to the
// adoption of its own data is watched, not only the end picture; with the
// simulation on and off; for a new program, the same path loaded again,
// A→B→A, late answers of the old load and a reconnect.
import { test, expect, type Page } from "./test";
import { ctl, MOCK } from "./ctl";
import { announcement, fulfillText, loadStatus, newLoad, type Load } from "./programFixture";

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

/** Every frame from now: the file named, the code shown, the payload on screen. */
async function record(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __idRec: unknown[]; __idRaf: number; __viewerDiag?: { getShownVersion?: () => number | null } };
    w.__idRec = [];
    const tick = () => {
      w.__idRec.push({ file: document.querySelector(".fileName")?.textContent ?? "",
                       code: document.querySelector(".codeArea .codeViewer")?.textContent ?? "",
                       shown: w.__viewerDiag?.getShownVersion?.() ?? null });
      w.__idRaf = requestAnimationFrame(tick);
    };
    tick();
  });
}
async function frames(page: Page): Promise<{ file: string; code: string; shown: number | null }[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __idRec: { file: string; code: string; shown: number | null }[]; __idRaf: number };
    cancelAnimationFrame(w.__idRaf);
    return w.__idRec;
  });
}
/** No frame shows A2's code or payload under C's name. */
function noA2UnderC(rec: { file: string; code: string; shown: number | null }[], a2Version: number) {
  const bad = rec.filter(f => f.file === "c.ngc" && (f.code.includes("(A2)") || f.shown === a2Version));
  expect(bad, `${bad.length} of ${rec.length} frames showed A2 under C`).toEqual([]);
}

test("a new program at idle: A2's path and code never show under C; Start stays open, Edit closed", async ({ page }) => {
  await ready(page);
  const a2 = newLoad("/a2.ngc", A2);
  await show(a2, 300);
  await expect(code(page)).toContainText("(A2)");
  await expect.poll(() => shown(page)).toBe(300);
  await record(page);
  const c = newLoad("/c.ngc", C);
  await ctl({ op: "status_delta", data: loadStatus(c), envelope: { preview_wait: {
    program_id: c.id, file: "c.ngc", reasons: ["debounce"], since_ms: 1 } } });
  await expect(page.locator(".fileName")).toHaveText("c.ngc");
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
  noA2UnderC(await frames(page), 300);
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
    noA2UnderC(await frames(page), 400);
  });
}

test("the same path loaded again and A→B→A are new loads: an old publication never shows again", async ({ page }) => {
  await ready(page);
  const l1 = newLoad("/a2.ngc", A2);
  await show(l1, 500);
  await expect.poll(() => shown(page)).toBe(500);
  const l2 = newLoad("/a2.ngc", A2);                   // the same path again
  await ctl({ op: "status_delta", data: loadStatus(l2) });
  await expect.poll(() => shown(page)).toBeNull();
  await expect(code(page)).toHaveCount(0);
  await ctl({ op: "raw", frame: announcement(l2, 501) });
  await expect.poll(() => shown(page)).toBe(501);
  await expect(code(page)).toContainText("(A2)");
  const b = newLoad("/c.ngc", C);
  await ctl({ op: "status_delta", data: loadStatus(b) });
  await expect.poll(() => shown(page)).toBeNull();
  const a3 = newLoad("/a2.ngc", A2);                   // back to A: a third load
  await ctl({ op: "status_delta", data: loadStatus(a3) });
  await page.waitForTimeout(300);
  expect(await shown(page), "501 is the second load's, not this one's").toBeNull();
  await expect(code(page)).toHaveCount(0);
  await ctl({ op: "raw", frame: announcement(a3, 502) });
  await expect.poll(() => shown(page)).toBe(502);
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
  noA2UnderC(await frames(page), 600);
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
  // gone, a second client loads C meanwhile, back
  await ctl({ op: "refuseWs", on: true });
  await ctl({ op: "shutdownClose" });
  const c = newLoad("/c.ngc", C);
  await ctl({ op: "status_delta", data: loadStatus(c) });
  await ctl({ op: "refuseWs", on: false });
  await expect(page.locator(".fileName")).toHaveText("c.ngc", { timeout: 20_000 });
  await expect.poll(() => shown(page)).toBeNull();
  await expect(code(page)).toHaveCount(0);
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

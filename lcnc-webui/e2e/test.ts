// Every spec's `test` (per-worker mock, Codex R261/R262): Playwright's, with
// its own fixtures below. Specs import { test, expect, … } from "./test",
// never from "@playwright/test" (a guard holds it).
//
//  mock          (worker) — this worker's own mock gateway on its slot
//                (mockFixture.ts); the slot must be the worker's parallel
//                index, the address ctl.ts bound at import must be its port.
//  mockBaseline  (test)   — before every test, the confirmed baseline: no app
//                socket left from the test before, then `reset`, then the
//                mock's WHOLE snapshot equal to the one it had when it
//                started, and a fresh app client's connect frames (read off
//                the wire) equal to the ones it got then (Codex R263
//                PM263-01: a key the snapshot did not name once survived).
//                After the test, every context left open is closed (a
//                failing test's own contexts included), THEN `test-end` is
//                written (FI265-02: the observation ends after the last
//                context). A mock that died fails the test.
//  storageState  (test)   — the replay's origin (test strategy step 5,
//                Codex R251 TS248-04 Rest B): the cookie `e2e_origin` with
//                this run, the test's id, project and retry, for the mock's
//                host. Playwright applies the test's context options to the
//                `page` fixture's context AND to every `browser.newContext()`
//                inside the test, so each connection the page or a context
//                opens carries its test attempt — the mock binds it at the
//                upgrade (e2e/mock-gateway.mjs).
//  page          (test)   — in Firefox (the pinned core, plan vor-maschine
//                R385): every touch call throws (silent under BiDi) and the
//                page is unloaded before its context closes (Firefox sends
//                the unload beacons of a page closed WITH its context without
//                the cookie).
//  browserPin    (worker) — the started browser's own version in the event
//                log; in Firefox it must be the pinned one.
import { relative } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { appConnectFrames, ctl, MOCK } from "./ctl";
import { logEvent, RUN, startMock, stopMock, type MockHandle } from "./mockFixture";
import { portOf, slotOf } from "./mockSlot.mjs";

export * from "@playwright/test";

type Snapshot = Record<string, unknown>;
const snapshot = async (): Promise<Snapshot> => ((await ctl({ op: "snapshot" })) as { snapshot: Snapshot }).snapshot;

const noAppSockets = (why: string) => expect.poll(async () => (await snapshot()).clients,
  { timeout: 5_000, message: why }).toBe(0);
type Wire = Awaited<ReturnType<typeof appConnectFrames>>;

/** The replay's origin of one test attempt, as the cookie carries it. */
export interface ReplayOrigin { run: string; test: string; project: string; retry: number }
export const ORIGIN_COOKIE = "e2e_origin";

/** Touch under WebDriver BiDi is a SILENT no-op: `tap()` and
 *  `touchscreen.tap()` resolve and the page receives no event at all, not
 *  even a click (Firefox 159 and 160, plan vor-maschine R385 finding 2). In
 *  Firefox every touch call throws, so a tap reached through a shared helper
 *  (more.ts `tapMore`) is red, never a green press that never happened. */
export const TOUCH_UNDER_BIDI = "touch is a silent no-op under WebDriver BiDi — the Firefox core uses mouse and keyboard (R385)";

async function forbidTouch(page: Page): Promise<void> {
  const refuse = () => { throw new Error(TOUCH_UNDER_BIDI); };
  const html = page.locator("html");
  for (const proto of [Object.getPrototypeOf(html), Object.getPrototypeOf(page), Object.getPrototypeOf(page.touchscreen)])
    Object.defineProperty(proto, "tap", { value: refuse, configurable: true, writable: true });
  const handle = (await page.evaluateHandle(() => document.documentElement)).asElement();
  if (handle) {
    Object.defineProperty(Object.getPrototypeOf(handle), "tap", { value: refuse, configurable: true, writable: true });
    await handle.dispose();
  }
}

export const test = base.extend<{ mockBaseline: void }, { mock: MockHandle & { pristine: Snapshot; pristineWire: Wire }; browserPin: void }>({
  // Firefox (the pinned core, R385): no touch — the context options carry
  // none, every touch call throws; and the page is UNLOADED while its
  // context lives. Firefox sends a page's unload beacons (telemetry, the
  // settings page-hide flush) without the context's cookies when the context
  // closes under a loaded page — the replay would see them without their
  // test attempt (measured 2026-11-16; Chromium sends them with it, and a
  // page navigated away inside its context sends them with it in both).
  page: async ({ page, browserName }, use, testInfo) => {
    if (browserName === "firefox") {
      if (testInfo.project.use.hasTouch) throw new Error(TOUCH_UNDER_BIDI);
      await forbidTouch(page);
    }
    await use(page);
    if (browserName === "firefox") await page.goto("about:blank").catch(() => {});
  },

  // The browser that runs is the one asked for (Codex R385): its own
  // version, read from the started browser, against the pin the Firefox
  // config names (LCNC_FIREFOX_VERSION) — a cached path proves no version.
  // Every worker writes it to the event log; the gate reads it there.
  browserPin: [async ({ browser, browserName }, use, workerInfo) => {
    const version = browser.version();
    const pinned = browserName === "firefox" ? process.env.LCNC_FIREFOX_VERSION : undefined;
    logEvent({ event: "browser", name: browserName, version, pinned: pinned ?? null, workerIndex: workerInfo.workerIndex });
    if (pinned !== undefined && version !== pinned)
      throw new Error(`the started Firefox is ${version}, the pin names ${pinned}`);
    await use();
  }, { scope: "worker", auto: true }],

  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern
  storageState: async ({}, use, testInfo) => {
    const origin: ReplayOrigin = { run: RUN, test: testInfo.testId, project: testInfo.project.name, retry: testInfo.retry };
    await use({
      cookies: [{ name: ORIGIN_COOKIE, value: encodeURIComponent(JSON.stringify(origin)), domain: new URL(MOCK).hostname,
                  path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }],
      origins: [],
    });
  },

  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern
  mock: [async ({}, use, workerInfo) => {
    const slot = slotOf(process.env.TEST_PARALLEL_INDEX);
    if (slot === null || slot !== workerInfo.parallelIndex)
      throw new Error(`worker slot ${process.env.TEST_PARALLEL_INDEX} is not the parallel index ${workerInfo.parallelIndex}`);
    if (MOCK !== `http://localhost:${portOf(slot)}/`)
      throw new Error(`ctl.ts bound ${MOCK}, the worker's slot is port ${portOf(slot)}`);
    const handle = await startMock(slot, workerInfo.workerIndex);
    const pristine = await snapshot();
    const pristineWire = await appConnectFrames();
    await noAppSockets("the pristine read's fresh client");
    try {
      await use({ ...handle, pristine, pristineWire });
    } finally {
      await stopMock(handle);
    }
  }, { scope: "worker", auto: true }],

  mockBaseline: [async ({ mock, browser }, use, testInfo) => {
    const where = { slot: mock.slot, workerIndex: mock.workerIndex, instance: mock.instance,
      file: relative(testInfo.project.testDir, testInfo.file), project: testInfo.project.name,
      title: testInfo.titlePath.slice(1).join(" › "), testId: testInfo.testId,
      retry: testInfo.retry };
    if (mock.died()) throw new Error(`the worker's mock ended: ${mock.died()}`);
    // the test before closed its contexts at its end; their sockets close a moment later
    await noAppSockets("app sockets left from the test before");
    await ctl({ op: "reset" });
    // what a fresh app client gets (Codex R263 PM263-01), then its socket gone on the mock's side too
    const wire = await appConnectFrames();
    await noAppSockets("the baseline's own fresh client");
    expect(await snapshot(), "the mock's baseline after reset").toEqual(mock.pristine);
    expect(wire, "a fresh app client's connect frames after reset").toEqual(mock.pristineWire);
    logEvent({ event: "test-start", ...where });
    await use();   // resolves after the test, failed or not
    for (const c of browser.contexts()) await c.close().catch(() => {});
    logEvent({ event: "test-end", ...where, status: testInfo.status });
    if (mock.died()) throw new Error(`the worker's mock ended during the test: ${mock.died()}`);
  }, { auto: true }],
});

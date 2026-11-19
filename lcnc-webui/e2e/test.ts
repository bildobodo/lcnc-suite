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
//                page is unloaded before its context closes, the context
//                closed only once EACH unload beacon reached the mock, matched
//                by its own mark (Firefox sends a beacon after the context's
//                close without the cookie; Codex R386 VM-I25).
//  context       (test)   — the browser's HTTP record (replay step 5b,
//                e2e/httpRecord.ts): every request of the page's context and
//                of every `browser.newContext()` inside the test, with its id,
//                its route actions and the context's closing mark.
//  browserPin    (worker) — the started browser's own version in the event
//                log; in Firefox it must be the pinned one, and its WebGL
//                answer is recorded beside it (none: no display, R387).
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { appConnectFrames, ctl, MOCK } from "./ctl";
import { logEvent, replayFile, RUN, startMock, stopMock, type MockHandle } from "./mockFixture";
import { portOf, slotOf } from "./mockSlot.mjs";
import { complete, parseMarks, receipts, type AttemptOrigin, type ReplayLine } from "./unloadReceipts";
import { instrument } from "./httpRecord";

export * from "@playwright/test";

type Snapshot = Record<string, unknown>;
const snapshot = async (): Promise<Snapshot> => ((await ctl({ op: "snapshot" })) as { snapshot: Snapshot }).snapshot;

const noAppSockets = (why: string) => expect.poll(async () => (await snapshot()).clients,
  { timeout: 5_000, message: why }).toBe(0);
type Wire = Awaited<ReturnType<typeof appConnectFrames>>;

/** The replay's origin of one test attempt, as the cookie carries it. */
export interface ReplayOrigin { run: string; test: string; project: string; retry: number }
const originOf = (testInfo: TestInfo): ReplayOrigin =>
  ({ run: RUN, test: testInfo.testId, project: testInfo.project.name, retry: testInfo.retry });
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
  for (const proto of [Object.getPrototypeOf(html), Object.getPrototypeOf(page), Object.getPrototypeOf(page.mainFrame()),
                       Object.getPrototypeOf(page.touchscreen)])
    Object.defineProperty(proto, "tap", { value: refuse, configurable: true, writable: true });
  const handle = (await page.evaluateHandle(() => document.documentElement)).asElement();
  if (handle) {
    Object.defineProperty(Object.getPrototypeOf(handle), "tap", { value: refuse, configurable: true, writable: true });
    await handle.dispose();
  }
}

/** This mock's replay log so far, line by line. The mock appends each line
 *  with ONE write, but a reader in another process can still see that write
 *  half done (Linux reads a regular file without the writer's lock): a
 *  trailing piece with no newline yet is a line still being written and is
 *  left for the next read — a Firefox core run read one torn and failed on
 *  its JSON (strip-fit round gate, 2026-11-19). */
export function wholeJsonLines<T>(file: string): T[] {
  const text = readFileSync(file, "utf8");
  const whole = text.endsWith("\n") ? text : text.slice(0, text.lastIndexOf("\n") + 1);
  return whole.split("\n").filter(Boolean).map(line => JSON.parse(line) as T);
}
const replayLines = (file: string): ReplayLine[] => wholeJsonLines<ReplayLine>(file);
const postsIn = (lines: ReplayLine[]) => lines.filter(l => l.kind === "http" && l.method === "POST").length;

const BEACONS_KEY = "e2e.unloadBeacons";
/** A document of the mock's origin that is not the app: a built stylesheet
 *  (Firefox shows it as text) — the tab's sessionStorage is readable there.
 *  Read when Firefox needs it, never at import (a Chromium spec loads this
 *  file too, without needing a build). */
function neutralDocument(): string {
  const css = readdirSync(new URL("../dist/static/", import.meta.url)).find(f => f.endsWith(".css"));
  if (!css) throw new Error("no built stylesheet in dist/static: no neutral document to unload the page into — npm run build");
  return `${MOCK}static/${css}`;
}

/** Firefox: the page is UNLOADED while its context lives, and the context
 *  closes only once EACH beacon the unload handed off reached the mock.
 *  Firefox sends a beacon that goes out after its context closed without
 *  the context's cookies — the replay would see a request without its test
 *  attempt (measured 2026-11-16: closing the context under the page lost
 *  them every time; navigating away first still lost one beacon in four
 *  runs; Chromium sends them with the cookie). The unload sends the
 *  beforeunload, the page-hide settings and the pagehide beacons
 *  (ws/telemetry.ts, defaults.ts); how many is the page's own count, never
 *  assumed. So from here on every `sendBeacon` call carries a mark
 *  `<nonce>.<n>` in its query (`e2e_beacon`, the nonce this unload's own),
 *  every handed-off mark is listed in the tab's sessionStorage, the app
 *  unloads into a neutral document of the SAME origin, the list is read
 *  there, and each mark must have reached the mock ONCE with this attempt's
 *  cookie before the context may close (e2e/unloadReceipts.ts). A count of
 *  POSTs proved nothing: an unrelated POST (the telemetry's own fetch)
 *  filled it for a beacon that never arrived, and a beacon that never
 *  arrives leaves the replay nothing to call ownerless (Codex R386 VM-I25,
 *  held by e2e/firefox-unload.guard.ts). Every unload — and every skip of
 *  one, with its reason — is an event; a beacon not received fails the test
 *  after its event is written. Nothing is suppressed. */
async function unloadInContext(page: Page, instance: string, attempt: AttemptOrigin, where: Record<string, unknown>): Promise<void> {
  const file = replayFile(instance);
  // a page the app is not loaded in (closed, the preview's smoke page,
  // about:blank) sends the mock nothing; without a replay log nothing
  // judges — named in the event: the runner fails a skip for an attempt
  // whose app loaded from the mock (scripts/test_select/firefox.py)
  const skipped = page.isClosed() ? "the page is closed" : !file ? "no replay log"
    : !page.url().startsWith(MOCK) ? `the page is not the mock's app (${page.url().slice(0, 80)})` : null;
  if (skipped !== null || !file) {
    logEvent({ event: "unload", ...where, skipped });
    await page.goto("about:blank").catch(() => {});
    return;
  }
  const neutral = neutralDocument();
  const nonce = randomUUID();
  await page.evaluate(([key, nonce]) => {
    const send = navigator.sendBeacon.bind(navigator);
    sessionStorage.setItem(key, "[]");
    let n = 0;
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      const marked = new URL(String(url), location.href);
      const mark = `${nonce}.${++n}`;
      marked.searchParams.set("e2e_beacon", mark);
      const handedOff = send(marked.href, data);
      if (handedOff) sessionStorage.setItem(key, JSON.stringify([...JSON.parse(sessionStorage.getItem(key) ?? "[]"), mark]));
      return handedOff;
    };
  }, [BEACONS_KEY, nonce] as const);
  const before = postsIn(replayLines(file));
  await page.goto(neutral);
  const marks = parseMarks(await page.evaluate((key) => sessionStorage.getItem(key), BEACONS_KEY), nonce);
  const deadline = Date.now() + 5_000;
  let r = receipts(marks, replayLines(file), attempt, nonce);
  while (!complete(r) && Date.now() < deadline) {
    await new Promise(res => setTimeout(res, 50));
    r = receipts(marks, replayLines(file), attempt, nonce);
  }
  const posts = postsIn(replayLines(file)) - before;
  logEvent({ event: "unload", ...where, nonce, beacons: marks.length, received: r.received.length,
             missing: r.missing, foreign: r.foreign, twice: r.twice, posts });
  if (!complete(r))
    throw new Error(`the unload's beacons not received while its context lives: ${marks.length} handed off, `
      + `missing [${r.missing.join(", ")}], foreign [${r.foreign.join(", ")}], twice [${r.twice.join(", ")}] `
      + `(${posts} POST(s) recorded meanwhile — a count proves no beacon)`);
  await page.goto("about:blank").catch(() => {});
}

export const test = base.extend<{ mockBaseline: void }, { mock: MockHandle & { pristine: Snapshot; pristineWire: Wire }; browserPin: void }>({
  // Firefox (the pinned core, R385): no touch — the context options carry
  // none, every touch call throws; and the page is unloaded inside its
  // context before the context closes (unloadInContext).
  // `hasTouch` is the context option as the test resolves it — a file's
  // test.use included, not only the project's.
  context: async ({ context }, use, testInfo) => {
    await instrument(context, originOf(testInfo), "fixture");
    await use(context);
  },

  page: async ({ page, browserName, mock, hasTouch }, use, testInfo) => {
    if (browserName === "firefox") {
      if (hasTouch) throw new Error(TOUCH_UNDER_BIDI);
      await forbidTouch(page);
    }
    await use(page);
    if (browserName === "firefox")
      await unloadInContext(page, mock.instance,
        { run: RUN, test: testInfo.testId, project: testInfo.project.name, retry: testInfo.retry },
        { testId: testInfo.testId, title: testInfo.title, retry: testInfo.retry });
  },

  // The browser that runs is the one asked for (Codex R385): its own
  // version, read from the started browser, against the pin the Firefox
  // config names (LCNC_FIREFOX_VERSION) — a cached path proves no version.
  // Every worker writes it to the event log; the gate reads it there.
  // The Firefox core runs without a display (playwright.firefox.config.ts):
  // the started browser's own answer to a WebGL context, read in a context of
  // its own, is in the same event — the runner requires none (R387).
  browserPin: [async ({ browser, browserName }, use, workerInfo) => {
    const version = browser.version();
    const pinned = browserName === "firefox" ? process.env.LCNC_FIREFOX_VERSION : undefined;
    let webgl: boolean | undefined;
    if (browserName === "firefox") {
      const probe = await browser.newContext();
      try {
        webgl = await (await probe.newPage()).evaluate(() => {
          const c = document.createElement("canvas");
          return c.getContext("webgl2") !== null || c.getContext("webgl") !== null;
        });
      } finally { await probe.close(); }
    }
    logEvent({ event: "browser", name: browserName, version, pinned: pinned ?? null, workerIndex: workerInfo.workerIndex,
               ...(webgl !== undefined ? { webgl } : {}) });
    if (pinned !== undefined && version !== pinned)
      throw new Error(`the started Firefox is ${version}, the pin names ${pinned}`);
    await use();
  }, { scope: "worker", auto: true }],

  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern
  storageState: async ({}, use, testInfo) => {
    const origin = originOf(testInfo);
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
    // every context a test opens is recorded too (replay step 5b)
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (o) => {
      const c = await newContext(o);
      await instrument(c, originOf(testInfo), "new");
      return c;
    };
    try {
      await use();   // resolves after the test, failed or not
    } finally {
      browser.newContext = newContext;
    }
    for (const c of browser.contexts()) await c.close().catch(() => {});
    logEvent({ event: "test-end", ...where, status: testInfo.status });
    if (mock.died()) throw new Error(`the worker's mock ended during the test: ${mock.died()}`);
  }, { auto: true }],
});

import { readFileSync } from "node:fs";
import WebSocket from "ws";
import { test, expect, ORIGIN_COOKIE, type ReplayOrigin } from "./test";
import { MOCK } from "./ctl";
import { replayFile } from "./mockFixture";

// The replay's origin binding (test strategy step 5, Codex R251 TS248-04
// Rest B, R265 FI265-02) read off the ARTIFACT: the mock's replay file. Each
// connection carries the test attempt it was opened under — the app's socket
// opened inside its Web Worker, a context the test made itself, the page's
// HTTP requests — and a socket without the cookie stays without an origin
// (the check names it, never assigns it to a test).

interface Line { kind: string; conn?: number; origin?: ReplayOrigin | { infra: string } | null;
  msg?: { cmd?: string }; method?: string; path?: string; op?: string | null }

const lines = (file: string): Line[] =>
  readFileSync(file, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l) as Line);

/** The origin each /ws connection that sent a `hello` was bound to. */
const helloOrigins = (all: Line[]) => {
  const opened = new Map(all.filter(l => l.kind === "open").map(l => [l.conn!, l.origin ?? null]));
  return all.filter(l => l.kind === "frame" && l.msg?.cmd === "hello").map(l => opened.get(l.conn!) ?? null);
};

test("every connection a test opens carries its attempt; a socket without the cookie has none", async ({ page, browser, mock }, testInfo) => {
  const file = replayFile(mock.instance);
  expect(file, "the run writes a replay log (LCNC_E2E_REPLAY_DIR)").not.toBeNull();
  const mine: ReplayOrigin = { run: process.env.LCNC_E2E_RUN!, test: testInfo.testId, project: testInfo.project.name, retry: testInfo.retry };
  const cookies = await page.context().cookies(MOCK);
  expect(cookies.map(c => c.name)).toContain(ORIGIN_COOKIE);
  const before = lines(file!).length;

  // 1. the page: its HTTP requests and the worker's socket
  await page.goto(MOCK);
  await expect.poll(() => helloOrigins(lines(file!).slice(before)).length, { message: "the page's hello" }).toBe(1);
  // 2. a context the test makes itself (scenes.viewer.spec.ts makes six)
  const own = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const ownPage = await own.newPage();
  await ownPage.goto(MOCK);
  // 3. a socket from Node without the cookie
  const bare = new WebSocket(`${MOCK.replace(/^http/, "ws")}ws`);
  await new Promise<void>((resolve, reject) => { bare.once("open", () => resolve()); bare.once("error", reject); });
  // the replay's ONE named connection without an origin (scripts/test_select/replay.py NO_COOKIE_SESSION)
  bare.send(JSON.stringify({ cmd: "hello", session: "replay-origin:no-cookie" }));

  await expect.poll(() => helloOrigins(lines(file!).slice(before)).length, { message: "three hellos in the replay" })
    .toBeGreaterThanOrEqual(3);
  bare.close();
  await own.close();
  const fresh = lines(file!).slice(before);
  const origins = helloOrigins(fresh);
  expect(origins.filter(o => o !== null), "the page's and the own context's sockets").toEqual([mine, mine]);
  expect(origins.filter(o => o === null), "the bare socket stays without an origin").toHaveLength(1);
  const http = fresh.filter(l => l.kind === "http");
  expect(http.length, "the page's requests are in the replay").toBeGreaterThan(0);
  expect(http.filter(l => JSON.stringify(l.origin) !== JSON.stringify(mine)), "every request of the pages carries the attempt")
    .toEqual([]);
});

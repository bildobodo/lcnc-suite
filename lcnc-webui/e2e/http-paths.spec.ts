import { readFileSync } from "node:fs";
import { test, expect } from "./test";
import { MOCK } from "./ctl";
import { replayFile } from "./mockFixture";
import { httpRecordFile } from "./httpRecord";

// Replay step 5b's counter-cases in the real browser (FI265-02 Rest A,
// Codex R268/R269, R389–R390): each request takes a path the replay must
// name exactly as scripts/test_select/replay_http_expect.json lists it for
// this test — by the request's own id, never its URL or its order. The page
// is a neutral document of the mock (/__e2e/target, text), so a test's
// requests are its own: the app is not loaded.

const NEUTRAL = `${MOCK}__e2e/target`;
const devicesJson = { ok: true, devices: [] };

test("two GET /devices: the late one replaced, the other served by the mock — assigned by id, not URL or order", async ({ page }) => {
  await page.goto(NEUTRAL);
  let n = 0;
  await page.route("**/devices", async (route) => {
    if (n++ === 0) {
      await new Promise(r => setTimeout(r, 400));          // the replaced one ends LAST
      await route.fulfill({ json: devicesJson });
    } else {
      await route.fallback();                               // → the catch-all → the mock
    }
  });
  const codes = await page.evaluate(async () => Promise.all([fetch("/devices"), fetch("/devices")].map(p => p.then(r => r.status))));
  expect(codes).toEqual([200, 200]);
});

test("fetch then fulfill: the one server contact assigned, the answer replaced", async ({ page }) => {
  await page.goto(NEUTRAL);
  await page.route("**/devices", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: devicesJson });
  });
  expect(await page.evaluate(() => fetch("/devices").then(r => r.status))).toBe(200);
});

test("a 403 from the mock is served, with its status", async ({ page }) => {
  await page.goto(NEUTRAL);
  // one segment for the browser, outside dist/ for the mock once decoded
  expect(await page.evaluate(() => fetch("/..%2f..%2fe2e-outside").then(r => r.status))).toBe(403);
});

test("the SPA fallback answers an API path: never a served route", async ({ page }) => {
  await page.goto(NEUTRAL);
  // the mock has no /g30: its fallback answers index.html with 200
  expect(await page.evaluate(() => fetch("/g30").then(r => r.status))).toBe(200);
});

test("a server redirect: the first id carries both contacts, both hops stay unknown", async ({ page }) => {
  await page.goto(NEUTRAL);
  expect(await page.evaluate(() => fetch("/__e2e/redirect").then(r => r.text()))).toBe("target");
});

test("a synthetic 302: the follow-up reaches the mock without an id, covered by its hop and unassigned", async ({ page }) => {
  await page.goto(NEUTRAL);
  await page.route("**/__e2e/synthetic", route => route.fulfill({ status: 302, headers: { location: "/__e2e/target" } }));
  expect(await page.evaluate(() => fetch("/__e2e/synthetic").then(r => r.text()))).toBe("target");
});

test("a fetch through a server redirect, then fulfill: the replacement proven, the server contact not", async ({ page }) => {
  await page.goto(NEUTRAL);
  await page.route("**/__e2e/redirect", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  expect(await page.evaluate(() => fetch("/__e2e/redirect").then(r => r.text()))).toBe("target");
});

test("an aborted request and one a spec holds until its context closes", async ({ page }) => {
  await page.goto(NEUTRAL);
  await page.route("**/devices", route => route.abort());
  let entered!: () => void;
  const held = new Promise<void>(r => { entered = r; });
  await page.route("**/tool-table", () => { entered(); /* held: never answered */ });
  expect(await page.evaluate(() => fetch("/devices").then(() => "ok", () => "failed"))).toBe("failed");
  await page.evaluate(() => { void fetch("/tool-table").catch(() => {}); });
  await held;                                               // its handler has it — then the context closes
});

test("a save and a rename of a macro in one test are two variants", async ({ page }) => {
  await page.goto(NEUTRAL);
  await page.route("**/macro?*", route => route.fulfill({ json: { ok: true } }));
  const codes = await page.evaluate(async () => [
    (await fetch("/macro?name=a.ngc&base=new", { method: "PUT", body: "o<a> sub\no<a> endsub\n" })).status,
    (await fetch("/macro?name=b.ngc&base=r1&rename_from=a.ngc&rename_base=r1", { method: "PUT", body: "o<b> sub\no<b> endsub\n" })).status,
  ]);
  expect(codes).toEqual([200, 200]);
});

test("an invented token in a query, a header and a path parameter appears in no record", async ({ page, mock }) => {
  const token = `e2e-invented-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.goto(NEUTRAL);
  await page.evaluate(async (t) => {
    await fetch(`/__e2e/target?token=${t}&e2e_case=token`, { headers: { "X-Auth-Token": t } });
    // and in a route's path parameter: kept as its template (R268 Rest B)
    await fetch(`/settings/${t}`, { method: "POST", body: "{}" });
    await fetch(`/settings/${t}`);
  }, token);
  const replay = replayFile(mock.instance)!;
  // the mock writes its line when the answer finishes
  await expect.poll(() => readFileSync(replay, "utf8").includes('"qkeys":["e2e_case","token"]')).toBe(true);
  await expect.poll(() => readFileSync(replay, "utf8").split("/settings/{section}").length - 1).toBeGreaterThanOrEqual(2);
  for (const f of [replay, httpRecordFile()!]) expect(readFileSync(f, "utf8").includes(token), f).toBe(false);
});

import { test, expect } from "@playwright/test";
import { ctl as ctlSend, MOCK } from "./ctl";

// Frame-type liveness guards (frontend split program, A0.3).
//
// The backend M4 regression proved that a green gate which never asserts
// frame DELIVERY is blind to a dead dispatch path: every unit test and the
// whole perf matrix passed while no client could render a single status
// frame. Before the A1 lcncWs.ts split rearranges onFrame dispatch, these
// specs pin the full pipeline per frame type — WS receive -> decode ->
// dispatch -> reactive store -> rendered DOM — against the real built app:
//
//   status (connect-time)  -> DRO input shows work_pos
//   status_delta           -> merged onto prior data, DRO updates
//   pong                   -> network-latency pill appears
//   halshow_snapshot/update-> Halshow tab renders pins, then the delta
//
// The mock gateway exposes ws://…/ctl so the spec scripts frames mid-test:
// assert the BEFORE state, broadcast, assert the AFTER state — no races.

test("status_delta merges onto prior status and updates the rendered DRO", async ({ page }) => {
  await page.goto(MOCK);
  // SetupStrip's X touchoff input renders work_pos[0] from the connect-time
  // full status (axis rows exist because the mock also sends viewer_init).
  const xInput = page.locator("input.setupInput").first();
  await expect(xInput).toHaveValue("12.345");
  // Quiet the mock's heartbeat-triggered FULL status echoes first, so the
  // value below can only arrive via the status_delta frame itself — without
  // this, a dead delta dispatch path still passes one heartbeat later
  // (caught when this guard was proven adversarially).
  await ctlSend({ op: "quiet", on: true });
  try {
    await ctlSend({ op: "status_delta", data: { work_pos: [99.125, 1.0, -5.5] } });
    await expect(xInput).toHaveValue("99.125");
  } finally {
    await ctlSend({ op: "quiet", on: false });
  }
});

test("pong drives the network-latency reading", async ({ page }) => {
  await page.goto(MOCK);
  // The ws worker heartbeats at 1 Hz; the mock answers with pong, which sets
  // networkLatency — rendered in the header's Connection details card
  // (design wave D5: diagnostics left the header row).
  await page.getByRole("button", { name: "Connection details", exact: true }).click();
  await expect(page.getByTitle("Network latency")).toHaveText(/^\d+ ms$/);
});

test("halshow snapshot renders pins and halshow_update applies the delta", async ({ page }) => {
  await page.goto(MOCK);
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("tab", { name: "HAL", exact: true }).click();
  // Opening the tab sends {cmd:"halshow_live", on:true}; the mock answers
  // with the snapshot. Search to get the flat list (tree starts collapsed).
  await page.locator(".halPane").getByPlaceholder("Search HAL…").fill("mock.counter");
  const value = page.locator(".halRow .halValue").first();
  await expect(value).toHaveText("0");
  await ctlSend({ op: "raw", frame: { type: "halshow_update", pins: { "mock.counter": "17" } } });
  await expect(value).toHaveText("17");
});

// The browser-PC measurement (Codex R181 VP181-01) reads a status frame's AGE
// — the WS worker's socket receipt to the applyState() that shows it — and a
// press's delay from the page's own 3 s perf rows. Through the real worker:
// a dropped receipt stamp (worker → page) leaves age_n at 0 while frames
// still apply; a dead input listener leaves in_n at 0.
test("perf rows carry the status age from the worker's receipt and the presses' delay", async ({ page }) => {
  const rows: Array<Record<string, any>> = [];
  await page.route("**/telemetry", async (route) => {
    for (const line of (route.request().postData() ?? "").split("\n")) {
      if (!line) continue;
      try {
        const e = JSON.parse(line);
        if (e.kind === "viewer.perf") rows.push(e);
      } catch { /* not ours */ }
    }
    await route.fulfill({ status: 204, body: "" });
  });
  await page.goto(MOCK);
  // (the DRO's value is no readiness signal here: the parallel status_delta
  // test broadcasts its own) — the first aged row is
  await expect.poll(() => rows.some(r => r.age_n > 0), { timeout: 15_000 }).toBe(true);
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift");
  await expect.poll(() => rows.some(r => r.in_n > 0), { timeout: 15_000 }).toBe(true);
  // the heartbeat's answer (the mock's status with timing) is paired in the
  // worker's clock: a send stamp lost on the way to the page leaves rt_n 0
  await expect.poll(() => rows.some(r => r.rt_n > 0), { timeout: 15_000 }).toBe(true);
  const sum = (h: Record<string, number>) => Object.values(h).reduce((a, b) => a + b, 0);
  for (const r of rows) {
    expect(sum(r.age_h), "every age sample is binned").toBe(r.age_n);
    // a window's first apply has its gap from the previous window's last one
    expect([r.frames - 1, r.frames], "every status gap is binned").toContain(sum(r.gap_h));
    expect(r.age_neg, "no receipt after its apply on one clock").toBe(0);
    expect(sum(r.rt_net_h), "every paired round trip is binned").toBe(r.rt_n);
  }
  const aged = rows.filter(r => r.age_n > 0);
  // one clock: a receipt on another time origin would be years off (or negative)
  expect(Math.max(...aged.map(r => r.age_max_ms)), "an age on one clock").toBeLessThan(5000);
  expect(rows.reduce((a, r) => a + r.in_n, 0)).toBeGreaterThanOrEqual(4);
});

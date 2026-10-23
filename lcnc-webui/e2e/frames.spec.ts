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
  // every paired heartbeat rides its row with the gateway's monotonic stamp
  // and pid (Codex R185 — the report orders a parse's own bounds by them) and
  // the witness tick issued after it (R186): a stamp lost between the timing
  // and the page leaves rt_n without a pair
  type Pair = { seq: number; hs: number; hr: number; g: number; pid: number; ta: number; dt: number | null; dn: number | null };
  const pairs = rows.flatMap(r => r.hb_pairs as Pair[]);
  expect(pairs.length).toBeGreaterThan(0);
  for (const r of rows) expect(r.hb_pairs.length, "one pair per paired heartbeat").toBe(r.rt_n);
  for (const p of pairs) {
    expect(Number.isInteger(p.seq)).toBe(true);
    expect(p.hs, "the send before the answer's receipt, on the worker's clock").toBeLessThan(p.hr);
    expect(p.hr - p.hs).toBeLessThan(5000);
    expect(typeof p.g).toBe("number");
    expect(p.pid).toBeGreaterThan(0);
    expect(p.dt, "the worker said its witness word with the send").toBe(0);   // no check during a run here
  }
  for (let i = 1; i < pairs.length; i++) {
    expect(pairs[i]!.seq).toBeGreaterThan(pairs[i - 1]!.seq);
    expect(pairs[i]!.g, "the gateway's clock runs on with the heartbeats").toBeGreaterThan(pairs[i - 1]!.g);
    expect(pairs[i]!.ta, "a tick after each answer, in order").toBeGreaterThan(pairs[i - 1]!.ta);
  }
  // the receipts are on the page's clock through the two-way exchange with
  // the worker (Codex R186): a relation in every row once the first exchange
  // is in, narrow at rest; the frames before it are not aged
  await expect.poll(() => rows.some(r => r.clk_n > 0), { timeout: 15_000 }).toBe(true);
  const related = rows.filter(r => r.clk_l !== null);
  expect(related.length).toBeGreaterThan(0);
  for (const r of related) {
    // (how narrow is the report's to judge: under load an exchange is wide)
    expect(r.clk_l, "a relation, not an empty one").toBeLessThanOrEqual(r.clk_u);
    expect(r.clk_conflicts).toBe(0);
  }
  expect(rows.filter(r => r.age_n > 0).every(r => r.clk_l !== null), "an aged row has its relation").toBe(true);
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
  // the four presses may straddle two 3 s windows: the later row may still be
  // on its way (the 2 s telemetry flush) — wait for it, never read it once
  // (CI 2026-10-23: 3 of 4 counted when the assertion ran)
  await expect.poll(() => rows.reduce((a, r) => a + r.in_n, 0), { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
});

// The gateway's parse in flight as the page SAW it (Codex R183 VP183-01): the
// browser-PC report binds a run check's sweep to a parse by these events —
// through the real worker and status store, each with its frame's receipt.
test("the page reports the parse it sees in flight, first and last frame, with their receipt", async ({ page }) => {
  const seen: Array<Record<string, any>> = [];
  await page.route("**/telemetry", async (route) => {
    for (const line of (route.request().postData() ?? "").split("\n")) {
      try { const e = JSON.parse(line); if (e.kind === "preview.parse_seen") seen.push(e); } catch { /* not ours */ }
    }
    await route.fulfill({ status: 204, body: "" });
  });
  await page.goto(MOCK);
  await expect(page.locator("#app")).toBeVisible();
  // a receipt is on the page's clock once the page ↔ worker clock relation
  // holds (Codex R186: the first exchange rides the first heartbeat) — until
  // then a parse is said without one; a parse per attempt (its own job)
  // (the mock broadcasts to every page: jobs of this run's own, so a parallel
  // copy of this test sees them only as other parses)
  const base = 1_000 * (Date.now() % 1_000_000) + Math.floor(Math.random() * 1_000);
  let on: Record<string, any> | undefined, off: Record<string, any> | undefined;
  for (let k = 1; k <= 10 && typeof on?.rx_ms !== "number"; k++) {
    const pr = { reason: "wcsoff:G55:z", file: "p.ngc", expected_ms: 9000, started_ms: 1234567 + k, job: base + k,
                 queued: false, superseded: 0 };
    // an envelope key on a status_delta: the mock's state (armed, data) stays
    // as the parallel tests of this project expect it
    await ctlSend({ op: "status_delta", data: {}, envelope: { preview_refresh: pr } });
    await ctlSend({ op: "status_delta", data: {}, envelope: { preview_refresh: null } });
    await expect.poll(() => seen.filter(e => e.job === base + k).map(e => e.state), { timeout: 15_000 }).toEqual(["on", "off"]);
    [on, off] = seen.filter(e => e.job === base + k);
    if (typeof on!.rx_ms !== "number") await page.waitForTimeout(500);
  }
  expect(typeof on!.rx_ms).toBe("number");
  expect(on!.started_ms).toBeGreaterThan(1234567);
  expect(off!.rx_ms).toBeGreaterThanOrEqual(on!.rx_ms);
});

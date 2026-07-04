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

test("pong drives the network-latency pill", async ({ page }) => {
  await page.goto(MOCK);
  // The ws worker heartbeats at 1 Hz; the mock answers with pong, which sets
  // networkLatency — rendered as the "Net … ms" header pill.
  await expect(page.getByTitle("Network latency")).toBeVisible();
});

test("halshow snapshot renders pins and halshow_update applies the delta", async ({ page }) => {
  await page.goto(MOCK);
  await page.getByTitle("Settings", { exact: true }).click();
  await page.getByRole("button", { name: "Halshow" }).click();
  // Opening the tab sends {cmd:"halshow_live", on:true}; the mock answers
  // with the snapshot. Search to get the flat list (tree starts collapsed).
  await page.locator(".halPane").getByPlaceholder("Search...").fill("mock.counter");
  const value = page.locator(".halRow .halValue").first();
  await expect(value).toHaveText("0");
  await ctlSend({ op: "raw", frame: { type: "halshow_update", pins: { "mock.counter": "17" } } });
  await expect(value).toHaveText("17");
});

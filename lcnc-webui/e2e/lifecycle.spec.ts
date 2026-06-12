import { test, expect } from "@playwright/test";
import WebSocket from "ws";

// Connection-lifecycle guards (A1.6) — born from the A1 manual smoke:
//
// 1. Reload-disarm: the gateway registered armed-resume holds on every
//    disconnect, but a RELOADED page booted with resume_armed=false and never
//    asked (trace: session.resume_hold_registered with no resume_* after it).
//    Fix: wsTransport persists the server-confirmed armed state in
//    sessionStorage and boots the resume request from it. The spec asserts
//    the hello CONTRACT: same session, resume_armed=false before the reload,
//    resume_armed=true after it.
//
// 2. Shutdown banner: uvicorn cancels WS tasks before lifespan shutdown runs,
//    so the gateway's server_shutdown broadcast saw zero clients and the
//    browser got a bare close. Frontend now also maps the going-away close
//    codes (1001/1012) to the banner; the frame path is asserted too. (The
//    gateway-side fix — getting a frame/1001 out at task-cancel time — is
//    WS-B, perf-matrix gated.)
//
// This file runs in the SERIAL `lifecycle` playwright project (dependencies)
// because refuseWs/shutdownClose are mock-global and would break parallel
// specs mid-flight.
const MOCK = "http://localhost:4174/";
const CTL = "ws://localhost:4174/ctl";

function ctlQuery(op: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const c = new WebSocket(CTL);
    c.once("open", () => c.send(JSON.stringify(op)));
    c.once("message", (d) => { c.close(); resolve(JSON.parse(String(d))); });
    c.once("error", reject);
  });
}

const armedGate = (page: import("@playwright/test").Page) =>
  page.locator('fieldset[data-gate="armed"]').first();

test("reload while armed requests armed-resume with the same session id", async ({ page }) => {
  await page.goto(MOCK);
  await expect(armedGate(page)).not.toBeDisabled();
  const session = await page.evaluate(() => sessionStorage.getItem("lcnc-session-id"));
  expect(session).toBeTruthy();

  await page.reload();
  await expect(armedGate(page)).not.toBeDisabled();

  await expect.poll(async () => {
    const r = await ctlQuery({ op: "lastHellos" });
    return r.hellos.some((h: any) => h.session === session && h.resume_armed === true);
  }, { message: "no resume-requesting hello arrived for the reloaded session" }).toBe(true);

  // Session continuity: the SAME id asked resume_armed=false on first load.
  const r = await ctlQuery({ op: "lastHellos" });
  expect(r.hellos.some((h: any) => h.session === session && h.resume_armed === false)).toBe(true);
});

test("explicit server_shutdown frame shows the shutdown banner", async ({ page }) => {
  await page.goto(MOCK);
  await expect(armedGate(page)).not.toBeDisabled();
  await ctlQuery({ op: "raw", frame: { type: "server_shutdown" } });
  await expect(page.getByText("Server shutting down")).toBeVisible();
});

test("server-going-away close (1001) shows the shutdown banner without any frame", async ({ page }) => {
  await page.goto(MOCK);
  await expect(armedGate(page)).not.toBeDisabled();
  // Keep refusing reconnect hellos with 1001 so the banner window is stable
  // (a successful reconnect would clear it again).
  await ctlQuery({ op: "refuseWs", on: true });
  try {
    await ctlQuery({ op: "shutdownClose" });
    await expect(page.getByText("Server shutting down")).toBeVisible();
  } finally {
    await ctlQuery({ op: "refuseWs", on: false });
  }
});

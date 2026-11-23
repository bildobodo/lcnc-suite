// The jog lease in the browser (P1b, machine day 2026-11-21; plan agreed with
// Codex R423–R426): every continuous jog names its input gesture's lease, the
// page renews it from its MAIN thread, the gesture's end ends it, and a lease
// that ended from outside leaves its gesture spent until its own release.
//
// What this level proves is the page's side and the wire form: the gestures,
// `lease` / `jog_renew` / `jog_lease_end` / `jog_change`, the feedback at the
// control. The mock's expiry notice is an IMITATION of the gateway's
// (`leaseExpired`): it proves what the page does with one, never that a jog
// stopped — the gateway's own tests (test_jog_lease_gateway.py) and the sim
// probe hold the stop.
import { test, expect, type Page } from "./test";
import { ctl, MOCK } from "./ctl";
import { GATE_NAMES, type Permissions } from "../src/permissions";
import { installHoldClock } from "./holdClock";

function perms(): Permissions {
  const p = Object.fromEntries(GATE_NAMES.map((k) => [k, true])) as Permissions;
  p.pause = false; p.resume = false; p.toolChangeConfirm = false;
  return p;
}

type Sent = { cmd: string; axis?: number; vel?: number; lease?: number; axes?: unknown; stop?: unknown; via?: string };
const NOISE = ["hello", "client_diag", "tab_visibility", "get_tool_table", "heartbeat", "settings_flush"];
const sent = async (): Promise<Sent[]> => (((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [])
  .filter((c) => !NOISE.includes(c.cmd));
type Timeline = { renewals: { t: number; ids: number[] }[]; beats: number[]; now: number };
const timeline = async () => (await ctl({ op: "renewals" })) as unknown as Timeline;
const startOf = async (): Promise<Sent> => {
  await expect.poll(async () => (await sent()).filter((c) => c.cmd === "jog_cont").length).toBeGreaterThan(0);
  return (await sent()).find((c) => c.cmd === "jog_cont")!;
};

async function open(page: Page, settings: Record<string, unknown> = {}) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "raw", frame: { type: "settings_init", settings } });
  await ctl({ op: "status_delta", armed: true, data: { homed: true, homed_joints: [true, true, true],
    permissions: perms(), permission_reasons: {} } });
  await expect(page.locator(".pill.armed")).toHaveCount(1);
  await ctl({ op: "clearCmds" });
  await ctl({ op: "clearRenewals" });
}

const jogButton = (page: Page, name: string) =>
  page.locator('[data-strip="jog"]').getByRole("button", { name, exact: true });

async function hold(page: Page, name: string) {
  await jogButton(page, name).hover();
  await page.mouse.down();
}

test.afterEach(async () => {
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "replies", replies: {} });
  await ctl({ op: "reset" });
});

// The agreed renewal cadence, fixed HERE — never the product's RENEW_MS, which
// a mutant would carry along (Codex R439 MT439-03; the unit test holds
// RENEW_MS against the gateway's JOG_RENEW_EXPECTED_S).
const AGREED_RENEW_MS = 100;

// On the PAGE's clock (jog-lease hardening, Codex R439/R440): a real-time gap
// at the mock measured the loaded runner (the P2a merge gate's 443 ms), not
// the page. The clock stands BEFORE the gesture, so every renewal is made by
// an exact step; each step's renewal is waited for at the mock; the end is
// proven by a FIFO marker through the same main-thread → worker → socket
// path (the next start), never by a real-time sleep. That the renewals come
// from the MAIN thread is the blocked-thread test below (real time, by design).
test("a held jog button names its lease, the page renews it, its release ends exactly that lease", async ({ page }) => {
  await installHoldClock(page);
  await open(page);                                   // commands and renewals cleared
  // the buttons' places taken while the clock runs: under a standing clock a
  // locator action would wait on the page's (faked) animation frames
  const at = async (name: string) => {
    const b = (await jogButton(page, name).boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const xPlus = await at("X+"), xMinus = await at("X-");
  const press = async (p: { x: number; y: number }) => { await page.mouse.move(p.x, p.y); await page.mouse.down(); };
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 1_000);              // the clock stands before the gesture (MT439-04)
  try {
    await press(xPlus);
    const start = await startOf();                    // the start's RECEIPT at the mock
    expect(start).toMatchObject({ cmd: "jog_cont", axis: 0, lease: expect.any(Number) });
    const L = start.lease!;
    const t0 = (await timeline()).now;
    expect((await timeline()).renewals.length, "no renewal before the page's clock moves").toBe(0);
    // real time passed for the worker: two of its heartbeats RECEIVED after the
    // start — a renewal made in (or with) the worker's heartbeat would be on the
    // same socket before the second one (the worker/heartbeat mutant)
    await expect.poll(async () => (await timeline()).beats.filter((b) => b > t0).length,
      "two worker heartbeats after the start").toBeGreaterThanOrEqual(2);
    expect((await timeline()).renewals.length, "no renewal while the page's clock stands").toBe(0);
    for (let k = 1; k <= 5; k++) {
      await page.clock.runFor(AGREED_RENEW_MS);
      await expect.poll(async () => (await timeline()).renewals.length, `renewal ${k} received`).toBe(k);
      expect((await timeline()).renewals[k - 1]!.ids, `renewal ${k} names the lease`).toContain(L);
    }
    await page.mouse.up();
    await expect.poll(async () => (await sent()).map((c) => [c.cmd, c.axis ?? c.lease]))
      .toEqual([["jog_cont", 0], ["jog_lease_end", L]]);
    await page.clock.runFor(4 * AGREED_RENEW_MS);
    // the FIFO marker: a new start through the same path — once it is RECEIVED,
    // everything the page sent before it has arrived (one MessagePort, one socket)
    await press(xMinus);
    await expect.poll(async () => (await sent()).filter((c) => c.cmd === "jog_cont").length,
      "the marker's start received").toBe(2);
    const L2 = (await sent()).filter((c) => c.cmd === "jog_cont")[1]!.lease!;
    expect(L2).toBeGreaterThan(L);
    await page.mouse.up();
    await expect.poll(async () => (await sent()).map((c) => [c.cmd, c.axis ?? c.lease]), "the marker's end received")
      .toEqual([["jog_cont", 0], ["jog_lease_end", L], ["jog_cont", 0], ["jog_lease_end", L2]]);
    // the recount (no mock reset before it): exactly one renewal per step while
    // held, none of L after its end
    const all = (await timeline()).renewals;
    expect(all.filter((r) => r.ids.includes(L)).length, "exactly the 5 renewals of L, none after its end").toBe(5);
    expect(all.length, "no renewal beyond the 5 steps").toBe(5);
  } finally {
    await page.clock.resume();
  }
});

test("an answered start keeps its gesture past REPLY_MS: renewals go on while held", async ({ page }) => {
  await open(page);
  await hold(page, "X-");
  const L = (await startOf()).lease!;
  await page.waitForTimeout(3600);   // past REPLY_MS (3 s): the answered start ends nothing
  const now = (await timeline()).now;
  await expect.poll(async () => (await timeline()).renewals.filter((r) => r.t > now && r.ids.includes(L)).length,
    "renewals go on after 3.6 s held").toBeGreaterThan(0);
  expect((await sent()).filter((c) => c.cmd === "jog_lease_end"), "nothing ended it").toEqual([]);
  await page.mouse.up();
});

test("a blocked main thread renews nothing while the worker's heartbeat goes on", async ({ page }) => {
  // the page's own word on why a lease ended (jog.lease_ended {why}) and
  // its console — a renewal that never resumes says why (round 6 at
  // a4076beb stopped renewing after the block once, with no record)
  const said: string[] = [];
  page.on("request", (req) => {
    if (!req.url().endsWith("/telemetry") || req.method() !== "POST") return;
    for (const line of (req.postData() ?? "").split("\n")) {
      if (line.includes("lease_ended") || line.includes("jog.")) said.push(line.slice(0, 200));
    }
  });
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") said.push(`console ${m.type()}: ${m.text().slice(0, 160)}`); });
  await open(page);
  await hold(page, "Y+");
  const L = (await startOf()).lease!;
  await expect.poll(async () => (await timeline()).renewals.length).toBeGreaterThanOrEqual(2);
  const before = (await timeline()).now;
  // the page's main thread busy for 2.2 s — what the panel's long tasks did
  await page.evaluate(() => { const t = performance.now(); while (performance.now() - t < 2200) { /* busy */ } });
  const after = (await timeline()).now;
  const tl = await timeline();
  const inside = (t: number) => t > before + 250 && t < after - 250;
  expect(tl.renewals.filter((r) => inside(r.t)), "the main thread renewed while blocked").toEqual([]);
  expect(tl.beats.filter(inside).length, "the worker's heartbeat went on").toBeGreaterThanOrEqual(1);
  await expect.poll(async () => (await timeline()).renewals.filter((r) => r.t > after && r.ids.includes(L)).length,
    { message: "renewals resume once the thread runs", timeout: 10_000 }).toBeGreaterThan(0)
    .catch(async (e) => {
      const sent = (await ctl({ op: "lastCmds" }) as { cmds?: { cmd: string }[] }).cmds?.map((c) => c.cmd) ?? [];
      throw new Error(`${String(e).slice(0, 300)}\nthe page said: ${JSON.stringify(said)}\ncommands: ${JSON.stringify(sent)}`);
    });
  await page.mouse.up();
});

test("an expiry ends that jog: the reason at the button, no restart while held, a new press is a new lease", async ({ page }) => {
  await open(page);
  await hold(page, "X+");
  const L = (await startOf()).lease!;
  await ctl({ op: "leaseExpired", id: L, axes: [0] });
  await expect(page.locator("[data-btn-hint]")).toHaveText("Jog stopped — page delayed, press again");
  await expect(jogButton(page, "X+")).not.toHaveClass(/active/);
  const at = (await timeline()).now;
  await page.waitForTimeout(400);
  expect((await timeline()).renewals.filter((r) => r.t > at + 150 && r.ids.includes(L)), "renewal ended").toEqual([]);
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect((await sent()).map((c) => c.cmd), "the release sends nothing more").toEqual(["jog_cont"]);
  await hold(page, "X+");
  await expect.poll(async () => (await sent()).filter((c) => c.cmd === "jog_cont").length).toBe(2);
  const again = (await sent()).filter((c) => c.cmd === "jog_cont")[1]!;
  expect(again.lease, "a new gesture, a new lease").toBeGreaterThan(L);
  await page.mouse.up();
});

test("a refused start ends its gesture: the reason at the button, the lease ended", async ({ page }) => {
  await open(page);
  await ctl({ op: "replies", replies: { jog_cont: { ok: false, error: "Not homed — press Home All" } } });
  await hold(page, "Z+");
  const L = (await startOf()).lease!;
  await expect(page.locator("[data-btn-hint]")).toHaveText("Not homed — press Home All");
  await expect.poll(async () => (await sent()).map((c) => [c.cmd, c.lease])).toContainEqual(["jog_lease_end", L]);
  await page.mouse.up();
});

test("a held key: its lease, renewals, the keyup ends it; an expiry is said and the key is spent until its keyup", async ({ page }) => {
  await open(page, { keyboard: { jogEnabled: true } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.down("ArrowRight");
  const L = (await startOf()).lease!;
  await expect.poll(async () => (await timeline()).renewals.filter((r) => r.ids.includes(L)).length).toBeGreaterThan(1);
  await page.keyboard.up("ArrowRight");
  await expect.poll(async () => (await sent()).map((c) => [c.cmd, c.axis ?? c.lease]))
    .toEqual([["jog_cont", 0], ["jog_lease_end", L]]);
  // a second hold; the gateway reports its expiry
  await ctl({ op: "clearCmds" });
  await page.keyboard.down("ArrowRight");
  const M = (await startOf()).lease!;
  expect(M).toBeGreaterThan(L);
  await ctl({ op: "leaseExpired", id: M, axes: [0] });
  // a key has no control to show it at: the message center says it
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("lcnc-messages") ?? "[]") as
    { text: string }[]).map((m) => m.text))).toContain("Jog stopped — page delayed, press again");
  await page.keyboard.down("ArrowRight");          // a repeat of the held key: never a start
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(250);
  expect((await sent()).map((c) => c.cmd), "spent until its keyup: no start, no second end").toEqual(["jog_cont"]);
});

test("the pad's Stop while a key is held ends the key's lease; its keyup sends nothing more", async ({ page }) => {
  await open(page, { keyboard: { jogEnabled: true } });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.down("ArrowUp");
  const L = (await startOf()).lease!;
  await page.locator('[data-strip="jog"] [data-control="jogStop"]').click();
  await expect.poll(async () => (await sent()).filter((c) => c.cmd === "jog_lease_end").map((c) => c.lease)).toEqual([L]);
  expect((await sent()).filter((c) => c.cmd === "jog_stop").length, "and the belt: every axis").toBeGreaterThanOrEqual(3);
  const n = (await sent()).length;
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(250);
  expect((await sent()).length, "the keyup finds its lease over").toBe(n);
});

test("a lost connection ends the held jog: nothing of it goes into the next connection", async ({ page }) => {
  await open(page);
  await hold(page, "X-");
  const L = (await startOf()).lease!;
  await ctl({ op: "quiet", on: false });
  const hellos = async () => (await ctl({ op: "snapshot" }) as { snapshot?: { hellos?: number } }).snapshot?.hellos ?? -1;
  const before = await hellos();
  expect(before, "the mock's snapshot names its hellos").toBeGreaterThan(0);
  await ctl({ op: "shutdownClose" });
  await expect(page.locator(".pill.armed")).toHaveCount(0);
  const at = (await timeline()).now;
  await expect.poll(hellos, { timeout: 20_000 }).toBeGreaterThan(before);   // the page reconnected: a NEW hello
  await page.waitForTimeout(500);
  expect((await timeline()).renewals.filter((r) => r.t > at + 150 && r.ids.includes(L)), "no renewal after the loss").toEqual([]);
  expect((await sent()).filter((c) => c.cmd === "jog_cont").length, "no start replayed").toBe(1);
  await page.mouse.up();
  await page.waitForTimeout(250);
  expect((await sent()).filter((c) => c.cmd === "jog_lease_end" || c.cmd === "jog_stop"),
    "the release after the loss sends nothing for the old gesture").toEqual([]);
});

test("a simulated gamepad: a stick gesture is one lease — its reversal ONE jog_change, its rest the lease's end", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)", index: 0, connected: true,
      mapping: "standard", timestamp: 0, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad, null, null, null] });
  });
  const stickX = (v: number) => page.evaluate((x) => {
    (window as unknown as { __pad: { axes: number[] } }).__pad.axes[0] = x;
  }, v);
  await open(page, { gamepad: { jogEnabled: true, mapping: { btn_rt: "none" } } });
  await stickX(1);
  const L = (await startOf()).lease!;
  expect((await sent())[0]).toMatchObject({ cmd: "jog_cont", axis: 0, via: "gamepad" });
  await stickX(-1);
  await expect.poll(async () => (await sent()).filter((c) => c.cmd === "jog_change"))
    .toEqual([expect.objectContaining({ cmd: "jog_change", lease: L, stop: [0], via: "gamepad",
      axes: [expect.objectContaining({ axis: 0 })] })]);
  await stickX(0);
  await expect.poll(async () => (await sent()).filter((c) => c.cmd === "jog_lease_end"))
    .toEqual([expect.objectContaining({ cmd: "jog_lease_end", lease: L, via: "gamepad" })]);
});

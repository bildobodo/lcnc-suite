// Function inventory package G1 (Codex R321–R322): the browser's part of
// three statements, each on what the page SENDS and SHOWS.
// - F-TRIP.S1b: an incoming safety trip is the banner with Acknowledge; the
//   click sends safety_trip_ack, and the trip stays on the page until the
//   gateway's next status frame comes without it (no optimistic clear).
// - F-JOG.S5b: every jog button of two axis sets (XYZABCUVW; XYZAC, where C
//   is the transmitted axis index 4) starts exactly its axis in its direction
//   and its release stops exactly that axis. The expectations come from the
//   fixture lists below, never from the page or a product helper.
// - F-LOAD.S3: Reload sends load_file with the loaded program's own path.
import { test, expect, type Page } from "./test";
import { ctl, MOCK } from "./ctl";
import { clickMore } from "./more";
import { GATE_NAMES, type Permissions } from "../src/permissions";

function perms(): Permissions {
  const p = Object.fromEntries(GATE_NAMES.map((k) => [k, true])) as Permissions;
  p.pause = false; p.resume = false; p.toolChangeConfirm = false;
  return p;
}

type Sent = { cmd?: string; axis?: number; vel?: number; path?: string };
// What the page sent, without the Tool strip's table read: it reads 300 ms
// after the connect (ToolStrip.vue) and may land after clearCmds.
const sent = async (): Promise<Sent[]> => (((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [])
  .filter((c) => c.cmd !== "get_tool_table");

async function open(page: Page, data: Record<string, unknown> = {}, axes?: string[]) {
  await ctl({ op: "reset" });
  if (axes) await ctl({ op: "setAxes", axes });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: {} } });
  await ctl({ op: "status_delta", armed: true, data: { permissions: perms(), permission_reasons: {}, ...data } });
  await expect(page.locator(".pill.armed")).toHaveCount(1);
  await ctl({ op: "clearCmds" });
}

test("a safety trip: the banner with Acknowledge; the click sends the ack, the trip stays until a status without it (F-TRIP.S1b)", async ({ page }) => {
  await open(page);
  const banner = page.locator(".bannerContent");
  const ack = page.locator(".bannerActions").getByRole("button", { name: "Acknowledge", exact: true });
  await expect(banner).not.toContainText("SAFETY TRIPPED");
  await expect(ack).toHaveCount(0);

  const trip = { type: "status_delta", armed: true, data: {}, safety_trip: { reason: "hb_timeout" } };
  await ctl({ op: "raw", frame: trip });
  await expect(banner.locator(".bannerError")).toContainText("SAFETY TRIPPED");
  await ack.click();
  await expect.poll(async () => (await sent()).map((c) => c.cmd)).toEqual(["safety_trip_ack"]);
  // The ack has crossed to the mock, so the click's render is long done: read
  // ONCE, no retry — a local clear would show here, and no frame has come
  // that could bring the trip back.
  expect(await banner.textContent(), "after the click, before any status").toContain("SAFETY TRIPPED");
  expect(await ack.count(), "Acknowledge still offered").toBe(1);
  // the gateway's own reply (no cmd field, gateway.py's reader), then a
  // status still carrying the trip (one in flight): it stays
  await ctl({ op: "raw", frame: { type: "reply", ok: true } });
  await ctl({ op: "raw", frame: trip });
  await expect(banner.locator(".bannerError")).toContainText("SAFETY TRIPPED");
  await expect(ack).toBeVisible();
  // the status without it confirms: gone
  await ctl({ op: "raw", frame: { type: "status_delta", armed: true, data: {} } });
  await expect(banner).not.toContainText("SAFETY TRIPPED");
  await expect(ack).toHaveCount(0);
  expect((await sent()).map((c) => c.cmd), "one acknowledgement, nothing else").toEqual(["safety_trip_ack"]);
});

// The two axis sets: letter → the axis index the page transmits (the index
// in viewer_init.axes — the gateway maps it).
const NINE: [string, number][] = [["X", 0], ["Y", 1], ["Z", 2], ["A", 3], ["B", 4], ["C", 5], ["U", 6], ["V", 7], ["W", 8]];
const XYZAC: [string, number][] = [["X", 0], ["Y", 1], ["Z", 2], ["A", 3], ["C", 4]];

for (const [name, set] of [["XYZABCUVW", NINE], ["XYZAC", XYZAC]] as const) {
  test(`every jog button on ${name}: its press starts exactly its axis and direction, its release stops exactly it (F-JOG.S5b)`, async ({ page }) => {
    await open(page, { homed: true, homed_joints: set.map(() => true) }, set.map(([l]) => l));
    const strip = page.locator('[data-strip="jog"]');
    for (const [letter, index] of set) {
      for (const [dir, sign] of [["+", 1], ["-", -1]] as const) {
        const label = `${letter}${dir}`;
        const btn = strip.getByRole("button", { name: label, exact: true });
        await expect(btn, label).toHaveCount(1);
        await expect(btn, label).toBeEnabled();
        await ctl({ op: "clearCmds" });
        await btn.hover();
        await page.mouse.down();
        await expect.poll(async () => (await sent()).length, `${label} pressed`).toBeGreaterThan(0);
        const pressed = await sent();
        expect(pressed.length, `${label}: one command at the press`).toBe(1);
        expect(pressed[0]!.cmd, label).toBe("jog_cont");
        expect(pressed[0]!.axis, `${label}: the axis`).toBe(index);
        expect(Math.sign(pressed[0]!.vel ?? 0), `${label}: the direction`).toBe(sign);
        await page.mouse.up();
        await expect.poll(async () => (await sent()).length, `${label} released`).toBeGreaterThan(1);
        const all = await sent();
        expect(all.map((c) => [c.cmd, c.axis]), `${label}: the release stops exactly its axis`)
          .toEqual([["jog_cont", index], ["jog_stop", index]]);
      }
    }
    // the set has no button beyond the fixture's letters
    const names = await strip.getByRole("button").evaluateAll((els) =>
      els.map((e) => (e.textContent ?? "").trim()).filter((t) => /^[A-Z][+-]$/.test(t)));
    expect([...names].sort()).toEqual(set.flatMap(([l]) => [`${l}+`, `${l}-`]).sort());
  });
}

test("Reload sends load_file with the loaded program's own path (F-LOAD.S3)", async ({ page }) => {
  await open(page, { active_file: "/nc/shared/part.ngc" });
  await clickMore(page.locator(".ctrlRow"), "Reload");
  await expect.poll(async () => (await sent()).map((c) => [c.cmd, c.path]))
    .toEqual([["load_file", "/nc/shared/part.ngc"]]);
});

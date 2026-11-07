// F-JOG.S5b (function inventory, Codex R321–R322 FI321-03): every jog button
// of two axis sets — XYZABCUVW and XYZAC, where C is the transmitted axis
// index 4 — starts exactly its axis in its direction, and its release stops
// exactly that axis. The expectations come from the fixture lists below,
// never from the page or a product helper. The diagonals (multi-jog) are a
// statement of their own.
import { test, expect } from "./test";
import { ctl, MOCK } from "./ctl";
import { GATE_NAMES, type Permissions } from "../src/permissions";

function perms(): Permissions {
  const p = Object.fromEntries(GATE_NAMES.map((k) => [k, true])) as Permissions;
  p.pause = false; p.resume = false; p.toolChangeConfirm = false;
  return p;
}

type Sent = { cmd?: string; axis?: number; vel?: number };
// What the page sent, without the Tool strip's table read: it reads 300 ms
// after the connect (ToolStrip.vue) and may land after clearCmds.
const sent = async (): Promise<Sent[]> => (((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [])
  .filter((c) => c.cmd !== "get_tool_table");

// letter → the axis index the page transmits (its place in viewer_init.axes)
const NINE: [string, number][] = [["X", 0], ["Y", 1], ["Z", 2], ["A", 3], ["B", 4], ["C", 5], ["U", 6], ["V", 7], ["W", 8]];
const XYZAC: [string, number][] = [["X", 0], ["Y", 1], ["Z", 2], ["A", 3], ["C", 4]];

test.afterEach(async () => {
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

for (const [name, set] of [["XYZABCUVW", NINE], ["XYZAC", XYZAC]] as const) {
  test(`every jog button on ${name}: its press starts exactly its axis and direction, its release stops exactly it (F-JOG.S5b)`, async ({ page }) => {
    await ctl({ op: "reset" });
    await ctl({ op: "setAxes", axes: set.map(([l]) => l) });
    await page.goto(MOCK);
    await expect(page.locator("input.setupInput").first()).toBeVisible();
    await ctl({ op: "quiet", on: true });
    await ctl({ op: "raw", frame: { type: "settings_init", settings: {} } });
    await ctl({ op: "status_delta", armed: true, data: { homed: true, homed_joints: set.map(() => true),
      permissions: perms(), permission_reasons: {} } });
    await expect(page.locator(".pill.armed")).toHaveCount(1);
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
        expect((await sent()).map((c) => [c.cmd, c.axis]), `${label}: the release stops exactly its axis`)
          .toEqual([["jog_cont", index], ["jog_stop", index]]);
      }
    }
    // the strip has no single-axis jog button beyond the fixture's letters
    const names = await strip.getByRole("button").evaluateAll((els) =>
      els.map((e) => (e.textContent ?? "").trim()).filter((t) => /^[A-Z][+-]$/.test(t)));
    expect([...names].sort()).toEqual(set.flatMap(([l]) => [`${l}+`, `${l}-`]).sort());
  });
}

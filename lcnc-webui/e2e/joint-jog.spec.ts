// Button gates package E (BG-07; operator E1–E3, 2026-10-28): jogging before
// homing where the machine declares it. The gateway decides which axis moves
// which joint, how fast and which axis stays closed (test_button_gates_e.py);
// the strip dims a closed axis with its reason and states the joint jog and
// its cap in its head — the buttons keep their axis letters (operator
// 2026-10-28) — and the keyboard refuses a closed axis like the button.
import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";
import { GATE_NAMES, type Permissions } from "../src/permissions";

const GANTRY = "Gantry axis — jog it after Home All";
// XYYZ trivkins: joints 1 and 2 carry Y — Y closed, Z is joint 3
const JOINT_JOG = {
  enabled: true, fraction: 0.1, reason: null,
  axes: [{ letter: "X", joint: 0, reason: null }, { letter: "Y", joint: null, reason: GANTRY },
         { letter: "Z", joint: 3, reason: null }],
};
const UNHOMED = { homed: false, homed_joints: [false, false, false] };
const HOMED = { homed: true, homed_joints: [true, true, true] };

function perms(over: Partial<Permissions> = {}): Permissions {
  const p = Object.fromEntries(GATE_NAMES.map((k) => [k, true])) as Permissions;
  p.pause = false; p.resume = false; p.toolChangeConfirm = false;
  return { ...p, ...over };
}

type Sent = { cmd?: string; axis?: number };
const sent = async (): Promise<Sent[]> => ((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [];
const jogs = async () => (await sent()).filter((c) => c.cmd?.startsWith("jog_")).map((c) => [c.cmd, c.axis]);

async function open(page: Page, homed: boolean) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { keyboard: { jogEnabled: true, buttonsEnabled: true } } } });
  await ctl({ op: "setJointJog", jointJog: JOINT_JOG });
  // the gateway's classes: jog open before homing (it is declared), no ready / run
  await ctl({ op: "status_delta", armed: true, data: { ...(homed ? HOMED : UNHOMED),
    permissions: perms(homed ? {} : { ready: false, run: false }), permission_reasons: {} } });
  await expect(page.locator(".pill.armed")).toHaveCount(1);
}

async function hold(page: Page, name: string) {
  const btn = page.locator('[data-strip="jog"]').getByRole("button", { name, exact: true });
  const box = (await btn.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

test("before homing: the gantry axis is dimmed with its reason, the head states the joint jog and its cap (BG-07)", async ({ page }) => {
  await open(page, false);
  const strip = page.locator('[data-strip="jog"]');
  await expect(strip.locator(".jogNote")).toContainText("Joint jog — no soft limits · max 10 %");
  for (const name of ["X+", "X-", "Z+", "Z-"]) {
    await expect(strip.getByRole("button", { name, exact: true }), name).toBeEnabled();
  }
  for (const name of ["Y+", "Y-"]) {
    const btn = strip.getByRole("button", { name, exact: true });
    await expect(btn, name).toBeDisabled();
    await expect(strip.locator(".btnTip", { has: page.getByRole("button", { name, exact: true }) }), name)
      .toHaveAttribute("title", GANTRY);
  }
  // a diagonal moves Y too: closed with the same reason (the pad's third
  // cell is X+Y+; the diagonals are icon-only, without a name of their own)
  const diagonal = strip.locator(".xyGrid > *").nth(2);
  await expect(diagonal).toHaveClass(/btnTip/);
  await expect(diagonal).toHaveAttribute("title", GANTRY);
  await ctl({ op: "clearCmds" });
  await hold(page, "X+");
  await expect.poll(jogs).toEqual([["jog_cont", 0], ["jog_stop", 0]]);
});

test("before homing the keyboard refuses the closed axis like the button, and jogs an open one", async ({ page }) => {
  await open(page, false);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await ctl({ op: "clearCmds" });
  await page.keyboard.down("ArrowUp");      // Y+: the gantry axis
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(300);
  expect(await jogs()).toEqual([]);
  await page.keyboard.down("ArrowRight");   // X+
  await page.keyboard.up("ArrowRight");
  await expect.poll(jogs).toEqual([["jog_cont", 0], ["jog_stop", 0]]);
});

test("homed: the axis letters as before, no note, every axis open", async ({ page }) => {
  await open(page, true);
  const strip = page.locator('[data-strip="jog"]');
  await expect(strip.locator(".jogNote")).toHaveCount(0);
  for (const name of ["X+", "Y+", "Z+"]) {
    await expect(strip.getByRole("button", { name, exact: true }), name).toBeEnabled();
  }
});

// Button gates package E (BG-07; operator E1–E3, 2026-10-28): jogging before
// homing where the machine declares it. The gateway decides which axis moves
// which joint, how fast and which axis stays closed (test_button_gates_e.py);
// the strip dims a closed axis with its reason, states the joint jog and its
// cap in its head, marks each button's joint in its corner — the buttons keep
// their axis letters (operator 2026-10-28) — and the keyboard refuses a
// closed axis like the button.
import { test, expect, type Page } from "./test";
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

async function open(page: Page, homed: boolean, jointJog: typeof JOINT_JOG = JOINT_JOG) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { keyboard: { jogEnabled: true, buttonsEnabled: true } } } });
  await ctl({ op: "setJointJog", jointJog });
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
  // each button marks the joint it moves in its corner (operator 2026-10-28):
  // X is joint 0, Z joint 3 (XYYZ); the closed Y has none; the names stay
  for (const [name, joint] of [["X+", "J0"], ["X-", "J0"], ["Z+", "J3"], ["Z-", "J3"]]) {
    await expect(strip.getByRole("button", { name, exact: true }).locator(".cornerLabel"), name).toHaveText(joint);
  }
  for (const name of ["Y+", "Y-"]) {
    await expect(strip.getByRole("button", { name, exact: true }).locator(".cornerLabel"), name).toHaveCount(0);
  }
  // the mark is for sight; assistive technology hears the joint as the
  // button's description (Codex R222 BG-37) — the name stays the axis
  for (const [name, joint] of [["X+", "Joint 0"], ["Z-", "Joint 3"]]) {
    await expect(strip.getByRole("button", { name, exact: true }), name).toHaveAccessibleDescription(joint);
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

test("before homing every open axis jogs in amber, the diagonals are closed with their reason; homed both are back (package F)", async ({ page }) => {
  // every axis its own joint (no gantry): the only closure left is the diagonal
  await open(page, false, { ...JOINT_JOG, axes: ["X", "Y", "Z"].map((letter, joint) => ({ letter, joint, reason: null })) });
  const strip = page.locator('[data-strip="jog"]');
  for (const name of ["X+", "X-", "Y+", "Y-", "Z+", "Z-"]) {
    const btn = strip.getByRole("button", { name, exact: true });
    await expect(btn, name).toBeEnabled();
    await expect(btn, `${name}: amber before homing`).toHaveClass(/\bwarn\b/);
  }
  await expect(strip.locator('[data-control="jogStop"]'), "the Stop stays red").not.toHaveClass(/\bwarn\b/);
  for (const cell of [0, 2, 6, 8]) {   // the pad's four corners: the diagonals
    const diagonal = strip.locator(".xyGrid > *").nth(cell);
    await expect(diagonal).toHaveClass(/btnTip/);
    await expect(diagonal).toHaveAttribute("title", "Diagonal jog after Home All");
  }
  await ctl({ op: "status_delta", data: { ...HOMED } });
  await expect(strip.getByRole("button", { name: "X+", exact: true })).not.toHaveClass(/\bwarn\b/);
  await expect(strip.locator(".xyGrid > *").nth(0)).not.toHaveClass(/btnTip/);
});

test("homed: the axis letters as before, no note, every axis open", async ({ page }) => {
  await open(page, true);
  const strip = page.locator('[data-strip="jog"]');
  await expect(strip.locator(".jogNote")).toHaveCount(0);
  await expect(strip.locator(".cornerLabel"), "homed: no joint marks").toHaveCount(0);
  await expect(strip.getByRole("button", { name: "X+", exact: true }), "homed: no joint description")
    .toHaveAccessibleDescription("");
  for (const name of ["X+", "Y+", "Z+"]) {
    await expect(strip.getByRole("button", { name, exact: true }), name).toBeEnabled();
  }
});

// Leftovers package (Codex notes at R219): the diagonals show an arrow only —
// each is named for its move; the head line is cut on a narrow strip and a
// touch has no hover title — its "?" says the whole note.
test("the diagonal jog buttons are named for their move; before homing the head line's \"?\" says the whole note", async ({ page }) => {
  await open(page, true);
  const jog = page.locator('[data-strip="jog"]');
  for (const name of ["Jog X- Y+", "Jog X+ Y+", "Jog X- Y-", "Jog X+ Y-"]) {
    await expect(jog.getByRole("button", { name, exact: true }), name).toHaveCount(1);
  }
  await expect(jog.getByRole("button", { name: "Help: Jogging before homing" }), "homed: no note, no help").toHaveCount(0);
  await open(page, false);
  const help = jog.getByRole("button", { name: "Help: Jogging before homing" });
  await help.click();
  await expect(page.locator(".helpPopover:popover-open")).toHaveText(
    "Not homed: each button moves its own joint, without soft limits, at most 10 % of its speed.");
});

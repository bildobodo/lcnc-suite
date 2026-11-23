import { test, expect, type Page } from "./test";
import { ctl, MOCK } from "./ctl";

// G30's stored tool-change position (operator point P4, Codex R21–R24):
// the fields are a DRAFT; "Use Current Position" fills it and writes nothing;
// Save is ONE set_g30 on the basis the draft started from, and the section
// shows only what LinuxCNC confirmed. A missing stored value is empty, never
// 0 (GET /g30 turned a missing row into 0.0). The old "Set Current Position"
// sent G30.1 and meant to show the position — the readout stayed old.
//
// The worker's own mock (e2e/test.ts): its state is this test's alone, reset
// and checked before every test.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, g30Capture: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  // button gates D
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
const STORED = { X: 100, Y: 0, Z: -26.275 };
const SETTINGS = { toolsetter: { touchX: 0, touchY: 0, touchZ: -300, fastFeed: 200, slowFeed: 20, traverseFeed: 500,
  maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180 } };

async function open(page: Page, g30: Record<string, number | null>, replies: Record<string, unknown> = {},
                    hold?: Promise<void>) {
  await ctl({ op: "reset" });
  await page.route("**/g30*", async r => {
    if (hold) await hold;          // a late file read (Codex R25 OP-I03)
    await r.fulfill({ contentType: "application/json",
      body: JSON.stringify({ ok: true, values: g30, mtime_ms: Date.UTC(2026, 8, 28, 12, 5), units: "mm" }) });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL, kins_type: 0 } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: SETTINGS } });
  await ctl({ op: "replies", replies });
  await page.getByRole("tab", { name: "Probing", exact: true }).click();
  await page.getByRole("tab", { name: "Toolsetter", exact: true }).click();
  await ctl({ op: "clearCmds" });
}
const sent = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; [k: string]: unknown }[])
  .filter(c => !["hello", "arm", "client_diag", "tab_visibility", "get_tool_table", "heartbeat"].includes(c.cmd));
const field = (page: Page, l: string) => page.getByLabel(`G30 ${l}`, { exact: true });
const values = async (page: Page) => Promise.all(["X", "Y", "Z"].map(l => field(page, l).inputValue()));
const storedLine = (page: Page) => page.locator(".g30Stored");
/** The G30 section's inline result — in the Toolsetter procedure, never a
 *  note of a hidden pane (the Macros tab's folder note is one). */
const note = (page: Page, kind: string) =>
  // the G30 notes — not the toolsetter's machine line (.tsMachine, P2)
  page.getByRole("tabpanel", { name: "Toolsetter", exact: true }).locator(`.statusNote.${kind}:not(.tsMachine)`);
/** Answer the request the page sent for `cmd` — a reply held back so the
 *  operator (or the status) can act while it is out. */
async function deliver(cmd: string, result: Record<string, unknown>) {
  await expect.poll(async () => (await sent()).some(c => c.cmd === cmd)).toBe(true);
  const c = (await sent()).find(x => x.cmd === cmd)!;
  await ctl({ op: "raw", frame: { type: "reply", cmd, req_id: c.req_id, ...result } });
}
/** An entry through the field's keypad, the operator's way. */
async function enter(page: Page, l: string, value: number) {
  await field(page, l).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
  await expect(field(page, l)).toHaveValue(String(value));
}


test("R437 capture can be discarded even when its starting draft was clean", async ({page}) => {
  await open(page, STORED);
  await expect.poll(() => values(page)).toEqual(["100", "0", "-26.275"]);
  await page.getByRole("button", {name:"Use Current Position", exact:true}).click();
  await expect.poll(async () => (await sent()).map(c=>c.cmd)).toContain("capture_g30");
  const discard = page.getByRole("button", {name:"Discard G30 draft",exact:true});
  await expect(discard).toBeEnabled({timeout:1500});
  await discard.click();
  await deliver("capture_g30", {ok:true,confirmed:true,values:STORED,current:{X:10,Y:20,Z:-5},units:"mm"});
  await expect.poll(() => values(page)).toEqual(["100", "0", "-26.275"]);
});

test("R437 Refresh preserves a newer entry even when it equals the previous stored value", async ({page}) => {
  await open(page, STORED);
  await expect.poll(() => values(page)).toEqual(["100", "0", "-26.275"]);
  await page.getByRole("button", {name:"Refresh", exact:true}).click();
  await expect.poll(async () => (await sent()).map(c=>c.cmd)).toContain("read_g30");
  await enter(page,"X",120);
  await enter(page,"X",100);
  await deliver("read_g30", {ok:true,confirmed:true,values:{...STORED,X:105}});
  await expect(storedLine(page)).toHaveText(/confirmed by LinuxCNC/);
  await expect(field(page,"X")).toHaveValue("100",{timeout:1500});
});

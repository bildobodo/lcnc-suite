import { test, expect, type Page, type Locator } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

// Design wave D2 (UI-K11, K16(3), UI-D01, UI-D06; plan Anhang B) — the
// dialog contract, scanned per dialog from ONE table (Anhang B is the only
// target per dialog):
//
//   - `role="dialog"` on the dialog container, named by its title
//     (aria-labelledby) — the accessible name IS the title the table holds;
//   - its tier (sm confirm / md / lg), and every open overlay registered
//     (the registry self-test the keyboard guards pin, extended — not
//     replaced);
//   - the initial focus Anhang B names (form: first field, confirm: the safe
//     action, flow: the neutral cancel where there is one, else the
//     container, info: X or the search field);
//   - Tab and Shift+Tab reach ONLY the topmost dialog, its own input helper,
//     the safety strip and the banner's Abort / Acknowledge (UI-D01);
//   - Escape is E-Stop — exactly `estop`, the dialog stays;
//   - the backdrop closes info/confirm dialogs and does nothing on forms and
//     machine flows (N41);
//   - closing returns focus to the control that opened it.
//
// Plus the acceptance cases of UI-D01 (Abort from inside a dialog, also
// stacked and with an input helper open, then a gate change) and UI-D06 (a
// dialog opening over a field's keypad PAUSES it: the draft survives, is
// unreachable meanwhile and comes back exact; nothing is applied).
//
// Runs under `serial-guards`: mock-global state, one file at a time.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};

const READ_ONLY_CMDS = ["hello", "heartbeat", "get_tool_table", "halshow_live", "timing_log",
                        "tab_visibility", "save_settings", "load_file"];

const PROGRAM = "(program A)\nG0 X0\nG1 X10 F100\nG1 Y10\nM2\n";
const TOOL = { T: 5, P: 5, Z: -40, D: 6, type: "endmill", description: "Test cutter" };
const PAD_ID = "Test Pad (Vendor: 045e Product: 028e)";
const MACROS = {
  macros: [
    { id: "m-face", name: "Face Top", command: "G0 Z{depth}", params: [{ name: "depth", label: "Depth", default: "5" }] },
    { id: "m-park", name: "Park", command: "G53 G0 Z0", params: [] },
  ],
};

async function cmds(): Promise<string[]> {
  const sent = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] };
  return (sent.cmds ?? []).map(c => c.cmd ?? "").filter(c => !READ_ONLY_CMDS.includes(c));
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

async function expectRegistryMatchesDom(page: Page) {
  const [dom, registered] = await page.evaluate(() => [
    document.querySelectorAll(".dialogOverlay").length,
    (window as any).__modalRegistry.count(),
  ]);
  expect(registered, `registry ${registered} vs DOM overlays ${dom}`).toBe(dom);
}

/** A plugged-in pad the Settings Gamepad tab can see (no button pressed). */
async function fakeGamepad(page: Page) {
  await page.addInitScript((id: string) => {
    const pad = {
      id, index: 0, connected: true, mapping: "standard", timestamp: 0,
      axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad, null, null, null] });
  }, PAD_ID);
}

async function ready(page: Page, settings: Record<string, unknown> = {}) {
  await ctl({ op: "reset" });
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: PROGRAM }));
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", permissions: PERMS_ALL } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings } });
  await expect(page.locator(".safetyStrip")).toBeVisible();
  await ctl({ op: "clearCmds" });
}

let gcodeVersion = 500;
async function loadProgram(page: Page) {
  gcodeVersion++;
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: gcodeVersion, file: "/A.ngc" } });
  await expect(page.locator(".codeLine").first()).toContainText("(program A)");
}

async function openTools(page: Page) {
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect.poll(async () => {
    await ctl({ op: "raw", frame: { type: "reply", cmd: "get_tool_table", ok: true, tools: [TOOL] } });
    return page.getByTitle("Edit tool", { exact: true }).count();
  }).toBe(1);
}

async function openSettingsTab(page: Page, tab: string): Promise<Locator> {
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: tab, exact: true }).click();
  return settings;
}

async function openImportPreview(page: Page) {
  await page.route("**/import-tool-library", route => route.fulfill({ json: {
    ok: true, tools: [{ ...TOOL, T: 1 }], total: 1, existing_count: 3, skipped_duplicates: [],
    metadata_refresh: { rows: [], updated: [], skipped: [], revision: "r1" },
  } }));
  await openTools(page);
  await page.locator('input[type="file"][accept*=".fctb"]').setInputFiles(
    { name: "tools.json", mimeType: "application/json", buffer: Buffer.from('{"data":[]}') });
}

/** Where focus sits relative to the topmost dialog's focus scope. */
async function focusPlace(page: Page, dialog: Locator): Promise<string> {
  const handle = await dialog.elementHandle();
  return page.evaluate((d) => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || a === document.body || a === document.documentElement) return "body";
    if (d!.contains(a)) return "dialog";
    const own = new Set([...d!.querySelectorAll("[data-input-area]")].map(e => e.getAttribute("data-input-area")));
    const area = a.closest("[data-input-area]")?.getAttribute("data-input-area");
    if (area && own.has(area)) return "helper";
    if (a.closest(".safetyStrip")) return "safety";
    if (a.closest("[data-dialog-reachable]")) return "banner";
    return `outside: ${a.getAttribute("aria-label") || a.getAttribute("title") || (a.textContent ?? "").trim().slice(0, 40) || a.tagName}`;
  }, handle);
}

/** The dialog holding keyboard focus is the one on screen: a pointer at
 *  the focused element's centre hits that dialog, never the scrim of
 *  another one over it (implementation review UI-DI01). An element
 *  scrolled out of the viewport has no centre to probe and passes. */
async function expectFocusVisible(page: Page, dialog: Locator, what = "focus") {
  const handle = await dialog.elementHandle();
  const verdict = await page.evaluate((d) => {
    const a = document.activeElement as HTMLElement | null;
    if (!a || !d!.contains(a)) return "focus is not in the dialog";
    const r = a.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return "ok";
    const hit = document.elementFromPoint(x, y);
    if (hit && d!.contains(hit)) return "ok";
    const over = hit?.closest(".dialogOverlay")?.querySelector(".dialogTitle")?.textContent?.trim();
    return `covered by ${over ?? hit?.tagName ?? "nothing"}`;
  }, handle);
  expect(verdict, what).toBe("ok");
}

/** Tab and Shift+Tab walk only the topmost dialog, its own helper, the
 *  safety strip and the banner's Abort / Acknowledge (UI-D01). Backwards
 *  first: the initial focus sits early in the dialog, so Shift+Tab wraps to
 *  the scope's end (the safety strip) within a few steps even in Settings —
 *  forward first, 24 steps never left a large dialog and the return trip
 *  walked the same stops back. */
async function expectTabScope(page: Page, dialog: Locator, steps = 24) {
  const seen: Record<string, number> = {};
  for (const key of ["Shift+Tab", "Tab"]) {
    for (let i = 0; i < steps; i++) {
      await page.keyboard.press(key);
      const place = await focusPlace(page, dialog);
      expect(place, `${key} #${i + 1}`).toMatch(/^(dialog|helper|safety|banner)$/);
      if (place === "dialog") await expectFocusVisible(page, dialog, `${key} #${i + 1} on screen`);
      seen[place] = (seen[place] ?? 0) + 1;
    }
  }
  expect(seen["safety"] ?? 0, "the safety strip stays reachable").toBeGreaterThan(0);
  return seen;
}

interface Row {
  /** Anhang B number and short name. */
  id: string;
  /** The dialog's accessible name (= its title). */
  title: string | RegExp;
  tier: "sm" | "md" | "lg";
  backdrop: "closes" | "stays";
  /** The initial focus Anhang B names. */
  focus: (dialog: Locator, page: Page) => Locator;
  /** Opens the dialog from a ready page; returns the control focus returns
   *  to after the close, or null (opened by the machine / a file pick). */
  open: (page: Page) => Promise<Locator | null>;
  /** The safe close (Cancel / X / Keep editing / the machine ending it). */
  close: (dialog: Locator, page: Page) => Promise<void>;
  settings?: Record<string, unknown>;
  before?: (page: Page) => Promise<void>;
  /** Action buttons, left to right (N40: the cancel side left). */
  actions?: string[];
  /** Dialogs the machine drives: no backdrop probe beyond "stays". */
  machine?: boolean;
}

const byName = (name: string | RegExp) => (d: Locator) => d.getByRole("button", { name, exact: typeof name === "string" });
const firstField = (d: Locator) => d.locator("input:not([type=hidden]), select, textarea").first();

const ROWS: Row[] = [
  {
    id: "1 Program Stats", title: "Program Stats", tier: "md", backdrop: "closes",
    focus: byName("Close program stats"),
    open: async (page) => {
      await loadProgram(page);
      const trigger = page.getByRole("button", { name: "Stats", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Close program stats")(d).click(); },
  },
  {
    id: "2 Settings", title: "Settings", tier: "lg", backdrop: "closes",
    focus: (d) => d.locator("button.selected").first(),
    open: async (page) => {
      const trigger = page.getByTitle("Settings", { exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Close settings")(d).click(); },
  },
  {
    id: "3 Settings discard", title: "Discard changes?", tier: "sm", backdrop: "closes",
    focus: byName("Keep editing"), actions: ["Keep editing", "Discard"],
    open: async (page) => {
      const settings = await openSettingsTab(page, "Macros");
      await settings.getByRole("button", { name: "Add Macro", exact: true }).click();
      await settings.locator("#macro-edit-name").fill("Face top");
      const trigger = settings.getByRole("button", { name: "Close settings", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Keep editing")(d).click(); },
  },
  {
    id: "4 Messages", title: /^Messages/, tier: "lg", backdrop: "closes",
    focus: byName("Close messages"),
    open: async (page) => {
      const trigger = page.getByTitle(/^Messages \(\d+\)$/);
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Close messages")(d).click(); },
  },
  {
    id: "4a Clear all messages", title: "Clear all messages?", tier: "sm", backdrop: "closes",
    focus: byName("Cancel"), actions: ["Cancel", "Clear All"],
    before: async (page) => {
      await page.addInitScript(() => {
        try {
          localStorage.setItem("lcnc-messages", JSON.stringify([
            { id: 1, kind: 11, text: "Program paused at line 12", ts: Date.now(), read: true },
          ]));
        } catch { /* private window: the scan then has no message and fails loudly below */ }
      });
    },
    open: async (page) => {
      await page.getByTitle(/^Messages \(\d+\)$/).click();
      const messages = page.getByRole("dialog", { name: /^Messages/ });
      const trigger = messages.getByRole("button", { name: "Clear All", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "5 Tool change", title: "Load Tool into Spindle", tier: "sm", backdrop: "stays", machine: true,
    focus: (d) => d, actions: ["Abort", "Confirm"],
    open: async () => {
      await ctl({ op: "status_delta", data: { tool_change_requested: true, tool_change_tool: 3 } });
      return null;
    },
    close: async () => { await ctl({ op: "status_delta", data: { tool_change_requested: false } }); },
  },
  {
    id: "6 Macro parameters", title: "Face Top", tier: "md", backdrop: "stays", settings: { macros: MACROS },
    focus: firstField, actions: ["Cancel", "Execute"],
    open: async (page) => {
      const trigger = page.locator(".macroBar").getByRole("button", { name: "Face Top", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "7 Shutdown", title: "Shut Down LinuxCNC?", tier: "sm", backdrop: "stays",
    focus: byName("Cancel"), actions: ["Cancel", "Shut Down"],
    open: async (page) => {
      const trigger = page.getByTitle("Shut Down LinuxCNC", { exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "8 Compensation", title: "Enable surface compensation?", tier: "sm", backdrop: "stays",
    focus: byName("Cancel"), actions: ["Cancel", "Enable"],
    open: async (page) => {
      await page.getByRole("button", { name: "Probing", exact: true }).click();
      await page.getByRole("button", { name: "Surface", exact: true }).click();
      const toggle = page.getByLabel("Enable Compensation", { exact: true });
      await toggle.click();
      return null;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "9 G-code Reference", title: "G-code Reference", tier: "lg", backdrop: "closes",
    focus: (d) => d.getByRole("textbox", { name: "Search G-code reference", exact: true }),
    open: async (page) => {
      const trigger = page.getByTitle("G-code Reference", { exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Close reference")(d).click(); },
  },
  {
    id: "10 Probe calibration reset", title: "Reset probe calibration?", tier: "sm", backdrop: "closes",
    focus: byName("Cancel"), actions: ["Cancel", "Reset"],
    open: async (page) => {
      await page.getByRole("button", { name: "Probing", exact: true }).click();
      await page.getByRole("button", { name: "Calibrate", exact: true }).click();
      const trigger = page.locator(".sidePane").getByRole("button", { name: "Reset Calibration", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "11 Editor discard", title: "Discard changes?", tier: "sm", backdrop: "closes",
    focus: byName("Keep editing"), actions: ["Keep editing", "Discard"],
    open: async (page) => {
      await loadProgram(page);
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator(".cm-content").click();
      await page.keyboard.press("End");
      await page.keyboard.type("(edited)");
      const trigger = page.getByRole("button", { name: "Discard", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Keep editing")(d).click(); },
  },
  {
    id: "12 Upload conflict", title: "Upload Conflict", tier: "md", backdrop: "stays",
    focus: firstField, actions: ["Cancel", "Rename", "Replace"],
    before: async (page) => {
      await page.route("**/upload*", route => route.fulfill({ status: 409, json: { detail: { error: "exists", filename: "dup.ngc" } } }));
    },
    open: async (page) => {
      await page.locator('input[type="file"][accept*=".ngc"]').setInputFiles(
        { name: "dup.ngc", mimeType: "text/plain", buffer: Buffer.from("G0 X0\nM2\n") });
      return null;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "13 Run from line", title: /^Run from Line \d+$/, tier: "md", backdrop: "stays",
    settings: { machine: { runFromLine: true } },
    // At 1280 × 720 its warning text fills the box and the first option lies
    // below it: the container (the initial focus never hides the beginning;
    // the tall case is its own test below).
    focus: (d) => d, actions: ["Cancel", /^Run from Line/ as unknown as string],
    open: async (page) => {
      await loadProgram(page);
      await page.locator(".codeLine").nth(2).click();
      // A selected line names the start: "Start L3".
      const trigger = page.getByRole("button", { name: /^Start L\d+$/ });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "14 Delete tool", title: "Delete T5?", tier: "sm", backdrop: "closes",
    focus: byName("Cancel"), actions: ["Cancel", "Delete"],
    open: async (page) => {
      await openTools(page);
      const trigger = page.getByTitle("Delete tool", { exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "15 Tool editor", title: "Add Tool", tier: "md", backdrop: "stays",
    focus: firstField,
    open: async (page) => {
      await openTools(page);
      const trigger = page.getByRole("button", { name: "+ Add", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "16 Tool editor discard", title: "Discard changes?", tier: "sm", backdrop: "closes",
    focus: byName("Keep editing"), actions: ["Keep editing", "Discard"],
    open: async (page) => {
      await openTools(page);
      await page.getByRole("button", { name: "+ Add", exact: true }).click();
      const editor = page.getByRole("dialog", { name: "Add Tool", exact: true });
      await editor.locator("label", { hasText: "Description" }).locator("xpath=following-sibling::input[1]").fill("draft");
      const trigger = editor.getByRole("button", { name: "Cancel", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Keep editing")(d).click(); },
  },
  {
    id: "17 Import preview", title: "Import Fusion 360 Tool Library", tier: "md", backdrop: "stays",
    focus: firstField,
    open: async (page) => { await openImportPreview(page); return null; },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "18 Replace table", title: "Replace entire tool table?", tier: "sm", backdrop: "closes",
    focus: byName("Cancel"), actions: ["Cancel", "Replace table"],
    open: async (page) => {
      await openImportPreview(page);
      const preview = page.getByRole("dialog", { name: "Import Fusion 360 Tool Library", exact: true });
      await preview.getByLabel("Import mode").selectOption("replace");
      const trigger = preview.getByRole("button", { name: "Replace table", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "19 Remove gamepad profile", title: "Remove profile?", tier: "sm", backdrop: "closes",
    settings: { gamepad: { profiles: { [PAD_ID]: { id: PAD_ID, buttons: {}, sticks: {} } } } },
    before: fakeGamepad,
    focus: byName("Cancel"), actions: ["Cancel", "Remove"],
    open: async (page) => {
      const settings = await openSettingsTab(page, "Gamepad");
      const trigger = settings.getByRole("button", { name: "Remove Profile", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "20 Delete macro", title: 'Delete macro "Face Top"?', tier: "sm", backdrop: "closes", settings: { macros: MACROS },
    focus: byName("Cancel"), actions: ["Cancel", "Delete"],
    open: async (page) => {
      const settings = await openSettingsTab(page, "Macros");
      const trigger = settings.getByRole("button", { name: "Delete macro Face Top", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "21 Reset settings", title: "Reset 3D Viewer settings?", tier: "sm", backdrop: "closes",
    focus: byName("Cancel"), actions: ["Cancel", "Reset"],
    open: async (page) => {
      const settings = await openSettingsTab(page, "3D Viewer");
      const trigger = settings.getByRole("button", { name: "Reset 3D Viewer", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
  {
    id: "22 Gamepad mapping wizard", title: "Map Controller", tier: "md", backdrop: "stays", before: fakeGamepad,
    focus: (d) => d,
    open: async (page) => {
      const settings = await openSettingsTab(page, "Gamepad");
      const trigger = settings.getByRole("button", { name: "Map Buttons…", exact: true });
      await trigger.click();
      return trigger;
    },
    close: async (d) => { await byName("Cancel")(d).click(); },
  },
];

test.afterEach(async () => {
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

for (const row of ROWS) {
  test(`dialog ${row.id}: role and name, tier, initial focus, Tab scope, Escape = E-Stop, backdrop, focus return`, async ({ page }) => {
    await row.before?.(page);
    await ready(page, row.settings);
    const trigger = await row.open(page);
    const dialog = page.getByRole("dialog", { name: row.title, exact: typeof row.title === "string" });
    await expect(dialog).toBeVisible();
    await expect(dialog, "one dialog by that name").toHaveCount(1);
    await expectRegistryMatchesDom(page);

    // Tier: sm = the bare .dialog (confirm), md / lg their modifiers.
    const cls = (await dialog.getAttribute("class")) ?? "";
    expect(cls.split(/\s+/)).toContain("dialog");
    if (row.tier === "sm") expect(cls).not.toMatch(/\b(md|lg)\b/);
    else expect(cls.split(/\s+/)).toContain(row.tier);

    // The topmost dialog is this one: nothing above it in the stack.
    const topId = await page.evaluate(() => (window as any).__modalRegistry.top?.() ?? null);
    expect(topId, "the registry knows a topmost dialog").toBeTruthy();
    expect(topId, "the scanned dialog is the topmost").toBe(await dialog.getAttribute("id"));

    if (row.actions) {
      const names = await dialog.locator(".dialogActions button").evaluateAll(
        els => els.map(e => (e.getAttribute("aria-label") || e.textContent || "").trim()));
      expect(names.length, `actions ${names.join(" | ")}`).toBe(row.actions.length);
      row.actions.forEach((want, i) => {
        if (typeof want === "string") expect(names[i]).toBe(want);
        else expect(names[i]).toMatch(want as unknown as RegExp);
      });
    }

    await expect(row.focus(dialog, page), "initial focus (Anhang B)").toBeFocused();
    await expectFocusVisible(page, dialog, "the initial focus is on screen");

    await expectTabScope(page, dialog);

    // Escape is E-Stop — exactly `estop`, never a close.
    await ctl({ op: "clearCmds" });
    await page.keyboard.press("Escape");
    await settle(page);
    await expect.poll(cmds).toEqual(["estop"]);
    await expect(dialog).toBeVisible();

    // Put focus back where a close by pointer starts from (the dialog).
    await row.focus(dialog, page).focus().catch(() => {});

    // Backdrop: info / confirm close, forms and machine flows stay (N41).
    const overlay = dialog.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' dialogOverlay ')][1]");
    await overlay.click({ position: { x: 3, y: 3 } });
    await settle(page);
    if (row.backdrop === "closes") {
      await expect(dialog).toHaveCount(0);
    } else {
      await expect(dialog).toBeVisible();
      await row.close(dialog, page);
      await expect(dialog).toHaveCount(0);
    }
    await expectRegistryMatchesDom(page);
    if (trigger) await expect(trigger, "focus returns to the control that opened it").toBeFocused();
    await ctl({ op: "clearCmds" });
    await settle(page);
    expect(await cmds(), "closing sent nothing").toEqual([]);
  });
}

test("UI-D01: from inside a dialog Tab reaches the banner's Abort — Enter sends exactly abort, also stacked and with a helper open", async ({ page }) => {
  await ready(page, { macros: MACROS });
  const running = { interp_state: 2, task_mode: 2, permissions: { ...PERMS_ALL, pause: true, idle: false, ready: false, run: false, setup: false } };
  await ctl({ op: "status_delta", data: running });
  const abortBtn = page.locator(".bannerActions").getByRole("button", { name: /Abort/ });
  await expect(abortBtn).toBeVisible();

  const tabToAbort = async (dialog: Locator) => {
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      if (await abortBtn.evaluate(el => el === document.activeElement || el.contains(document.activeElement))) return;
      expect(await focusPlace(page, dialog)).toMatch(/^(dialog|helper|safety|banner)$/);
    }
    throw new Error("Tab never reached the banner's Abort");
  };

  // 1. Settings (host).
  const settings = await openSettingsTab(page, "Macros");
  await tabToAbort(settings);
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("Enter");
  await expect.poll(cmds).toEqual(["abort"]);

  // 2. Stacked: a draft in the macro editor, Settings' X asks.
  await ctl({ op: "status_delta", data: running });
  await settings.getByRole("button", { name: "Add Macro", exact: true }).click();
  await settings.locator("#macro-edit-name").fill("Face top");
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Discard changes?", exact: true });
  await expect(ask).toBeVisible();
  await tabToAbort(ask);
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("Enter");
  await expect.poll(cmds).toEqual(["abort"]);
  await ask.getByRole("button", { name: "Keep editing", exact: true }).click();

  // 3. A text helper open on a Settings field: Tab passes through its keys.
  await ctl({ op: "status_delta", data: running });
  await settings.locator("#macro-edit-name").click();
  await expect(page.locator(".tkStrip")).toBeVisible();
  await tabToAbort(settings);
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("Enter");
  await expect.poll(cmds).toEqual(["abort"]);

  // 4. The gate changes (the run ended): Abort leaves, Tab stays in scope,
  //    Space and Enter start nothing.
  await ctl({ op: "status_delta", data: { interp_state: 1, task_mode: 1, permissions: PERMS_ALL } });
  await expect(abortBtn).toHaveCount(0);
  await ctl({ op: "clearCmds" });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await focusPlace(page, settings)).toMatch(/^(dialog|helper|safety|banner)$/);
  }
  await settings.focus();
  await page.keyboard.press(" ");
  await settle(page);
  expect(await cmds()).toEqual([]);
});

test("UI-D06: a dialog over a field's keypad pauses it — the draft survives unreachable and comes back exact, nothing is applied", async ({ page }) => {
  await ready(page);
  await openTools(page);
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add Tool", exact: true });
  await expect(editor).toBeVisible();
  const nk = page.locator(".nkStrip");
  // A number field: read-only text input, the keypad is its only entry.
  const field = editor.locator('input.inputField[inputmode="none"]').first();
  const before = await field.inputValue();
  const toolChange = page.getByRole("dialog", { name: "Load Tool into Spindle", exact: true });

  const pauseAndResume = async (expr: string) => {
    await ctl({ op: "status_delta", data: { tool_change_requested: true, tool_change_tool: 3 } });
    await expect(toolChange).toBeVisible();
    await expect(nk, "the parent's keypad is paused").toHaveCount(0);
    await page.waitForTimeout(700);   // > two visibility polls (300 ms)
    await expect(nk).toHaveCount(0);
    // Unreachable: Tab stays in the flow dialog's scope, a tap lands on its scrim.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await focusPlace(page, toolChange)).toMatch(/^(dialog|helper|safety|banner)$/);
    }
    const box = (await field.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(nk).toHaveCount(0);
    await ctl({ op: "status_delta", data: { tool_change_requested: false } });
    await expect(toolChange).toHaveCount(0);
    await field.click();
    await expect(nk.locator("[data-draft]")).toHaveText("draft");
    await expect(nk.locator(".nkExpr")).toHaveText(expr);
    await expect(field).toHaveValue(before);
  };

  // An expression, not applied.
  await field.click();
  await expect(nk).toBeVisible();
  await page.keyboard.type("2*3");
  await pauseAndResume("2×3");          // the readout shows × for *
  // The empty entry (after Clear) is a draft of 0.
  await nk.getByRole("button", { name: "Clear entry", exact: true }).click();
  await pauseAndResume("0");
  // A draft already filed by a tap outside is left as it is.
  await page.keyboard.type("7");
  await editor.locator(".dialogTitle").click();
  await expect(nk).toHaveCount(0);
  await ctl({ op: "status_delta", data: { tool_change_requested: true, tool_change_tool: 3 } });
  await expect(toolChange).toBeVisible();
  await ctl({ op: "status_delta", data: { tool_change_requested: false } });
  await expect(toolChange).toHaveCount(0);
  await field.click();
  await expect(nk.locator("[data-draft]")).toHaveText("draft");
  await expect(nk.locator(".nkExpr")).toHaveText("7");
  // Only Discard ends it.
  await nk.getByRole("button", { name: "Discard", exact: true }).click();
  await field.click();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
  await expect(field).toHaveValue(before);
  expect((await cmds()).filter(c => c !== "estop")).toEqual([]);
});

test("closing a whole stack returns focus once, to the control that opened the bottom dialog — Space sends nothing", async ({ page }) => {
  // Settings → a dirty macro draft → X asks → Discard unmounts BOTH frames in
  // one tick: the ask's own return target (Settings' X) is gone, the Settings
  // return must win and land on the header button, never on body (where
  // Space is Cycle Start). Same for the tool editor's Cancel → Discard.
  await ready(page, { macros: MACROS });
  const opener = page.getByTitle("Settings", { exact: true });
  const settings = await openSettingsTab(page, "Macros");
  await settings.getByRole("button", { name: "Add Macro", exact: true }).click();
  await settings.locator("#macro-edit-name").fill("Face top");
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Discard changes?", exact: true });
  await ask.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(opener, "focus returns to the header's Settings button").toBeFocused();
  // Space activates the focused button (Settings opens again) — never the
  // machine: no command.
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");
  await settle(page);
  expect(await cmds(), "Space after the stack closed").toEqual([]);
  const again = page.getByRole("dialog", { name: "Settings", exact: true });
  if (await again.count()) await again.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(again).toHaveCount(0);

  await openTools(page);
  const add = page.getByRole("button", { name: "+ Add", exact: true });
  await add.click();
  const editor = page.getByRole("dialog", { name: "Add Tool", exact: true });
  await editor.locator("label", { hasText: "Description" }).locator("xpath=following-sibling::input[1]").fill("draft");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("dialog", { name: "Discard changes?", exact: true }).getByRole("button", { name: "Discard", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(add, "focus returns to + Add").toBeFocused();
  await expectRegistryMatchesDom(page);
});

// ── Implementation review round 1 (Codex, 2026-09-26) ──

const topId = (page: Page) => page.evaluate(() => (window as any).__modalRegistry.top?.() ?? null);

test("UI-DI01: a machine flow stays the operating position whichever dialog opened first — layer, focus and Tab scope agree", async ({ page }) => {
  await ready(page);
  const toolChange = page.getByRole("dialog", { name: "Load Tool into Spindle", exact: true });
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const shutdown = page.getByRole("dialog", { name: "Shut Down LinuxCNC?", exact: true });
  const messages = page.getByRole("dialog", { name: /^Messages/ });
  const requestToolChange = () => ctl({ op: "status_delta", data: { tool_change_requested: true, tool_change_tool: 5 } });
  const endToolChange = () => ctl({ op: "status_delta", data: { tool_change_requested: false } });
  const expectOperating = async (d: Locator, focus: Locator) => {
    await expect.poll(() => topId(page), "the registry's top is the visible dialog").toBe(await d.getAttribute("id"));
    await expect(focus).toBeFocused();
    await expectFocusVisible(page, d);
    await expectTabScope(page, d, 8);
    await expectRegistryMatchesDom(page);
  };
  const tabReaches = async (d: Locator, name: string) => {
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      if (await d.getByRole("button", { name, exact: true }).evaluate(el => el === document.activeElement)) return;
    }
    throw new Error(`Tab never reached ${name}`);
  };

  // 1. Tool change first, then Settings from the header (a pointer reaches
  //    the header): Settings waits BEHIND the flow — no focus, no scope.
  await requestToolChange();
  await expect(toolChange).toBeVisible();
  await page.getByTitle("Settings", { exact: true }).click();
  await expect(settings).toHaveCount(1);
  await expectOperating(toolChange, toolChange);
  await tabReaches(toolChange, "Abort");
  // The flow ends: Settings is the operating position now.
  await endToolChange();
  await expect(toolChange).toHaveCount(0);
  await expect.poll(() => topId(page)).toBe(await settings.getAttribute("id"));
  await expect.poll(() => focusPlace(page, settings)).toBe("dialog");
  await expectFocusVisible(page, settings);
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(settings).toHaveCount(0);

  // 2. Settings first, then the tool change: the flow on top, focus back
  //    in Settings when it ends.
  await page.getByTitle("Settings", { exact: true }).click();
  await expect(settings).toBeVisible();
  await requestToolChange();
  await expectOperating(toolChange, toolChange);
  await endToolChange();
  await expect(toolChange).toHaveCount(0);
  await expect.poll(() => focusPlace(page, settings)).toBe("dialog");
  await expectFocusVisible(page, settings);
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(settings).toHaveCount(0);

  // 3. Shutdown first, then Messages from the header: Messages waits behind.
  await page.getByTitle("Shut Down LinuxCNC", { exact: true }).click();
  await expect(shutdown).toBeVisible();
  await page.getByTitle(/^Messages \(\d+\)$/).click();
  await expect(messages).toHaveCount(1);
  await expectOperating(shutdown, shutdown.getByRole("button", { name: "Cancel", exact: true }));
  await shutdown.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(shutdown).toHaveCount(0);
  await expect.poll(() => focusPlace(page, messages)).toBe("dialog");
  await expectFocusVisible(page, messages);
  await messages.getByRole("button", { name: "Close messages", exact: true }).click();
  await expect(messages).toHaveCount(0);

  // 4. Messages first, then Shutdown: the flow on top; its Cancel hands
  //    focus to Messages, not to the header button behind nothing.
  await page.getByTitle(/^Messages \(\d+\)$/).click();
  await expect(messages).toBeVisible();
  await page.getByTitle("Shut Down LinuxCNC", { exact: true }).click();
  await expectOperating(shutdown, shutdown.getByRole("button", { name: "Cancel", exact: true }));
  await shutdown.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(shutdown).toHaveCount(0);
  await expect.poll(() => focusPlace(page, messages)).toBe("dialog");
  await messages.getByRole("button", { name: "Close messages", exact: true }).click();

  await ctl({ op: "clearCmds" });
  await settle(page);
  expect((await cmds()).filter(c => c !== "estop"), "no machine action").toEqual([]);
});

test("UI-DI02: a lower dialog closing under a surviving top leaves focus in the top — typed text never reaches the hidden panel", async ({ page }) => {
  await ready(page);
  await openTools(page);
  const search = page.locator("input.toolSearch");
  await search.click();
  const toolChange = page.getByRole("dialog", { name: "Load Tool into Spindle", exact: true });
  const shutdown = page.getByRole("dialog", { name: "Shut Down LinuxCNC?", exact: true });
  const cancel = shutdown.getByRole("button", { name: "Cancel", exact: true });

  // Two flows: the tool change (machine) under the Shutdown confirm.
  await ctl({ op: "status_delta", data: { tool_change_requested: true, tool_change_tool: 5 } });
  await expect(toolChange).toBeVisible();
  const shutdownBtn = page.getByTitle("Shut Down LinuxCNC", { exact: true });
  await shutdownBtn.click();
  await expect(cancel).toBeFocused();
  // The machine ends the tool change while the confirm stays.
  await ctl({ op: "status_delta", data: { tool_change_requested: false } });
  await expect(toolChange).toHaveCount(0);
  await settle(page);
  await expect(cancel, "focus stays on the surviving top").toBeFocused();
  await expectFocusVisible(page, shutdown);
  // No space in the text: Space on the focused Cancel would activate it.
  await page.keyboard.type("invisible");
  await expect(search, "the hidden search field is untouched").toHaveValue("");
  await expectRegistryMatchesDom(page);
  // The confirm closes last: back to the control that opened it.
  await cancel.click();
  await expect(shutdown).toHaveCount(0);
  await expect(shutdownBtn).toBeFocused();

  // An asynchronous success closes a LOWER form: the tool editor's save
  // replies while Settings (opened meanwhile from the header) is on top.
  const add = page.getByRole("button", { name: "+ Add", exact: true });
  await add.click();
  const editor = page.getByRole("dialog", { name: "Add Tool", exact: true });
  await editor.getByRole("button", { name: "Add", exact: true }).click();
  let save: { req_id?: string } | undefined;
  await expect.poll(async () => {
    const sent = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string; req_id?: string }[] };
    save = (sent.cmds ?? []).find(c => c.cmd === "add_tool");
    return !!save;
  }).toBe(true);
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await expect.poll(() => focusPlace(page, settings)).toBe("dialog");
  await ctl({ op: "raw", frame: { type: "reply", cmd: "add_tool", req_id: save!.req_id, ok: true } });
  await expect(editor).toHaveCount(0);
  await settle(page);
  expect(await focusPlace(page, settings), "focus stays in Settings").toBe("dialog");
  await expectFocusVisible(page, settings);
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");
  await settle(page);
  expect(await cmds(), "Space after the lower close").toEqual([]);
  await expectRegistryMatchesDom(page);
});

test("the initial focus never hides the beginning of a dialog: Run from line focuses its first option only while it is in view", async ({ page }) => {
  const openRfl = async () => {
    await ready(page, { machine: { runFromLine: true } });
    await loadProgram(page);
    await page.locator(".codeLine").nth(2).click();
    await page.getByRole("button", { name: /^Start L\d+$/ }).click();
    const d = page.getByRole("dialog", { name: /^Run from Line \d+$/ });
    await expect(d).toBeVisible();
    return d;
  };
  const scrollTop = (d: Locator) => d.locator(".dialogContent").evaluate(el => el.scrollTop);
  // Tall content area: the first option is in view and takes focus.
  await page.setViewportSize({ width: 1600, height: 1000 });
  let d = await openRfl();
  await expect(firstField(d)).toBeFocused();
  await expectFocusVisible(page, d);
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  // Short content area: the container, the warning text stays at the top.
  await page.setViewportSize({ width: 1280, height: 720 });
  d = await openRfl();
  await expect(d).toBeFocused();
  expect(await scrollTop(d), "the beginning stays in view").toBe(0);
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
});

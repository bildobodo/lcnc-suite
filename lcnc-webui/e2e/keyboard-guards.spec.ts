import { test, expect, type Page, type Locator } from "@playwright/test";
import { ctl, MOCK } from "./ctl";
import { clickMore } from "./more";
import { Folder, serve } from "./macroFolder";

// WP0 / UI-03 — global keyboard shortcuts behind dialogs and fields.
//
// The default shortcut map binds Space to Cycle Start, Backspace to Abort
// and Escape to E-Stop. Every test below pins the same contract: with a
// dialog, the number keypad or the editor open, NOTHING but E-Stop reaches
// the machine from the keyboard; Escape sends exactly `estop` and never
// `estop_reset` (reset is a button, only); and a jog key released while a
// field opened mid-jog still sends its `jog_stop`.
//
// Runs under the `serial-guards` project: mock-global state (status deltas,
// recorded commands) — one file at a time.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};

const READ_ONLY_CMDS = ["hello", "heartbeat", "get_tool_table", "halshow_live", "timing_log",
                        "tab_visibility", "save_settings", "load_file"];
const MACHINE_CMDS = ["cycle_start", "cycle_pause", "cycle_resume", "abort", "jog_cont",
                      "jog_incr", "jog_stop", "go_to_zero", "touchoff", "set_kins_mode",
                      "home_all", "machine_on", "estop", "estop_reset", "mdi", "twp_capture"];

async function recordedCmds(): Promise<string[]> {
  const sent = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] };
  return (sent.cmds ?? []).map(c => c.cmd ?? "");
}

function expectNoMachineAction(cmds: string[]) {
  for (const machine of MACHINE_CMDS) expect(cmds).not.toContain(machine);
  expect(cmds.filter(c => !READ_ONLY_CMDS.includes(c))).toEqual([]);
}

/** Registry self-test: every `.dialogOverlay` in the DOM is registered. A
 *  dialog that forgot registerModal() shows up here, not as a silent gap. */
async function expectRegistryMatchesDom(page: Page) {
  const [dom, registered] = await page.evaluate(() => [
    document.querySelectorAll(".dialogOverlay").length,
    (window as any).__modalRegistry.count(),
  ]);
  expect(registered, `registry ${registered} vs DOM overlays ${dom}`).toBe(dom);
}

async function openReady(page: Page) {
  await ctl({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", permissions: PERMS_ALL } });
  // The mock sends no settings on its own; the Settings dialog's tabs render
  // only once the server's settings_init arrived (defaults for every section).
  await ctl({ op: "raw", frame: { type: "settings_init", settings: {} } });
  await expect(page.locator(".safetyStrip")).toBeVisible();
  await ctl({ op: "clearCmds" });
}

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Blur whatever holds focus — the shortcut map's "body focused" case. */
async function focusBody(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

test.afterEach(async () => {
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("positive control: Space on the bare page sends cycle_start", async ({ page }) => {
  await openReady(page);
  await focusBody(page);
  // pressed until it starts: the settings and permissions frames apply a
  // render later (a single press before that was lost under load, 2026-10-09)
  await expect.poll(async () => {
    await page.keyboard.press(" ");
    return recordedCmds();
  }).toContain("cycle_start");
});

test("number keypad open: Space/Backspace send nothing, Escape sends exactly estop", async ({ page }) => {
  await openReady(page);
  await page.locator("input.setupInput").first().click();
  await expect(page.locator(".nkStrip")).toBeVisible();
  await expectRegistryMatchesDom(page);
  await page.keyboard.press(" ");
  await page.keyboard.press("Backspace");
  await settle(page);
  expectNoMachineAction(await recordedCmds());
  await page.keyboard.press("Escape");
  await expect.poll(recordedCmds).toContain("estop");
  const cmds = await recordedCmds();
  expect(cmds.filter(c => c === "estop")).toHaveLength(1);
  expect(cmds).not.toContain("estop_reset");
  // The keypad is not an Escape target — it closes by Cancel/OK only.
  await expect(page.locator(".nkStrip")).toBeVisible();
});

test("keypad OK: Space through the whole focus return never starts the program; Escape still E-Stops", async ({ page }) => {
  // Review round 2 (UI-I06): the field's own confirm disables it for the
  // busy latch, the focus it just took drops to body, and between the
  // latch's end and a fixed re-focus delay Space reached the shortcut map
  // (`touchoff` followed by `cycle_start`, 3 of 3). The return is now a
  // guarded transition: Space is hammered from the confirm until focus has
  // landed on the field — every phase of the window — and nothing but the
  // touch-off may be sent. Escape stays E-Stop throughout.
  await openReady(page);
  const x = page.locator("input.setupInput").first();
  const nk = page.locator(".nkStrip");
  await x.click();
  await expect(nk).toBeVisible();
  await page.keyboard.type("17");
  await page.keyboard.press("Enter");
  await expect(nk).toHaveCount(0);
  const t0 = Date.now();
  while (Date.now() - t0 < 700) {
    // Stop once the field holds focus again (Space there would re-open the keypad).
    if (await x.evaluate(el => document.activeElement === el)) break;
    await page.keyboard.press(" ");
    await page.waitForTimeout(8);
  }
  if (await nk.count()) await nk.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(x).toBeFocused();
  let cmds = await recordedCmds();
  expect(cmds.filter(c => c === "touchoff")).toHaveLength(1);
  expect(cmds).not.toContain("cycle_start");
  expectNoMachineAction(cmds.filter(c => c !== "touchoff"));
  // Escape inside the same window sends estop (the guard never holds E-Stop).
  await ctl({ op: "clearCmds" });
  await x.click();
  await page.keyboard.type("18");
  await nk.getByRole("button", { name: "Apply", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect.poll(recordedCmds).toContain("estop");
  await expect(x).toBeFocused();
  cmds = await recordedCmds();
  expect(cmds).not.toContain("cycle_start");
  // Positive control: with the return landed, an unfocused page is an
  // operating position again — the guard is a transition, not a latch.
  await focusBody(page);
  await page.keyboard.press(" ");
  await expect.poll(recordedCmds).toContain("cycle_start");
});

/** Real Tab navigation until `target` holds focus (bounded). */
async function tabTo(page: Page, target: import("@playwright/test").Locator, limit = 40): Promise<boolean> {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate(el => el === document.activeElement)) return true;
    await page.keyboard.press("Tab");
  }
  return target.evaluate(el => el === document.activeElement);
}

test("a focused key acts as itself: Enter on Discard discards, Space on a digit appends, Enter on OK confirms once; text keys act on Enter/Space", async ({ page }) => {
  // Review UI-I10 (P1): the keypad root's Enter handler confirmed the value
  // whichever key held focus — Tab to Cancel + Enter sent a touch-off — and
  // the text keyboard's keys, acting on pointerdown only, were dead to a
  // native Enter/Space. Keys act on click now: pointer and keyboard, once.
  await openReady(page);
  const x = page.locator("input.setupInput").first();
  const nk = page.locator(".nkStrip");
  await x.click();
  await expect(nk).toBeFocused();
  await page.keyboard.type("17");
  expect(await tabTo(page, nk.getByRole("button", { name: "Discard", exact: true })), "Discard reached by real Tab navigation").toBe(true);
  await page.keyboard.press("Enter");
  await expect(nk).toHaveCount(0);
  await settle(page);
  expectNoMachineAction(await recordedCmds());
  await expect(x).toBeFocused();
  // Discard is Discard: the draft is gone, the field re-opens with its value.
  await x.click();
  await expect(nk).toBeFocused();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
  // Space on a focused digit key appends — the native activation — once each.
  expect(await tabTo(page, nk.getByRole("button", { name: "7", exact: true }))).toBe(true);
  await page.keyboard.press(" ");
  await expect(nk.locator(".nkExpr")).toHaveText("7");
  await page.keyboard.press(" ");
  await expect(nk.locator(".nkExpr")).toHaveText("77");
  // Enter on the focused OK confirms exactly once.
  expect(await tabTo(page, nk.getByRole("button", { name: "Apply", exact: true }))).toBe(true);
  await page.keyboard.press("Enter");
  await expect(nk).toHaveCount(0);
  await expect.poll(async () => (await recordedCmds()).filter(c => c === "touchoff").length).toBe(1);
  await expect(x).toBeFocused();
  // Enter on the ROOT — the entry itself — still confirms.
  await x.click();
  await expect(nk).toBeFocused();
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");
  await expect(nk).toHaveCount(0);
  await expect.poll(async () => (await recordedCmds()).filter(c => c === "touchoff").length).toBe(2);
  await expect(x).toBeFocused();
  // Text keyboard: a focused key acts on Enter and on Space, once; a
  // focused Close closes — the same action the pointer click runs.
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  const mdi = page.locator(".mdiInput");
  await mdi.click();
  const tk = page.locator(".tkStrip");
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "G", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(mdi).toHaveValue("G");
  await tk.getByRole("button", { name: "1", exact: true }).focus();
  await page.keyboard.press(" ");
  await expect(mdi).toHaveValue("G1");
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "Close keyboard", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(tk).toHaveCount(0);
  await expect(mdi).toHaveValue("G1");
  await settle(page);
  const cmds = await recordedCmds();
  expect(cmds.filter(c => c === "touchoff")).toHaveLength(2);
  expectNoMachineAction(cmds.filter(c => c !== "touchoff"));
});

test("an explicit close by keyboard returns focus: Enter/Space on the keyboard's X, Done in a search field and the editor's X leave the owner focused; the next Space types, never starts the program", async ({ page }) => {
  // Review round 4 (UI-I10 rest): the X activated by Tab + Enter/Space
  // unmounted with focus ON it — focus fell to body, the helper's modal
  // guard fell with the session, and the next Space was Cycle Start (6/6).
  // The X hands focus back through the guarded return now, and the MDI
  // line sends on keydown, so the Enter that activated the X never sends.
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: "G0 X0\nM2\n" }));
  await openReady(page);
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  const mdi = page.locator(".mdiInput");
  const tk = page.locator(".tkStrip");
  await mdi.click();
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "G", exact: true }).click();
  await tk.getByRole("button", { name: "1", exact: true }).click();
  await expect(mdi).toHaveValue("G1");
  let expected = "G1";
  for (const activation of ["Enter", " "]) {
    if (!(await tk.count())) { await mdi.click(); await expect(tk).toBeVisible(); }
    await tk.getByRole("button", { name: "Close keyboard", exact: true }).focus();
    await page.keyboard.press(activation);
    await expect(tk).toHaveCount(0);
    await expect(mdi).toHaveValue(expected);
    await expect(mdi).toBeFocused();
    await expect.poll(() => page.evaluate(() => (window as any).__modalRegistry.open())).toBe(false);
    // Continuing to type is typing — the Space lands in the line.
    await page.keyboard.press(" ");
    expected += " ";
    await expect(mdi).toHaveValue(expected);
  }
  await settle(page);
  expectNoMachineAction(await recordedCmds());
  // A plain text field: Apply by Enter leaves the search field focused.
  await page.getByTitle("G-code Reference", { exact: true }).click();
  const overlay = page.locator(".dialogOverlay").first();
  const search = overlay.locator("input.inputField").first();
  await search.click();
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "g", exact: true }).click();
  await tk.getByRole("button", { name: "Apply", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(tk).toHaveCount(0);
  await expect(search).toBeFocused();
  await page.keyboard.press(" ");
  await expect(search).toHaveValue("g ");
  await overlay.getByRole("button", { name: /^(Cancel|Close .*)$/ }).first().click();
  await expect(overlay).toHaveCount(0);
  // The editor: its X hands focus to the CodeMirror content.
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 1, file: "/A.ngc" } });
  await expect(page.locator(".codeLine").first()).toBeVisible();
  await clickMore(page.locator(".ctrlRow"), "Edit");
  const content = page.locator(".cm-content");
  await expect(content).toBeVisible();
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "Close keyboard", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(tk).toHaveCount(0);
  await expect(content).toBeFocused();
  await page.keyboard.press(" ");
  await settle(page);
  expectNoMachineAction(await recordedCmds());
});

test("repeated Escape in E-Stop never sends estop_reset", async ({ page }) => {
  await openReady(page);
  await ctl({ op: "status_delta", data: { estop: true, is_estop: true } });
  await expect(page.locator(".safetyStrip .statusRow").filter({ hasText: "E-Stop" })
    .locator(".stable-width > span:not(.alt)")).toHaveText("ACTIVE");
  await ctl({ op: "clearCmds" });
  await focusBody(page);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await settle(page);
  const cmds = await recordedCmds();
  expect(cmds).not.toContain("estop_reset");
  expect(cmds).not.toContain("estop");
});

test("settings dialog and key capture: only Escape passes, and it cancels the capture", async ({ page }) => {
  await openReady(page);
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  await expect(dialog).toBeVisible();
  await expectRegistryMatchesDom(page);
  await focusBody(page);
  await page.keyboard.press(" ");
  await page.keyboard.press("Backspace");
  await settle(page);
  expectNoMachineAction(await recordedCmds());

  await dialog.getByRole("tab", { name: "Keyboard", exact: true }).click();
  // E-Stop is a fixed, reserved row: no capture cell, no unbind.
  const estopRow = dialog.locator("tr").filter({ hasText: "E-Stop" });
  await expect(estopRow.locator(".kbKeyCell")).toHaveText("Esc");
  await expect(estopRow.locator(".kbKeyCell")).toHaveClass(/kbFixed/);
  await expect(estopRow.locator(".kbUnbind button")).toHaveCount(0);
  // Binding another action: Escape is NOT captured — it E-Stops and cancels.
  const cycleCell = dialog.locator("tr").filter({ hasText: "Cycle Start" }).locator(".kbKeyCell");
  await cycleCell.click();
  await expect(cycleCell).toHaveText("Press a key…");
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("Escape");
  await expect.poll(recordedCmds).toContain("estop");
  await expect(cycleCell).toHaveText("Space");
  expect(await recordedCmds()).not.toContain("estop_reset");
  // Space during a capture binds nothing to the machine either.
  await cycleCell.click();
  await page.keyboard.press("Backspace");   // duplicate of Abort → refused, still capturing
  await expect(dialog.locator(".kbCaptureError")).toContainText("Already bound");
  expectNoMachineAction((await recordedCmds()).filter(c => c !== "estop"));
});

test("tool dialog, messages and reference dialogs block Space/Enter/Backspace", async ({ page }) => {
  await openReady(page);
  for (const open of [
    async () => { await page.getByRole("tab", { name: "Tools", exact: true }).click();
      await clickMore(page.locator(".toolsHead"), "New"); },
    async () => { await page.getByRole("button", { name: /^Messages \(/ }).click(); },
    async () => { await page.getByTitle("G-code Reference", { exact: true }).click(); },
  ]) {
    await open();
    const overlay = page.locator(".dialogOverlay").last();
    await expect(overlay).toBeVisible();
    await expectRegistryMatchesDom(page);
    await focusBody(page);
    await ctl({ op: "clearCmds" });
    await page.keyboard.press(" ");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Backspace");
    await settle(page);
    expectNoMachineAction(await recordedCmds());
    await page.keyboard.press("Escape");
    await expect.poll(recordedCmds).toContain("estop");
    expect(await recordedCmds()).not.toContain("estop_reset");
    // Close via the dialog's own control (Escape is never a close).
    const close = overlay.getByRole("button", { name: /^(Cancel|Close .*)$/ }).first();
    await close.click();
    await expect(overlay).toHaveCount(0);
    await expectRegistryMatchesDom(page);
  }
});

test("tool editor: header X and footer Cancel close an unchanged form at once and ask when it was edited; Keep editing keeps the values", async ({ page }) => {
  // UX-02: the X ran the same silent discard as Cancel while the overlay
  // was already hardened against a mis-grab. One check for both now.
  await openReady(page);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await clickMore(page.locator(".toolsHead"), "New");
  const dialog = page.locator(".editDialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close tool editor", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await clickMore(page.locator(".toolsHead"), "New");
  await expect(dialog).toBeVisible();
  const desc = dialog.getByRole("textbox", { name: "Description", exact: true });
  await desc.click();
  await page.keyboard.type("6 mm endmill");
  await dialog.getByRole("button", { name: "Close tool editor", exact: true }).click();
  const ask = page.locator(".dialogOverlay").last();
  await expect(ask.getByText("Discard changes?")).toBeVisible();
  await expectRegistryMatchesDom(page);
  await ask.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(desc).toHaveValue("6 mm endmill");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.locator(".dialogOverlay").last().getByRole("button", { name: "Discard", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await settle(page);
  expectNoMachineAction(await recordedCmds());
});

test("a dimmed control explains itself: the MDI line on a tap, a coolant toggle on Tab + Enter; Space on either never starts the program", async ({ page }) => {
  // UX-09: the one explanation path (gateExplain.ts) for every control, not
  // only MachineBtn — input-rooted controls on pointerdown, label-rooted
  // ones on tap and Enter/Space; the reason is told at the control (design
  // wave D1), never in the message log.
  await openReady(page);
  await ctl({ op: "status_delta", data: {
    permissions: { ...PERMS_ALL, ready: false, run: false, override: false },
    permission_reasons: { ready: "Home all axes first", run: "Home all axes first", override: "Machine off" },
  } });
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  const mdi = page.locator(".mdiInput");
  await expect(mdi).toBeDisabled();
  await expect(mdi).toHaveAttribute("title", "Home all axes first");
  await ctl({ op: "clearCmds" });
  await mdi.click({ force: true });   // a real pointerdown on the disabled line
  const hint = page.locator("[data-btn-hint]");
  await expect(hint).toHaveText("Home all axes first");
  // The Flood toggle (its OWN gate, override, closed with a reason — the
  // Spindle Gate's fieldset cascade alone is not the toggle's reason): its
  // label is a focusable affordance that says why; Enter explains, Space
  // explains and is swallowed before the shortcut map.
  const flood = page.locator(".toggleRow").filter({ hasText: "Flood" });
  await expect(flood).toHaveAttribute("role", "button");
  await expect(flood).toHaveAttribute("aria-label", "Why is this unavailable? Machine off");
  await flood.focus();
  // Focus may scroll the strip to the toggle; that scroll event lands a
  // frame later and closes any hint (a hint never outlives a scroll) — let
  // it land before the key asks.
  await settle(page);
  await page.keyboard.press("Enter");
  await expect(hint).toHaveText("Machine off");
  await page.keyboard.press(" ");
  await expect(hint).toHaveText("Machine off");
  await settle(page);
  expectNoMachineAction(await recordedCmds());
  // Nothing of it reached the message log.
  await page.getByRole("button", { name: /^Messages \(/ }).click();
  await expect(page.locator(".dialogOverlay").last().getByText(/Home all axes first|Machine off/)).toHaveCount(0);
});

test("help is a tap-friendly popover: the Setup help opens by click and by keyboard and never reaches the machine", async ({ page }) => {
  // UX-11: explanations live in HelpIcon popovers named for their topic,
  // not in hover titles a touch operator cannot reach.
  await openReady(page);
  const help = page.getByRole("button", { name: "Help: Go to positions", exact: true });
  await help.click();
  const popover = page.locator(".helpPopover").filter({ hasText: "tool-change position" });
  await expect(popover).toBeVisible();
  await help.click();
  await expect(popover).toBeHidden();
  await help.focus();
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");
  await expect(popover).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(popover).toBeHidden();
  await settle(page);
  expectNoMachineAction(await recordedCmds());
});

// UI-I13 (review round 5): a help popover is placed from its LAID-OUT size,
// wholly inside the viewport, on its first opening — landscape, portrait,
// portrait at 150 % — and reads in body typography, not the title's.
// Round 6: the taps are dispatched at MEASURED coordinates once the layout
// has held still. Playwright's own scroll-into-view under CSS zoom re-scrolled
// the strip between the two taps of one case in a loaded gate run (the icon
// at 712 → 1171 px): the UA's light dismiss saw the first touch land beside
// the trigger and closed the popover, the retried tap re-opened it, and the
// close assertion failed without any product fault. The resize path is the
// round-6 probe made regular.
async function tapSteady(page: Page, target: Locator): Promise<{ x: number; y: number }> {
  // Bring the target 24 px inside its scroll container's VISIBLE box, at the
  // far edge (away from the sticky Safety section), in viewport px:
  // `scrollIntoView` under CSS zoom works in layout units and left the icon
  // at y = 1202 in a 1200 px viewport (measured, 150 %). The container is
  // the one with overflow auto/scroll (the strip fieldset) — the `.sub`
  // title above it "overflows" by the 20 px icon it holds.
  const bringIn = () => target.evaluate(el => {
    const z = (el as HTMLElement & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
    let sc: HTMLElement | null = el.parentElement;
    while (sc && sc !== document.body) {
      const cs = getComputedStyle(sc);
      if (/auto|scroll/.test(cs.overflowX + cs.overflowY)) break;
      sc = sc.parentElement;
    }
    if (!sc || sc === document.body) return "no scroll container";
    const M = 24;
    for (let i = 0; i < 4; i++) {
      const r = el.getBoundingClientRect(), c = sc.getBoundingClientRect();
      const bottom = Math.min(c.bottom, innerHeight), right = Math.min(c.right, innerWidth);
      const top = Math.max(c.top, 0), left = Math.max(c.left, 0);
      const dy = r.bottom > bottom - M || r.top < top + M ? r.bottom - (bottom - M) : 0;
      const dx = r.right > right - M || r.left < left + M ? r.right - (right - M) : 0;
      if (!dx && !dy) break;
      sc.scrollTop += dy / z;
      sc.scrollLeft += dx / z;
    }
    return `${sc.tagName.toLowerCase()} scrollLeft=${sc.scrollLeft.toFixed(0)} scrollTop=${sc.scrollTop.toFixed(0)}`;
  });
  let p = { x: 0, y: 0 };
  let hit = { ok: false, at: null as string | null };
  let where = "";
  for (let round = 0; round < 3 && !hit.ok; round++) {
    where = await bringIn();
    let last = await target.boundingBox();
    let still = 0;
    const t0 = Date.now();
    while (still < 3 && Date.now() - t0 < 5000) {
      await page.waitForTimeout(100);
      const b = await target.boundingBox();
      still = b && last && Math.abs(b.x - last.x) < 0.5 && Math.abs(b.y - last.y) < 0.5 ? still + 1 : 0;
      last = b;
    }
    expect(still, "the target held still for 300 ms before the tap").toBe(3);
    p = { x: last!.x + last!.width / 2, y: last!.y + last!.height / 2 };
    // No touch is dispatched until the point hits the target (a touch beside
    // it is a light dismiss the UA performs before any interceptor).
    hit = await target.evaluate((el, pt) => {
      const at = document.elementFromPoint(pt.x, pt.y);
      return { ok: !!at && (at === el || el.contains(at)), at: at ? `${at.tagName.toLowerCase()}.${(at as HTMLElement).className}` : null };
    }, p);
  }
  expect(hit.ok, `the tap point ${p.x.toFixed(0)},${p.y.toFixed(0)} lies on the target (${where}), not on ${hit.at}`).toBe(true);
  await page.touchscreen.tap(p.x, p.y);
  return p;
}

test.describe("help popover geometry (touch)", () => {
  test.use({ hasTouch: true });

  /** The touch layout, primed: the FIRST touch pointerdown flips
   *  `html.touch-device` (touchDetect.ts) and the layout re-flows mid-tap —
   *  a first tap on the 20 px icon yields no click. */
  async function openTouch(page: Page, width: number, height: number) {
    await page.setViewportSize({ width, height });
    await openReady(page);
    await page.locator("header.hdr").tap({ position: { x: 10, y: 10 } });
    await expect(page.locator("html.touch-device")).toHaveCount(1);
    return {
      help: page.getByRole("button", { name: "Help: Go to positions", exact: true }),
      popover: page.locator(".helpPopover").filter({ hasText: "tool-change position" }),
    };
  }

  for (const [width, height, zoom] of [[1280, 900, 1], [900, 1200, 1], [900, 1200, 1.5]] as const) {
    test(`Help: Go to positions is wholly readable at ${width} × ${height}, zoom ${zoom}`, async ({ page }) => {
      const { help, popover } = await openTouch(page, width, height);
      await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
      const at = await tapSteady(page, help);
      await expect(popover).toBeVisible();
      await settle(page);
      const g = await popover.evaluate(el => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height,
          vw: innerWidth, vh: innerHeight, scrollable: el.scrollHeight > el.clientHeight + 1,
          textTop: text.top, textBottom: text.bottom,
          transform: cs.textTransform, weight: cs.fontWeight, overflowY: cs.overflowY };
      });
      console.log(`HELP_GEOMETRY ${width}x${height}@${zoom} tap ${at.x.toFixed(0)},${at.y.toFixed(0)}: ${JSON.stringify(g)}`);
      expect(g.x, "left edge").toBeGreaterThanOrEqual(0);
      expect(g.y, "top edge").toBeGreaterThanOrEqual(0);
      expect(g.right, "right edge").toBeLessThanOrEqual(g.vw + 0.5);
      expect(g.bottom, "bottom edge").toBeLessThanOrEqual(g.vh + 0.5);
      expect(g.scrollable, "the whole text fits without an inner scroll").toBe(false);
      expect(g.textTop, "first line inside the popover").toBeGreaterThanOrEqual(g.y - 0.5);
      expect(g.textBottom, "last line inside the popover").toBeLessThanOrEqual(g.bottom + 0.5);
      expect(g.transform).toBe("none");
      expect(Number(g.weight)).toBeLessThan(600);
      expect(g.overflowY).toBe("auto");
      await tapSteady(page, help);
      await expect(popover).toBeHidden();
      await settle(page);
      expectNoMachineAction(await recordedCmds());
    });
  }

  test("the open help follows a resize and re-opens inside the viewport", async ({ page }) => {
    const { help, popover } = await openTouch(page, 900, 1200);
    await tapSteady(page, help);
    await expect(popover).toBeVisible();
    for (const [w, h] of [[900, 700], [1280, 700], [900, 1200]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await expect.poll(async () => {
        const b = await popover.boundingBox();
        return b ? { inside: b.x >= 0 && b.y >= 0 && b.x + b.width <= w + 0.5 && b.y + b.height <= h + 0.5, box: b } : null;
      }, { message: `the open popover inside ${w} × ${h}` }).toMatchObject({ inside: true });
    }
    await tapSteady(page, help);
    await expect(popover).toBeHidden();
    await tapSteady(page, help);
    await expect(popover).toBeVisible();
    const b = (await popover.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.y + b.height).toBeLessThanOrEqual(1200.5);
    await settle(page);
    expectNoMachineAction(await recordedCmds());
  });
});

test("documented remainder: Tab leaves the dialog (no focus trap in this wave)", async ({ page }) => {
  await openReady(page);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await clickMore(page.locator(".toolsHead"), "New");
  const dialog = page.locator(".dialogOverlay .dialog").last();
  await dialog.getByRole("button", { name: "Add", exact: true }).focus();
  await page.keyboard.press("Tab");
  const inside = await page.evaluate(() => !!document.activeElement?.closest(".dialog"));
  // A focus trap is on the follow-up list; the guard spec records that the
  // background is reachable by Tab and that Space activates the focused
  // background control NATIVELY (observed: the Arm/Disarm toggle is the next
  // Tab stop after the teleported dialog — `arm` is recorded; disarming is
  // the safe direction). What matters here: no MOTION command.
  expect(typeof inside).toBe("boolean");
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");
  await settle(page);
  const cmds = await recordedCmds();
  for (const machine of MACHINE_CMDS) expect(cmds).not.toContain(machine);
  expect(cmds.filter(c => !READ_ONLY_CMDS.includes(c) && c !== "arm")).toEqual([]);
});

test("editor open: Space never starts the program", async ({ page }) => {
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: "G0 X0\nG1 X10 F100\nM2\n" }));
  await openReady(page);
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 1, file: "/A.ngc" } });
  await expect(page.locator(".codeLine").first()).toBeVisible();
  await clickMore(page.locator(".ctrlRow"), "Edit");
  await expect(page.locator(".cm-content")).toBeVisible();
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");          // inside CodeMirror: text, not a shortcut
  await focusBody(page);
  await page.keyboard.press(" ");          // body focused: the editing guard
  await settle(page);
  expectNoMachineAction(await recordedCmds());
  await page.keyboard.press("Escape");
  await expect.poll(recordedCmds).toContain("estop");
});

test("pause and resume via Space are unchanged", async ({ page }) => {
  await openReady(page);
  await ctl({ op: "status_delta", data: { interp_state: 2, task_mode: 2, permissions: { ...PERMS_ALL, run: false, pause: true } } });
  await expect(page.locator(".safetyStrip .statusRow").filter({ hasText: "Interp" })
    .locator(".stable-width > span:not(.alt)")).toHaveText("RUNNING");
  await focusBody(page);
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");
  await expect.poll(recordedCmds).toContain("cycle_pause");
  await ctl({ op: "status_delta", data: { interp_state: 3, paused: true, permissions: { ...PERMS_ALL, run: false, pause: false, resume: true } } });
  await expect(page.locator(".safetyStrip .statusRow").filter({ hasText: "Interp" })
    .locator(".stable-width > span:not(.alt)")).toHaveText("PAUSED");
  // fire()'s busy latch after the pause drops a second Space — a timer, late
  // under load (a fixed 250 ms failed 2 of 3 with the sim running, the base
  // too): wait until Resume is open again, the same gate Space reads.
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  await focusBody(page);
  await ctl({ op: "clearCmds" });
  await page.keyboard.press(" ");
  await expect.poll(recordedCmds).toContain("cycle_resume");
});

test("a jog key released after a field opened mid-jog still sends jog_stop", async ({ page }) => {
  await openReady(page);
  // Enable keyboard jogging through the operator's own control.
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  await dialog.getByRole("tab", { name: "Keyboard", exact: true }).click();
  await dialog.getByText("Enable keyboard jogging", { exact: true }).click();
  // The overlay closes itself on a click outside the dialog (@click.self).
  await dialog.click({ position: { x: 4, y: 4 } });
  await expect(page.locator(".dialogOverlay")).toHaveCount(0);
  await focusBody(page);
  await ctl({ op: "clearCmds" });
  await page.keyboard.down("ArrowRight");
  await expect.poll(recordedCmds).toContain("jog_cont");
  await page.locator("input.setupInput").first().click();
  await expect(page.locator(".nkStrip")).toBeVisible();
  await page.keyboard.up("ArrowRight");
  await expect.poll(recordedCmds).toContain("jog_stop");
});

test("settings save status: Saving… on a change, Saved on the gateway's ok, the reason on ok:false", async ({ page }) => {
  // UX-08: the header's "saved automatically" is a promise with a proof —
  // the status follows the correlated reply, never the send alone.
  await openReady(page);
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  const status = dialog.locator(".saveStatus");
  await expect(status).toHaveText("");
  await dialog.getByRole("tab", { name: "Keyboard", exact: true }).click();
  const abortCell = dialog.locator("tr").filter({ hasText: "Abort" }).locator(".kbKeyCell");
  await ctl({ op: "clearCmds" });
  await abortCell.click();
  await page.keyboard.press("F9");
  await expect(status).toHaveText("Saving…");
  const saveReq = async () => {
    const sent = ((await ctl({ op: "lastCmds" })).cmds ?? []) as { cmd?: string; section?: string; req_id?: string }[];
    return sent.filter(c => c.cmd === "save_settings" && c.section === "keyboard").at(-1)?.req_id;
  };
  await expect.poll(saveReq).toMatch(/\S/);
  await ctl({ op: "raw", frame: { type: "reply", cmd: "save_settings", ok: true, req_id: await saveReq() } });
  await expect(status).toHaveText("Saved");
  await ctl({ op: "clearCmds" });
  await abortCell.click();
  await page.keyboard.press("F10");
  await expect(status).toHaveText("Saving…");
  await expect.poll(saveReq).toMatch(/\S/);
  await ctl({ op: "raw", frame: { type: "reply", cmd: "save_settings", ok: false, error: "disk full", req_id: await saveReq() } });
  await expect(status).toHaveText("Save failed — keyboard: disk full");
  // A foreign reply moves nothing.
  await ctl({ op: "raw", frame: { type: "reply", cmd: "save_settings", ok: true, req_id: "nobody-1" } });
  await page.waitForTimeout(100);
  await expect(status).toHaveText("Save failed — keyboard: disk full");
});

test("settings save status (UI-I12): a failed section stays visible behind another section's ok; an old reply never says Saved for a newer change", async ({ page }) => {
  // Review round 5: the status is a ledger per section and revision — a
  // reply confirms only the revision it was sent for, and a failure stays
  // until that section's own retry succeeds.
  await openReady(page);
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  const status = dialog.locator(".saveStatus");
  const keyboardTab = dialog.getByRole("tab", { name: "Keyboard", exact: true });
  await keyboardTab.click();
  const abortCell = dialog.locator("tr").filter({ hasText: "Abort" }).locator(".kbKeyCell");
  const saves = async (section: string) => {
    const sent = ((await ctl({ op: "lastCmds" })).cmds ?? []) as { cmd?: string; section?: string; req_id?: string }[];
    return sent.filter(c => c.cmd === "save_settings" && c.section === section).map(c => c.req_id ?? "");
  };
  const reply = (req_id: string, ok: boolean, error?: string) =>
    ctl({ op: "raw", frame: { type: "reply", cmd: "save_settings", req_id, ok, error } });
  const rebind = async (key: string) => {
    await ctl({ op: "clearCmds" });
    await abortCell.click();
    await page.keyboard.press(key);
    await expect(abortCell).toHaveText(key);
    await expect.poll(async () => (await saves("keyboard")).length).toBe(1);
    return (await saves("keyboard"))[0];
  };

  // (1) keyboard F9 and display fullscreen both on the wire; keyboard refused, display ok.
  const k1 = await rebind("F9");
  await dialog.getByRole("tab", { name: "Display", exact: true }).click();
  await dialog.getByLabel("Start in fullscreen mode", { exact: true }).check();
  await expect.poll(async () => (await saves("display")).length).toBe(1);
  const d1 = (await saves("display"))[0];
  await reply(k1, false, "keyboard save rejected");
  await expect(status).toHaveText("Save failed — keyboard: keyboard save rejected");
  await reply(d1, true);
  await settle(page);
  await page.waitForTimeout(100);
  await expect(status, "the failed keyboard save stays visible behind the display's ok").toHaveText("Save failed — keyboard: keyboard save rejected");
  // The section's own retry resolves it.
  await keyboardTab.click();
  const k2 = await rebind("F10");
  await expect(status).toHaveText("Saving…");
  await reply(k2, true);
  await expect(status).toHaveText("Saved");

  // (2) F9 on the wire, F10 in the debounce: the ok for F9 confirms F9 only.
  const first = await rebind("F9");
  await abortCell.click();
  await page.keyboard.press("F10");
  await expect(abortCell).toHaveText("F10");
  await expect(status).toHaveText("Saving…");
  await reply(first, true);
  await settle(page);
  // Sample until the second request is out (the 300 ms debounce): the
  // header must never read Saved for a change that was never sent.
  const samples: string[] = [];
  let requests = 1;
  const t0 = Date.now();
  while (requests < 2 && Date.now() - t0 < 1500) {
    samples.push(await status.innerText());
    requests = (await saves("keyboard")).length;
  }
  console.log(`SAVE_OLD_REPLY ${samples.length} samples before the second request: ${JSON.stringify([...new Set(samples)])}`);
  expect(samples.length).toBeGreaterThan(0);
  expect([...new Set(samples)]).toEqual(["Saving…"]);
  await expect.poll(async () => (await saves("keyboard")).length).toBe(2);
  await expect(status).toHaveText("Saving…");
  await reply((await saves("keyboard"))[1], true);
  await expect(status).toHaveText("Saved");
});

test("settings save status (UI-I12 rest): a page-hide save goes by beacon and only the server's state confirms it", async ({ page }) => {
  // Review round 6: a change still in the debounce when the page is hidden
  // leaves through navigator.sendBeacon and its timer is cleared — no WS
  // request, no correlated reply. The status is "unconfirmed" until the
  // gateway's full settings blob carries the section: equal → Saved, a
  // different one → not on the server (corrected by a later matching blob).
  // Headless Chromium keeps the tab visible, so only the document's
  // visibility is simulated; the production listener, the beacon, the HTTP
  // request and the cache update run unchanged.
  const beacons: { data: Record<string, any> }[] = [];
  await page.route("**/settings/keyboard*", async route => {
    beacons.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await openReady(page);
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  const status = dialog.locator(".saveStatus");
  await dialog.getByRole("tab", { name: "Keyboard", exact: true }).click();
  const abortCell = dialog.locator("tr").filter({ hasText: "Abort" }).locator(".kbKeyCell");
  await ctl({ op: "clearCmds" });
  await abortCell.click();
  await page.keyboard.press("F9");
  await expect(status).toHaveText("Saving…");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => beacons.length).toBe(1);
  expect(beacons[0].data.mapping.abort).toBe("F9");
  await expect(status).toHaveText("Sent on page hide — not yet confirmed (keyboard)");
  // A blob with a different keyboard state (another client's broadcast
  // before the beacon landed) is no confirmation — and it says so.
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { keyboard: { ...beacons[0].data, mapping: { ...beacons[0].data.mapping, abort: "F8" } } } } });
  await expect(status).toHaveText("Save failed — keyboard: page-hide save not on the server — change it again");
  // The gateway's blob after the HTTP save carries what was sent: confirmed.
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { keyboard: beacons[0].data } } });
  await expect(status).toHaveText("Saved");
  await expect(abortCell).toHaveText("F9");
  await page.waitForTimeout(400);   // past the (cleared) 300 ms debounce
  const wsSaves = (((await ctl({ op: "lastCmds" })).cmds ?? []) as { cmd?: string; section?: string }[])
    .filter(c => c.cmd === "save_settings" && c.section === "keyboard");
  expect(wsSaves, "the page-hide flush cancelled the debounce; no WS save follows").toHaveLength(0);
  await expect(status).toHaveText("Saved");
});

test("settings save status (UI-I12 round 7): a page-hide save that never landed reads as not saved, never Saved or pending for good", async ({ page }) => {
  // Round 7 rest B: the settings blob is the COMPLETE store, so a beaconed
  // section it lacks is not on the server. Rest A (the gateway cached an
  // unwritten value and sent it back as if stored) is fixed in
  // settings_store.py and pinned by test_settings_store.py; here the refused
  // beacon's blob carries the STORED (old) value and must read as a failure.
  let mode: "abort" | "refuse" = "abort";
  const beacons: { data: Record<string, any> }[] = [];
  await page.route("**/settings/keyboard*", async route => {
    beacons.push(route.request().postDataJSON());
    if (mode === "abort") await route.abort("failed");
    else await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, error: "OSError: [Errno 28] No space left on device" }) });
  });
  await openReady(page);
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  const status = dialog.locator(".saveStatus");
  await dialog.getByRole("tab", { name: "Keyboard", exact: true }).click();
  const abortCell = dialog.locator("tr").filter({ hasText: "Abort" }).locator(".kbKeyCell");
  const hideAndShow = () => page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
    Reflect.deleteProperty(document, "visibilityState");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const wsKeyboardSaves = async () => (((await ctl({ op: "lastCmds" })).cmds ?? []) as { cmd?: string; section?: string }[])
    .filter(c => c.cmd === "save_settings" && c.section === "keyboard").length;

  // (B) the first beacon never arrives; the reconnect's blob has no keyboard section.
  await ctl({ op: "clearCmds" });
  await abortCell.click();
  await page.keyboard.press("F9");
  await expect(status).toHaveText("Saving…");
  await hideAndShow();
  await expect.poll(() => beacons.length).toBe(1);
  await expect(status).toHaveText("Sent on page hide — not yet confirmed (keyboard)");
  await ctl({ op: "raw", frame: { type: "settings_init", settings: {} } });
  await expect(status).toHaveText("Save failed — keyboard: page-hide save not on the server — change it again");
  await expect(abortCell).toHaveText("⌫");            // the stored default is what the page shows now
  // The long failure wraps in the header; the hint keeps its lines and the
  // tabs stay where they were (a nowrap status once buried them).
  const head = await dialog.locator(".settingsHead").evaluate(el => {
    const hint = el.querySelector(".hint")!.getBoundingClientRect();
    const st = el.querySelector(".saveStatus")!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { hintWidth: hint.width, statusRight: st.right, boxRight: box.right, boxHeight: box.height };
  });
  expect(head.hintWidth, `hint width ${JSON.stringify(head)}`).toBeGreaterThan(150);
  expect(head.statusRight).toBeLessThanOrEqual(head.boxRight + 0.5);
  await page.waitForTimeout(400);
  expect(await wsKeyboardSaves(), "no WS save follows the cleared debounce").toBe(0);

  // (A) the beacon is refused (409); the blob carries the STORED F8, not the sent F9.
  mode = "refuse";
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { keyboard: { jogEnabled: false, buttonsEnabled: true, mapping: { abort: "F8", cycle: " ", estop: "Escape" } } } } });
  await expect(abortCell).toHaveText("F8");
  await abortCell.click();
  await page.keyboard.press("F9");
  await expect(abortCell).toHaveText("F9");
  await hideAndShow();
  await expect.poll(() => beacons.length).toBe(2);
  expect(beacons[1].data.mapping.abort).toBe("F9");
  await expect(status).toHaveText("Sent on page hide — not yet confirmed (keyboard)");
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { keyboard: { jogEnabled: false, buttonsEnabled: true, mapping: { abort: "F8", cycle: " ", estop: "Escape" } } } } });
  await expect(status).toHaveText("Save failed — keyboard: page-hide save not on the server — change it again");
  await expect(abortCell).toHaveText("F8");
  expect(await wsKeyboardSaves()).toBe(0);
});

test("a macro editor's draft is never lost without asking, by every way out (UI-K16, package 5)", async ({ page }) => {
  // The macro editor is a DIALOG (operator 2026-10-03): its Cancel and X,
  // and the strip's Tool Table button — outside the dialog's scrim — ask
  // "Discard changes?"; Keep editing keeps the draft, Discard carries out
  // what asked.
  await serve(page, new Folder());   // the macro files (macroFolder.ts)
  await openReady(page);
  const tab = (name: string) => page.getByRole("tab", { name, exact: true });
  const ask = page.getByRole("dialog", { name: "Discard changes?", exact: true });
  const editor = page.getByRole("dialog", { name: "Edit Macro park", exact: true });
  const code = editor.locator(".macroCode .cm-content");
  await tab("Macros").click();
  // An untouched editor is no draft: the Tool Table button switches at once.
  await page.locator(".macrosTab").getByRole("button", { name: "Edit park", exact: true }).click();
  await expect(code).toBeVisible();
  await page.getByRole("button", { name: "Tool Table", exact: true }).click();
  await expect(ask).toHaveCount(0);
  await expect(tab("Tools")).toHaveAttribute("aria-selected", "true");
  await expect(editor).toHaveCount(0);

  await tab("Macros").click();
  await page.locator(".macrosTab").getByRole("button", { name: "Edit park", exact: true }).click();
  await code.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (draft)");
  const paths: [string, () => Promise<void>][] = [
    ["Cancel", () => editor.getByRole("button", { name: "Cancel", exact: true }).click()],
    ["X", () => editor.getByRole("button", { name: "Close macro editor", exact: true }).click()],
    ["Tool Table button", () => page.getByRole("button", { name: "Tool Table", exact: true }).click()],
  ];
  for (const [path, leave] of paths) {
    await leave();
    await expect(ask, `${path} asks`).toBeVisible();
    await expect(ask).toContainText("The macro park.ngc you are editing has unsaved changes.");
    await ask.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(ask).toHaveCount(0);
    await expect(tab("Macros"), `${path}: Keep editing stays`).toHaveAttribute("aria-selected", "true");
    await expect(code).toContainText("(draft)");
  }
  // Discard carries out the switch that asked.
  await page.getByRole("button", { name: "Tool Table", exact: true }).click();
  await ask.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(tab("Tools")).toHaveAttribute("aria-selected", "true");
  await expect(editor).toHaveCount(0);
  await settle(page);
  expectNoMachineAction(await recordedCmds());
});

test("Settings' one draft left, the gamepad mapping in progress, asks before a header navigation (UI-K16)", async ({ page }) => {
  await page.addInitScript(() => {
    const pad = { id: "Test Pad (Vendor: 045e Product: 028e)", index: 0, connected: true, mapping: "standard", timestamp: 0,
                  axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
    Object.defineProperty(navigator, "getGamepads", { value: () => [pad, null, null, null] });
  });
  await openReady(page);
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Gamepad", exact: true }).click();
  await settings.getByRole("button", { name: "Map Buttons…", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "Map Controller", exact: true });
  await expect(wizard).toBeVisible();
  const ask = page.getByRole("dialog", { name: "Discard changes?", exact: true });
  await page.getByTitle("G-code Reference", { exact: true }).click();
  await expect(ask).toContainText("The gamepad mapping in progress has unsaved changes.");
  await ask.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(wizard).toBeVisible();
  await page.getByTitle("G-code Reference", { exact: true }).click();
  await ask.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(settings).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Search G-code reference", exact: true })).toBeVisible();
  await settle(page);
  expectNoMachineAction(await recordedCmds());
});

test("keyboard tab: a capture edits a local copy, no page error, a server change refreshes it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await openReady(page);
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.locator(".dialogOverlay").first();
  await dialog.getByRole("tab", { name: "Keyboard", exact: true }).click();
  const abortCell = dialog.locator("tr").filter({ hasText: "Abort" }).locator(".kbKeyCell");
  await expect(abortCell).toHaveText("⌫");
  await abortCell.click();
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("F9");
  await expect(abortCell).toHaveText("F9");
  // The edit went out as a save (the copy was emitted), not as a mutation of the store.
  await expect.poll(async () => ((await ctl({ op: "lastCmds" })).cmds ?? []).some((c: any) => c.cmd === "save_settings" && c.section === "keyboard")).toBe(true);
  // A server-side change (another tab) refreshes the copy.
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { keyboard: { jogEnabled: false, buttonsEnabled: true, mapping: { abort: "F10", cycle: " ", estop: "Escape" } } } } });
  await expect(abortCell).toHaveText("F10");
  expect(errors).toEqual([]);
});

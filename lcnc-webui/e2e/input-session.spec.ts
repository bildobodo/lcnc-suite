import { test, expect, type Page, type Locator } from "@playwright/test";
import { ctl, MOCK } from "./ctl";
import { measureLayout, assertLayout, measureFrame, frameChanges } from "./layout-audit";

// WP8 / UI-15 — ONE input helper for every target (MDI line, editor, search
// and description fields, number fields), owned by one target at a time,
// opened by a deliberate tap/click or the keyboard glyph — never by focus —
// and closed without confirming anything by a tap or a Tab outside its
// focus area (field + glyph + keys), for the number keypad and the text
// keyboard alike. Runs under `serial-guards`.
//
// Keys are pressed with REAL pointer input (`click`, or `tap` in the
// hasTouch block): Playwright hit-tests the key at its centre before the
// pointerdown our keys act on, so a covered or clipped key fails here
// instead of being reached through a synthetic event (review UI-I09).

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};
const MACHINE_CMDS = ["cycle_start", "cycle_pause", "cycle_resume", "abort", "jog_cont", "jog_incr",
  "go_to_zero", "touchoff", "set_kins_mode", "home_all", "machine_on", "estop", "mdi", "twp_capture", "save_settings",
  "set_wcs", "clear_wcs"];

type Sent = { cmd?: string; [k: string]: unknown };
async function sentCmds(): Promise<Sent[]> {
  const sent = await ctl({ op: "lastCmds" }) as { cmds?: Sent[] };
  return sent.cmds ?? [];
}
async function cmds(): Promise<string[]> {
  return (await sentCmds()).map(c => c.cmd ?? "");
}
function expectNoMachineAction(list: string[]) {
  for (const m of MACHINE_CMDS) expect(list).not.toContain(m);
}

async function open(page: Page, viewport = { width: 1280, height: 800 }) {
  await ctl({ op: "reset" });
  await page.setViewportSize(viewport);
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { active_file: "/A.ngc", permissions: PERMS_ALL } });
  await expect(page.locator(".safetyStrip")).toBeVisible();
  await ctl({ op: "clearCmds" });
}

/** Press a strip key by its accessible name with a real pointer click. */
async function key(strip: Locator, name: string) {
  await strip.getByRole("button", { name, exact: true }).click();
}
/** The same with a real touch tap (hasTouch contexts). */
async function tapKey(strip: Locator, name: string) {
  await strip.getByRole("button", { name, exact: true }).tap();
}
async function typeKeys(strip: Locator, text: string, press = key) {
  for (const ch of text) await press(strip, ch === " " ? "Space" : ch);
}
/** A pointerdown on a non-focusable spot outside every input area. */
async function tapOutside(page: Page) {
  await page.locator("header.hdr").dispatchEvent("pointerdown", { button: 0 });
}

async function openMdi(page: Page) {
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  const mdi = page.locator(".mdiInput");
  await mdi.click();
  await expect(page.locator(".tkStrip")).toBeVisible();
  return mdi;
}
function dialogField(page: Page, label: string) {
  return page.locator(".editDialog").getByRole("textbox", { name: label, exact: true });
}

test.afterEach(async () => {
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("MDI → number → MDI: exactly one helper at a time, the title names the owner", async ({ page }) => {
  await open(page);
  await openMdi(page);
  const tk = page.locator(".tkStrip"), nk = page.locator(".nkStrip");
  await expect(tk.locator(".sub")).toHaveText("MDI");
  await expect(tk.getByRole("button", { name: "Code keys", exact: true })).toHaveAttribute("aria-pressed", "true");
  // The strip's own number fields are covered while a text helper is up, so
  // the switch runs through a content field: the tool dialog's Diameter.
  // Leaving the MDI tab locks its session (helper hidden, not ended).
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(tk).toHaveCount(0);
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await dialogField(page, "Diameter").click();
  await expect(nk).toBeVisible();
  await expect(tk).toHaveCount(0);
  await expect(nk.locator(".sub")).toHaveText("New tool · Diameter · mm");
  await key(nk, "Discard");
  await expect(nk).toHaveCount(0);
  await page.locator(".editDialog").getByRole("button", { name: "Cancel", exact: true }).click();
  // The number keypad ENDED the text session; back on MDI a tap re-opens it.
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  await expect(tk).toHaveCount(0);
  await page.locator(".mdiInput").click();
  await expect(tk).toBeVisible();
  await expect(nk).toHaveCount(0);
  // Number (strip field) → MDI: the keypad gives way to the keyboard at once.
  await tapOutside(page);
  await expect(tk).toHaveCount(0);
  await page.locator("input.setupInput").first().click();
  await expect(nk).toBeVisible();
  await expect(nk.locator(".sub")).toContainText("Touch off X");
  await page.locator(".mdiInput").click();
  await expect(tk).toBeVisible();
  await expect(nk).toHaveCount(0);
  expectNoMachineAction(await cmds());
});

test("number A → number B: A is not confirmed, its draft returns marked as draft", async ({ page }) => {
  await open(page);
  const x = page.locator("input.setupInput").nth(0), y = page.locator("input.setupInput").nth(1);
  const xBefore = await x.inputValue();
  await x.click();
  const nk = page.locator(".nkStrip");
  await expect(nk.locator(".sub")).toContainText("Touch off X");
  await page.keyboard.type("12");
  await y.click();
  await expect(nk.locator(".sub")).toContainText("Touch off Y");
  await expect(nk.locator(".nkExpr")).not.toHaveText("12");
  await expect(x).toHaveValue(xBefore);
  expect(await cmds()).not.toContain("touchoff");
  await x.click();
  await expect(nk.locator("[data-draft]")).toHaveText("draft");
  await expect(nk.locator(".nkExpr")).toHaveText("12");
  // A second tap on the field being edited keeps the expression.
  await x.click();
  await expect(nk.locator(".nkExpr")).toHaveText("12");
  await key(nk, "Discard");
  await x.click();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
});

// Operator 2026-09-29: a mouse press on the number field being edited — a
// second click, a double click, a drag over it to select the value by habit
// — moved the focus into the read-only field; the keypad (which holds the
// physical keyboard) got no digit after it. A press on a number field takes
// no focus and selects nothing; focus that reaches the field another way
// (Tab back, a label) goes back to the keypad on Enter / the next press.
test("a click, double click or drag on the open number field selects nothing and the keyboard keeps typing", async ({ page }) => {
  await open(page);
  const x = page.locator("input.setupInput").nth(0);
  const nk = page.locator(".nkStrip");
  const xBefore = await x.inputValue();
  await x.click();
  await page.keyboard.type("1");
  const selected = () => page.evaluate(() => {
    const f = document.querySelector("input.setupInput") as HTMLInputElement;
    return { doc: String(document.getSelection()), field: f.selectionEnd! - f.selectionStart!, focusInField: document.activeElement === f };
  });
  const drag = async (overshoot: number) => {
    const b = (await x.boundingBox())!;
    await page.mouse.move(b.x + 4, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 4 + (b.width - 8 + overshoot) * i / 8, b.y + b.height / 2);
    await page.mouse.up();
  };
  await x.click();
  expect(await selected(), "a second click").toEqual({ doc: "", field: 0, focusInField: false });
  await page.keyboard.type("2");
  await x.dblclick();
  expect(await selected(), "a double click").toEqual({ doc: "", field: 0, focusInField: false });
  await page.keyboard.type("3");
  await drag(0);
  expect(await selected(), "a drag over the field").toEqual({ doc: "", field: 0, focusInField: false });
  await page.keyboard.type("4");
  await drag(80);
  expect(await selected(), "a drag out of the field").toEqual({ doc: "", field: 0, focusInField: false });
  await page.keyboard.type("5");
  await expect(nk.locator(".nkExpr")).toHaveText("12345");
  // Focus that reaches the field another way: Enter on it hands it back.
  await x.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.type("6");
  await expect(nk.locator(".nkExpr")).toHaveText("123456");
  await expect(x).toHaveValue(xBefore);
  expectNoMachineAction(await cmds());
  await key(nk, "Discard");
});

test("number → text → number keeps the draft; a tap outside hides the keypad, OK and Cancel return focus", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  const x = page.locator("input.setupInput").first();
  const xBefore = await x.inputValue();
  const nk = page.locator(".nkStrip"), tk = page.locator(".tkStrip");
  await x.click();
  await page.keyboard.type("123");
  // Text helper takes over: the number draft is filed, not confirmed.
  await page.locator(".mdiInput").click();
  await expect(tk).toBeVisible();
  await expect(nk).toHaveCount(0);
  await key(tk, "Close keyboard");
  await expect(tk).toHaveCount(0);
  await x.click();
  await expect(nk.locator("[data-draft]")).toHaveText("draft");
  await expect(nk.locator(".nkExpr")).toHaveText("123");
  // Tap outside: hidden, nothing confirmed, the draft stays.
  await tapOutside(page);
  await expect(nk).toHaveCount(0);
  await expect(x).toHaveValue(xBefore);
  expect(await cmds()).not.toContain("touchoff");
  expect(await page.evaluate(() => (window as any).__modalRegistry.open())).toBe(false);
  await x.click();
  await expect(nk.locator(".nkExpr")).toHaveText("123");
  // OK delivers the value once and returns focus to the field.
  await key(nk, "Apply");
  await expect(nk).toHaveCount(0);
  await expect.poll(async () => (await cmds()).filter(c => c === "touchoff").length).toBe(1);
  await expect(x).toBeFocused();
  // Cancel returns focus too; no draft survives it.
  await x.click();
  await page.keyboard.type("5");
  await key(nk, "Discard");
  await expect(nk).toHaveCount(0);
  await expect(x).toBeFocused();
  await x.click();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
  await key(nk, "Discard");
  expectNoMachineAction((await cmds()).filter(c => c !== "touchoff"));
});

test("number keypad: X hides and keeps the draft (tap and Tab + Enter), Discard throws it away; both return focus, nothing is sent", async ({ page }) => {
  // UX-01 (operator decision 2026-09-21): both helpers close the same way —
  // X = hide, the entry stays as the owner's draft; Discard is the explicit
  // throw-away. Both hand focus back through the guarded return.
  await open(page);
  const x = page.locator("input.setupInput").first();
  const nk = page.locator(".nkStrip");
  await x.click();
  await expect(nk).toBeFocused();
  await page.keyboard.type("17");
  await key(nk, "Close keyboard");
  await expect(nk).toHaveCount(0);
  await expect(x).toBeFocused();
  await x.click();
  await expect(nk.locator("[data-draft]")).toHaveCount(1);
  await expect(nk.locator(".nkExpr")).toHaveText("17");
  // By keyboard: the focused X, Enter. Focus lands on the field; the next
  // Space is the field's own opener, never a shortcut.
  await nk.getByRole("button", { name: "Close keyboard", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(nk).toHaveCount(0);
  await expect(x).toBeFocused();
  await page.keyboard.press(" ");
  await expect(nk).toBeFocused();
  await expect(nk.locator("[data-draft]")).toHaveCount(1);
  await key(nk, "Discard");
  await expect(nk).toHaveCount(0);
  await expect(x).toBeFocused();
  await x.click();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
  await key(nk, "Discard");
  expectNoMachineAction(await cmds());
});

test("drafts: Clear is a draft of 0; a sibling's OK (busy latch) is not an owner end, the field's gate ending is", async ({ page }) => {
  // Review round 2, UI-I05 A + B for MachineInput owners.
  await open(page);
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  const x = page.locator("input.setupInput").nth(0), y = page.locator("input.setupInput").nth(1);
  const xBefore = await x.inputValue();
  const nk = page.locator(".nkStrip"), tk = page.locator(".tkStrip");
  // Clear, leave for a text session, come back: the empty entry is the
  // draft "0", visibly — not the field's old value.
  await x.click();
  await key(nk, "Clear entry");
  await expect(nk.locator(".nkExpr")).toHaveText("0");
  await page.locator(".mdiInput").click();
  await expect(tk).toBeVisible();
  await key(tk, "Close keyboard");
  await x.click();
  await expect(nk.locator("[data-draft]")).toHaveText("draft");
  await expect(nk.locator(".nkExpr")).toHaveText("0");
  await expect(nk.locator(".nkPreview:not([data-draft])")).toHaveText("= 0");
  // Type on, park it behind Y, confirm Y: the touch-off's busy latch closes
  // X's gate for 200 ms and re-opens it — X's draft survives that.
  await page.keyboard.type("12");
  await y.click();
  await expect(nk.locator(".sub")).toContainText("Touch off Y");
  await page.keyboard.type("5");
  await key(nk, "Apply");
  await expect(nk).toHaveCount(0);
  await expect.poll(async () => (await sentCmds()).filter(c => c.cmd === "touchoff")).toEqual([
    expect.objectContaining({ cmd: "touchoff", axes: { Y: 5 } }),
  ]);
  await expect(y).toBeFocused();
  await x.click();
  await expect(nk.locator("[data-draft]")).toHaveText("draft");
  await expect(nk.locator(".nkExpr")).toHaveText("12");
  // Park it again, then end the gate itself: X's draft ends with it even
  // though Y holds the keypad — and Y's session ends too (same gate).
  await y.click();
  await expect(nk.locator(".sub")).toContainText("Touch off Y");
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, touchoff: false } } });
  await expect(nk).toHaveCount(0);
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL } });
  await expect(x).toBeEnabled();
  await x.click();
  await expect(nk).toBeVisible();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
  await expect(nk.locator(".nkExpr")).toHaveText(xBefore);
  // A REAL revocation INSIDE the latch (review round 3): X drafts again,
  // Y's OK starts the latch (X disabled by it), the backend closes and
  // re-opens the gate before the latch ends — X's context ended, its draft
  // is gone. The owner gate is read without the latch term, not from the
  // displayed reason (where "settling" outranks the backend).
  await page.keyboard.type("12");
  await y.click();
  await expect(nk.locator(".sub")).toContainText("Touch off Y");
  await page.keyboard.type("6");
  await key(nk, "Apply");
  await expect(x).toBeDisabled();   // inside the latch
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, touchoff: false } } });
  // Two frames, not one batch: status frames are applied per animation
  // frame, so a close and a re-open inside ONE frame is no state at all.
  await page.waitForTimeout(50);
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL } });
  await expect(x).toBeEnabled();
  await x.click();
  await expect(nk).toBeVisible();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
  await expect(nk.locator(".nkExpr")).toHaveText(xBefore);
  await key(nk, "Discard");
  expect((await cmds()).filter(c => c === "touchoff")).toHaveLength(2);
  expectNoMachineAction((await cmds()).filter(c => c !== "touchoff"));
});

test("tap outside, Tab outside (from the field and from a key) and Close hide the keyboard without confirming; a re-tap re-opens", async ({ page }) => {
  await open(page);
  const mdi = await openMdi(page);
  const tk = page.locator(".tkStrip");
  await typeKeys(tk, "G0 X1");
  await expect(mdi).toHaveValue("G0 X1");
  // Operating the keys is not leaving.
  await expect(tk).toBeVisible();
  // Tap outside (header) → closed, nothing sent, text kept.
  await tapOutside(page);
  await expect(tk).toHaveCount(0);
  await expect(mdi).toHaveValue("G0 X1");
  expect(await cmds()).not.toContain("mdi");
  // Same field, tapped again → opens again.
  await mdi.click();
  await expect(tk).toBeVisible();
  // Tab out of the field → closed.
  await mdi.focus();
  await page.keyboard.press("Tab");
  await expect(tk).toHaveCount(0);
  await expect(mdi).toHaveValue("G0 X1");
  // Tab out of one of the helper's own keys → closed as well (the focus
  // area is field + glyph + keys, not the field alone).
  await mdi.click();
  await expect(tk).toBeVisible();
  await tk.getByRole("button", { name: "Close keyboard", exact: true }).focus();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement !== document.body
        && !document.activeElement?.closest('[data-input-area="mdi-input"]'))) break;
  }
  expect(await page.evaluate(() => !!document.activeElement?.closest('[data-input-area="mdi-input"]'))).toBe(false);
  await expect(tk).toHaveCount(0);
  await expect(mdi).toHaveValue("G0 X1");
  // Close via ✕: focus stays on the field, nothing re-opens on its own.
  await mdi.click();
  await expect(tk).toBeVisible();
  await key(tk, "Close keyboard");
  await expect(tk).toHaveCount(0);
  await expect(mdi).toBeFocused();
  await page.waitForTimeout(300);
  await expect(tk).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__modalRegistry.open())).toBe(false);
  expectNoMachineAction(await cmds());
});

// Operator 2026-10-01 (live look): the result preview of a calculation stood
// LEFT of the entry on one line and read as part of the number. Two lines:
// the entry on top, the preview below it, both right-aligned.
test("the number keypad shows the result of a calculation in a second line under the entry (operator 2026-10-01)", async ({ page }) => {
  await open(page);
  await page.locator("input.setupInput").first().click();
  const nk = page.locator(".nkStrip");
  await expect(nk).toBeVisible();
  for (const k of ["1", "2", "Plus", "3"]) await nk.getByRole("button", { name: k, exact: true }).click();
  const expr = nk.locator(".nkExpr"), preview = nk.locator(".nkPreview").last();
  await expect(expr).toHaveText("12+3");
  await expect(preview).toContainText("15");
  const [e, p] = [(await expr.boundingBox())!, (await preview.boundingBox())!];
  const box = (await nk.locator(".nkDisplay").boundingBox())!;
  expect(p.y, "the preview is below the entry").toBeGreaterThanOrEqual(e.y + e.height - 1);
  expect(Math.abs((p.x + p.width) - (e.x + e.width)), "both right-aligned").toBeLessThanOrEqual(2);
  expect(p.y + p.height, "inside the readout").toBeLessThanOrEqual(box.y + box.height + 0.5);
  // the entry keeps its place whether or not a preview shows
  await nk.getByRole("button", { name: "Discard", exact: true }).click();
  await page.locator("input.setupInput").first().click();
  await nk.getByRole("button", { name: "7", exact: true }).click();
  const e2 = (await expr.boundingBox())!;
  expect(Math.abs(e2.y - e.y), "the entry line does not move").toBeLessThanOrEqual(0.5);
  await nk.getByRole("button", { name: "Discard", exact: true }).click();
});

test("Send from the keyboard is the MDI path; Enter in a search field never reaches the machine", async ({ page }) => {
  await open(page);
  const mdi = await openMdi(page);
  const tk = page.locator(".tkStrip");
  await typeKeys(tk, "G0 X5");
  await key(tk, "Send the MDI command");
  await expect.poll(cmds).toContain("mdi");
  await expect(mdi).toHaveValue("");
  // A search field in a dialog: text session, ABC page, Done closes, no command.
  await page.getByTitle("G-code Reference", { exact: true }).click();
  const search = page.locator(".dialogOverlay input.inputField").first();
  await search.click();
  await expect(tk).toBeVisible();
  await expect(tk.getByRole("button", { name: "ABC keys", exact: true })).toHaveAttribute("aria-pressed", "true");
  await ctl({ op: "clearCmds" });
  await typeKeys(tk, "g");
  await key(tk, "123 keys");
  await key(tk, "0");
  await expect(search).toHaveValue("g0");
  // Tapping inside the dialog on the field does not close it.
  await search.dispatchEvent("pointerdown", { button: 0 });
  await expect(tk).toBeVisible();
  await key(tk, "Done");
  await expect(tk).toHaveCount(0);
  expectNoMachineAction(await cmds());
});

test("physical typing into the MDI line is kept with the helper open and closed; Enter sends the whole line once, the history recalls it, on-screen keys append", async ({ page }) => {
  // Review round 4 (UI-I11): `:value` + `@input` against MachineInput's own
  // model left two writers on the element — every typed character was
  // wiped. The line is v-model now: one ref for the physical keyboard, the
  // on-screen keys and the history.
  await open(page);
  const mdi = await openMdi(page);
  const tk = page.locator(".tkStrip");
  await page.keyboard.type("G1 X7");
  await expect(mdi).toHaveValue("G1 X7");
  await key(tk, "Close keyboard");
  await expect(tk).toHaveCount(0);
  await expect(mdi).toHaveValue("G1 X7");
  await expect(mdi).toBeFocused();
  await page.keyboard.type(" F1");
  await expect(mdi).toHaveValue("G1 X7 F1");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sentCmds()).filter(c => c.cmd === "mdi").map(c => c.text)).toEqual(["G1 X7 F1"]);
  await expect(mdi).toHaveValue("");
  // The send disabled the line for the busy latch (focus dropped); the
  // guarded return lands it back on the line — the next keys are MDI.
  await expect(mdi).toBeFocused();
  await page.keyboard.press("ArrowDown");   // into the history (newest first)
  await expect(mdi).toHaveValue("G1 X7 F1");
  await mdi.click();
  await expect(tk).toBeVisible();
  await key(tk, "Space");
  await key(tk, "Z");
  await expect(mdi).toHaveValue("G1 X7 F1 Z");
  expect((await cmds()).filter(c => c === "mdi")).toHaveLength(1);
});

test("field contract: every text field is a technical field — no autofill, autocorrect, autocapitalize or spellcheck, a stable name and an accessible name", async ({ page }) => {
  // UX-13: the operator's browser offered the MDI line as a login field.
  // MachineInput sets the contract for every catalog text field; a caller's
  // own attribute would win, so the scan reads the DOM, not the component.
  await open(page);
  await ctl({ op: "raw", frame: { type: "settings_init", settings: {} } });
  const seen = new Set<string>();
  async function scan(where: string) {
    const fields = await page.locator("input.inputField:not([readonly]):visible").all();
    expect(fields.length, `${where}: at least one text field`).toBeGreaterThan(0);
    for (const f of fields) {
      const name = await f.getAttribute("name");
      await expect(f, where).toHaveAttribute("autocomplete", "off");
      await expect(f, where).toHaveAttribute("autocorrect", "off");
      await expect(f, where).toHaveAttribute("autocapitalize", "off");
      await expect(f, where).toHaveAttribute("spellcheck", "false");
      expect(name, `${where}: name`).toMatch(/\S/);
      await expect(f, `${where}: accessible name`).toHaveAccessibleName(/\S/);
      // UX-13: Apple Passwords (Firefox/macOS) takes a field whose placeholder
      // holds the word "code" for a verification-code field — "G-code command"
      // on the MDI line popped it up on every focus (operator's variant test).
      expect(await f.getAttribute("placeholder") ?? "", `${where}: no word "code" in the placeholder`).not.toMatch(/\bcode\b/i);
      seen.add(`${where}:${name}`);
    }
  }
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  await expect(page.locator(".mdiInput")).toHaveAttribute("placeholder", "MDI command (↑↓ history)");
  await scan("MDI");
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await scan("Tools");
  await page.getByTitle("G-code Reference", { exact: true }).click();
  await scan("Reference");
  await page.locator(".dialogOverlay").first().getByRole("button", { name: /^(Cancel|Close .*)$/ }).first().click();
  await page.getByTitle("Settings", { exact: true }).click();
  await page.locator(".dialogOverlay").first().getByRole("tab", { name: "Machine", exact: true }).click();
  await scan("Settings · Machine");
  expect(seen.size).toBeGreaterThanOrEqual(4);
});

test("editor → number → editor keeps the buffer; a hidden tab locks, not ends, the session", async ({ page }) => {
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: "G0 X0\nM2\n" }));
  await open(page);
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 7, file: "/A.ngc" } });
  await expect(page.locator(".codeLine").first()).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const tk = page.locator(".tkStrip");
  await expect(tk).toBeVisible();
  await expect(tk.locator(".sub")).toHaveText("Editor · A.ngc");
  await page.locator(".cm-content").click();
  await page.keyboard.press("End");
  await key(tk, "(");
  await key(tk, "ABC keys");
  await typeKeys(tk, "edited");
  await key(tk, "Code keys");
  await key(tk, ")");
  await expect(page.locator(".cm-content")).toContainText("(edited)");
  // A number field elsewhere (the tool dialog — the strip's own fields are
  // covered while a text helper is up): the keypad replaces the keyboard,
  // the buffer stays; back in the editor a tap re-opens the keyboard.
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(tk).toHaveCount(0);
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await dialogField(page, "Diameter").click();
  await expect(page.locator(".nkStrip")).toBeVisible();
  await expect(tk).toHaveCount(0);
  await key(page.locator(".nkStrip"), "Discard");
  await page.locator(".editDialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("(edited)");
  await expect(tk).toHaveCount(0);
  await page.locator(".cm-content").click();
  await expect(tk).toBeVisible();
  // Leaving the tab by a tap: the tap itself is outside the input area, so
  // the helper closes (buffer kept); a tap into the editor re-opens it. (The
  // hidden-owner LOCK is the backstop for a non-pointer tab change.)
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  await expect(tk).toHaveCount(0);
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("(edited)");
  await page.locator(".cm-content").click();
  await expect(tk).toBeVisible();
  // Undo / Tab / newline exist for the editor.
  await key(tk, "Undo");
  await key(tk, "New line");
  await page.locator(".editActions").getByRole("button", { name: "Discard", exact: true }).click();
  await page.locator(".dialogOverlay").getByRole("button", { name: "Discard", exact: true }).click().catch(() => {});
  await expect(tk).toHaveCount(0);
});

test("offset cell: leaving the tab closes the keypad with its draft; only the visible cell's OK writes, once", async ({ page }) => {
  await open(page);
  await ctl({ op: "setAxes", axes: ["X", "Y", "Z"] });
  await page.getByRole("tab", { name: "Offsets", exact: true }).click();
  const cell = page.locator(".offsetPanel td.editableCell").first();
  await cell.click();
  const nk = page.locator(".nkStrip");
  await expect(nk).toBeVisible();
  await expect(nk.locator(".sub")).toContainText("G54 · X");
  await page.keyboard.type("17");
  // The tab tap is outside the input area: the keypad closes (no OK can be
  // pressed for a hidden target), the draft stays with the cell, no write.
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  await expect(nk).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__modalRegistry.open())).toBe(false);
  expect(await cmds()).not.toContain("set_wcs");
  // Back on the panel, the cell offers the draft; OK writes exactly once.
  await page.getByRole("tab", { name: "Offsets", exact: true }).click();
  await cell.click();
  await expect(nk).toBeVisible();
  await expect(nk.locator("[data-draft]")).toHaveText("draft");
  await expect(nk.locator(".nkExpr")).toHaveText("17");
  // A second cell retargets the session (its own owner, its own context).
  await page.locator(".offsetPanel td.editableCell").nth(1).click();
  await expect(nk.locator(".sub")).toContainText("G54 · Y");
  await cell.click();
  await expect(nk.locator(".nkExpr")).toHaveText("17");
  await key(nk, "Apply");
  await expect(nk).toHaveCount(0);
  await expect.poll(async () => (await sentCmds()).filter(c => c.cmd === "set_wcs")).toEqual([
    expect.objectContaining({ cmd: "set_wcs", target: "G54", x: 17 }),
  ]);
  expectNoMachineAction((await cmds()).filter(c => c !== "set_wcs"));
});

test("offset drafts end with the probe gate, not with a sibling cell's OK", async ({ page }) => {
  // Review round 2, UI-I05 B for the offset panel's cell owners.
  await open(page);
  await ctl({ op: "setAxes", axes: ["X", "Y", "Z"] });
  await page.getByRole("tab", { name: "Offsets", exact: true }).click();
  const cells = page.locator(".offsetPanel td.editableCell");
  const nk = page.locator(".nkStrip");
  await cells.first().click();
  await expect(nk.locator(".sub")).toContainText("G54 · X");
  await page.keyboard.type("17");
  await cells.nth(1).click();
  await expect(nk.locator(".sub")).toContainText("G54 · Y");
  await page.keyboard.type("5");
  await key(nk, "Apply");
  await expect(nk).toHaveCount(0);
  await expect.poll(async () => (await sentCmds()).filter(c => c.cmd === "set_wcs")).toEqual([
    expect.objectContaining({ cmd: "set_wcs", target: "G54", y: 5 }),
  ]);
  // The write's busy latch closed `probe` for 200 ms: not an owner end —
  // X still offers its draft.
  await cells.first().click();
  await expect(nk).toBeVisible();
  await expect(nk.locator("[data-draft]")).toHaveText("draft");
  await expect(nk.locator(".nkExpr")).toHaveText("17");
  // Parked behind Y again, the gate ends: every cell draft goes with it.
  await cells.nth(1).click();
  await expect(nk.locator(".sub")).toContainText("G54 · Y");
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, probe: false } } });
  await expect(nk).toHaveCount(0);
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL } });
  await expect(cells.first()).toBeVisible();
  await cells.first().click();
  await expect(nk).toBeVisible();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
  await expect(nk.locator(".nkExpr")).not.toHaveText("17");
  // A real revocation INSIDE the write's latch (round 3) ends every cell
  // context too: X drafts, Y's OK starts the latch (the cells lose their
  // editable state), `probe` closes and re-opens within it.
  await page.keyboard.type("17");
  await cells.nth(1).click();
  await expect(nk.locator(".sub")).toContainText("G54 · Y");
  await page.keyboard.type("6");
  await key(nk, "Apply");
  await expect(cells).toHaveCount(0);   // inside the latch
  await ctl({ op: "status_delta", data: { permissions: { ...PERMS_ALL, probe: false } } });
  await page.waitForTimeout(50);        // a second frame (see above)
  await ctl({ op: "status_delta", data: { permissions: PERMS_ALL } });
  await expect(cells.first()).toBeVisible();
  await cells.first().click();
  await expect(nk).toBeVisible();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
  await expect(nk.locator(".nkExpr")).not.toHaveText("17");
  await key(nk, "Discard");
  expect((await cmds()).filter(c => c === "set_wcs")).toHaveLength(2);
  expectNoMachineAction((await cmds()).filter(c => c !== "set_wcs"));
});

test.describe("touch", () => {
  test.use({ hasTouch: true });
  test("touch-only entry of code, expressions, braces and an umlaut description; correction mid-text", async ({ page }) => {
    await open(page);
    await page.getByRole("tab", { name: "MDI", exact: true }).tap();
    const mdi = page.locator(".mdiInput");
    await mdi.tap();
    const tk = page.locator(".tkStrip");
    await expect(tk).toBeVisible();
    // The first real touch put the UI in touch mode: the OS keyboard is
    // suppressed on the owner field, the strip keyboard is the only input.
    await expect(page.locator("html")).toHaveClass(/touch-device/);
    await expect(mdi).toHaveAttribute("inputmode", "none");
    const t = (s: string) => typeKeys(tk, s, tapKey);
    const line = async (text: string, keys: () => Promise<void>) => {
      await tapKey(tk, "Clear line");
      await keys();
      await expect(mdi).toHaveValue(text);
    };
    await line("; ( ... )", async () => { await t("; ( ... )"); });
    await line("#<tiefe> = [1 + 2]", async () => {
      await tapKey(tk, "#"); await tapKey(tk, "123 keys"); await tapKey(tk, "<");
      await tapKey(tk, "ABC keys"); await t("tiefe");
      await tapKey(tk, "123 keys"); await t("> = [1 + 2]");
    });
    await line("G0 Z{depth} F{feed}", async () => {
      await tapKey(tk, "Code keys"); await t("G0 Z");
      await tapKey(tk, "#+= keys"); await tapKey(tk, "{");
      await tapKey(tk, "ABC keys"); await t("depth");
      await tapKey(tk, "#+= keys"); await tapKey(tk, "}");
      await tapKey(tk, "Code keys"); await t(" F");
      await tapKey(tk, "#+= keys"); await tapKey(tk, "{");
      await tapKey(tk, "ABC keys"); await t("feed");
      await tapKey(tk, "#+= keys"); await tapKey(tk, "}");
    });
    // Correction in the middle: cursor left ×2, backspace, insert.
    await tapKey(tk, "Cursor left"); await tapKey(tk, "Cursor left"); await tapKey(tk, "Backspace");
    await tapKey(tk, "Code keys"); await tapKey(tk, "9");
    await expect(mdi).toHaveValue("G0 Z{depth} F{fe9d}");
    // Description with an umlaut and Shift in the tool dialog.
    await tapKey(tk, "Close keyboard");
    await page.getByRole("tab", { name: "Tools", exact: true }).tap();
    await page.getByRole("button", { name: "+ Add", exact: true }).tap();
    const desc = dialogField(page, "Description");
    await desc.tap();
    await expect(tk.locator(".sub")).toContainText("Description");
    await tapKey(tk, "Shift"); await tapKey(tk, "S"); await tapKey(tk, "Shift");
    await t("chaftfräser");
    await expect(desc).toHaveValue("Schaftfräser");
    expectNoMachineAction((await cmds()).filter(c => c !== "mdi"));
  });
});

test("a page switch keeps the field's selection", async ({ page }) => {
  await open(page);
  const mdi = await openMdi(page);
  const tk = page.locator(".tkStrip");
  await typeKeys(tk, "G0 X10");
  await mdi.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 6));
  await key(tk, "ABC keys");
  await key(tk, "123 keys");
  expect(await mdi.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([3, 6]);
});

for (const scheme of ["light", "dark"] as const) {
  test(`landscape ${scheme}: every page fits the strip budget and never changes the frame`, async ({ page }, info) => {
    await open(page);
    await page.emulateMedia({ colorScheme: scheme });
    const frame0 = await measureFrame(page);
    await openMdi(page);
    const tk = page.locator(".tkStrip");
    for (const p of ["Code keys", "ABC keys", "123 keys", "#+= keys"]) {
      await key(tk, p);
      await assertLayout(tk, await measureLayout(tk, `tk-${scheme}-${p}`), info);
      expect(frameChanges(frame0, await measureFrame(page))).toEqual([]);
      const h = (await tk.boundingBox())!.height;
      expect(h).toBeLessThanOrEqual(264.5);
    }
  });
}

test.describe("portrait, touch", () => {
  test.use({ hasTouch: true });
  test("every page: 44 px keys, no overflow, reachable without scrolling at 100 % and 150 %", async ({ page }, info) => {
    await open(page, { width: 900, height: 1200 });
    for (const zoom of ["1", "1.5"]) {
      await page.evaluate(z => { document.documentElement.style.zoom = z; }, zoom);
      const mdi = page.locator(".mdiInput");
      if (!(await page.locator(".tkStrip").count())) {
        await page.getByRole("tab", { name: "MDI", exact: true }).tap();
        await mdi.tap();
      }
      const tk = page.locator(".tkStrip");
      await expect(tk).toBeVisible();
      for (const p of ["Code keys", "ABC keys", "123 keys", "#+= keys"]) {
        await tapKey(tk, p);
        const snap = await measureLayout(tk, `tk-portrait-${zoom}-${p}`);
        await assertLayout(tk, snap, info);
        // Bounding boxes are in the zoomed coordinate space (as is
        // innerHeight), so 44 CSS px reads as 66 at 150 % — never scaled twice.
        const min = 43 * Number(zoom);
        for (const c of snap.controls) { expect(c.width).toBeGreaterThanOrEqual(min); expect(c.height).toBeGreaterThanOrEqual(min); }
        const fits = await tk.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const row = (sel: string) => el.querySelector(sel)!.getBoundingClientRect().bottom;
          const strip = el.closest(".strip")!;
          const h = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().height ?? 0;
          return {
            bottom: r.bottom, inner: window.innerHeight, overflow: el.scrollWidth > el.clientWidth + 1,
            pages: row(".tkPages"), actions: row(".tkActions"), nav: row(".tkNav"),
            stripScroll: strip.scrollHeight - strip.clientHeight,
            // What took the space above the keyboard (named in a failure).
            budget: { top: r.top, height: r.height, header: h("header.hdr"), banner: h(".statusBanner"),
              safety: h(".safetyStrip"), detail: h(".statusDetail"), stripTop: strip.getBoundingClientRect().top, stripScrollTop: strip.scrollTop },
          };
        });
        expect(fits.overflow, "horizontal overflow").toBe(false);
        // The agreed criterion (plan WP8, UI-I08): the whole helper within
        // the viewport at 100 % AND at 150 % (= 600 × 800 CSS px). What
        // makes it fit at 150 % is the sticky Safety section folding its
        // status detail away while a helper is open (title + the three
        // safety buttons stay) — measured below, never a smaller key, a
        // wider strip or a WP4 exception; the strip needs no scroll for it.
        expect(fits.bottom, `keyboard bottom within the viewport at zoom ${zoom}: ${JSON.stringify(fits.budget)}`).toBeLessThanOrEqual(fits.inner + 1);
        expect(fits.stripScroll, `no hidden strip part at zoom ${zoom}`).toBeLessThanOrEqual(1);
      }
      // The field being edited (the readout), the state banner and the
      // safety controls stay in view; the Safety detail is folded away.
      await expect(mdi).toBeInViewport();
      await expect(page.locator(".statusBanner")).toBeInViewport();
      for (const btn of await page.locator(".safetyBtns button").all()) await expect(btn).toBeInViewport();
      await expect(page.locator(".safetyStrip .statusDetail")).toHaveCount(0);
    }
    // Helper closed: the full detail returns.
    await tapKey(page.locator(".tkStrip"), "Close keyboard");
    await expect(page.locator(".tkStrip")).toHaveCount(0);
    await expect(page.locator(".safetyStrip .statusRow")).toHaveCount(8);
    await expect(page.locator(".safetyStrip .codesRow")).toHaveCount(1);
  });

  test("editor and search as owners: the readout stays visible and hit-testable at 100 % and 150 %; portrait edit mode folds the idle program controls", async ({ page }) => {
    // Review round 3 (UI-I08): with the EDITOR as owner the side pane had
    // 13.5 px left for the editor host at 150 % — the first line was
    // clipped by its overflow: hidden (a viewport rectangle alone passes).
    // Portrait edit mode now folds the file ops, the run controls and the
    // progress row while nothing runs; the readout is judged by HIT-TEST.
    await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: "G0 X0\nG1 X10 F100\nM2\n" }));
    await open(page, { width: 900, height: 1200 });
    await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 7, file: "/A.ngc" } });
    await expect(page.locator(".codeLine").first()).toBeVisible();
    // Touch sizing is set by the first touch — before the first Edit tap.
    await page.getByRole("tab", { name: "Program", exact: true }).tap();
    const tk = page.locator(".tkStrip");
    const hitAt = (sel: string, within: string) => page.evaluate(([sel, within]) => {
      const el = document.querySelector(sel); if (!el) return false;
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && !!hit.closest(within) && r.bottom <= window.innerHeight + 1;
    }, [sel, within] as const);
    for (const zoom of ["1", "1.5"]) {
      await page.evaluate(z => { document.documentElement.style.zoom = z; }, zoom);
      if (!(await tk.count())) {
        await page.getByRole("button", { name: "Edit", exact: true }).tap();
        await expect(page.locator(".cm-content")).toBeVisible();
      }
      await expect(tk).toBeVisible();
      await expect(tk.locator(".sub")).toHaveText("Editor · A.ngc");
      // Folded while nothing runs: no Start/Step row, no progress row, no file ops.
      await expect(page.getByRole("button", { name: /^Start/ })).toHaveCount(0);
      await expect(page.locator(".progressLabel")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Upload", exact: true })).toHaveCount(0);
      for (const p of ["Code keys", "ABC keys", "123 keys", "#+= keys"]) {
        await tapKey(tk, p);
        const fits = await tk.evaluate(el => ({ bottom: el.getBoundingClientRect().bottom, inner: window.innerHeight }));
        expect(fits.bottom, `keyboard bottom at zoom ${zoom} (${p})`).toBeLessThanOrEqual(fits.inner + 1);
      }
      await tapKey(tk, "Code keys");
      const lines = await page.evaluate(() => document.querySelector(".cm-scroller")!.getBoundingClientRect().height / document.querySelector(".cm-line")!.getBoundingClientRect().height);
      console.log(`EDITOR_LINES zoom ${zoom}: ${lines.toFixed(2)}`);
      expect(lines, `editor lines visible at zoom ${zoom}`).toBeGreaterThanOrEqual(3);
      expect(await hitAt(".cm-line", ".cm-content"), `first code line hit at its centre at zoom ${zoom}`).toBe(true);
      expect(await hitAt(".editActions button:first-child", ".editActions"), `Save hit at zoom ${zoom}`).toBe(true);
      expect(await hitAt(".editActions button:last-child", ".editActions"), `Discard hit at zoom ${zoom}`).toBe(true);
      // A key lands in the editor (touch only).
      await page.locator(".cm-line").first().tap();
      await page.keyboard.press("End");
      await tapKey(tk, ";");
      await expect(page.locator(".cm-line").first()).toContainText(";");
    }
    // Discard (dirty → the dialog asks): the controls return with the viewer.
    await page.locator(".editActions").getByRole("button", { name: "Discard", exact: true }).tap();
    await page.locator(".dialogOverlay").getByRole("button", { name: "Discard", exact: true }).tap();
    await expect(page.locator(".cm-content")).toHaveCount(0);
    await expect(tk).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Start/ })).toHaveCount(1);
    await expect(page.locator(".progressLabel")).toHaveCount(1);
    // A search field (the reference dialog) as owner at 150 %: the field is
    // hit at its centre and takes a key.
    await page.getByTitle("G-code Reference", { exact: true }).tap();
    const search = page.locator(".refSearch");
    await search.tap();
    await expect(tk).toBeVisible();
    expect(await hitAt(".refSearch", ".refSearch"), "search field hit at its centre at zoom 1.5").toBe(true);
    await tapKey(tk, "ABC keys");
    await tapKey(tk, "g");
    await expect(search).toHaveValue("g");
    await tapKey(tk, "Close keyboard");
    await expect(tk).toHaveCount(0);
    expectNoMachineAction(await cmds());
  });
});

// ── Design wave D7 (UI-K01 / K02, operator decision 4): the input helpers ──
//   - the close X is each helper's TOP-RIGHT key, 44 × 44, in landscape AND
//     portrait (it sat bottom-left in the portrait keypad and bottom-right
//     in the landscape keyboard);
//   - the Code page is laid out in blocks, the digits 7 8 9 / 4 5 6 /
//     1 2 3 / 0 . - in both orientations, the letters in one reading order;
//   - the number keypad at 150 % portrait keeps its keys, stays in the
//     viewport and never covers its owner field.
test.describe("D7, touch", () => {
  test.use({ hasTouch: true });
  const VIEWPORTS = [{ name: "landscape", width: 1280, height: 800 }, { name: "portrait", width: 900, height: 1200 }];
  /** Open in touch mode: the session's FIRST touch switches the layout to
   *  touch sizes, which moves the strip under the finger (a tap on a DRO
   *  field in portrait landed beside it) — a neutral tap first. */
  async function openTouch(page: Page, viewport: { width: number; height: number }) {
    await open(page, viewport);
    await page.touchscreen.tap(2, 2);
    await expect(page.locator("html")).toHaveClass(/touch-device/);
  }

  /** The helper's X against every other control in it. */
  function xAnchor(helper: Locator) {
    return helper.evaluate(el => {
      const shown = (b: Element) => (b as HTMLElement).offsetParent !== null;
      const controls = [...el.querySelectorAll("button, .nkDisplay")].filter(shown).map(b => ({ b, r: b.getBoundingClientRect() }));
      const x = controls.find(c => c.b.getAttribute("aria-label") === "Close keyboard")!;
      const others = controls.filter(c => c !== x);
      return { w: x.r.width, h: x.r.height,
        above: others.filter(c => c.r.top < x.r.top - 0.5).map(c => c.b.getAttribute("aria-label") ?? c.b.className),
        right: others.filter(c => c.r.right > x.r.right + 0.5).map(c => c.b.getAttribute("aria-label") ?? c.b.className) };
    });
  }

  test("the X is each helper's top-right key, 44 × 44 — number keypad and text keyboard, landscape and portrait", async ({ page }) => {
    for (const vp of VIEWPORTS) {
      await openTouch(page, vp);
      await page.locator("input.setupInput").first().tap();
      const nk = page.locator(".nkStrip");
      await expect(nk).toBeVisible();
      const n = await xAnchor(nk);
      expect([n.w, n.h], `${vp.name} number keypad: X is 44 × 44`).toEqual([44, 44]);
      expect(n.above, `${vp.name} number keypad: nothing above the X`).toEqual([]);
      expect(n.right, `${vp.name} number keypad: nothing right of the X`).toEqual([]);
      await tapKey(nk, "Close keyboard");
      await expect(nk).toHaveCount(0);

      await page.getByRole("tab", { name: "MDI", exact: true }).tap();
      await page.locator(".mdiInput").tap();
      const tk = page.locator(".tkStrip");
      await expect(tk).toBeVisible();
      for (const p of ["Code keys", "ABC keys"]) {
        await tapKey(tk, p);
        const t = await xAnchor(tk);
        expect([t.w, t.h], `${vp.name} keyboard ${p}: X is 44 × 44`).toEqual([44, 44]);
        expect(t.above, `${vp.name} keyboard ${p}: nothing above the X`).toEqual([]);
        expect(t.right, `${vp.name} keyboard ${p}: nothing right of the X`).toEqual([]);
      }
      await tapKey(tk, "Close keyboard");
      await expect(tk).toHaveCount(0);
    }
    expectNoMachineAction(await cmds());
  });

  test("the Code page: the digit block 7 8 9 / 4 5 6 / 1 2 3 / 0 . - in both orientations, the letters in one reading order; every page reads row by row", async ({ page }) => {
    for (const vp of VIEWPORTS) {
      await openTouch(page, vp);
      await page.getByRole("tab", { name: "MDI", exact: true }).tap();
      await page.locator(".mdiInput").tap();
      const tk = page.locator(".tkStrip");
      await expect(tk).toBeVisible();
      const grid = (await tk.locator(".tkContent").evaluate(el => [...el.querySelectorAll("button")].map(b => {
        const r = b.getBoundingClientRect();
        return { k: b.textContent!.trim(), x: Math.round(r.left), y: Math.round(r.top) };
      })));
      const at = (k: string) => grid.find(g => g.k === k)!;
      for (const row of [["7", "8", "9"], ["4", "5", "6"], ["1", "2", "3"], ["0", ".", "-"]]) {
        expect(new Set(row.map(k => at(k).y)).size, `${vp.name}: ${row.join(" ")} is one row`).toBe(1);
      }
      for (const col of [["7", "4", "1", "0"], ["8", "5", "2", "."], ["9", "6", "3", "-"]]) {
        expect(new Set(col.map(k => at(k).x)).size, `${vp.name}: ${col.join(" ")} is one column`).toBe(1);
      }
      expect(at("4").y > at("7").y && at("1").y > at("4").y && at("0").y > at("1").y, `${vp.name}: 7 8 9 on top`).toBe(true);
      const reading = [...grid].sort((a, b) => a.y - b.y || a.x - b.x);
      expect(reading.filter(g => /^[A-Z]$/.test(g.k)).map(g => g.k).join(" "), `${vp.name}: the letters`)
        .toBe("G M T F S X Y Z I J K P R Q");
      // ABC reads a b c … across the rows.
      await tapKey(tk, "ABC keys");
      const abc = (await tk.locator(".tkContent").evaluate(el => [...el.querySelectorAll("button")].map(b => {
        const r = b.getBoundingClientRect();
        return { k: b.textContent!.trim(), x: Math.round(r.left), y: Math.round(r.top) };
      }))).sort((a, b) => a.y - b.y || a.x - b.x).map(g => g.k).join("");
      expect(abc, `${vp.name}: ABC in reading order`).toBe("abcdefghijklmnopqrstuvwxyzäöüß");
    }
  });

  test("the number keypad at 100 % and 150 % portrait: 44 px keys, within the viewport, its owner field in view and not covered", async ({ page }) => {
    await openTouch(page, { width: 900, height: 1200 });
    for (const zoom of ["1", "1.5"]) {
      await page.evaluate(z => { document.documentElement.style.zoom = z; }, zoom);
      for (const owner of ["strip", "side pane"]) {
        let field: Locator;
        if (owner === "strip") field = page.locator("input.setupInput").first();
        else {
          if (zoom === "1") await page.getByRole("tab", { name: "Probing", exact: true }).tap();
          else await page.getByRole("combobox", { name: "Side panel", exact: true }).selectOption("probe");
          field = page.locator(".probePanel .formGrid input").first();
        }
        await field.scrollIntoViewIfNeeded();
        await field.tap();
        const nk = page.locator(".nkStrip");
        await expect(nk).toBeVisible();
        const snap = await measureLayout(nk, `nk-portrait-${zoom}-${owner}`);
        const min = 43 * Number(zoom);
        for (const c of snap.controls) {
          expect(c.width, `${owner} ${zoom}: ${c.label}`).toBeGreaterThanOrEqual(min);
          expect(c.height, `${owner} ${zoom}: ${c.label}`).toBeGreaterThanOrEqual(min);
        }
        const box = (await nk.boundingBox())!;
        expect(box.y + box.height, `${owner} ${zoom}: keypad within the viewport`).toBeLessThanOrEqual(await page.evaluate(() => innerHeight) + 1);
        await expect(field, `${owner} ${zoom}: the owner field in view`).toBeInViewport();
        expect(await field.evaluate(f => {
          const r = f.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return f === at || f.contains(at);
        }), `${owner} ${zoom}: the owner field is not covered`).toBe(true);
        await tapKey(nk, "Discard");
        await expect(nk).toHaveCount(0);
      }
    }
    // Six axes (the TWP machine): the first and the last axis field stay in
    // view with the whole keypad at 150 % — Setup keeps only its axis rows
    // while the keypad edits one. (Nine axes at 150 % portrait lose the
    // first rows under the Safety section: a named limit.)
    await ctl({ op: "setAxes", axes: ["X", "Y", "Z", "A", "B", "C"] });
    await expect(page.locator("input.setupInput")).toHaveCount(6);
    for (const i of [0, 5]) {
      const field = page.locator("input.setupInput").nth(i);
      await field.scrollIntoViewIfNeeded();
      await field.tap();
      const nk = page.locator(".nkStrip");
      await expect(nk).toBeVisible();
      const box = (await nk.boundingBox())!;
      expect(box.y + box.height, `six axes, field ${i}: keypad within the viewport`).toBeLessThanOrEqual(await page.evaluate(() => innerHeight) + 1);
      expect(await field.evaluate(f => {
        const r = f.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return f === at || f.contains(at);
      }), `six axes, field ${i}: in view, not covered`).toBe(true);
      await tapKey(nk, "Discard");
      await expect(nk).toHaveCount(0);
    }
    await page.evaluate(() => { document.documentElement.style.zoom = ""; });
    expectNoMachineAction(await cmds());
  });
});

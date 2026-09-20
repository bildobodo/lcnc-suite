import { test, expect, type Page, type Locator } from "@playwright/test";
import { ctl, MOCK } from "./ctl";
import { measureLayout, assertLayout, measureFrame, frameChanges } from "./layout-audit";

// WP8 / UI-15 — ONE input helper for every target (MDI line, editor, search
// and description fields, number fields), owned by one target at a time,
// opened by a deliberate tap/click or the keyboard glyph — never by focus —
// and closed without confirming anything by a tap or a Tab outside its
// focus area. Runs under `serial-guards`.

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};
const MACHINE_CMDS = ["cycle_start", "cycle_pause", "cycle_resume", "abort", "jog_cont", "jog_incr",
  "go_to_zero", "touchoff", "set_kins_mode", "home_all", "machine_on", "estop", "mdi", "twp_capture", "save_settings"];

async function cmds(): Promise<string[]> {
  const sent = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] };
  return (sent.cmds ?? []).map(c => c.cmd ?? "");
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

/** Tap a strip key by its accessible name (pointerdown.prevent handlers). */
async function key(strip: Locator, name: string) {
  await strip.getByRole("button", { name, exact: true }).dispatchEvent("pointerdown", { button: 0 });
}
async function typeKeys(strip: Locator, text: string) {
  for (const ch of text) await key(strip, ch === " " ? "Space" : ch);
}

async function openMdi(page: Page) {
  await page.getByRole("button", { name: "MDI", exact: true }).click();
  const mdi = page.locator(".mdiInput");
  await mdi.click();
  await expect(page.locator(".tkStrip")).toBeVisible();
  return mdi;
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
  await page.locator("input.setupInput").first().click();
  await expect(nk).toBeVisible();
  await expect(tk).toHaveCount(0);
  await expect(nk.locator(".sub")).toContainText("Touch off X");
  await key(nk, "Cancel");
  await expect(nk).toHaveCount(0);
  await expect(tk).toHaveCount(0);
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
  await key(nk, "Cancel");
  await x.click();
  await expect(nk.locator("[data-draft]")).toHaveCount(0);
});

test("tap outside, Tab outside and Close hide the keyboard without confirming; a re-tap re-opens", async ({ page }) => {
  await open(page);
  const mdi = await openMdi(page);
  const tk = page.locator(".tkStrip");
  await typeKeys(tk, "G0 X1");
  await expect(mdi).toHaveValue("G0 X1");
  // Operating the keys is not leaving.
  await expect(tk).toBeVisible();
  // Tap outside (header) → closed, nothing sent, text kept.
  await page.locator("header.hdr").dispatchEvent("pointerdown", { button: 0 });
  await expect(tk).toHaveCount(0);
  await expect(mdi).toHaveValue("G0 X1");
  expect(await cmds()).not.toContain("mdi");
  // Same field, tapped again → opens again.
  await mdi.click();
  await expect(tk).toBeVisible();
  // Tab out of the focus area → closed.
  await mdi.focus();
  await page.keyboard.press("Tab");
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
  await typeKeys(tk, "g0");
  await expect(search).toHaveValue("g0");
  // Tapping inside the dialog on the field does not close it.
  await search.dispatchEvent("pointerdown", { button: 0 });
  await expect(tk).toBeVisible();
  await key(tk, "Done");
  await expect(tk).toHaveCount(0);
  expectNoMachineAction(await cmds());
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
  await typeKeys(tk, "(edited)");
  await expect(page.locator(".cm-content")).toContainText("(edited)");
  // Number field → keypad; cancel; a tap into the editor re-opens the keyboard.
  await page.locator("input.setupInput").first().click();
  await expect(page.locator(".nkStrip")).toBeVisible();
  await expect(tk).toHaveCount(0);
  await key(page.locator(".nkStrip"), "Cancel");
  await expect(page.locator(".cm-content")).toContainText("(edited)");
  await page.locator(".editorHost").dispatchEvent("pointerup", { button: 0 });
  await expect(tk).toBeVisible();
  // Hidden tab: helper hidden, session kept, buffer kept.
  await page.getByRole("button", { name: "MDI", exact: true }).click();
  await expect(tk).toHaveCount(0);
  await page.getByRole("button", { name: "Program", exact: true }).click();
  await expect(tk).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("(edited)");
  // Undo / Tab / newline exist for the editor.
  await key(tk, "Undo");
  await key(tk, "New line");
  await page.locator(".editActions").getByRole("button", { name: "Discard", exact: true }).click();
  await page.locator(".dialogOverlay").getByRole("button", { name: "Discard", exact: true }).click().catch(() => {});
  await expect(tk).toHaveCount(0);
});

test("touch-only entry of code, expressions, braces and an umlaut description; correction mid-text", async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.documentElement.classList.add("touch-device"));
  const mdi = await openMdi(page);
  const tk = page.locator(".tkStrip");
  const line = async (text: string, keys: () => Promise<void>) => {
    await key(tk, "Clear the line");
    await keys();
    await expect(mdi).toHaveValue(text);
  };
  await line("; ( ... )", async () => { await typeKeys(tk, "; ( ... )"); });
  await line("#<tiefe> = [1 + 2]", async () => {
    await key(tk, "#"); await key(tk, "123 keys"); await key(tk, "<");
    await key(tk, "ABC keys"); await typeKeys(tk, "tiefe");
    await key(tk, "123 keys"); await typeKeys(tk, "> = [1 + 2]");
  });
  await line("G0 Z{depth} F{feed}", async () => {
    await key(tk, "Code keys"); await typeKeys(tk, "G0 Z");
    await key(tk, "#+= keys"); await key(tk, "{");
    await key(tk, "ABC keys"); await typeKeys(tk, "depth");
    await key(tk, "#+= keys"); await key(tk, "}");
    await key(tk, "Code keys"); await typeKeys(tk, " F");
    await key(tk, "#+= keys"); await key(tk, "{");
    await key(tk, "ABC keys"); await typeKeys(tk, "feed");
    await key(tk, "#+= keys"); await key(tk, "}");
  });
  // Correction in the middle: cursor left ×2, backspace, insert.
  await key(tk, "Cursor left"); await key(tk, "Cursor left"); await key(tk, "Backspace");
  await key(tk, "Code keys"); await key(tk, "9");
  await expect(mdi).toHaveValue("G0 Z{depth} F{fe9d}");
  // Description with an umlaut and Shift in the tool dialog.
  await key(tk, "Close keyboard");
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  const desc = page.locator(".editDialog label", { hasText: "Description" }).locator("xpath=following-sibling::input[1]");
  await desc.click();
  await expect(tk.locator(".sub")).toContainText("Description");
  await key(tk, "Shift"); await key(tk, "S"); await key(tk, "Shift");
  await typeKeys(tk, "chaftfräser");
  await expect(desc).toHaveValue("Schaftfräser");
  expectNoMachineAction((await cmds()).filter(c => c !== "mdi"));
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
    await page.evaluate(() => document.documentElement.classList.add("touch-device"));
    for (const zoom of ["1", "1.5"]) {
      await page.evaluate(z => { document.documentElement.style.zoom = z; }, zoom);
      const mdi = page.locator(".mdiInput");
      if (!(await page.locator(".tkStrip").count())) await openMdi(page);
      const tk = page.locator(".tkStrip");
      for (const p of ["Code keys", "ABC keys", "123 keys", "#+= keys"]) {
        await key(tk, p);
        const snap = await measureLayout(tk, `tk-portrait-${zoom}-${p}`);
        await assertLayout(tk, snap, info);
        for (const c of snap.controls) { expect(c.width).toBeGreaterThanOrEqual(43); expect(c.height).toBeGreaterThanOrEqual(43); }
        const fits = await tk.evaluate((el, z) => {
          const r = el.getBoundingClientRect();
          return { bottom: r.bottom * Number(z), inner: window.innerHeight, overflow: el.scrollWidth > el.clientWidth + 1 };
        }, zoom);
        expect(fits.overflow, "horizontal overflow").toBe(false);
        expect(fits.bottom, `keyboard bottom at zoom ${zoom}`).toBeLessThanOrEqual(fits.inner + 1);
      }
      await expect(mdi).toBeVisible();
      await expect(page.locator(".safetyStrip")).toBeVisible();
    }
  });
});

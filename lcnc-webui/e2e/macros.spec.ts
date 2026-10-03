// Package 5, stage C (plan docs/reviews/makros.plan.md): the Macros tab and
// macro FILES on the bar, against the in-memory folder of macroFolder.ts.
import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";
import { Folder, serve, rev, PARK, FACE } from "./macroFolder";
import { clickMore, moreTrigger } from "./more";

const HOLD_MS = 700;

async function ready(page: Page, folder: Folder, settings: Record<string, unknown> = {}) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await serve(page, folder);
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "raw", frame: { type: "settings_init", settings } });
  await ctl({ op: "clearCmds" });
}

async function sent(): Promise<{ cmd?: string; name?: string; revision?: string; args?: number[] }[]> {
  const r = await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] };
  return r.cmds ?? [];
}
const runs = async () => (await sent()).filter(c => c.cmd === "run_macro");

async function press(page: Page, sel: ReturnType<Page["locator"]>, ms: number) {
  const b = (await sel.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function openTab(page: Page) {
  await page.getByRole("tab", { name: "Macros", exact: true }).click();
  await expect(page.locator(".macrosTab")).toBeVisible();
}

test.afterEach(async () => { await ctl({ op: "reset" }); });

test("the Macros tab lists the folder; a file put on the bar runs on a hold bound to its revision", async ({ page }, info) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [] } });
  await openTab(page);
  await expect(page.locator("[data-macro-row]")).toHaveCount(2);
  await info.attach("macros-tab.png", { body: await page.screenshot(), contentType: "image/png" });
  await page.locator('[data-macro-row="park"]').getByRole("checkbox").check({ force: true });
  const bar = page.locator(".macroBar");
  const park = bar.getByRole("button", { name: "Park", exact: true });
  await expect(park).toBeVisible();
  await press(page, park, 120);
  expect(await runs(), "a tap runs nothing").toEqual([]);
  await press(page, park, HOLD_MS);
  await expect.poll(runs).toEqual([expect.objectContaining({ name: "park", revision: rev(PARK), args: [] })]);
});

test("a macro file with parameters opens its dialog with the header's fields; Execute holds and sends numbers", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [], bar: ["face_top"] } });
  await page.locator(".macroBar").getByRole("button", { name: "Face top", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Face top" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("mm/min")).toBeVisible();
  await press(page, dialog.getByRole("button", { name: "Execute" }), HOLD_MS);
  await expect.poll(runs).toEqual([expect.objectContaining({ name: "face_top", revision: rev(FACE), args: [0.5, 600] })]);
});

test("an unsaved draft blocks the run of THAT macro on the bar and in the tab; Save restores it at the new revision", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [], bar: ["park", "face_top"] } });
  await openTab(page);
  await page.locator('[data-macro-row="park"]').getByRole("button", { name: "Open park.ngc" }).click();
  await expect(page.locator(".macroCode .cm-content")).toBeVisible();
  const barPark = page.locator(".macroBar").getByRole("button", { name: "Park", exact: true });
  await expect(barPark).toBeEnabled();
  await page.locator(".macroCode .cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await expect(barPark, "the edited macro is dimmed on the bar").toBeDisabled();
  await expect(page.locator(".macroBar").getByRole("button", { name: "Face top", exact: true }), "another macro is not").toBeEnabled();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(barPark).toBeEnabled();
  const saved = folder.files.get("park")!.text;
  expect(saved).not.toBe(PARK);
  await press(page, barPark, HOLD_MS);
  await expect.poll(runs).toEqual([expect.objectContaining({ name: "park", revision: rev(saved) })]);
});

test("another client's save under a draft is a conflict: Reload shows the disk; nothing is overwritten silently", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [] } });
  await openTab(page);
  await page.locator('[data-macro-row="park"]').getByRole("button", { name: "Open park.ngc" }).click();
  await page.locator(".macroCode .cm-content").click();
  await page.keyboard.type("(mine)");
  folder.touch("park", PARK.replace("G90", "G90 (theirs)"));
  await ctl({ op: "raw", frame: { type: "macros_changed", version: 2 } });
  await expect(page.locator("[data-macro-conflict]")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("[data-macro-conflict]")).toBeVisible();
  expect(folder.files.get("park")!.text, "their save survives").toContain("(theirs)");
  await page.locator("[data-macro-conflict]").getByRole("button", { name: "Reload" }).click();
  await expect(page.locator(".macroCode .cm-content")).toContainText("(theirs)");
});

test("leaving the tab over a draft asks first: Keep editing stays, Discard leaves", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [] } });
  await openTab(page);
  await page.locator('[data-macro-row="park"]').getByRole("button", { name: "Open park.ngc" }).click();
  await page.locator(".macroCode .cm-content").click();
  await page.keyboard.type("x");
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  const ask = page.getByRole("dialog", { name: "Discard changes?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByRole("tab", { name: "Macros", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await page.getByRole("dialog", { name: "Discard changes?" }).getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("tab", { name: "Program", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(folder.files.get("park")!.text, "nothing saved").toBe(PARK);
});

// ── The run state follows the file (plan "Run und Editorentwurf", Codex VP69-05) ──
test("another client's save during a bar hold cancels it; the next hold runs the new revision once", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [], bar: ["park"] } });
  const park = page.locator(".macroBar").getByRole("button", { name: "Park", exact: true });
  await expect(park).toBeEnabled();
  const box = (await park.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const theirs = PARK.replace("G90", "G90 (theirs)");
  folder.touch("park", theirs);
  await ctl({ op: "raw", frame: { type: "macros_changed", version: 2 } });
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  await expect(page.locator("[data-btn-hint]")).toHaveText("Selection changed — hold again");
  expect(await runs(), "the hold bound to the old revision ran nothing").toEqual([]);
  await press(page, park, HOLD_MS);
  await expect.poll(runs).toEqual([expect.objectContaining({ name: "park", revision: rev(theirs) })]);
});

test("the open parameter dialog follows its file: a new header shows its field; a file that may not run dims Execute with the reason", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [], bar: ["face_top"] } });
  await page.locator(".macroBar").getByRole("button", { name: "Face top", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Face top" });
  const execute = dialog.getByRole("button", { name: "Execute", exact: true });
  await expect(execute).toBeEnabled();
  // another client adds a parameter: the dialog shows it, with its default
  const meta = folder.files.get("face_top")!.meta as { params: Record<string, unknown>[] };
  folder.files.get("face_top")!.meta = { ...meta, params: [...meta.params,
    { n: 3, key: "clear", label: "Clearance Z", unit: "length", default: 5, min: 1, max: 100, integer: false }] };
  folder.touch("face_top", FACE.replace("(PARAM 2 feed", '(PARAM 3 clear "Clearance Z" length 5 min=1 max=100)\n(PARAM 2 feed'));
  await ctl({ op: "raw", frame: { type: "macros_changed", version: 2 } });
  await expect(dialog.getByLabel("Clearance Z", { exact: true })).toHaveValue("5");
  // a save that breaks the header: the gateway says why; Execute is dimmed with it
  folder.blocked.set("face_top", "PARAM positions must run 1, 2, 3 … without a gap");
  folder.touch("face_top", FACE + "\n");
  await ctl({ op: "raw", frame: { type: "macros_changed", version: 3 } });
  await expect(dialog.getByRole("alert")).toContainText("PARAM positions must run");
  await expect(execute).toBeDisabled();
  await press(page, execute, HOLD_MS);
  await page.waitForTimeout(200);
  expect(await runs(), "a file that may not run runs nothing").toEqual([]);
  await expect(page.locator(".macroBar").getByRole("button", { name: "Face top", exact: true }), "the bar agrees").toBeDisabled();
});

test("a late read after a selection change never shows the earlier macro's text", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [] } });
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  await page.route(/\/macro\?name=park(&|$)/, async r => {
    if (r.request().method() !== "GET") return r.fallback();
    await held;                   // park's text arrives after face_top's
    return r.fallback();
  });
  await openTab(page);
  await page.locator('[data-macro-row="park"]').getByRole("button", { name: "Open park.ngc" }).click();
  await page.locator('[data-macro-row="face_top"]').getByRole("button", { name: "Open face_top.ngc" }).click();
  const code = page.locator(".macroCode .cm-content");
  await expect(code).toContainText("o<face_top> sub");
  release();
  await page.waitForTimeout(400);
  await expect(code, "the late park reply changed nothing").toContainText("o<face_top> sub");
  await expect(code).not.toContainText("o<park>");
});

// The tab never runs out sideways — desktop, touch portrait 100 % and 150 %
// (narrow, 272 px of content): the list with the longest example names, every
// file on the bar (the order buttons show), the editor open. Only the code
// itself may scroll sideways (.cm-scroller). Found by the renders: the order
// buttons side by side and an unbreakable file name made the list 320 px wide.
test("the Macros tab never runs out sideways: desktop, portrait 100 % and 150 %", async ({ page }) => {
  for (const vp of [{ w: 1600, h: 1000, touch: false, zoom: 1 }, { w: 900, h: 1200, touch: true, zoom: 1 },
                    { w: 900, h: 1200, touch: true, zoom: 1.5 }]) {
    const folder = new Folder();
    for (const n of ["go_to_g30_macro", "spindle_warmup", "coolant_flush"]) {
      folder.files.set(n, { text: `o<${n}> sub\no<${n}> endsub\n`, meta: { title: n, units: null, frame: null, params: [] } });
    }
    await ready(page, folder, { macros: { macros: [], bar: ["park", "face_top", "go_to_g30_macro", "spindle_warmup", "coolant_flush"] } });
    await page.setViewportSize({ width: vp.w, height: vp.h });
    if (vp.touch) await page.evaluate(() => document.documentElement.classList.add("touch-device"));
    if (vp.zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, vp.zoom);
    const select = page.getByRole("combobox", { name: "Side panel" });
    if (await select.isVisible()) await select.selectOption({ label: "Macros" });
    else await page.getByRole("tab", { name: "Macros", exact: true }).click();
    await expect(page.locator(".macrosTab")).toBeVisible();
    await page.locator('[data-macro-row="go_to_g30_macro"]').getByRole("button", { name: "Open go_to_g30_macro.ngc" }).click();
    await expect(page.locator(".macroCode .cm-content")).toBeVisible();
    await page.waitForTimeout(300);
    const sideways = await page.evaluate(() => [...document.querySelectorAll(".macrosTab, .macrosTab *")]
      .filter(e => !(e as HTMLElement).closest(".cm-scroller"))
      .filter(e => getComputedStyle(e).overflowX !== "visible" && e.scrollWidth > e.clientWidth + 1)
      .map(e => `${(e as HTMLElement).className} ${e.scrollWidth} > ${e.clientWidth}`));
    expect(sideways, `${vp.w}×${vp.h} ${vp.zoom * 100} %`).toEqual([]);
  }
});

// Plan, dialog case 20: after a delete the focus goes to the next row, else
// the previous, else the tab's head (More) — never back to Delete, which the
// lost selection disables: Chromium then drops the focus to body, where an
// arrow key jogs.
test("after a delete the focus goes to the next row, else the previous, else More — never to body", async ({ page }) => {
  const folder = new Folder();
  folder.files.set("coolant_flush", { text: "o<coolant_flush> sub\no<coolant_flush> endsub\n",
    meta: { title: "Coolant flush", units: null, frame: null, params: [] } });
  await ready(page, folder, { macros: { macros: [] } });
  await openTab(page);
  const active = () => page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return !a || a === document.body ? "BODY" : (a.getAttribute("aria-label") ?? a.textContent?.trim() ?? a.tagName);
  });
  const remove = async (name: string, title: string) => {
    await page.locator(`[data-macro-row="${name}"]`).getByRole("button", { name: `Open ${name}.ngc` }).click();
    await clickMore(page.locator(".macrosTab .panelHead"), "Delete");
    await page.getByRole("dialog", { name: `Delete ${title}?` }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.locator(`[data-macro-row="${name}"]`)).toHaveCount(0);
    await page.waitForTimeout(300);
  };
  // rows by name: coolant_flush, face_top, park
  await remove("coolant_flush", "Coolant flush");
  expect(await active(), "the next row").toBe("Open face_top.ngc");
  await remove("park", "Park");
  expect(await active(), "the previous row (park was last)").toBe("Open face_top.ngc");
  await remove("face_top", "Face top");
  expect(await active(), "no row left: the head's More").toBe("More macro actions");
});

// Operator 2026-10-02: the editor is pushed in RIGHT UNDER the macro it
// edits, the macros below move down; a second tap on the name closes it
// (over a draft it asks first); a macro opened further down comes into view.
test("the editor opens under its own macro and pushes the rest down; a second tap closes it; a lower macro comes into view", async ({ page }) => {
  const folder = new Folder();
  for (const n of ["a_first", "b_second", "m_middle", "x_one", "y_two", "z_last"]) {
    folder.files.set(n, { text: `o<${n}> sub\n  M73\no<${n}> endsub\n`, meta: { title: n, units: null, frame: null, params: [] } });
  }
  await ready(page, folder, { macros: { macros: [] } });
  await openTab(page);
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const open = (n: string) => page.locator(`[data-macro-row="${n}"]`).getByRole("button", { name: `Open ${n}.ngc` });

  await open("face_top").click();
  await expect(page.locator('[data-macro-editor="face_top"] .cm-content')).toBeVisible();
  expect(await page.locator('[data-macro-row="face_top"]').evaluate(r => (r.nextElementSibling as HTMLElement | null)?.dataset.macroEditor),
    "the editor row follows its macro's row").toBe("face_top");
  const row = await box('[data-macro-row="face_top"]');
  const ed = await box('[data-macro-editor="face_top"]');
  const next = await box('[data-macro-row="m_middle"]');
  expect(ed.y, "under its macro").toBeGreaterThanOrEqual(row.y + row.height - 1);
  expect(next.y, "the next macro moved down below it").toBeGreaterThanOrEqual(ed.y + ed.height - 1);
  const code = await box('[data-macro-editor="face_top"] .macroCode');
  const lineH = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--code-line-h")));
  expect(code.height, "twelve code lines").toBeGreaterThanOrEqual(12 * lineH - 1);
  await expect(open("face_top")).toHaveAttribute("aria-expanded", "true");

  // a second tap closes it
  await open("face_top").click();
  await expect(page.locator("[data-macro-editor]")).toHaveCount(0);
  await expect(open("face_top")).toHaveAttribute("aria-expanded", "false");

  // over a draft the close asks first; Keep editing keeps it open
  await open("face_top").click();
  await page.locator('[data-macro-editor="face_top"] .cm-content').click();
  await page.keyboard.type("x");
  await open("face_top").click();
  const ask = page.getByRole("dialog", { name: "Discard changes?" });
  await expect(ask).toBeVisible();
  await ask.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.locator('[data-macro-editor="face_top"]')).toHaveCount(1);
  await open("face_top").click();
  await page.getByRole("dialog", { name: "Discard changes?" }).getByRole("button", { name: "Discard" }).click();
  await expect(page.locator("[data-macro-editor]")).toHaveCount(0);

  // a macro tapped at the body's lower edge moves to the top under the list's
  // head, its editor below it in view — not opened out of sight
  await page.locator(".macrosBody").evaluate(b => { b.scrollTop = 0; });
  await page.locator('[data-macro-row="z_last"]').evaluate(r => {
    const b = r.closest(".macrosBody") as HTMLElement;
    b.scrollTop += r.getBoundingClientRect().bottom - b.getBoundingClientRect().bottom;   // its row the last visible one
  });
  await page.waitForTimeout(100);
  const before = await box('[data-macro-row="z_last"]');
  const body = await box(".macrosBody");
  expect(before.y + before.height, "the row starts at the body's lower edge").toBeGreaterThan(body.y + body.height - 3);
  const btn = await open("z_last").boundingBox();
  await page.mouse.click(btn!.x + btn!.width / 2, btn!.y + btn!.height / 2);   // no auto-scroll: where it is
  await expect(page.locator('[data-macro-editor="z_last"] .cm-content')).toBeVisible();
  await page.waitForTimeout(200);
  const head = await box(".macroTable thead");
  const last = await box('[data-macro-row="z_last"]');
  const lastEd = await box('[data-macro-editor="z_last"]');
  expect(last.y, "the row in view, under the sticky head").toBeGreaterThanOrEqual(head.y + head.height - 1);
  // at the top under the head — or, where the body cannot scroll that far
  // (the last macro), its editor wholly in view
  const atTop = Math.abs(last.y - (head.y + head.height)) <= 2;
  const editorWhole = lastEd.y + lastEd.height <= body.y + body.height + 1;
  expect(atTop || editorWhole, `row at ${last.y - head.y - head.height} px under the head, editor ends ${lastEd.y + lastEd.height - body.y - body.height} px past the body`).toBe(true);
});

// Operator 2026-10-02 (live): ONE action row — Run and Abort side by side on
// the left, the management (New, Upload, Download, Delete) behind More at the
// right end (MoreMenu.vue), desktop and narrow. The panel opens under More,
// end edges aligned; by keyboard the focus goes to its first item, the
// arrows move among the items and never jog; Tab out closes it; an item
// that opens a dialog hands the dialog's return to More.
test("one action row: Run and Abort left, More right; its panel, its keys, and a dialog's return to More", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [] } });
  await openTab(page);
  const head = page.locator(".macrosTab .panelHead");
  const more = moreTrigger(head);
  const row = async () => {
    const [run, abort, m] = await Promise.all(["Run", "Abort"].map(n => head.getByRole("button", { name: n, exact: true }).boundingBox())
      .concat(more.boundingBox()));
    return { run: run!, abort: abort!, more: m! };
  };
  for (const narrow of [false, true]) {
    if (narrow) {
      await page.setViewportSize({ width: 900, height: 1200 });
      await page.evaluate(() => document.documentElement.classList.add("touch-device"));
      await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
      await expect(page.getByRole("combobox", { name: "Side panel" })).toBeVisible();
    }
    const r = await row();
    const where = narrow ? "narrow" : "wide";
    expect(new Set([r.run.y, r.abort.y, r.more.y].map(Math.round)).size, `${where}: one row`).toBe(1);
    expect(r.abort.x - (r.run.x + r.run.width), `${where}: Abort right beside Run`).toBeLessThanOrEqual(16);
    expect(r.more.x, `${where}: More right of Abort`).toBeGreaterThan(r.abort.x + r.abort.width);
    const groupRight = await head.locator(".actionGroup").evaluate(g => g.getBoundingClientRect().right);
    expect(Math.abs(r.more.x + r.more.width - groupRight), `${where}: More at the row's right end`).toBeLessThanOrEqual(1);
    for (const n of ["New", "Upload", "Download", "Delete"]) {
      await expect(head.getByRole("button", { name: n, exact: true }), `${where}: ${n} folded`).toBeHidden();
    }
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator(`[id="${await more.getAttribute("aria-controls")}"]`);
    for (const n of ["New", "Upload", "Download", "Delete"]) await expect(panel.getByRole("button", { name: n, exact: true })).toBeVisible();
    const pb = (await panel.boundingBox())!, mb = (await more.boundingBox())!;
    expect(Math.abs(pb.x + pb.width - (mb.x + mb.width)), `${where}: the panel's end on More's`).toBeLessThanOrEqual(1.5);
    expect(pb.y, `${where}: under More`).toBeGreaterThanOrEqual(mb.y + mb.height - 1);
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "false");
  }

  // keys: Enter opens, the first item takes the focus, the arrows move and never jog
  // (a macro selected: Download and Delete are enabled too). Keyboard jog ON,
  // the arrows bound to jog (tabs.spec's setting): an arrow that reached the
  // shortcut map WOULD jog — the control on the bare page proves it does.
  await page.locator('[data-macro-row="park"]').getByRole("button", { name: "Open park.ngc" }).click();
  await ctl({ op: "status_delta", data: { homed: [1, 1, 1], permissions: { jog: true, ready: true, idle: true, probe: true,
    setup: true, armed: true, always: true, abort: true, safety: true, override: true, zero: true } } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { macros: { macros: [] }, keyboard: { jogEnabled: true, buttonsEnabled: true,
    mapping: { "jog_x+": "ArrowRight", "jog_x-": "ArrowLeft", "jog_y+": "ArrowUp", "jog_y-": "ArrowDown", "jog_z+": "Home", "jog_z-": "End",
               estop: "Escape", cycle: " ", abort: "Backspace" } } } } });
  const jogs = async () => (await sent()).map(c => c.cmd ?? "").filter(c => c.startsWith("jog"));
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await ctl({ op: "clearCmds" });
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(150);
  await page.keyboard.up("ArrowRight");
  await expect.poll(jogs, { message: "control: ArrowRight on the bare page jogs" }).toContain("jog_cont");
  await more.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator(`[id="${await more.getAttribute("aria-controls")}"]`);
  await expect(panel.getByRole("button", { name: "New", exact: true })).toBeFocused();
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("ArrowDown");
  await expect(panel.getByRole("button", { name: "Upload", exact: true })).toBeFocused();
  for (const key of ["ArrowLeft", "ArrowRight", "Control+ArrowDown", "Alt+ArrowUp", "Shift+ArrowLeft", "Meta+ArrowRight"]) {
    await page.keyboard.press(key);
  }
  await expect(panel.getByRole("button", { name: "Upload", exact: true }), "a modifier or a side arrow moves nothing").toBeFocused();
  await page.keyboard.press("End");
  await expect(panel.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(panel.getByRole("button", { name: "New", exact: true })).toBeFocused();
  await page.waitForTimeout(200);
  expect(await jogs(), "no key in the panel jogs").toEqual([]);
  // Tab out closes it
  await page.keyboard.press("End");
  await page.keyboard.press("Tab");
  await expect(more).toHaveAttribute("aria-expanded", "false");
  // an item that opens a dialog: closing the dialog returns to More
  await clickMore(head, "New");
  const dialog = page.getByRole("dialog", { name: "New Macro" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(more, "the dialog returned to More").toBeFocused();
});

// Operator 2026-10-02 (live): switching "On bar" made the order buttons
// appear — the row grew, the columns changed width, and the row moved to the
// bar group at the top ("es kommt wieder zu einem Springen"). The order slot
// is reserved in every row and the list stays in name order: nothing in the
// list moves; the bar shows the order the arrows change.
test("On bar and the order buttons move nothing in the list: no row height, column width or position changes", async ({ page }) => {
  for (const touch of [false, true]) {
    const folder = new Folder();
    for (const n of ["coolant_flush", "spindle_warmup"]) {
      folder.files.set(n, { text: `o<${n}> sub\no<${n}> endsub\n`, meta: { title: n, units: null, frame: null, params: [] } });
    }
    await ready(page, folder, { macros: { macros: [], bar: ["face_top"] } });
    if (touch) await page.evaluate(() => document.documentElement.classList.add("touch-device"));
    await openTab(page);
    // positions inside the TABLE: the test's own tap may scroll the body
    const geometry = () => page.evaluate(() => ({
      rows: [...document.querySelectorAll<HTMLElement>("[data-macro-row]")].map(r => {
        const b = r.getBoundingClientRect();
        const t = r.closest("table")!.getBoundingClientRect();
        return `${r.dataset.macroRow} y${Math.round(b.y - t.y)} h${Math.round(b.height)}`;
      }),
      cols: [...document.querySelectorAll<HTMLElement>(".macroTable th")].map(t => Math.round(t.getBoundingClientRect().width)),
    }));
    const before = await geometry();
    await page.locator('[data-macro-row="spindle_warmup"]').getByRole("checkbox").check({ force: true });
    await expect(page.locator(".macroBar").getByRole("button", { name: "spindle_warmup", exact: true })).toBeVisible();
    await page.waitForTimeout(200);
    expect(await geometry(), `${touch ? "touch" : "desktop"}: switching On bar moves nothing`).toEqual(before);
    // the arrows reorder the BAR; the list stays
    await page.locator('[data-macro-row="spindle_warmup"]').getByRole("button", { name: "Move spindle_warmup up in the bar order" }).click();
    await expect(page.locator(".macroBar [data-macro-id]").first()).toHaveAttribute("data-macro-id", "file:spindle_warmup");
    await page.waitForTimeout(200);
    expect(await geometry(), `${touch ? "touch" : "desktop"}: reordering the bar moves nothing in the list`).toEqual(before);
    // a macro off the bar offers no order buttons to Tab or a pointer
    await expect(page.locator('[data-macro-row="park"]').getByRole("button", { name: "Move park up in the bar order" })).toBeHidden();
  }
});

// Operator 2026-10-02 (live): the macro bar takes little room — a DENSE area,
// its buttons the compact control height (28 px desktop, 36 px touch, like
// the strip and the tables) — and has its own Abort at the right end.
test("the macro bar is dense: compact buttons, and an Abort at its right end that sends exactly abort", async ({ page }) => {
  for (const touch of [false, true]) {
    await ready(page, new Folder(), { macros: { macros: [], bar: ["park", "face_top"] } });
    if (touch) await page.evaluate(() => document.documentElement.classList.add("touch-device"));
    const bar = page.locator(".macroBar");
    const want = touch ? 36 : 28;
    for (const name of ["Park", "Face top", "Abort"]) {
      const h = (await bar.getByRole("button", { name, exact: true }).boundingBox())!.height;
      expect(Math.round(h), `${touch ? "touch" : "desktop"}: ${name} is ${want} px`).toBe(want);
    }
    await ctl({ op: "status_delta", data: { permissions: { abort: true, armed: true, always: true, probe: true } } });
    await ctl({ op: "clearCmds" });
    await bar.getByRole("button", { name: "Abort", exact: true }).click();
    await expect.poll(async () => (await sent()).map(c => c.cmd).filter(c => c === "abort")).toEqual(["abort"]);
  }
});

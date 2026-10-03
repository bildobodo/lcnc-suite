// Package 5, stage C (plan docs/reviews/makros.plan.md): the Macros tab and
// macro FILES on the bar, against the in-memory folder of macroFolder.ts.
import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";
import { Folder, serve, rev, PARK, FACE } from "./macroFolder";
import { clickMore, moreItem, moreTrigger } from "./more";
import { readFileSync } from "node:fs";

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

// The editor is a DIALOG like Edit Tool (operator 2026-10-03), opened by the
// row's pencil.
const row = (page: Page, name: string) => page.locator(`[data-macro-row="${name}"]`);
async function openEditor(page: Page, name: string) {
  await row(page, name).getByRole("button", { name: `Edit ${name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Edit Macro ${name}`, exact: true });
  await expect(dialog.locator(".macroCode .cm-content")).toBeVisible();
  return dialog;
}

test("an unsaved draft blocks the run of THAT macro on the bar and in the tab; Save restores it at the new revision", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [], bar: ["park", "face_top"] } });
  await openTab(page);
  const barPark = page.locator(".macroBar").getByRole("button", { name: "Park", exact: true });
  await expect(barPark).toBeEnabled();
  const dialog = await openEditor(page, "park");
  await dialog.locator(".macroCode .cm-content").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" ");
  await expect(barPark, "the edited macro is dimmed on the bar").toBeDisabled();
  await expect(page.locator(".macroBar").getByRole("button", { name: "Face top", exact: true }), "another macro is not").toBeEnabled();
  await expect(page.locator(".macrosTab .panelHead").getByRole("button", { name: "Run", exact: true }), "the pencil selected it: Run waits too").toBeDisabled();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
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
  const dialog = await openEditor(page, "park");
  await dialog.locator(".macroCode .cm-content").click();
  await page.keyboard.type("(mine)");
  folder.touch("park", PARK.replace("G90", "G90 (theirs)"));
  await ctl({ op: "raw", frame: { type: "macros_changed", version: 2 } });
  await expect(dialog.locator("[data-macro-conflict]")).toBeVisible();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.locator("[data-macro-conflict]")).toBeVisible();
  expect(folder.files.get("park")!.text, "their save survives").toContain("(theirs)");
  await dialog.locator("[data-macro-conflict]").getByRole("button", { name: "Reload" }).click();
  await expect(dialog.locator(".macroCode .cm-content")).toContainText("(theirs)");
});

test("closing the editor over a draft asks first, by Cancel and by X: Keep editing stays, Discard closes; nothing saved", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [] } });
  await openTab(page);
  // an untouched editor closes at once
  let dialog = await openEditor(page, "park");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  dialog = await openEditor(page, "park");
  await dialog.locator(".macroCode .cm-content").click();
  await page.keyboard.type("x");
  const ask = page.getByRole("dialog", { name: "Discard changes?" });
  for (const close of ["Cancel", "Close macro editor"]) {
    await dialog.getByRole("button", { name: close, exact: true }).click();
    await expect(ask, `${close} asks`).toBeVisible();
    await ask.getByRole("button", { name: "Keep editing" }).click();
    await expect(ask).toHaveCount(0);
    await expect(dialog.locator(".macroCode .cm-content"), `${close}: Keep editing keeps the draft`).toContainText("x");
  }
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await ask.getByRole("button", { name: "Discard" }).click();
  await expect(dialog).toHaveCount(0);
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

test("a late read never shows the earlier macro's text: editor closed, another opened", async ({ page }) => {
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
  await row(page, "park").getByRole("button", { name: "Edit park", exact: true }).click();
  const parkDialog = page.getByRole("dialog", { name: "Edit Macro park", exact: true });
  await expect(parkDialog.locator(".emptyState.loading")).toBeVisible();
  await parkDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(parkDialog).toHaveCount(0);
  const dialog = await openEditor(page, "face_top");
  const code = dialog.locator(".macroCode .cm-content");
  await expect(code).toContainText("o<face_top> sub");
  release();
  await page.waitForTimeout(400);
  await expect(code, "the late park reply changed nothing").toContainText("o<face_top> sub");
  await expect(code).not.toContainText("o<park>");
  await expect(dialog.getByRole("textbox", { name: "File name", exact: true })).toHaveValue("face_top");
});

// The tab never runs out sideways — desktop, touch portrait 100 % and 150 %
// (narrow, 272 px of content): the table with the longest example names,
// every file on the bar (the order buttons show); then the editor dialog.
// Only the code itself may scroll sideways (.cm-scroller).
test("the Macros tab and its editor never run out sideways: desktop, portrait 100 % and 150 %", async ({ page }) => {
  for (const vp of [{ w: 1600, h: 1000, touch: false, zoom: 1 }, { w: 900, h: 1200, touch: true, zoom: 1 },
                    { w: 900, h: 1200, touch: true, zoom: 1.5 }]) {
    const folder = new Folder();
    for (const n of ["go_to_g30_macro", "spindle_warmup", "coolant_flush"]) {
      folder.files.set(n, { text: `(MACRO ${n})\n(a description long enough to need more than one line of the table, cut to one)\no<${n}> sub\no<${n}> endsub\n`,
        meta: { title: n, units: null, frame: null, params: [] } });
    }
    await ready(page, folder, { macros: { macros: [], bar: ["park", "face_top", "go_to_g30_macro", "spindle_warmup", "coolant_flush"] } });
    await page.setViewportSize({ width: vp.w, height: vp.h });
    if (vp.touch) await page.evaluate(() => document.documentElement.classList.add("touch-device"));
    if (vp.zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, vp.zoom);
    const select = page.getByRole("combobox", { name: "Side panel" });
    if (await select.isVisible()) await select.selectOption({ label: "Macros" });
    else await page.getByRole("tab", { name: "Macros", exact: true }).click();
    await expect(page.locator(".macrosTab")).toBeVisible();
    await page.waitForTimeout(300);
    const sideways = (sel: string) => page.evaluate(s => [...document.querySelectorAll(`${s}, ${s} *`)]
      .filter(e => !(e as HTMLElement).closest(".cm-scroller"))
      // a one-line description cut with an ellipsis is cut on purpose; a
      // field scrolls its own long text
      .filter(e => getComputedStyle(e).textOverflow !== "ellipsis" && !["INPUT", "TEXTAREA"].includes(e.tagName))
      .filter(e => getComputedStyle(e).overflowX !== "visible" && e.scrollWidth > e.clientWidth + 1)
      .map(e => `${(e as HTMLElement).className} ${e.scrollWidth} > ${e.clientWidth}`), sel);
    const where = `${vp.w}×${vp.h} ${vp.zoom * 100} %`;
    expect(await sideways(".macrosTab"), `${where}: the tab`).toEqual([]);
    const dialog = await openEditor(page, "go_to_g30_macro");
    await page.waitForTimeout(300);
    expect(await sideways('[role="dialog"]'), `${where}: the editor`).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  }
});

// Plan, dialog case 20: after a delete the focus goes to the next row's
// name, else the previous, else the tab's head (More) — never to the gone
// trash: Chromium then drops the focus to body, where an arrow key jogs.
test("after a delete the focus goes to the next row, else the previous, else More — never to body", async ({ page }) => {
  const folder = new Folder();
  folder.files.set("coolant_flush", { text: "(MACRO Coolant flush)\no<coolant_flush> sub\no<coolant_flush> endsub\n",
    meta: { title: "Coolant flush", units: null, frame: null, params: [] } });
  await ready(page, folder, { macros: { macros: [] } });
  await openTab(page);
  const active = () => page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null;
    return !a || a === document.body ? "BODY" : (a.getAttribute("aria-label") ?? a.textContent?.trim() ?? a.tagName);
  });
  const remove = async (name: string, title: string) => {
    await row(page, name).getByRole("button", { name: `Delete ${name}`, exact: true }).click();
    await page.getByRole("dialog", { name: `Delete ${title}?` }).getByRole("button", { name: "Delete", exact: true }).click();
    await expect(row(page, name)).toHaveCount(0);
    await page.waitForTimeout(300);
  };
  // rows by name: coolant_flush, face_top, park
  await remove("coolant_flush", "Coolant flush");
  expect(await active(), "the next row").toBe("Face top");
  await remove("park", "Park");
  expect(await active(), "the previous row (park was last)").toBe("Face top");
  await remove("face_top", "Face top");
  expect(await active(), "no row left: the head's More").toBe("More macro actions");
});

// Operator 2026-10-03: the editor is a dialog like Edit Tool — the file
// name, the title and the short description as FIELDS over the code. The
// fields ARE the file's header lines (macroHeader.ts): a field writes its
// line, an edit of the line reads back into the field; the file name is
// the subroutine's label, and a Save under a new name renames the file
// and keeps its place on the bar.
test("the editor dialog: name, title and description are the header lines; a rename moves the file and its place on the bar", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [], bar: ["park", "face_top"] } });
  await openTab(page);
  const dialog = await openEditor(page, "face_top");
  const code = dialog.locator(".macroCode .cm-content");
  const name = dialog.getByRole("textbox", { name: "File name", exact: true });
  const title = dialog.getByRole("textbox", { name: "Title (on the bar)", exact: true });
  const desc = dialog.getByRole("textbox", { name: "Description", exact: true });
  await expect(name).toHaveValue("face_top");
  await expect(title).toHaveValue("Face top");
  await expect(desc).toHaveValue("");
  // a field writes its line
  await title.fill("Face the top");
  await expect(code).toContainText("(MACRO Face the top)");
  await desc.fill("Faces the stock top");
  await expect(code).toContainText("(Faces the stock top)");
  await desc.fill("CNC face pass (one)");
  await expect(code, "a description that would read as a header word goes in a ; comment").toContainText("; CNC face pass (one)");
  // an edit of the line reads back into the field
  await code.locator(".cm-line").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  await page.keyboard.type("(MACRO Typed in the code)");
  await expect(title).toHaveValue("Typed in the code");
  // a title the MACRO line cannot hold is named, and Save waits
  await title.fill("Face (top)");
  await expect(dialog.getByText("No parentheses in a title")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await title.fill("Face flat");
  // the file name is the subroutine's label
  await name.fill("Face");
  await expect(dialog.getByText("Lower-case letters, digits and _ only")).toBeVisible();
  await name.fill("park");
  await expect(dialog.getByText("A macro of that name exists")).toBeVisible();
  await name.fill("face_flat");
  await expect(code).toContainText("o<face_flat> sub");
  await expect(code).toContainText("o<face_flat> endsub");
  await expect(code).not.toContainText("o<face_top>");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect([...folder.files.keys()].sort(), "renamed: the old name is gone").toEqual(["face_flat", "park"]);
  const text = folder.files.get("face_flat")!.text;
  expect(text).toContain("(MACRO Face flat)");
  expect(text).toContain("; CNC face pass (one)");
  await expect(page.locator(".macrosTab .statusNote.ok")).toContainText("Renamed face_top.ngc to face_flat.ngc");
  await expect(page.locator(".macroBar [data-macro-id]"), "its place on the bar kept").toHaveText(["Park", "Face flat"]);
  await expect(page.locator(".macrosTab .macroObject"), "the renamed macro is selected").toHaveText("Face flat");
  await expect(row(page, "face_flat")).toHaveAttribute("class", /selectedRow/);
});

test("New: the name writes the subroutine's label, the title follows it until typed; Create makes the file", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [] } });
  await openTab(page);
  await clickMore(page.locator(".macrosTab .panelHead"), "New");
  const dialog = page.getByRole("dialog", { name: "New Macro", exact: true });
  const code = dialog.locator(".macroCode .cm-content");
  const name = dialog.getByRole("textbox", { name: "File name", exact: true });
  const title = dialog.getByRole("textbox", { name: "Title (on the bar)", exact: true });
  await expect(name).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Create", exact: true }), "a name first").toBeDisabled();
  await name.fill("drill_cycle");
  await expect(code).toContainText("o<drill_cycle> sub");
  await expect(title).toHaveValue("Drill cycle");
  await name.fill("drill_peck");
  await expect(title, "untyped, the title follows the name").toHaveValue("Drill peck");
  await title.fill("Peck drill");
  await name.fill("drill_peck2");
  await expect(title, "typed, it stays").toHaveValue("Peck drill");
  await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("Pecks a hole");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const text = folder.files.get("drill_peck2")!.text;
  expect(text).toContain("(MACRO Peck drill)");
  expect(text).toContain("(Pecks a hole)");
  expect(text).toContain("o<drill_peck2> sub");
  expect(text).toContain("o<drill_peck2> endsub");
  await expect(row(page, "drill_peck2").locator(".colDesc")).toHaveText("Pecks a hole");
});

test("search, the bar filter and the sort narrow and order the rows", async ({ page }) => {
  const folder = new Folder();
  folder.files.set("coolant_flush", { text: "(MACRO Coolant flush)\n(turns flood coolant on for a while)\no<coolant_flush> sub\no<coolant_flush> endsub\n",
    meta: { units: null, frame: null, params: [] } });
  await ready(page, folder, { macros: { macros: [], bar: ["park"] } });
  await openTab(page);
  const names = () => page.locator("[data-macro-row]").evaluateAll(rs => rs.map(r => (r as HTMLElement).dataset.macroRow));
  expect(await names()).toEqual(["coolant_flush", "face_top", "park"]);
  await page.locator(".macrosTab th").getByRole("button", { name: /^Macro/ }).click();
  expect(await names(), "the sort reversed").toEqual(["park", "face_top", "coolant_flush"]);
  await expect(page.locator(".macrosTab th.colName")).toHaveAttribute("aria-sort", "descending");
  const search = page.getByRole("textbox", { name: "Search macros", exact: true });
  await search.fill("flood");
  expect(await names(), "the description is searched").toEqual(["coolant_flush"]);
  await search.fill("face");
  expect(await names(), "the title and the name are searched").toEqual(["face_top"]);
  await search.fill("nothing like it");
  await expect(page.locator(".macrosTab .emptyState.noMatch")).toHaveText("No macros match the search.");
  await search.fill("");
  const filter = page.getByRole("combobox", { name: "Filter by the bar", exact: true });
  await filter.selectOption({ label: "On the bar" });
  expect(await names()).toEqual(["park"]);
  await filter.selectOption({ label: "Not on the bar" });
  expect(await names()).toEqual(["face_top", "coolant_flush"]);
});

// A tap on a row selects the macro for Run (no button in the row, operator
// 2026-10-03); the keyboard's way is the name — ONE Tab stop, Enter / Space
// and the arrows select. With keyboard jog ON an arrow that reached the
// shortcut map would jog: the bare page proves it does, the name proves it
// never does — with a modifier neither.
test("a tap on a row selects it for Run; its name is one Tab stop whose keys select and never jog", async ({ page }) => {
  const folder = new Folder();
  folder.files.set("coolant_flush", { text: "(MACRO Coolant flush)\no<coolant_flush> sub\no<coolant_flush> endsub\n",
    meta: { units: null, frame: null, params: [] } });
  await ready(page, folder, { macros: { macros: [] } });
  await openTab(page);
  const head = page.locator(".macrosTab .panelHead");
  const object = page.locator(".macrosTab .macroObject");
  await expect(object).toHaveText("None selected");
  await expect(head.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await row(page, "face_top").locator(".colDesc").click();
  await expect(object).toHaveText("Face top");
  await expect(row(page, "face_top").getByRole("radio")).toHaveAttribute("aria-checked", "true");
  // the row's switches select nothing
  await row(page, "park").getByRole("checkbox").check({ force: true });
  await expect(object, "On bar is no selection").toHaveText("Face top");
  // one Tab stop: the selected row's name
  await expect(page.locator(".macrosTab .rowPick[tabindex='0']")).toHaveCount(1);
  await expect(page.locator(".macrosTab .rowPick[tabindex='0']")).toHaveText("Face top");

  await ctl({ op: "status_delta", data: { homed: [1, 1, 1], permissions: { jog: true, ready: true, idle: true, probe: true,
    setup: true, armed: true, always: true, abort: true, safety: true, override: true, zero: true } } });
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { macros: { macros: [], bar: ["park"] }, keyboard: { jogEnabled: true, buttonsEnabled: true,
    mapping: { "jog_x+": "ArrowRight", "jog_x-": "ArrowLeft", "jog_y+": "ArrowUp", "jog_y-": "ArrowDown", "jog_z+": "Home", "jog_z-": "End",
               estop: "Escape", cycle: " ", abort: "Backspace" } } } } });
  const jogs = async () => (await sent()).map(c => c.cmd ?? "").filter(c => c.startsWith("jog") || c === "cycle_start" || c === "auto_run");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await ctl({ op: "clearCmds" });
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(150);
  await page.keyboard.up("ArrowDown");
  await expect.poll(jogs, { message: "control: ArrowDown on the bare page jogs" }).toContain("jog_cont");
  await page.keyboard.down("ArrowDown");   // release any jog the control left
  await page.keyboard.up("ArrowDown");
  await page.locator(".macrosTab .rowPick[tabindex='0']").focus();
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("ArrowDown");
  await expect(object).toHaveText("Park");
  await expect(row(page, "park").getByRole("radio")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(object).toHaveText("Coolant flush");
  await page.keyboard.press("End");
  await expect(object).toHaveText("Park");
  await page.keyboard.press("ArrowUp");
  await expect(object).toHaveText("Face top");
  for (const key of ["Control+ArrowDown", "Alt+ArrowUp", "Shift+ArrowLeft", "Meta+ArrowRight", "ArrowLeft", "ArrowRight"]) {
    await page.keyboard.press(key);
  }
  await expect(object, "a modifier or a side arrow selects nothing").toHaveText("Face top");
  await row(page, "park").getByRole("radio").focus();
  await page.keyboard.press(" ");
  await expect(object, "Space selects").toHaveText("Park");
  await page.waitForTimeout(200);
  expect(await jogs(), "no key on a row's name jogs or starts").toEqual([]);
});

// Download (operator 2026-10-03): the selected macro, the loaded program and
// the tool table, each saved as the file it is.
test("Download saves the file as it is: the selected macro, the loaded program, the tool table", async ({ page }) => {
  const folder = new Folder();
  await ready(page, folder, { macros: { macros: [] } });
  const PROGRAM = "(a program)\nG0 X0 Y0\nM2\n";
  const TABLE = "T1 P1 Z12.5 D6 ;end mill\nT2 P2 Z-3 D10 ;drill\n";
  await page.route(/\/gcode\?path=/, r => r.fulfill({ body: PROGRAM, contentType: "text/plain", headers: { "X-Program-Source": rev(PROGRAM) } }));
  await page.route("**/tool-table", r => r.fulfill({ body: TABLE, contentType: "text/plain", headers: { "X-File-Name": "sim.tbl" } }));
  const saved = async (go: () => Promise<void>) => {
    const [download] = await Promise.all([page.waitForEvent("download"), go()]);
    return { name: download.suggestedFilename(), text: readFileSync((await download.path())!, "utf8") };
  };
  await openTab(page);
  const macros = page.locator(".macrosTab .panelHead");
  await expect(await moreItem(macros, "Download"), "nothing selected, nothing to download").toBeDisabled();
  await moreTrigger(macros).click();
  await row(page, "park").locator(".colDesc").click();
  expect(await saved(() => clickMore(macros, "Download"))).toEqual({ name: "park.ngc", text: PARK });

  await ctl({ op: "status_delta", data: { active_file: "/home/cnc/linuxcnc/nc_files/haus.ngc" } });
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  const program = page.getByRole("tabpanel", { name: "Program" });
  expect(await saved(() => clickMore(program, "Download"))).toEqual({ name: "haus.ngc", text: PROGRAM });

  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  const tools = page.getByRole("tabpanel", { name: "Tools" });
  expect(await saved(() => clickMore(tools, "Download"))).toEqual({ name: "sim.tbl", text: TABLE });
});

// Operator 2026-10-02 (live): ONE action row — Run and Abort side by side on
// the left, the management (New, Upload, Download) behind More at the
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
    for (const n of ["New", "Upload", "Download"]) {
      await expect(head.getByRole("button", { name: n, exact: true }), `${where}: ${n} folded`).toBeHidden();
    }
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    const panel = page.locator(`[id="${await more.getAttribute("aria-controls")}"]`);
    for (const n of ["New", "Upload", "Download"]) await expect(panel.getByRole("button", { name: n, exact: true })).toBeVisible();
    const pb = (await panel.boundingBox())!, mb = (await more.boundingBox())!;
    expect(Math.abs(pb.x + pb.width - (mb.x + mb.width)), `${where}: the panel's end on More's`).toBeLessThanOrEqual(1.5);
    expect(pb.y, `${where}: under More`).toBeGreaterThanOrEqual(mb.y + mb.height - 1);
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "false");
  }

  // keys: Enter opens, the first item takes the focus, the arrows move and never jog
  // (a macro selected: Download is enabled too). Keyboard jog ON,
  // the arrows bound to jog (tabs.spec's setting): an arrow that reached the
  // shortcut map WOULD jog — the control on the bare page proves it does.
  await page.locator('[data-macro-row="park"] .rowPick').click();   // narrow: no description column
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
  await expect(panel.getByRole("button", { name: "Download", exact: true })).toBeFocused();
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
      cols: [...document.querySelectorAll<HTMLElement>(".macrosTab th")].map(t => Math.round(t.getBoundingClientRect().width)),
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

test("More keeps ONE width: opened, and with the run options switched — Program, Tools, Macros", async ({ page }) => {
  // Operator 2026-10-03: "if I click More in Program the button length
  // changes, as More changes its text". Two causes: the named options left
  // the label when the panel opened, and an open More is selected =
  // semibold, wider in every tab. The trigger reserves its widest label.
  await ready(page, new Folder(), { macros: { macros: [] } });
  const width = async (t: ReturnType<Page["locator"]>) => (await t.boundingBox())!.width;
  const same = (a: number, b: number, what: string) => expect(Math.abs(a - b), `${what}: ${a} vs ${b}`).toBeLessThan(0.05);

  const program = page.getByRole("tabpanel", { name: "Program" });
  const pMore = moreTrigger(program);
  const label = pMore.locator(".moreLabel > :first-child");   // the shown label (the reserve beside it is hidden)
  await ctl({ op: "status_delta", data: { optional_stop: true, block_delete: false } });
  await expect(label).toHaveText("More · M01");
  const w0 = await width(pMore);
  await pMore.click();
  await expect(pMore).toHaveAttribute("aria-expanded", "true");
  await expect(label, "the option on stays named while open").toHaveText("More · M01");
  same(await width(pMore), w0, "Program opened");
  for (const [optional_stop, block_delete, text] of [[false, true, "/BD"], [true, true, "M01 /BD"], [false, false, null]] as const) {
    await ctl({ op: "status_delta", data: { optional_stop, block_delete } });
    await expect(label).toHaveText(text ? `More · ${text}` : "More");
    same(await width(pMore), w0, `Program open, ${text ?? "no option"}`);
  }
  await pMore.click();
  await expect(pMore).toHaveAttribute("aria-expanded", "false");
  same(await width(pMore), w0, "Program closed, no option");

  for (const name of ["Tools", "Macros"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    const more = moreTrigger(page.getByRole("tabpanel", { name }));
    await expect(more).toBeVisible();
    const w = await width(more);
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    same(await width(more), w, `${name} opened`);
    await more.click();
  }
});

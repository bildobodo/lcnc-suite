// Package 5, stage C (plan docs/reviews/makros.plan.md): the Macros tab and
// macro FILES on the bar. The gateway's macro routes are served from an
// in-memory folder here (page.route): saves, imports and deletes change it
// for real, with sha256 revisions and the gateway's 409 contracts, so a
// revision a client saw and a conflict behave as in the product.
import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { ctl, MOCK } from "./ctl";

const rev = (t: string) => createHash("sha256").update(t).digest("hex");
const HOLD_MS = 700;

const PARK = "(MACRO Park)\n(FRAME machine)\no<park> sub\n  M73\n  G90\n  G53 G0 Z0\no<park> endsub\n";
const FACE = `(MACRO Face top)
(UNITS mm)
(PARAM 1 depth "Depth" length 0.5 min=0 max=5)
(PARAM 2 feed "Feed" feed 600 min=1)
o<face_top> sub
  M73
  G21 G90 G94
  G1 Z[-#1] F#2
o<face_top> endsub
`;

interface Entry { text: string; meta: Record<string, unknown> }

/** The gateway's macro folder, in memory. */
class Folder {
  files = new Map<string, Entry>();
  problems: string[] = [];
  /** The gateway's verdict "may not run", by name (a header error, shadowed). */
  blocked = new Map<string, string>();
  constructor() {
    this.files.set("park", { text: PARK, meta: { title: "Park", units: null, frame: "machine", params: [] } });
    this.files.set("face_top", { text: FACE, meta: { title: "Face top", units: "mm", frame: null, params: [
      { n: 1, key: "depth", label: "Depth", unit: "length", default: 0.5, min: 0, max: 5, integer: false },
      { n: 2, key: "feed", label: "Feed", unit: "feed", default: 600, min: 1, max: null, integer: false }] } });
  }
  entry(name: string) {
    const e = this.files.get(name)!;
    return { name, description: [], errors: [], warnings: [], mtime: 0, runnable: !this.blocked.has(name),
             reason: this.blocked.get(name) ?? null, revision: rev(e.text), ...e.meta };
  }
  list() {
    return { ok: true, dir: "/home/cnc/linuxcnc/macros", problems: this.problems,
             macros: [...this.files.keys()].sort().map(n => this.entry(n)) };
  }
  /** Another client (or an editor outside the suite) changes a file. */
  touch(name: string, text: string) { this.files.get(name)!.text = text; }
}

async function serve(page: Page, folder: Folder) {
  await page.route("**/macros", r => r.fulfill({ json: folder.list() }));
  await page.route(/\/macro\?/, async r => {
    const url = new URL(r.request().url());
    const name = url.searchParams.get("name")!;
    const method = r.request().method();
    const e = folder.files.get(name);
    if (method === "GET") {
      if (!e) return r.fulfill({ status: 404, json: { detail: "Macro not found" } });
      return r.fulfill({ body: e.text, contentType: "text/plain", headers: { "X-Macro-Revision": rev(e.text) } });
    }
    const base = url.searchParams.get("base")!;
    if (method === "PUT") {
      const text = r.request().postData() ?? "";
      if (base === "new" ? !!e : !e || rev(e.text) !== base) {
        return r.fulfill({ status: 409, json: { detail: { error: "refused",
          reason: base === "new" ? "A macro of that name exists — reload" : "Changed on disk — reload or keep editing",
          revision: e ? rev(e.text) : null } } });
      }
      if (e) e.text = text;
      else folder.files.set(name, { text, meta: { title: name, units: null, frame: null, params: [] } });
      return r.fulfill({ json: { ok: true, macro: folder.entry(name) } });
    }
    if (method === "DELETE") {
      if (!e || rev(e.text) !== base) return r.fulfill({ status: 409, json: { detail: { error: "refused", reason: "Changed on disk", revision: e ? rev(e.text) : null } } });
      folder.files.delete(name);
      return r.fulfill({ json: { ok: true } });
    }
    return r.fallback();
  });
}

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

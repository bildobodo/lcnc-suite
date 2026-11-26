// The Tools tab on the one tool table reader (P6-c bell 1, plan v8 §1.1, §1.5,
// §1.8, Codex R477/R480/R482): one read a ping for the whole page, the library
// named by its revision, a `same` reply completed or replaced, a shape above
// the bounds named — and nothing of it drawn as something else.
import { test, expect, type Page } from "./test";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

const row = (T: number, over: object = {}) => ({ T, P: T, D: 6, Z: 40 + T, remark: `remark ${T}`, type: "endmill", description: `Tool ${T}`, flute_length: 20,
  oal: 60, shaft_diameter: 6, ...over });
const PROFILE = [[0, 0], [3, 0], [3, 40], [0, 40]];
const TOOLS = [row(1), row(2, { type: "formmill", native_profile: PROFILE, source_format: "freecad" }),
  row(3, { native_profile: Array.from({ length: 4096 }, (_, i) => [1, i / 100]) }),
  row(4, { body_length: 30, holder_segments: Array.from({ length: 65 }, () => ({ height: 1, lower_diameter: 20, upper_diameter: 20 })) }),
  row(5, { shaft_diameter: 1e39 })];
const TABLE = { path: "/cfg/tool.tbl", instance: "11:1" };
const serve = (over: object = {}) => ctl({ op: "replyFor", cmd: "get_tool_table", reply: { ok: true, tools: TOOLS, table: TABLE, library: { rev: "L1" }, unread: [], ...over } });
let version = 4000;
const ping = () => ctl({ op: "raw", frame: { type: "tool_table_changed", version: ++version } });
const reads = async () => ((await ctl({ op: "lastCmds" })).cmds as Array<{ cmd: string; req_id?: string; have_library?: string }>)
  .filter(c => c.cmd === "get_tool_table" && c.req_id).map(c => c.have_library ?? null);
async function open(page: Page) {
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await serve();
  await ctl({ op: "clearCmds" });
  await ping();
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(page.locator(".toolsTab tbody tr")).toHaveCount(5);
}
const tr = (page: Page, T: number) => page.locator(".toolsTab tbody tr", { has: page.getByRole("button", { name: `Edit T${T}`, exact: true }) });

test("one read a ping for the tab and the strip; the next one names the library, and a same keeps its shapes", async ({ page }) => {
  await open(page);
  await expect.poll(async () => (await reads()).length).toBe(1);
  // the ping's one read: it may name the library of the page's first read (the empty
  // table's), never L1 — the page holds none of it yet
  expect((await reads())[0]).not.toBe("L1");
  // the library changed nothing, the table did: T2's remark is this reply's own
  await ctl({ op: "clearCmds" });
  await serve({ tools: TOOLS.map(t => (t.T === 2 ? { ...t, description: "Tool 2, resharpened" } : t)) });
  await ping();
  await expect(tr(page, 2)).toContainText("Tool 2, resharpened");
  await expect.poll(reads).toEqual(["L1"]);
  await expect(tr(page, 2), "its form is the one the page holds").toContainText("Imported geometry");
  await expect(tr(page, 3)).toContainText("Shape too detailed to draw");
  await page.waitForTimeout(300);
  expect(await reads(), "a refused shape is no reason to read again").toEqual(["L1"]);
});

test("a same the page cannot complete is replaced by one full read; nothing of it shows", async ({ page }) => {
  await open(page);
  await expect.poll(async () => (await reads()).length).toBe(1);
  // the ping's one read: it may name the library of the page's first read (the empty
  // table's), never L1 — the page holds none of it yet
  expect((await reads())[0]).not.toBe("L1");
  await ctl({ op: "clearCmds" });
  // another LinuxCNC answers with the same revision: its rows without their forms
  const bare = TOOLS.map(t => ({ ...row(t.T), description: "never shown" }));
  await serve({ table: { ...TABLE, instance: "12:9" }, tools: bare, rev: { table: "x", library: "L1" }, library: { state: "same", rev: "L1" } });
  await ping();
  await expect.poll(reads).toEqual(["L1", null]);
  // asked in full, it still says same: a failed read, said — never an empty library
  await expect(page.locator(".toolsTab").getByRole("alert")).toContainText("Tool table without its shapes — retry");
  await expect(page.locator(".toolsTab")).not.toContainText("never shown");
  await serve({ table: { ...TABLE, instance: "12:9" } });
  await page.locator(".toolsTab").getByRole("button", { name: "Retry" }).click();
  await expect(tr(page, 2)).toContainText("Imported geometry");
});

test("a shape above the bounds says so in the row and the editor, its fields stay; a holder is refused on its own", async ({ page }) => {
  await open(page);
  await expect(tr(page, 3)).toContainText("Shape too detailed to draw");
  await expect(tr(page, 4)).toContainText("Holder too detailed to draw");
  await expect(tr(page, 1)).not.toContainText("to draw");
  await tr(page, 3).getByRole("button", { name: "Edit T3", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Tool T3" });
  await expect(editor.getByRole("alert")).toContainText("Shape too detailed to draw");
  await expect(editor).not.toContainText("no library shape");
  // a save writes what was read: the fields of the row, the refused shape is none of them
  await ctl({ op: "replyFor", cmd: "save_tool", reply: { ok: true } });
  await ctl({ op: "clearCmds" });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const save = ((await ctl({ op: "lastCmds" })).cmds as any[]).find(c => c.cmd === "save_tool");
  expect(save.expected.fields).toMatchObject({ type: "endmill", description: "Tool 3", flute_length: 20, oal: 60, remark: "remark 3" });
  await ctl({ op: "replyFor", cmd: "save_tool", reply: null });
  // the holder's own note; the shape is drawn, the holder is not offered
  await tr(page, 4).getByRole("button", { name: "Edit T4", exact: true }).click();
  const four = page.getByRole("dialog", { name: "Edit Tool T4" });
  await expect(four.getByRole("alert")).toContainText("Holder too detailed to draw");
  await expect(four).not.toContainText("Shape too detailed");
  await expect(four.getByText("Nominal Fusion assembly")).toHaveCount(0);
});

test("a shape that cannot be drawn is said where it is drawn: the editor and the hover preview", async ({ page }) => {
  await open(page);
  const card = page.locator(".toolHoverPreview");
  await tr(page, 5).locator("td").first().hover();
  await expect(card).toContainText("Shape not usable");
  await tr(page, 1).locator("td").first().hover();
  await expect(card).toBeVisible();
  await expect(card).not.toContainText("Shape not usable");
  await page.mouse.move(5, 5);
  await expect(card).toHaveCount(0);
  await tr(page, 5).getByRole("button", { name: "Edit T5", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Tool T5" });
  await expect(editor.locator(".editNotice")).toHaveText("Shape not usable");
  // it follows the field: a diameter that can be drawn says nothing
  await editor.getByLabel("Shaft Ø", { exact: true }).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("8");
  await page.keyboard.press("Enter");
  await expect(editor.getByLabel("Shaft Ø", { exact: true })).toHaveValue("8");
  await expect(editor.locator(".editNotice")).toHaveCount(0);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await tr(page, 1).getByRole("button", { name: "Edit T1", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Edit Tool T1" }).locator(".editNotice")).toHaveCount(0);
});

test("a lost connection clears the rows and keeps an open dialog's shape; the reconnect asks by revision", async ({ page }) => {
  await open(page);
  await ctl({ op: "clearCmds" });
  await tr(page, 2).getByRole("button", { name: "Edit T2", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Tool T2" });
  await expect(editor.getByRole("alert")).toContainText("Geometry stays fixed");
  await ctl({ op: "shutdownClose" });
  await expect(page.locator(".toolsTab tbody tr").filter({ hasText: "Tool 1" })).toHaveCount(0);
  await expect(editor.getByRole("alert"), "the dialog's own record").toContainText("Geometry stays fixed");
  await expect.poll(reads, { timeout: 20_000 }).toContain("L1");
  await expect(page.locator(".toolsTab tbody")).toContainText("Tool 1");
});

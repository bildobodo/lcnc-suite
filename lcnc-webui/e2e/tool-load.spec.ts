// LinuxCNC asked to load the tool table file (TF-2, plan v3 §2, Codex
// R476–R479): where it is offered, the comparison the dialog shows, the ONE
// request bound to it, and what the tab says afterwards — a request and what
// the READ on screen shows, never that LinuxCNC loaded the file.
import { test, expect } from "./test";
import type { Locator, Page } from "./test";
import { ctl } from "./ctl";
import { sidewaysOverflow, thickScrollbars } from "./layout-audit";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { clickMore, moreItem, moreTrigger } from "./more";

type Reply = Record<string, unknown>;
const TOOL = { T: 5, P: 5, D: 6, Z: -40, type: "endmill", description: "Five mill" };
const TABLE = { path: "/cfg/tool.tbl", instance: "111:1" };
const OWNER = { ini: "/cfg/m.ini", link: "e.1" };
const REV = "a".repeat(64);
const BASE = { ...TABLE, ...OWNER, rev: REV, memory: "b".repeat(64) };
const PROOF = { proven: [5], differs: [], missing: [], extra: [], duplicates: [], why: null };
const COMPLETE = { proof: { ...PROOF, state: "complete" }, edit_refusal: null };
const PARTIAL = { proof: { ...PROOF, state: "partial", proven: [], differs: [{ T: 5, fields: ["Z"] }], why: "file incomplete or differs from LinuxCNC" },
                  edit_refusal: "T5 differs from LinuxCNC — load the file or restart" };
const UNCHECKED = { proof: { ...PROOF, state: "unchecked", proven: [], why: "random tool changer" }, edit_refusal: null };
const READ = { ok: true, tools: [TOOL], table: TABLE, owner: OWNER, rev: { table: REV, library: "l" }, unread: [], load_refusal: null, ...PARTIAL };
const one = (T: number, Z = -40, D = 6) => ({ T, name: `Tool ${T}`, Z, D });
const PREVIEW = { ok: true, refusal: null, base: BASE, basis: "partial", saved_at: 1_763_000_000, spindle: 0, removal_refusal: null,
                  removed: [] as object[], changed: [{ T: 5, name: "Five mill", fields: [{ f: "Z", now: -40, file: -41.5 }] }], added: [] as object[] };
const REQUESTED = { ok: true, load: "requested", values: "shown", basis: "partial" };
const OK_NOTE = "Load requested. LinuxCNC now shows the file's tool values; pockets and remarks are not compared.";
const OK_BARE = "LinuxCNC now shows the file's tool values; pockets and remarks are not compared.";

const replyFor = (cmd: string, reply: Reply | "silent" | null) => ctl({ op: "replyFor", cmd, reply });
let version = 2000;
const serve = (over: Reply = {}) => replyFor("get_tool_table", { ...READ, ...over });
const reread = () => ctl({ op: "raw", frame: { type: "tool_table_changed", version: ++version } });
type Sent = Record<string, unknown> & { cmd?: string; req_id?: string };
const sent = async (cmd: string): Promise<Sent[]> => ((await ctl({ op: "lastCmds" })).cmds as Sent[]).filter(c => c.cmd === cmd);
const answer = (cmd: string, to: Sent, reply: Reply) => ctl({ op: "raw", frame: { type: "reply", cmd, req_id: to.req_id, ...reply } });

interface Tab { tab: Locator; read: Locator; write: Locator; result: Locator; error: Locator; dialog: Locator }
/** The Tools tab on a partial, loadable read; a press compares with PREVIEW. */
async function openTools(page: Page, over: Reply = {}, vp = 0): Promise<Tab> {
  await openLayout(page, PROFILES[0]!, VIEWPORTS[vp]!);
  await serve(over);
  await replyFor("tool_table_preview", PREVIEW);
  await reread();
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  const tab = page.locator(".toolsTab");
  await expect(tab.getByRole("button", { name: "Edit T5", exact: true })).toBeVisible();
  await ctl({ op: "clearCmds" });
  return { tab, read: tab.locator("[data-read-state]"), write: tab.locator("[data-write-state]"), result: tab.locator("[data-load-state]"),
           error: tab.locator("[data-load-error]"), dialog: page.getByRole("dialog", { name: "Load tool table into LinuxCNC?" }) };
}
/** The More panel closed again (it lies over the notes). */
async function closeMore(head: Locator): Promise<void> {
  const trigger = moreTrigger(head);
  if ((await trigger.getAttribute("aria-expanded")) === "true") await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}
const loadBtn = (scope: Locator) => scope.getByRole("button", { name: "Load table", exact: true });
/** The dialog open on the comparison, by the read note's button. */
async function compare(t: Tab): Promise<Locator> {
  await loadBtn(t.read).click();
  await expect(t.dialog).toBeVisible();
  return t.dialog;
}
/** One request from the dialog, answered `reply`; the dialog closed. */
async function request(t: Tab, reply: Reply): Promise<void> {
  await replyFor("tool_table_load", reply);
  const d = await compare(t);
  await loadBtn(d).click();
  await expect(d).toHaveCount(0);
}
/** A write whose load into LinuxCNC failed, its note on screen. */
async function failedWrite(t: Tab, page: Page): Promise<void> {
  await replyFor("save_tool", { ok: true, reload: "reload failed" });
  await t.tab.getByRole("button", { name: "Edit T5", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Tool T5" });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
}

// ---- where ------------------------------------------------------------------------

test("offered where the file may be loaded: the partial read's note, the write note, More — closed with the reason", async ({ page }) => {
  const t = await openTools(page);
  const head = page.locator(".toolsHead");
  await expect(t.read).toHaveText("Edits refused: T5 differs from LinuxCNC — load the file or restart.Load tableRetry");
  const order = await t.read.getByRole("button").evaluateAll(bs => bs.map(b => [(b.textContent ?? "").trim(), b.getBoundingClientRect().left] as const));
  expect(order.map(o => o[0]), "left of Retry, in one group").toEqual(["Load table", "Retry"]);
  expect(order[0]![1]).toBeLessThan(order[1]![1]);
  await expect(await moreItem(head, "Load table")).toBeEnabled();
  await closeMore(head);

  // a file that may not be loaded: no button in the note, More closed with the gateway's words
  const why = "Line 12 too long for LinuxCNC — shorten it in an editor";
  await serve({ load_refusal: why, edit_refusal: why });
  await reread();
  await expect(t.read).toHaveText(`Edits refused: ${why}.Retry`);
  const closed = async (reason: string) => {
    const item = await moreItem(head, "Load table");
    await expect(item).toBeDisabled();
    await expect(item.locator("xpath=ancestor::span[contains(@class, 'btnTip')]")).toHaveAttribute("title", new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await closeMore(head);
  };
  await closed(why);
  // a gateway that does not judge it, and a read that failed
  await serve({ older_gateway: true });
  await reread();
  await expect(loadBtn(t.read)).toHaveCount(0);
  await closed("Gateway lacks this — restart it");
  await replyFor("get_tool_table", { ok: false, error: "Tool library not JSON — check tool_library.json" });
  await reread();
  await expect(t.tab.getByRole("alert").filter({ hasText: "Tool library not JSON" })).toBeVisible();
  await closed("Tool table not read — retry");
  // complete: no note, the way for a pocket or a remark stays
  await serve({ ...COMPLETE });
  await reread();
  await expect(t.read).toHaveCount(0);
  await expect(await moreItem(head, "Load table")).toBeEnabled();
});

test("a press compares once, the button says so and nothing moves; a refused comparison opens no dialog", async ({ page }) => {
  const t = await openTools(page);
  await replyFor("tool_table_preview", "silent");
  const boxes = () => t.tab.evaluate(el => [...el.querySelectorAll("[data-read-state], [data-read-state] button, .tableWrap, .toolSearchRow")]
    .map(e => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round).join(","); }));
  const before = await boxes();
  await loadBtn(t.read).click();
  await expect(loadBtn(t.read)).toBeDisabled();
  await expect(t.read.locator(".btnTip")).toHaveAttribute("title", /Comparing with LinuxCNC — wait/);
  await expect(await moreItem(page.locator(".toolsHead"), "Load table")).toBeDisabled();
  await closeMore(page.locator(".toolsHead"));
  expect(await boxes(), "nothing moves while it compares").toEqual(before);
  await expect(t.dialog, "the dialog opens complete").toHaveCount(0);
  const asked = await sent("tool_table_preview");
  expect(asked.length).toBe(1);
  await answer("tool_table_preview", asked[0]!, { ok: true, refusal: "T5 is in the spindle, not in the file — restore it", base: null });
  await expect(t.error).toHaveText("Not requested: T5 is in the spindle, not in the file — restore it.");
  await expect(t.dialog).toHaveCount(0);
  await expect(loadBtn(t.read)).toBeEnabled();
  expect((await sent("tool_table_load")).length).toBe(0);
  await t.error.getByRole("button", { name: "Dismiss load error" }).click();
  await expect(t.error).toHaveCount(0);
});

test("the focus stays at the button while it compares — never on the page, where Space is Cycle Start", async ({ page }) => {
  const t = await openTools(page);
  await replyFor("tool_table_preview", "silent");
  await loadBtn(t.read).focus();
  await page.keyboard.press("Enter");
  await expect(loadBtn(t.read)).toBeDisabled();
  const place = () => page.evaluate(() => document.activeElement?.closest("[data-read-state]") ? "note"
    : document.activeElement === document.body ? "page" : document.activeElement?.textContent?.trim() ?? "");
  expect(await place()).toBe("note");
  await page.keyboard.press("Space");
  expect((await sent("cycle_start")).length).toBe(0);
  const asked = await sent("tool_table_preview");
  await answer("tool_table_preview", asked[0]!, { ok: true, refusal: "No tools in the file — restore it", base: null });
  await expect(t.error).toBeVisible();
  await expect(loadBtn(t.read)).toBeFocused();
  // and the dialog's focus goes back to it
  await replyFor("tool_table_preview", PREVIEW);
  await page.keyboard.press("Enter");
  await expect(t.dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(t.dialog).toHaveCount(0);
  await expect(loadBtn(t.read)).toBeFocused();
});

// ---- the dialog --------------------------------------------------------------------

test("the dialog: counts, what is not compared, the list removed → changed → added, one request with exactly base and removed", async ({ page }) => {
  const t = await openTools(page);
  await replyFor("tool_table_preview", { ...PREVIEW, spindle: 5, removed: [one(8, -49.123), one(9)], added: [one(3, 1.5, 3)],
    changed: [{ T: 5, name: "Five mill", fields: [{ f: "Z", now: -49.123, file: -50 }, { f: "D", now: 6, file: 6.35 }] }] });
  const d = await compare(t);
  await expect(d.locator("[data-load-counts]")).toHaveText(/^tool\.tbl, saved \d\d:\d\d:\d\d: 2 removed, 1 changed, 1 added\.$/);
  await expect(d).toContainText("Pockets and remarks are not compared. The tool library stays as it is.");
  await expect(d).toContainText("LinuxCNC's values of these tools are replaced. This cannot be undone.");
  await expect(d.locator(".statusNote.warn")).toHaveText(["T5 is in the spindle — its offset in effect stays until the next G43."]);
  await expect(d.locator("thead th")).toHaveText(["Tool", "Change"]);
  await expect(d.locator("tbody tr")).toHaveText(["T8 Tool 8Removed · Z −49.123 · Ø 6", "T9 Tool 9Removed · Z −40 · Ø 6",
                                                  "T5 Five millZ −49.123 → −50 · Ø 6 → 6.35", "T3 Tool 3Added · Z 1.5 · Ø 3"]);
  await expect(d.locator(".dialogTitle")).toHaveClass(/danger/);
  const confirm = loadBtn(d);
  await expect(confirm).toHaveClass(/danger/);
  // the removed tools are acknowledged first
  await expect(confirm).toBeDisabled();
  await expect(d.locator(".dialogActions .btnTip")).toHaveAttribute("title", /Confirm the removed tools first/);
  await d.getByLabel("Remove 2 tools from LinuxCNC").check();
  await expect(confirm).toBeEnabled();
  await replyFor("tool_table_load", "silent");
  await confirm.click();
  await expect(d.getByRole("button", { name: "Requesting…", exact: true })).toBeDisabled();
  await expect(d.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await expect(d.locator(".dialogClose")).toHaveAttribute("title", "Request in progress");
  const asked = await sent("tool_table_load");
  expect(asked.length).toBe(1);
  const { cmd, req_id, ...payload } = asked[0]!;
  expect([cmd, typeof req_id]).toEqual(["tool_table_load", "string"]);
  expect(payload).toEqual({ base: BASE, removed: [8, 9] });
  // a ping while the request is out is no staleness: its reply says it
  await reread();
  await expect(d.locator("[data-load-check]")).toHaveCount(0);
  await answer("tool_table_load", asked[0]!, REQUESTED);
  await expect(d).toHaveCount(0);
});

test("only added tools: no danger, no switch; a complete basis says what cannot be shown", async ({ page }) => {
  const t = await openTools(page);
  await replyFor("tool_table_preview", { ...PREVIEW, changed: [], added: [one(3)] });
  let d = await compare(t);
  await expect(d.locator(".dialogTitle")).not.toHaveClass(/danger/);
  await expect(loadBtn(d)).not.toHaveClass(/danger/);
  await expect(loadBtn(d)).toBeEnabled();
  await expect(d.locator("input[type=checkbox]")).toHaveCount(0);
  await expect(d).not.toContainText("cannot be undone");
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await serve({ ...COMPLETE });
  await reread();
  await replyFor("tool_table_preview", { ...PREVIEW, basis: "complete", changed: [] });
  await clickMore(page.locator(".toolsHead"), "Load table");
  d = t.dialog;
  await expect(d.locator("[data-load-counts]")).toHaveText(/: same tools and values as LinuxCNC\.$/);
  await expect(d.locator(".statusNote.warn")).toHaveText(["LinuxCNC shows no pockets or remarks — whether it takes them cannot be shown."]);
  await expect(d.locator("table")).toHaveCount(0);
  await expect(loadBtn(d)).toBeEnabled();
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(moreTrigger(page.locator(".toolsHead"))).toBeFocused();
});

test("1000 removed and 1000 added: the counts name all, the rows come in portions", async ({ page }) => {
  const t = await openTools(page);
  await replyFor("tool_table_preview", { ...PREVIEW, changed: [], removed: Array.from({ length: 1000 }, (_v, i) => one(i + 1)),
    added: Array.from({ length: 1000 }, (_v, i) => one(i + 2001)) });
  const d = await compare(t);
  await expect(d.locator("[data-load-counts]")).toContainText("1000 removed, 1000 added.");
  const rows = d.locator("tbody tr:not(:has(.emptyState))");
  await expect(rows).toHaveCount(200);
  await expect(d.locator("tbody .emptyState")).toHaveText("1800 more");
  for (let n = 400; n <= 2000; n += 200) {
    await d.locator("[data-tool-load]").evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(() => rows.count(), `portion ${n}`).toBeGreaterThanOrEqual(n);
  }
  await expect(rows).toHaveCount(2000);
  await expect(d.locator("tbody .emptyState")).toHaveCount(0);
  await expect(rows.last()).toContainText("T3000");
});

test("stale by a ping: the confirm closes, the acknowledgement is gone, the list stays until Check again", async ({ page }) => {
  const t = await openTools(page);
  // nothing to acknowledge: staleness ALONE closes the confirm (connected, armed)
  const plain = await compare(t);
  await expect(loadBtn(plain)).toBeEnabled();
  await reread();
  await expect(loadBtn(plain)).toBeDisabled();
  await expect(plain.locator(".dialogActions .btnTip")).toHaveAttribute("title", /Compared with LinuxCNC before — check again/);
  await plain.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(plain).toHaveCount(0);
  await replyFor("tool_table_preview", { ...PREVIEW, removed: [one(8)] });
  const d = await compare(t);
  const tick = d.getByLabel("Remove 1 tool from LinuxCNC");
  await tick.check();
  await expect(loadBtn(d)).toBeEnabled();
  await reread();
  const note = d.locator("[data-load-check]");
  await expect(note).toHaveText("Compared with LinuxCNC before — check againCheck again");
  await expect(note).toHaveClass(/warn/);
  await expect(tick).not.toBeChecked();
  await expect(tick).toBeDisabled();
  await expect(loadBtn(d)).toBeDisabled();
  await expect(d.locator("tbody tr"), "the list never changes by itself").toHaveText([/^T8/, /^T5/]);
  await replyFor("tool_table_preview", { ...PREVIEW, removed: [one(8), one(9)], base: { ...BASE, rev: "c".repeat(64) } });
  await note.getByRole("button", { name: "Check again" }).click();
  await expect(note).toHaveCount(0);
  await expect(d.locator("tbody tr")).toHaveText([/^T8/, /^T9/, /^T5/]);
  const again = d.getByLabel("Remove 2 tools from LinuxCNC");
  await expect(again, "reset by every new comparison").not.toBeChecked();
  await again.check();
  await replyFor("tool_table_load", REQUESTED);
  await loadBtn(d).click();
  await expect(d).toHaveCount(0);
  expect((await sent("tool_table_load"))[0]).toMatchObject({ base: { ...BASE, rev: "c".repeat(64) }, removed: [8, 9] });
});

test("stale by a lost connection; a refused new comparison keeps it closed", async ({ page }) => {
  const t = await openTools(page);
  const d = await compare(t);
  await expect(loadBtn(d)).toBeEnabled();
  await ctl({ op: "shutdownClose" });
  const note = d.locator("[data-load-check]");
  await expect(note).toContainText("Connection lost — check again");
  await expect(loadBtn(d)).toBeDisabled();
  // connected again: still the old comparison
  await expect(t.tab.getByRole("button", { name: "Edit T5", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(note).toContainText("Connection lost — check again");
  await expect(page.locator(".pill.armed")).toBeVisible({ timeout: 20_000 });     // the Gate is open again: the staleness closes it
  await expect(d.locator(".dialogActions .btnTip")).toHaveAttribute("title", /Connection lost — check again/);
  await expect(loadBtn(d)).toBeDisabled();
  await replyFor("tool_table_preview", { ok: true, refusal: "The last line … no", base: null });
  await note.getByRole("button", { name: "Check again" }).click();
  await expect(note).toHaveText("Not requested: The last line … no.Check again");
  await expect(note).toHaveClass(/error/);
  await expect(loadBtn(d)).toBeDisabled();
  await expect(d.locator(".dialogActions .btnTip")).toHaveAttribute("title", /Check again first/);
  await replyFor("tool_table_preview", PREVIEW);
  await note.getByRole("button", { name: "Check again" }).click();
  await expect(note).toHaveCount(0);
  await expect(loadBtn(d)).toBeEnabled();
  expect((await sent("tool_table_load")).length).toBe(0);
});

test("a refused request stays in the dialog with its reason; nothing is sent again by itself", async ({ page }) => {
  const t = await openTools(page);
  await replyFor("tool_table_load", { ok: false, error: "Machine moving — wait until it stands" });
  await replyFor("tool_table_preview", { ...PREVIEW, removed: [one(8)] });
  const d = await compare(t);
  await d.getByLabel("Remove 1 tool from LinuxCNC").check();
  await loadBtn(d).click();
  const note = d.locator("[data-load-check]");
  await expect(note).toHaveText("Not requested: Machine moving — wait until it stands.Check again");
  await expect(loadBtn(d)).toBeEnabled();
  expect((await sent("tool_table_load")).length).toBe(1);
  await expect(t.result).toHaveCount(0);
  // a new comparison is acknowledged anew, the same tools too
  await note.getByRole("button", { name: "Check again" }).click();
  await expect(note).toHaveCount(0);
  await expect(d.getByLabel("Remove 1 tool from LinuxCNC")).not.toBeChecked();
  await expect(loadBtn(d)).toBeDisabled();
  await d.getByLabel("Remove 1 tool from LinuxCNC").check();
  await loadBtn(d).click();
  await expect(note).toBeVisible();
  // the gateway's removal switch off (Q-TF2-1): said, and closed
  await replyFor("tool_table_preview", { ...PREVIEW, removed: [one(8)], removal_refusal: "Loading never removes tools — restore them in the file" });
  await note.getByRole("button", { name: "Check again" }).click();
  await expect(d.locator(".statusNote.warn")).toHaveText(["Loading never removes tools — restore them in the file"]);
  await expect(d.locator("input[type=checkbox]")).toHaveCount(0);
  await expect(loadBtn(d)).toBeDisabled();
  await expect(d.locator(".dialogActions .btnTip")).toHaveAttribute("title", /Loading never removes tools/);
});

test("a lost reply: the outcome is unknown, no note, the confirm closed until Check again", async ({ page }) => {
  const t = await openTools(page);
  await failedWrite(t, page);
  await serve({ ...COMPLETE });
  await reread();
  await expect(t.write).toContainText("Table saved, load into LinuxCNC failed — load table or restart.");
  await replyFor("tool_table_load", "silent");
  await loadBtn(t.write).click();
  const d = t.dialog;
  await loadBtn(d).click();
  await expect.poll(async () => (await sent("tool_table_load")).length).toBe(1);
  await ctl({ op: "shutdownClose" });
  const note = d.locator("[data-load-check]");
  await expect(note).toContainText("Connection lost — outcome unknown, the table reloads on reconnect");
  await expect(loadBtn(d)).toBeDisabled();
  await expect(t.write, "neither 'failed' nor 'requested' is known")
    .toContainText("Table saved, load not confirmed — load table or restart.", { timeout: 20_000 });
  await expect(t.result).toHaveCount(0);
  expect((await sent("tool_table_load")).length, "no second request after the reconnect").toBeLessThanOrEqual(1);
});

test("no reply at all: unknown after the limit, closed until Check again, never sent again", async ({ page }) => {
  await page.clock.install();
  const t = await openTools(page);
  await replyFor("tool_table_load", "silent");
  const d = await compare(t);
  await loadBtn(d).click();
  await expect.poll(async () => (await sent("tool_table_load")).length).toBe(1);
  await page.clock.fastForward(61_000);
  const note = d.locator("[data-load-check]");
  await expect(note).toHaveText("No reply — outcome unknown, reload the tableCheck again");
  await expect(note).toHaveClass(/error/);
  await expect(loadBtn(d)).toBeDisabled();
  await expect(d.locator(".dialogActions .btnTip")).toHaveAttribute("title", /Check again first/);
  await page.clock.fastForward(61_000);
  expect((await sent("tool_table_load")).length).toBe(1);
  await note.getByRole("button", { name: "Check again" }).click();
  await expect(note).toHaveCount(0);
  await expect(loadBtn(d)).toBeEnabled();
});

test("disarmed: the comparison is a read, Cancel works, the request is closed and says why", async ({ page }) => {
  const t = await openTools(page);
  await ctl({ op: "status_delta", armed: false, data: {} });
  await expect(page.locator(".pill.disarmed")).toBeVisible();
  await replyFor("tool_table_preview", { ...PREVIEW, removed: [one(8)] });
  const d = await compare(t);
  await expect(loadBtn(d)).toBeDisabled();
  await expect(d.getByLabel("Remove 1 tool from LinuxCNC")).toBeDisabled();
  await d.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(d).toHaveCount(0);
  expect((await sent("tool_table_load")).length).toBe(0);
});

// ---- what the tab says afterwards (§2.5, §3) ----------------------------------------

test("the note is the read's: shown, kept over a socket loss, gone under another LinuxCNC of the same file", async ({ page }) => {
  const t = await openTools(page);
  await serve({ ...COMPLETE });                    // what the read after the request says
  await request(t, REQUESTED);
  await expect(t.result).toHaveText(OK_NOTE);
  await expect(t.result).toHaveClass(/\bok\b/);
  // an ordinary read of the same owner keeps it; a closed connection says nothing …
  await reread();
  await expect(t.result).toHaveText(OK_NOTE);
  await ctl({ op: "shutdownClose" });
  await expect(t.tab.getByRole("button", { name: "Edit T5", exact: true })).toHaveCount(0);
  await expect(t.result).toHaveCount(0);
  // … and the reconnect's read that shows it again brings it back
  await expect(t.result).toHaveText(OK_NOTE, { timeout: 20_000 });
  // another LinuxCNC on the same path, its read complete: nothing of A's
  await serve({ ...COMPLETE, table: { ...TABLE, instance: "222:2" } });
  await reread();
  await expect(t.tab.getByRole("button", { name: "Edit T5", exact: true })).toBeVisible();
  await expect(t.result).toHaveCount(0);
  // A again, the same revision: gone for good
  await serve({ ...COMPLETE });
  const reads = (await sent("get_tool_table")).length;
  await reread();
  await expect.poll(async () => (await sent("get_tool_table")).length).toBeGreaterThan(reads);
  await expect(t.result).toHaveCount(0);
});

test("once shown, a read that does not show it ends it — for good; the X ends it too", async ({ page }) => {
  const t = await openTools(page);
  for (const over of [{ ...PARTIAL }, { ...COMPLETE, rev: { table: "c".repeat(64), library: "l" } }, { ...COMPLETE, owner: { ...OWNER, link: "e.2" } }]) {
    await serve({ ...COMPLETE });
    await reread();
    await replyFor("tool_table_load", REQUESTED);
    await clickMore(page.locator(".toolsHead"), "Load table");
    await loadBtn(t.dialog).click();
    await expect(t.result).toHaveText(OK_NOTE);
    await serve(over);
    await reread();
    await expect(t.result, JSON.stringify(over)).toHaveCount(0);
    await serve({ ...COMPLETE });
    await reread();
    await expect(t.read).toHaveCount(0);
    await expect(t.result, "no later read revives it").toHaveCount(0);
  }
  await clickMore(page.locator(".toolsHead"), "Load table");
  await loadBtn(t.dialog).click();
  await expect(t.result).toHaveText(OK_NOTE);
  await t.result.getByRole("button", { name: "Dismiss load note" }).click();
  await expect(t.result).toHaveCount(0);
});

test("not shown, not awaited, changed since: each said, and a late load turns the note", async ({ page }) => {
  const t = await openTools(page);
  const cases: [Reply, string][] = [
    [{ values: "not shown", why: "in time" }, "Load requested, values not shown — LinuxCNC did not show them in time."],
    [{ values: "not shown", why: "file changed" }, "Load requested, values not shown — the file changed meanwhile."],
    [{ values: "not shown", why: "superseded" }, "Load requested, values not shown — a newer table write came."],
    [{ values: "not shown", why: "unknown" }, "Load requested, values not shown — its outcome is unknown."],
    [{ values: "shown" }, "Load requested, values not shown — the table changed since."],
    [{ values: "not awaited" }, "Load requested, not awaited — the table shows the result."],
  ];
  for (const [over, text] of cases) {
    await serve();
    await request(t, { ...REQUESTED, ...over });
    await expect(t.result).toHaveText(text);
    await expect(t.result).toHaveClass(/warn/);
  }
  await serve({ ...COMPLETE });                    // the load ran after the wait
  await reread();
  await expect(t.result).toHaveText(OK_NOTE);
  // a wait ended by another connection says so under it, until dismissed
  await serve();
  await reread();
  await request(t, { ...REQUESTED, values: "not shown", why: "controller changed" });
  await serve({ ...COMPLETE, owner: { ...OWNER, link: "e.2" } });
  await reread();
  await expect(t.result).toHaveText("Load requested, values not shown — connection to LinuxCNC changed.");
  // a complete basis: as before
  await t.result.getByRole("button", { name: "Dismiss load note" }).click();
  await serve({ ...COMPLETE });
  await reread();
  await replyFor("tool_table_load", { ...REQUESTED, values: "not awaited", basis: "complete" });
  await clickMore(page.locator(".toolsHead"), "Load table");
  await loadBtn(t.dialog).click();
  await expect(t.result).toHaveText("Load requested. LinuxCNC shows the file's tool values, as before; pockets and remarks are not compared.");
});

test("the write note stands after shown values, reworded, never ended by them; 'requested' stands once", async ({ page }) => {
  const t = await openTools(page);
  await failedWrite(t, page);
  await expect(t.write, "hidden beside the partial read").toHaveCount(0);
  await serve({ ...COMPLETE });
  await request(t, REQUESTED);
  // the read is complete: the hidden load part is back, with its requested words
  await expect(t.write).toContainText("Table saved, load requested but not confirmed — load table or restart.");
  await expect(t.result).toHaveText(OK_BARE);
  await expect(loadBtn(t.write)).toBeVisible();
  // the tail is the read's own: the file's cause, an unknown read, a scope without a way out
  const why = "Line 12 too long for LinuxCNC — shorten it in an editor";
  await serve({ ...COMPLETE, load_refusal: why });
  await reread();
  await expect(t.write.locator("span").first()).toHaveText(`Table saved, load requested but not confirmed. ${why}.`);
  await expect(loadBtn(t.write), "offered only for a loadable file").toHaveCount(0);
  await serve({ ...UNCHECKED, load_refusal: "Random tool changer — not loaded from here" });
  await reread();
  await expect(t.write.locator("span").first()).toHaveText("Table saved, load requested but not confirmed. Random tool changer — not loaded from here.");
  await replyFor("get_tool_table", { ok: false, error: "Tool table not read — x" });
  await reread();
  await expect(t.write.locator("span").first()).toHaveText("Table saved, load requested but not confirmed — read again.");
  // another Link: the request no longer counts, and it is never "failed" again
  await serve({ ...COMPLETE, owner: { ...OWNER, link: "e.2" } });
  await reread();
  await expect(t.write.locator("span").first()).toHaveText("Table saved, load not confirmed — load table or restart.");
  await t.write.getByRole("button", { name: "Dismiss save note" }).click();
  await expect(t.write).toHaveCount(0);
});

// ---- room ----------------------------------------------------------------------------

for (const [vp, zoom] of [[0, 1], [2, 1], [3, 1], [3, 1.5]] as const) {
  test(`${VIEWPORTS[vp]!.name} at ${zoom * 100} %: nothing runs out, the list scrolls thin, the actions stay`, async ({ page }) => {
    const t = await openTools(page, {}, vp);
    if (zoom !== 1) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
    await replyFor("tool_table_preview", { ...PREVIEW, spindle: 5, basis: "partial",
      removed: Array.from({ length: 40 }, (_v, i) => ({ ...one(i + 100, -123.456789, 12.3456), name: "A very long tool name without an end, ".repeat(3) })),
      changed: [{ T: 5, name: "x".repeat(90), fields: ["X", "Y", "Z", "A", "B", "C", "U", "V", "W", "D", "I", "J", "Q"].map((f, i) => ({ f, now: -123.456789 - i, file: 987.654321 + i })) }] });
    const d = await compare(t);
    expect(await sidewaysOverflow(d)).toEqual([]);
    expect(await sidewaysOverflow(t.read), "the note wraps its words and its two buttons").toEqual([]);
    expect(await thickScrollbars(d)).toEqual([]);
    const inside = await d.evaluate(el => {
      const box = el.getBoundingClientRect();
      const what = [...el.querySelectorAll<HTMLElement>(".dialogActions button, input[type=checkbox], [data-load-counts]")];
      return what.map(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.left >= box.left - 1 && r.right <= box.right + 1; });
    });
    expect(inside.length).toBeGreaterThanOrEqual(4);
    expect(inside.every(Boolean), "the switch and the actions are never scrolled away").toBe(true);
    await reread();
    await expect(d.locator("[data-load-check]")).toBeVisible();
    expect(await sidewaysOverflow(d)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`load-${VIEWPORTS[vp]!.name}-${zoom}.png`) });
  });
}

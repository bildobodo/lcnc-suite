// The tool table never hangs on "Loading tools…" (operator 2026-10-04: only
// a browser refresh brought the list back). The Tools tab and the strip read
// the table through request(): their OWN reply (req_id) — the tab used to
// wait, without a limit, for any reply named get_tool_table, and a read lost
// in a reconnect left it loading for good, with no Retry. Now a slow read is
// said after 8 s (Retry), its late reply is still taken, and a read that gets
// no reply at all ends with the reason after 60 s.
import { test, expect } from "./test";
import { ctl, publishToolTable } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

const TOOL = { T: 5, P: 5, D: 6, Z: -40, type: "endmill", description: "Five mill" };

test("a slow read says so, keeps waiting and takes its late reply; Retry reads again", async ({ page }) => {
  test.setTimeout(60_000);
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  // a gateway slow to answer: the read after a table change stays out
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: "silent" });
  await ctl({ op: "raw", frame: { type: "tool_table_changed", version: 70 } });
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  const tab = page.locator(".toolsTab");
  const loading = tab.locator(".emptyState.loading");
  const note = tab.getByRole("alert").filter({ hasText: "No reply from the gateway" });
  await expect(loading).toHaveText("Loading tools…");
  await expect(note, "said after 8 s, never silent").toContainText("No reply from the gateway yet — retry", { timeout: 12_000 });
  await expect(loading, "and still waiting").toBeVisible();

  // the late replies to the reads out (only the newest applies)
  const reads = ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; req_id?: string }[])
    .filter(c => c.cmd === "get_tool_table" && c.req_id);
  expect(reads.length).toBeGreaterThan(0);
  for (const r of reads) await ctl({ op: "raw", frame: { type: "reply", cmd: "get_tool_table", req_id: r.req_id, ok: true, tools: [TOOL] } });
  await expect(tab.getByRole("button", { name: "Edit T5", exact: true })).toBeVisible();
  await expect(note).toHaveCount(0);

  // an unsolicited reply (no req_id) is no answer to anything
  await ctl({ op: "raw", frame: { type: "reply", cmd: "get_tool_table", ok: true, tools: [] } });
  await page.waitForTimeout(300);
  await expect(tab.getByRole("button", { name: "Edit T5", exact: true })).toBeVisible();

  // Retry while slow: a new read, answered now
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: "silent" });
  await ctl({ op: "raw", frame: { type: "tool_table_changed", version: 77 } });
  await expect(note).toContainText("No reply from the gateway yet", { timeout: 12_000 });
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: { ok: true, tools: [TOOL, { ...TOOL, T: 6, P: 6, description: "Six mill" }] } });
  await note.getByRole("button", { name: "Retry" }).click();
  await expect(tab.getByRole("button", { name: "Edit T6", exact: true })).toBeVisible();
  await expect(note).toHaveCount(0);
});

test("a reconnect reads the table again; the strip follows a changed table", async ({ page }) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await publishToolTable([TOOL]);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(page.locator(".toolsTab").getByRole("button", { name: "Edit T5", exact: true })).toBeVisible();
  await ctl({ op: "status_delta", data: { tool_in_spindle: 5, tool_number: 5 } });
  await expect(page.locator('[data-strip="tool"]')).toContainText("Five mill");
  // another client renamed the tool: the strip reads again on tool_table_changed
  await publishToolTable([{ ...TOOL, description: "Five mill (reground)" }]);
  await expect(page.locator('[data-strip="tool"]')).toContainText("Five mill (reground)");
  // the connection drops: both read again once it is back (the new table is
  // served, but no tool_table_changed announces it — only the reconnect reads)
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: { ok: true, tools: [{ ...TOOL, description: "Five after reconnect" }] } });
  await page.waitForTimeout(500);
  const reread = page.locator(".toolsTab tbody").getByText("Five after reconnect", { exact: true });
  await expect(reread).toHaveCount(0);
  await ctl({ op: "shutdownClose" });
  await expect(reread.first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-strip="tool"]')).toContainText("Five after reconnect");
});

// P6 tool files read: a closed connection clears the rows; the moment one
// opens the tab loads — never "Not connected" while the read waits its delay
// (the page's timers stand still here, so that delay never ends).
test("a connection that opens: the tab loads, never 'Not connected' while its read waits", async ({ page }) => {
  await page.clock.install();
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await publishToolTable([TOOL]);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  const tab = page.locator(".toolsTab");
  const row = tab.getByRole("button", { name: "Edit T5", exact: true });
  await expect(row).toBeVisible();
  await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 1_000);
  await ctl({ op: "shutdownClose" });
  await expect(row, "a closed connection's rows are gone").toHaveCount(0);
  await expect(tab.locator(".emptyState.loading"), "connected again: the tab loads").toHaveText("Loading tools…", { timeout: 20_000 });
  await expect(tab.getByRole("alert").filter({ hasText: "Not connected" }), "no 'Not connected' while connected").toHaveCount(0);
  await page.clock.resume();
  await expect(row, "and reads").toBeVisible();
});

// P6 tool files read (plan maschinentag.r465 v4 §6, Codex R465): the Tools
// tab shows the read's proof — a partial read its rows with a note naming
// the tools (neutral: never "is being written"), an unchecked read its rows
// and why, a failed read no rows ("Tool table not read."), "No tools" only
// for a complete read without rows.
test("the read's proof: partial and unchecked name it, a failed read is not empty, 'No tools' only complete", async ({ page }) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  const tab = page.locator(".toolsTab");
  const state = tab.locator("[data-read-state]");
  const empty = tab.locator(".emptyState");
  let version = 900;
  const serve = async (reply: Record<string, unknown>) => {
    await ctl({ op: "replyFor", cmd: "get_tool_table", reply });
    await ctl({ op: "raw", frame: { type: "tool_table_changed", version: ++version } });
  };
  const PROOF = { proven: [], differs: [], missing: [], extra: [], duplicates: [] };

  await serve({ ok: true, tools: [TOOL], proof: { ...PROOF, state: "partial", proven: [], differs: [{ T: 5, fields: ["Z"] }],
                                                 missing: [7], why: "file incomplete or differs from LinuxCNC" },
                unread: [{ line: 3, T: null }] });
  await expect(state).toHaveText("File incomplete or differs from LinuxCNC — T5 differs; T7 missing in the file; line 3 not read.Retry");
  await expect(state).not.toContainText("written");
  await expect(tab.getByRole("button", { name: "Edit T5", exact: true }), "its rows show").toBeVisible();

  // the gateway's own words for what an edit is refused with: cause and way out
  await serve({ ok: true, tools: [TOOL], proof: { ...PROOF, state: "partial", duplicates: [5], why: "file incomplete or differs from LinuxCNC" },
                edit_refusal: "T5 twice in the file — remove one, restart LinuxCNC" });
  await expect(state, "one fact, said once").toHaveText("Edits refused: T5 twice in the file — remove one, restart LinuxCNC.Retry");

  await serve({ ok: true, tools: [], proof: { ...PROOF, state: "partial", missing: [5], why: "file incomplete or differs from LinuxCNC" } });
  await expect(empty, "a partial read without rows is not 'No tools'").toHaveText("Tool table not confirmed.");

  await serve({ ok: true, tools: [], proof: { ...PROOF, state: "unchecked", why: "controller not read" } });
  await expect(empty).toHaveText("Tool table not checked.");

  await serve({ ok: true, tools: [TOOL], proof: { ...PROOF, state: "unchecked", why: "random tool changer" } });
  await expect(state).toContainText("Not checked against LinuxCNC — random tool changer.");
  await expect(tab.getByRole("button", { name: "Edit T5", exact: true })).toBeVisible();

  // a failed read right after a read WITH rows: the rows go, the table is not "empty"
  await serve({ ok: false, error: "Tool library not JSON (line 1) — check tool_library.json" });
  await expect(tab.getByRole("alert").filter({ hasText: "Tool library not JSON" })).toBeVisible();
  await expect(empty, "a failed read shows no rows, never an empty table").toHaveText("Tool table not read.");
  await expect(tab.getByRole("button", { name: "Edit T5", exact: true })).toHaveCount(0);

  await serve({ ok: true, tools: [], proof: { ...PROOF, state: "complete", why: null } });
  await expect(empty).toHaveText(/^No tools in the table\./);
  await expect(state).toHaveCount(0);
});

// Codex R471 MT-I42: `ok: true` to an edit or an import means the table IS
// written; the dialog closes (nothing of it is an unsaved draft). What came of
// its load into LinuxCNC and of its metadata stands in the tab — the load only
// where the read that follows does not say it already (one fact, one place).
const NOT_LOADED = "Table saved, load into LinuxCNC failed — restart loads it.";
const NO_METADATA = "Table saved, metadata not — check tool_library.json.";
const NEITHER = "Table saved, metadata not — check tool_library.json; load into LinuxCNC failed — restart loads it.";
const PROVEN = { proven: [5], differs: [], missing: [], extra: [], duplicates: [] };
const DIFFERS = { proof: { ...PROVEN, proven: [], state: "partial", differs: [{ T: 5, fields: ["Z"] }], why: "file incomplete or differs from LinuxCNC" },
                  edit_refusal: "T5 differs from LinuxCNC — a restart loads the file" };
const HOLDS = { proof: { ...PROVEN, state: "complete", why: null }, edit_refusal: null };
const RANDOM = { proof: { ...PROVEN, proven: [], state: "unchecked", why: "random tool changer" }, edit_refusal: null };

test("a written table that LinuxCNC did not load, or without its metadata, is said once — no draft kept", async ({ page }) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await publishToolTable([TOOL]);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  const tab = page.locator(".toolsTab");
  const read = tab.locator("[data-read-state]");
  const note = tab.locator("[data-write-state]");
  const editor = page.getByRole("dialog", { name: "Edit Tool T5" });
  const edit = { cmd: "save_tool", run: async () => {
    await tab.getByRole("button", { name: "Edit T5", exact: true }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor, "the table is written: no draft stays").toHaveCount(0);
  } };
  const remove = { cmd: "delete_tool", run: async () => {
    await tab.getByRole("button", { name: "Delete T5", exact: true }).click();
    const ask = page.getByRole("dialog", { name: "Delete T5?" });
    await ask.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(ask).toHaveCount(0);
  } };
  const cases: { reload: string; metadata?: string; after: object; read: string | null; note: string | null }[] = [
    { reload: "confirmed", after: HOLDS, read: null, note: null },
    // LinuxCNC holds the old value: the read says it, with its way out — nothing twice
    { reload: "reload not sent", after: DIFFERS, read: `Edits refused: ${DIFFERS.edit_refusal}.`, note: null },
    { reload: "reload failed", after: DIFFERS, read: `Edits refused: ${DIFFERS.edit_refusal}.`, note: null },
    { reload: "unconfirmed", after: DIFFERS, read: `Edits refused: ${DIFFERS.edit_refusal}.`, note: null },
    { reload: "controller changed", after: HOLDS, read: null, note: null },
    // the read proves no pocket and no remark; a random changer's proves nothing
    { reload: "reload not sent", after: HOLDS, read: null, note: NOT_LOADED },
    { reload: "reload failed", after: RANDOM, read: "Not checked against LinuxCNC — random tool changer.", note: NOT_LOADED },
    // no table read speaks of the metadata
    { reload: "confirmed", metadata: "not saved", after: HOLDS, read: null, note: NO_METADATA },
    { reload: "reload not sent", metadata: "not saved", after: DIFFERS, read: `Edits refused: ${DIFFERS.edit_refusal}.`, note: NO_METADATA },
    { reload: "reload failed", metadata: "not saved", after: HOLDS, read: null, note: NEITHER },
  ];
  for (const job of [edit, remove]) {
    for (const c of cases) {
      const what = `${job.cmd}: ${c.reload}${c.metadata ? `, metadata ${c.metadata}` : ""} beside ${JSON.stringify(c.after)}`;
      await publishToolTable([TOOL]);
      await expect(tab.getByRole("button", { name: "Edit T5", exact: true })).toBeVisible();
      await ctl({ op: "replyFor", cmd: "get_tool_table", reply: { ok: true, tools: [TOOL], ...c.after } });
      await ctl({ op: "replyFor", cmd: job.cmd, reply: { ok: true, reload: c.reload, ...(c.metadata ? { metadata: c.metadata } : {}) } });
      await job.run();
      if (c.read) await expect(read, what).toHaveText(`${c.read}Retry`); else await expect(read, what).toHaveCount(0);
      if (c.note) await expect(note, what).toHaveText(c.note); else await expect(note, what).toHaveCount(0);
      if (job === edit && c.reload === "reload not sent")
        await page.screenshot({ path: test.info().outputPath(`not-loaded-${c.note ? "note" : "read"}${c.metadata ? "-metadata" : ""}.png`) });
      await ctl({ op: "replyFor", cmd: job.cmd, reply: null });
    }
  }
  // the last one stands until dismissed — a later read does not take it
  await publishToolTable([TOOL]);
  await expect(note).toHaveText(NEITHER);
  // a new connection (the restart it asks for): the load is the next read's
  // word again, the metadata are still not saved
  await ctl({ op: "shutdownClose" });
  await expect(note).toHaveText(NO_METADATA, { timeout: 20_000 });
  await expect(tab.getByRole("button", { name: "Edit T5", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(note).toHaveText(NO_METADATA);
  await note.getByRole("button", { name: "Dismiss save note" }).click();
  await expect(note).toHaveCount(0);
});

test("the note of a written table comes with the read that follows it, never before it", async ({ page }) => {
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await publishToolTable([TOOL]);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  const tab = page.locator(".toolsTab");
  const note = tab.locator("[data-write-state]");
  await tab.getByRole("button", { name: "Edit T5", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit Tool T5" });
  await ctl({ op: "replyFor", cmd: "save_tool", reply: { ok: true, reload: "reload not sent" } });
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: "silent" });
  await ctl({ op: "clearCmds" });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const reads = async () => ((await ctl({ op: "lastCmds" })).cmds as { cmd: string; req_id?: string }[])
    .filter(c => c.cmd === "get_tool_table" && c.req_id);
  await expect.poll(async () => (await reads()).length).toBeGreaterThan(0);
  // the write's ping: newer reads (the tab's and the strip's) — the first one's late answer is none
  const first = (await reads())[0]!;
  await ctl({ op: "raw", frame: { type: "tool_table_changed", version: 1201 } });
  await expect.poll(async () => (await reads()).length).toBe(3);
  const raw = (r: { req_id?: string }, over: object) => ctl({ op: "raw", frame: { type: "reply", cmd: "get_tool_table", req_id: r.req_id, ok: true, tools: [TOOL], unread: [], ...over } });
  await raw(first, HOLDS);
  await expect(tab.getByRole("button", { name: "Edit T5", exact: true })).toBeVisible();
  await expect(note).toHaveCount(0);
  for (const r of (await reads()).slice(1)) await raw(r, DIFFERS);
  await expect(tab.locator("[data-read-state]")).toContainText("T5 differs from LinuxCNC — a restart loads the file");
  await expect(note, "said by the read already").toHaveCount(0);
  await ctl({ op: "replyFor", cmd: "save_tool", reply: null });
});

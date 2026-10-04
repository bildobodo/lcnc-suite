// The tool table never hangs on "Loading tools…" (operator 2026-10-04: only
// a browser refresh brought the list back). The Tools tab and the strip read
// the table through request(): their OWN reply (req_id) — the tab used to
// wait, without a limit, for any reply named get_tool_table, and a read lost
// in a reconnect left it loading for good, with no Retry. Now a slow read is
// said after 8 s (Retry), its late reply is still taken, and a read that gets
// no reply at all ends with the reason after 60 s.
import { test, expect } from "@playwright/test";
import { ctl, publishToolTable } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

const TOOL = { T: 5, P: 5, D: 6, Z: -40, type: "endmill", description: "Five mill" };

test("a slow read says so, keeps waiting and takes its late reply; Retry reads again", async ({ page }) => {
  test.setTimeout(60_000);
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);       // the mock reset: get_tool_table unanswered
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
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: null });
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

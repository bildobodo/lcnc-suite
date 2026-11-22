// A tool edit carries the row it was opened on (P4-2, machine day F15, Codex
// MT433-01): a save and a renumber send the row state of the READ the dialog
// opened on — the table's identity, the tool and the fields the dialog sends
// back whole — and the gateway refuses the whole edit when that row changed
// meanwhile (a length measured by an M600 after the dialog opened). The
// refusal keeps the dialog and its draft.
import { test, expect } from "./test";
import { ctl, publishToolTable } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { TOOL_EDIT_FIELDS } from "../src/lcnc";

const T5 = { T: 5, P: 5, D: 6, Z: -40, remark: "five", type: "endmill", description: "Five mill", flutes: 2 };
const MOCK_TABLE = { path: "/mock/linuxcnc/tool.tbl", instance: "mock:1" };
type Sent = { cmd?: string; expected?: { table: unknown; tool: number; fields: Record<string, unknown> }; tool_number?: number };
const sent = async (): Promise<Sent[]> => ((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [];

/** The row state a dialog opened on `row` sends: every edited field, null where the row has none. */
const opened = (row: Record<string, unknown>) => ({
  table: MOCK_TABLE, tool: row.T,
  fields: Object.fromEntries(TOOL_EDIT_FIELDS.map(f => [f, row[f] ?? null])),
});

async function openEditor(page: import("./test").Page) {
  await openLayout(page, PROFILES[1]!, VIEWPORTS[0]!);
  await publishToolTable([T5]);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page.getByRole("button", { name: "Edit T5", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toBeVisible();
  return dialog;
}

test("a save sends the row the dialog opened on — not a newer read", async ({ page }) => {
  const dialog = await openEditor(page);
  // the table changes under the open dialog (a measurement): the list reads again
  await publishToolTable([{ ...T5, Z: -45.5 }]);
  await expect(page.locator(".toolsTab tbody tr").first()).toContainText("-45.5");
  await ctl({ op: "replyFor", cmd: "save_tool", reply: { ok: true } });
  await ctl({ op: "clearCmds" });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "save_tool").length).toBe(1);
  const save = (await sent()).find(c => c.cmd === "save_tool")!;
  expect(save.expected, "the row as opened (Z -40), never the newer read").toEqual(opened(T5));
  await ctl({ op: "replyFor", cmd: "save_tool", reply: null });
});

test("a conflict keeps the dialog, its draft and says why", async ({ page }) => {
  const dialog = await openEditor(page);
  await ctl({ op: "replyFor", cmd: "save_tool",
              reply: { ok: false, conflict: true, error: "Tool changed meanwhile — reopen", fields: ["Z"] } });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Tool changed meanwhile — reopen");
  await expect(dialog, "the dialog stays").toBeVisible();
  await expect(dialog.getByLabel("Z Offset", { exact: true })).toHaveValue("-40");
  await ctl({ op: "replyFor", cmd: "save_tool", reply: null });
});

test("a renumber sends the row it was opened on too", async ({ page }) => {
  const dialog = await openEditor(page);
  // the number through the field's keypad, the operator's way
  await dialog.getByLabel("Tool #", { exact: true }).click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("9");
  await page.keyboard.press("Enter");
  await expect(dialog.getByLabel("Tool #", { exact: true })).toHaveValue("9");
  await ctl({ op: "replyFor", cmd: "renumber_tool", reply: { ok: true, tool_number: 9 } });
  await ctl({ op: "clearCmds" });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "renumber_tool").length).toBe(1);
  expect((await sent()).find(c => c.cmd === "renumber_tool")!.expected).toEqual(opened(T5));
  await ctl({ op: "replyFor", cmd: "renumber_tool", reply: null });
});

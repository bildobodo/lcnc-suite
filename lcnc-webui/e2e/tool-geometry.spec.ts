import { test, expect, type Page } from "@playwright/test";
import WebSocket from "ws";
import { assertLayout, expectDialogUncovered, measureLayout } from "./layout-audit";
import { VIEWPORTS } from "./layout-fixtures";
import { ctl as ctlOp, publishToolTable } from "./ctl";
import { clickMore } from "./more";

const MOCK = process.env.TOOL_IMPORT_TEST_URL ?? "http://localhost:4174/";
function ctl(frame: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(new URL("ctl", MOCK).href.replace(/^http/, "ws"));
    socket.once("open", () => socket.send(JSON.stringify({ op: "raw", frame })));
    socket.once("message", data => {
      socket.close();
      const reply = JSON.parse(String(data));
      if (reply.ok) resolve(); else reject(new Error(reply.error));
    });
    socket.once("error", reject);
  });
}

// WP3 (review A): the edit dialog is a .dialog.md.wide teleported over the
// content area — fields and preview are separate columns with a real gap
// (or the preview stacks BELOW the fields when the dialog is narrow), and
// the geometry notice is a full-width row under both, never a squeezed
// span in the preview column.
async function expectEditDialogGeometry(page: Page) {
  const dialog = page.locator(".editDialog");
  const fields = (await page.locator(".editFields").boundingBox())!;
  const preview = (await page.locator(".editPreviewCol").boundingBox())!;
  const content = (await page.locator(".editDialog .dialogContent").boundingBox())!;
  const stacked = preview.y >= fields.y + fields.height - 1;
  if (stacked) {
    expect(preview.y - (fields.y + fields.height)).toBeGreaterThanOrEqual(12);
  } else {
    expect(preview.x - (fields.x + fields.width)).toBeGreaterThanOrEqual(12);
  }
  const note = page.locator(".editNotice");
  if (await note.count()) {
    const n = (await note.boundingBox())!;
    expect(n.y).toBeGreaterThanOrEqual(Math.max(fields.y + fields.height, preview.y + preview.height) - 1);
    expect(n.width).toBeGreaterThanOrEqual(0.9 * (content.width - 24));
    expect(n.x).toBeLessThanOrEqual(fields.x + 1);
  }
  // Over the content area (viewer + side pane), not inside the side pane.
  const area = (await page.locator("#content-dialog-area").boundingBox())!;
  const d = (await dialog.boundingBox())!;
  expect(d.x).toBeGreaterThanOrEqual(area.x - 1);
  expect(d.x + d.width).toBeLessThanOrEqual(area.x + area.width + 1);
  expect(d.y).toBeGreaterThanOrEqual(area.y - 1);
  expect(d.y + d.height).toBeLessThanOrEqual(area.y + area.height + 1);
  await expectDialogUncovered(dialog);
}

const tool = { T: 416, P: 7, Z: -42.3, D: 12, type: "circlebarrel",
  fusion_type: "circle segment barrel", description: "Imported barrel cutter",
  oal: 80, flute_length: 20, shoulder_length: 20, shaft_diameter: 12,
  lower_radius: 1, upper_radius: 1, profile_radius: 48, axial_distance: 10 };
const notice = "Circle Segment Barrel: approximate preview; native contour not verified.";

test("unverified geometry is visible in the table, editor and both import modes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(MOCK);
  await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled();
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect.poll(async () => {
    await publishToolTable([tool], MOCK);
    return page.getByTitle("Edit tool", { exact: true }).count();
  }).toBe(1);
  const row = page.locator("tbody tr").filter({ hasText: tool.description });
  await expect(row).toContainText("Circle Segment Barrel");
  await expect(row).toContainText("Approximate preview");
  await expect(row).toContainText("-42.300000");
  await page.getByTitle("Edit tool", { exact: true }).click();
  await expect(page.locator(".editPreviewCanvas canvas")).toBeVisible();
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  await expectEditDialogGeometry(page);
  await page.locator(".editDialog").screenshot({ path: test.info().outputPath("barrel-preview.png") });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const refreshRow = { ...tool, current_description: "Measured cutter", current_diameter: 12, reason: null, match: "number" };
  await page.route("**/import-tool-library", route => route.fulfill({ json: {
    ok: true, tools: [tool], total: 1, existing_count: 1, skipped_duplicates: [],
    metadata_refresh: { rows: [refreshRow], updated: [tool.T], skipped: [], revision: "reviewed-geometry" },
  } }));
  await page.locator('input[type="file"][accept*=".fctb"]').setInputFiles({
    name: "tools.json", mimeType: "application/json", buffer: Buffer.from('{"data":[]}'),
  });
  await expect(page.getByLabel("Import mode")).toHaveValue("metadata");
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  await expect(page.getByText(/keep Z -42.300/)).toBeVisible();
  await page.getByLabel("Import mode").selectOption("replace");
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  const noticeFits = await page.getByText(notice, { exact: true }).evaluate(element => {
    const boundary = element.closest(".importDesc")!.getBoundingClientRect();
    return Array.from(element.getClientRects()).every(rect => rect.right <= boundary.right + 1);
  });
  expect(noticeFits).toBe(true);
  await page.screenshot({ path: test.info().outputPath("barrel-import.png") });
  expect(errors).toEqual([]);
});

// ── Edit dialog: every viewport, every control reachable (review "Tool-Dialog") ──
for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: the tool edit dialog keeps labels, fields and footer usable`, async ({ page }, info) => {
    await ctlOp({ op: "reset" });
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(MOCK);
    await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled();
    if (viewport.touch) await page.evaluate(() => document.documentElement.classList.add("touch-device"));
    await page.getByRole("tab", { name: "Tools", exact: true }).click();
    await expect.poll(async () => {
      await publishToolTable([tool], MOCK);
      return page.getByTitle("Edit tool", { exact: true }).count();
    }).toBe(1);
    await page.getByTitle("Edit tool", { exact: true }).click();
    const dialog = page.locator(".editDialog");
    await expect(page.locator(".editPreviewCanvas canvas")).toBeVisible();
    await expectEditDialogGeometry(page);
    // Every native control (fields, select, toggle, footer) is inside the
    // dialog, unclipped, not overlapping; the footer is reachable by scroll.
    const footer = dialog.locator(".dialogActions");
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole("button", { name: "Save", exact: true })).toBeVisible();
    // The content scrolls inside the dialog (its height is the content
    // area's): measured at BOTH scroll ends, so every field is proven
    // unclipped and non-overlapping once it is in view.
    const content = dialog.locator(".dialogContent");
    await content.evaluate(el => { el.scrollTop = 0; });
    const snap = await measureLayout(dialog, `tool-edit-${viewport.name}`);
    await assertLayout(dialog, snap, info);
    await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await assertLayout(dialog, await measureLayout(dialog, `tool-edit-${viewport.name}-scrolled`), info);
    await content.evaluate(el => { el.scrollTop = 0; });
    await dialog.screenshot({ path: info.outputPath(`tool-edit-${viewport.name}.png`) });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}

// ── Save flow with request correlation (UI-12) ──
async function toolCmds(cmd: string): Promise<{ req_id?: string; [k: string]: unknown }[]> {
  const sent = await ctlOp({ op: "lastCmds" }) as { cmds?: { cmd?: string; req_id?: string }[] };
  return (sent.cmds ?? []).filter(c => c.cmd === cmd);
}

async function openAdd(page: Page) {
  await ctlOp({ op: "reset" });
  await page.goto(MOCK);
  await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled();
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect.poll(async () => {
    await publishToolTable([tool], MOCK);
    return page.getByTitle("Edit tool", { exact: true }).count();
  }).toBe(1);
  await ctlOp({ op: "clearCmds" });
  await clickMore(page.locator(".toolsHead"), "New");
  await expect(page.locator(".editDialog")).toBeVisible();
}

test("add: ok:false keeps the draft, a delayed ok closes, a double click sends once", async ({ page }) => {
  await openAdd(page);
  const dialog = page.locator(".editDialog");
  const desc = dialog.getByRole("textbox", { name: "Description", exact: true });
  await desc.fill("draft description");
  const add = dialog.getByRole("button", { name: "Add", exact: true });
  await add.click();
  // The second click of a double click: the button already reads "Saving…"
  // and is disabled — a forced click on the old name must not wait 30 s.
  await add.click({ force: true, timeout: 300 }).catch(() => {});
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await expect.poll(async () => (await toolCmds("add_tool")).length).toBe(1);
  const [sent] = await toolCmds("add_tool");
  expect(sent!.req_id).toMatch(/^[a-z0-9]+-\d+$/);
  // A reply for ANOTHER request (same cmd) changes nothing.
  await ctl({ type: "reply", cmd: "add_tool", req_id: "other-99", ok: true });
  await page.waitForTimeout(200);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeVisible();
  // Our ok:false: draft stays, reason shown, buttons live again.
  await ctl({ type: "reply", cmd: "add_tool", req_id: sent!.req_id, ok: false, error: "Tool number in use" });
  await expect(dialog.locator(".statusNote.error")).toContainText("Tool number in use");
  await expect(desc).toHaveValue("draft description");
  await expect(add).toBeEnabled();
  // Second attempt: a delayed ok closes the dialog.
  await add.click();
  await expect.poll(async () => (await toolCmds("add_tool")).length).toBe(2);
  const second = (await toolCmds("add_tool"))[1]!;
  await page.waitForTimeout(500);
  await expect(dialog).toBeVisible();
  await ctl({ type: "reply", cmd: "add_tool", req_id: second.req_id, ok: true });
  await expect(dialog).toHaveCount(0);
});

test("an old session's late reply never closes a newer dialog", async ({ page }) => {
  await openAdd(page);
  const dialog = page.locator(".editDialog");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(async () => (await toolCmds("add_tool")).length).toBe(1);
  const [first] = await toolCmds("add_tool");
  // Session A's reply is refused → A stays open; the operator cancels A …
  await ctl({ type: "reply", cmd: "add_tool", req_id: first!.req_id, ok: false, error: "refused" });
  await expect(dialog.locator(".statusNote.error")).toContainText("refused");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // … opens session B and sends it.
  await clickMore(page.locator(".toolsHead"), "New");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(async () => (await toolCmds("add_tool")).length).toBe(2);
  const second = (await toolCmds("add_tool"))[1]!;
  // A late ok for A arrives while B is pending: B stays pending.
  await ctl({ type: "reply", cmd: "add_tool", req_id: first!.req_id, ok: true });
  await page.waitForTimeout(200);
  await expect(dialog.getByRole("button", { name: "Saving…", exact: true })).toBeVisible();
  await ctl({ type: "reply", cmd: "add_tool", req_id: second.req_id, ok: true });
  await expect(dialog).toHaveCount(0);
});

test("disconnect while saving: outcome unknown, no blind resend, draft kept", async ({ page }) => {
  await openAdd(page);
  const dialog = page.locator(".editDialog");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();
  await expect.poll(async () => (await toolCmds("add_tool")).length).toBe(1);
  await ctlOp({ op: "shutdownClose" });
  await expect(dialog.locator(".statusNote.error")).toContainText("outcome unknown");
  await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  // The client reconnects on its own; nothing was re-sent meanwhile.
  await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled({ timeout: 15_000 });
  await page.waitForTimeout(500);
  expect((await toolCmds("add_tool")).length).toBeLessThanOrEqual(1);
});

test("delete waits for its own reply and shows a refusal in place", async ({ page }) => {
  await openAdd(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByTitle("Delete tool", { exact: true }).click();
  const dialog = page.locator(".dialog", { hasText: /^Delete T\d+\?/ });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Deleting…", exact: true })).toBeDisabled();
  await expect.poll(async () => (await toolCmds("delete_tool")).length).toBe(1);
  const [sent] = await toolCmds("delete_tool");
  await ctl({ type: "reply", cmd: "delete_tool", req_id: sent!.req_id, ok: false, error: "Tool is in the spindle" });
  await expect(dialog.locator(".statusNote.error")).toContainText("in the spindle");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(async () => (await toolCmds("delete_tool")).length).toBe(2);
  const second = (await toolCmds("delete_tool"))[1]!;
  await ctl({ type: "reply", cmd: "delete_tool", req_id: second.req_id, ok: true });
  await expect(dialog).toHaveCount(0);
});

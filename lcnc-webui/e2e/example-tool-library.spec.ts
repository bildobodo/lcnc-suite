import { test, expect, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { assertLayout, layoutChanges, measureLayout } from "./layout-audit";

const MOCK = process.env.TOOL_IMPORT_TEST_URL ?? "http://localhost:4174/";
const raw = readFileSync(new URL("../../examples/sim_config/tool-libraries/fusion-freecad.json", import.meta.url));
const tools = JSON.parse(execFileSync("python3", ["-c", `
import json
from pathlib import Path
from tool_import import decode_tool_blob, initial_z_offset
raw=Path('../examples/sim_config/tool-libraries/fusion-freecad.json').read_bytes()
tools,_=decode_tool_blob(raw,'mm')
print(json.dumps([dict(t,P=t['T'],Z=initial_z_offset(t)) for t in tools]))
`], { cwd: fileURLToPath(new URL("../../lcnc-gateway/", import.meta.url)), encoding: "utf8" })) as
  { T: number; D: number; Z: number; description: string }[];
const preview = { tools, total: 36, existing_count: 3, skipped_duplicates: [],
  metadata_refresh: { rows: [], updated: [], skipped: [], revision: "examples-review" } };

function sendFrame(frame: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(new URL("ctl", MOCK).href.replace(/^http/, "ws"));
    socket.once("open", () => socket.send(JSON.stringify({ op: "raw", frame })));
    socket.once("message", () => { socket.close(); resolve(); });
    socket.once("error", reject);
  });
}
const publishTable = () => sendFrame({ type: "reply", cmd: "get_tool_table", ok: true, tools });

async function expectUncovered(dialog: Locator) {
  // Panel-local geometry alone misses clipping/occlusion by an outer tab pane.
  for (const item of await dialog.locator('.dialogTitle, .dialogHeader button, .dialogActions button').all()) {
    expect(await item.evaluate(el => {
      const r = el.getBoundingClientRect();
      // Check the top and bottom too: a half-clipped title can still pass a
      // center-only hit test and Playwright's ordinary visibility check.
      return [r.top + 1, r.top + r.height / 2, r.bottom - 1].every(y =>
        el.contains(document.elementFromPoint(r.x + r.width / 2, y)));
    })).toBe(true);
  }
}

async function openTools(page: Page) {
  await page.goto(MOCK);
  await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect(page.getByRole("button", { name: "Examples", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import", exact: true })).toHaveCount(0);
}

async function serverFiles(page: Page) {
  await page.route("**/tool-library-files?*", route => {
    const subdir = new URL(route.request().url()).searchParams.get("subdir") ?? "";
    return route.fulfill({ json: { directory: "/server/nc_files", subdir,
      entries: subdir ? [{ name: "fusion-freecad.json", path: "cutters/fusion-freecad.json", type: "file", size: raw.length }]
        : [{ name: "cutters", path: "cutters", type: "directory" }] } });
  });
  await page.route("**/tool-library-file?*", route => route.fulfill({ body: raw, contentType: "application/json" }));
}

async function selectServerFile(page: Page) {
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  const browser = page.getByRole("region", { name: "Server tool libraries" });
  await expect(browser).toBeVisible();
  await expect(browser.getByRole("status")).toHaveCount(0);
  if (await browser.getByRole("button", { name: "cutters", exact: true }).count()) {
    await browser.getByRole("button", { name: "cutters", exact: true }).click();
  }
  await browser.getByRole("button", { name: "fusion-freecad.json", exact: true }).click();
}

async function selectClientFile(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await (await chooser).setFiles({ name: "my-tools.json", mimeType: "application/json", buffer: raw });
}

test("server library requires review and renders source shapes with nominal Z offsets", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  let previews = 0, applies = 0, downloads = 0;
  await serverFiles(page);
  page.on("request", request => { if (request.url().includes("/tool-library-file?")) downloads++; });
  await page.route("**/import-tool-library", route => {
    previews++;
    expect(route.request().postData()).toContain('"format":"lcnc-tool-library"');
    expect(route.request().postData()).toContain('"version":2');
    expect(route.request().postData()).toContain('"nr":2015');
    return route.fulfill({ json: preview });
  });
  await page.route("**/import-tool-library/apply", route => {
    applies++;
    return route.fulfill({ json: { ok: true, added: 36, skipped: 0 } });
  });
  await openTools(page);
  expect(downloads).toBe(0);
  await selectServerFile(page);
  await expect(page.getByText("Example Tool Library", { exact: true })).toBeVisible();
  await expect(page.getByText(/21 Fusion 360 and 15 FreeCAD examples/)).toBeVisible();
  await expect(page.getByLabel("Import mode")).toHaveValue("metadata");
  expect(previews).toBe(1); expect(applies).toBe(0); expect(downloads).toBe(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(applies).toBe(0);
  await selectServerFile(page);
  await page.getByLabel("Import mode").selectOption("replace");
  await expect(page.getByText(/Z offsets use nominal example lengths/)).toBeVisible();
  await expect(page.locator(".importRow")).toHaveCount(36);
  await expect(page.locator(".importRow").first()).toContainText("Z 50.00");
  await expectUncovered(page.locator('.importDialog'));
  await page.locator(".importDialog").screenshot({ path: test.info().outputPath("example-library-review.png") });
  await page.getByRole("button", { name: "Replace table", exact: true }).click();
  await expect(page.getByText(/Imported 36 tools. Z offsets initialized from nominal example lengths/)).toBeVisible();
  expect(applies).toBe(1);
  await expect.poll(async () => { await publishTable(); return page.getByTitle("Edit tool", { exact: true }).count(); }).toBe(36);
  await page.screenshot({ path: test.info().outputPath("example-tool-table.png") });
  for (const number of [1012, 1020, 2011, 2015]) {
    const tool = tools.find(t => t.T === number)!;
    const row = page.locator(".tableWrap tbody tr").filter({ hasText: tool.description });
    await row.getByTitle("Edit tool", { exact: true }).click();
    await expect(page.locator(".editPreviewCanvas canvas")).toBeVisible();
    await page.locator(".editDialog").screenshot({ path: test.info().outputPath(`example-T${number}.png`) });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  expect(errors).toEqual([]);
});

test("Upload opens the client picker directly without fetching server folders", async ({ page }) => {
  let applies = 0, listings = 0;
  await page.route("**/tool-library-files?*", route => { listings++; return route.fulfill({ status: 404 }); });
  await page.route("**/import-tool-library", route => {
    expect(route.request().postData()).toContain('filename="my-tools.json"');
    return route.fulfill({ json: preview });
  });
  await page.route("**/import-tool-library/apply", route => { applies++; return route.abort(); });
  await openTools(page);
  await selectClientFile(page);
  await expect(page.getByLabel("Import mode")).toHaveValue("metadata");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(applies).toBe(0);
  expect(listings).toBe(0);
});

test("preview errors survive table refresh and can be dismissed and retried", async ({ page }) => {
  let failing = true, applies = 0;
  await serverFiles(page);
  await page.route("**/import-tool-library", route => failing
    ? route.fulfill({ status: 400, json: { detail: "Library preview rejected" } })
    : route.fulfill({ json: preview }));
  await page.route("**/import-tool-library/apply", route => { applies++; return route.abort(); });
  await openTools(page);
  const error = page.getByRole("alert").filter({ hasText: "Library preview rejected" });
  await selectClientFile(page);
  await expect(error).toBeVisible();
  await sendFrame({ type: "tool_table_changed", version: 101 });
  await expect.poll(async () => { await publishTable(); return page.getByTitle("Edit tool", { exact: true }).count(); }).toBe(36);
  await expect(error).toBeVisible();
  await sendFrame({ type: "tool_table_changed", version: 1 });
  await expect.poll(async () => {
    await sendFrame({ type: "reply", cmd: "get_tool_table", ok: true, tools: tools.slice(1) });
    return page.getByTitle("Edit tool", { exact: true }).count();
  }).toBe(35);
  await expect(error).toBeVisible();
  await page.getByRole("button", { name: "Dismiss import error" }).click();
  await expect(error).toHaveCount(0);
  await selectClientFile(page);
  await expect(error).toBeVisible();
  failing = false;
  await selectClientFile(page);
  await expect(page.getByLabel("Import mode")).toHaveValue("metadata");
  await expect(error).toHaveCount(0);
  expect(applies).toBe(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("a slow server folder does not block client import or cancel", async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route("**/tool-library-files?*", async route => {
    await new Promise<void>(resolve => { release = resolve; });
    await route.fulfill({ json: { directory: "/server/tools", subdir: "", entries: [] } });
  });
  await page.route("**/import-tool-library", route => route.fulfill({ json: preview }));
  await openTools(page);
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  const dialog = page.getByRole("region", { name: "Server tool libraries" });
  await expect(dialog.getByRole("status")).toHaveText("Loading…");
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Hide Files", exact: true }).click();
  release?.();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Browse", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("Loading…");
  await selectClientFile(page);
  release?.();
  await expect(page.getByLabel("Import mode")).toHaveValue("metadata");
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

for (const viewport of [{ width: 1024, height: 768 }, { width: 900, height: 1200 }]) {
  test(`server browser navigation, download retry and layout ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await serverFiles(page);
    let failing = true;
    await page.route("**/tool-library-file?*", route => failing
      ? route.fulfill({ status: 403, json: { detail: "Permission denied" } })
      : route.fulfill({ body: raw }));
    await page.route("**/import-tool-library", route => route.fulfill({ json: preview }));
    await openTools(page);
    const actions = page.locator('.toolTabManage');
    const before = await measureLayout(actions, 'tool-file-actions');
    await page.getByRole("button", { name: "Browse", exact: true }).click();
    const dialog = page.getByRole("region", { name: "Server tool libraries" });
    await expect(dialog.locator(".browserPath")).toHaveText("/server/nc_files");
    await expect(dialog.getByRole("button", { name: "cutters", exact: true })).toBeVisible();
    await assertLayout(dialog, await measureLayout(dialog, "server-browser"), test.info());
    const after = await measureLayout(actions, 'tool-file-actions');
    await assertLayout(actions, after, test.info(), layoutChanges(before, after));
    // File access stays inline; the two toolbar actions remain reachable.
    await page.getByRole("button", { name: "Hide Files", exact: true }).click({ trial: true });
    await page.getByRole("button", { name: "Upload", exact: true }).click({ trial: true });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await dialog.screenshot({ path: test.info().outputPath("server-browser.png") });
    await page.locator('.toolsTab').screenshot({ path: test.info().outputPath('browse-upload-tools.png') });
    await dialog.getByRole("button", { name: "cutters", exact: true }).click();
    await expect(dialog.locator(".browserPath")).toHaveText("/server/nc_files/cutters");
    await dialog.getByRole("button", { name: "Parent folder", exact: true }).click();
    await dialog.getByRole("button", { name: "cutters", exact: true }).click();
    await dialog.getByRole("button", { name: "fusion-freecad.json", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Permission denied");
    await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
    failing = false;
    await dialog.getByRole("button", { name: "fusion-freecad.json", exact: true }).click();
    await expect(page.getByLabel("Import mode")).toHaveValue("metadata");
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  });
}

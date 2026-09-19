import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const MOCK = process.env.TOOL_IMPORT_TEST_URL ?? "http://localhost:4174/";
const tools = JSON.parse(execFileSync("python3", ["-c", `
import json
from pathlib import Path
from tool_import import decode_tool_blob
with Path('../lcnc-webui/public/examples/tools/fusion-freecad.json').open('rb') as f: raw=f.read()
tools,_=decode_tool_blob(raw,'mm')
print(json.dumps([dict(t,P=0,Z=0) for t in tools]))
`], { cwd: fileURLToPath(new URL("../../lcnc-gateway/", import.meta.url)), encoding: "utf8" })) as
  { T: number; D: number; Z: number; description: string }[];

function sendFrame(frame: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(new URL("ctl", MOCK).href.replace(/^http/, "ws"));
    socket.once("open", () => socket.send(JSON.stringify({ op: "raw", frame })));
    socket.once("message", () => { socket.close(); resolve(); });
    socket.once("error", reject);
  });
}

const publishTable = () => sendFrame({ type: "reply", cmd: "get_tool_table", ok: true, tools });

test("bundled examples load on demand, require review and render distinctive source shapes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  let previews = 0, applies = 0, downloads = 0;
  page.on("request", request => {
    if (request.url().endsWith("/examples/tools/fusion-freecad.json")) downloads++;
  });
  await page.route("**/import-tool-library", route => {
    previews++;
    // The real bundled asset is fetched from dist, then uploaded intact.
    const body = route.request().postData()!;
    expect(body).toContain('"format":"lcnc-tool-library"');
    expect(body).toContain('"nr":2015');
    return route.fulfill({ json: { tools, total: 36, existing_count: 3, skipped_duplicates: [],
      metadata_refresh: { rows: [], updated: [], skipped: [], revision: "examples-review" } } });
  });
  await page.route("**/import-tool-library/apply", route => {
    applies++;
    return route.fulfill({ json: { ok: true, added: 36, skipped: 0 } });
  });
  await page.goto(MOCK);
  await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  expect(downloads).toBe(0);
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  await expect(page.getByText("Example Tool Library", { exact: true })).toBeVisible();
  await expect(page.getByText(/21 Fusion 360 and 15 FreeCAD examples/)).toBeVisible();
  await expect(page.getByLabel("Import mode")).toHaveValue("metadata");
  expect(previews).toBe(1); expect(applies).toBe(0); expect(downloads).toBe(1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(applies).toBe(0);
  await page.getByRole("button", { name: "Examples", exact: true }).click();
  await page.getByLabel("Import mode").selectOption("replace");
  await expect(page.getByText(/Z offsets start at zero/)).toBeVisible();
  await expect(page.locator(".importRow")).toHaveCount(36);
  await page.locator(".importDialog").screenshot({ path: test.info().outputPath("example-library-review.png") });
  await page.getByRole("button", { name: "Replace table", exact: true }).click();
  await expect(page.getByText(/Imported 36 tools. Z offsets initialized to zero/)).toBeVisible();
  expect(applies).toBe(1);
  await expect.poll(async () => {
    await publishTable();
    return page.getByTitle("Edit tool", { exact: true }).count();
  }).toBe(36);
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

for (const failure of ['asset download', 'import preview']) {
  test(`${failure} errors survive table refresh, can be dismissed and retried`, async ({ page }) => {
    let failing = true, applies = 0;
    await page.route("**/examples/tools/fusion-freecad.json", route =>
      failing && failure === 'asset download' ? route.fulfill({ status: 404 }) : route.continue());
    await page.route("**/import-tool-library", route =>
      failing && failure === 'import preview'
        ? route.fulfill({ status: 400, json: { detail: 'Example preview rejected' } })
        : route.fulfill({ json: { tools, total: 36, existing_count: 3, skipped_duplicates: [],
          metadata_refresh: { rows: [], updated: [], skipped: [], revision: 'retry-review' } } }));
    await page.route("**/import-tool-library/apply", route => {
      applies++;
      return route.fulfill({ json: { ok: true, added: 36, skipped: 0 } });
    });
    await page.goto(MOCK);
    await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled();
    await page.getByRole("button", { name: "Tools", exact: true }).click();
    const button = page.getByRole("button", { name: "Examples", exact: true });
    const error = page.getByRole('alert').filter({ hasText: failure === 'asset download'
      ? 'Example library unavailable (HTTP 404)' : 'Example preview rejected' });
    await button.click();
    await expect(error).toBeVisible();
    await expect(button).toBeEnabled();
    await expect(page.locator(".importDialog")).toHaveCount(0);

    // Prove manual and gateway-triggered refreshes completed by rendering a
    // different table each time. No sleeps or retries masking the lost error.
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect.poll(async () => {
      await publishTable();
      return page.getByTitle('Edit tool', { exact: true }).count();
    }).toBe(36);
    await expect(error).toBeVisible();
    await sendFrame({ type: 'tool_table_changed', version: 1 });
    await expect.poll(async () => {
      await sendFrame({ type: 'reply', cmd: 'get_tool_table', ok: true, tools: tools.slice(1) });
      return page.getByTitle('Edit tool', { exact: true }).count();
    }).toBe(35);
    await expect(error).toBeVisible();

    await page.getByRole('button', { name: 'Dismiss import error' }).click();
    await expect(error).toHaveCount(0);
    await button.click();
    await expect(error).toBeVisible();
    failing = false;
    await button.click();
    await expect(page.getByText('Example Tool Library', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Import mode')).toHaveValue('metadata');
    await expect(error).toHaveCount(0);
    expect(applies).toBe(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });
}

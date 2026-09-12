import { test, expect, type Page } from "@playwright/test";

const MOCK = process.env.TOOL_IMPORT_TEST_URL ?? "http://localhost:4174/";
const upload = { name: "tools.json", mimeType: "application/json", buffer: Buffer.from('{"data":[]}') };
const row = { T: 1, type: "endmill", D: 6, current_diameter: 6, Z: -42.3,
  description: "Updated Fusion cutter", current_description: "Measured cutter", reason: null as string | null, match: "number" };

async function preview(page: Page, rows = [row], revision = "reviewed-revision") {
  await page.route("**/import-tool-library", route => route.fulfill({ json: {
    ok: true, tools: rows, total: rows.length, existing_count: 3, skipped_duplicates: [],
    metadata_refresh: { rows, updated: rows.filter(r => !r.reason).map(r => r.T),
      skipped: rows.filter(r => r.reason).map(r => r.T), revision },
  } }));
  await page.goto(MOCK);
  await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await page.locator('input[type="file"][accept=".json"]').setInputFiles(upload);
  await expect(page.getByText("Import Tool Library", { exact: true })).toBeVisible();
}

test("existing tools default to reviewed metadata refresh, not full replacement", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/import-tool-library/refresh", async route => {
    requests.push(route.request().url());
    expect(route.request().postData()).toContain("reviewed-revision");
    await route.fulfill({ json: { ok: true, updated: 1, skipped: 0 } });
  });
  await page.route("**/import-tool-library/apply", route => {
    requests.push("unexpected replacement");
    return route.abort();
  });
  await preview(page);
  await expect(page.getByLabel("Import mode")).toHaveValue("metadata");
  await expect(page.getByText("Measured cutter → Updated Fusion cutter")).toBeVisible();
  await expect(page.getByText(/keep Z -42.300/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("metadata-preview.png") });
  await page.getByRole("button", { name: "Update metadata", exact: true }).click();
  await expect(page.getByText(/Updated metadata for 1 tools/)).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]).toContain("/refresh");
});

test("full replacement requires selecting that mode and shows length replacement", async ({ page }) => {
  let applied = false;
  await page.route("**/import-tool-library/apply", route => {
    applied = true;
    return route.fulfill({ json: { ok: true, added: 1, skipped: 0 } });
  });
  await preview(page);
  await page.getByLabel("Import mode").selectOption("replace");
  await expect(page.getByText(/Z offsets will use Fusion gauge lengths/)).toBeVisible();
  await page.getByRole("button", { name: "Replace table", exact: true }).click();
  await expect(page.getByText(/Z offsets initialized from Fusion lengths/)).toBeVisible();
  expect(applied).toBe(true);
});

test("stale review stays visible as an error and never falls back to replacement", async ({ page }) => {
  let replacements = 0;
  await page.route("**/import-tool-library/refresh", route => route.fulfill({
    status: 409, json: { detail: "Tool data changed; preview the library again" },
  }));
  await page.route("**/import-tool-library/apply", route => { replacements++; return route.abort(); });
  await preview(page);
  await page.getByRole("button", { name: "Update metadata", exact: true }).click();
  await expect(page.getByText("Tool data changed; preview the library again")).toBeVisible();
  await expect(page.getByLabel("Import mode")).toHaveValue("metadata");
  expect(replacements).toBe(0);
  await page.getByRole("button", { name: "Preview again", exact: true }).click();
  await expect(page.getByText("Tool data changed; preview the library again")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Update metadata", exact: true })).toBeEnabled();
  expect(replacements).toBe(0);
});

test("an all-conflict preview cannot submit a metadata refresh", async ({ page }) => {
  await preview(page, [{ ...row, reason: "Diameter differs from current table" }]);
  await expect(page.getByText(/Skipped: Diameter differs from current table/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Update metadata", exact: true })).toBeDisabled();
});

import { test, expect, type Page } from "./test";
import { ctl, expectArmed, MOCK } from "./ctl";

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
  await expectArmed(page);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await page.locator('input[type="file"][accept*=".fctb"]').setInputFiles(upload);
  await expect(page.getByText("Import Fusion 360 Tool Library", { exact: true })).toBeVisible();
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
  // The result note's close X stays an icon at the note's right edge
  // (viewer contrast review round 4, VK-I03: a note rule written for "text
  // first" stretched it across the note — 504 px wide, the note 62 px high),
  // on a desktop and at 150 % portrait.
  const note = page.locator(".statusNote.ok");
  for (const [w, h, zoom] of [[1280, 720, 1], [900, 1200, 1.5]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate(z => { document.documentElement.style.zoom = z === 1 ? "" : String(z); }, zoom);
    const m = await note.evaluate(el => {
      const n = el.getBoundingClientRect(), b = el.querySelector('button[aria-label="Dismiss import result"]')!.getBoundingClientRect();
      return { note: [n.left, n.right, n.height], button: [b.left, b.right, b.width] };
    });
    const where = `${w} × ${h} at ${zoom * 100} % ${JSON.stringify(m)}`;
    expect(m.button[2], `${where}: the close X keeps its size`).toBeLessThanOrEqual(44 * zoom);
    expect(m.note[1] - m.button[1], `${where}: the close X at the note's right edge`).toBeLessThan(16 * zoom);
  }
  await page.evaluate(() => { document.documentElement.style.zoom = ""; });
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
  // WP6 (P1): replacing a table with existing tools asks first.
  const replaceConfirm = page.locator(".dialog", { hasText: "Replace entire tool table?" });
  await expect(replaceConfirm).toBeVisible();
  await replaceConfirm.getByRole("button", { name: "Replace table", exact: true }).click();
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

// Tool guard (Codex R476): an import that would shift a prepared tool, or
// whose line LinuxCNC would read as two, replaces nothing and says so in the
// dialog it began in.
for (const [status, why] of [[409, "A tool is prepared — change to another tool or send T0"],
  [400, "T1: line too long for LinuxCNC — shorten its description"]] as const) {
  test(`an import the tool guard refuses (${status}) stays in its dialog`, async ({ page }) => {
    let applied = 0;
    await page.route("**/import-tool-library/apply", route => {
      applied++;
      return route.fulfill(applied === 1 ? { status, json: { detail: why } } : { json: { ok: true, added: 1, skipped: 0 } });
    });
    await preview(page);
    await page.getByLabel("Import mode").selectOption("replace");
    const replace = async () => {
      await page.getByRole("button", { name: "Replace table", exact: true }).click();
      await page.locator(".dialog", { hasText: "Replace entire tool table?" }).getByRole("button", { name: "Replace table", exact: true }).click();
    };
    await replace();
    const dialog = page.locator(".dialog", { hasText: "Import Fusion 360 Tool Library" });
    await expect(dialog.getByText(why, { exact: true })).toBeVisible();
    await expect(page.locator(".toolsTab .statusNote.ok"), "nothing was imported").toHaveCount(0);
    await expect(page.getByLabel("Import mode")).toHaveValue("replace");
    await replace();                                        // the same file, once it is admitted
    await expect(page.locator(".toolsTab .statusNote.ok")).toContainText("Imported 1 tools.");
    expect(applied).toBe(2);
  });
}

// Codex R471 MT-I41 / MT-I42: the import's `ok` means the table is replaced;
// its reply names what came of the load into LinuxCNC and of the metadata.
test("an import whose load or metadata did not happen says so beside its result", async ({ page }) => {
  await page.route("**/import-tool-library/apply", route => route.fulfill({ json: {
    ok: true, added: 1, skipped: 0, reload: "reload not sent", metadata: "not saved" } }));
  await ctl({ op: "replyFor", cmd: "get_tool_table", reply: { ok: true, tools: [{ T: 1, P: 1, D: 6, Z: 0, type: "", description: "imported" }] } });
  await preview(page);
  await page.getByLabel("Import mode").selectOption("replace");
  await page.getByRole("button", { name: "Replace table", exact: true }).click();
  await page.locator(".dialog", { hasText: "Replace entire tool table?" }).getByRole("button", { name: "Replace table", exact: true }).click();
  await expect(page.locator(".toolsTab .statusNote.ok")).toContainText("Imported 1 tools.");
  // (the way out follows the read on screen, TF-2: a file LinuxCNC may be asked to load)
  await expect(page.locator(".toolsTab [data-write-state] > span")).toHaveText(
    "Table saved, metadata not — check tool_library.json; load into LinuxCNC failed — load table or restart.");
  await page.screenshot({ path: test.info().outputPath("import-not-loaded.png") });
});

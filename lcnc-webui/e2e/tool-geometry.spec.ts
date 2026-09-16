import { test, expect } from "@playwright/test";
import WebSocket from "ws";

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
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect.poll(async () => {
    await ctl({ type: "reply", cmd: "get_tool_table", ok: true, tools: [tool] });
    return page.getByTitle("Edit tool", { exact: true }).count();
  }).toBe(1);
  const row = page.locator("tbody tr").filter({ hasText: tool.description });
  await expect(row).toContainText("Circle Segment Barrel");
  await expect(row).toContainText("Approximate preview");
  await expect(row).toContainText("-42.300000");
  await page.getByTitle("Edit tool", { exact: true }).click();
  await expect(page.locator(".editPreviewCanvas canvas")).toBeVisible();
  await expect(page.getByText(notice, { exact: true })).toBeVisible();
  const fields = await page.locator(".editFields").boundingBox();
  const preview = await page.locator(".editPreviewCol").boundingBox();
  expect(fields!.x + fields!.width).toBeLessThanOrEqual(preview!.x);
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

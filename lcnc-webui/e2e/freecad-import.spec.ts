import { test, expect } from "@playwright/test";
import WebSocket from "ws";
import { readFileSync } from "node:fs";
const bundle = JSON.parse(readFileSync(new URL("../../test-fixtures/freecad/custom-native.json", import.meta.url), "utf8"));

const MOCK = process.env.TOOL_IMPORT_TEST_URL ?? "http://localhost:4174/";
const geometry = bundle.tools[0]!.geometry;
const tool = { T: 19, P: 7, D: 10, Z: -42.3, type: "formmill", source_format: "freecad",
  description: "FreeCAD tool with bore", native_mesh: geometry.mesh, source_z_min: -4, oal: 30 };
function ctl(frame: Record<string, unknown>, op = "raw", meta?: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(new URL("ctl", MOCK).href.replace(/^http/, "ws"));
    socket.once("open", () => socket.send(JSON.stringify(op === "raw" ? { op, frame } : { op, data: frame, tool_meta: meta })));
    socket.once("message", () => { socket.close(); resolve(); });
    socket.once("error", reject);
  });
}

test("FreeCAD preview retains measured offsets, renders a custom shape, and explains new lengths", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(MOCK);
  await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect.poll(async () => {
    await ctl({ type: "reply", cmd: "get_tool_table", ok: true, tools: [tool] });
    return page.getByTitle("Edit tool", { exact: true }).count();
  }).toBe(1);
  await page.getByTitle("Edit tool", { exact: true }).click();
  await expect(page.locator(".editPreviewCanvas canvas")).toBeVisible();
  await expect(page.getByText(/Native CAM origin differs/)).toBeVisible();
  await page.locator(".editDialog").screenshot({ path: test.info().outputPath("freecad-custom-tool.png") });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const pose = { tool_number: 19, tool_diameter: 10, tool_length: 42.3,
    joint_pos: [0, 0, 0], tool_offset: [0, 0, -42.3] };
  await ctl(pose, "status_delta", { type: "endmill", oal: 30, flute_length: 15 });
  // Let the pose change allocate the backplot line before counting meshes.
  let countBefore = -1;
  await expect.poll(async () => {
    const count = await page.evaluate(() => window.__viewerLeakProbe?.()?.geometries ?? 0);
    const stable = count > 0 && count === countBefore;
    countBefore = count;
    return stable;
  }, { intervals: [250] }).toBe(true);
  await ctl(pose, "status_delta", tool);
  // The default marker has cutter + shaft. The native body replaces both with
  // exactly one evaluated mesh in the live view, as in the table preview.
  await expect.poll(() => page.evaluate(() => window.__viewerLeakProbe?.()?.geometries ?? 0)).toBe(countBefore - 1);
  await page.screenshot({ path: test.info().outputPath("freecad-live-tool.png") });
  await page.route("**/import-tool-library", route => route.fulfill({ json: {
    tools: [tool], total: 1, existing_count: 1, skipped_duplicates: [],
    metadata_refresh: { rows: [{ ...tool, current_description: "Measured tool", current_diameter: 10, reason: null }],
      updated: [19], skipped: [], revision: "freecad-review" },
  } }));
  await page.locator('input[type="file"][accept*=".fctb"]').setInputFiles({
    name: "freecad.lcnc-tools.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bundle)),
  });
  await expect(page.getByText("Import FreeCAD Tool Library", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Import mode")).toHaveValue("metadata");
  await expect(page.getByText(/keep Z -42.300/)).toBeVisible();
  await page.getByLabel("Import mode").selectOption("replace");
  await expect(page.getByText(/Z offsets start at zero/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("freecad-import.png") });
  let reviewed = false;
  await page.route("**/import-tool-library/refresh", route => {
    reviewed = route.request().postData()!.includes("freecad-review");
    return route.fulfill({ json: { ok: true, updated: 1, skipped: 0 } });
  });
  await page.getByLabel("Import mode").selectOption("metadata");
  await page.getByRole("button", { name: "Update metadata", exact: true }).click();
  await expect(page.getByText(/Updated metadata for 1 tools/)).toBeVisible();
  expect(reviewed).toBe(true);
  expect(errors).toEqual([]);
});

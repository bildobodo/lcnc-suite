import { test, expect, type Page } from "@playwright/test";
import WebSocket from "ws";

const MOCK = process.env.TOOL_IMPORT_TEST_URL ?? "http://localhost:4174/";
const controlUrl = new URL("ctl", MOCK).href.replace(/^http/, "ws");
function ctl(op: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(controlUrl);
    socket.once("open", () => socket.send(JSON.stringify(op)));
    socket.once("message", data => {
      socket.close();
      const reply = JSON.parse(String(data));
      if (reply.ok) resolve(); else reject(new Error(reply.error));
    });
    socket.once("error", reject);
  });
}

const tool = { T: 300, P: 7, Z: -42.3, D: 10, type: "endmill", description: "Holder reference",
  oal: 70, flute_length: 15, shoulder_length: 15, body_length: 30, shaft_diameter: 10,
  holder_gauge_length: 50, assembly_gauge_length: 80, holder: "Reference holder",
  holder_segments: [
    { height: 10, lower_diameter: 20, upper_diameter: 30 },
    { height: 20, lower_diameter: 30, upper_diameter: 30 },
    { height: 20, lower_diameter: 24, upper_diameter: 12 },
  ] };

async function openTool(page: Page, row: typeof tool) {
  await page.goto(MOCK);
  await expect(page.locator('fieldset[data-gate="armed"]').first()).not.toBeDisabled();
  await page.getByRole("button", { name: "Tools", exact: true }).click();
  await expect.poll(async () => {
    await ctl({ op: "raw", frame: { type: "reply", cmd: "get_tool_table", ok: true, tools: [row] } });
    return page.getByTitle("Edit tool", { exact: true }).count();
  }).toBe(1);
  await page.getByTitle("Edit tool", { exact: true }).click();
  await expect(page.locator(".editPreviewCanvas canvas")).toBeVisible();
}

async function geometryCount(page: Page) {
  let previous = -1;
  await expect.poll(async () => {
    const count = await page.evaluate(() => window.__viewerLeakProbe?.()?.geometries ?? -1);
    const stable = count >= 0 && count === previous;
    previous = count;
    return stable;
  }, { intervals: [250] }).toBe(true);
  return previous;
}

test.beforeEach(async () => { await ctl({ op: "reset" }); });

test("holder is opt-in in the library preview and never auto-attached to the live tool", async ({ page }) => {
  await openTool(page, tool);
  const toggle = page.getByRole("checkbox", { name: "Show Fusion holder" });
  await expect(toggle).not.toBeChecked();
  await expect(page.getByText("Tool only", { exact: true })).toBeVisible();
  const canvas = page.locator(".editPreviewCanvas canvas");
  const before = await canvas.screenshot();
  await toggle.check();
  await expect(page.getByText("Nominal Fusion assembly", { exact: true })).toBeVisible();
  const withHolder = await canvas.screenshot();
  expect(withHolder.equals(before)).toBe(false);
  await page.locator(".editDialog").screenshot({ path: test.info().outputPath("nominal-holder.png") });
  await toggle.uncheck();
  expect((await canvas.screenshot()).equals(before)).toBe(true);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByTitle("Edit tool", { exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const status = { tool_number: 300, tool_diameter: 10, tool_length: 42.3,
    joint_pos: [0, 0, 0], tool_offset: [0, 0, -42.3] };
  await ctl({ op: "status_delta", data: status, tool_meta: { ...tool, holder_segments: [] } });
  const bareCount = await geometryCount(page);
  await ctl({ op: "status_delta", data: status, tool_meta: tool });
  expect(await geometryCount(page)).toBe(bareCount);
  await expect(page.locator("tbody tr").filter({ hasText: "Holder reference" })).toContainText("-42.300000");
});

test("a tool-only export offers no holder toggle", async ({ page }) => {
  await openTool(page, { ...tool, holder_segments: [] });
  await expect(page.getByRole("checkbox", { name: "Show Fusion holder" })).toHaveCount(0);
  await expect(page.getByText("Tool only", { exact: true })).toBeVisible();
});

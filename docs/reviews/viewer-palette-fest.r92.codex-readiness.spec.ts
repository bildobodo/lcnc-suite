import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { openSimTab, simLine, simShow, simStepBtn } from "./simTab";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// COLLISION jumps on the real 5-axis model (examples/sim_config/machine-
// 5axis-xyzac, the XYZAC config's own machine.json and STLs): the sweep runs
// in the browser worker against the real bodies — the program's sweep on
// load, the entry move's own side sweep once a jump enters the simulation.
const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));

async function prepare(page: Page, context: BrowserContext, o: {
  file: string; version: number; feed: number[][]; lines: number[]; joints: number[]; extra?: Record<string, unknown>;
}) {
  const preview = Buffer.from(encode({ file: o.file, preview_schema: 10, feed: o.feed,
    feed_lines: o.lines, feed_seq: o.lines.map((_, i) => i + 1), feed_outside: new Uint8Array(o.feed.length), rapid: [],
    violations: [], violations_total: 0, ...o.extra }));
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 10 }, (_, i) => `G1 X${i} F100`).join("\n") }));
  await context.route("**/xyzac-model/*.stl", async r => { await new Promise(resolve=>setTimeout(resolve,1500)); await r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }); });
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await ctl({ op: "status_delta", data: { active_file: o.file, joint_pos: o.joints, actual_position: o.joints,
    g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    rotation_xy: 0, is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: o.version, file: o.file } });
  // The findings live in the side pane's Simulation tab, its list on the collisions.
  await simShow(page, "clash");
}

test("original guard with delayed model loading", async ({ page, context }) => {
  test.setTimeout(120_000);
  await prepare(page, context, { file: "/ustart.ngc", version: 2310, lines: [1, 2, 6], joints: [-100, 0, 0, 0, 0],
    feed: [[0, 0, -100], [0, 0, -150], [20, 0, -150]],
    extra: { feed_seq: [1, 2, 4], rapid: [[10, 0, -150]], rapid_lines: [4], rapid_seq: [3],
             rapid_outside: new Uint8Array(1), rapid_ustart: new Uint8Array([1]) } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getCollisionSummary!()?.uncertified ?? null),
                    { timeout: 60_000 })
    .toBe("1 move after a tool change start where the preview cannot know — checked at the end only (L4)");
  await openSimTab(page);
  const item = page.locator(".simPanel .simSummary .sumItem").first();
  await expect(item.locator('span[title^="Not certified"]'), "the marker").toHaveCount(1);
  await page.getByRole("button", { name: "Help: Collision check", exact: true }).click();
  await expect(page.locator(".helpPopover:popover-open")).toContainText("after a tool change start where the preview cannot know");
  await page.keyboard.press("Tab");   // light dismiss without Escape (E-Stop)
  await ctl({ op: "reset" });
});

test("guard waits for the seam with delayed model loading", async ({ page, context }) => {
  test.setTimeout(120_000);
  await prepare(page, context, { file: "/ustart.ngc", version: 2310, lines: [1, 2, 6], joints: [-100, 0, 0, 0, 0],
    feed: [[0, 0, -100], [0, 0, -150], [20, 0, -150]],
    extra: { feed_seq: [1, 2, 4], rapid: [[10, 0, -150]], rapid_lines: [4], rapid_seq: [3],
             rapid_outside: new Uint8Array(1), rapid_ustart: new Uint8Array([1]) } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getCollisionSummary?.()?.uncertified ?? null),
                    { timeout: 60_000 })
    .toBe("1 move after a tool change start where the preview cannot know — checked at the end only (L4)");
  await openSimTab(page);
  const item = page.locator(".simPanel .simSummary .sumItem").first();
  await expect(item.locator('span[title^="Not certified"]'), "the marker").toHaveCount(1);
  await page.getByRole("button", { name: "Help: Collision check", exact: true }).click();
  await expect(page.locator(".helpPopover:popover-open")).toContainText("after a tool change start where the preview cannot know");
  await page.keyboard.press("Tab");   // light dismiss without Escape (E-Stop)
  await ctl({ op: "reset" });
});

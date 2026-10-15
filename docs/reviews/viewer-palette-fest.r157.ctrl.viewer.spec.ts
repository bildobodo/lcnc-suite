// CONTROL (not committed): a program change with no contact tables shown — are its long tasks the list's?
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { simShow } from "./simTab";
const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));
test("control: a new program with nothing shown", async ({ page, context }) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    const w = window as any; w.__lt = [];
    new PerformanceObserver(l => { for (const e of l.getEntries()) w.__lt.push(Math.round(e.duration)); }).observe({ type: "longtask", buffered: true });
  });
  const feed = [[0, 0, -100], [10, 0, -100]];
  const preview = Buffer.from(encode({ file: "/lt.ngc", preview_schema: 11, feed, feed_lines: [1, 2], feed_seq: [1, 2], feed_outside: new Uint8Array(2), rapid: [], violations: [], violations_total: 0 }));
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: "G1 X0 F100\nG1 X10" }));
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream", body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"], parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics, workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await ctl({ op: "status_delta", data: { active_file: "/lt.ngc", joint_pos: [-100, 0, -100, 0, 0], actual_position: [-100, 0, -100, 0, 0], g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], rotation_xy: 0, is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4401, file: "/lt.ngc" } });
  await simShow(page, "clash");
  await page.waitForTimeout(8000);
  for (let k = 0; k < 3; k++) {
    await page.evaluate(() => { (window as any).__lt = []; });
    await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4402 + k, file: "/lt.ngc" } });
    await page.waitForTimeout(3000);
    console.log(`[control] program change ${k}: long tasks ${JSON.stringify(await page.evaluate(() => (window as any).__lt))}`);
  }
  await ctl({ op: "reset" });
});

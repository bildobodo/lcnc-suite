import { test, expect } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// A COLLISION jump on the real 5-axis model (examples/sim_config/machine-
// 5axis-xyzac, the XYZAC config's own machine.json and STLs): the sweep runs
// in the browser worker against the real bodies; L7 traverses the spindle
// nose at Z −380 sideways into the A yoke's wall (top −350) — inside the
// soft limits, clear at rest and at the first pose. The machine stands at
// X −100, so the first jump builds the simulation's entry move in front of
// the program and must still land on the collision's line and show its move
// (Codex R32 VP-I05 for collision targets). The toolpath layer is off: the
// finding's section is all the path the viewer draws.
const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));

// p0 (0,0,−100) → L6 plunge (0,0,−380) → L7 along X to (240,0,−380) → L8 up
const FEED = [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]];
const PREVIEW = Buffer.from(encode({ file: "/crash.ngc", preview_schema: 9, feed: FEED,
  feed_lines: [1, 6, 7, 8], feed_seq: [1, 2, 3, 4], feed_outside: new Uint8Array(4), rapid: [],
  violations: [], violations_total: 0 }));

test("a collision jump on the real XYZAC model lands on its line and shows its move — across the entry move", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 10 }, (_, i) => `G1 X${i} F100`).join("\n") }));
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await ctl({ op: "status_delta", data: { active_file: "/crash.ngc", joint_pos: [-100, 0, 0, 0, 0], actual_position: [-100, 0, 0, 0, 0],
    g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    rotation_xy: 0, is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 2200, file: "/crash.ngc" } });
  // The sweep runs on load (the base track): one collision, on L7.
  const next = page.locator('.scrubBar [aria-label="Next collision"]');
  await expect(next, "the sweep finds the nose in the yoke").toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".scrubBar .navTarget").last()).toContainText("L7");
  await page.evaluate(() => window.__viewerDiag!.setViewDirection!([0, 0, 1]));
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { toolpath: false, rapids: false } } } } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.projectRole!("feed"))).toBeNull();

  await next.click();
  await expect(page.locator(".simBanner")).toBeVisible();
  await expect(page.locator(".scrubBar .lineSlot"), "the FIRST click lands on the collision's line").toHaveText(/^L7\b/);
  await expect(page.locator("[data-path-reveal]")).toHaveText("Toolpath shown for this finding — hidden in Layers");
  const move = (await page.evaluate(() => window.__viewerDiag!.projectRole!("feed")))!;
  expect(move, "the collision's move is shown").not.toBeNull();
  // L7 runs along X; the plunge (L6) and the retract (L8) are along Z — a
  // point in the top view
  expect(Math.abs(move.dx), "L7's own move, along X").toBeGreaterThan(0.95);
  await ctl({ op: "reset" });
});

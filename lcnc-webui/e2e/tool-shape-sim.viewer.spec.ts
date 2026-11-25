// Bell 1 of P6-c (plan v8 §5.3, Codex R480/R482): infrastructure under today's
// cylinder contract. While scrubbing, the simulation's tool marker of a tool
// never loaded in this session is the table's cylinder, and the check poses the
// table's cylinder — although the page holds that tool's library shape now. No
// library shape is SHOWN before its sweep CHECKS it: the first commit that
// draws one here (bell 2) is the one that gives the check its body, and turns
// this spec's expectation over. A tool that was loaded once in the session
// draws from the session cache, as before (the control — it proves the reader
// sees a shape).
//
// What is read: the SCENE — three's own devtools seam announces every Scene,
// the marker is the group holding the mesh with `userData.toolVis` — and the
// collision worker's REQUEST, recorded as it is posted.
import { test, expect, type Page, type BrowserContext } from "./test";
import { encode } from "@msgpack/msgpack";
import { ctl, publishToolTable } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { fulfillPreview, publishFile, routeText } from "./programFixture";

const T13_META = { type: "tapered", fusion_type: "tapered mill", taper_angle: 3.7, corner_radius: 1, flute_length: 47,
  shoulder_length: 50, shoulder_diameter: 5.8, shaft_diameter: 8, oal: 100 };
const L13 = 63.19, D13 = 1.875;
const TOOLS = [
  { T: 1, P: 1, Z: 50, D: 6, remark: "", description: "6 mm end mill", type: "endmill", flute_length: 20, shaft_diameter: 6, oal: 60 },
  { T: 13, P: 13, Z: L13, D: D13, remark: "", description: "Inlay cutter", ...T13_META },
];
const nine = (xyz: number[]) => [...xyz, 0, 0, 0, 0, 0, 0];

/** The marker the scene draws now: its largest radius and its height. */
async function marker(page: Page) {
  return page.evaluate(() => {
    let vis: any = null;
    for (const s of (window as any).__p6Scenes ?? []) s.traverse((o: any) => { if (!vis && o.isMesh && o.userData?.toolVis) vis = o; });
    if (!vis) return null;
    let maxR = 0, zMax = -Infinity;
    for (const m of vis.parent.children) {
      if (!m.isMesh) continue;
      const p = m.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) { maxR = Math.max(maxR, Math.hypot(p.getX(i), p.getY(i))); zMax = Math.max(zMax, p.getZ(i)); }
    }
    return { r: vis.userData.toolVis.r as number, maxR, zMax };
  });
}
/** The tool bodies of the collision checks posted so far. */
const bodies = (page: Page) => page.evaluate(() => (window as any).__p6Checks as Array<{ tool: any; toolDims: any }>);

async function setup(page: Page, context: BrowserContext) {
  await page.addInitScript(() => {
    const w = window as any;
    w.__p6Scenes = [];
    w.__p6Checks = [];
    const t = new EventTarget();
    t.addEventListener("observe", (e: any) => { if (e.detail?.isScene) w.__p6Scenes.push(e.detail); });
    w.__THREE_DEVTOOLS__ = t;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, m: any, ...rest: any[]) {
      if (m && m.track && m.options && "tool" in m) w.__p6Checks.push(JSON.parse(JSON.stringify({ tool: m.tool, toolDims: m.options.toolDims ?? null })));
      return (post as any).call(this, m, ...rest);
    } as any;
  });
  const file = "/p6c-tapered.ngc";
  const text = "G0 X0 Y0 Z20\nT13 M6\nG43 H13\nG0 X0 Y0 Z15\nG1 Z-5 F500\nG1 X40\nG1 Y30\nG0 Z20\nM2\n";
  const raw = {
    file, preview_schema: 11,
    rapid: [[0, 0, 20], [0, 0, 15], [40, 30, 20]], rapid_seq: [1, 4, 8], rapid_lines: [1, 4, 8],
    feed: [[0, 0, -5], [40, 0, -5], [40, 30, -5]], feed_seq: [5, 6, 7], feed_lines: [5, 6, 7],
    feed_outside: new Uint8Array(3), rapid_outside: new Uint8Array(3), violations: [], violations_total: 0,
    tlo_events: [[3, 0, 0, L13, 13]], parse_tlos: [[1, 0, 0, 50, 6], [13, 0, 0, L13, D13]],
    start_known: true, tlo_start: [0, 0, 50],
  };
  await context.route(/\/preview(\?|$)/, r => fulfillPreview(r, { contentType: "application/octet-stream", body: Buffer.from(encode(raw)) }));
  await routeText(context, text);
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === "desktop")!);
  // a head moving in X, Y, Z over a fixed table, no meshes
  await ctl({ op: "setViewerInit", data: { units: "mm", axes: ["X", "Y", "Z"], parts: [],
    groups: [{ id: "table", parent: "root" }, { id: "head", parent: "root" }],
    kinematics: [{ group: "head", joint: 0, direction: "x", sign: 1 }, { group: "head", joint: 1, direction: "y", sign: 1 },
                 { group: "head", joint: 2, direction: "z", sign: 1 }],
    workGroup: "table", toolGroup: "head" } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.ready ?? false), { timeout: 20_000 }).toBe(true);
  await publishToolTable(TOOLS);
  return file;
}
async function load(tool: 1 | 13) {
  const t = TOOLS.find(x => x.T === tool)!;
  await ctl({ op: "status_delta", data: { joint_pos: [0, 0, 70], actual_position: [0, 0, 70], g5x_index: 1, g5x_offset: nine([0, 0, 0]),
    g92_offset: nine([0, 0, 0]), tool_offset: nine([0, 0, t.Z]), rotation_xy: 0, tool_number: tool, tool_length: t.Z, tool_diameter: t.D,
    tool_table_z: t.Z, is_enabled: false, enabled: false },
    tool_meta: tool === 13 ? T13_META : { type: "endmill", flute_length: 20, shaft_diameter: 6, oal: 60 } } as any);
}
async function scrubToT13(page: Page, file: string) {
  await load(1);
  await ctl({ op: "status_delta", data: { active_file: file } });
  await publishFile(file, 9801);
  await expect(page.locator(".scrubBar")).toBeVisible({ timeout: 15_000 });
  await page.locator(".scrubBar").getByRole("checkbox", { name: "Sim" }).check();
  await expect(page.locator(".simBanner")).toBeVisible();
  await page.locator(".scrubBar .sliderInput").evaluate((el: HTMLInputElement) => {
    el.step = "any"; el.value = String(Number(el.max) * 0.75); el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getScrubPose?.()?.tool ?? null)).toBe(13);
  await expect.poll(async () => (await marker(page))?.r ?? null).toBeCloseTo(D13 / 2, 4);
}

test("a tool never loaded: today's cylinder is drawn and is what the check poses", async ({ page, context }) => {
  test.setTimeout(90_000);
  const file = await setup(page, context);
  await page.getByRole("tab", { name: "Tools", exact: true }).click();
  await expect(page.locator(".toolsTab")).toContainText("Inlay cutter");       // the page has its library entry
  await scrubToT13(page, file);
  const m = (await marker(page))!;
  expect([m.maxR, m.zMax].map(x => Math.round(x * 1000) / 1000)).toEqual([0.938, 83.19]);
  await expect.poll(async () => (await bodies(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  for (const b of await bodies(page)) {
    expect(b.toolDims).toEqual({ 13: { diam: D13, len: L13 + 20 } });
    expect(Object.keys(b.tool).sort()).toEqual(["diam", "len"]);
  }
  await ctl({ op: "reset" });
});

test("control: the same tool loaded once before draws from the session cache (the reader sees a shape)", async ({ page, context }) => {
  test.setTimeout(90_000);
  const file = await setup(page, context);
  await load(13);
  await expect.poll(async () => (await marker(page))?.maxR ?? null).toBeCloseTo(4, 2);
  await scrubToT13(page, file);
  const m = (await marker(page))!;
  expect([m.maxR, m.zMax].map(x => Math.round(x * 100) / 100)).toEqual([4, 100]);
  await ctl({ op: "reset" });
});

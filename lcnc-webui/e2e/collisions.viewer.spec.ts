import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
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
  const preview = Buffer.from(encode({ file: o.file, preview_schema: 9, feed: o.feed,
    feed_lines: o.lines, feed_seq: o.lines.map((_, i) => i + 1), feed_outside: new Uint8Array(o.feed.length), rapid: [],
    violations: [], violations_total: 0, ...o.extra }));
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: preview }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 10 }, (_, i) => `G1 X${i} F100`).join("\n") }));
  await context.route("**/xyzac-model/*.stl", r => r.fulfill({ contentType: "application/octet-stream",
    body: readFileSync(new URL(new URL(r.request().url()).pathname.split("/").pop()!, MODEL)) }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "setViewerInit", data: { units: "mm", stl_base_url: "/xyzac-model/", axes: ["X", "Y", "Z", "A", "C"],
    parts: machine.parts, groups: machine.groups, kinematics: machine.kinematics,
    workGroup: machine.workGroup, toolGroup: machine.toolGroup } });
  await ctl({ op: "status_delta", data: { active_file: o.file, joint_pos: o.joints, actual_position: o.joints,
    g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], tool_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    rotation_xy: 0, is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: o.version, file: o.file } });
}
const nextHit = (page: Page) => page.locator('.scrubBar [aria-label="Next collision"]');
const slider = (page: Page) => page.locator(".scrubBar .sliderInput");
const at = async (page: Page) => Number(await slider(page).inputValue());
/** The collision count the findings button reads ("9 collisions"). */
const hitCount = async (page: Page) => Number((await page.locator(".scrubBar").innerText()).match(/(\d+) collisions?/)?.[1] ?? 0);
/** The sweep has ended: the findings show from the live partial on ("… so far"). */
const sweepDone = async (page: Page) => !/so far/.test(await page.locator(".scrubBar").innerText());

// L7 traverses the spindle nose at Z −380 sideways into the A yoke's wall
// (top −350) — inside the soft limits, clear at rest and at the first pose.
// The machine stands at X −100, so the first jump builds the simulation's
// entry move in front of the program and must still land on the collision's
// line and show its move (Codex R32 VP-I05 for collision targets). The
// toolpath layer is off: the finding's section is all the path drawn.
test("a collision jump on the real XYZAC model lands on its line and shows its move — across the entry move", async ({ page, context }) => {
  test.setTimeout(120_000);
  // p0 (0,0,−100) → L6 plunge (0,0,−380) → L7 along X to (240,0,−380) → L8 up
  await prepare(page, context, { file: "/crash.ngc", version: 2200, lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
    feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]] });
  // The sweep runs on load (the base track): one collision, on L7.
  const next = nextHit(page);
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

// Codex R33's XYZAC probes: the machine stands at X 300 with the nose at
// Z −380 already INSIDE the yoke — the live pose touches it with several
// pairs. The entry move (300 mm back to the first point) leaves them; the
// program then runs L7 back into the yoke, L8 lifts out. The entry move ends
// at the first point and carries L7, so the entry side sweep's contacts sit
// on the program's own line and pairs (VP-I07), all at the same spot.
const IN_THE_YOKE = { lines: [7, 7, 8], joints: [300, 0, -380, 0, 0],
  feed: [[0, 0, -380], [240, 0, -380], [240, 0, -100]] };

test("entry-move and program contacts on the same line and pairs stay apart: a chosen program contact survives the entry result, next reaches every contact once (Codex R33 VP-I07)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await prepare(page, context, { file: "/entry-repeat.ngc", version: 3301, ...IN_THE_YOKE });
  const next = nextHit(page);
  await expect(next, "the program's sweep finds the nose and the tool in the yoke").toBeVisible({ timeout: 60_000 });
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  const programHits = await hitCount(page);
  expect(programHits).toBe(2);
  // Outside the simulation on the program alone: the nose's contact on L7.
  // The jump enters the simulation and the entry move (300 mm) goes in front.
  await next.click();
  await expect(page.locator(".simBanner")).toBeVisible();
  const nose = await at(page);
  expect(nose, "the nose's contact, behind the 300 mm entry move").toBeGreaterThan(400);
  // The entry move's own contacts arrive (the side sweep): more findings,
  // counted once the number holds across two reads
  let total = 0;
  await expect.poll(async () => {
    const n = await hitCount(page);
    const settled = n > programHits && n === total && await sweepDone(page);
    total = n;
    return settled;
  }, { timeout: 60_000, intervals: [500] }).toBe(true);
  expect(await at(page), "the chosen contact stays where it was shown").toBe(nose);
  // Next from the chosen program contact is the program's NEXT one (the tool
  // on L7) — not an entry contact that shares its line and pair
  await next.click();
  const tool = await at(page);
  expect(tool, "next after the nose: the tool's later contact").toBeGreaterThan(nose);
  // Around once: every contact exactly once, back at the tool's
  const seen: number[] = [];
  for (let i = 0; i < total; i++) { await next.click(); seen.push(await at(page)); }
  expect(seen[total - 1], "a full round ends where it began").toBe(tool);
  expect(seen.filter(p => p === nose), "the nose's program contact once").toHaveLength(1);
  expect(seen.filter(p => p === tool), "the tool's program contact once").toHaveLength(1);
  expect(seen.filter(p => p < 1), "the entry move's contacts, at the live pose").toHaveLength(total - 2);
  await ctl({ op: "reset" });
});

test("a manual move away and back ends the shown contact for good: next goes by position (Codex R33 VP-I08)", async ({ page, context }) => {
  test.setTimeout(120_000);
  // The time axis (seconds): the program's two moves take 0.5 s each, the
  // 300 mm entry rapid at 300 mm/s 1 s — the slider's step is 1 ms, exactly
  // a jump's nudge into a contact.
  await prepare(page, context, { file: "/entry-repeat.ngc", version: 3302, ...IN_THE_YOKE,
    extra: { rapid_rate: 300, feed_tcum: new Uint8Array(new Float32Array([0, 0.5, 1]).buffer) } });
  const next = nextHit(page);
  await expect(next).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  await next.click();
  await expect(page.locator(".simBanner")).toBeVisible();
  await expect.poll(() => hitCount(page), { timeout: 60_000 }).toBeGreaterThan(2);
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  const s = slider(page);
  await expect(s).toHaveAttribute("max", "2");
  await expect(s).toHaveAttribute("step", "0.001");
  // From the start, next is an entry contact at the live pose, 1 ms in
  await s.fill("0");
  await next.click();
  await expect(s).toHaveValue("0.001");
  // Away and back by hand, onto the very same value
  await s.focus();
  await page.keyboard.press("ArrowRight");
  await expect(s).toHaveValue("0.002");
  await page.keyboard.press("ArrowLeft");
  await expect(s).toHaveValue("0.001");
  // Next goes from the position: the program's contact (the nose's, at
  // 1.26 s), not the next entry contact at the same spot
  await next.click();
  expect(await at(page), "by position: the program's contact").toBeGreaterThan(1);
  await ctl({ op: "reset" });
});

// Codex R34 VP-I09: each pair (nose and tool) runs out of the yoke along L7
// and back into it — two separate contacts per pair, four findings. Started
// IN the yoke, the first contact per pair continues the entry move's (the
// machine stands at X 0, 240 mm out) and counts once with it; the re-entry
// is still the program's own. The control starts clear, 100 mm in front.
for (const c of [
  { name: "a clear first point (control)", version: 3401, joints: [-100, 0, -380, 0, 0],
    feed: [[0, 0, -380], [240, 0, -380], [0, 0, -380], [240, 0, -380], [240, 0, -100]], lines: [7, 7, 7, 7, 8] },
  { name: "the program starts in the contact", version: 3402, joints: [0, 0, -380, 0, 0],
    feed: [[240, 0, -380], [0, 0, -380], [240, 0, -380], [240, 0, -100]], lines: [7, 7, 7, 8] },
]) {
  test(`contacts that separate and come back on one line stay apart, with and without the entry move — ${c.name} (Codex R34 VP-I09)`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await prepare(page, context, { file: "/reentry.ngc", version: c.version, lines: c.lines, joints: c.joints, feed: c.feed });
    const next = nextHit(page);
    await expect(next).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
    expect(await hitCount(page), "the program alone: two contacts per pair").toBe(4);
    await next.click();
    await expect(page.locator(".simBanner")).toBeVisible();
    // The entry result merged in: the count holds (a first contact that
    // continues the entry's counts once, with the entry)
    // (right after the entry the new track has no result yet: no count)
    let total = 0;
    await expect.poll(async () => {
      const n = await hitCount(page);
      const settled = n > 0 && n === total && await sweepDone(page);
      total = n;
      return settled;
    }, { timeout: 60_000, intervals: [500] }).toBe(true);
    expect(total, "with the entry move: still four").toBe(4);
    // One round of next reaches four different places and comes back. (The
    // first jump chose the contact at the first point; started in the yoke
    // it is now the entry's finding, so next goes on from the position.)
    const seen: number[] = [];
    for (let i = 0; i <= total; i++) { await next.click(); seen.push(await at(page)); }
    expect(new Set(seen.slice(0, total)).size, "four separate stops").toBe(4);
    expect(seen[total], "a full round comes back to the first stop").toBe(seen[0]);
    await ctl({ op: "reset" });
  });
}

// A mid-run re-parse (operator 2026-09-29: the program measured its tool)
// publishes a new revision DURING the run: the old findings go (they were
// swept for the old payload), the automatic sweep is held while the
// interpreter runs — and it must start once the machine is idle again,
// whether or not another parse follows (Codex R40 MR-I03: it stayed absent).
test("a sweep held off by a run starts once the machine is idle, without another parse (Codex R40 MR-I03)", async ({ page, context }) => {
  test.setTimeout(90_000);
  const file = "/midrun.ngc";
  await prepare(page, context, { file, version: 4001,
    feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]], lines: [1, 6, 7, 8],
    joints: [-100, 0, 0, 0, 0] });
  await ctl({ op: "status_delta", data: { is_enabled: true, enabled: true, interp_state: 1 } });
  await expect(nextHit(page), "the program's collisions, swept at load").toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sweepDone(page), { timeout: 30_000 }).toBe(true);
  const found = await hitCount(page);
  expect(found).toBeGreaterThan(0);
  await ctl({ op: "quiet", on: true });
  const run = { interp_state: 2, task_mode: 2, motion_line: 6, joint_pos: [0, 0, -200, 0, 0], actual_position: [0, 0, -200, 0, 0] };
  await ctl({ op: "status_delta", data: run });
  // the mid-run publication: the old findings go, nothing sweeps while it runs
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4002, file } });
  await expect(nextHit(page)).toHaveCount(0);
  await page.waitForTimeout(800);   // past the 400 ms auto timer, still running
  await expect(nextHit(page)).toHaveCount(0);
  // the run ends: idle, no further parse — the held sweep starts by itself
  await ctl({ op: "status_delta", data: { interp_state: 1, current_vel: 0, motion_line: 0 } });
  await expect(nextHit(page), "the sweep restarted at idle").toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sweepDone(page), { timeout: 30_000 }).toBe(true);
  expect(await hitCount(page)).toBe(found);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// Codex R41 MR-I04: when no faithful re-parse can follow a tool-table change
// during a run (a random tool changer the worker refuses to pin, or no
// published start state), the gateway marks the payload's table stale until
// idle (`preview_table_stale`). The viewer keeps the path muted and says why
// — whichever tool changed, not only the loaded one — until the mark goes.
test("a tool table changed during the run without a re-parse keeps the path muted and says why (Codex R41 MR-I04)", async ({ page, context }) => {
  test.setTimeout(60_000);
  const file = "/tablestale.ngc";
  await prepare(page, context, { file, version: 4201,
    feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]], lines: [1, 6, 7, 8],
    joints: [-100, 0, 0, 0, 0] });
  const feedColour = () => page.evaluate(() => window.__viewerDiag?.getPalette?.()?.drawn.feed ?? null);
  const palette = async () => ({ drawn: { feed: await feedColour() } });
  await expect.poll(feedColour, { timeout: 30_000 }).toBeTruthy();
  const fresh = (await palette()).drawn.feed;
  await ctl({ op: "quiet", on: true });
  const mark = { reason: "table_row", why: "unsupported" };
  await ctl({ op: "raw", frame: { type: "status_delta", data: { interp_state: 2, task_mode: 2 }, preview_table_stale: mark } });
  await expect.poll(async () => (await palette()).drawn.feed, { message: "the path is muted" }).not.toBe(fresh);
  await expect(page.locator("[data-table-stale]")).toBeVisible();
  // it holds while the gateway keeps the mark — no timer ends it
  await page.waitForTimeout(1500);
  await ctl({ op: "raw", frame: { type: "status_delta", data: {}, preview_table_stale: mark } });
  expect((await palette()).drawn.feed).not.toBe(fresh);
  await expect(page.locator("[data-table-stale]")).toBeVisible();
  // the next publish (the idle edge): the mark goes, the path is current
  await ctl({ op: "raw", frame: { type: "status_delta", data: { interp_state: 1 } } });
  await expect.poll(async () => (await palette()).drawn.feed).toBe(fresh);
  await expect(page.locator("[data-table-stale]")).toHaveCount(0);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("on a machine with no other viewer note the tool-table mark brings the card itself, for both reasons (Codex R42)", async ({ page, context }) => {
  test.setTimeout(60_000);
  // A plain XYZ machine: no kinematics chip — XYZAC's chip opened the card
  // without the mark and hid that the mark alone never rendered it.
  const file = "/tablestale-xyz.ngc";
  const feed = [[0, 0, 5], [0, 0, -1], [40, 0, -1], [40, 30, -1]];
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream",
    body: Buffer.from(encode({ file, preview_schema: 9, feed, feed_lines: [1, 2, 3, 4], feed_seq: [1, 2, 3, 4],
      feed_outside: new Uint8Array(feed.length), rapid: [], violations: [], violations_total: 0 })) }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 6 }, (_, i) => `G1 X${i} F100`).join("\n") }));
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: file } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4301, file } });
  const feedColour = () => page.evaluate(() => window.__viewerDiag?.getPalette?.()?.drawn.feed ?? null);
  await expect.poll(feedColour, { timeout: 30_000 }).toBeTruthy();
  const fresh = await feedColour();
  const card = page.locator(".hudNotes");
  const line = page.locator("[data-table-stale]");
  await expect(card, "precondition: nothing else opens the card on this machine").toHaveCount(0);

  await ctl({ op: "quiet", on: true });
  for (const [why, says] of [["unsupported", "random tool changer"], ["no-basis", "start state is not known"]] as const) {
    const mark = { reason: "table_row", why };
    await ctl({ op: "raw", frame: { type: "status_delta", data: { interp_state: 2, task_mode: 2 }, preview_table_stale: mark } });
    await expect.poll(feedColour, { message: `${why}: the path is muted` }).not.toBe(fresh);
    await expect(line, `${why}: the card shows the line that explains it`).toBeVisible();
    await expect(line).toContainText("Tool table changed — preview updates after the run");
    expect(await line.textContent(), `${why}: its own reason`).toContain(says);
    // cleared (the publish at idle): the explanation goes with the muting
    await ctl({ op: "raw", frame: { type: "status_delta", data: { interp_state: 1 } } });
    await expect.poll(feedColour).toBe(fresh);
    await expect(card).toHaveCount(0);
  }
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// Operator 2026-09-30: a tool measured during a run re-parses the preview —
// the viewer says so ONCE, the re-parse line with its bar; the tool-length
// line ("… re-parse follows") that stood under the bar is gone while it runs.
test("a mid-run re-parse for a measured tool is one line, never a second one under its bar (operator 2026-09-30)", async ({ page, context }) => {
  test.setTimeout(60_000);
  const file = "/measured.ngc";
  const feed = [[0, 0, 5], [0, 0, -1], [40, 0, -1], [40, 30, -1]];
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream",
    body: Buffer.from(encode({ file, preview_schema: 9, feed, feed_lines: [1, 2, 3, 4], feed_seq: [1, 2, 3, 4],
      feed_outside: new Uint8Array(feed.length), rapid: [], violations: [], violations_total: 0,
      parse_tlos: [[13, 0, 0, 65.064, 8]] })) }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 6 }, (_, i) => `G1 X${i} F100`).join("\n") }));
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: file, tool_number: 13, tool_length: 65.064 } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4401, file } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getPalette?.()?.drawn.feed ?? null),
    { timeout: 30_000 }).toBeTruthy();
  const lines = page.locator(".hudNotes .hudWarn");
  const tlo = lines.filter({ hasText: "Preview parsed with a different T13 length" });
  await expect(page.locator(".hudNotes"), "precondition: nothing opens the card on this machine").toHaveCount(0);

  await ctl({ op: "quiet", on: true });
  // T13 M600 measured a new length; the mid-run edge has not fired yet
  await ctl({ op: "status_delta", data: { interp_state: 2, task_mode: 2, tool_length: 65.0589 } });
  await expect(tlo, "before the re-parse starts the length line says it").toBeVisible();
  await expect(lines).toHaveCount(1);
  // the re-parse runs: its line and bar, nothing under it
  await ctl({ op: "raw", frame: { type: "status_delta", data: {}, preview_refresh:
    { reason: "midrun:table_mtime", file, expected_ms: 15000, started_ms: 1000, queued: false, superseded: 0 } } });
  await expect(lines.first()).toContainText("Preview re-parsing · tool measured (program running)");
  await expect(tlo).toHaveCount(0);
  await expect(lines, "one line while the re-parse runs").toHaveCount(1);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

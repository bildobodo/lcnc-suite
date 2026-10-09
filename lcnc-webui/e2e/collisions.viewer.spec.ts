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
  // The findings live in the side pane's Simulation tab, its list on the collisions.
  await simShow(page, "clash");
}
const nextHit = (page: Page) => simStepBtn(page, "Next collision");
/** The list's collision rows (the list is filtered to collisions). */
const clashRows = (page: Page) => page.locator(".simPanel tbody tr");
const slider = (page: Page) => page.locator(".scrubBar .sliderInput");
const at = async (page: Page) => Number(await slider(page).inputValue());
/** The collision count the findings button reads ("9 collisions"). */
const hitCount = async (page: Page) => clashRows(page).count();
/** The sweep has ended: the findings show from the live partial on ("… so far"). */
const sweepDone = async (page: Page) => !/so far/.test(await page.locator(".simPanel").innerText());

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
  await expect(clashRows(page).first(), "the sweep finds the nose in the yoke").toBeVisible({ timeout: 60_000 });
  await expect(clashRows(page).first().locator(".rowPick")).toHaveText("L7");
  await page.evaluate(() => window.__viewerDiag!.setViewDirection!([0, 0, 1]));
  await ctl({ op: "raw", frame: { type: "settings_changed", settings: { viewer: { layers: { toolpath: false, rapids: false } } } } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.projectRole!("feed"))).toBeNull();

  await next.click();
  await expect(page.locator(".simBanner")).toBeVisible();
  await expect(simLine(page), "the FIRST click lands on the collision's line").toHaveText(/^L7\b/);
  await expect(page.locator("[data-path-reveal]")).toHaveText("Toolpath shown for this finding — hidden in Layers");
  const move = (await page.evaluate(() => window.__viewerDiag!.projectRole!("feed")))!;
  expect(move, "the collision's move is shown").not.toBeNull();
  // L7 runs along X; the plunge (L6) and the retract (L8) are along Z — a
  // point in the top view
  expect(Math.abs(move.dx), "L7's own move, along X").toBeGreaterThan(0.95);
  await ctl({ op: "reset" });
});

// A move whose start no parse can know (a tool change the controller moves
// at, [EMCIO] TOOL_CHANGE_POSITION — wire rapid_ustart after the program's
// own start) is checked at its end only, and the check SAYS so (2026-10-08).
// The page must hand the flags to the worker — the unit test drives the
// sweep directly and cannot see that (the copy for the worker left them out).
test("a move whose start no parse can know is named in the check", async ({ page, context }) => {
  test.setTimeout(120_000);
  await prepare(page, context, { file: "/ustart.ngc", version: 2310, lines: [1, 2, 6], joints: [-100, 0, 0, 0, 0],
    feed: [[0, 0, -100], [0, 0, -150], [20, 0, -150]],
    extra: { feed_seq: [1, 2, 4], rapid: [[10, 0, -150]], rapid_lines: [4], rapid_seq: [3],
             rapid_outside: new Uint8Array(1), rapid_ustart: new Uint8Array([1]) } });
  // The diagnostic exists once the model is built (Codex R92 VP-I52): poll
  // through optional calls, never `!` — a cold model threw before it was there.
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getCollisionSummary?.()?.uncertified ?? null),
                    { timeout: 60_000 })
    .toBe("1 move after a tool change runs from a position the preview cannot know — not checked until the position is known again (L4)");
  await openSimTab(page);
  const item = page.locator(".simPanel .simSummary .sumItem").first();
  await expect(item.locator('span[title^="Not certified"]'), "the marker").toHaveCount(1);
  await page.getByRole("button", { name: "Help: Collision check", exact: true }).click();
  await expect(page.locator(".helpPopover:popover-open")).toContainText("after a tool change runs from a position the preview cannot know");
  await page.keyboard.press("Tab");   // light dismiss without Escape (E-Stop)
  await ctl({ op: "reset" });
});

// An offset set from that unknown position (Codex R95 VP-I53): the parse
// keeps every later move unknown and names the line; the page must hand the
// line and the "not tracked" flag to the worker, or the note would promise a
// recovery that never comes.
test("an offset set from the unknown position is named, to the program's end", async ({ page, context }) => {
  test.setTimeout(120_000);
  await prepare(page, context, { file: "/ustart-offset.ngc", version: 2311, lines: [1, 2, 6], joints: [-100, 0, 0, 0, 0],
    feed: [[0, 0, -100], [0, 0, -150], [20, 0, -150]],
    extra: { feed_seq: [1, 2, 4], rapid: [[10, 0, -150]], rapid_lines: [4], rapid_seq: [3],
             rapid_outside: new Uint8Array(1), rapid_ustart: new Uint8Array([1]),
             stale_offset_lines: [3], stale_offset_untracked: true } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getCollisionSummary?.()?.uncertified ?? null),
                    { timeout: 60_000 })
    .toBe("1 move after a tool change runs from a position the preview cannot know — not checked to the program's end: "
      + "the offset set from that position at L3 stays unknown whatever is positioned after (L4); "
      + "in subroutines and loops, stored positions (G28.1 / G30.1) and fixture writes in called files are not tracked");
  await ctl({ op: "reset" });
});

// The parallel sweep (operator 2026-10-07): with cores to spare the worker
// splits the model's pairs over sub-workers of its own and merges their
// results; the page sees one sweep. Its equality with the single sweep is
// sweepShards.test.ts's (the same sweep and merge, in node); this holds the
// browser's plumbing to it — the sub-workers load, the merged result reaches
// the tab, the entry move's side sweep runs beside them.
test("the sweep runs on several workers and finds what the single sweep finds", async ({ page, context }) => {
  test.setTimeout(120_000);
  await prepare(page, context, { file: "/crash-par.ngc", version: 2210, lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
    feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]] });
  await expect(clashRows(page).first(), "the nose in the yoke, found").toBeVisible({ timeout: 60_000 });
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  const cores = await page.evaluate(() => navigator.hardwareConcurrency);
  const s = (await page.evaluate(() => window.__viewerDiag!.getCollisionSummary!()))!;
  // Two cores stay with the page and the browser (Codex R90): four make two shards.
  if (cores >= 4) expect(s.shards, `${cores} cores: more than one worker`).toBeGreaterThan(1);
  expect([...new Set(s.onsets)], "the collisions begin on L7 alone, as the single sweep has it").toEqual([7]);
  expect(s.truncated, "swept whole").toBeNull();
  // The entry move's side sweep beside the shards: the jump lands on L7.
  await nextHit(page).click();
  await expect(simLine(page)).toHaveText(/^L7\b/);
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
  await expect(clashRows(page).first(), "the program's sweep finds the nose and the tool in the yoke").toBeVisible({ timeout: 60_000 });
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
  await expect(clashRows(page).first()).toBeVisible({ timeout: 60_000 });
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
    await expect(clashRows(page).first()).toBeVisible({ timeout: 60_000 });
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
  await expect(clashRows(page).first(), "the program's collisions, swept at load").toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sweepDone(page), { timeout: 30_000 }).toBe(true);
  const found = await hitCount(page);
  expect(found).toBeGreaterThan(0);
  await ctl({ op: "quiet", on: true });
  const run = { interp_state: 2, task_mode: 2, motion_line: 6, joint_pos: [0, 0, -200, 0, 0], actual_position: [0, 0, -200, 0, 0] };
  await ctl({ op: "status_delta", data: run });
  // the mid-run publication: the old findings go, nothing sweeps while it runs
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4002, file } });
  await expect(clashRows(page)).toHaveCount(0);
  await page.waitForTimeout(800);   // past the 400 ms auto timer, still running
  await expect(clashRows(page)).toHaveCount(0);
  // the run ends: idle, no further parse — the held sweep starts by itself
  await ctl({ op: "status_delta", data: { interp_state: 1, current_vel: 0, motion_line: 0 } });
  await expect(clashRows(page).first(), "the sweep restarted at idle").toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sweepDone(page), { timeout: 30_000 }).toBe(true);
  expect(await hitCount(page)).toBe(found);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// ---- Plan „Prüfung im Lauf“ 1c / 2 (Codex R112–R115) ----
// L7 traverses into the A yoke (as above): a program with findings.
const RUN_FEED = [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]];
const Z9 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
/** The envelope's run_basis as the gateway sends it once the start was
 *  written (scripts/test_fixtures/run_check_wire.json). */
const runEnv = (file: string, over: Record<string, unknown> = {}) => ({ run_basis: {
  run_id: 7, state: "sent", file, source: "s", version: 4101, ctx_digest: "d", tool_basis_rev: 1,
  start: { g5x_index: 1, g5x_offset: Z9, g92_offset: Z9, rotation_xy: 0, wcs_table: null, tool_number: 0,
           tool_diameter: null, tool_length: null, tool_table_z: null, tool_offset: Z9 },
  verified: true, why: null, ...over } });
const basisOf = (page: Page) => page.evaluate(() => window.__viewerDiag!.getCollisionBasis!());
const g92z = (z: number) => [0, 0, z, 0, 0, 0, 0, 0, 0];

async function runReady(page: Page, context: BrowserContext, file: string, version: number) {
  await prepare(page, context, { file, version, feed: RUN_FEED, lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0] });
  await ctl({ op: "status_delta", data: { is_enabled: true, enabled: true, interp_state: 1, task_mode: 1 } });
  await expect(clashRows(page).first(), "the program's collisions, swept at load").toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sweepDone(page), { timeout: 30_000 }).toBe(true);
  const found = await hitCount(page);
  expect(found).toBeGreaterThan(0);
  return found;
}

test("what the run changes itself keeps the findings; its end re-checks on the state then (plan „Prüfung im Lauf“ 2)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const file = "/runkeep.ngc";
  const found = await runReady(page, context, file, 4101);
  const before = await basisOf(page);
  expect(before?.kind).toBe("idle");
  await ctl({ op: "quiet", on: true });
  // the first AUTO frame the client sees already carries the program's early
  // G92 and its M6 (the gateway wrote the start before; R113)
  await ctl({ op: "status_delta", envelope: runEnv(file), data: { interp_state: 2, task_mode: 2,
    g92_offset: g92z(5), tool_number: 3, tool_diameter: 10, tool_length: 50 } });
  await page.waitForTimeout(800);   // past the 400 ms auto timer
  expect(await hitCount(page), "the findings stay").toBe(found);
  expect(await sweepDone(page), "no check began").toBe(true);
  expect(await basisOf(page)).toEqual(before);
  // pause and resume: the same run — its changes keep the findings too
  await ctl({ op: "status_delta", data: { interp_state: 3 } });
  await ctl({ op: "status_delta", data: { interp_state: 2, g92_offset: g92z(6) } });
  await page.waitForTimeout(800);
  expect(await hitCount(page)).toBe(found);
  expect(await basisOf(page)).toEqual(before);
  // the run ends: the state now is not the kept result's basis — the next
  // start begins from here, so it is checked on it
  await ctl({ op: "status_delta", data: { interp_state: 1, current_vel: 0 } });
  await expect.poll(async () => (await basisOf(page))?.g92[2], { timeout: 10_000 }).toBe(6);
  expect((await basisOf(page))?.kind).toBe("idle");
  expect((await basisOf(page))?.toolLen).toBe(50);
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// No run: a start that was not written (unsent), and an MDI after a run (the
// run_basis stays until the next start) — their changes are the operator's,
// and the findings go at once as before.
for (const [name, over, mode] of [
  ["a start that was not written", { state: "unsent" }, 2],
  ["an MDI after a run", {}, 3],
] as const) {
  test(`${name} is no run: a change clears the findings (plan „Prüfung im Lauf“ 2)`, async ({ page, context }) => {
    test.setTimeout(90_000);
    const file = "/norun.ngc";
    await runReady(page, context, file, 4111);
    await ctl({ op: "quiet", on: true });
    await ctl({ op: "status_delta", envelope: runEnv(file, over), data: { interp_state: 2, task_mode: mode,
      g92_offset: g92z(5) } });
    await expect(clashRows(page), "cleared — not the program's change").toHaveCount(0);
    await ctl({ op: "status_delta", data: { interp_state: 1, task_mode: 1 } });
    await expect.poll(async () => (await basisOf(page))?.g92[2], { timeout: 10_000 }).toBe(5);
    await ctl({ op: "quiet", on: false });
    await ctl({ op: "reset" });
  });
}

// Plan 1c: a preview the run published (its tool table changed) is not the
// one the findings were swept on — the earlier verdict is NAMED, without its
// rows, marks or count, until the displayed preview is checked (at idle).
test("a preview published in the run names the earlier verdict only, until it is checked at idle (plan „Prüfung im Lauf“ 1c)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const file = "/runprev.ngc";
  const found = await runReady(page, context, file, 4121);
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", envelope: runEnv(file), data: { interp_state: 2, task_mode: 2, motion_line: 6 } });
  // the run is on screen before the publication (status frames are folded per
  // animation frame; a real mid-run parse publishes seconds into the run)
  await expect(simLine(page)).toHaveText(/L6|off path/);
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4122, file } });
  await expect(clashRows(page), "no rows of the earlier preview").toHaveCount(0);
  const summary = page.locator(".simSummary .sumItem").first();
  await expect(summary).toHaveAttribute("aria-label", `Earlier preview: ${found} collision${found === 1 ? "" : "s"}`);
  await expect(page.locator(".simPanel .checkRow")).toContainText("Not checked yet");
  const previous = () => page.evaluate(() => window.__viewerDiag!.getCollisionPrevious!());
  expect(await previous()).toEqual({ collisions: found, complete: true, version: 4121 });
  await page.waitForTimeout(800);
  await expect(clashRows(page)).toHaveCount(0);
  // idle: the displayed preview is checked; the earlier verdict goes
  await ctl({ op: "status_delta", envelope: runEnv(file), data: { interp_state: 1, task_mode: 1, motion_line: 0 } });
  await expect(clashRows(page).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sweepDone(page), { timeout: 30_000 }).toBe(true);
  await expect(summary).not.toHaveAttribute("aria-label", /Earlier preview/);
  expect(await previous(), "a check of the displayed preview ends the earlier verdict").toBeNull();
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// ---- Plan „Prüfung im Lauf“ 3 (Codex R112–R115): the check during a run ----
/** The envelope's preview_origin for `version` (ordinary unless `forRun`). */
const originEnv = (file: string, version: number, over: Record<string, unknown> = {}) => ({ preview_origin: {
  version, file, source: "s", reason: "file", pinned: false, for_run: null, table: { mtime: 5, rows: "r" },
  tool_basis_rev: 1, tool_basis_rev_now: 1, ...over } });
const pinnedFor = (runId: number) => ({ pinned: true, reason: "midrun:table_mtime",
  for_run: { run_id: runId, ctx_digest: "d", tool_basis_rev: 1 } });
const runLog = (page: Page) => page.evaluate(() => window.__viewerDiag!.getRunCheckLog!());
/** Publish `version` during the run and, once it is on screen, one status
 *  frame (the gateway sends 30 a second; `quiet` sends none): the run watcher
 *  attaches the position to the new track before the auto timer plans. */
async function publishInRun(page: Page, file: string, version: number, over: Record<string, unknown>) {
  await ctl({ op: "status_delta", envelope: originEnv(file, version, over), data: {} });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version, file } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getShownVersion!()), { timeout: 10_000 }).toBe(version);
  await ctl({ op: "status_delta", data: { joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] } });
}
/** The run on screen at X 120 on L7 (the attached run position the provisional check starts from). */
async function runOnL7(page: Page, file: string, version: number) {
  await ctl({ op: "status_delta", envelope: { ...runEnv(file, { run_id: 9 }), ...originEnv(file, version) },
    data: { interp_state: 2, task_mode: 2, motion_line: 7, joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] } });
  await expect(simLine(page)).toHaveText(/L7/);
}

test("a parse made for the run is checked during it: provisional from the machine's line, then in full; idle checks in full (plan „Prüfung im Lauf“ 3)", async ({ page, context }) => {
  test.setTimeout(150_000);
  const file = "/runcheck.ngc";
  await runReady(page, context, file, 4201);
  await ctl({ op: "quiet", on: true });
  await runOnL7(page, file, 4201);
  // the table edge's pinned parse, published for run 9 — and the run's table
  // turns its rotaries meanwhile: a run's own motion parks nothing (plan 4)
  await publishInRun(page, file, 4202, pinnedFor(9));
  // the decode held the sweep and let it go (plan 4)
  expect(await page.evaluate(() => window.__viewerDiag!.getCollisionHoldLog!())).toEqual(expect.arrayContaining(["decode on", "decode off"]));
  await expect.poll(() => runLog(page), { timeout: 10_000 }).toContain("start provisional 1");
  // during a run: two workers at most, shorter slices (plan 4)
  const meta = (await page.evaluate(() => window.__viewerDiag!.getCollisionRequestMeta!()))!;
  expect(meta.sliceMs).toBe(20);
  expect(meta.maxShards).toBeLessThanOrEqual(2);
  for (const a of [5, 10, 15]) await ctl({ op: "status_delta", data: { rotary_abc: [a, 0, 0] } });
  await expect.poll(() => runLog(page), { timeout: 60_000 }).toEqual(["start provisional 1", "full", "done"]);
  const label = page.locator(".simPanel .checkRow .sub");
  await expect(label).toHaveText("Run check · tool table updated");
  await expect(page.locator(".simSummary .sumItem").first()).toHaveAttribute("aria-label", /· checked in full$/);
  // a finished worker alone is no full check: uncertified, it says so (R115)
  await page.evaluate(() => window.__viewerDiag!.setCollisionNote!("a body was left out"));
  await expect(page.locator(".simSummary .sumItem").first()).toHaveAttribute("aria-label", /· checked to the end \(not certified\)$/);
  await page.evaluate(() => window.__viewerDiag!.setCollisionNote!(null));
  const b = await basisOf(page);
  expect(b?.kind, "built from the run's start").toBe("run");
  expect(b?.runId).toBe(9);
  expect(await page.evaluate(() => window.__viewerDiag!.getCollisionRange!()), "the full check replaced the provisional").toBeNull();
  // idle: the check during the run ends; the full check on the state now
  await ctl({ op: "status_delta", data: { interp_state: 1, task_mode: 1, motion_line: 0 } });
  await expect.poll(async () => (await basisOf(page))?.kind, { timeout: 10_000 }).toBe("idle");
  expect(await runLog(page)).toEqual(["start provisional 1", "full", "done", "discard idle"]);
  expect((await page.evaluate(() => window.__viewerDiag!.getCollisionRequestMeta!()))?.sliceMs, "idle: the default slices").toBeNull();
  await expect(label).toHaveText("Collision check");
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("only a parse made for this run is checked during it — every other publication waits for idle, before any sweep (plan „Prüfung im Lauf“ 3a)", async ({ page, context }) => {
  test.setTimeout(150_000);
  const file = "/runadmit.ngc";
  const found = await runReady(page, context, file, 4211);
  await ctl({ op: "quiet", on: true });
  await runOnL7(page, file, 4211);
  const variants: Array<[string, Record<string, unknown>]> = [
    // R114: an ordinary publication B of the same text during run A
    ["an ordinary publication", {}],
    // R113: a parse of another run, published late
    ["made for another run", pinnedFor(8)],
    ["another text of the same file", { ...pinnedFor(9), source: "t" }],
    // a basis confirmed since without a new version
    ["the basis moved since", { ...pinnedFor(9), tool_basis_rev_now: 2 }],
  ];
  let version = 4212;
  for (const [name, over] of variants) {
    await publishInRun(page, file, version, over);
    await expect(page.locator(".simSummary .sumItem").first(), name).toHaveAttribute("aria-label", /^Earlier preview/);
    await page.waitForTimeout(800);   // past the auto timer
    expect(await runLog(page), `${name}: no check during the run`).toEqual([]);
    expect((await basisOf(page))?.kind, `${name}: no sweep began`).toBe("idle");
    version++;
  }
  // the control: the table edge's parse for THIS run, after B — admitted (R114)
  await publishInRun(page, file, version, pinnedFor(9));
  await expect.poll(() => runLog(page), { timeout: 60_000 }).toEqual(["start provisional 1", "full", "done"]);
  expect(found).toBeGreaterThan(0);
  // a new publication discards it again
  await ctl({ op: "status_delta", envelope: originEnv(file, version + 1), data: {} });
  await expect.poll(() => runLog(page), { timeout: 10_000 }).toContain("discard origin");
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("at standstill a rotary move parks the check — the control of the run's own motion (plan „Prüfung im Lauf“ 4)", async ({ page, context }) => {
  test.setTimeout(90_000);
  const file = "/parkidle.ngc";
  await prepare(page, context, { file, version: 4231, feed: RUN_FEED, lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0] });
  await ctl({ op: "status_delta", data: { is_enabled: true, enabled: true, interp_state: 1, task_mode: 1 } });
  // the load sweep runs; the table turns by hand (a jog) until the sweep parks
  let a = 0;
  await expect.poll(async () => {
    a = a ? 0 : 2;
    await ctl({ op: "status_delta", data: { rotary_abc: [a, 0, 0] } });
    return (await page.evaluate(() => window.__viewerDiag!.getCollisionStopped!()))?.reason ?? null;
  }, { timeout: 30_000, intervals: [50] }).toBe("motion");
  await ctl({ op: "reset" });
});

test("another run discards the check made during the last one (plan „Prüfung im Lauf“ 3a)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const file = "/runnext.ngc";
  await runReady(page, context, file, 4221);
  await ctl({ op: "quiet", on: true });
  await runOnL7(page, file, 4221);
  await publishInRun(page, file, 4222, pinnedFor(9));
  await expect.poll(() => runLog(page), { timeout: 60_000 }).toEqual(["start provisional 1", "full", "done"]);
  // the next start (run 10): the result on screen was run 9's
  await ctl({ op: "status_delta", envelope: runEnv(file, { run_id: 10 }), data: {} });
  await expect.poll(() => runLog(page), { timeout: 10_000 }).toContain("discard run");
  await expect(page.locator(".simPanel .checkRow .sub")).toHaveText("Collision check");
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
    body: Buffer.from(encode({ file, preview_schema: 10, feed, feed_lines: [1, 2, 3, 4], feed_seq: [1, 2, 3, 4],
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

// Codex R59 (VP-I23 rest): the gateway goes back to the published start
// while the decode at the verified basis 20 is still out. The view shows the
// start already — the check ends at once — and the late reply for 20 must
// never replace it (it did: −20 in normal colour, no note, and the next
// unchanged status did not repair it). Only the worker's DELIVERY is held;
// the product and its geometry are untouched.
test("a return to the basis on screen while a decode is out drops its late reply (Codex R59 VP-I23)", async ({ page, context }) => {
  test.setTimeout(60_000);
  const file = "/basis.ngc";
  const heldKey = `${file}#4502:0,0,20`;
  await page.addInitScript((key: string) => {
    const w = window as any;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      set onmessage(fn: any) {
        super.onmessage = (event: MessageEvent) => {
          if (event.data?.basisKey === key && !w.__heldReleased) {
            w.__held = true;
            w.__release = () => { w.__heldReleased = true; fn.call(this, event); };
          } else fn.call(this, event);
        };
      }
      get onmessage() { return super.onmessage; }
    } as any;
  }, heldKey);
  let previews = 0;
  await context.route(/\/preview(\?|$)/, r => {
    previews += 1;
    return r.fulfill({ contentType: "application/octet-stream",
      body: Buffer.from(encode({ file, preview_schema: 10, rapid: [[0, 0, -10], [20, 0, -10]], rapid_seq: [1, 2],
        rapid_lines: [1, 2], feed: [[20, 0, -30], [40, 0, -40]], feed_seq: [3, 4], feed_lines: [4, 5],
        feed_outside: new Uint8Array(2), rapid_outside: new Uint8Array(2),
        violations: [], violations_total: 0, tlo_events: [[2, 0, 0, 0, -1]],
        start_known: true, tlo_start: [0, 0, 10] })) });
  });
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: "G53 G0 Z0\nG0 X20\nG49\nG1 Z-30 F100\nG1 X40 Z-40\n" }));
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: file, tool_offset: [0, 0, 10, 0, 0, 0, 0, 0, 0] } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4502, file } });
  const topZ = () => page.evaluate(() => window.__viewerDiag?.getPathBox?.()?.max[2] ?? null);
  const feedColour = () => page.evaluate(() => window.__viewerDiag?.getPalette?.()?.drawn.feed ?? null);
  await expect.poll(topZ, { timeout: 30_000 }).toBeCloseTo(-10, 4);
  const shown = await feedColour();

  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", data: { tool_offset: [0, 0, 20, 0, 0, 0, 0, 0, 0] } });
  await ctl({ op: "raw", frame: { type: "status_delta", data: {}, preview_refresh:
    { reason: "tool_offset", file, expected_ms: 4000, started_ms: 2000, queued: false, superseded: 0 } } });
  await ctl({ op: "raw", frame: { type: "status_delta", data: {},
    preview_tool_basis: { file, version: 4502, xyz: [0, 0, 20], mode: 430 } } });
  await expect.poll(() => page.evaluate(() => (window as any).__held ?? false)).toBe(true);
  const lines = page.locator(".hudNotes .hudWarn");
  await expect(lines.filter({ hasText: "Preview re-parsing" })).toHaveCount(1);
  expect(await topZ()).toBeCloseTo(-10, 4);
  expect(await feedColour(), "muted while the decode at 20 is out").not.toBe(shown);
  // the gateway is back on the published start (no preview_tool_basis)
  await ctl({ op: "raw", frame: { type: "status_delta", data: { tool_offset: [0, 0, 10, 0, 0, 0, 0, 0, 0] } } });
  await expect(lines.filter({ hasText: "Preview re-parsing" }), "the start is on screen: nothing to wait for").toHaveCount(0);
  await expect.poll(feedColour).toBe(shown);
  await page.evaluate(() => (window as any).__release());
  await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.waitForTimeout(500);
  expect(await topZ(), "the late reply for 20 never replaces the start").toBeCloseTo(-10, 4);
  await ctl({ op: "raw", frame: { type: "status_delta", data: { tool_offset: [0, 0, 10, 0, 0, 0, 0, 0, 0] } } });
  await page.waitForTimeout(300);
  expect(await topZ()).toBeCloseTo(-10, 4);
  expect(await feedColour()).toBe(shown);
  expect(previews, "no second download").toBe(1);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// Live look 2026-10-01: "Preview uses older offsets — re-parses when idle"
// flashed after every touch-off, then "Preview re-parsing" replaced it — in
// standstill the gateway re-parses within its debounce anyway. The line shows
// at once only while a program runs (the re-parse waits for idle); in
// standstill only when no re-parse began within the grace (never silent).
test("the older-offsets line: at once during a run, in standstill only if no re-parse follows (live look 2026-10-01)", async ({ page, context }) => {
  test.setTimeout(60_000);
  const file = "/offsets.ngc";
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream",
    body: Buffer.from(encode({ file, preview_schema: 10, feed: [[0, 0, 0], [10, 0, 0]], feed_lines: [1, 2], feed_seq: [1, 2],
      feed_outside: new Uint8Array(2), rapid: [], violations: [], violations_total: 0,
      wcs_basis: { g5x: [0, 0, 0, 0, 0, 0, 0, 0, 0], g92: [0, 0, 0, 0, 0, 0, 0, 0, 0], rotation: 0 }, wcs_basis_index: 1, wcs_used: [1] })) }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain", body: "G1 X10 F100\n" }));
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: file, g5x_index: 1, g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    g92_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0], rotation_xy: 0, interp_state: 1 } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 9201, file } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getPathBox?.() ?? null), { timeout: 20_000 }).not.toBeNull();
  const line = page.locator(".hudNotes .hudWarn", { hasText: "older offsets" });
  // standstill: a touch-off moves G54 — the gateway's re-parse follows within its debounce
  await ctl({ op: "status_delta", data: { g5x_offset: [5, 0, 0, 0, 0, 0, 0, 0, 0] } });
  await page.waitForTimeout(2500);
  await expect(line, "no flash before the re-parse in standstill").toHaveCount(0);
  // … and if none begins, the line says so (never a silent stale path)
  await expect(line).toHaveCount(1, { timeout: 8000 });
  // during a run it shows at once
  await ctl({ op: "status_delta", data: { g5x_offset: [0, 0, 0, 0, 0, 0, 0, 0, 0] } });
  await expect(line).toHaveCount(0);
  await ctl({ op: "status_delta", data: { interp_state: 2, g5x_offset: [7, 0, 0, 0, 0, 0, 0, 0, 0] } });
  await expect(line).toHaveCount(1, { timeout: 1500 });
  await ctl({ op: "reset" });
});

// Operator 2026-09-30: a tool measured during a run re-parses the preview —
// the viewer says so ONCE, the re-parse line with its bar; the tool-length
// line ("… re-parse follows") that stood under the bar is gone while it runs.
test("a changed tool offset is checked, and a verified basis re-tips the prefix without a new payload (VP-I20)", async ({ page, context }) => {
  test.setTimeout(60_000);
  const file = "/basis.ngc";
  // G53 Z0 under the start offset 10: program Z -10 (the path's top), then
  // the program's own offset row at seq 2 and its cut below
  const rapid = [[0, 0, -10], [20, 0, -10]];
  const feed = [[20, 0, -30], [40, 0, -40]];
  let previews = 0;
  await context.route(/\/preview(\?|$)/, r => {
    previews += 1;
    return r.fulfill({ contentType: "application/octet-stream",
      body: Buffer.from(encode({ file, preview_schema: 10, rapid, rapid_seq: [1, 2], rapid_lines: [1, 2],
        feed, feed_seq: [3, 4], feed_lines: [4, 5], feed_outside: new Uint8Array(2), rapid_outside: new Uint8Array(2),
        violations: [], violations_total: 0, tlo_events: [[2, 0, 0, 0, -1]],
        start_known: true, tlo_start: [0, 0, 10] })) });
  });
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: "G53 G0 Z0\nG0 X20\nG49\nG1 Z-30 F100\nG1 X40 Z-40\n" }));
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: file, tool_offset: [0, 0, 10, 0, 0, 0, 0, 0, 0] } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 4501, file } });
  const topZ = () => page.evaluate(() => window.__viewerDiag?.getPathBox?.()?.max[2] ?? null);
  await expect.poll(topZ, { timeout: 30_000 }).not.toBeNull();
  const before = (await topZ())!;
  expect(previews).toBe(1);

  await ctl({ op: "quiet", on: true });
  // the operator's G43.1 Z20: the gateway checks at the actual offset
  await ctl({ op: "status_delta", data: { tool_offset: [0, 0, 20, 0, 0, 0, 0, 0, 0] } });
  await ctl({ op: "raw", frame: { type: "status_delta", data: {}, preview_refresh:
    { reason: "tool_offset", file, expected_ms: 4000, started_ms: 2000, queued: false, superseded: 0 } } });
  const lines = page.locator(".hudNotes .hudWarn");
  await expect(lines.first()).toContainText("Preview re-parsing");
  // the line names the state only; the reason is in its "?" (operator 2026-10-01)
  expect(await lines.first().evaluate(e => e.firstChild?.textContent?.trim())).toBe("Preview re-parsing");
  await expect(lines.first().locator(".helpPopover")).toContainText("Why: tool offset changed — checking.");
  await expect.poll(topZ, { message: "a live offset alone moves nothing on a seeded payload" }).toBeCloseTo(before, 4);
  // verified the same at 20: no new version — the same bytes, re-tipped
  await ctl({ op: "raw", frame: { type: "status_delta", data: {},
    preview_tool_basis: { file, version: 4501, xyz: [0, 0, 20], mode: 430 } } });
  await expect.poll(topZ, { timeout: 15_000 }).toBeCloseTo(before - 10, 4);
  expect(previews, "no second download").toBe(1);
  await expect(lines.filter({ hasText: "Preview re-parsing" }), "the check ends once the view shows it").toHaveCount(0);
  // Codex R58 VP-I24: a basis for ANOTHER file with the same version number
  // is not this payload's — never applied (−30); the payload falls back to
  // its own start, the only basis the gateway still vouches for here
  await ctl({ op: "raw", frame: { type: "status_delta", data: {},
    preview_tool_basis: { file: "/different-program.ngc", version: 4501, xyz: [0, 0, 30], mode: 430 } } });
  await expect.poll(topZ, { timeout: 15_000 }).toBeCloseTo(before, 4);
  await page.waitForTimeout(500);
  expect(await topZ()).toBeCloseTo(before, 4);
  expect(previews).toBe(1);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("a mid-run re-parse for a measured tool is one line, never a second one under its bar (operator 2026-09-30)", async ({ page, context }) => {
  test.setTimeout(60_000);
  const file = "/measured.ngc";
  const feed = [[0, 0, 5], [0, 0, -1], [40, 0, -1], [40, 30, -1]];
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream",
    body: Buffer.from(encode({ file, preview_schema: 10, feed, feed_lines: [1, 2, 3, 4], feed_seq: [1, 2, 3, 4],
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
  await expect(lines.first()).toContainText("Preview re-parsing");
  expect(await lines.first().evaluate(e => e.firstChild?.textContent?.trim()), "no reason in the line itself (operator 2026-10-01)").toBe("Preview re-parsing");
  await expect(lines.first().locator(".helpPopover")).toContainText("Why: tool measured (program running).");
  await expect(tlo).toHaveCount(0);
  await expect(lines, "one line while the re-parse runs").toHaveCount(1);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

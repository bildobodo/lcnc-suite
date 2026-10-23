import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { decode, encode } from "@msgpack/msgpack";
import { readFileSync } from "node:fs";
import { ctl } from "./ctl";
import { openSimTab, simLine, simShow, simStepBtn } from "./simTab";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { FROM_WIRE_INIT, oneContact, wireDelta } from "./contactsDelta";
import { ContactStore, GAP_UNDECIDABLE, NONE } from "../src/viewer/contactStore";

// COLLISION jumps on the real 5-axis model (examples/sim_config/machine-
// 5axis-xyzac, the XYZAC config's own machine.json and STLs): the sweep runs
// in the browser worker against the real bodies — the program's sweep on
// load, the entry move's own side sweep once a jump enters the simulation.
const MODEL = new URL("../../examples/sim_config/machine-5axis-xyzac/", import.meta.url);
const machine = JSON.parse(readFileSync(new URL("machine.json", MODEL), "utf8"));

async function prepare(page: Page, context: BrowserContext, o: {
  file: string; version: number; feed: number[][]; lines: number[]; joints: number[]; extra?: Record<string, unknown>;
  /** Runs once the viewer is up, before the program is published. */
  before?: () => Promise<unknown>;
}) {
  const preview = Buffer.from(encode({ file: o.file, preview_schema: 11, feed: o.feed,
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
  if (o.before) await o.before();
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: o.version, file: o.file } });
  // The findings live in the side pane's Simulation tab, its list on the collisions.
  await simShow(page, "clash");
}
const nextHit = (page: Page) => simStepBtn(page, "Next collision");
/** The list's collision rows (the list is filtered to collisions). */
const clashRows = (page: Page) => page.locator(".simPanel tbody tr[data-sim-row]");
const slider = (page: Page) => page.locator(".scrubBar .sliderInput");
const at = async (page: Page) => Number(await slider(page).inputValue());
/** The collision count the findings button reads ("9 collisions"). */
const hitCount = async (page: Page) => clashRows(page).count();
/** The sweep has ended: the findings show from the live partial on ("… so far").
 *  Read from the summary's NAME — its line may show the result as a count
 *  ("3… · entry move still checking", the measured short form). */
const sweepDone = async (page: Page) =>
  !/so far/.test(await page.locator(".simPanel .simSummary .sumItem").first().getAttribute("aria-label") ?? "");

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
  // the card says what the shown result covers: the entry move from the
  // machine's position, merged in (step 4 plan 1c)
  await expect.poll(async () => await basisCard(page), { timeout: 30_000 })
    .toContain("The machine's position — the entry move included");
  const move = (await page.evaluate(() => window.__viewerDiag!.projectRole!("feed")))!;
  expect(move, "the collision's move is shown").not.toBeNull();
  // L7 runs along X; the plunge (L6) and the retract (L8) are along Z — a
  // point in the top view
  expect(Math.abs(move.dx), "L7's own move, along X").toBeGreaterThan(0.95);
  await ctl({ op: "reset" });
});

// C3 (plan 1.3/4.2): a contact in a called file reads its CALL line — in the
// list and in the code's marks — never the file's own number; without a
// verified call line it reads its subroutine's name and marks nothing. The
// traverse into the yoke and the retract run in sub "touch" whose own
// numbers (7, 8) are not this program's.
for (const [name, cline, label, marked] of [["a verified call line", 5, "L5", "5"], ["no verified call line", 0, "(touch)", null]] as const) {
  test(`a contact in a called file — ${name}: the list reads ${label}, the code marks ${marked ?? "nothing"} (C3, plan 1.3/4.2)`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await prepare(page, context, { file: `/c3-${cline}.ngc`, version: 3300 + cline, lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
      feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]],
      extra: { feed_lineok: new Uint8Array([1, 1, 0, 0]), feed_sub: new Uint8Array([255, 255, 0, 0]), sub_names: ["touch"],
               feed_cline: new Uint8Array(Uint16Array.from([0, 0, cline, cline]).buffer) } });
    await expect(clashRows(page).first(), "the nose in the yoke").toBeVisible({ timeout: 60_000 });
    await expect(clashRows(page).first().locator(".rowPick")).toHaveText(label);
    await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
    await page.getByRole("tab", { name: "Program", exact: true }).click();
    const marks = page.locator(".codeLine.collision .lineNumber");
    if (marked === null) await expect(marks, "no line, no mark").toHaveCount(0);
    else await expect(marks, "the call line, never the sub's own 7").toHaveText([marked]);
    await ctl({ op: "reset" });
  });
}

// Round B3: the tint and the timeline's band read the contact tables — the
// finding's own bodies light where the jump lands, the band covers the
// contact on the timeline, and both go where the pose leaves it.
test("the tint and the band are the contact tables': lit at the finding, a band over its contact, dark away from it (step 4 package 2, round B3)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await prepare(page, context, { file: "/tint.ngc", version: 2205, lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
    feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]] });
  await expect(clashRows(page).first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  // the band: over the contact's place on the timeline
  const bands = await page.locator(".scrubBar .scrubBand.clash").evaluateAll(els => els.map(e => (e as HTMLElement).style.left));
  expect(bands.length, "a contact band").toBeGreaterThan(0);
  // the first finding: its bodies lit where the jump lands
  await nextHit(page).click();
  await expect(page.locator(".simBanner")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getClashTint!()), { timeout: 15_000 }).toContain("a_yoke_casting");
  // the start of the program: nothing in contact there
  await slider(page).evaluate((el: HTMLInputElement) => {
    el.value = "0";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getClashTint!())).toEqual([]);
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
    .toBe("1 move runs from a position the preview cannot know — not checked until the position is known again (L4)");
  await openSimTab(page);
  const item = page.locator(".simPanel .simSummary .sumItem").first();
  await expect(item.locator('span[title^="Not certified"]'), "the marker").toHaveCount(1);
  await page.getByRole("button", { name: "Help: Collision check", exact: true }).click();
  await expect(page.locator(".helpPopover:popover-open")).toContainText("1 move runs from a position the preview cannot know");
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
    .toBe("1 move runs from a position the preview cannot know — not checked to the program's end: "
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

test("the contact tables reach the page: every delta applied and acknowledged in its generation (step 4 package 2, round B2)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await prepare(page, context, { file: "/crash-par.ngc", version: 2211, lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
    feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]] });
  await expect(clashRows(page).first(), "the nose in the yoke, found").toBeVisible({ timeout: 60_000 });
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  const s = (await page.evaluate(() => window.__viewerDiag!.getCollisionSummary!()))!;
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getContacts!().main?.rows?.intervals ?? 0),
    { message: "the program's touch intervals in the page's tables" }).toBeGreaterThan(0);
  const c = await page.evaluate(() => window.__viewerDiag!.getContacts!());
  expect(c.main!.shards, "one table per worker that swept").toBe(s.shards);
  expect(c.main!.pairs, "the pairs named").toBe(s.pairCount);
  expect(c.acks, "every delta acknowledged").toBe(c.messages);
  expect(c.dropped, "none dropped").toBe(0);
  // the view's targets — its touch intervals and near misses — come from these rows
  expect(c.main!.rows!.intervals + c.main!.rows!.episodes, "the rows behind the view's targets").toBeGreaterThanOrEqual(s.hits);
  expect(s.hits).toBeGreaterThan(0);
  expect(c.stats.allocated, "the memory the page holds for them").toBeGreaterThanOrEqual(c.stats.used);
  await ctl({ op: "reset" });
});

// C2 (Codex R167): what the sweep finds reaches the page in its tables alone,
// one delta unacknowledged per path. L3's traverse stops 1 mm short of the
// yoke — a near miss, its delta out first — and the touch (L4007) follows
// 4000 short moves later (slices apart). Every acknowledgement the page sends
// is HELD until the touch shows: the delta with the request's first interval
// goes beside the one out.
// (Measured: held, the touch waited out the whole hold — +395 ms at 300 ms.)
test("the first touch shows while the near miss's acknowledgement is held: its delta goes beside the one out (C2, Codex R167)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const tap = { hold: true, held: [] as Array<() => void>, acks: 0, ivs: [] as number[] };
    (window as unknown as { __ackTap: typeof tap }).__ackTap = tap;
    const Real = window.Worker;
    const Tapped = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      const post = w.postMessage.bind(w) as (m: unknown, t?: Transferable[]) => void;
      w.postMessage = ((m: unknown, t?: Transferable[]) => {
        if (m && typeof m === "object" && "contactsAck" in m && tap.hold) { tap.acks++; tap.held.push(() => post(m, t)); return; }
        post(m, t);
      }) as typeof w.postMessage;
      w.addEventListener("message", (ev: MessageEvent) => {
        const d = ev.data as { contacts?: Array<{ intervals: { count: number } }> };
        if (d?.contacts) tap.ivs.push(d.contacts.reduce((n, x) => n + x.intervals.count, 0));
      });
      return w;
    } as unknown as typeof Worker;
    Tapped.prototype = Real.prototype;
    window.Worker = Tapped;
  });
  const feed = [[0, 0, -100], [0, 0, -380], [124, 0, -380], [0, 0, -380], [0, 0, -100]], lines = [1, 2, 3, 4, 5];
  for (let i = 1; i <= 4000; i++) { feed.push([i % 2 ? 20 : 0, 0, -100 - (i % 40)]); lines.push(5 + i); }
  feed.push([0, 0, -380], [240, 0, -380], [240, 0, -100]);
  lines.push(4006, 4007, 4008);
  await prepare(page, context, { file: "/first-touch.ngc", version: 2291, feed, lines, joints: [-100, 0, 0, 0, 0] });
  const tap = () => page.evaluate(() => { const t = (window as unknown as { __ackTap: { acks: number; ivs: number[] } }).__ackTap; return { acks: t.acks, ivs: t.ivs.slice() }; });
  await expect(clashRows(page).filter({ hasNotText: /near miss/ }).first(), "the touch, its acknowledgements held").toBeVisible({ timeout: 30_000 });
  const t = await tap();
  expect(t.ivs[0], "the near miss's delta first, without an interval").toBe(0);
  expect(t.acks, "its acknowledgement (and the touch's) held").toBeGreaterThanOrEqual(1);
  // released: the rest goes as ever, one unacknowledged at a time
  await page.evaluate(() => { const t = (window as unknown as { __ackTap: { hold: boolean; held: Array<() => void> } }).__ackTap; t.hold = false; for (const h of t.held.splice(0)) h(); });
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  const c = await page.evaluate(() => window.__viewerDiag!.getContacts!());
  expect(c.acks, "every delta acknowledged").toBe(c.messages);
  expect(c.dropped, "none dropped").toBe(0);
  await ctl({ op: "reset" });
});

// Codex R147 VP-I106: the entry move's side run ends and its result stays
// shown; the main request, still running, sends its next tables — and the
// page let the side's tables go (its run was over, its result was not). They
// stay while the result is shown, and go once a new side result replaces it.
// (The other order — the main request done first — calls nothing that could
// drop them; the unit test holds both.)
test("a shown side result keeps its contact tables while the main request sends on; a replacing one lets them go (Codex R147 VP-I106)", async ({ page, context }) => {
  test.setTimeout(120_000);
  // the nose back and forth in the yoke: a main sweep of many slices
  const feed: number[][] = [[0, 0, -100], [0, 0, -380]], lines = [1, 6];
  for (let k = 0; k < 80; k++) { feed.push([k % 2 ? 0 : 240, 0, -380]); lines.push(7); }
  feed.push([0, 0, -100]); lines.push(8);
  await prepare(page, context, { file: "/side-tables.ngc", version: 2212, lines, joints: [-100, 0, 0, 0, 0], feed,
    // the main sweep holds after its first slice, as under a camera drag
    before: () => expect.poll(() => page.evaluate(() => { window.__viewerDiag?.setCameraHold?.(true); return !!window.__viewerDiag?.setCameraHold; })).toBe(true) });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getCollisionHoldLog?.() ?? []), { timeout: 60_000 })
    .toContain("camera on");
  // the simulation's entry move: a side run beside the held main request
  await page.locator(".scrubBar").getByRole("checkbox", { name: "Sim" }).check();
  await expect(page.locator(".simBanner")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getContacts!().entry?.tables?.id ?? null), { timeout: 60_000,
    message: "the entry result is shown with its tables" }).not.toBeNull();
  const entryId = (await page.evaluate(() => window.__viewerDiag!.getContacts!().entry!.id));
  expect(await sweepDone(page), "the main request still runs").toBe(false);
  const msgs = await page.evaluate(() => window.__viewerDiag!.getContacts!().messages);
  // the main request sends on: its tables are applied, the shown side's stay
  await page.evaluate(() => window.__viewerDiag!.setCameraHold!(false));
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  const c = await page.evaluate(() => window.__viewerDiag!.getContacts!());
  expect(c.messages, "the main request's tables arrived after the side result").toBeGreaterThan(msgs);
  expect(c.entry?.id, "the entry result is still the shown one").toBe(entryId);
  expect(c.entry?.tables, "and its tables are still held").not.toBeNull();
  // the machine moves: a new entry move, a new side result — the old one's tables go
  await ctl({ op: "status_delta", data: { joint_pos: [-60, 0, 0, 0, 0], actual_position: [-60, 0, 0, 0, 0] } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getContacts!().entry?.id ?? null), { timeout: 60_000,
    message: "a new entry result" }).not.toBe(entryId);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getContacts!().ids), { timeout: 30_000 }).not.toContain(entryId);
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
const basisOf = (page: Page) => page.evaluate(() => window.__viewerDiag?.getCollisionBasis?.() ?? null);
const g92z = (z: number) => [0, 0, z, 0, 0, 0, 0, 0, 0];

async function runReady(page: Page, context: BrowserContext, file: string, version: number,
  o: { lines?: number[]; extra?: Record<string, unknown> } = {}) {
  await prepare(page, context, { file, version, feed: RUN_FEED, lines: o.lines ?? [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
    extra: o.extra });
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
  expect(await previous()).toEqual({ collisions: found, text: `${found} collision${found === 1 ? "" : "s"}`,
                                    complete: true, version: 4121 });
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

// ---- Step 4 plan 1c: the card "Check basis" ----
/** The card's text, opened by its trigger (click) and closed again by it —
 *  never by Escape, which is E-Stop. */
async function basisCard(page: Page): Promise<string> {
  const trigger = page.getByRole("button", { name: "Check basis", exact: true });
  await trigger.click();
  const card = page.locator(".helpPopover:popover-open");
  await expect(card).toBeVisible();
  const text = await card.innerText();
  await trigger.click();
  await expect(card).toHaveCount(0);
  return text;
}
const machineCmds = async () => ((await ctl({ op: "lastCmds" }) as { cmds?: { cmd?: string }[] }).cmds ?? [])
  .map(c => c.cmd ?? "").filter(c => !["hello", "heartbeat", "get_tool_table", "timing_log", "tab_visibility"].includes(c));

test("the check basis card says what the check read when it began — a later status does not change it, a run's own change is named; keys, Escape is E-Stop (step 4 plan 1c)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const file = "/basiscard.ngc";
  await runReady(page, context, file, 4131);
  // a fresh check on a state of its own: G92 Z 2, the rotary axes read
  await ctl({ op: "status_delta", data: { g92_offset: g92z(2), rotary_abc: [0, 0, 0], g5x_index: 1 } });
  await expect.poll(async () => (await basisOf(page))?.g92[2], { timeout: 10_000 }).toBe(2);
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  const s = await page.evaluate(() => window.__viewerDiag!.getCollisionSummary!());
  expect(s!.pairsPrescreened).toBeGreaterThan(0);
  const text = await basisCard(page);
  for (const want of ["Check basis", "The machine when the check started",
                      // the kinematics the CHECK posed the program in: a payload without
                      // labels in the machine frame — though the layout mock stands in TCP
                      "Program kinematics\nMachine frame", "Rotary axes\nA 0.00° C 0.00°",
                      "G54 X 0.000 Y 0.000 Z 0.000 A 0.00° C 0.00°", "Z 2.000", "None — the check uses a stub body",
                      "The program's first point", `${s!.pairsPrescreened} pairs`])
    expect(text, want).toContain(want);
  expect(text).not.toContain("changed since");
  if (s!.staticContacts) expect(text, "the pairs at rest, by name").toContain("In contact at rest — excluded");
  // a status that is no input of the check moves nothing on the card
  await ctl({ op: "status_delta", data: { rotary_abc: [10, 0, 5] } });
  await page.waitForTimeout(800);
  expect(await sweepDone(page)).toBe(true);
  expect(await basisCard(page), "the card is the check's, not the status now").toBe(text);
  // a run's own G92 keeps the findings (plan „Prüfung im Lauf“ 2): the check's
  // basis is no longer the machine's state, and the card says so
  await ctl({ op: "quiet", on: true });
  await ctl({ op: "status_delta", envelope: runEnv(file), data: { interp_state: 2, task_mode: 2, g92_offset: g92z(5) } });
  await page.waitForTimeout(800);
  expect(await sweepDone(page), "no check began").toBe(true);
  const changed = await basisCard(page);
  expect(changed).toContain("The machine when the check started — changed since");
  expect(changed, "still the values the check read").toContain("Z 2.000");
  // keys: Enter opens it from its trigger; Escape stays E-Stop
  await page.getByRole("button", { name: "Check basis", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".helpPopover:popover-open")).toBeVisible();
  await ctl({ op: "clearCmds" });
  await page.keyboard.press("Escape");
  await expect.poll(machineCmds).toEqual(["estop"]);
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
const runLog = (page: Page) => page.evaluate(() => window.__viewerDiag?.getRunCheckLog?.() ?? []);
/** Publish `version` during the run and, once it is on screen, one status
 *  frame (the gateway sends 30 a second; `quiet` sends none): the run watcher
 *  attaches the position to the new track before the auto timer plans. */
async function publishInRun(page: Page, file: string, version: number, over: Record<string, unknown>) {
  await ctl({ op: "status_delta", envelope: originEnv(file, version, over), data: {} });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version, file } });
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getShownVersion?.() ?? null), { timeout: 10_000 }).toBe(version);
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
  // the page's collision telemetry: the browser-PC report binds a run
  // check's ACTIVE sweep by its request id and run generation (Codex R183)
  const tel: Array<Record<string, any>> = [];
  const perf: Array<Record<string, any>> = [];
  await page.route("**/telemetry", async (route) => {
    for (const line of (route.request().postData() ?? "").split("\n")) {
      try {
        const e = JSON.parse(line);
        if (String(e.kind).startsWith("collision.")) tel.push(e);
        else if (e.kind === "viewer.perf") perf.push(e);
      } catch { /* not ours */ }
    }
    await route.fulfill({ status: 204, body: "" });
  });
  await runReady(page, context, file, 4201);
  await ctl({ op: "quiet", on: true });
  await runOnL7(page, file, 4201);
  // quiet mode answers no heartbeat: answer them here while the check runs —
  // the browser-PC witness ticks follow answers (Codex R186)
  const answering = setInterval(() => { void ctl({ op: "hb_answer" }).catch(() => {}); }, 400);
  try {
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
  } finally {
    clearInterval(answering);
  }
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
  // the run check's two sweeps name its generation, each ends under its own id
  await expect.poll(() => tel.filter(e => e.kind === "collision.run_check_discarded").length, { timeout: 10_000 }).toBe(1);
  const gen = tel.find(e => e.kind === "collision.run_check_start")?.gen;
  expect(typeof gen).toBe("number");
  const runSweeps = tel.filter(e => e.kind === "collision.sweep_start" && e.run_gen === gen);
  expect(runSweeps.map(e => e.range_from === null ? "full" : "provisional")).toEqual(["provisional", "full"]);
  for (const st of runSweeps) {
    expect(tel.filter(e => ["collision.sweep_done", "collision.sweep_cancelled"].includes(e.kind) && e.id === st.id)
      .map(e => e.run_gen), `sweep ${st.id} ends once, in its generation`).toEqual([gen]);
  }
  // the check during the run said the ticks its real slices began after —
  // named by its request, generation and range, numbered on the page — and
  // handed each word to the WebSocket worker: a heartbeat sent after carries
  // it (Codex R186: the R witness's causal link); the idle check says none
  await expect.poll(() => tel.some(e => e.kind === "collision.sweep_witness"), { timeout: 15_000 }).toBe(true);
  const wit = tel.filter(e => e.kind === "collision.sweep_witness");
  for (const w of wit) {
    const st = runSweeps.find(x => x.id === w.id);
    expect(st, "only a check during a run").toBeDefined();
    expect([w.run_gen, w.range_from]).toEqual([gen, st!.range_from]);
    expect(w.tick).toBeGreaterThan(0);
  }
  expect(wit.map(w => w.n), "numbered in order on the page").toEqual(wit.map((_, i) => wit[0]!.n + i));
  type Pair = { seq: number; ta: number; dt: number | null; dn: number | null };
  const pairs = () => perf.flatMap(r => r.hb_pairs as Pair[]);
  // (answered here too: the heartbeat that carries a word must be answered to pair)
  const answering2 = setInterval(() => { void ctl({ op: "hb_answer" }).catch(() => {}); }, 400);
  try {
    await expect.poll(() => pairs().some(p => (p.dn ?? 0) >= wit[0]!.n), { timeout: 15_000 }).toBe(true);
  } finally {
    clearInterval(answering2);
  }
  const hbB = pairs().find(p => (p.dn ?? 0) >= wit[0]!.n)!;
  const w = wit.find(x => x.n === hbB.dn)!;
  expect(w, "the word the heartbeat names").toBeDefined();
  expect(hbB.dt, "with its tick").toBe(w.tick);
  const hbA = pairs().find(p => p.ta === w.tick);
  expect(hbA, "the answer the tick followed").toBeDefined();
  expect(hbA!.seq, "answered before the heartbeat that names the word").toBeLessThan(hbB.seq);
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
    return page.evaluate(() => window.__viewerDiag?.getCollisionStopped?.()?.reason ?? null);
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

// ---- Codex R116: the provisional result's own limits, and a worker that asks for the bodies ----
type TapReq = { id: number; kind: "provisional" | "full" | "other"; range: number | null; bodies: boolean; dropped: boolean };
interface ColTap {
  reqs: TapReq[];
  /** answer the next request of this kind with "needBodies" (each once) */
  drop: Array<"provisional" | "full">;
  /** hold the full check's result until `release` */
  holdFull: boolean;
  held: Array<() => void>;
  /** fields laid over the provisional result as it arrives */
  patchProvisional: Record<string, unknown> | null;
  /** The provisional request's contact tables as they arrive (round B3: the
   *  views read them): the episodes of these pairs made boundary contacts,
   *  and the contact of `cut.pair` ended at `cut.at` */
  boundaryPairs: Array<[string, string]>;
  cut: { pair: [string, string]; at: number } | null;
}
/** A tap on the page's collision worker: it records the main requests,
 *  answers a chosen one with the worker's own "needBodies" (a worker that
 *  lost the model), lays fields over the provisional result and holds the
 *  full check's result. Installed before the page loads. */
async function installWorkerTap(page: Page) {
  await page.addInitScript(() => {
    const tap = { reqs: [], drop: [], holdFull: false, held: [], patchProvisional: null,
      boundaryPairs: [], cut: null } as unknown as ColTap;
    (window as unknown as { __colTap: ColTap }).__colTap = tap;
    const Real = window.Worker;
    const Tapped = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      const kinds = new Map<number, TapReq["kind"]>();
      let sawRange = false;
      let handler: ((ev: MessageEvent) => unknown) | null = null;
      const post = w.postMessage.bind(w) as (m: unknown, t?: Transferable[]) => void;
      w.postMessage = ((msg: { id: number; track?: unknown; side?: boolean; bodies?: unknown; options?: { range?: { from: number } } },
                        transfer?: Transferable[]) => {
        if (msg && typeof msg === "object" && "track" in msg && !msg.side) {
          const range = msg.options?.range?.from ?? null;
          const kind: TapReq["kind"] = range != null ? "provisional" : sawRange ? "full" : "other";
          if (range != null) sawRange = true;
          kinds.set(msg.id, kind);
          const i = tap.drop.indexOf(kind as "provisional" | "full");
          tap.reqs.push({ id: msg.id, kind, range, bodies: !!msg.bodies, dropped: i >= 0 });
          if (i >= 0) {
            tap.drop.splice(i, 1);
            setTimeout(() => handler?.(new MessageEvent("message", { data: { id: msg.id, needBodies: true } })), 0);
            return;
          }
        }
        post(msg, transfer);
      }) as typeof w.postMessage;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler,
        set: (fn: ((ev: MessageEvent) => unknown) | null) => { handler = fn; } });
      // the provisional request's tables: its pair names and, per table, the
      // pair of each episode row seen so far
      const pairsOf = new Map<number, Array<[string, string]>>(), epPair = new Map<string, number>();
      type Col = Record<string, ArrayLike<number> & { [i: number]: number }>;
      const patchTables = (id: number, contacts: Array<{ episodes: { from: number; count: number; rows: Col; updates: ArrayLike<number>; updated: Col };
                                                       intervals: { from: number; count: number; rows: Col; updates: ArrayLike<number>; updated: Col } }>) => {
        const names = pairsOf.get(id) ?? [];
        const is = (pair: number, ab: [string, string]) => names[pair]?.[0] === ab[0] && names[pair]?.[1] === ab[1];
        contacts.forEach((delta, k) => {
          const eps: Array<[Col, number, (i: number) => number]> = [[delta.episodes.rows, delta.episodes.count, i => delta.episodes.from + i],
            [delta.episodes.updated, delta.episodes.updates.length, i => delta.episodes.updates[i]!]];
          for (const [c, n, rowOf] of eps) for (let i = 0; i < n; i++) {
            const pair = c.pair![i]!;
            epPair.set(`${id}:${k}:${rowOf(i)}`, pair);
            if (tap.boundaryPairs.some(ab => is(pair, ab))) c.flags![i] = (c.flags![i]! & ~3) | 3;
            if (tap.cut && is(pair, tap.cut.pair) && !(c.end![i]! <= tap.cut.at)) c.end![i] = tap.cut.at;
          }
          const ivs: Array<[Col, number]> = [[delta.intervals.rows, delta.intervals.count], [delta.intervals.updated, delta.intervals.updates.length]];
          for (const [c, n] of ivs) for (let i = 0; i < n; i++) {
            const pair = epPair.get(`${id}:${k}:${c.episode![i]}`);
            if (tap.cut && pair !== undefined && is(pair, tap.cut.pair) && !(c.exit![i]! <= tap.cut.at)) c.exit![i] = tap.cut.at;
          }
        });
      };
      w.addEventListener("message", (ev: MessageEvent) => {
        const d = ev.data as { id: number; result?: Record<string, unknown>; contacts?: Parameters<typeof patchTables>[1]; contactPairs?: Array<[string, string]> };
        const kind = d && kinds.get(d.id);
        if (d?.contactPairs) pairsOf.set(d.id, d.contactPairs);
        if (d?.contacts && kind === "provisional") patchTables(d.id, d.contacts);
        if (d?.result && kind === "provisional" && tap.patchProvisional) Object.assign(d.result, structuredClone(tap.patchProvisional));
        if (d?.result && kind === "full" && tap.holdFull) { tap.held.push(() => handler?.(ev)); return; }
        handler?.(ev);
      });
      return w;
    } as unknown as typeof Worker;
    Tapped.prototype = Real.prototype;
    window.Worker = Tapped;
  });
}
const colTap = <T>(page: Page, f: (t: ColTap) => T) =>
  page.evaluate(`(${f.toString()})(window.__colTap)`) as Promise<T>;
const releaseFull = (page: Page) => page.evaluate(() => {
  const t = (window as unknown as { __colTap: ColTap }).__colTap;
  t.holdFull = false;
  for (const h of t.held.splice(0)) h();
});

test("a worker that asks for the bodies gets the same request again — provisional and full keep their range, run and the result on screen (Codex R116 VP-I70)", async ({ page, context }) => {
  test.setTimeout(150_000);
  await installWorkerTap(page);
  const file = "/runbodies.ngc";
  await runReady(page, context, file, 4241);
  await page.evaluate(() => {
    const t = (window as unknown as { __colTap: ColTap }).__colTap;
    t.drop = ["provisional", "full"];
    t.holdFull = true;
  });
  await ctl({ op: "quiet", on: true });
  await runOnL7(page, file, 4241);
  await publishInRun(page, file, 4242, pinnedFor(9));
  const runReqs = () => colTap(page, t => t.reqs.filter(q => q.kind !== "other").map(q => [q.kind, q.range, q.bodies, q.dropped]));
  // the full check's own retry is out and its result held: each retry is the
  // request it repeats, with the bodies this time
  await expect.poll(runReqs, { timeout: 60_000 }).toEqual([
    ["provisional", 1, false, true], ["provisional", 1, true, false],
    ["full", null, false, true], ["full", null, true, false]]);
  expect(await runLog(page)).toEqual(["start provisional 1", "full"]);
  // the provisional result stays on screen while the full check runs
  expect(await page.evaluate(() => window.__viewerDiag!.getCollisionRange!()), "the provisional result kept").not.toBeNull();
  await expect(page.locator(".simSummary .sumItem").first()).toHaveAttribute("aria-label", /provisional from /);
  await releaseFull(page);
  await expect.poll(() => runLog(page), { timeout: 30_000 }).toEqual(["start provisional 1", "full", "done"]);
  await expect(page.locator(".simSummary .sumItem").first()).toHaveAttribute("aria-label", /· checked in full$/);
  expect(await page.evaluate(() => window.__viewerDiag!.getCollisionRange!()), "the full check replaced it").toBeNull();
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// Live 2026-10-09 (M600 run on the XYZAC sim): the provisional check began
// in the measuring routine and said "from L339" of a 60-line program — the
// routine's own line. It names the call line the code panel shows there.
test("a run check that begins inside a called routine names its call line, never the routine's own number (live 2026-10-09)", async ({ page, context }) => {
  test.setTimeout(150_000);
  await installWorkerTap(page);
  const file = "/runsub.ngc";
  // the run's point (X 120) lies in tool_touch_off.ngc's line 339, called from L7
  await runReady(page, context, file, 4261, { lines: [1, 6, 339, 8], extra: {
    feed_lineok: new Uint8Array([1, 1, 0, 1]), feed_sub: new Uint8Array([255, 255, 0, 255]),
    feed_cline: new Uint8Array(new Uint16Array([0, 0, 7, 0]).buffer), sub_names: ["tool_touch_off"] } });
  await page.evaluate(() => { (window as unknown as { __colTap: ColTap }).__colTap.holdFull = true; });
  await ctl({ op: "quiet", on: true });
  await runOnL7(page, file, 4261);
  await publishInRun(page, file, 4262, pinnedFor(9));
  await expect.poll(() => runLog(page), { timeout: 60_000 }).toEqual(["start provisional 1", "full"]);
  const item = page.locator(".simSummary .sumItem").first();
  await expect(item).toHaveAttribute("aria-label", /provisional from L7/);
  expect(await item.getAttribute("aria-label")).not.toContain("339");
  await releaseFull(page);
  await expect.poll(() => runLog(page), { timeout: 30_000 }).toEqual(["start provisional 1", "full", "done"]);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// VP-I68: while the full check runs behind it, the provisional result on
// screen keeps its OWN limits — the band where it stopped, its star, its
// words; VP-I69: what it found in contact at its start stays provisional in
// the "?" (every contact) and on the code lines. The control: the full check
// replaces all of it.
test("the provisional result keeps its own limits while the full check runs, its contacts at the start stay provisional — then a full check replaces them (Codex R116 VP-I68/I69)", async ({ page, context }) => {
  test.setTimeout(150_000);
  await installWorkerTap(page);
  const file = "/runlimits.ngc";
  await runReady(page, context, file, 4251);
  const contact = (a: string, b: string, line: number, cutting = false) => ({ a, b, line, cum: 280, dist: 0, cutting });
  await page.evaluate(([bc]) => {
    const t = (window as unknown as { __colTap: ColTap }).__colTap;
    t.holdFull = true;
    // stopped at 75 % of the program and not certified (past the contacts
    // it found: they reach 552 of 800 — the views show nothing past it)
    t.patchProvisional = { truncated: { covered: 0.75, reason: "samples" }, uncertified: "a body was left out", boundaryContacts: bc };
    // L7: the nose's contact its own, the tool's provisional (after it);
    // L8: provisional only — in the tables the views read: the tool's
    // contact a boundary one, the nose's ended on L7 (L7 is (280, 520])
    t.boundaryPairs = [["tool", "a_yoke_casting"]];
    t.cut = { pair: ["spindle_nose", "a_yoke_casting"], at: 515 };
  }, [[contact("tool", "a_yoke_casting", 7), contact("spindle_nose", "a_yoke_casting", 7), contact("x_saddle", "column", 7),
       contact("y_saddle", "column", 7), contact("tool", "work_piece", 7, true)]] as const);
  await ctl({ op: "quiet", on: true });
  await runOnL7(page, file, 4251);
  // the program switched the fixture meanwhile: the run's start is G54
  await ctl({ op: "status_delta", data: { g5x_index: 2 } });
  await publishInRun(page, file, 4252, pinnedFor(9));
  await expect.poll(() => runLog(page), { timeout: 60_000 }).toEqual(["start provisional 1", "full"]);
  await expect.poll(() => colTap(page, t => t.held.length), { timeout: 60_000 }).toBe(1);
  const band = async () => {
    const st = (await page.locator(".scrubBand.swept").getAttribute("style")) ?? "";
    const [from, width] = [...st.matchAll(/\* ([\d.e-]+)\)/g)].map(m => Number(m[1]));
    return [Math.round(from! * 1000) / 1000, Math.round((from! + width!) * 1000) / 1000];
  };
  const item = page.locator(".simSummary .sumItem").first();
  const help = async () => {
    await page.getByRole("button", { name: "Help: Collision check", exact: true }).click();
    const text = await page.locator(".helpPopover:popover-open").innerText();
    await page.keyboard.press("Tab");   // light dismiss without Escape (E-Stop)
    await page.mouse.click(5, 5);
    return text;
  };
  // the full check runs (its result held) — on screen the provisional result
  expect(await band(), "the band: from L7 to where it stopped").toEqual([0.35, 0.75]);
  await expect(item).toHaveAttribute("aria-label", /provisional from L7, stopped at 75 % \(not certified\)$/);
  await expect(item.locator('span[title^="Not certified"]'), "its star").toHaveCount(1);
  const text = await help();
  expect(text).toContain("Stopped at 75 % of the program — the rest is unchecked.");
  expect(text).toContain("Not certified: Clearance guarantee not certified for this sweep: a body was left out");
  expect(text).not.toContain("Still checking");
  // every contact at its start, with the lines it stays on provisionally
  for (const s of ["Tool ↔ A yoke casting (L7, provisional to L8)", "Spindle nose ↔ A yoke casting (L7)",
    "X saddle ↔ Column (L7)", "Y saddle ↔ Column (L7)", "Tool ↔ Work piece (L7, the cutter in the stock)"]) {
    expect(text, s).toContain(s);
  }
  // the card (step 4 plan 1c) describes the result on screen — the
  // provisional one, from the run's start — not the full check behind it
  const card = await basisCard(page);
  for (const s of ["The run's start (run 9)", "From L7, provisional", "G54 X 0.000", "Rotary axes\nNot read",
                   "In contact at the check's start", "Tool ↔ A yoke casting (L7)", "Spindle nose ↔ A yoke casting (L7)"]) {
    expect(card, s).toContain(s);
  }
  // the code lines: L8 provisional, L7 the nose's own contact
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  const codeLine = (n: number) => page.locator(".codeLine").filter({ has: page.locator(".lineNumber", { hasText: new RegExp(`^${n}$`) }) });
  await expect(codeLine(8)).toHaveAttribute("title", /in contact at the check's start \(provisional\)/);
  await expect(codeLine(7)).toHaveAttribute("title", /^collision clearance hit/);
  await openSimTab(page);
  // the control: the full check, clean, replaces it all
  await releaseFull(page);
  await expect.poll(() => runLog(page), { timeout: 30_000 }).toEqual(["start provisional 1", "full", "done"]);
  await expect(item).toHaveAttribute("aria-label", /· checked in full$/);
  await expect(item.locator('span[title^="Not certified"]')).toHaveCount(0);
  expect(await band()).toEqual([0, 1]);
  const after = await help();
  expect(after).not.toContain("In contact at the check's start");
  expect(after).not.toContain("the rest is unchecked");
  const fullCard = await basisCard(page);
  expect(fullCard, "the card follows the result: the full check").toContain("The whole program");
  expect(fullCard).not.toContain("In contact at the check's start");
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await expect(codeLine(8)).not.toHaveAttribute("title", /provisional/);
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
    body: Buffer.from(encode({ file, preview_schema: 11, feed, feed_lines: [1, 2, 3, 4], feed_seq: [1, 2, 3, 4],
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
      body: Buffer.from(encode({ file, preview_schema: 11, rapid: [[0, 0, -10], [20, 0, -10]], rapid_seq: [1, 2],
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
    body: Buffer.from(encode({ file, preview_schema: 11, feed: [[0, 0, 0], [10, 0, 0]], feed_lines: [1, 2], feed_seq: [1, 2],
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
      body: Buffer.from(encode({ file, preview_schema: 11, rapid, rapid_seq: [1, 2], rapid_lines: [1, 2],
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
    body: Buffer.from(encode({ file, preview_schema: 11, feed, feed_lines: [1, 2, 3, 4], feed_seq: [1, 2, 3, 4],
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

// Codex R137 VP-I93: a run check's bound beginning is a side sweep; what it
// finds — early (its first confirmed contact) and final — reaches the list
// and the verdict, the beginning said still checking until its result. The
// bar used to take the bare base result: the beginning's findings never
// showed. Real page, decode and main sweep; only the side request's
// transport is answered here (a known contact now, the result later).
/** A run check whose bound beginning's side request the page answers itself;
 *  the main check done, the side request waiting. */
async function sideRunReady(page: Page, context: BrowserContext) {
  await page.addInitScript({ content: FROM_WIRE_INIT });
  await page.addInitScript(() => {
    const tap: any = { side: null, deliver: null, first: null, pairs: null };
    (window as any).__sideTap = tap;
    const Real = window.Worker;
    const Tapped = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      const post = w.postMessage.bind(w);
      let handler: any = null;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
      w.addEventListener("message", ev => { if (ev.data?.contactPairs && ev.data.id !== tap.side?.id) tap.pairs = ev.data.contactPairs; handler?.(ev); });
      w.postMessage = ((m: any, t?: Transferable[]) => {
        if (m?.side && m.track) { tap.side = m; tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: { id: m.id, ...d } })); return; }
        post(m, t ?? []);
      }) as any;
      return w;
    } as any;
    Tapped.prototype = Real.prototype;
    window.Worker = Tapped;
  });
  const file = "/side-run.ngc";
  await runReady(page, context, file, 7137);
  await ctl({ op: "quiet", on: true });
  const start = { ...runEnv(file).run_basis.start, joints: [-100, 0, -100, 0, 0], joints_why: null };
  await ctl({ op: "status_delta", envelope: { ...runEnv(file, { run_id: 9, start }), ...originEnv(file, 7137) },
    data: { interp_state: 2, task_mode: 2, motion_line: 7, joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] } });
  // the parse made for the run: a native payload with a start-dependent beginning
  const native = decode(readFileSync(new URL("../../scripts/test_fixtures/start_dep_payloads/e_single.msgpack", import.meta.url))) as any;
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: Buffer.from(encode({ ...native, file })) }));
  await publishInRun(page, file, 7138, pinnedFor(9));
  await expect.poll(() => page.evaluate(() => (window as any).__sideTap.side !== null), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => runLog(page), { timeout: 60_000 }).toContain("done");
  await expect(page.locator(".simPanel .simSummary .sumItem").first()).toHaveAttribute("aria-label", "No contact · start still checking");
  await expect(clashRows(page)).toHaveCount(0);
}
/** The side request's contact table as the spec answers it (the views read
 *  the tables). */
const sideTables = new WeakMap<Page, ContactStore>();
/** The side sweep's first touch, delivered: its table — one contact of the
 *  model's first pair, inside the move from point `seg` to `seg + 1` of the
 *  side track (the line of that move, kept in `first` for the spec). Point 0
 *  is the start the run stood at: the move to point 1 is the entry — the
 *  program's first move from there, whose line the track does not carry
 *  (prependEntry, W2 P6; plan 1.3, C3) — point 1 → 2 the beginning's next
 *  move, of a line the track carries. */
const sideFirst = async (page: Page, seg = 1) => {
  const { id, at, pairs } = await page.evaluate(seg => {
    const t = (window as any).__sideTap;
    return { id: t.side.id as number, at: (t.side.track.cum[seg] + t.side.track.cum[seg + 1]) / 2 as number, pairs: t.pairs as Array<[string, string]> | null };
  }, seg);
  const st = oneContact(id, 0, at, at);
  sideTables.set(page, st);
  await page.evaluate(([w, pairs, seg]) => {
    const t = (window as any).__sideTap, i = seg + 1;
    const [a, b] = pairs?.[0] ?? ["spindle_nose", "a_yoke"];
    t.first = { line: t.side.track.lines[i] || 2, cum: t.side.track.cum[i], cumEnd: t.side.track.cum[i], a, b, dist: 0, rapid: true };
    t.deliver({ progress: 0.2, contacts: [(window as any).__fromWire(w)], contactPairs: pairs ?? [[a, b]] });
  }, [wireDelta(st), pairs, seg] as const);
};
/** The side request's result, its last (empty) delta riding with it. */
const sideResultMsg = async (page: Page) => {
  const w = wireDelta(sideTables.get(page)!);
  await page.evaluate(w => {
    const t = (window as any).__sideTap;
    t.deliver({ contacts: [(window as any).__fromWire(w)], result: { staticContacts: [], samples: 10, coarsened: false,
      uncertified: null, pairCount: 1, pairsPrescreened: 0, bvhMs: 0, sweepMs: 100, truncated: null } });
  }, w);
};

test("a run's bound beginning: its contact reaches the list early and final, the verdict says what is checked (Codex R137 VP-I93)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await sideRunReady(page, context);
  const clash = page.locator(".simPanel .simSummary .sumItem").first();
  // early: the side sweep's first confirmed contact
  await sideFirst(page);
  await expect(clash, "early: the contact, the beginning still checking").toHaveAttribute("aria-label", /^1 collision.* · start still checking$/);
  await expect(clashRows(page), "early: in the list").toHaveCount(1);
  // ...and in the code panel's marks: the same result
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await expect(page.locator(".codeLine.collision"), "early: marked in the code").toHaveCount(1);
  // ...on the line it is on: the side track's own (round B3 — the base axis
  // folds the whole beginning to 0, where other lines lie)
  const own = await page.evaluate(() => (window as any).__sideTap.first.line as number);
  expect(await page.locator(".codeLine.collision .lineNumber").innerText(), "the beginning's own line").toBe(String(own));
  await openSimTab(page);
  // final: its result with the same contact
  await sideResultMsg(page);
  await expect(clash, "final: checked, the beginning with it").toHaveAttribute("aria-label", /^1 collision.* · checked in full$/);
  await expect(clashRows(page), "final: in the list").toHaveCount(1);
  expect(await runLog(page)).toContain("beginning");
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// C3 (plan 1.3): a contact on the entry — the program's first move, from where
// the run stood to its first point, whose display line the track does not
// carry (prependEntry, W2 P6; Codex R172: a limitation of the line's origin,
// not a move outside the program) — reads "entry" and marks no code line:
// never the raw line of the point it ends at.
test("a run's bound beginning: a contact on the entry reads \"entry\" and marks no code line (C3, plan 1.3)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await sideRunReady(page, context);
  await sideFirst(page, 0);
  await expect(clashRows(page), "in the list").toHaveCount(1);
  await expect(clashRows(page).first().locator(".rowPick")).toHaveText("entry");
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await expect(page.locator(".codeLine.collision"), "the track carries no display line for it").toHaveCount(0);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// Codex R172 VP-I125: an undecidable stretch on a run's beginning — a folded
// source — reads its OWN track's lines, as its contact's row does; mapped onto
// the base's axis it read the base's ("L4–L3").
test("a run's beginning: an undecidable stretch on its own move reads the line its contact reads (Codex R172 VP-I125)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await sideRunReady(page, context);
  await sideFirst(page);
  const own = await page.evaluate(() => {
    const t = (window as any).__sideTap, c = t.side.track.cum;
    return { line: t.first.line as number, start: c[1] + (c[2] - c[1]) * 0.75, end: c[1] + (c[2] - c[1]) * 0.9 };
  });
  sideTables.get(page)!.gaps.append({ pair: 0, start: own.start, end: own.end, reason: GAP_UNDECIDABLE });
  await sideResultMsg(page);
  await expect(page.locator(".simPanel .simSummary .sumItem").first()).toHaveAttribute("aria-label", /checked to the end/);
  await expect(clashRows(page)).toHaveCount(1);
  await expect(clashRows(page).first().locator(".rowPick")).toHaveText(`L${own.line}`);
  await page.getByRole("button", { name: "Help: Collision check", exact: true }).click();
  const help = await page.locator(".helpPopover:popover-open").innerText();
  await page.keyboard.press("Tab");
  await page.mouse.click(5, 5);
  expect(help, "the note reads the side's own line").toContain(`(L${own.line})`);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// Codex R172 VP-I126: a run check's range metadata — a boundary contact —
// shows before the first table does; its line is the display line of the
// track there (a move in "touch" with no verified call line: its name), never
// the sweep's raw L7 — before the first delta and after it alike.
test("a boundary contact before the first table: the basis card reads its display line, never the raw one (Codex R172 VP-I126)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.addInitScript({ content: FROM_WIRE_INIT });
  await page.addInitScript(() => {
    const tap: any = { main: null, deliver: null };
    (window as any).__r173 = tap;
    const Real = window.Worker;
    const Tap = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      const post = w.postMessage.bind(w);
      let handler: any = null;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
      w.addEventListener("message", e => handler?.(e));
      tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: d }));
      // the range request is this spec's: no worker answer races it
      w.postMessage = ((m: any, t?: Transferable[]) => { if (m?.track && !m.side && m.options?.range) { tap.main = m; return; } post(m, t ?? []); }) as any;
      return w;
    } as any;
    Tap.prototype = Real.prototype;
    window.Worker = Tap;
  });
  const file = "/r173-meta.ngc";
  await runReady(page, context, file, 31731);
  await ctl({ op: "quiet", on: true });
  await runOnL7(page, file, 31731);
  const payload = { file, preview_schema: 11, feed: RUN_FEED, feed_lines: [1, 6, 7, 8], feed_seq: [1, 2, 3, 4],
    feed_outside: new Uint8Array(4), rapid: [], violations: [], violations_total: 0,
    feed_lineok: new Uint8Array([1, 1, 0, 0]), feed_sub: new Uint8Array([255, 255, 0, 0]), sub_names: ["touch"],
    feed_cline: new Uint8Array(Uint16Array.from([0, 0, 0, 0]).buffer) };
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: Buffer.from(encode(payload)) }));
  await publishInRun(page, file, 31732, pinnedFor(9));
  await expect.poll(() => page.evaluate(() => (window as any).__r173.main?.id ?? null)).not.toBeNull();
  const m = await page.evaluate(() => { const m = (window as any).__r173.main; return { id: m.id as number, at: m.track.cum[m.options.range.from] as number, range: m.options.range }; });
  expect(m.range, "the run's provisional check").toEqual({ from: 1 });
  const metadata = { staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 1,
    pairsPrescreened: 0, bvhMs: 0, sweepMs: 10, truncated: { covered: 0.3, reason: "running" },
    range: { fromCum: m.at, fromLine: 7 },
    boundaryContacts: [{ a: "tool", b: "work_piece", line: 7, cum: m.at, dist: 0, cutting: true }] };
  // before the first table: the metadata alone
  await page.evaluate(d => (window as any).__r173.deliver(d), { id: m.id, progress: 0.3, partial: metadata });
  await expect(page.locator(".simPanel .simSummary .sumItem").first()).toHaveAttribute("aria-label", /No contact so far · provisional from L7/);
  expect(await page.evaluate(() => window.__viewerDiag!.getContacts!().main), "no table yet").toBeNull();
  const before = await basisCard(page);
  expect(before, "its name — never the raw L7").toContain("Tool ↔ Work piece (touch)");
  // after the first (empty) table: the same
  const w = wireDelta(new ContactStore(m.id, 0));
  await page.evaluate(([d, w]) => (window as any).__r173.deliver({ ...d, contacts: [(window as any).__fromWire(w)] }),
    [{ id: m.id, progress: 0.4, partial: { ...metadata, truncated: { covered: 0.4, reason: "running" } }, contactPairs: [["tool", "work_piece"]] }, w] as const);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getContacts!().main)).not.toBeNull();
  expect(await basisCard(page), "after the first table alike").toContain("Tool ↔ Work piece (touch)");
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// Codex R138 VP-I93: the beginning's contact before the MAIN request's first
// partial — a main sweep finding nothing posts no partial until it ends, and
// the contact waited for it. The main request's messages are held here (its
// real sweep, its real result), the side request answered by the page.
/** A run check with the main request's messages held and the side request
 *  waiting: nothing shown yet. */
async function sideRunHeld(page: Page, context: BrowserContext, file = "/side-held.ngc") {
  await page.addInitScript({ content: FROM_WIRE_INIT });
  await page.addInitScript(() => {
    const tap: any = { side: null, deliver: null, first: null, hold: false, mainId: null, main: [], raw: null, pairs: null };
    (window as any).__sideTap = tap;
    const Real = window.Worker;
    const Tapped = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      const post = w.postMessage.bind(w);
      let handler: any = null;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
      tap.raw = (d: any) => handler?.(new MessageEvent("message", { data: d }));
      w.addEventListener("message", ev => {
        if (ev.data?.contactPairs && ev.data.id !== tap.side?.id) tap.pairs = ev.data.contactPairs;
        if (ev.data?.id === tap.mainId) { tap.main.push(ev.data); return; }
        handler?.(ev);
      });
      w.postMessage = ((m: any, t?: Transferable[]) => {
        if (m?.side && m.track) { tap.side = m; tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: { id: m.id, ...d } })); return; }
        if (m?.track && tap.hold) { tap.mainId = m.id; tap.main = []; }
        post(m, t ?? []);
      }) as any;
      return w;
    } as any;
    Tapped.prototype = Real.prototype;
    window.Worker = Tapped;
  });
  await runReady(page, context, file, 7137);
  await ctl({ op: "quiet", on: true });
  const start = { ...runEnv(file).run_basis.start, joints: [-100, 0, -100, 0, 0], joints_why: null };
  await ctl({ op: "status_delta", envelope: { ...runEnv(file, { run_id: 9, start }), ...originEnv(file, 7137) },
    data: { interp_state: 2, task_mode: 2, motion_line: 7, joint_pos: [120, 0, -380, 0, 0], actual_position: [120, 0, -380, 0, 0] } });
  const native = decode(readFileSync(new URL("../../scripts/test_fixtures/start_dep_payloads/e_single.msgpack", import.meta.url))) as any;
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: Buffer.from(encode({ ...native, file })) }));
  // from the run's publication on, the main request's messages are held
  await page.evaluate(() => { (window as any).__sideTap.hold = true; });
  await publishInRun(page, file, 7138, pinnedFor(9));
  await expect.poll(() => page.evaluate(() => (window as any).__sideTap.side !== null), { timeout: 30_000 }).toBe(true);
  // the main request's real messages, held — none of them delivered yet
  await expect.poll(() => page.evaluate(() => (window as any).__sideTap.main.some((m: any) => m.result)), { timeout: 60_000 }).toBe(true);
  await expect(page.locator(".simPanel .simSummary .sumItem").first()).toHaveAttribute("aria-label", /^No contact so far/);
  await expect(clashRows(page)).toHaveCount(0);
}
/** The held main request: a running partial of its real result, then the result. */
const mainPartial = (page: Page, covered: number) => page.evaluate(c => {
  const t = (window as any).__sideTap, end = t.main.find((m: any) => m.result);
  t.raw({ id: t.mainId, progress: c, partial: { ...end.result, truncated: { covered: c, reason: "running" } } });
}, covered);
const mainResult = (page: Page) => page.evaluate(() => { const t = (window as any).__sideTap; t.raw(t.main.find((m: any) => m.result)); });
const sideResult = sideResultMsg;
const codeMarks = async (page: Page) => {
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  const n = await page.locator(".codeLine.collision").count();
  await openSimTab(page);
  return n;
};

test("a run's beginning: its contact before the main request's first partial, then with it, then final (Codex R138 VP-I93)", async ({ page, context }) => {
  test.setTimeout(150_000);
  await sideRunHeld(page, context);
  const clash = page.locator(".simPanel .simSummary .sumItem").first();
  await sideFirst(page);
  await expect(clash, "early, no main partial: the contact, the main request still running").toHaveAttribute("aria-label", /^1 collision.* so far · <1 % checked/);
  await expect(clash).not.toHaveAttribute("aria-label", /checked in full/);
  await expect(clashRows(page), "in the list").toHaveCount(1);
  expect(await codeMarks(page), "marked in the code").toBe(1);
  // the main request's first partial, finding nothing of its own: the contact stays
  await mainPartial(page, 0.5);
  await expect(clash, "with the main partial: the contact kept, still running").toHaveAttribute("aria-label", /^1 collision.* so far · /);
  await expect(clash).not.toHaveAttribute("aria-label", /checked in full/);
  await expect(clashRows(page)).toHaveCount(1);
  // both results: checked
  await mainResult(page);
  await sideResult(page);
  await expect(clash, "final").toHaveAttribute("aria-label", /^1 collision.* · checked in full$/);
  await expect(clashRows(page)).toHaveCount(1);
  expect(await codeMarks(page)).toBe(1);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("a run's beginning that ends with its result before the main request's first partial shows it, the main request still running (Codex R138 VP-I93)", async ({ page, context }) => {
  test.setTimeout(150_000);
  await sideRunHeld(page, context);
  const clash = page.locator(".simPanel .simSummary .sumItem").first();
  await sideFirst(page);
  await sideResult(page);
  await expect(clash, "the beginning checked, the main request not yet").toHaveAttribute("aria-label", /^1 collision.* so far · /);
  await expect(clash).not.toHaveAttribute("aria-label", /checked in full/);
  await expect(clashRows(page)).toHaveCount(1);
  expect(await codeMarks(page)).toBe(1);
  await mainResult(page);
  await expect(clash).toHaveAttribute("aria-label", /^1 collision.* · checked in full$/);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

for (const end of ["error", "cancelled"] as const) {
  test(`a run's beginning that ends without a result (${end}) before the main request's first partial takes its contact out (Codex R138 VP-I93)`, async ({ page, context }) => {
    test.setTimeout(150_000);
    await sideRunHeld(page, context);
    const clash = page.locator(".simPanel .simSummary .sumItem").first();
    await sideFirst(page);
    await expect(clashRows(page)).toHaveCount(1);
    await page.evaluate(e => (window as any).__sideTap.deliver(e === "error" ? { error: "injected" } : { cancelled: true }), end);
    await expect(clash).toHaveAttribute("aria-label", /^No contact so far/);
    await expect(clashRows(page)).toHaveCount(0);
    expect(await codeMarks(page), "the early mark is gone too").toBe(0);
    await mainResult(page);
    await expect(clash).toHaveAttribute("aria-label", "Clear · start not checked");
    await expect(clashRows(page)).toHaveCount(0);
    await ctl({ op: "quiet", on: false });
    await ctl({ op: "reset" });
  });
}

test("a run's beginning's contact before the main request's first partial belongs to its request: a new one takes nothing along (Codex R138 VP-I93)", async ({ page, context }) => {
  test.setTimeout(150_000);
  const file = "/side-held.ngc";
  await sideRunHeld(page, context, file);
  await sideFirst(page);
  await expect(clashRows(page)).toHaveCount(1);
  // another publication for the run: a new main request and a new side request
  await page.evaluate(() => { (window as any).__sideTap.side = null; });
  await publishInRun(page, file, 7139, pinnedFor(9));
  await expect.poll(() => page.evaluate(() => (window as any).__sideTap.side !== null), { timeout: 30_000 }).toBe(true);
  await expect(clashRows(page), "the old contact is not the new request's").toHaveCount(0);
  await expect(page.locator(".simPanel .simSummary .sumItem").first()).not.toHaveAttribute("aria-label", /collision/);
  expect(await codeMarks(page)).toBe(0);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

test("a run's bound beginning that ends without a result takes its early contact out of the list, the marks and the verdict (Codex R137 VP-I93)", async ({ page, context }) => {
  test.setTimeout(120_000);
  await sideRunReady(page, context);
  await sideFirst(page);
  await expect(clashRows(page)).toHaveCount(1);
  await page.evaluate(() => (window as any).__sideTap.deliver({ error: "injected" }));
  const clash = page.locator(".simPanel .simSummary .sumItem").first();
  await expect(clash, "not checked, with why — no contact of its own").toHaveAttribute("aria-label", "Clear · start not checked");
  await expect(clashRows(page)).toHaveCount(0);
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  await expect(page.locator(".codeLine.collision"), "the early mark is gone too").toHaveCount(0);
  await ctl({ op: "quiet", on: false });
  await ctl({ op: "reset" });
});

// Codex R149 VP-I109 (his browser probe): a side run stopped by its budget at
// 20 % — its answer carries `truncated` — shows its open contact up to where
// it was checked; the band never reaches on to the end of the side's track.
test("a side run stopped by its budget keeps its contact band at its own coverage (Codex R149 VP-I109)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript({ content: FROM_WIRE_INIT });
  await page.addInitScript(() => {
    const tap: any = { side: null, deliver: null };
    (window as any).__r149 = tap;
    const Real = window.Worker;
    const Tap = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      const post = w.postMessage.bind(w);
      let handler: any = null;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
      w.addEventListener("message", e => handler?.(e));
      w.postMessage = ((m: any, t?: Transferable[]) => {
        if (m?.side && m.track) { tap.side = m; tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: { id: m.id, ...d } })); return; }
        post(m, t ?? []);
      }) as any;
      return w;
    } as any;
    Tap.prototype = Real.prototype;
    window.Worker = Tap;
  });
  await prepare(page, context, { file: "/side-stopped.ngc", version: 29149, lines: [1, 2], joints: [-100, 0, -100, 0, 0], feed: [[0, 0, -100], [10, 0, -100]] });
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  await page.locator(".scrubBar").getByRole("checkbox", { name: "Sim" }).check();
  await expect.poll(() => page.evaluate(() => (window as any).__r149.side?.id ?? null)).not.toBeNull();
  const meta = await page.evaluate(() => { const s = (window as any).__r149.side; return { id: s.id as number, end: s.track.cum[s.track.count - 1] as number }; });
  const st = oneContact(meta.id, 0, 0.1 * meta.end);
  const bands = () => page.locator(".scrubBand.clash").evaluateAll(els => els.map(e => {
    const track = e.parentElement!.querySelector(".scrubBand.track")!.getBoundingClientRect(), r = e.getBoundingClientRect();
    return { left: 100 * (r.left - track.left) / track.width, width: 100 * r.width / track.width };
  }));
  const reach = async () => { const bs = await bands(); return bs.length ? Math.max(...bs.map(b => b.left + b.width)) : 999; };
  // running at 20 %, its contact open from 10 %
  await page.evaluate(w => {
    const t = (window as any).__r149;
    t.deliver({ progress: 0.2, contacts: [(window as any).__fromWire(w)], contactPairs: [["spindle_nose", "a_yoke_casting"]] });
  }, wireDelta(st));
  await expect.poll(reach).toBeLessThan(30);
  // stopped there by its budget: the answer is no whole check
  await page.evaluate(w => {
    const t = (window as any).__r149;
    t.deliver({ contacts: [(window as any).__fromWire(w)], result: { staticContacts: [], samples: 10, coarsened: false,
      uncertified: null, pairCount: 1, pairsPrescreened: 0, bvhMs: 0, sweepMs: 10, truncated: { covered: 0.2, reason: "budget" },
      incompleteFrom: 0.2 * t.side.track.cum[t.side.track.count - 1] } });
  }, wireDelta(st));
  await expect(page.locator(".simPanel .simSummary .sumItem").first()).not.toHaveAttribute("aria-label", /still checking/);
  expect(await reach(), "stopped at 20 %: the band ends there, not at the side track's end").toBeLessThan(30);
  expect(errors).toEqual([]);
});

// Round B4 (plan 3.5): a sweep worker fails mid-run; the request runs again on
// one core as its next generation, and the earlier generation's evidence stays.
// The worker script is served with a hook in front (no seam in the product):
// once a sub-worker's contact reached the coordinator, the sub-workers' words
// wait (so the pool cannot end first), and on the page's word sub-worker 0
// fails. The rerun is held by a camera hold: its own tables have nothing yet.
const FAIL_HOOK = `(() => {
  const RealWorker = self.Worker;
  if (!RealWorker) return;
  const subs = [];
  let held = false;
  self.Worker = function (url, opts) {
    const w = new RealWorker(url, opts);
    subs.push(w);
    let handler = null;
    Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
    w.addEventListener("message", e => {
      if (held) return;
      handler && handler(e);
      const c = e.data && e.data.contacts;
      if (c && c.some(d => d.intervals && d.intervals.count > 0)) { held = true; self.postMessage({ __poolHeld: true }); }
    });
    return w;
  };
  self.addEventListener("message", e => {
    if (e.data && e.data.__failShard !== undefined) {
      e.stopImmediatePropagation();
      const w = subs[e.data.__failShard];
      if (w) w.dispatchEvent(new ErrorEvent("error", { message: "a failing sweep worker (test)" }));
    }
  });
})();
`;
test("a sweep worker fails mid-run: the earlier run's finding stays listed through the rerun, under its own key (plan 3.5, round B4)", async ({ page, context }) => {
  test.setTimeout(150_000);
  await context.route(/collisionWorker[^/]*\.js(\?|$)/, async route => {
    const r = await route.fetch();
    await route.fulfill({ response: r, body: FAIL_HOOK + await r.text() });
  });
  await page.addInitScript({ content: FROM_WIRE_INIT });
  await page.addInitScript(() => {
    const tap: any = { w: null, poolHeld: false, pairs: null, deliver: null, dropAck: false };
    (window as any).__b4 = tap;
    const Real = window.Worker;
    const Tap = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      tap.w = w;
      const post = w.postMessage.bind(w);
      let handler: any = null;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
      tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: d }));
      w.addEventListener("message", e => {
        if (e.data?.__poolHeld) { tap.poolHeld = true; return; }
        if (e.data?.contactPairs) tap.pairs = e.data.contactPairs;
        handler?.(e);
      });
      // the acknowledgement of the delta the page was handed (below) is not the worker's
      w.postMessage = ((m: any, t?: Transferable[]) => {
        if (tap.dropAck && m?.contactsAck !== undefined && m.generation === 1) { tap.dropAck = false; return; }
        post(m, t ?? []);
      }) as any;
      return w;
    } as any;
    Tap.prototype = Real.prototype;
    window.Worker = Tap;
  });
  await prepare(page, context, { file: "/crash-fallback.ngc", version: 2214, lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
    feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]],
    before: () => expect.poll(() => page.evaluate(() => { window.__viewerDiag?.setCollisionShards?.(2); return !!window.__viewerDiag?.setCollisionShards; })).toBe(true) });
  // the pool found the nose in the yoke; its words wait from here
  await expect.poll(() => page.evaluate(() => (window as any).__b4.poolHeld), { timeout: 60_000 }).toBe(true);
  // a camera hold, then sub-worker 0 fails: the pool's tables are delivered,
  // the request runs again here as generation 1 — held
  await page.evaluate(() => { window.__viewerDiag!.setCameraHold!(true); (window as any).__b4.w.postMessage({ __failShard: 0 }); });
  const row = page.locator('.simPanel tbody tr[data-sim-at="C7"]');
  await expect(row, "the pool's collision on L7").toHaveCount(1, { timeout: 30_000 });
  const key = await row.getAttribute("data-sim-row");
  expect(key, "an event of the earlier run keeps its plain key").toMatch(/^C\d+\|\d+\|0$/);
  const id = await page.evaluate(() => window.__viewerDiag!.getContacts!().main!.id);
  // generation 1's first word — nothing found yet (the rerun holds before it sweeps)
  await page.evaluate(([w, id]) => {
    const t = (window as any).__b4;
    t.dropAck = true;
    t.deliver({ id, contacts: [(window as any).__fromWire(w)], contactPairs: t.pairs });
  }, [wireDelta(new ContactStore(1, 1)), id] as const);
  await expect.poll(() => page.evaluate(() => {
    const m = window.__viewerDiag!.getContacts!().main;
    return m?.held ? `${m.held.generation}<${m.generation} held ${m.held.rows!.intervals > 0} current ${m.rows!.intervals}` : null;
  }), { timeout: 30_000 }).toBe("0<1 held true current 0");
  await expect(row, "listed from the earlier run though the rerun found nothing yet").toHaveCount(1);
  await expect(row).toHaveAttribute("data-sim-row", key!);
  // the rerun goes on and ends: still that one finding, under the same key
  await page.evaluate(() => window.__viewerDiag!.setCameraHold!(false));
  await expect.poll(() => sweepDone(page), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getContacts!().main?.rows?.intervals ?? 0), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect(page.locator(`.simPanel tbody tr[data-sim-row="${key}"]`), "the same event, one row").toHaveCount(1);
  // the rerun swept L7 whole (the pool's words stopped at its first contact): every pair once — no event twice
  const pairs = await row.evaluateAll(rs => rs.map(r => r.getAttribute("aria-label") ?? r.textContent ?? ""));
  expect(pairs.length).toBeGreaterThanOrEqual(1);
  expect(new Set(pairs).size, `each contact once: ${pairs.join(" | ")}`).toBe(pairs.length);
  await ctl({ op: "reset" });
});

// Codex R151 VP-I111: an entry contact the base continues is ONE finding
// after a fallback — the base's alone (the side had ended), both at one
// failure (the side still running) — and a later separate contact of the pair
// stays a finding of its own. Both requests are answered here (no sweep
// runs): the page, the tables' receiver and the view are the product's.
async function joinPage(page: Page, context: BrowserContext, file: string) {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.addInitScript({ content: FROM_WIRE_INIT });
  await page.addInitScript(() => {
    const tap: any = { main: null, side: null, deliver: null };
    (window as any).__r151 = tap;
    const Real = window.Worker;
    const Tap = function (url: string | URL, opts?: WorkerOptions) {
      const w = new Real(url, opts);
      if (!/collisionWorker/.test(String(url))) return w;
      let handler: any = null;
      Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
      w.addEventListener("message", e => handler?.(e));
      tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: d }));
      // both requests are this spec's: no worker answer races them
      w.postMessage = ((m: any) => { if (m?.track) { if (m.side) tap.side = m; else tap.main = m; } }) as any;
      return w;
    } as any;
    Tap.prototype = Real.prototype;
    window.Worker = Tap;
  });
  await prepare(page, context, { file, version: 29151, lines: [1, 2], joints: [-100, 0, -100, 0, 0], feed: [[0, 0, -100], [10, 0, -100]] });
  await expect.poll(() => page.evaluate(() => (window as any).__r151.main?.id ?? null)).not.toBeNull();
  const main = await page.evaluate(() => { const m = (window as any).__r151.main; return { id: m.id as number, end: m.track.cum[m.track.count - 1] as number }; });
  const pairs = [["spindle_nose", "a_yoke_casting"]];
  const result = { staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 1, pairsPrescreened: 0, bvhMs: 0, sweepMs: 10,
                   truncated: { covered: 0.5, reason: "running" } };
  const deliver = (d: Record<string, unknown>, w?: ReturnType<typeof wireDelta>) => page.evaluate(([d, w]) => {
    (window as any).__r151.deliver({ ...d, ...(w ? { contacts: [(window as any).__fromWire(w)] } : {}) });
  }, [d, w ?? null] as const);
  // the base in contact from its start to 30 %, running at 50 %
  await deliver({ id: main.id, contactPairs: pairs, progress: 0.5, partial: result }, wireDelta(contactIn(new ContactStore(main.id, 0), 0, 0, 0.3 * main.end)));
  await expect(clashRows(page)).toHaveCount(1);
  await page.locator(".scrubBar").getByRole("checkbox", { name: "Sim" }).check();
  await expect.poll(() => page.evaluate(() => (window as any).__r151.side?.id ?? null)).not.toBeNull();
  const side = await page.evaluate(() => { const m = (window as any).__r151.side; return { id: m.id as number, end: m.track.cum[m.track.count - 1] as number }; });
  // the entry move touches from 20 % to its end: swept whole, it continues into the base's contact
  const entryResult = { ...result, truncated: null };
  const rows = () => clashRows(page).evaluateAll(rs => rs.map(r => r.getAttribute("data-sim-row")));
  const generation = (which: "main" | "entry") => page.evaluate(w => {
    const c = window.__viewerDiag?.getContacts?.();
    // a running side run's tables, else the shown entry result's
    return w === "main" ? c?.main?.generation : c?.side?.generation ?? c?.entry?.tables?.generation;
  }, which);
  const frames = () => page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  return { errors, main, side, pairs, result, entryResult, deliver, rows, generation, frames };
}
/** One more contact of pair 0 in a request's table of a generation. */
function contactIn(st: ContactStore, ordinal: number, at: number, exit: number) {
  const ep = st.episodes.append({ pair: 0, ordinal, flags: 4, onset: at, end: exit, closeAt: at, closeDist: 0, firstIv: 0xffffffff, ivCount: 1 });
  st.episodes.set(ep, "firstIv", st.intervals.append({ episode: ep, enter: at, exit, flags: Number.isNaN(exit) ? 2 : 6, next: 0xffffffff, witness: at, freeAt: NaN }));
  return st;
}

test("the base falls back after the entry move's side run ended: its continuation stays the entry's finding; a later contact stays its own (Codex R151 VP-I111)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const j = await joinPage(page, context, "/r151-join.ngc");
  await j.deliver({ id: j.side.id, contactPairs: j.pairs, result: j.entryResult }, wireDelta(oneContact(j.side.id, 0, 0.2 * j.side.end)));
  await expect.poll(j.rows).toEqual(["E0|0|0"]);
  const summary = () => page.locator(".simPanel .simSummary .sumItem").first().getAttribute("aria-label");
  const words = await summary();
  // the base falls back: its coverage, then its rerun's first words — the same contact
  await j.deliver({ id: j.main.id, heldCoverage: { generation: 0, covered: [0.5] } });
  await j.deliver({ id: j.main.id, contactPairs: j.pairs }, wireDelta(contactIn(new ContactStore(j.main.id, 1), 0, 0, 0.3 * j.main.end)));
  await expect.poll(() => j.generation("main")).toBe(1);
  await j.frames();
  expect(await j.rows(), "no second finding").toEqual(["E0|0|0"]);
  expect(await summary(), "the words unchanged").toBe(words);
  // a later contact of the pair, apart from the first (a second fallback): a finding of its own
  await j.deliver({ id: j.main.id, heldCoverage: { generation: 1, covered: [0.5] } });
  await j.deliver({ id: j.main.id, contactPairs: j.pairs, progress: 0.8 },
                  wireDelta(contactIn(contactIn(new ContactStore(j.main.id, 2), 0, 0, 0.3 * j.main.end), 1, 0.6 * j.main.end, 0.7 * j.main.end)));
  await expect.poll(() => j.generation("main")).toBe(2);
  await expect.poll(async () => (await j.rows()).map(k => k?.replace(/#.*/, ""))).toEqual(["E0|0|0", "C0|1|0"]);
  expect(j.errors).toEqual([]);
  await ctl({ op: "reset" });
});

test("one failure falls back both, the side still running: its rerun swept whole, the base's continuation stays the entry's finding (Codex R151 VP-I111)", async ({ page, context }) => {
  test.setTimeout(120_000);
  const j = await joinPage(page, context, "/r151-join-both.ngc");
  // the side runs: its contact open from 20 %, half swept
  await j.deliver({ id: j.side.id, contactPairs: j.pairs, progress: 0.5 }, wireDelta(oneContact(j.side.id, 0, 0.2 * j.side.end)));
  await expect.poll(() => j.generation("entry")).toBe(0);
  // the pool fails: both coverages first, then both reruns — the side's swept whole
  await j.deliver({ id: j.main.id, heldCoverage: { generation: 0, covered: [0.5] } });
  await j.deliver({ id: j.side.id, heldCoverage: { generation: 0, covered: [0.5] } });
  await j.deliver({ id: j.main.id, contactPairs: j.pairs }, wireDelta(contactIn(new ContactStore(j.main.id, 1), 0, 0, 0.3 * j.main.end)));
  await j.deliver({ id: j.side.id, contactPairs: j.pairs, result: j.entryResult },
                  wireDelta(contactIn(new ContactStore(j.side.id, 1), 0, 0.2 * j.side.end, NaN)));
  await expect.poll(() => j.generation("main")).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag?.getContacts?.().entry?.tables?.generation ?? null)).toBe(1);
  await j.frames();
  await expect.poll(j.rows).toEqual(["E0|0|0"]);
  await j.frames();
  expect(await j.rows(), "both fell back: one finding").toEqual(["E0|0|0"]);
  expect(j.errors).toEqual([]);
  await ctl({ op: "reset" });
});

// Step 4 package 2, C2 (Codex R167): with the record sink gone the live view
// stands on the request's metadata partial and its tables — no first contact
// opens it. The states WITHOUT a first touch, each answered here (no sweep
// runs; the page, the tables' receiver and the view are the product's): only
// a near miss, only a knowledge gap, no row at all — progress while it runs,
// the park, the end, the basis card and the caveats.
for (const kind of ["a near miss alone", "an undecidable gap alone", "no row at all"] as const) {
  test(`the states without a first touch — ${kind}: progress, park, end, basis and caveats (C2)`, async ({ page, context }) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript({ content: FROM_WIRE_INIT });
    await page.addInitScript(() => {
      const tap: any = { main: null, deliver: null };
      (window as any).__c2s = tap;
      const Real = window.Worker;
      const Tap = function (url: string | URL, opts?: WorkerOptions) {
        const w = new Real(url, opts);
        if (!/collisionWorker/.test(String(url))) return w;
        let handler: any = null;
        Object.defineProperty(w, "onmessage", { configurable: true, get: () => handler, set: f => { handler = f; } });
        w.addEventListener("message", e => handler?.(e));
        tap.deliver = (d: any) => handler?.(new MessageEvent("message", { data: d }));
        // the main request is this spec's: no worker answer races it
        w.postMessage = ((m: any, t?: Transferable[]) => { if (m?.track && !m.side) { tap.main = m; return; } (w as any).__post?.(m, t); }) as any;
        return w;
      } as any;
      Tap.prototype = Real.prototype;
      window.Worker = Tap;
    });
    await prepare(page, context, { file: `/c2-${kind.replace(/ /g, "-")}.ngc`, version: 31700, lines: [1, 6, 7, 8], joints: [-100, 0, 0, 0, 0],
      feed: [[0, 0, -100], [0, 0, -380], [240, 0, -380], [240, 0, -100]] });
    await expect.poll(() => page.evaluate(() => (window as any).__c2s.main?.id ?? null)).not.toBeNull();
    const main = await page.evaluate(() => { const m = (window as any).__c2s.main; return { id: m.id as number, end: m.track.cum[m.track.count - 1] as number }; });
    const st = new ContactStore(main.id, 0);
    if (kind === "a near miss alone")
      st.episodes.append({ pair: 0, ordinal: 0, flags: 0, onset: 0.2 * main.end, end: 0.25 * main.end, closeAt: 0.22 * main.end, closeDist: 1.2, firstIv: NONE, ivCount: 0 });
    if (kind === "an undecidable gap alone")
      st.gaps.append({ pair: 0, start: 0.2 * main.end, end: 0.25 * main.end, reason: GAP_UNDECIDABLE });
    const meta = (truncated: unknown) => ({ staticContacts: [], samples: 10, coarsened: false, uncertified: null, pairCount: 1,
      pairsPrescreened: 0, bvhMs: 0, sweepMs: 10, truncated });
    const deliver = (d: Record<string, unknown>, withDelta: boolean) => page.evaluate(([d, w]) => {
      (window as any).__c2s.deliver({ ...d, ...(w ? { contacts: [(window as any).__fromWire(w)] } : {}) });
    }, [d, withDelta ? wireDelta(st) : null] as const);
    const summary = page.locator(".simPanel .simSummary .sumItem").first();
    const words = kind === "a near miss alone" ? "1 near miss" : "No contact";
    // running: the metadata partial and the tables — progress, the words
    await deliver({ id: main.id, contactPairs: [["spindle_nose", "a_yoke_casting"]], progress: 0.3,
                    partial: meta({ covered: 0.3, reason: "running" }) }, true);
    await expect(summary).toHaveAttribute("aria-label", new RegExp(`^${words} so far · 30 % checked`));
    await expect(clashRows(page)).toHaveCount(kind === "a near miss alone" ? 1 : 0);
    // parked: the sweep-so-far's metadata
    await deliver({ id: main.id, stopped: true, result: meta({ covered: 0.4, reason: "stopped" }) }, false);
    await expect(summary).toHaveAttribute("aria-label", /paused at 40 %/);
    // the end
    await deliver({ id: main.id, result: meta(null) }, true);
    const endWords = kind === "a near miss alone" ? "1 near miss · checked in full"
      : kind === "an undecidable gap alone" ? "Clear · checked to the end" : "Clear · checked in full";
    await expect(summary).toHaveAttribute("aria-label", new RegExp(`^${endWords.replace(/[·]/g, "\\$&")}`));
    // the caveat: an undecidable stretch is named from the tables, the others say none
    await page.getByRole("button", { name: "Help: Collision check", exact: true }).click();
    const help = await page.locator(".helpPopover:popover-open").innerText();
    await page.keyboard.press("Tab");
    await page.mouse.click(5, 5);
    if (kind === "an undecidable gap alone") expect(help).toContain("inside check undecidable for spindle_nose ↔ a_yoke_casting");
    else expect(help).not.toContain("Not certified");
    // the basis card describes the check
    expect(await basisCard(page)).toContain("The machine when the check started");
    expect(errors).toEqual([]);
    await ctl({ op: "reset" });
  });
}

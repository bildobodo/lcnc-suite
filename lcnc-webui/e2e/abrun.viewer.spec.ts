import { test, expect, type Page } from "@playwright/test";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";

// Part B's A/B measurement (Codex R39 VP39-03; temporary, removed with the
// previous GL line after the acceptance). Settings → Debug switches the path
// renderer — REBUILT, never both held — and a run drives the fixed sequence:
// every phase reported to the trace with its histograms, the finding jumps
// entered the way the operator enters them (machine off), and the viewer left
// as the run found it: renderer, camera, rapids layer, no simulation.
const FEED = Array.from({ length: 10 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]);
// Three findings (Codex R47 VP-I15: with one, every jump lands on it and a
// wandering sequence cannot show): two on feed lines, one on the rapid.
const FEED_OUT = new Uint8Array(FEED.length);
FEED_OUT[2] = 1; FEED_OUT[6] = 1;
const PREVIEW = Buffer.from(encode({ file: "/ab.ngc", preview_schema: 9, feed: FEED,
  feed_lines: FEED.map((_, i) => i + 3), feed_seq: FEED.map((_, i) => i + 3),
  feed_outside: FEED_OUT,
  rapid: [[27, 20, 0], [150, 20, 5]], rapid_lines: [13, 14], rapid_seq: [13, 14],
  rapid_outside: new Uint8Array([0, 1]),
  violations: [{ line: 5, axis: "Y", value: 20, limit: 10, kind: "max" }, { line: 9, axis: "Y", value: 20, limit: 10, kind: "max" },
    { line: 14, axis: "X", value: 150, limit: 100, kind: "max" }], violations_total: 3 }));
const SHORT = { calibrateMs: 300, warmupMs: 300, orbitMs: 600, fitDetailCycles: 2, fitDetailHoldMs: 200, jumps: 3, jumpMs: 300, overlayMs: 300 };   // three jumps: L5, L9, L14 — ending on the rapid (the reveal)

type Rec = Record<string, any>;
const kindOf = (page: Page, role: string) => page.evaluate(r =>
  window.__viewerDiag?.getRoleMaterials?.().filter(m => m.role === r).map(m => m.kind).sort().join(",") ?? null, role);

async function setup(page: Page, context: import("@playwright/test").BrowserContext, telemetry: Rec[]) {
  await context.route(/\/telemetry(\?|$)/, async r => {
    for (const line of (r.request().postData() ?? "").split("\n")) if (line.trim()) telemetry.push(JSON.parse(line));
    await r.fulfill({ contentType: "application/json", body: '{"ok":true}' });
  });
  await context.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: PREVIEW }));
  await context.route(/\/gcode(\?|$)/, r => r.fulfill({ contentType: "text/plain",
    body: Array.from({ length: 16 }, (_, i) => i === 0 ? "(ab)" : `G1 X${i} F100`).join("\n") }));
  await openLayout(page, PROFILES[1]!, VIEWPORTS.find(v => v.name === "desktop")!);
  await ctl({ op: "status_delta", data: { active_file: "/ab.ngc", is_enabled: false, enabled: false } });
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 990, file: "/ab.ngc" } });
  await expect(page.locator('.scrubBar [aria-label="Next limit violation"]')).toBeVisible({ timeout: 15_000 });
}

/** A short run to its end; the phase records. */
async function runShort(page: Page, telemetry: Rec[]) {
  await page.evaluate(d => window.__viewerDiag!.runAbMeasurement!(d), SHORT);
  await expect.poll(() => telemetry.some(e => e.kind === "viewer.abrun" && e.phase === "end"),
    { message: "the run ended and said so", timeout: 90_000 }).toBe(true);
  return telemetry.filter(e => e.kind === "viewer.abrun");
}

/** Codex R47 VP-I15: every repetition jumps through the SAME sequence. */
function sameJumpsEveryRepetition(phases: Rec[]) {
  for (const ph of ["jumps", "reveal"]) {
    const seqs = phases.filter(p => p.phase === ph).map(p => JSON.stringify(p.jumps_at));
    expect(seqs.length).toBe(6);
    expect(new Set(seqs).size, `${ph}: one sequence for all six repetitions ${seqs.join(" ")}`).toBe(1);
    expect(new Set(JSON.parse(seqs[0]!)).size, `${ph}: the jumps visit more than one finding`).toBeGreaterThan(1);
  }
}

test("the Debug switch rebuilds the paths in the chosen renderer; a run measures every phase and leaves the view as it was", async ({ page, context }) => {
  test.setTimeout(180_000);
  const telemetry: Rec[] = [];
  await setup(page, context, telemetry);
  await expect.poll(() => kindOf(page, "feed"), { message: "the product draws the 2 CSS px line" }).toBe("fat");
  const memFat = await page.evaluate(() => window.__viewerDiag!.getPathMemory!());
  expect(memFat.mode).toBe("fat");
  expect(memFat.cpu.base, "the ledger counts the packed lines").toBeGreaterThan(0);

  // Settings → Debug: the previous GL line, rebuilt; the ledger follows.
  await page.getByTitle("Settings", { exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("tab", { name: "Debug", exact: true }).click();
  const section = dialog.locator("[data-ab-measure]");
  await section.getByLabel("Previous GL line").check();
  await expect.poll(() => kindOf(page, "feed")).toBe("basic");
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getPathMemory!().mode)).toBe("gl");
  expect(await kindOf(page, "rapid"), "the rapid keeps its dash as a GL line").toBe("dashed");
  await section.getByLabel("2 CSS px").check();
  await expect.poll(() => kindOf(page, "feed")).toBe("fat");
  await dialog.getByRole("button", { name: "Close settings", exact: true }).click();

  // A short run (the operator's has 30 s orbits): every phase, both renderers.
  const cam0 = await page.evaluate(() => window.__viewerDiag!.getCamera!());
  const runs = await runShort(page, telemetry);
  const meta = runs.find(e => e.phase === "meta")!;
  expect(meta.order).toBe("gl,fat,fat,gl,gl,fat");
  expect(meta.feed_segs).toBeGreaterThan(0);
  const all = runs.filter(e => e.variant);
  expect(all[0]!.phase, "the reference rate first, before any build").toBe("calibrate");
  const phases = all.filter(p => p.phase !== "calibrate");
  expect(phases.length, "8 phases × 6 repetitions").toBe(48);
  const dump = JSON.stringify(phases.map(p => [p.rep, p.variant, p.phase, p.status, p.reason]));
  for (const p of phases) expect(p.status, `${p.rep}/${p.variant}/${p.phase} ran ${dump}`).toBe("ran");
  const builds = phases.filter(p => p.phase === "build");
  expect(builds.map(p => p.memory.mode)).toEqual(["gl", "fat", "fat", "gl", "gl", "fat"]);
  // Codex R47 VP-I14: SIX real builds — a new path generation each, also for fat → fat and gl → gl
  const gens = builds.map(p => p.memory.generation);
  for (let k = 1; k < gens.length; k++) expect(gens[k]!, `build ${k + 1} is a new build ${JSON.stringify(gens)}`).toBeGreaterThan(gens[k - 1]!);
  // VP-I17: the release leaves the program alone in the ledger
  for (const p of phases.filter(q => q.phase === "release")) {
    expect(p.memory.cpu.total - p.memory.cpu.payload, `${p.rep}/${p.variant}: no path byte left`).toBe(0);
    expect(p.memory.gpu.total).toBe(0);
  }
  expect(builds.every(p => p.memory.peak >= p.memory.cpu.total), "the peak bound covers what is held").toBe(true);
  sameJumpsEveryRepetition(phases);
  expect(phases.find(p => p.variant === "fat" && p.phase === "reveal")!.memory.cpu.reveal,
    "the finding's view on the hidden rapid was built — its bytes in the ledger").toBeGreaterThan(0);
  const orbit = phases.find(p => p.variant === "fat" && p.phase === "orbit")!;
  expect(orbit.raf.n).toBeGreaterThan(0);
  // The histograms arrive as viewer.abhist events (a field named `kind` once
  // overwrote the event's own kind: they reached the trace as browser.raf).
  const hist = telemetry.filter(e => e.kind === "viewer.abhist" && e.seq === orbit.seq);
  expect(hist.map(h => h.series).sort()).toEqual(expect.arrayContaining(["mt", "raf"]));
  const raf = hist.find(h => h.series === "raf" && h.part === 0)!;
  expect(raf.n, "the raf histogram carries the phase's sample count").toBe(orbit.raf.n);
  expect(raf.bins.filter((_: number, i: number) => i % 2).reduce((a: number, c: number) => a + c, 0)).toBe(orbit.raf.n);
  expect(telemetry.some(e => ["raf", "mt", "gpu"].includes(e.kind)), "no event lost its kind").toBe(false);

  // Left as found: the product renderer, the camera, the rapids, no simulation.
  expect(await kindOf(page, "feed")).toBe("fat");
  await expect(page.locator(".simBanner")).toHaveCount(0);
  await expect(page.locator("[data-ab-run]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__viewerDiag!.projectRole!("rapid") != null), "the rapids show again").toBe(true);
  const cam1 = await page.evaluate(() => window.__viewerDiag!.getCamera!());
  for (let i = 0; i < 3; i++) {
    expect(cam1!.position[i]!).toBeCloseTo(cam0!.position[i]!, 3);
    expect(cam1!.target[i]!).toBeCloseTo(cam0!.target[i]!, 3);
  }
});

// Codex R47 VP-I15: a simulation the operator had open, at a position — the
// run jumps from the same start each repetition and hands the timeline back
// where it was, still simulating.
test("a run from an open simulation: the same jumps every repetition, the timeline back at its position", async ({ page, context }) => {
  test.setTimeout(180_000);
  const telemetry: Rec[] = [];
  await setup(page, context, telemetry);
  await page.locator(".scrubBar .scrubRow input.toggle").check();
  await expect(page.locator(".simBanner")).toBeVisible();
  const slider = page.locator(".scrubBar .sliderInput");
  const pos = await slider.evaluate((el: HTMLInputElement) => {
    el.value = String(Number(el.max) * 0.37);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return Number(el.value);
  });
  const runs = await runShort(page, telemetry);
  const phases = runs.filter(e => e.variant && e.phase !== "calibrate");
  for (const p of phases) expect(p.status, `${p.rep}/${p.variant}/${p.phase}`).toBe("ran");
  sameJumpsEveryRepetition(phases);
  await expect(page.locator(".simBanner"), "still simulating").toBeVisible();
  await expect.poll(() => slider.evaluate((el: HTMLInputElement) => Number(el.value)), { message: "the timeline back at its position" })
    .toBeCloseTo(pos, 3);
});

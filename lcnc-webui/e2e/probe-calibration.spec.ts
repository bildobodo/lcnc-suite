import { test, expect, type Locator, type Page } from "./test";
import { ctl, MOCK } from "./ctl";
import { openLayout, PROFILES, settleLayout, VIEWPORTS, type LayoutViewport } from "./layout-fixtures";
import { sidewaysOverflow } from "./layout-audit";

// P5 (plan v6; operator 2026-11-23/24): the Calibrate view's offset and
// candidate, and the probing fields' states — read from the DOM at the desktop,
// the machine panel's Full HD touch and the narrow pane (150 %).
//   - the cells and every field cell keep their height in every state; nothing
//     runs out sideways; the candidate is ONE row where the pane has the room,
//     and an Apply / Discard not carried out says so in that row's second part;
//   - disarmed = the controls are closed and say why on a press: no bar about
//     arming, no draft can begin;
//   - what is shown comes from the gateway's status: a lost answer claims no
//     outcome, a second client's decision shows here, an aborted run offers
//     nothing and has no buttons;
//   - a draft has an amber bar, a refused change a red one (each 3 : 1 against
//     its field), never a text under a field; ONE line under "Parameters", one
//     line high with its longest text.

type Sent = { cmd?: string; run?: number; value?: number; sets?: unknown; routine?: string };
const sent = async (): Promise<Sent[]> => ((await ctl({ op: "lastCmds" })) as { cmds?: Sent[] }).cmds ?? [];
const DESKTOP = VIEWPORTS.find(v => v.name === "desktop")!;
const FULLHD = VIEWPORTS.find(v => v.name === "touch-fullhd")!;
const NARROW: LayoutViewport = { name: "narrow-150", width: 900, height: 1200, touch: true };
const REC = { value: 0.0677, unit: "mm", state: "active", rev: 3, at: null, machine: { outcome: "taken", at: null, why: null } };
const CAND = { run: 12, value: 0.0712, was: 0.0677, routine: "probe_cal_square_pocket", size: { x: 20.25, y: 30.25 },
  axis: 2, unit: "mm", at: "2026-11-24T05:12:00", state: "pending", why: null };
const STATES: Record<string, { rec: object; cand: object | null }> = {
  idle: { rec: REC, cand: null },
  pending: { rec: REC, cand: CAND },
  applied: { rec: { ...REC, value: 0.0712, rev: 4 }, cand: { ...CAND, state: "applied" } },
  applied_next_probe: { rec: { ...REC, rev: 4, machine: { outcome: "saved_not_written" } }, cand: { ...CAND, state: "applied" } },
  applied_unknown: { rec: { ...REC, rev: 4, machine: { outcome: "saved_write_unknown" } }, cand: { ...CAND, state: "applied" } },
  discarded: { rec: REC, cand: { ...CAND, state: "discarded" } },
  stale: { rec: REC, cand: { ...CAND, value: null, state: "stale", why: "the LinuxCNC connection changed" } },
  none: { rec: { value: null, unit: null, state: "none", rev: 1, at: null, machine: null }, cand: null },
  unit_other: { rec: { ...REC, unit: "in", state: "unit_other", machine: null }, cand: null },
};

async function openView(page: Page, vp: LayoutViewport, view: string): Promise<Locator> {
  await openLayout(page, PROFILES[0]!, vp);
  if (vp.name === "narrow-150") {
    await page.evaluate(() => { document.documentElement.style.zoom = "1.5"; });
    await settleLayout(page);
  }
  const side = page.locator(".sidePane");
  if (await side.getByRole("tab", { name: "Probing", exact: true }).isVisible()) {
    await side.getByRole("tab", { name: "Probing", exact: true }).click();
    await side.getByRole("tab", { name: view, exact: true }).click();
  } else {
    await side.getByRole("combobox", { name: "Side panel" }).selectOption({ label: "Probing" });
    await side.getByRole("combobox").nth(1).selectOption({ label: view });
  }
  await expect(side.locator("[data-section-line]")).toBeVisible();
  return side;
}
const put = (st: { rec: object; cand: object | null }, armed = true) =>
  ctl({ op: "status_delta", armed, data: {}, envelope: { probe_calibration: st.rec, cal_candidate: st.cand } });

for (const vp of [DESKTOP, FULLHD, NARROW]) {
  test(`Calibrate at ${vp.name}: the cells and fields keep their size in every state, nothing sideways`, async ({ page }) => {
    const side = await openView(page, vp, "Calibrate");
    const measure = () => side.locator(".calSection").evaluate(box => {
      const h = (e: Element) => Math.round(e.getBoundingClientRect().height * 10) / 10;
      const top = box.getBoundingClientRect().top;
      const all = (sel: string) => [...box.querySelectorAll(sel)];
      return { cells: all(".gridCell").map(h), cellTops: all(".gridCell").map(e => Math.round(e.getBoundingClientRect().top - top)),
               fields: all(".formField").map(h), active: h(box.querySelector('[data-cal="active"]')!) };
    });
    const seen: Record<string, Awaited<ReturnType<typeof measure>>> = {};
    for (const [name, st] of Object.entries(STATES)) {
      await put(st);
      const cand = st.cand as { state?: string } | null;
      await expect(side.locator('[data-cal="candidate"]')).toHaveCount(cand?.state === "pending" ? 1 : 0);
      await expect(side.locator('[data-cal="outcome"]')).toHaveCount(cand?.state === "applied" || cand?.state === "stale" ? 1 : 0);
      seen[name] = await measure();
      expect(seen[name]!.cells, name).toEqual(seen.idle!.cells);
      expect(seen[name]!.cellTops, `${name}: the cells stand where they stood`).toEqual(seen.idle!.cellTops);
      expect(seen[name]!.fields, name).toEqual(seen.idle!.fields);
      expect(await sidewaysOverflow(side), name).toEqual([]);
    }
    // the pending candidate and its refusal: the same row, the same height
    await put({ rec: REC, cand: { ...CAND, routine: "probe_cal_round_pocket", size: { d: 20 }, axis: 0 } });
    const row = side.locator('[data-cal="candidate"]');
    await expect(row.locator('[data-cal="detail"]')).toHaveText("Round hole Ø 20 mm, Avg XY");
    const before = (await row.boundingBox())!;
    await ctl({ op: "replyFor", cmd: "cal_apply", reply: { ok: false, error: "settings file not written" } });
    await row.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(row.locator('[data-cal="detail"]')).toHaveText("Not applied: settings file not written");
    const after = (await row.boundingBox())!;
    expect(Math.abs(after.height - before.height), "no height change").toBeLessThan(0.6);
    await expect(side.locator(".statusNote.error"), "no bar of its own").toHaveCount(0);
    if (vp !== NARROW) {
      const lines = await row.locator("span").first().evaluate(e => {
        const r = document.createRange(); r.selectNodeContents(e);
        return new Set([...r.getClientRects()].map(x => Math.round(x.top))).size;
      });
      expect(lines, "the candidate is one line").toBe(1);
    }
  });

  test(`fields at ${vp.name}: draft, refused and saved keep every cell's height; the section line is one line`, async ({ page }) => {
    const side = await openView(page, vp, "Outside");
    await ctl({ op: "settingsEcho", on: false });
    const grid = side.locator(".formGrid:has([data-section-line])");
    const line = side.locator("[data-section-line]");
    const measure = () => grid.evaluate(g => ({
      cells: [...g.querySelectorAll(".formField")].map(e => Math.round(e.getBoundingClientRect().height * 10) / 10),
      tops: [...g.querySelectorAll(".formField")].map(e => Math.round(e.getBoundingClientRect().top - g.getBoundingClientRect().top)),
      line: Math.round(g.querySelector("[data-section-line]")!.getBoundingClientRect().height * 10) / 10,
      text: [...g.querySelectorAll(".formError")].length,
    }));
    const base = await measure();
    expect(base.text).toBe(0);
    const slow = side.getByLabel("Slow Feed", { exact: true });
    const enter = async (digits: string) => {
      await slow.click();
      const pad = page.locator(".nkStrip");
      for (const d of digits) await pad.getByRole("button", { name: d, exact: true }).click();
      await pad.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(pad).toHaveCount(0);
    };
    const field = grid.locator(".formField", { has: page.getByLabel("Slow Feed", { exact: true }) });
    await ctl({ op: "replyFor", cmd: "save_settings", reply: "silent" });
    await enter("60");
    await expect(field).toHaveClass(/fs-draft/);
    expect(await measure(), "the draft keeps every cell's size").toEqual(base);
    // the state is part of the field's description, not a text on screen
    const described = await slow.evaluate(e => (e.getAttribute("aria-describedby") ?? "").split(" ")
      .map(id => document.getElementById(id)?.textContent ?? "").join(" | "));
    expect(described).toContain("Not saved yet");
    // a refusal of exactly this change: the red bar, the reason in the line
    await ctl({ op: "replyFor", cmd: "save_settings", reply: { ok: false, error: "settings.json failed to parse and was not overwritten; fix or remove the file and restart the gateway" } });
    await enter("61");
    await expect(field).toHaveClass(/fs-refused/);
    await expect(line).toHaveText(/^Not saved: settings\.json failed/);
    await expect(slow).toHaveAttribute("aria-invalid", "true");
    expect(await measure(), "the longest text is still one line").toEqual(base);
    expect(await sidewaysOverflow(side)).toEqual([]);
    // the server holds it: neutral
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { probe: { slowFr: 61 } } } });
    await expect(field).not.toHaveClass(/fs-/);
    expect(await measure(), "saved keeps every cell's size").toEqual(base);
  });
}

test("disarmed: Apply, Discard, Reset and the fields are closed and say why on a press — no bar, nothing sent", async ({ page }) => {
  const side = await openView(page, FULLHD, "Calibrate");
  await put(STATES.pending!, false);
  for (const name of ["Apply", "Discard", "Reset Calibration"]) {
    const b = side.getByRole("button", { name, exact: true });
    await expect(b, `${name} is closed while disarmed`).toBeDisabled();
    await b.scrollIntoViewIfNeeded();
    const box = (await b.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator(".btnHint"), name).toContainText("Not armed");
  }
  await expect(side.getByLabel("Slow Feed", { exact: true })).toBeDisabled();
  await expect(side.locator(".fs-draft, .fs-refused")).toHaveCount(0);
  await expect(side.locator("[data-section-line]")).not.toHaveClass(/refused/);
  expect((await sent()).filter(c => c.cmd?.startsWith("cal_"))).toEqual([]);
});

test("disarmed between the entry and the save: the change stays a draft, never a red bar about arming", async ({ page }) => {
  const side = await openView(page, DESKTOP, "Outside");
  await ctl({ op: "settingsEcho", on: false });
  await ctl({ op: "replyFor", cmd: "save_settings", reply: { ok: false, error: "Not armed — press Arm" } });
  const slow = side.getByLabel("Slow Feed", { exact: true });
  await slow.click();
  const pad = page.locator(".nkStrip");
  await pad.getByRole("button", { name: "7", exact: true }).click();
  await pad.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "save_settings").length).toBe(1);
  await ctl({ op: "status_delta", armed: false, data: {} });
  await expect(slow).toBeDisabled();
  await expect(side.locator(".fs-refused")).toHaveCount(0);
  await expect(side.locator(".formField", { has: page.getByLabel("Slow Feed", { exact: true }) })).toHaveClass(/fs-draft/);
  await expect(side.locator("[data-section-line]")).not.toHaveClass(/refused/);
});

test("Apply names its run and value; the outcome is the status', not the reply", async ({ page }) => {
  const side = await openView(page, DESKTOP, "Calibrate");
  await put(STATES.pending!);
  const row = side.locator('[data-cal="candidate"]');
  await ctl({ op: "replyFor", cmd: "cal_apply", reply: { ok: true, run: 12 } });   // an answer alone shows nothing
  await ctl({ op: "clearCmds" });
  await row.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "cal_apply")).toEqual(
    [expect.objectContaining({ cmd: "cal_apply", run: 12, value: 0.0712 })]);
  // a later frame of the same socket: the answer before it has been taken (the
  // check raced the answer, and the mutation of it once passed)
  await put({ rec: { ...REC, value: 0.0678 }, cand: STATES.pending!.cand });
  await expect(side.locator('[data-cal="active"]')).toContainText("0.0678 mm");
  await expect(row, "the candidate stays until the status says otherwise").toBeVisible();
  await expect(row.locator('[data-cal="detail"]')).toContainText("Rect pocket");
  await put(STATES.applied!);
  await expect(row).toHaveCount(0);
  await expect(side.locator('[data-cal="outcome"]')).toHaveText("Applied — on the machine");
  await expect(side.locator('[data-cal="active"]')).toContainText("0.0712 mm");
});

test("no answer claims no outcome; the status that arrives later does", async ({ page }) => {
  const side = await openView(page, DESKTOP, "Calibrate");
  await put(STATES.pending!);
  const row = side.locator('[data-cal="candidate"]');
  await ctl({ op: "replyFor", cmd: "cal_apply", reply: "silent" });
  await row.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(row.locator('[data-cal="detail"]'), "the row says why").toHaveText("No reply — outcome unknown", { timeout: 15_000 });
  await put(STATES.applied_next_probe!);
  await expect(side.locator('[data-cal="outcome"]')).toHaveText("Applied — the next probe writes it");
  await expect(side.getByText("No reply")).toHaveCount(0);
});

test("a second client's decision shows here, and this page's late press answers with it", async ({ page, context }) => {
  const side = await openView(page, DESKTOP, "Calibrate");
  await put(STATES.pending!);
  await expect(side.locator('[data-cal="candidate"]')).toBeVisible();
  const other = await context.newPage();
  await other.goto(MOCK);
  await expect(other.locator("input.setupInput").first()).toBeVisible();
  await other.locator(".sidePane").getByRole("tab", { name: "Probing", exact: true }).click();
  await other.locator(".sidePane").getByRole("tab", { name: "Calibrate", exact: true }).click();
  await other.locator('[data-cal="candidate"]').getByRole("button", { name: "Discard", exact: true }).click();
  await expect(side.locator('[data-cal="candidate"]')).toHaveCount(0);
  await expect(side.locator('[data-cal="outcome"]')).toHaveCount(0);
  await expect(side.locator('[data-cal="active"]')).toContainText("0.0677 mm");
  // the gateway's answer to a press that came too late
  await ctl({ op: "replyFor", cmd: "cal_apply", reply: { ok: false, error: "Discarded meanwhile" } });
  await put(STATES.pending!);
  await side.locator('[data-cal="candidate"]').getByRole("button", { name: "Apply", exact: true }).click();
  await expect(side.locator('[data-cal="detail"]')).toHaveText("Not applied: Discarded meanwhile");
  // the second page goes with its context: closed on its own it sends its
  // page-hide telemetry without the record's id (browser-replay, round gate 2)
});

test("an aborted run offers nothing: its reason, no buttons", async ({ page }) => {
  const side = await openView(page, DESKTOP, "Calibrate");
  await put({ rec: REC, cand: { ...CAND, state: "stale", why: "the run was aborted" } });
  await expect(side.locator('[data-cal="outcome"]')).toHaveText("Result not offered — the run was aborted");
  await expect(side.locator('[data-cal="candidate"]')).toHaveCount(0);
  await expect(side.getByRole("button", { name: "Apply", exact: true })).toHaveCount(0);
  await expect(side.getByRole("button", { name: "Discard", exact: true })).toHaveCount(0);
});

test("Reset is asked once, goes out as the gateway's command, and a refusal stands in the offset's own row", async ({ page }) => {
  const side = await openView(page, DESKTOP, "Calibrate");
  await put({ rec: REC, cand: null });
  const active = side.locator('[data-cal="active"]');
  const h = (await active.boundingBox())!.height;
  const reset = async () => {
    await side.getByRole("button", { name: "Reset Calibration", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Reset", exact: true }).click();
  };
  await ctl({ op: "replyFor", cmd: "cal_reset", reply: { ok: false, error: "settings file not written" } });
  await reset();
  await expect(active.locator(".calPart")).toHaveText("Not reset: settings file not written");
  expect(Math.abs((await active.boundingBox())!.height - h)).toBeLessThan(0.6);
  await ctl({ op: "replyFor", cmd: "cal_reset", reply: null });
  await reset();
  await expect(active).toContainText("0.0000 mm");
  await expect(active.locator(".calPart")).toHaveText("on the machine");
  expect((await sent()).filter(c => c.cmd === "probe_run")).toEqual([]);
});

test("the page never sends or keeps the offset: a parameter save and a probe carry no 3032", async ({ page }) => {
  const side = await openView(page, DESKTOP, "Outside");
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { probe: { slowFr: 40, calOffset: 0.2 } } } });
  await expect(side.getByLabel("Slow Feed", { exact: true })).toHaveValue("40");
  await expect(side.getByLabel("Calibration Offset", { exact: true })).toHaveText("0.0000");   // the record's, not the section's
  await ctl({ op: "clearCmds" });
  await side.getByLabel("Slow Feed", { exact: true }).click();
  const pad = page.locator(".nkStrip");
  await pad.getByRole("button", { name: "9", exact: true }).click();
  await pad.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(async () => (await sent()).filter(c => c.cmd === "save_settings").length).toBe(1);
  const all = JSON.stringify(await sent());
  expect(all).not.toContain("3032");
  expect(all).not.toContain("calOffset");
});

test("the machine line follows the booking, value by value, and says no more than it proves", async ({ page }) => {
  const side = await openView(page, DESKTOP, "Outside");
  const line = side.locator("[data-section-line]");
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { probe: { slowFr: 40 } } } });
  await expect(line).toHaveText("Saved · the next probe writes it");
  // what the page itself would send, booked as taken
  const vars = await (async () => {
    await ctl({ op: "clearCmds" });
    await side.getByLabel("Slow Feed", { exact: true }).click();
    const pad = page.locator(".nkStrip");
    for (const d of "40") await pad.getByRole("button", { name: d, exact: true }).click();
    await pad.getByRole("button", { name: "Apply", exact: true }).click();
    await expect.poll(async () => (await sent()).filter(c => c.cmd === "set_params").length).toBe(1);
    return ((await sent()).find(c => c.cmd === "set_params")!.sets as { probe: Record<string, number> }).probe;
  })();
  const t = await page.evaluate(() => new Date(2026, 10, 24, 5, 12).getTime());   // the browser's own clock
  const book = (over: Record<string, object | null> = {}) => {
    const keys: Record<string, object> = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, { value: v, outcome: "applied", t, job: "set_params" }]));
    for (const [k, v] of Object.entries(over)) { if (v === null) delete keys[k]; else keys[k] = { ...keys[k], ...v }; }
    return ctl({ op: "status_delta", data: {}, envelope: { probe_booking: { version: 1, keys } } });
  };
  await book();
  await expect(line).toHaveText("On the machine · 05:12");
  await book({ "3015": { outcome: "unknown", value: null } });
  await expect(line).toHaveText("Saved · machine value unknown");
  await book({ "3015": { value: 41 } });
  await expect(line).toHaveText("Saved · the next probe writes it");
  await book({ "3015": { value: 25, refused: vars["3015"] } });
  await expect(line).toHaveText("Partly on the machine · the next probe writes it");
});

// Codex R470 MT-I40: the line's machine half is judged on what the form shows
// — what this page's next probe sends —, over every meant value; an open edit
// takes no unknown value out of it.
for (const vp of [DESKTOP, FULLHD, NARROW]) {
  test(`an open edit keeps the machine's evidence in the line, in one row, at ${vp.name}`, async ({ page }) => {
    const side = await openView(page, vp, "Outside");
    const line = side.locator("[data-section-line]");
    const slow = side.getByLabel("Slow Feed", { exact: true });
    const field = side.locator(".formField", { has: page.getByLabel("Slow Feed", { exact: true }) });
    const pad = page.locator(".nkStrip");
    const enter = async (digits: string) => {
      await slow.click();
      for (const d of digits) await pad.getByRole("button", { name: d, exact: true }).click();
      await pad.getByRole("button", { name: "Apply", exact: true }).click();
      await expect(pad).toHaveCount(0);
    };
    await ctl({ op: "settingsEcho", on: false });
    await ctl({ op: "raw", frame: { type: "settings_init", settings: { probe: { slowFr: 40 } } } });
    await expect(slow).toHaveValue("40");
    await ctl({ op: "clearCmds" });
    await ctl({ op: "replyFor", cmd: "save_settings", reply: "silent" });
    await ctl({ op: "replyFor", cmd: "set_params", reply: "silent" });
    await enter("40");
    await expect.poll(async () => (await sent()).filter(c => c.cmd === "set_params").length).toBe(1);
    const vars = ((await sent()).find(c => c.cmd === "set_params")!.sets as { probe: Record<string, number> }).probe;
    const t = await page.evaluate(() => new Date(2026, 10, 24, 5, 12).getTime());
    let version = 0;
    const book = (slowFr: object) => ctl({ op: "status_delta", data: {}, envelope: { probe_booking: { version: ++version,
      keys: { ...Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, { value: v, outcome: "applied", t, job: "set_params" }])),
        3015: { outcome: "applied", t, job: "set_params", ...slowFr } } } } });
    const reads = async (want: string, why: string) => {
      await expect(line, why).toHaveText(want);
      const cut = await line.evaluate(e => e.scrollWidth - e.clientWidth);
      expect(cut, `${want}: the whole text in its row`).toBeLessThanOrEqual(0);
    };
    await book({ value: 40 });
    await reads("On the machine · 05:12", "every value booked as the form shows it");
    await book({ value: null, outcome: "unknown" });
    await reads("Saved · machine value unknown", "one value unknown");
    await enter("60");
    await expect(field).toHaveClass(/fs-draft/);
    await reads("Not saved yet · machine value unknown", "the edited field's own value stays unknown");
    await book({ value: 40 });
    await reads("Not saved yet · the next probe writes it", "the machine holds 40, the form shows 60");
    await book({ value: 60 });
    await reads("Not saved yet · on the machine · 05:12", "the machine took 60 before the server held it");
    await book({ value: 25, refused: 60 });
    await reads("Not saved yet · the next probe writes it", "its write was refused before it began");
    // the server holds it, set_params still without its answer: no draft any
    // more; what the machine holds is the line's
    await ctl({ op: "raw", frame: { type: "settings_changed", settings: { probe: { slowFr: 60 } } } });
    await expect(field, "confirmed by the server: saved, whatever set_params does").not.toHaveClass(/fs-/);
    await reads("Partly on the machine · the next probe writes it", "saved; its write refused");
    await book({ value: null, outcome: "unknown" });
    await reads("Saved · machine value unknown", "saved; the write under way or its outcome unknown");
    await expect(field, "a write under way is no unsaved field").not.toHaveClass(/fs-/);
    await book({ value: 60 });
    await reads("On the machine · 05:12", "every meant value provenly taken: positive again");
  });
}

test("forced colours: the bar is the field's own edge, the cells keep their size", async ({ page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  const side = await openView(page, DESKTOP, "Outside");
  const got = await side.locator(".formGrid:has([data-section-line])").evaluate(grid => {
    const cell = grid.querySelector<HTMLElement>(".formField")!;
    const input = cell.querySelector<HTMLElement>(".inputField")!;
    const size = () => { const r = cell.getBoundingClientRect(); const i = input.getBoundingClientRect(); return [r.height, i.width, i.height].map(Math.round); };
    const out: Record<string, { edge: string; size: number[] }> = { none: { edge: getComputedStyle(input).borderInlineStartWidth, size: size() } };
    for (const st of ["draft", "refused"]) {
      cell.classList.add(`fs-${st}`);
      out[st] = { edge: getComputedStyle(input).borderInlineStartWidth, size: size() };
      cell.classList.remove(`fs-${st}`);
    }
    return out;
  });
  expect(got.none!.edge).toBe("1px");
  for (const st of ["draft", "refused"]) {
    expect(got[st]!.edge, st).toBe("3px");
    expect(got[st]!.size, st).toEqual(got.none!.size);
  }
});

for (const theme of ["light", "dark", "hc-light", "hc-dark"]) {
  test(`the bars hold 3 : 1 against their field and its surroundings (${theme})`, async ({ page }) => {
    const side = await openView(page, DESKTOP, "Outside");
    await page.evaluate(t => document.documentElement.setAttribute("data-theme", t), theme);
    const got = await side.locator(".formGrid:has([data-section-line])").evaluate(grid => {
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
      const rgb = (css: string, over?: string) => {
        ctx.clearRect(0, 0, 1, 1);
        if (over) { ctx.fillStyle = over; ctx.fillRect(0, 0, 1, 1); }
        ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const lum = (c: number[]) => {
        const [r, g, b] = c.map(v => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      const ratio = (a: number[], b: number[]) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x! + 0.05) / (y! + 0.05);
      };
      const cell = grid.querySelector(".formField")!;
      const input = cell.querySelector<HTMLElement>(".inputField")!;
      const out: Record<string, { field: number; around: number; bar: string }> = {};
      for (const st of ["draft", "refused"]) {
        cell.classList.add(`fs-${st}`);
        const css = getComputedStyle(input);
        const bar = css.boxShadow.replace(/\s3px 0px 0px 0px inset$/, "").replace(/^inset\s+3px 0px 0px 0px\s+/, "");
        const panel = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim();
        out[st] = { bar: css.boxShadow, field: ratio(rgb(bar), rgb(css.backgroundColor, getComputedStyle(document.documentElement).getPropertyValue("--bg").trim())),
                    around: ratio(rgb(bar), rgb(panel)) };
        cell.classList.remove(`fs-${st}`);
      }
      return out;
    });
    for (const [st, r] of Object.entries(got)) {
      expect(r.bar, `${st}: a 3 px inset bar`).toContain("3px 0px 0px 0px inset");
      expect(r.field, `${theme} ${st} against its field`).toBeGreaterThanOrEqual(3);
      expect(r.around, `${theme} ${st} against the panel`).toBeGreaterThanOrEqual(3);
    }
  });
}

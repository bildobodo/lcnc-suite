// P6-e (machine-day F6; plan maschinentag.r461 Rule E, Codex R461
// MT461-01/-02): the program header's `(T13 D=…)` beside the table's
// diameter, at the tool's row of the Check basis card — a hint only. Every
// guard reads the CARD's DOM. The text and the payload come apart on the
// wire: a text that arrives after the check adds the header to that check's
// card without a sweep; V+1's text never enriches V's card; a failed or
// unproven text and an unproven unit compare nothing.
import { test, expect, type Page, type BrowserContext, type Route } from "./test";
import { encode } from "@msgpack/msgpack";
import { ctl } from "./ctl";
import { openLayout, PROFILES, VIEWPORTS } from "./layout-fixtures";
import { openSimTab } from "./simTab";
import { fulfillPreview, fulfillText, publishFile } from "./programFixture";

const FILE = "/hdr.ngc";
const FEED = Array.from({ length: 10 }, (_, i) => [i * 4, i % 2 ? 10 : 0, -1]);
const LINES = FEED.map((_, i) => i + 9);
/** A payload with the program's tools (T13; T2 too with `two`) and the table
 *  values the parse read — T13 Ø 8.000, T2 Ø 6.000 — in mm. */
const preview = (two = false) => Buffer.from(encode({
  file: FILE, preview_schema: 11, feed: FEED, feed_lines: LINES, feed_seq: LINES,
  feed_outside: new Uint8Array(FEED.length), rapid: [], violations: [], violations_total: 0,
  tlo_events: two ? [[9, 0, 0, 63.192, 13], [14, 0, 0, 40, 2]] : [[9, 0, 0, 63.192, 13]],
  parse_tlos: two ? [[13, 0, 0, 63.192, 8], [2, 0, 0, 40, 6]] : [[13, 0, 0, 63.192, 8]],
  stats: { feedMoves: 10, rapidMoves: 0, linearMoves: 10, arcMoves: 0, feedDist: 36, rapidDist: 0, linearDist: 36, arcDist: 0,
           feedTime: 5, rapidTime: 0, totalTime: 5, feedRates: [500], toolChanges: 1, toolsUsed: [13], unit: "mm", fileSize: 1 } }));
/** The machine-day head's FORM (synthetic): the tool list, `N15 G21`, the
 *  retract, `T13 M600`; `unit` replaces the unit line. */
const text = (entries: string[], unit = "N15 G21") => [
  "(SAMPLE)", ...entries, "N10 G90 G94 G17 G91.1", unit, "N20 G53 G0 Z0.", "N25 T13 M600", "N30 S3000 M3",
  ...LINES.map((l, i) => `N${l * 5} G1 X${FEED[i]![0]} Y${FEED[i]![1]} Z-1 F500`), "M2"].join("\n");
const MISMATCH = text(["(T13 D=1.875 CR=1. - FLAT END MILL)"]);

type Hold = { promise: Promise<void>; release: () => void };
const hold = (): Hold => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };

/** The routes: the preview (held per version), the text per version (held
 *  per version; a held request the page aborts ends quietly). */
async function routes(context: BrowserContext, o: { body: Buffer; texts: Record<number, string>;
                                                  holdText?: Record<number, Hold>; holdPreview?: Record<number, Hold> }) {
  await context.route(/\/preview(\?|$)/, async r => {
    const v = Number(new URL(r.request().url()).searchParams.get("v"));
    await o.holdPreview?.[v]?.promise;
    await fulfillPreview(r, { contentType: "application/octet-stream", body: o.body }).catch(() => {});
  });
  await context.route(/\/gcode(\?|$)/, async (r: Route) => {
    const v = Number(new URL(r.request().url()).searchParams.get("v"));
    await o.holdText?.[v]?.promise;
    await fulfillText(r, { contentType: "text/plain", body: o.texts[v] ?? "(none)" }).catch(() => {});
  });
}

async function open(page: Page, vp = "desktop") {
  await openLayout(page, PROFILES[0]!, VIEWPORTS.find(v => v.name === vp)!);
  await ctl({ op: "status_delta", data: { active_file: FILE, is_enabled: false, enabled: false } });
}
/** The main check of the shown version has its result; none runs (a new
 *  payload clears the result in the same task — a result with version V
 *  shown is V's). */
async function checked(page: Page, version: number) {
  await expect.poll(() => page.evaluate(() => {
    const d = window.__viewerDiag;
    const a = d?.getCollisionActivity?.();
    return a && !a.busy && a.result ? d!.getShownVersion!() : null;
  }), { timeout: 30_000, message: `the check of version ${version} on the bar` }).toBe(version);
}
const diag = (page: Page) => page.evaluate(() => {
  const d = window.__viewerDiag!;
  return { starts: d.getCollisionActivity!().starts, fired: d.getDebounceFired!().check, pending: d.checkTimerPending!(),
           text: d.getHeaderText!() };
});
/** The card, open; its "Program tools" rows as the DOM shows them. */
async function cardRows(page: Page) {
  await openSimTab(page);
  const card = page.locator(".helpPopover:popover-open");
  if (!(await card.count())) await page.getByRole("button", { name: "Check basis", exact: true }).click();
  await expect(card).toBeVisible();
  return card;
}
const toolRows = (page: Page) => page.locator(".helpPopover:popover-open .checkCard").evaluate(dl => {
  const out: { text: string; warn: boolean }[] = [];
  let inTools = false;
  for (const el of Array.from(dl.children)) {
    if (el.tagName === "DT") { inTools = el.textContent === "Program tools" || (inTools && el.textContent === ""); continue; }
    if (inTools) out.push({ text: el.textContent ?? "", warn: el.classList.contains("text-warn") });
  }
  return out;
});
const frames = (page: Page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

for (const vp of ["desktop", "touch-fullhd"] as const) {
  test(`${vp}: a header diameter that differs from the table's is named at the tool's row, in warn`, async ({ page, context }, info) => {
    await routes(context, { body: preview(), texts: { 6101: MISMATCH } });
    await open(page, vp);
    await publishFile(FILE, 6101, MISMATCH);
    await checked(page, 6101);
    const card = await cardRows(page);
    await expect.poll(() => toolRows(page), { message: "the tool's row names the header's diameter" })
      .toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 1.875", warn: true }]);
    // one fact, one place: once on the card, at the tool's row
    expect(((await card.textContent()) ?? "").split("program header").length - 1, "once on the card").toBe(1);
    // for the operator: the card, and the page with it open
    await card.screenshot({ path: info.outputPath(`check-basis-card-${vp}.png`) });
    await page.screenshot({ path: info.outputPath(`check-basis-page-${vp}.png`) });
  });
}

test("a header that matches the table adds nothing; the other tool's difference is named at its own row", async ({ page, context }) => {
  const t = text(["(T13 D=8. CR=0. - FLAT END MILL)", "(T2 D=3. CR=0. - FLAT END MILL)"]);
  await routes(context, { body: preview(true), texts: { 6201: t } });
  await open(page);
  await publishFile(FILE, 6201, t);
  await checked(page, 6201);
  await cardRows(page);
  await expect.poll(() => toolRows(page), { message: "a match adds nothing, T2's difference at T2's row" }).toEqual([
    { text: "T13 · L 63.192 · Ø 8.000 mm", warn: false },
    { text: "T2 · L 40.000 · Ø 6.000 mm · program header Ø 3.", warn: true }]);
});

test("an unproven unit (a sub definition's G20) compares nothing: the header named, not compared, no warn", async ({ page, context }) => {
  const t = text(["(T13 D=1.875 CR=1. - FLAT END MILL)"], "o100 sub\nG20\no100 endsub");
  await routes(context, { body: preview(), texts: { 6301: t } });
  await open(page);
  await publishFile(FILE, 6301, t);
  await checked(page, 6301);
  await cardRows(page);
  await expect.poll(() => toolRows(page), { message: "the header named, not compared" }).toEqual([
    { text: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 1.875, units not proven — not compared", warn: false }]);
});

// MT461-01: the text held until after the check's end, then delivered — the
// hint appears on the SAME check's card, no sweep started, none scheduled.
test("text delivered after the check ended: the hint joins that check's card without a new sweep", async ({ page, context }) => {
  const h = hold();
  await routes(context, { body: preview(), texts: { 6401: MISMATCH }, holdText: { 6401: h } });
  await open(page);
  await publishFile(FILE, 6401, MISMATCH);
  await checked(page, 6401);
  await cardRows(page);
  await expect.poll(() => toolRows(page), { message: "no header before the text" }).toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm", warn: false }]);
  const before = await diag(page);
  expect(before.text.proven, "the text is not on the page yet").toBeNull();
  h.release();
  await expect.poll(() => toolRows(page), { message: "the late text's header joins the card" })
    .toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 1.875", warn: true }]);
  const after = await diag(page);
  expect(after.text.proven).toEqual({ programId: expect.any(String), version: 6401 });
  expect(after.starts, "no sweep started").toBe(before.starts);
  expect(after.fired, "no re-check timer fired").toBe(before.fired);
  expect(after.pending, "none scheduled").toBe(false);
  expect(after.text.shownCheck, "the same check on the bar").toEqual(before.text.shownCheck);
});

// MT461-01: V's card stays on screen while V+1's payload is held; V+1's text
// (another header) is proven on the page — and never reaches V's card. The
// same test's end proves the text WOULD hint: V+1's own check shows it.
test("V → V+1: V+1's text never enriches V's card; V+1's own check shows its header", async ({ page, context }) => {
  const v1 = text(["(T13 D=2.5 CR=1. - FLAT END MILL)"]);
  const vText = hold(), v1Preview = hold();
  await routes(context, { body: preview(), texts: { 6501: MISMATCH, 6502: v1 },
                          holdText: { 6501: vText }, holdPreview: { 6502: v1Preview } });
  await open(page);
  await publishFile(FILE, 6501, MISMATCH);
  await checked(page, 6501);
  await cardRows(page);
  await expect.poll(() => toolRows(page), { message: "V's card before V+1" }).toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm", warn: false }]);
  // V+1 of the same load: its text arrives, its payload waits
  await publishFile(FILE, 6502, v1);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getHeaderText!().proven?.version ?? null),
    { message: "V+1's text proven on the page" }).toBe(6502);
  await frames(page);
  expect(await page.evaluate(() => window.__viewerDiag!.getShownVersion!()), "V's payload still shown").toBe(6501);
  expect(await page.evaluate(() => window.__viewerDiag!.getCollisionActivity!().result), "V's check still on the bar").toBe(true);
  expect(await toolRows(page), "V's card: no header from V+1").toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm", warn: false }]);
  // V's text was never proven (its fetch ended with V+1's announcement): never V's either
  vText.release();
  await frames(page);
  expect(await toolRows(page), "V's card after V's late text").toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm", warn: false }]);
  // the positive control: V+1's payload lands, its check runs, its card names its own header
  v1Preview.release();
  await checked(page, 6502);
  await cardRows(page);
  await expect.poll(() => toolRows(page), { message: "V+1's card names V+1's header" })
    .toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 2.5", warn: true }]);
});

// A text whose bytes are not its announcement's (no proof) compares nothing;
// the same bytes WITH the proof hint (the first test).
test("a text without its proof (other bytes than announced) compares nothing", async ({ page, context }) => {
  await routes(context, { body: preview(), texts: { 6601: MISMATCH } });
  await open(page);
  // announced as parsed from another text: the served bytes do not prove it
  await publishFile(FILE, 6601, text(["(T13 D=8. CR=0. - FLAT END MILL)"]));
  await checked(page, 6601);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getHeaderText!().state)).toBe("differs");
  await cardRows(page);
  await frames(page);
  expect(await toolRows(page), "a text without its proof: no header").toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm", warn: false }]);
});

// Codex R463 MT-I34: an M-word is no proof of a neutral effect. Case A — Codex's
// own browser probe (maschinentag.r463.codex-browser.spec.ts), adopted: M70
// saves the start's (metric) state, M72 restores it before the move; the
// lexical G20 turned a matching Ø 8 into "Ø 8. in (203.200 mm)" in warn.
// Case B: G21, then M98 calls a sub that sets G20 before the move — the
// header read as mm and "matching". Both: the plain "not compared".
for (const [name, unit, tail, version] of [
  ["R463 case A (Codex's probe): M70 / G20 / M72", "M70\nG20\nM72", "", 6701],
  ["R463 case B: G21, M98 P100 calling a G20 sub", "N15 G21\nM98 P100", "\no100\nG20\nM99", 6702],
] as const) {
  test(`${name}: units not proven — the header named, not compared, no warn`, async ({ page, context }) => {
    const t = text(["(T13 D=8.)"], unit) + tail;
    await routes(context, { body: preview(), texts: { [version]: t } });
    await open(page);
    await publishFile(FILE, version, t);
    await checked(page, version);
    await cardRows(page);
    await expect.poll(() => toolRows(page), { message: "a call or a modal restore: the units not proven" }).toEqual([
      { text: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 8., units not proven — not compared", warn: false }]);
  });
}

// Codex R466: a Python hot comment is a hidden call before the first move.
test("R466 Python comment: the card must not claim a proven header unit", async ({ page, context }) => {
  const version = 6801;
  const t = text(["(T13 D=8.)"], 'G21\n;py,from interpreter import this; this.execute("G20")');
  await routes(context, { body: preview(), texts: { [version]: t } });
  await open(page);
  await publishFile(FILE, version, t);
  await checked(page, version);
  await expect.poll(() => page.evaluate(() => window.__viewerDiag!.getHeaderText!().proven?.version),
    { message: "the proven text of this publication has arrived" }).toBe(version);
  await cardRows(page);
  const rows = await toolRows(page);
  console.log("R466 observed card", JSON.stringify(rows));
  expect(rows).toEqual([{ text: "T13 · L 63.192 · Ø 8.000 mm · program header Ø 8., units not proven — not compared", warn: false }]);
});

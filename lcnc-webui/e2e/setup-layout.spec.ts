import { test, expect, type Page, type Locator } from "@playwright/test";
import { enterTouch } from "./touchMode";
import { ctl, MOCK } from "./ctl";
import { measureLayout } from "./layout-audit";

// The Setup section by axis count (operator 2026-10-29/30, Codex R233/R234,
// docs/reviews/setup-layout.review.md). Landscape has six rows of height and
// pays for width, so the axes fill a column of up to six rows and the
// actions fill the rows left free: under the last axis column (1–4, 7–9 axes,
// TWP 7–9), in a column of their own (5–6), or in rows under all axes (TWP up
// to six, every portrait). The WCS title stands on the SETUP title line; in
// portrait the fixtures are two rows of five under it. A long frame chip
// never widens the section nor moves a fixture.
//
// The expected arrangement is written out per config (Codex R234: literal
// values, never the rule run again). Runs in serial-layout (setAxes and
// setKins are mock-global).

const TRSRN = { module: "xyzacb_trsrn", type: "xyzacb-trsrn", identity_first: false, params: {} };
const TRT = { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: true, params: {} };

type Form = "rows" | "column" | "under";
// Per group, the buttons per row from top to bottom: "2" = one row of two,
// "1+1" two rows of one, "2+1", "3", "1+1+1".
interface Expect { form: Form; columns: number[]; base: string; goto: string; plane?: string }
interface Config { name: string; axes: string[]; kins?: object; kinsType?: number; twp?: boolean; land: Expect }

const PORTRAIT_ROWS = { base: "2", goto: "3" };
const CONFIGS: Config[] = [
  { name: "1 X", axes: ["X"], land: { form: "under", columns: [1], base: "1+1", goto: "1+1+1" } },
  { name: "2 XZ", axes: ["X", "Z"], land: { form: "under", columns: [2], base: "2", goto: "1+1+1" } },
  { name: "3 XYZ", axes: ["X", "Y", "Z"], land: { form: "under", columns: [3], base: "2", goto: "2+1" } },
  { name: "4 XYZA", axes: ["X", "Y", "Z", "A"], land: { form: "under", columns: [4], base: "2", goto: "3" } },
  { name: "4 XYZC", axes: ["X", "Y", "Z", "C"], land: { form: "under", columns: [4], base: "2", goto: "3" } },
  { name: "5 XYZBC", axes: ["X", "Y", "Z", "B", "C"], land: { form: "column", columns: [5], base: "1+1", goto: "1+1+1" } },
  { name: "5 TCP", axes: ["X", "Y", "Z", "A", "C"], kins: TRT, kinsType: 1, land: { form: "column", columns: [5], base: "1+1", goto: "1+1+1" } },
  { name: "6 XYZABC", axes: ["X", "Y", "Z", "A", "B", "C"], land: { form: "column", columns: [6], base: "1+1", goto: "1+1+1" } },
  { name: "6 TWP", axes: ["X", "Y", "Z", "A", "B", "C"], kins: TRSRN, kinsType: 0, twp: true, land: { form: "rows", columns: [3, 3], base: "2", goto: "3", plane: "3" } },
  { name: "7", axes: ["X", "Y", "Z", "A", "B", "C", "U"], land: { form: "under", columns: [6, 1], base: "1+1", goto: "1+1+1" } },
  { name: "8", axes: ["X", "Y", "Z", "A", "B", "C", "U", "V"], land: { form: "under", columns: [6, 2], base: "2", goto: "1+1+1" } },
  { name: "9", axes: ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"], land: { form: "under", columns: [6, 3], base: "2", goto: "2+1" } },
  // Synthetic: TWP is the 6-axis xyzacb-trsrn today; the arrangement must
  // still hold for any count (Codex R233 — capability, then count).
  { name: "7 TWP", axes: ["X", "Y", "Z", "A", "B", "C", "U"], kins: TRSRN, kinsType: 0, twp: true, land: { form: "under", columns: [6, 1], base: "2", goto: "1+1+1", plane: "3" } },
  { name: "9 TWP", axes: ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"], kins: TRSRN, kinsType: 0, twp: true, land: { form: "under", columns: [6, 3], base: "2", goto: "3", plane: "3" } },
];

interface Surface { name: string; width: number; height: number; touch?: boolean; zoom?: number; portrait?: boolean }
const SURFACES: Surface[] = [
  { name: "landscape", width: 1280, height: 800 },
  { name: "landscape touch", width: 1280, height: 800, touch: true },
  { name: "landscape touch 150 %", width: 1280, height: 800, touch: true, zoom: 1.5 },
  { name: "portrait", width: 900, height: 1200, portrait: true },
  { name: "portrait touch", width: 900, height: 1200, touch: true, portrait: true },
  { name: "portrait touch 150 %", width: 900, height: 1200, touch: true, zoom: 1.5, portrait: true },
];

const PERMS = (on: boolean) => Object.fromEntries(["idle", "jog", "override", "ready", "run", "step", "abort",
  "spindleStop", "probe", "zero", "machineFrame", "goZero", "planeFrame", "touchoff", "touchoffRotary",
  "twpCapture", "surfaceComp", "safety", "setup", "sourceWrite", "toolTableWrite", "armed", "always",
  "programLoad", "modeManual", "modeCoord", "parameterRead", "g30Write", "spindleManual", "armEnable",
  "estopReset", "g30Capture", "wcsSelect", "toolChangeConfirm"].map(g => [g, on || g === "always" || g === "armEnable" || g === "abort"]));

const SETUP = '[data-strip="setup"]';
const ACTIONS_BASE = [/^Zero (All|XYZ|linear)$/, /^(Home|Unhome) All$/];
const ACTIONS_GOTO = ["Go to G30", "Go to MCS 0", "Go to WCS 0"];
const ACTIONS_PLANE = ["Capture plane", "Orient", "Clear plane"];

async function open(page: Page, c: Config, s: Surface) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: s.width, height: s.height });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await ctl({ op: "setAxes", axes: c.axes });
  await ctl({ op: "setKins", kins: c.kins ?? null });
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput")).toHaveCount(c.axes.length);
  if (s.touch) await enterTouch(page);
  if (s.zoom) await page.evaluate(z => { document.documentElement.style.zoom = String(z); }, s.zoom);
  await setState(page, c, "live");
}

type State = "live" | "dim" | "mixed";
async function setState(page: Page, c: Config, state: State) {
  const homed = c.axes.map((_, i) => state === "live" || (state === "mixed" && i % 2 === 0));
  await ctl({ op: "status_delta", armed: state !== "dim", data: {
    permissions: PERMS(state !== "dim"), homed: homed.map(Number), homed_joints: homed,
    g5x_index: 1, task_mode: 1, ...(c.kinsType != null ? { kins_type: c.kinsType } : {}),
  } });
  const last = c.axes.length - 1;
  const home = page.locator(SETUP).getByRole("button", { name: `${homed[last] ? "Unhome" : "Home"} ${c.axes[last]}`, exact: true });
  await expect(home).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}

type Box = { x: number; y: number; w: number; h: number; name: string };
async function boxes(section: Locator, names: (string | RegExp)[]): Promise<Box[]> {
  const out: Box[] = [];
  for (const n of names) {
    const b = section.getByRole("button", { name: n, exact: typeof n === "string" });
    await expect(b, `${n} exactly once`).toHaveCount(1);
    const r = (await b.boundingBox())!;
    out.push({ x: r.x, y: r.y, w: r.width, h: r.height, name: String(n) });
  }
  return out;
}

/** Buttons per row of a group, top to bottom: "2+1". */
function perRow(bs: Box[]): string {
  const rows: number[] = [];
  let lastY: number | null = null;
  for (const b of [...bs].sort((a, b) => a.y - b.y || a.x - b.x)) {
    if (lastY != null && Math.abs(b.y - lastY) < 2) rows[rows.length - 1]!++;
    else { rows.push(1); lastY = b.y; }
  }
  return rows.join("+");
}

/** Control texts that run onto a second line. */
async function wrapped(section: Locator): Promise<string[]> {
  return section.evaluate(el => [...el.querySelectorAll("button")].filter(b => b.offsetParent !== null).filter(b => {
    const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT); const tops = new Set<number>(); let n: Node | null;
    while ((n = w.nextNode())) {
      if (!n.textContent?.trim() || (n.parentElement as HTMLElement).offsetParent === null) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const q of r.getClientRects()) if (q.width > 1) tops.add(Math.round(q.top / 4));
    }
    return tops.size > 1;
  }).map(b => (b.getAttribute("aria-label") || b.textContent || "").trim()));
}

async function layoutIssues(section: Locator): Promise<string[]> {
  const snap = await measureLayout(section, "setup");
  return snap.issues.filter(i => ["outside-panel", "clipped-label", "clipped-control", "overlap", "collapsed"].includes(i.kind))
    .map(i => `${i.kind}: ${i.detail}`);
}

for (const c of CONFIGS) {
  for (const s of SURFACES) {
    test(`${c.name}, ${s.name}: the arrangement, every action once, nothing outside or clipped`, async ({ page }) => {
      await open(page, c, s);
      const section = page.locator(SETUP);
      const exp: Expect = s.portrait ? { form: "rows", columns: [c.axes.length], ...PORTRAIT_ROWS, ...(c.twp ? { plane: "3" } : {}) } : c.land;
      for (const state of ["live", "dim", "mixed"] as State[]) {
        if (state !== "live") await setState(page, c, state);
        const tag = `${c.name} ${s.name} ${state}`;
        expect(await layoutIssues(section), `${tag}: layout`).toEqual([]);
        if (!s.portrait) expect(await wrapped(section), `${tag}: a label wraps`).toEqual([]);
        const axisBoxes = await boxes(section, c.axes.map(l => `Zero ${l}`));
        const base = await boxes(section, ACTIONS_BASE);
        const go = await boxes(section, ACTIONS_GOTO);
        const plane = c.twp ? await boxes(section, ACTIONS_PLANE) : [];
        if (!c.twp) await expect(section.getByRole("button", { name: "Capture plane", exact: true })).toHaveCount(0);
        // The axis columns: Zero buttons grouped by x, in reading order.
        const cols: Box[][] = [];
        for (const b of axisBoxes) {
          const col = cols.find(cl => Math.abs(cl[0]!.x - b.x) < 2);
          if (col) col.push(b); else cols.push([b]);
        }
        expect(cols.map(cl => cl.length), `${tag}: axis columns`).toEqual(exp.columns);
        for (const cl of cols) for (let i = 1; i < cl.length; i++) expect(cl[i]!.y, `${tag}: column order`).toBeGreaterThan(cl[i - 1]!.y);
        // The groups' rows, and where the actions stand.
        expect(perRow(base), `${tag}: Zero/Home rows`).toBe(exp.base);
        expect(perRow(go), `${tag}: Go to rows`).toBe(exp.goto);
        if (exp.plane) expect(perRow(plane), `${tag}: plane rows`).toBe(exp.plane);
        const acts = [...base, ...go, ...plane];
        const order = acts.map(a => a.y * 10000 + a.x);
        for (let i = 1; i < order.length; i++) expect(order[i]!, `${tag}: action order`).toBeGreaterThan(order[i - 1]!);
        const allAxes = section.locator("input.setupInput");
        const fields = await allAxes.evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; }));
        const lastCol = cols.at(-1)!;
        const lastField = fields[c.axes.length - 1]!, firstLastCol = fields[c.axes.length - lastCol.length]!;
        if (exp.form === "under") for (const a of acts) {
          expect(a.y, `${tag}: ${a.name} under the last axis`).toBeGreaterThanOrEqual(lastField.b);
          expect(a.x, `${tag}: ${a.name} in the last column`).toBeGreaterThanOrEqual(firstLastCol.x - 1);
        }
        if (exp.form === "column") for (const a of acts)
          expect(a.x, `${tag}: ${a.name} beside the axes`).toBeGreaterThanOrEqual(Math.max(...axisBoxes.map(b => b.x + b.w)));
        if (exp.form === "rows") for (const a of acts)
          expect(a.y, `${tag}: ${a.name} under every axis`).toBeGreaterThanOrEqual(Math.max(...fields.map(f => f.b)));
        // The WCS: the title on the SETUP line (landscape), G54 level with the
        // first axis row; portrait: the title above two rows of five.
        const g = (name: string) => section.getByRole("radio", { name, exact: true }).boundingBox();
        const g54 = (await g("G54"))!, g58 = (await g("G58"))!, g59 = (await g("G59"))!, g593 = (await g("G59.3"))!;
        const titles = await section.evaluate(el => {
          const at = (t: string) => [...el.querySelectorAll<HTMLElement>(".sub, .label-muted")].find(e => e.textContent?.trim().startsWith(t))?.getBoundingClientRect();
          const setup = at("Setup"), wcs = at("WCS");
          return { setupY: setup?.y ?? NaN, wcsY: wcs?.y ?? NaN, wcsB: wcs?.bottom ?? NaN, wcsX: wcs?.x ?? NaN };
        });
        if (!s.portrait) {
          expect(Math.abs(titles.wcsY - titles.setupY), `${tag}: WCS title on the SETUP line`).toBeLessThanOrEqual(1);
          expect(Math.abs(g54.y - fields[0]!.y), `${tag}: G54 level with the first axis row`).toBeLessThanOrEqual(1);
        } else {
          expect(Math.abs(g58.y - g54.y), `${tag}: G54–G58 one row`).toBeLessThanOrEqual(1);
          expect(Math.abs(g593.y - g59.y), `${tag}: G59–G59.3 one row`).toBeLessThanOrEqual(1);
          expect(g59.y, `${tag}: G59 in the second row`).toBeGreaterThan(g54.y + g54.height - 1);
          expect(titles.wcsB, `${tag}: the WCS title above the fixtures`).toBeLessThanOrEqual(g54.y + 1);
        }
      }
    });
  }
}

// Keyboard order: the axis rows in order (field, Zero, Home), then the
// actions in their fixed order, then the WCS group — whatever the form.
for (const c of CONFIGS.filter(c => ["3 XYZ", "5 TCP", "6 TWP", "9", "9 TWP"].includes(c.name))) {
  test(`${c.name}: Tab walks the axis rows, the actions in order, then the WCS`, async ({ page }) => {
    await open(page, c, SURFACES[0]!);
    await page.locator(`${SETUP} input.setupInput`).first().focus();
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      const name = await page.evaluate(sel => {
        const a = document.activeElement as HTMLElement | null;
        if (!a || !document.querySelector(sel)!.contains(a)) return null;
        if (a.matches("input.setupInput")) return "field";
        if (a.getAttribute("role") === "radio") return "WCS";
        // innerText: the stable-width span's hidden alternative ("Unhome All"
        // under "Home All") is not part of what the button says.
        return (a.getAttribute("aria-label") || a.innerText || "").replace(/\s+/g, " ").trim();
      }, SETUP);
      if (name == null) break;
      seen.push(name);
      await page.keyboard.press("Tab");
    }
    const home = (l: string) => `Unhome ${l}`;
    const expected = [...c.axes.flatMap(l => ["field", `Zero ${l}`, home(l)])];
    // A dimmed action explains itself where it is ("Why is this
    // unavailable? …", a focusable hint) — not an action of its own.
    const acts = seen.filter(n => !n.startsWith("Help") && !n.startsWith("Why is this unavailable") && !/^(field|Zero [A-Z]|Unhome [A-Z]|WCS)$/.test(n));
    expect(seen.filter(n => /^(field|Zero [A-Z]|Unhome [A-Z])$/.test(n)), "axis rows in order").toEqual(expected);
    expect(acts.map(a => a.replace(/^Zero (All|XYZ|linear)$/, "Zero All")),
      "actions in order").toEqual(["Zero All", "Unhome All", ...ACTIONS_GOTO, ...(c.twp ? ACTIONS_PLANE.filter(a => a === "Capture plane") : [])]);
    expect(seen.lastIndexOf("field"), "the actions follow the axis rows").toBeLessThan(seen.indexOf("Go to G30"));
    expect(seen.indexOf("WCS"), "the WCS follows the actions").toBeGreaterThan(seen.indexOf("Go to WCS 0"));
  });
}

// Reach: every control can be brought out from under the pinned Safety
// section and takes a press there (outside: [] proves nothing about a
// sticky neighbour — Codex R233).
for (const c of CONFIGS.filter(c => ["3 XYZ", "6 TWP", "9", "9 TWP"].includes(c.name))) {
  for (const s of SURFACES.filter(s => s.zoom)) {
    test(`${c.name}, ${s.name}: every Setup control is reachable beside Safety`, async ({ page }) => {
      await open(page, c, s);
      const missed = await page.evaluate(sel => {
        const strip = document.querySelector<HTMLElement>(".strip")!;
        const safety = document.querySelector<HTMLElement>(".safetyStrip")!;
        const controls = [...document.querySelector(sel)!.querySelectorAll<HTMLElement>("button, input.setupInput")].filter(e => e.offsetParent !== null);
        const out: string[] = [];
        for (const el of controls) {
          const portrait = strip.scrollHeight > strip.clientHeight + 1 && strip.scrollWidth <= strip.clientWidth + 1;
          for (let k = 0; k < 2; k++) {
            const r = el.getBoundingClientRect(), sr = safety.getBoundingClientRect(), vr = strip.getBoundingClientRect();
            if (portrait) {
              if (r.top < sr.bottom + 2) strip.scrollTop -= sr.bottom + 2 - r.top;
              else if (r.bottom > vr.bottom - 2) strip.scrollTop += r.bottom - vr.bottom + 2;
            } else {
              if (r.left < sr.right + 2) strip.scrollLeft -= sr.right + 2 - r.left;
              else if (r.right > vr.right - 2) strip.scrollLeft += r.right - vr.right + 2;
            }
          }
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          if (!hit || !(el.contains(hit) || hit.contains(el)))
            out.push(`${el.getAttribute("aria-label") || el.textContent?.trim() || "field"} → ${hit?.className ?? "nothing"}`);
        }
        return out;
      }, SETUP);
      expect(missed).toEqual([]);
    });
  }
}

// A long frame chip ("MACHINE · off datum · datum moved") never widens the
// section — everything right of Setup would move under a hand — nor moves a
// fixture (it used to push portrait's radios out of the strip).
for (const c of CONFIGS.filter(c => ["5 TCP", "6 TWP"].includes(c.name))) {
  for (const s of SURFACES.filter(s => !s.zoom)) {
    test(`${c.name}, ${s.name}: a long frame chip moves nothing`, async ({ page }) => {
      await open(page, c, s);
      const section = page.locator(SETUP);
      // Within the section: a neighbour LEFT of Setup changing width (the Jog
      // section's frame note) moves the whole section, which is not this rule.
      const geo = async () => section.evaluate(el => {
        const r = el.getBoundingClientRect();
        const radios = [...el.querySelectorAll('[role="radio"]')].map(e => { const b = e.getBoundingClientRect(); return [Math.round(b.x - r.x), Math.round(b.y - r.y), Math.round(b.width)]; });
        return { w: Math.round(r.width), h: Math.round(r.height), radios };
      });
      const before = await geo();
      await ctl({ op: "status_delta", data: { kins_type: 0, wcs_prov_a: [0, 0, 0, 0, 0, 0, 0, 0, 0], rotary_abc: [20, 0, 0],
        ...(c.twp ? { twp_defined: true, twp_datum: [0, 0, 0] } : {}) } });
      await expect(page.locator(".kinsChip")).toContainText(c.twp ? "off datum · datum moved" : "off datum");
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      expect(await geo(), `${c.name} ${s.name}`).toEqual(before);
      expect(await layoutIssues(section)).toEqual([]);
      // the chip and its "?" whole inside the section, on one line
      const chip = await section.evaluate(el => {
        const r = el.getBoundingClientRect(), c = el.querySelector(".kinsChip")!.getBoundingClientRect();
        const lines = new Set([...el.querySelector(".kinsChip")!.getClientRects()].map(q => Math.round(q.top)));
        return { inside: c.left >= r.left - 1 && c.right <= r.right + 1, lines: lines.size };
      });
      expect(chip, `${c.name} ${s.name}: the chip`).toEqual({ inside: true, lines: 1 });
    });
  }
}

// The chip changes while a finger holds a fixture (Codex R235 SL-01: in touch
// portrait at 100 % the long chip wrapped beside "WCS", the head grew 16.5 →
// 37 px and G55 slid 20.5 px from under the finger — the release chose
// nothing). Long, then short again, during ONE held contact: G55 stays under
// the finger and its release chooses it exactly once.
test.describe("a chip change under a held fixture", () => {
  test.use({ hasTouch: true });
  for (const c of CONFIGS.filter(c => ["5 TCP", "6 TWP"].includes(c.name))) {
    for (const s of SURFACES.filter(s => s.touch && !s.zoom)) {
      test(`${c.name}, ${s.name}: G55 stays under the finger and is chosen on release`, async ({ page }) => {
        await open(page, c, s);
        const section = page.locator(SETUP);
        const g55 = section.getByRole("radio", { name: "G55", exact: true });
        await g55.scrollIntoViewIfNeeded();
        const at = async () => g55.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        const press = await at();
        const hits = () => page.evaluate(p => { const e = document.elementFromPoint(p.x, p.y); return e?.getAttribute("role") === "radio" ? e.textContent?.trim() : (e?.className ?? "nothing"); }, press);
        const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        const cdp = await page.context().newCDPSession(page);
        await ctl({ op: "clearCmds" });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x: press.x, y: press.y }] });
        await ctl({ op: "status_delta", data: { kins_type: 0, wcs_prov_a: [0, 0, 0, 0, 0, 0, 0, 0, 0], rotary_abc: [20, 0, 0],
          ...(c.twp ? { twp_defined: true, twp_datum: [0, 0, 0] } : {}) } });
        await expect(page.locator(".kinsChip")).toContainText(c.twp ? "off datum · datum moved" : "off datum");
        await settle();
        expect(await at(), "the long chip: G55 unmoved").toEqual(press);
        expect(await hits(), "the long chip: the finger still on G55").toBe("G55");
        await ctl({ op: "status_delta", data: { rotary_abc: [0, 0, 0], ...(c.twp ? { twp_defined: false } : {}) } });
        await expect(page.locator(".kinsChip")).not.toContainText("off datum");
        await settle();
        expect(await at(), "the short chip again: G55 unmoved").toEqual(press);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect.poll(async () => ((await ctl({ op: "lastCmds" })) as { cmds: { cmd: string; text?: string }[] }).cmds
          .filter(m => m.cmd === "mdi" && m.text === "G55").length, { timeout: 3000 }).toBe(1);
      });
    }
  }
});

// A title's "?" stands centred on its text line (operator 2026-10-30: the
// Setup "?", now right after the word, sat 1.75 px high on the desktop —
// top-anchored 13 px in a 16.5 px line). Every `.sectionHelp` follows the
// same rule: Setup's title and Jog's "Kinematics Frame".
for (const s of [SURFACES[0]!, SURFACES[1]!, SURFACES.find(s => s.name === "portrait touch")!]) {
  test(`${s.name}: a title's "?" is centred on its line`, async ({ page }) => {
    await open(page, CONFIGS.find(c => c.name === "6 TWP")!, s);
    const off = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".strip .sectionHelp")]
      .filter(t => t.offsetParent !== null).map(t => {
        const lh = parseFloat(getComputedStyle(t).lineHeight), r = t.getBoundingClientRect();
        const i = t.querySelector(":scope > .helpIcon")!.getBoundingClientRect();
        return { title: t.textContent!.trim().slice(0, 16), off: Math.round(((i.top + i.height / 2) - (r.top + lh / 2)) * 4) / 4 };
      }));
    expect(off.length, "Setup and Kinematics Frame").toBeGreaterThanOrEqual(2);
    for (const o of off) expect(Math.abs(o.off), `${o.title}: icon centre − line centre`).toBeLessThanOrEqual(0.5);
  });
}

// Portrait at 150 % with the keypad on an axis field: the section keeps its
// axis rows only (design wave D7) — the action block and the WCS title and
// fixtures fold with it, wherever the arrangement put them (Codex R233).
test("portrait touch 150 %, the keypad on an axis field: only the axis rows stay", async ({ page }) => {
  const c = CONFIGS.find(c => c.name === "6 TWP")!;
  await open(page, c, SURFACES.find(s => s.name === "portrait touch 150 %")!);
  const section = page.locator(SETUP);
  const field = section.locator("input.setupInput").first();
  await field.scrollIntoViewIfNeeded();
  await field.click();
  await expect(page.locator(".nkStrip")).toBeVisible();
  for (const name of ["Go to G30", "Unhome All", "Capture plane"])
    await expect(section.getByRole("button", { name, exact: true }), `${name} folded`).toBeHidden();
  await expect(section.getByRole("radio", { name: "G54", exact: true }), "the fixtures folded").toBeHidden();
  await expect(section.locator(".wcsTitle"), "the WCS title folded").toBeHidden();
  await expect(section.locator("input.setupInput"), "every axis field stays").toHaveCount(6);
  await expect(field).toBeVisible();
});

// Before viewer_init the default axis set lays out; the real set re-lays it
// out on arrival (the controls are closed until the first status anyway).
test("a new axis set re-lays the section out", async ({ page }) => {
  await open(page, CONFIGS.find(c => c.name === "3 XYZ")!, SURFACES[0]!);
  await ctl({ op: "setAxes", axes: ["X", "Y", "Z", "A", "B", "C", "U"] });
  await expect(page.locator(`${SETUP} input.setupInput`)).toHaveCount(7);
  const u = (await page.locator(SETUP).getByRole("button", { name: "Zero U", exact: true }).boundingBox())!;
  const g30 = (await page.locator(SETUP).getByRole("button", { name: "Go to G30", exact: true }).boundingBox())!;
  expect(g30.y, "the actions moved under U").toBeGreaterThan(u.y + u.height - 1);
  expect(g30.x + g30.width, "and into its column").toBeGreaterThan(u.x);
});

test.afterAll(async () => { await ctl({ op: "reset" }); });

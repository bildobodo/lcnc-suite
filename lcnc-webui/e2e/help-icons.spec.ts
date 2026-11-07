import { writeFileSync } from "node:fs";
import { test, expect, type Page, type Locator } from "./test";
import { ctl, MOCK } from "./ctl";
import { toolsetterSetup, toolsetterVarMap } from "../src/toolsetterSetup";

// Every "?" looks the same wherever it stands (operator 2026-11-07: the
// toolsetter line's "?" sat lower than Touch X's, and the glyph sometimes
// sat left in its circle). Two properties, in every tab, the strip, the
// Settings dialog, the kinematics chip and the HUD, at DPR 1 and 2:
//  - the GLYPH in its circle, in drawn pixels: three clips per icon — as
//    drawn, glyph transparent, icon hidden; glyph = |drawn − glyphless|,
//    circle = |glyphless − hidden|. Its centroid's offset from the circle's
//    is one value for every icon (a text glyph snapped apart from its circle
//    by up to 1 px with the icon's fractional position; the mask over the
//    icon's own box lands with it).
//  - the CIRCLE at its text, in layout: its centre on the capitals' middle
//    of the text it explains (the engine's own baseline and cap height: an
//    empty inline-block of height 1cap after the last character). Inline
//    in running text by `vertical-align`, beside a label by the flex row;
//    the drawn pixels add the browser's own rounding, which no rule removes.
// HELP_OUT=<file> writes every row (the measurement behind the limits).

const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, spindleStop: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, sourceWrite: true, toolTableWrite: true, armed: true, always: true,
  programLoad: true, modeManual: true, modeCoord: true, parameterRead: true, g30Write: true, spindleManual: true, armEnable: true, estopReset: true,
};
const SET_UP = { touchX: 0, touchY: 0, touchZ: -300, fastFeed: 200, slowFeed: 20, traverseFeed: 500,
  maxZTravel: 180, retractDist: 2, spindleZeroHeight: 180 };
const GLYPHLESS = ".helpIcon { color: transparent !important; }";
const HIDDEN = ".helpIcon { visibility: hidden !important; }";
// the glyph: its offset varies by less than this over all icons (measured
// 0.02–0.05 px with the mask; a text glyph 0.5–1.5 px)
const GLYPH_SPREAD = 0.1;
// the circle: its layout centre within this of the capitals' middle
// (measured −0.02…+0.36 px — a flex row rounds the font's metrics to whole
// px; inline in running text it was +1.0 / +1.08 px)
const CAP_TOL = 0.5;

type Geo = { name: string; icon: [number, number, number, number]; capMid: number | null };

async function geometry(icon: Locator): Promise<Geo> {
  return icon.evaluate(el => {
    const r = el.getBoundingClientRect();
    // the text it explains: the nearest preceding visible character on its line
    let last: Text | null = null;
    const walker = document.createTreeWalker(el.parentElement!.parentElement ?? document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
      if (el.contains(t)) break;
      if (!(t.textContent ?? "").trim()) continue;
      if (!(el.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING)) break;
      const end = (t.textContent ?? "").replace(/\s+$/, "").length;
      const range = document.createRange(); range.setStart(t, Math.max(0, end - 1)); range.setEnd(t, end);
      const rr = [...range.getClientRects()].at(-1);
      if (rr && rr.bottom > r.top && rr.top < r.bottom && rr.right <= r.left + 0.5) last = t;
    }
    // no text before it on its line (a table head holding only its "?"):
    // the line's own capitals, the probe right before the icon
    const s = document.createElement("span");
    s.style.cssText = "display:inline-block;width:0;height:1cap;margin:0;padding:0;border:0";
    if (last) last.after(s); else el.before(s);
    const p = s.getBoundingClientRect(); s.remove();
    const capMid: number | null = p.height > 0 ? p.top + p.height / 2 : null;
    return { name: el.getAttribute("aria-label") ?? "?", icon: [r.left, r.top, r.width, r.height], capMid };
  });
}

async function clip(page: Page, g: Geo, css: string | null): Promise<string> {
  const tag = css ? await page.addStyleTag({ content: css }) : null;
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const [x, y, w, h] = g.icon;
  const png = await page.screenshot({ clip: { x: x - 2, y: y - 2, width: w + 4, height: h + 4 }, animations: "disabled" });
  if (tag) await tag.evaluate(t => (t as Element).remove());
  return png.toString("base64");
}

// decoded on a blank page (no app CSP, no app state): the weighted centroid
// of |a − b|, in CSS px from the icon box's top-left
async function centroids(tool: Page, drawn: string, glyphless: string, hidden: string, dpr: number) {
  return tool.evaluate(async ([drawn, glyphless, hidden, dpr]) => {
    async function px(b64: string) {
      const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const x = c.getContext("2d")!; x.drawImage(img, 0, 0);
      return x.getImageData(0, 0, c.width, c.height);
    }
    function centre(a: ImageData, b: ImageData) {
      let sw = 0, sx = 0, sy = 0;
      for (let i = 0; i < a.width * a.height; i++) {
        const d = Math.abs(a.data[4 * i]! - b.data[4 * i]!) + Math.abs(a.data[4 * i + 1]! - b.data[4 * i + 1]!)
          + Math.abs(a.data[4 * i + 2]! - b.data[4 * i + 2]!);
        sw += d; sx += d * (i % a.width + 0.5); sy += d * (Math.floor(i / a.width) + 0.5);
      }
      return sw ? { x: sx / sw / dpr - 2, y: sy / sw / dpr - 2 } : null;
    }
    const [d, g, h] = await Promise.all([px(drawn), px(glyphless), px(hidden)]);
    return { glyph: centre(d, g), circle: centre(g, h) };
  }, [drawn, glyphless, hidden, dpr] as const);
}

// desktop at DPR 1 and 2; touch (its own 16 px circle and glyph tile) at DPR 1
for (const { dpr, touch } of [{ dpr: 1, touch: false }, { dpr: 2, touch: false }, { dpr: 1, touch: true }]) {
  const form = `${touch ? "touch" : "desktop"}, DPR ${dpr}`;
  test.describe(form, () => {
    test.use({ deviceScaleFactor: dpr, viewport: { width: 1600, height: 1000 }, hasTouch: touch });

    test(`every "?": its glyph in one place in its circle, the circle on its text's capitals (${form})`, async ({ page, context }) => {
      test.setTimeout(240_000);
      const tool = await context.newPage();
      await tool.setContent("<!doctype html><title>decode</title>");
      await ctl({ op: "reset" });
      await page.goto(MOCK);
      await expect(page.locator("input.setupInput").first()).toBeVisible();
      if (touch) {
        // the touch sizes switch on once a touch press has ended (touchDetect)
        await page.touchscreen.tap(5, 400);
        await expect(page.locator("html")).toHaveClass(/touch-device/);
      }
      await ctl({ op: "quiet", on: true });
      await ctl({ op: "status_delta", data: { active_file: "/A.ngc", permissions: PERMS_ALL } });
      // the toolsetter set up and confirmed: its line carries a "?" in running text
      await ctl({ op: "raw", frame: { type: "settings_init", settings: { toolsetter: SET_UP } } });
      const s = toolsetterSetup(SET_UP);
      const keys = Object.fromEntries(Object.entries(s.ok ? toolsetterVarMap(s.values) : {})
        .map(([k, v]) => [k, { value: v, origin: "applied" }]));
      await ctl({ op: "status_delta", data: {}, envelope: { toolsetter_booking: { version: 1, keys } } });
      await page.mouse.move(0, 0);

      type Row = { view: string; name: string; glyphDx: number | null; glyphDy: number | null; vsCap: number | null };
      const rows: Row[] = [];
      async function sweep(view: string, root: Locator) {
        const icons = root.locator(".helpIcon:visible");
        const n = await icons.count();
        for (let i = 0; i < n; i++) {
          // one at a time, each in the window (a scroller shows a part at a time)
          await icons.nth(i).evaluate(el => el.scrollIntoView({ block: "center", inline: "nearest" }));
          const g = await geometry(icons.nth(i));
          const c = await centroids(tool, await clip(page, g, null), await clip(page, g, GLYPHLESS), await clip(page, g, HIDDEN), dpr);
          const r2 = (v: number) => Math.round(v * 100) / 100;
          rows.push({ view, name: g.name,
            glyphDx: c.glyph && c.circle ? r2(c.glyph.x - c.circle.x) : null,
            glyphDy: c.glyph && c.circle ? r2(c.glyph.y - c.circle.y) : null,
            vsCap: g.capMid === null ? null : r2(g.icon[1] + g.icon[3] / 2 - g.capMid) });
        }
      }
      const side = page.locator(".sidePane");
      await sweep("strips", page.locator(".strip"));
      for (const tab of ["Program", "MDI", "Offsets", "Tools", "Macros"]) {
        await side.getByRole("tab", { name: tab, exact: true }).click();
        await sweep(tab, side);
      }
      await side.getByRole("tab", { name: "Probing", exact: true }).click();
      for (const sub of ["Outside", "Inside", "Angle", "Boss/Pocket", "Ridge/Valley", "Surface", "Calibrate", "Toolsetter"]) {
        await side.getByRole("tab", { name: sub, exact: true }).click();
        await sweep(`Probing/${sub}`, side);
      }
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const settings = page.locator(".dialogOverlay").last();
      for (const tab of ["3D Viewer", "Machine", "Display", "Gamepad", "Keyboard"]) {
        await settings.getByRole("tab", { name: tab, exact: true }).click();
        await sweep(`Settings/${tab}`, settings);
      }
      await settings.getByRole("button", { name: "Close settings", exact: true }).click();
      // the kinematics chip, the jog frame and the HUD (a switchable machine off its datum)
      await ctl({ op: "setAxes", axes: ["X", "Y", "Z", "A", "C"] });
      await ctl({ op: "setKins", kins: { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: true, params: {} } });
      await ctl({ op: "status_delta", data: { kins_type: 0, g5x_index: 1, wcs_prov_a: [0, 0, 0, 0, 0, 0, 0, 0, 0], rotary_abc: [20, 0, 0] } });
      await expect(page.locator(".kinsChip")).toContainText("off datum");
      await sweep("kins chip", page.locator(".kinsChip"));
      await sweep("jog frame", page.locator(".choiceCol"));
      await sweep("HUD", page.locator(".hudMode"));
      if (process.env.HELP_OUT) writeFileSync(`${process.env.HELP_OUT}-${touch ? "touch" : "desktop"}-${dpr}.json`, JSON.stringify(rows, null, 1));

      expect(rows.length, "the sweep found the icons").toBeGreaterThan(100);
      expect(rows.some(r => r.name === "Help: LinuxCNC parameters"), "the toolsetter line's inline \"?\" is measured").toBe(true);
      const at = (r: Row) => `${r.view} · ${r.name}`;
      const drawn = rows.filter(r => r.glyphDx !== null && r.glyphDy !== null);
      expect(drawn.length, "every icon's glyph and circle were found in its pixels").toBe(rows.length);
      for (const axis of ["glyphDx", "glyphDy"] as const) {
        const v = drawn.map(r => r[axis]!);
        const lo = drawn[v.indexOf(Math.min(...v))]!, hi = drawn[v.indexOf(Math.max(...v))]!;
        expect.soft(Math.max(...v) - Math.min(...v),
          `${axis}: the glyph moves in its circle — ${at(lo)} ${lo[axis]}, ${at(hi)} ${hi[axis]}`).toBeLessThanOrEqual(GLYPH_SPREAD);
      }
      const off = rows.filter(r => r.vsCap === null || Math.abs(r.vsCap) > CAP_TOL);
      expect(off.map(r => `${at(r)}: ${r.vsCap === null ? "no text found" : `${r.vsCap} px below the capitals' middle`}`),
        "every circle on its text's capitals").toEqual([]);
    });
  });
}

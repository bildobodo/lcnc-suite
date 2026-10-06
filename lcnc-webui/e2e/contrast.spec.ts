import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK, publishToolTable } from "./ctl";
import { clickMore } from "./more";
import { encode } from "@msgpack/msgpack";

// Design wave D8 (UI-K08 / K09, UI-D07): every text the operator reads
// meets 4.5 : 1 against what is RENDERED behind it — in the four themes,
// on the main surfaces, in Settings and dialogs, the code viewer's syntax,
// the inline notes, the hint card and the HUD. The pair is measured, not
// looked up: the text colour composited through its ancestors' opacity
// over the translucent layers down to the first opaque background
// (colours normalised through a canvas, so color-mix / oklab count).
// Disabled controls are exempt (WCAG: inactive UI).
//
// Runs under `serial-guards`: mock-global state.

// The four explicit themes, plus AUTO under a dark system scheme: that is a
// fifth palette (style.css's `prefers-color-scheme: dark` block for a root
// without data-theme), and every role must land in it too.
const PASSES = ["light", "dark", "hc-light", "hc-dark", "auto-dark"] as const;
const PERMS_ALL = {
  idle: true, jog: true, override: true, ready: true, run: true, pause: false,
  resume: false, step: true, abort: true, probe: true, zero: true,
  machineFrame: true, goZero: true, planeFrame: true,
  touchoff: true, touchoffRotary: true, twpCapture: true,
  surfaceComp: true, safety: true, setup: true, armed: true, always: true,
};
// Every token class the highlighter emits: comment, M, G, coordinates,
// parameters, N-number.
const PROGRAM = "(syntax sample)\nN10 G21 G90\nG0 X10.5 Y-2 Z5\nM3 S12000\n#<depth> = 2.5\nG1 Z[-#<depth>] F300 ; cut\nM30\n";
const TOOLS = [
  { T: 5, P: 5, Z: -40.12, D: 6, type: "endmill", description: "Test cutter", remark: "" },
  { T: 12, P: 12, Z: -55.5, D: 10, type: "drill", description: "HSS drill", remark: "" },
];
const FILES = { ok: true, nc_dir: "/nc_files", subdir: "", entries: [
  { name: "sub", type: "directory", path: "sub" }, { name: "a.ngc", type: "file", path: "a.ngc", size: 2048 }] };

interface Hit { where: string; text: string; ratio: number; fg: string; bg: string; min: number }

/** In-page: every visible text of `rootSel` below `floor` (self-contained — serialised). */
function scan(args: { rootSel: string; floor: number }): { hits: Hit[]; checked: number } {
  type RGB = [number, number, number];
  type RGBA = [number, number, number, number];
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true })!;
  const rgba = (css: string): RGBA => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = css;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  };
  const over = (top: RGBA, under: RGB): RGB =>
    [0, 1, 2].map(i => top[i]! * top[3] + under[i]! * (1 - top[3])) as RGB;
  const lum = (c: RGB) => {
    const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a: RGB, b: RGB) => {
    const l = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l[0]! + 0.05) / (l[1]! + 0.05);
  };
  const root = getComputedStyle(document.documentElement);
  const rgb = (c: RGBA): RGB => [c[0], c[1], c[2]];
  const pageBg = rgb(rgba(getComputedStyle(document.body).backgroundColor));
  const themeFg = rgb(rgba(root.getPropertyValue("--fg")));
  // A translucent card that floats over content the DOM does not describe
  // (the HUD and sim bar over the WebGL scene, the hint and the help card
  // over any panel): what shows through may be the page OR foreground-dark
  // geometry — both must pass.
  const FLOATING = ".overlay-card, .btnHint, .helpPopover";
  /** The possible backgrounds behind `el`: translucent ancestor layers over the first opaque one. */
  const backdrops = (el: Element): RGB[] => {
    const layers: RGBA[] = [];
    let floats = false;
    let opaque: RGB | null = null;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] >= 1) { opaque = rgb(c); break; }
      if (c[3] > 0) layers.push(c);
      if (e.matches(FLOATING)) { floats = true; break; }
    }
    const compose = (base: RGB) => {
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i]!, base);
      return base;
    };
    if (opaque) return [compose(opaque)];
    return floats ? [compose(pageBg), compose(themeFg)] : [compose(pageBg)];
  };
  const opacityChain = (el: Element) => {
    let o = 1;
    for (let e: Element | null = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  };
  const inactive = (el: Element) =>
    !!el.closest("button:disabled, input:disabled, select:disabled, fieldset:disabled, [aria-disabled='true'], .btnTip, label:has(input:disabled)");
  const path = (el: Element) => {
    const parts: string[] = [];
    for (let e: Element | null = el; e && parts.length < 3; e = e.parentElement) {
      const cls = [...e.classList].filter(c => !c.startsWith("data-v")).slice(0, 2).join(".");
      parts.unshift(e.tagName.toLowerCase() + (cls ? "." + cls : ""));
    }
    return parts.join(" > ");
  };
  const hits: Hit[] = [];
  let checked = 0;
  const seen = new Set<Element>();
  // The timeline-mark colours (× ▲ ●) are IDENTIFICATION colours, one bright
  // set in every theme, the background secondary (operator 2026-10-06): a
  // text drawn in one of them — a count of that kind, a marked line number —
  // is exempt from the reading contrast. themeTokens.test holds the set
  // apart from each other instead.
  const rootCs = getComputedStyle(document.documentElement);
  const marks = ["--mark-clash", "--mark-limit", "--mark-tool"].map(v => rgba(rootCs.getPropertyValue(v).trim()));
  const isMark = (c: RGBA) => marks.some(m => Math.abs(m[0] - c[0]) <= 1 && Math.abs(m[1] - c[1]) <= 1 && Math.abs(m[2] - c[2]) <= 1);
  for (const host of document.querySelectorAll(args.rootSel)) {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent?.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === "hidden" || el.closest("[aria-hidden='true']") || inactive(el)) continue;
      const fg0 = rgba(cs.color);
      if (isMark(fg0)) continue;
      checked++;
      const a = fg0[3] * opacityChain(el);
      let worst: { q: number; fg: RGB; bg: RGB } | null = null;
      for (const bg of backdrops(el)) {
        const fg = over([fg0[0], fg0[1], fg0[2], a], bg);
        const q = ratio(fg, bg);
        if (!worst || q < worst.q) worst = { q, fg, bg };
      }
      if (worst && worst.q < args.floor) hits.push({ where: path(el), text: n.textContent.trim().slice(0, 30), ratio: Math.round(worst.q * 100) / 100,
        fg: `rgb(${worst.fg.map(Math.round).join(",")})`, bg: `rgb(${worst.bg.map(Math.round).join(",")})`, min: args.floor });
    }
  }
  return { hits, checked };
}

async function ready(page: Page, pass: string) {
  await ctl({ op: "reset" });
  await page.setViewportSize({ width: 1600, height: 1000 });
  // No pulse or fade mid-measure; auto-dark = the system asks for dark.
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: pass === "auto-dark" ? "dark" : "light" });
  await page.route("**/gcode?*", route => route.fulfill({ contentType: "text/plain", body: PROGRAM }));
  await page.route(url => url.pathname === "/files", route => route.fulfill({ json: FILES }));
  await page.goto(MOCK);
  await expect(page.locator("input.setupInput").first()).toBeVisible();
  await ctl({ op: "status_delta", data: { active_file: "/S.ngc", homed: [1, 1, 1], enabled: true, is_enabled: true, permissions: PERMS_ALL,
    tool_number: 5, permission_reasons: { pause: "Program not running", resume: "Program not paused" } } });
  const theme = pass === "auto-dark" ? "auto" : pass;
  await ctl({ op: "raw", frame: { type: "settings_init", settings: { display: { theme }, machine: { runFromLine: true } } } });
  if (theme === "auto") {
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe("rgb(255, 255, 255)");
  } else {
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  }
  await ctl({ op: "raw", frame: { type: "viewer_gcode_ready", version: 800, file: "/S.ngc" } });
  await expect(page.locator(".codeLine").first()).toContainText("(syntax sample)");
}

for (const pass of PASSES) {
  test(`${pass}: every readable text meets 4.5 : 1 on what is rendered behind it`, async ({ page }) => {
    test.setTimeout(180_000);
    await ready(page, pass);
    const hits: Hit[] = [];
    let checked = 0;
    const take = async (surface: string, rootSel: string) => {
      // A text mid-fade is not a colour (Vue transition classes), nor is a
      // button mid-way through its background transition after the theme
      // switched (CSS transitions are animations too; the infinite ones are
      // stopped by reduced motion).
      await expect(page.locator('[class*="-enter-active"], [class*="-leave-active"]')).toHaveCount(0);
      await page.waitForFunction(() => document.getAnimations().every(a =>
        a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity));
      const r = await page.evaluate(scan, { rootSel, floor: 4.5 });
      expect(r.checked, `${surface}: the scan saw text`).toBeGreaterThan(0);
      checked += r.checked;
      hits.push(...r.hits.map(h => ({ ...h, where: `${surface}: ${h.where}` })));
    };
    const delta = (data: Record<string, unknown>) => ctl({ op: "status_delta", data });

    await take("page", "header.hdr, .statusBanner, .strip, .sidePane, .viewerPane .overlay-card");
    // Program: a selected line, then Run from line on it, the editor, the files.
    await page.locator(".codeLine").nth(2).click();
    await expect(page.locator(".codeLine.selected")).toHaveCount(1);
    await take("Program/selected", ".sidePane");
    await page.getByRole("button", { name: /^Start L\d+$/ }).click();
    const rfl = page.getByRole("dialog", { name: /^Run from Line/ });
    await expect(rfl).toBeVisible();
    await take("Run from line", '[role="dialog"]');
    await rfl.getByRole("button", { name: "Cancel", exact: true }).click();
    await clickMore(page.locator(".ctrlRow"), "Edit");
    await expect(page.locator(".cm-content")).toBeVisible();
    await take("Program/editor", ".sidePane");
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.locator(".cm-content")).toHaveCount(0);
    await clickMore(page.locator(".ctrlRow"), "Files");
    await expect(page.getByRole("button", { name: "a.ngc", exact: true })).toBeVisible();
    await take("Program/files", ".sidePane");
    await clickMore(page.locator(".ctrlRow"), "Files");
    for (const tab of ["MDI", "Probing", "Offsets", "Tools"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      if (tab === "Tools") {
        await publishToolTable(TOOLS);
        await expect.poll(() => page.locator(".toolsTab tbody tr").count()).toBe(2);
      }
      await take(tab, ".sidePane");
      if (tab === "Probing") {
        // A help card, open.
        await page.locator('.sidePane [role="button"][aria-label^="Help:"]:visible').first().click();
        await expect(page.locator(".helpPopover:popover-open")).toHaveCount(1);
        await take("help", ".helpPopover:popover-open");
        await page.keyboard.press("Tab");
      }
    }
    // Settings, every section.
    await page.getByTitle("Settings", { exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    for (const tab of await settings.getByRole("tablist").first().getByRole("tab").allTextContents()) {
      await settings.getByRole("tab", { name: tab.trim(), exact: true }).click();
      await take(`Settings/${tab.trim()}`, '[role="dialog"]');
      if (tab.trim() === "HAL") {
        // A pin group open: the pin rows (a linked signal, "unlinked", TRUE / FALSE).
        await settings.locator(".halGroupHeader").first().click();
        await expect(settings.getByText("unlinked", { exact: true }).first()).toBeVisible();
        await take("Settings/HAL pins", '[role="dialog"]');
      }
    }
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    // A dialog with body text, the G-code reference.
    await page.getByTitle("G-code Reference", { exact: true }).click();
    await take("Reference", '[role="dialog"]');
    await page.getByRole("button", { name: "Close reference", exact: true }).click();
    // The hint card at a dimmed control.
    await page.getByRole("tab", { name: "Program", exact: true }).click();
    await page.locator(".sidePane .btnTip:visible").first().click({ force: true });
    await expect(page.locator("[data-btn-hint]")).toBeVisible();
    await take("hint", "[data-btn-hint]");
    // The inline notes: error, warn, ok.
    await page.evaluate(() => {
      const host = document.querySelector(".sidePane")!;
      for (const k of ["error", "warn", "ok"]) {
        const n = document.createElement("div");
        n.className = `statusNote ${k} contrastProbe`;
        n.textContent = `A ${k} note`;
        host.prepend(n);
      }
    });
    await take("statusNote", ".contrastProbe");
    await page.evaluate(() => document.querySelectorAll(".contrastProbe").forEach(n => n.remove()));

    // Machine states: running (Abort in the banner, Pause live), a preview
    // re-parse (warn banner, the HUD's stale chip), E-Stop (danger tier).
    await delta({ interp_state: 2, permissions: { ...PERMS_ALL, pause: true, idle: false, ready: false, run: false } });
    await expect(page.locator(".bannerActions").getByRole("button", { name: "Abort" })).toBeVisible();
    await take("running", "header.hdr, .statusBanner, .strip, .sidePane, .viewerPane .overlay-card");
    await delta({ interp_state: 1, permissions: PERMS_ALL });
    await ctl({ op: "quiet", on: true });
    await ctl({ op: "raw", frame: { type: "status_delta", armed: true, data: {}, preview_refresh:
      { reason: "wcsoff:G54:x", file: "/S.ngc", expected_ms: 30000, started_ms: 1000, queued: false, superseded: 0 } } });
    await expect(page.locator(".bannerProgress")).toContainText("Re-parsing");
    await take("preview refresh", ".statusBanner, .viewerPane .overlay-card");
    // A safety trip: the error tier, Acknowledge in the banner.
    await ctl({ op: "raw", frame: { type: "status_delta", armed: true, data: {}, safety_trip: { reason: "hb_timeout" } } });
    await expect(page.locator(".bannerError")).toBeVisible();
    await take("safety trip", ".statusBanner");
    await ctl({ op: "quiet", on: false });
    await delta({ estop: true, is_estop: true, enabled: false, is_enabled: false });
    await expect(page.locator(".statusBanner")).toContainText(/E-?STOP/i);
    await take("E-Stop", "header.hdr, .statusBanner, .strip");

    const report = hits.map(h => `${h.ratio} < ${h.min}  ${h.where}  "${h.text}"  ${h.fg} on ${h.bg}`);
    expect(checked, "the scan saw the surfaces it guards").toBeGreaterThan(300);
    expect(report, `${pass}: ${report.length} texts below 4.5 : 1\n${report.join("\n")}`).toEqual([]);
  });
}

// The keyboard ring is an informative graphic (WCAG 1.4.11): 3 : 1 against
// every surface a control sits on. `--info` #569cd6 was 2.9 : 1 on white —
// the ring is its own role, --focus-ring (design wave D8).
for (const pass of PASSES) {
  test(`${pass}: the focus ring keeps 3 : 1 on every surface`, async ({ page }) => {
    await ready(page, pass);
    await page.locator(".sidePane").getByRole("tab", { name: "Program", exact: true }).focus();
    await page.keyboard.press("ArrowRight");   // keyboard focus: :focus-visible
    const r = await page.evaluate(() => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      const cx = cv.getContext("2d", { willReadFrequently: true })!;
      const rgb = (css: string) => {
        cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        return [d[0]!, d[1]!, d[2]!];
      };
      const lum = (c: number[]) => {
        const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
      };
      const ratio = (a: number[], b: number[]) => { const l = [lum(a), lum(b)].sort((x, y) => y - x); return (l[0]! + 0.05) / (l[1]! + 0.05); };
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      const ring = rgb(cs.outlineColor);
      return {
        focused: el.getAttribute("role"), width: parseFloat(cs.outlineWidth), style: cs.outlineStyle,
        isRole: ring.join() === rgb(root.getPropertyValue("--focus-ring")).join(),
        ratios: Object.fromEntries(["--bg", "--panel", "--button-bg"].map(v =>
          [v, Math.round(ratio(ring, rgb(root.getPropertyValue(v))) * 100) / 100])),
      };
    });
    expect(r.focused, "a tab holds keyboard focus").toBe("tab");
    expect(r.style).toBe("solid");
    expect(r.width).toBeGreaterThanOrEqual(2);
    expect(r.isRole, "the ring is --focus-ring").toBe(true);
    for (const [surface, q] of Object.entries(r.ratios)) expect(q, `ring on ${surface}`).toBeGreaterThanOrEqual(3);
  });
}

// Viewer contrast plan, V5 (WCAG 1.4.11): what identifies a control or a
// floating card holds 3 : 1 against what lies next to it — the text passes
// above measure words only. Active controls only (inactive UI is exempt).
// - Cards over the 3D scene (.overlay-card, the warn variant too): the edge
//   or the body against the scene — the page background AND the lit table
//   (#e1e1e1, rendered), since a card floats over either.
// - Switches: the edge or the track against the panel behind, the knob
//   against the track, in both states.
// - Icon glyphs in buttons: their colour against the button.
// - Slider thumbs, from RENDERED PIXELS (a thumb is a pseudo-element no
//   computed style reports): found along the slider's axis — horizontal or
//   vertical — by the thumb's colour, then its centre pixel against the track
//   beside it and the card across from it.
// The viewer (scrub bar, simulation off and on), the strip (jog speed, the
// vertical overrides) and Settings (its sliders and switches), five themes.
const LIT_TABLE = "#e1e1e1";
function nonText(args: { rootSel: string; scene: string[] }): { hits: string[]; checked: number } {
  type RGB = [number, number, number];
  type RGBA = [number, number, number, number];
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true })!;
  const rgba = (css: string): RGBA => {
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = "#000"; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  };
  const over = (top: RGBA, under: RGB): RGB => [0, 1, 2].map(i => top[i]! * top[3] + under[i]! * (1 - top[3])) as RGB;
  const lum = (c: RGB) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a: RGB, b: RGB) => { const l = [lum(a), lum(b)].sort((x, y) => y - x); return (l[0]! + 0.05) / (l[1]! + 0.05); };
  const rgb = (c: RGBA): RGB => [c[0], c[1], c[2]];
  const scene = args.scene.map(s => rgb(rgba(s)));
  const pageBg = rgb(rgba(getComputedStyle(document.body).backgroundColor));
  /** What lies behind `el`: its ancestors' layers down to the first opaque one (a floating card: the scene). */
  const behind = (el: Element | null): RGB[] => {
    const layers: RGBA[] = [];
    for (let e = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if (c[3] >= 1) return [layers.reduceRight((b, l) => over(l, b), rgb(c))];
      if (c[3] > 0) layers.push(c);
      if (e.matches(".overlay-card")) return scene.map(s => layers.reduceRight((b, l) => over(l, b), s));
    }
    return [layers.reduceRight((b, l) => over(l, b), pageBg)];
  };
  const shown = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const inactive = (el: Element) => !!el.closest("button:disabled, input:disabled, fieldset:disabled, [aria-disabled='true'], .btnTip");
  const name = (el: Element) => `${el.tagName.toLowerCase()}.${[...el.classList].filter(c => !c.startsWith("data-v")).slice(0, 2).join(".")}`
    + (el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : "");
  const hits: string[] = [];
  let checked = 0;
  for (const root of document.querySelectorAll(args.rootSel)) {
    for (const card of [root, ...root.querySelectorAll(".overlay-card")].filter(e => e.matches(".overlay-card") && shown(e))) {
      checked++;
      const cs = getComputedStyle(card);
      const edge = rgba(cs.borderTopColor), body = rgba(cs.backgroundColor);
      for (const s of scene) {
        const q = Math.max(ratio(over(edge, s), s), ratio(over(body, s), s));
        if (q < 3) hits.push(`${name(card)}: edge/body ${q.toFixed(2)} on the scene rgb(${s})`);
      }
    }
    for (const t of root.querySelectorAll("input.toggle")) {
      if (!shown(t) || inactive(t)) continue;
      checked++;
      const cs = getComputedStyle(t);
      for (const back of behind(t.parentElement)) {
        const track = over(rgba(cs.backgroundColor), back);
        const edgeCss = /rgba?\([^)]*\)/.exec(cs.boxShadow)?.[0];
        const edge = edgeCss ? over(rgba(edgeCss), back) : track;
        const q = Math.max(ratio(edge, back), ratio(track, back));
        if (q < 3) hits.push(`${name(t)}${(t as HTMLInputElement).checked ? " on" : " off"}: edge/track ${q.toFixed(2)} on its panel`);
        const knob = over(rgba(getComputedStyle(t, "::after").backgroundColor), track);
        const k = ratio(knob, track);
        if (k < 3) hits.push(`${name(t)}${(t as HTMLInputElement).checked ? " on" : " off"}: knob ${k.toFixed(2)} on the track`);
      }
    }
    for (const svg of root.querySelectorAll("button svg")) {
      const btn = svg.closest("button")!;
      if (!shown(svg) || inactive(btn)) continue;
      checked++;
      const colour = rgba(getComputedStyle(svg).color);
      for (const back of behind(btn)) {
        const q = ratio(over(colour, back), back);
        if (q < 3) hits.push(`${name(btn)}: glyph ${q.toFixed(2)} on the button`);
      }
    }
  }
  return { hits, checked };
}

/** Slider thumbs from rendered pixels: each active range in `rootSel`. */
async function thumbs(page: Page, rootSel: string): Promise<{ hits: string[]; checked: number }> {
  const shot = await page.screenshot();
  return page.evaluate(async ({ png, rootSel }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext("2d", { willReadFrequently: true })!;
    cx.drawImage(img, 0, 0);
    const px = (x: number, y: number) => Array.from(cx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!); };
    const ratio = (a: number[], b: number[]) => { const l = [lum(a), lum(b)].sort((x, y) => y - x); return (l[0]! + 0.05) / (l[1]! + 0.05); };
    const probe = document.createElement("div");
    probe.style.color = "var(--fg)"; document.body.append(probe);
    const fg = getComputedStyle(probe).color.match(/\d+/g)!.slice(0, 3).map(Number); probe.remove();
    const scale = img.width / window.innerWidth;
    const hits: string[] = [];
    let checked = 0;
    for (const root of document.querySelectorAll(rootSel)) {
      for (const input of root.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
        const r = input.getBoundingClientRect();
        if (!r.width || !r.height || input.disabled || input.closest("fieldset:disabled")) continue;
        // On screen and on top (not scrolled away inside a dialog, not covered).
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(hit === input || input.contains(hit))) continue;
        checked++;
        const vertical = r.height > r.width;
        // The thumb overflows a thin track's box: the card lies beyond the larger of the two.
        const thumbPx = parseFloat(getComputedStyle(input).getPropertyValue("--range-thumb")) || 20;
        const len = (vertical ? r.height : r.width) * scale;
        const at = (t: number, off = 0) => vertical
          ? px((r.left + r.width / 2) * scale + off, r.top * scale + t)
          : px(r.left * scale + t, (r.top + r.height / 2) * scale + off);
        // The thumb: the longest run along the axis nearest the thumb colour.
        let best = -1, bestD = Infinity;
        for (let t = 1; t < len - 1; t++) { const c = at(t), d = Math.hypot(c[0]! - fg[0]!, c[1]! - fg[1]!, c[2]! - fg[2]!); if (d < bestD) { bestD = d; best = t; } }
        let a = best, b = best;
        const near = (t: number) => { const c = at(t); return Math.hypot(c[0]! - fg[0]!, c[1]! - fg[1]!, c[2]! - fg[2]!) < bestD + 40; };
        while (a > 1 && near(a - 1)) a--;
        while (b < len - 2 && near(b + 1)) b++;
        const centre = at((a + b) / 2);
        const trackT = a > len - b ? a - 3 * scale : b + 3 * scale;
        const track = at(trackT);
        const cross = (Math.max(vertical ? r.width : r.height, thumbPx) / 2 + 4) * scale;
        const card = at((a + b) / 2, cross);
        const what = `${input.getAttribute("aria-label") || input.className || "range"}`;
        if (bestD > 60) { hits.push(`${what}: no thumb found (nearest ${bestD.toFixed(0)})`); continue; }
        const qt = ratio(centre, track), qc = ratio(centre, card);
        if (qt < 3) hits.push(`${what}: thumb ${qt.toFixed(2)} on its track rgb(${track})`);
        if (qc < 3) hits.push(`${what}: thumb ${qc.toFixed(2)} on its card rgb(${card})`);
      }
    }
    return { hits, checked };
  }, { png: shot.toString("base64"), rootSel });
}

const NONTEXT_PREVIEW = Buffer.from(encode({ file: "/S.ngc", preview_schema: 10,
  feed: Array.from({ length: 30 }, (_, i) => [i * 3, i % 2 ? 20 : 0, 0]),
  feed_lines: Array.from({ length: 30 }, (_, i) => i + 3), feed_seq: Array.from({ length: 30 }, (_, i) => i + 3),
  rapid: [[0, 0, 5], [0, 0, 0]], rapid_lines: [1, 2], rapid_seq: [1, 2] }));

for (const pass of PASSES) {
  test(`${pass}: controls and floating cards keep 3 : 1 where they meet what is next to them`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.route(/\/preview(\?|$)/, r => r.fulfill({ contentType: "application/octet-stream", body: NONTEXT_PREVIEW }));
    await ready(page, pass);
    await expect(page.locator(".scrubBar")).toBeVisible();
    const scene = async () => [await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()), LIT_TABLE];
    const hits: string[] = [];
    let checked = 0;
    const take = async (surface: string, rootSel: string) => {
      await page.waitForFunction(() => document.getAnimations().every(a =>
        a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity));
      const r = await page.evaluate(nonText, { rootSel, scene: await scene() });
      const t = await thumbs(page, rootSel);
      expect(r.checked + t.checked, `${surface}: the pass saw controls`).toBeGreaterThan(0);
      checked += r.checked + t.checked;
      hits.push(...[...r.hits, ...t.hits].map(h => `${surface}: ${h}`));
    };
    await take("viewer", ".viewerPane .overlay-card, .viewerPane .scrubBar");
    await take("strip", ".strip");
    // Simulation on (a stopped machine): the switch's on state, the warn banner.
    await ctl({ op: "status_delta", data: { is_enabled: false, enabled: false } });
    await page.locator(".scrubBar input.toggle").check();
    await expect(page.locator(".simBanner")).toBeVisible();
    await take("viewer, simulating", ".viewerPane .overlay-card, .viewerPane .scrubBar");
    await page.locator(".scrubBar input.toggle").uncheck();
    await ctl({ op: "status_delta", data: { is_enabled: true, enabled: true } });
    // Settings: the 3D Viewer area's switches and sliders.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: /Settings/ });
    await expect(settings).toBeVisible();
    await settings.getByRole("tab", { name: "3D Viewer", exact: true }).click();
    await take("Settings / 3D Viewer", '[role="dialog"]');
    await settings.getByRole("tab", { name: "Display", exact: true }).click();
    await take("Settings / Display", '[role="dialog"]');
    expect(hits, `${pass}: ${checked} controls checked`).toEqual([]);
  });
}

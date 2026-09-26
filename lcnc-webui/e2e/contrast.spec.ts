import { test, expect, type Page } from "@playwright/test";
import { ctl, MOCK } from "./ctl";

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
      checked++;
      const fg0 = rgba(cs.color);
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
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(page.locator(".cm-content")).toBeVisible();
    await take("Program/editor", ".sidePane");
    await page.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.locator(".cm-content")).toHaveCount(0);
    await page.getByRole("button", { name: "Files", exact: true }).click();
    await expect(page.getByRole("button", { name: "a.ngc", exact: true })).toBeVisible();
    await take("Program/files", ".sidePane");
    await page.getByRole("button", { name: "Files", exact: true }).click();
    for (const tab of ["MDI", "Probing", "Offsets", "Tools"]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      if (tab === "Tools") {
        await expect.poll(async () => {
          await ctl({ op: "raw", frame: { type: "reply", cmd: "get_tool_table", ok: true, tools: TOOLS } });
          return page.locator(".toolsTab tbody tr").count();
        }).toBe(2);
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

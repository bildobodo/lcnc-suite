// Unchanged scanner extracted from the reviewed contrast.spec.ts.
interface Hit { where: string; text: string; ratio: number; fg: string; bg: string; min: number }

/** In-page: every visible text of `rootSel` below `floor` (self-contained — serialised). */
export function scan(args: { rootSel: string; floor: number }): { hits: Hit[]; checked: number } {
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

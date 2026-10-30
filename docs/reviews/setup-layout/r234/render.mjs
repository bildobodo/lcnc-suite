// Setup-area renderings: the real app (a worktree's dist) against its mock
// gateway on a private port, one screenshot per variant × config × surface ×
// state, with measurements (size, fill, wrapped labels, the action buttons'
// places relative to the section and to the WCS group).
// usage: node render.mjs <lcnc-webui dir> <out dir> <port>
// env: VARIANTS=0,A,B,C CONFIGS=3-XYZ,... SURFACES=L1280,... STATES=live,dim
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [, , WEB, OUT, PORT = "4190"] = process.argv;
const pick = (env, all) => (process.env[env] ? all.filter(x => process.env[env].split(",").includes(x.id)) : all);
const { chromium } = await import(join(WEB, "node_modules/playwright/index.mjs"));
const { default: WebSocket } = await import(join(WEB, "node_modules/ws/index.js"));
mkdirSync(OUT, { recursive: true });
const BASE = `http://localhost:${PORT}/`;
const mock = spawn("node", ["e2e/mock-gateway.mjs"], { cwd: WEB, env: { ...process.env, MOCK_PORT: PORT, MOCK_HOST: "127.0.0.1" }, stdio: "ignore" });
const ctl = (op) => new Promise((res, rej) => {
  const c = new WebSocket(`ws://127.0.0.1:${PORT}/ctl`);
  c.once("open", () => c.send(JSON.stringify(op)));
  c.once("message", (d) => { c.close(); res(JSON.parse(String(d))); });
  c.once("error", rej);
});
for (let i = 0; i < 100; i++) { try { await fetch(BASE); break; } catch { await new Promise(r => setTimeout(r, 100)); } }
const GATES = ["idle","jog","override","ready","run","step","abort","spindleStop","probe","zero","machineFrame","goZero","planeFrame","touchoff","touchoffRotary","twpCapture","surfaceComp","safety","setup","sourceWrite","toolTableWrite","armed","always","programLoad","modeManual","modeCoord","parameterRead","g30Write","spindleManual","armEnable","estopReset","g30Capture","wcsSelect","toolChangeConfirm"];
const PERMS_LIVE = Object.fromEntries(GATES.map(k => [k, true]));
const PERMS_DIM = Object.fromEntries(GATES.map(k => [k, ["always", "armEnable"].includes(k)]));
const VARIANTS = pick("VARIANTS", [{ id: "0" }, { id: "A" }, { id: "B" }, { id: "C" }, { id: "D" }, { id: "E" }, { id: "F" }, { id: "G" }, { id: "H" }, { id: "K" }, { id: "P" }, { id: "Q" }]);
const CONFIGS = pick("CONFIGS", [
  { id: "1-X", axes: ["X"] },
  { id: "5-TWP", axes: ["X", "Y", "Z", "A", "C"], kins: { type: "xyzacb-trsrn" }, kinsType: 0 },
  { id: "7-TWP", axes: ["X", "Y", "Z", "A", "B", "C", "U"], kins: { type: "xyzacb-trsrn" }, kinsType: 0 },
  { id: "8-TWP", axes: ["X", "Y", "Z", "A", "B", "C", "U", "V"], kins: { type: "xyzacb-trsrn" }, kinsType: 0 },
  { id: "9-TWP", axes: ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"], kins: { type: "xyzacb-trsrn" }, kinsType: 0 },
  { id: "4-TCP", axes: ["X", "Y", "Z", "A"], kins: { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: true, params: {} }, kinsType: 1 },
  { id: "6-TCP", axes: ["X", "Y", "Z", "A", "B", "C"], kins: { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: true, params: {} }, kinsType: 1 },
  { id: "7-TCP", axes: ["X", "Y", "Z", "A", "B", "C", "U"], kins: { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: true, params: {} }, kinsType: 1 },
  { id: "2-XZ", axes: ["X", "Z"] },
  { id: "3-XYZ", axes: ["X", "Y", "Z"] },
  { id: "4-XYZA", axes: ["X", "Y", "Z", "A"] },
  { id: "5-XYZAC", axes: ["X", "Y", "Z", "A", "C"] },
  { id: "5-TCP", axes: ["X", "Y", "Z", "A", "C"], kins: { module: "xyzac-trt-kins", type: "xyzac-trt", identity_first: true, params: {} }, kinsType: 1 },
  { id: "6-XYZABC", axes: ["X", "Y", "Z", "A", "B", "C"] },
  { id: "6-TWP", axes: ["X", "Y", "Z", "A", "B", "C"], kins: { type: "xyzacb-trsrn" }, kinsType: 0 },
  { id: "7-XYZABCU", axes: ["X", "Y", "Z", "A", "B", "C", "U"] },
  { id: "8-XYZABCUV", axes: ["X", "Y", "Z", "A", "B", "C", "U", "V"] },
  { id: "9-XYZABCUVW", axes: ["X", "Y", "Z", "A", "B", "C", "U", "V", "W"] },
]);
const SURFACES = pick("SURFACES", [
  { id: "L1280", vp: { width: 1280, height: 800 } },
  { id: "L1920", vp: { width: 1920, height: 1080 } },
  { id: "L1280-150", vp: { width: 1280, height: 800 }, zoom: "1.5" },
  { id: "L1280-touch-150", vp: { width: 1280, height: 800 }, touch: true, zoom: "1.5" },
  { id: "L1280-touch", vp: { width: 1280, height: 800 }, touch: true },
  { id: "P900", vp: { width: 900, height: 1200 } },
  { id: "P900-150", vp: { width: 900, height: 1200 }, zoom: "1.5" },
  { id: "P900-keypad", vp: { width: 900, height: 1200 }, keypad: true },
]);
const STATES = pick("STATES", [{ id: "live" }, { id: "dim" }]);
const ACTIONS = ["Zero All", "Zero XYZ", "Home All", "Unhome All", "Go to G30", "Go to MCS 0", "Go to WCS 0", "Capture plane", "Orient", "Clear plane"];
const browser = await chromium.launch();
const report = [];
for (const v of VARIANTS) for (const s of SURFACES) for (const c of CONFIGS) for (const st of STATES) {
  const id = `${v.id}__${c.id}__${s.id}__${st.id}`;
  const ctx = await browser.newContext({ viewport: s.vp, hasTouch: !!s.touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await ctl({ op: "reset" });
  await ctl({ op: "setAxes", axes: c.axes });
  await ctl({ op: "setKins", kins: c.kins ?? null });
  await page.goto(`${BASE}?setupVariant=${v.id}`);
  await page.locator("input.setupInput").first().waitFor();
  await ctl({ op: "quiet", on: true });
  const live = st.id === "live";
  await ctl({ op: "status_delta", armed: live, data: { active_file: "/A.ngc", permissions: live ? PERMS_LIVE : PERMS_DIM, homed: c.axes.map(() => (live ? 1 : 0)), homed_joints: c.axes.map(() => (live ? 1 : 0)), ...(c.kinsType != null ? { kins_type: c.kinsType } : {}) } });
  if (s.touch) await page.touchscreen.tap(2, 2);
  if (s.zoom) await page.evaluate((z) => { document.documentElement.style.zoom = z; }, s.zoom);
  if (s.keypad && live) { await page.locator("input.setupInput").first().click(); await page.locator(".nkStrip").waitFor(); }
  await page.waitForTimeout(500);
  const m = await page.evaluate((ACTIONS) => {
    const sec = document.querySelector('[data-strip="setup"]');
    const wcs = sec.querySelector(".wcsCol");
    const sr = sec.getBoundingClientRect();
    const wr = wcs && wcs.offsetParent !== null ? wcs.getBoundingClientRect() : null;
    const rnd = (n) => Math.round(n);
    const controls = [...sec.querySelectorAll("button, input")].filter(e => e.offsetParent !== null);
    const area = controls.reduce((a, e) => { const b = e.getBoundingClientRect(); return a + b.width * b.height; }, 0);
    const lines = (e) => {   // distinct line tops of the TEXT only (an icon is not a line)
      const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT); const tops = new Set(); let n;
      while ((n = w.nextNode())) { if (!n.textContent.trim() || n.parentElement.offsetParent === null) continue; const r = document.createRange(); r.selectNodeContents(n); for (const q of r.getClientRects()) if (q.width > 1) tops.add(Math.round(q.top / 4)); }
      return tops.size; };
    const wrapped = controls.filter(e => e.tagName === "BUTTON" && lines(e) > 1).map(e => (e.getAttribute("aria-label") || e.textContent).trim());
    const cut = controls.filter(e => e.scrollWidth > e.clientWidth + 1).map(e => (e.getAttribute("aria-label") || e.textContent).trim());
    // a control outside its section's box (an overflowing row)
    const outside = controls.filter(e => { const b = e.getBoundingClientRect(); return b.right > sr.right + 0.5 || b.bottom > sr.bottom + 0.5 || b.left < sr.left - 0.5; }).map(e => (e.getAttribute("aria-label") || e.textContent).trim());
    const name = (e) => (e.getAttribute("aria-label") || e.textContent).replace(/\s+/g, " ").trim();
    const acts = {};
    for (const e of controls) {
      const n = name(e);
      const k = ACTIONS.find(a => n === a || n.startsWith(a)) ?? (/^(Home|Unhome) ?All/.test(n) ? "Home All" : null);
      if (!k) continue;
      const b = e.getBoundingClientRect();
      acts[k] = { sec: [rnd(b.x - sr.x), rnd(b.y - sr.y), rnd(b.width)], wcs: wr ? [rnd(b.x - wr.x), rnd(b.y - wr.y)] : null };
    }
    const strip = document.querySelector(".strip");
    return { stripOver: strip.scrollWidth - strip.clientWidth, w: rnd(sr.width), h: rnd(sr.height), fill: Math.round(100 * area / (sr.width * sr.height)), wrapped, cut, outside, acts };
  }, ACTIONS);
  report.push({ id, variant: v.id, config: c.id, surface: s.id, state: st.id, ...m });
  await page.locator('[data-strip="setup"]').screenshot({ path: join(OUT, `${id}.png`) });
  await ctx.close();
}
writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 1));
await browser.close();
mock.kill();
console.log(report.map(r => `${r.id.padEnd(36)} ${String(r.w).padStart(4)}×${String(r.h).padEnd(4)} fill ${r.fill}% over ${r.stripOver}  wrap: ${r.wrapped.join("|")}  cut: ${r.cut.join("|")}  OUT: ${r.outside.join("|")}`).join("\n"));

// The load measurement of the simulation per device (settings split package
// 2, plan Codex R335 SS334-03, owed after R338): TWO Chromium instances, each
// its own browser profile = its own device — "panel" (simulation OFF, a new
// device) and "laptop" (simulation ON, switched in Settings › Devices) — on
// the LAN sim at the same time. Every second: the CPU time of each
// instance's WHOLE process tree (browser, GPU, renderers — dedicated workers
// run inside the renderer), its RSS, the page's worker count and its
// simulation work (__viewerDiag.getSimulationWork). Phases are marked by the
// driver (drive.py) in marks.jsonl; this script only samples, and it
// writes `ready` once both devices stand as the measurement needs them.
//
//   node browsers.mjs <url> <outdir>      (stops when <outdir>/stop exists)
import { chromium } from "/home/cnc/lcnc-suite-gates/lcnc-webui/node_modules/playwright/index.mjs";
import { readFileSync, readdirSync, writeFileSync, appendFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const [url, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const CLK = 100;   // USER_HZ
const log = (...a) => console.log(new Date().toISOString(), ...a);

function procs() {
  const all = [];
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const stat = readFileSync(`/proc/${d}/stat`, "utf8");
      const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const cmd = readFileSync(`/proc/${d}/cmdline`, "utf8").replace(/\0/g, " ");
      const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${d}/status`, "utf8"))?.[1] ?? 0);
      all.push({ pid: Number(d), ppid: Number(rest[1]), cpu: Number(rest[11]) + Number(rest[12]), rss, cmd });
    } catch { /* gone */ }
  }
  return all;
}
/** Every process of the Chromium instance whose user data dir is `dir`. */
function tree(all, dir) {
  const roots = all.filter(p => p.cmd.includes(`--user-data-dir=${dir}`)).map(p => p.pid);
  const ids = new Set(roots);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of all) if (!ids.has(p.pid) && ids.has(p.ppid)) { ids.add(p.pid); grew = true; }
  }
  const ps = all.filter(p => ids.has(p.pid));
  return { n: ps.length, cpu: ps.reduce((s, p) => s + p.cpu, 0) / CLK, rss_mb: ps.reduce((s, p) => s + p.rss, 0) / 1024 };
}

async function device(name) {
  const dir = join(out, `profile-${name}`);
  rmSync(dir, { recursive: true, force: true });   // a NEW device: no token yet
  const ctx = await chromium.launchPersistentContext(dir, {
    headless: true, viewport: { width: 1600, height: 1000 },
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  page.on("pageerror", e => log(name, "pageerror", e.message));
  // the page's own status cadence and age (browser.viewer.perf) — kept per
  // device here, read off its /telemetry posts (NDJSON)
  page.on("request", r => {
    if (!r.url().includes("/telemetry") || r.method() !== "POST") return;
    for (const line of (r.postData() ?? "").split("\n")) {
      if (!line.includes("viewer.perf")) continue;
      appendFileSync(join(out, `perf-${name}.jsonl`), JSON.stringify({ t: Date.now(), rec: JSON.parse(line) }) + "\n");
    }
  });
  await page.goto(url);
  await page.locator("input.setupInput").first().waitFor({ timeout: 60_000 });
  return { name, dir, ctx, page };
}

const panel = await device("panel");
const laptop = await device("laptop");
// the laptop switches ITS simulation on — no arm (its own device)
await laptop.page.getByTitle("Settings", { exact: true }).click();
const dlg = laptop.page.getByRole("dialog", { name: "Settings", exact: true });
await dlg.getByRole("tab", { name: "Devices", exact: true }).click();
await dlg.locator("[data-devices=this]").getByLabel("Name").fill("laptop (measurement)");
await dlg.locator("[data-devices=this]").getByLabel("Name").press("Tab");
await dlg.locator("[data-devices=this]").getByRole("checkbox").check({ force: true });
await laptop.page.waitForFunction(() => !!document.querySelector('[role="tab"]') &&
  [...document.querySelectorAll('[role="tab"]')].some(t => t.textContent?.trim() === "Sim"), null, { timeout: 30_000 });
await dlg.getByRole("button", { name: /^Close/ }).first().click().catch(() => {});
await laptop.page.keyboard.press("Tab").catch(() => {});
// the panel stays a new device: simulation off, no Sim tab
const panelSim = await panel.page.evaluate(() =>
  [...document.querySelectorAll('[role="tab"]')].some(t => t.textContent?.trim() === "Sim"));
if (panelSim) throw new Error("the panel shows a Sim tab — not a new device");
writeFileSync(join(out, "ready"), new Date().toISOString());
log("ready: panel off, laptop on");

const work = (d) => d.page.evaluate(() => window.__viewerDiag?.getSimulationWork?.() ?? null).catch(() => null);
const summary = (d) => d.page.evaluate(() => window.__viewerDiag?.getCollisionSummary?.() ?? null).catch(() => null);
while (!existsSync(join(out, "stop"))) {
  const t = Date.now();
  const all = procs();
  const rec = { t };
  for (const d of [panel, laptop]) {
    const w = await work(d);
    const s = d.name === "laptop" ? await summary(d) : null;
    rec[d.name] = { ...tree(all, d.dir), workers: d.page.workers().length, work: w,
                    hits: s?.hits ?? null, sweepMs: s?.sweepMs ?? null };
  }
  appendFileSync(join(out, "samples.jsonl"), JSON.stringify(rec) + "\n");
  const wait = 1000 - (Date.now() - t);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}
await panel.ctx.close();
await laptop.ctx.close();
log("stopped");

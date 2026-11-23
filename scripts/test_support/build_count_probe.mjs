// The collision model's build count on the REAL gateway (P2b-1 acceptance,
// plan v4 "Vorher/Nachher-Lauf"): a real page (headless Chromium, the run
// tree's own build served by its gateway) with the simulation switched on
// for its device stays open while the native stage runs the load sequence
// (load → run with M600 → tool change → load). The page's telemetry reaches
// the gateway's trace (browser.collision.*, browser.viewer.perf); this probe
// adds a tap on the page's collision worker — every request it sends, with
// its bodies' triangles and its shard bound — so the BEFORE tree (no
// per-instance word) is counted by the same rule as the after tree: a
// request with the bodies builds one model per shard it runs on.
//
//   node build_count_probe.mjs <tree> <url>
// prints {"ready": …} once the simulation is on, then waits for its stdin
// to close and prints {"tap": …} as its last line.
import { createRequire } from "node:module";
import path from "node:path";

const [tree, url] = process.argv.slice(2);
const require = createRequire(path.join(tree, "lcnc-webui", "package.json"));
const { chromium } = require("@playwright/test");

const out = { errors: [] };
const browser = await chromium.launch({ args: ["--use-angle=gl-egl", "--ignore-gpu-blocklist"],
                                        env: { ...process.env, LP_NUM_THREADS: "2" } });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 0.25 });
  page.on("console", (m) => {
    if (m.type() === "error") out.errors.push(m.text().slice(0, 300));
    else if (/settings|device|save/i.test(m.text())) (out.console ??= []).push(m.text().slice(0, 200));
  });
  await page.addInitScript(() => {
    const tap = { reqs: [], cores: navigator.hardwareConcurrency ?? null };
    window.__buildTap = tap;
    const Real = window.Worker;
    const Tapped = function (u, opts) {
      const w = new Real(u, opts);
      if (!/collisionWorker/.test(String(u))) return w;
      const post = w.postMessage.bind(w);
      w.postMessage = (msg, transfer) => {
        if (msg && typeof msg === "object" && "track" in msg) {
          const tris = msg.bodies ? msg.bodies.reduce((n, b) => n + b.positions.length / 9, 0) : null;
          tap.reqs.push({ id: msg.id, t: Date.now(), side: !!msg.side, bodies: msg.bodies ? msg.bodies.length : 0,
                          tris, maxShards: msg.maxShards ?? null, modelKey: String(msg.modelKey ?? "").length });
        }
        return post(msg, transfer);
      };
      return w;
    };
    Tapped.prototype = Real.prototype;
    window.Worker = Tapped;
  });
  await page.goto(url);
  await page.locator("input.setupInput").first().waitFor({ timeout: 30_000 });
  // the simulation on for THIS device (Settings › Devices) — acts once the
  // gateway holds it
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("tab", { name: "Devices", exact: true }).click();
  const sim = settings.locator("[data-devices=this]").getByRole("checkbox");
  // the device bound first (its hello): the switch saves to THIS device's profile
  await settings.getByText("Device not bound yet — reconnecting").waitFor({ state: "detached", timeout: 30_000 }).catch(() => {});
  if (!(await sim.isChecked())) await sim.check({ force: true });
  await settings.getByText("Saved", { exact: true }).first().waitFor({ timeout: 30_000 }).catch(() => {});
  // acting: the Sim tab is there only with the simulation on for this
  // device; the held value reaches a page at its settings_init — a reload
  // when the tab does not show it yet (the switch itself said "Not active
  // until the gateway holds it" though the gateway saved it, 2026-11-23)
  const simTab = page.getByRole("tab", { name: "Sim", exact: true });
  if (!(await simTab.count())) {
    out.reloaded = true;
    await page.reload();
    await page.locator("input.setupInput").first().waitFor({ timeout: 30_000 });
  }
  try {
    await simTab.first().waitFor({ timeout: 30_000 });
  } catch (e) {
    out.dialog = (await page.locator("body").innerText().catch(() => "")).slice(0, 1500);
    throw e;
  }
  await page.getByRole("button", { name: /^Close/ }).first().click().catch(() => {});
  out.ready = { t: Date.now(), cores: await page.evaluate(() => navigator.hardwareConcurrency), reloaded: !!out.reloaded };
  console.log(JSON.stringify({ ready: out.ready }));
  // the native stage runs its sequence; its end is our stdin's
  await new Promise((resolve) => { process.stdin.on("end", resolve); process.stdin.resume(); });
  out.tap = await page.evaluate(() => window.__buildTap);
} catch (e) {
  out.errors.push(String(e).slice(0, 600));
} finally {
  await browser.close();
  console.log(JSON.stringify(out));
}

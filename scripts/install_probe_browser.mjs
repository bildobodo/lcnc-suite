// The install probe's browser start (package I, Codex R329 FI329-03): the
// BUILT UI against the run's own production gateway. The page alone proves
// nothing (an index.html whose entry module is missing, or answered with the
// SPA fallback, starts no app): the app must mount, its OWN WebSocket (in its
// worker) must take this instance's state — the DRO fields a viewer_init
// renders — and every script and worker must arrive as JavaScript. No machine
// command is sent.
//
//   node install_probe_browser.mjs --webui <clone>/lcnc-webui --url http://127.0.0.1:8000/ --out <file>
//
// Playwright comes from the clone's own node_modules (its npm ci); the
// browsers from PLAYWRIGHT_BROWSERS_PATH (read-only, shared).
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const webui = arg("webui"), url = arg("url"), out = arg("out");
const STEP_MS = Number(arg("step-ms") ?? 30_000);
const result = { url, scripts: [], bad_responses: [], page_errors: [], console_errors: [], workers: 0,
                 mounted: false, connected: false };
let browser;
try {
  const { chromium } = createRequire(join(webui, "package.json"))("playwright");
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  const isScript = (r) => ["script"].includes(r.request().resourceType()) || /\.m?js(\?|$)/.test(r.url());
  context.on("response", (r) => {
    const type = r.headers()["content-type"] ?? "";
    if (isScript(r)) {
      const ok = r.status() === 200 && /javascript/.test(type);
      result.scripts.push({ url: r.url(), status: r.status(), type, ok });
      if (!ok) result.bad_responses.push({ url: r.url(), status: r.status(), type });
    } else if (r.status() >= 400) {
      result.bad_responses.push({ url: r.url(), status: r.status(), type });
    }
  });
  context.on("requestfailed", (r) => result.bad_responses.push({ url: r.url(), status: "failed", type: r.failure()?.errorText ?? "" }));
  page.on("pageerror", (e) => result.page_errors.push(String(e).slice(0, 300)));
  page.on("console", (m) => { if (m.type() === "error") result.console_errors.push(m.text().slice(0, 300)); });
  page.on("worker", (w) => {
    result.workers++;
    // a worker's own script: answered as JavaScript
    w.evaluate(() => self.location.href).then((href) => result.worker_urls = [...(result.worker_urls ?? []), href], () => {});
  });
  const res = await page.goto(url, { waitUntil: "load", timeout: STEP_MS });
  result.page = { status: res?.status(), type: res?.headers()["content-type"] ?? "" };
  result.mounted = await page.locator(".safetyStrip").waitFor({ state: "visible", timeout: STEP_MS }).then(() => true, () => false);
  result.connected = await page.locator("input.setupInput").first().waitFor({ state: "visible", timeout: STEP_MS })
    .then(() => true, () => false);
} catch (e) {
  result.error = String(e).slice(0, 400);
} finally {
  if (browser) await browser.close();
  writeFileSync(out, JSON.stringify(result, null, 1));
}

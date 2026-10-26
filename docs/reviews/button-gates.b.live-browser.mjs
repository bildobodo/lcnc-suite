// Button gates, package B — the BROWSER's write path on the running
// simulator (BG-14): the page's own hello reply gives its connection key
// (lcncWs → connKey.ts), and its upload sends it as X-Conn-Key. The Python
// live run (button-gates.b.live-writes.py) sent keys it read itself; this
// run certifies the layer the operator uses.
//
//   B1  armed in the UI, an upload through the Program tab's file field:
//       the request carries X-Conn-Key, 200, the file on the disk
//   B2  disarmed in the UI, the same upload: 403 "Not armed", nothing written
//   B3  the page reconnects (reload): a new key; an upload with the OLD one is
//       refused with "Connection unknown"
//
// Needs the gates suite live on 127.0.0.1:8000 (no token). Removes its files.
// usage: node <this file> <program folder>   (run from lcnc-webui/)
import { createRequire } from "node:module";
// resolved from the working directory (lcnc-webui/), not from this file
const { chromium } = createRequire(process.cwd() + "/")("@playwright/test");
import { existsSync, unlinkSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const NC = process.argv[2];
const BASE = "http://127.0.0.1:8000";
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const name = `bg_b_browser_${stamp}.ngc`;
const local = join(mkdtempSync(join(tmpdir(), "bgb-")), name);
writeFileSync(local, "(bg b browser)\nM2\n");
const results = [];
const check = (n, ok, detail = "") => {
  results.push([n, ok ? "PASS" : "FAIL", detail]);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  — " + detail}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const uploads = [];
page.on("request", r => { if (r.url().includes("/upload")) uploads.push({ key: r.headers()["x-conn-key"] ?? null }); });
const uploadResponse = () => page.waitForResponse(r => r.url().includes("/upload"), { timeout: 15000 });
const fileField = page.locator('input[type=file][accept=".ngc,.nc,.gcode,.tap,.txt"]');
let firstKey = null;
try {
  await page.goto(BASE + "/");
  const arm = page.getByRole("button", { name: "Arm", exact: true });
  await arm.waitFor({ state: "visible", timeout: 20000 });
  for (let i = 0; i < 100 && !(await arm.isEnabled()); i++) await page.waitForTimeout(200);
  await page.waitForTimeout(1500);   // connected: the hello reply (the key) is in
  await arm.click();
  await page.getByRole("button", { name: "Disarm", exact: true }).waitFor({ state: "visible", timeout: 10000 });
  await page.getByRole("tab", { name: "Program", exact: true }).click();

  // B1
  let resp = uploadResponse();
  await fileField.setInputFiles(local);
  let r = await resp;
  firstKey = uploads.at(-1)?.key;
  check("B1 armed: the page's upload carries X-Conn-Key, 200, the file on the disk",
        typeof firstKey === "string" && firstKey.length > 10 && r.status() === 200 && existsSync(join(NC, name)),
        `key=${firstKey} status=${r.status()} body=${(await r.text()).slice(0, 120)}`);
  unlinkSync(join(NC, name));

  // B2
  await page.getByRole("button", { name: "Disarm", exact: true }).click();
  await arm.waitFor({ state: "visible", timeout: 10000 });
  resp = uploadResponse();
  await fileField.setInputFiles(local);
  r = await resp;
  const body2 = await r.text();
  check("B2 disarmed: the same upload is refused 403 Not armed, nothing written",
        r.status() === 403 && body2.includes("Not armed") && !existsSync(join(NC, name)) && uploads.at(-1)?.key === firstKey,
        `status=${r.status()} body=${body2.slice(0, 120)} key=${uploads.at(-1)?.key}`);

  // B3
  await page.reload();
  await arm.waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(1500);   // the new hello reply
  const old = await page.request.post(BASE + "/upload", {
    headers: { "X-Conn-Key": firstKey },
    multipart: { file: { name, mimeType: "text/plain", buffer: Buffer.from("(old key)\nM2\n") } },
  });
  const body3 = await old.text();
  check("B3 after a reconnect the old key writes nothing: 403 Connection unknown",
        old.status() === 403 && body3.includes("Connection unknown") && !existsSync(join(NC, name)),
        `status=${old.status()} body=${body3.slice(0, 120)}`);
} catch (e) {
  check("run", false, String(e));
} finally {
  try { if (existsSync(join(NC, name))) unlinkSync(join(NC, name)); } catch { /* ignore */ }
  await browser.close();
}
console.log(JSON.stringify({ results }, null, 1));
process.exit(results.every(([, v]) => v === "PASS") ? 0 : 1);

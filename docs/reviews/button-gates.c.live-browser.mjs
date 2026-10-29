// Button gates, package C — what a DISARMED operator meets in the real
// browser on the running simulator (BG-01, BG-02, BG-05, BG-08, BG-16).
// The page never arms. An ARMED client elsewhere (button-gates.c.live-helper.py)
// starts a program; the disarmed page stops it.
//
//   C0  the gateway refuses a disarmed connection's shutdown; LinuxCNC runs on
//   C1  every main tab and every Probing sub-tab opens; Settings opens, a
//       protected section is dimmed with "Not armed", a display one is free,
//       the X closes it
//   C2  the program browser opens a folder and goes back; a file row is closed
//       with its reason
//   C3  the jog step changes; the MDI line takes a draft, Enter keeps it and
//       says why at the line — LinuxCNC's interpreter stays idle
//   C4  a program the armed client started: the page's Pause pauses it (STAT),
//       its Abort ends it (STAT idle)
//
// Needs the gates suite live on 127.0.0.1:8000 (no token), the machine ON and
// homed. Removes its files.
// usage: node <this file> <program folder> <repo root> <venv python>  (run from lcnc-webui/)
import { createRequire } from "node:module";
const { chromium } = createRequire(process.cwd() + "/")("@playwright/test");
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const [NC, ROOT, PY] = process.argv.slice(2);
const BASE = "http://127.0.0.1:8000";
const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const folder = `bg_c_browse_${stamp}`;
const dwell = `bg_c_dwell_${stamp}.ngc`;
const helper = (...args) => JSON.parse(execFileSync(PY, [join(ROOT, "docs/reviews/button-gates.c.live-helper.py"), ROOT, ...args],
  { encoding: "utf8" }).trim().split("\n").filter((l) => !l.startsWith("[GC]")).at(-1));
const results = [];
const check = (n, ok, detail = "") => {
  results.push([n, ok ? "PASS" : "FAIL", detail]);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  — " + detail}`);
};
const INTERP_IDLE = 1;

mkdirSync(join(NC, folder));
writeFileSync(join(NC, folder, "inner.ngc"), "(bg c inner)\nM2\n");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
try {
  // C0
  const sd = helper("shutdown-disarmed");
  check("C0 a disarmed connection's shutdown is refused; LinuxCNC runs on",
        sd.reply.ok === false && /Not armed/.test(sd.reply.error ?? "") && sd.linuxcnc_alive === true, JSON.stringify(sd));

  await page.goto(BASE + "/");
  await page.getByRole("button", { name: "Arm", exact: true }).waitFor({ state: "visible", timeout: 20000 });
  await page.locator(".pill.disarmed").waitFor({ timeout: 10000 });
  await page.waitForTimeout(1500);

  // C1
  let tabsOk = true; const notes = [];
  for (const tab of ["Program", "MDI", "Probing", "Offsets", "Tools", "Macros", "Sim"]) {
    const t = page.getByRole("tab", { name: tab, exact: true });
    if (!(await t.isEnabled())) { tabsOk = false; notes.push(`${tab} disabled`); continue; }
    await t.click();
    if ((await t.getAttribute("aria-selected")) !== "true") { tabsOk = false; notes.push(`${tab} not selected`); }
    if (tab === "Probing") {
      for (const sub of ["Outside", "Inside", "Angle", "Boss/Pocket", "Ridge/Valley", "Surface", "Calibrate", "Toolsetter"]) {
        const s = page.locator(".sidePane").getByRole("tab", { name: sub, exact: true });
        await s.click();
        if ((await s.getAttribute("aria-selected")) !== "true") { tabsOk = false; notes.push(`Probing/${sub}`); }
      }
    }
  }
  await page.getByTitle("Settings", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.waitFor();
  await settings.getByRole("tab", { name: "Machine", exact: true }).click();
  const prot = settings.locator('[data-control="protectedSetting"]').first();
  const protDim = await prot.isDisabled();
  const protWhy = await settings.locator(".btnTip:visible").filter({ has: page.locator('[data-control="resetProtected"]') }).first().getAttribute("title");
  await settings.getByRole("tab", { name: "Display", exact: true }).click();
  const dispFree = await settings.locator('[data-control="displaySetting"]').first().isEnabled();
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  const closed = (await settings.count()) === 0;
  check("C1 every tab and sub-tab opens; Settings: protected dimmed with its reason, display free, X closes",
        tabsOk && protDim && /Not armed/.test(protWhy ?? "") && dispFree && closed,
        `${notes.join(", ")} protDim=${protDim} why=${protWhy} dispFree=${dispFree} closed=${closed}`);

  // C2
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  const panel = page.locator(".sidePane .container").filter({ has: page.locator(".codeArea") });
  const more = panel.locator(".ctrlRow").getByRole("button", { name: /^More\b/ });
  await more.click();
  await page.locator(`[id="${await more.getAttribute("aria-controls")}"]`).getByRole("button", { name: "Files", exact: true }).click();
  const br = panel.getByRole("region", { name: "Server programs" });
  await br.getByRole("button", { name: folder, exact: true }).click();
  const inner = br.getByRole("button", { name: "inner.ngc", exact: true });
  await inner.waitFor({ timeout: 10000 });
  const innerDim = await inner.isDisabled();
  const innerWhy = await inner.getAttribute("title");
  await br.getByRole("button", { name: "Parent folder", exact: true }).click();
  const back = await br.getByRole("button", { name: folder, exact: true }).isVisible();
  check("C2 the browser opens a folder and goes back; a file row is closed with its reason",
        innerDim && /Not armed/.test(innerWhy ?? "") && back, `dim=${innerDim} why=${innerWhy} back=${back}`);

  // C3
  const steps = page.locator('[data-strip="jog"]').getByRole("radiogroup", { name: "Jog step", exact: true }).getByRole("radio");
  await steps.last().click();
  const stepOk = (await steps.last().getAttribute("aria-checked")) === "true";
  await page.getByRole("tab", { name: "MDI", exact: true }).click();
  const mdi = page.getByRole("textbox", { name: "MDI command", exact: true });
  await mdi.fill("G4 P0.1");
  await mdi.press("Enter");
  await page.waitForTimeout(800);
  const kept = await mdi.inputValue();
  const hint = await page.locator("[data-btn-hint]").textContent().catch(() => "");
  const st3 = helper("state");
  check("C3 the jog step changes; the MDI draft stays after Enter with its reason; the interpreter stays idle",
        stepOk && kept === "G4 P0.1" && /Not armed/.test(hint ?? "") && st3.interp_state === INTERP_IDLE,
        `step=${stepOk} kept=${kept} hint=${hint} interp=${st3.interp_state}`);

  // C4
  const run = helper("start", NC, dwell);
  await page.getByRole("tab", { name: "Program", exact: true }).click();
  const pause = page.locator(".sidePane").getByRole("button", { name: /Pause/ }).first();
  await pause.waitFor({ timeout: 10000 });
  for (let i = 0; i < 50 && !(await pause.isEnabled()); i++) await page.waitForTimeout(100);
  await pause.click();
  let st4 = helper("state");
  for (let i = 0; i < 30 && !st4.paused; i++) { await page.waitForTimeout(100); st4 = helper("state"); }
  const paused = st4.paused;
  const abort = page.locator(".sidePane").getByRole("button", { name: "Abort", exact: true }).first();
  await abort.click();
  let st5 = helper("state");
  for (let i = 0; i < 30 && st5.interp_state !== INTERP_IDLE; i++) { await page.waitForTimeout(100); st5 = helper("state"); }
  check("C4 a program started elsewhere: the disarmed page's Pause pauses it, its Abort ends it",
        run.interp_state !== INTERP_IDLE && paused && st5.interp_state === INTERP_IDLE,
        `run=${JSON.stringify(run)} paused=${paused} after=${JSON.stringify(st5)}`);
} catch (e) {
  check("run", false, String(e));
} finally {
  await browser.close();
  try { rmSync(join(NC, folder), { recursive: true, force: true }); } catch { /* ignore */ }
  try { helper("cleanup", NC, dwell); } catch { /* ignore */ }
}
console.log(JSON.stringify({ results }, null, 1));
process.exit(results.every(([, v]) => v === "PASS") ? 0 : 1);

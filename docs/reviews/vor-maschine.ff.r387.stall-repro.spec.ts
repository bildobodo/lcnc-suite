// THROWAWAY (stall investigation at 128d6821, never committed): load the app
// over and over in the pinned Firefox; a load whose app is not up in 8 s is a
// hit — capture the page's events and every Firefox process/thread state.
import { test, expect } from "./test";
import { ctl, MOCK } from "./ctl";
import { appendFileSync, readFileSync, readdirSync } from "node:fs";

const OUT = process.env.STALL_OUT!;
const N = Number(process.env.STALL_N ?? 200);

const rd = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
function procSnapshot() {
  const procs: unknown[] = [];
  for (const pid of readdirSync("/proc").filter(d => /^\d+$/.test(d))) {
    const comm = rd(`/proc/${pid}/comm`).trim();
    const cmd = rd(`/proc/${pid}/cmdline`).split("\0").join(" ");
    if (!/firefox|Web Co|Isolated|Socket Pr|RDD|Utility|GPU Pro|Privileged|WebExt|forkserver/i.test(comm + " " + cmd)) continue;
    if (/node|playwright|bash|python/.test(comm)) continue;
    const st = rd(`/proc/${pid}/stat`); const f = st.slice(st.lastIndexOf(")") + 2).split(" ");
    const threads: unknown[] = [];
    for (const tid of (() => { try { return readdirSync(`/proc/${pid}/task`); } catch { return []; } })()) {
      const ts = rd(`/proc/${pid}/task/${tid}/stat`); const g = ts.slice(ts.lastIndexOf(")") + 2).split(" ");
      threads.push({ tid, comm: rd(`/proc/${pid}/task/${tid}/comm`).trim(), state: g[0],
                     wchan: rd(`/proc/${pid}/task/${tid}/wchan`).trim(), cpu: Number(g[11]) + Number(g[12]) });
    }
    procs.push({ pid, ppid: f[1], comm, state: f[0], cmd: cmd.slice(0, 300), cpu: Number(f[11]) + Number(f[12]), threads });
  }
  const mem = Object.fromEntries(rd("/proc/meminfo").split("\n").filter(l => /^(MemAvailable|SwapFree|SwapTotal|Shmem):/.test(l)).map(l => l.split(/:\s+/)));
  return { t: Date.now(), mem, psi: { cpu: rd("/proc/pressure/cpu"), memory: rd("/proc/pressure/memory"), io: rd("/proc/pressure/io") }, load: rd("/proc/loadavg").trim(), procs };
}

test.describe.configure({ mode: "parallel" });
for (let i = 0; i < N; i++) {
  test(`load ${i}`, async ({ page }) => {
    const t0 = Date.now();
    const ev: string[] = [];
    page.on("crash", () => ev.push(`crash ${Date.now() - t0}`));
    page.on("close", () => ev.push(`close ${Date.now() - t0}`));
    page.on("load", () => ev.push(`load ${Date.now() - t0}`));
    page.on("domcontentloaded", () => ev.push(`dcl ${Date.now() - t0}`));
    page.on("console", m => ev.push(`console ${Date.now() - t0} ${m.type()} ${m.text().slice(0, 300)}`));
    page.on("pageerror", e => ev.push(`pageerror ${Date.now() - t0} ${String(e).slice(0, 300)}`));
    page.on("requestfailed", r => ev.push(`requestfailed ${Date.now() - t0} ${r.url()} ${r.failure()?.errorText}`));
    const pending = new Map<string, number>();
    page.on("request", r => { pending.set(r.url(), Date.now() - t0); ev.push(`req ${Date.now() - t0} ${r.url().replace(MOCK, "/")}`); });
    page.on("requestfinished", r => { pending.delete(r.url()); ev.push(`fin ${Date.now() - t0} ${r.url().replace(MOCK, "/")}`); });
    page.on("worker", w => ev.push(`worker ${Date.now() - t0} ${w.url().replace(MOCK, "/")}`));
    page.on("websocket", w => ev.push(`websocket ${Date.now() - t0} ${w.url()}`));
    await ctl({ op: "reset" });
    await page.setViewportSize({ width: 1280, height: 800 });
    try {
      await page.goto(MOCK, { timeout: 8000 });
      await expect(page.locator("input.setupInput").first()).toBeVisible({ timeout: 8000 });
    } catch (e) {
      const s1 = procSnapshot();
      await new Promise(r => setTimeout(r, 1500));
      const s2 = procSnapshot();
      let probe = "n/a";
      try { probe = String(await Promise.race([page.evaluate(() => document.readyState), new Promise((_, rej) => setTimeout(() => rej(new Error("no answer in 3 s")), 3000))])); } catch (x) { probe = `evaluate failed: ${String(x).slice(0, 200)}`; }
      appendFileSync(`${OUT}/hits.jsonl`, JSON.stringify({ i, worker: test.info().workerIndex, parallel: test.info().parallelIndex,
        t0, t: Date.now(), err: String(e).slice(0, 400), ev, pending: [...pending], closed: page.isClosed(), probe, s1, s2 }) + "\n");
      throw e;
    }
    appendFileSync(`${OUT}/ok.jsonl`, JSON.stringify({ i, w: test.info().parallelIndex, ms: Date.now() - t0,
      ev: ev.filter(x => /^(dcl|load|crash|close|pageerror|requestfailed)/.test(x)).map(x => x.slice(0, 160)).slice(0, 8),
      webgl: ev.filter(x => /webgl/i.test(x)).length, reqs: ev.filter(x => x.startsWith("req ")).length }) + "\n");
  });
}

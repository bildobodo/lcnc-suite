#!/usr/bin/env python3
"""The browser-PC measurement's follow-up run (Codex R181 VP181-01) on the live
XYZAC sim. The operator's page stays open and DISARMED (a held key then sends
nothing); this script is a second, armed WebSocket client with the buttons'
commands. Program messages — `(MSG, BPC: …)` from an MDI line or the run's
program — tell the operator in the WebUI when to hold a key.

  prep        E-Stop reset if needed (never a trip's acknowledgement), Machine
              On, Home All, G54, blank.ngc; the setup record (setup.json)
  A_rest      60 s rest
  A_input     "hold ↓" for 40 s, at rest
  S_load      bpc_parse.ngc loaded; its publish and the page's check
  S_supersede N basis switches G55 ↔ G54, each STANDING until its parse is
              spawned (by job id), the next one inside that parse: every
              parse but the last must be cancelled, the last one published
              with the last basis (G54)
  S_settle    the page's check of that publish, then 60 s of calm
  R_load      bpc_run.ngc loaded; publish and the page's check
  R_run       Cycle Start, each tool change confirmed like the dialog's
              Confirm; the program's messages ask for the key while the
              first run check runs; T7 M600 re-parses during it
  R_settle    the check after the run, then 60 s of calm
  end

Beside it, every 0.25 s: the RSS of the gateway and of every parse worker
(rss.jsonl). Any refusal or timeout stops the run (a running program is
aborted) and says why. The WS token is read from the INI, never printed.

  drive2.py [--check] [--from PHASE] [--switches N] [--hold S]
"""
import asyncio
import hashlib
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpc  # noqa: E402
from drive import NC, Client, Stop, confirm_tool_changes, log, mac_pages, trace_since, wait_publish, wait_settled  # noqa: E402

RSS = os.path.join(HERE, "rss.jsonl")
SETUP = os.path.join(HERE, "setup.json")
ORDER = ["A", "S", "R"]
IDX = {"G54": 1, "G55": 2}


def opt(name, default):
    return type(default)(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def _rss_kb(pid):
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1])
    except OSError:
        return None
    return None


def _procs():
    out = {}
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            with open(f"/proc/{d}/cmdline", "rb") as f:
                cmd = f.read().replace(b"\0", b" ").decode(errors="replace")
        except OSError:
            continue
        if "gcode_parse_worker.py" in cmd:
            out[int(d)] = "worker"
        elif "uvicorn gateway:app" in cmd:
            out[int(d)] = "gateway"
    return out


async def sample_rss(stop: asyncio.Event):
    with open(RSS, "a") as f:
        while not stop.is_set():
            t = time.time_ns()
            for pid, kind in _procs().items():
                kb = _rss_kb(pid)
                if kb is not None:
                    f.write(json.dumps({"t_wall_ns": t, "pid": pid, "kind": kind, "rss_kb": kb}) + "\n")
            f.flush()
            await asyncio.sleep(0.25)


def other_armed(st):
    """Armed clients besides this script (127.0.0.1) — a held key on an armed
    page would jog at rest."""
    return [c for c in (st.get("clients") or []) if c.get("armed") and c.get("ip") not in bpc.LOCAL]


def program_record(name):
    p = os.path.join(NC, name)
    with open(p, "rb") as f:
        b = f.read()
    return {"name": name, "bytes": len(b), "lines": b.count(b"\n"), "sha256": hashlib.sha256(b).hexdigest()}


def setup_record(c):
    def sh(*a):
        try:
            return subprocess.run(a, capture_output=True, text=True, timeout=10).stdout.strip()
        except Exception as e:  # noqa: BLE001 — a record, best effort, says why
            return f"? {e}"
    pages = mac_pages(time.time_ns() - 120 * 10**9)
    env = [r for r in trace_since(time.time_ns() - 24 * 3600 * 10**9)
           if r.get("tag") == "browser.ws.client_env" and r.get("page") in pages]
    perf = [r for r in trace_since(time.time_ns() - 60 * 10**9)
            if r.get("tag") == "browser.viewer.perf" and r.get("page") in pages]
    live = os.path.expanduser("~/lcnc-suite")
    rec = {
        "at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "commit": sh("git", "-C", live, "rev-parse", "HEAD"),
        "src_dirty": sh("git", "-C", live, "status", "--porcelain", "--", "lcnc-webui/src", "lcnc-gateway"),
        "vm_cpus": os.cpu_count(),
        "vm_mem": sh("sh", "-c", "grep MemTotal /proc/meminfo"),
        "vm_kernel": sh("uname", "-r"),
        "pages": sorted(pages),
        "browser_ua": sorted({r.get("ua") for r in env}),
        "page_host": sorted({r.get("host") for r in perf}),
        "event_timing": any("ev_n" in r for r in perf),
        "heap": any(r.get("heap_used_mb") is not None for r in perf),
        "programs": [program_record(n) for n in ("bpc_parse.ngc", "bpc_run.ngc")],
        "status": {k: c.st.get(k) for k in ("estop", "enabled", "homed", "g5x_index", "tool_in_spindle")},
    }
    with open(SETUP, "w") as f:
        json.dump(rec, f, indent=1)
    log("setup", {k: rec[k] for k in ("commit", "vm_cpus", "pages", "browser_ua", "event_timing", "heap")})
    return rec


async def mdi_msg(c, text):
    await c.cmd({"cmd": "mdi", "text": f"(MSG, BPC: {text})"})
    await c.until(lambda s: s.get("interp_state") == 1, 30, "MSG line done")


def recs_after(t0, tags):
    return [r for r in trace_since(t0) if r.get("tag") in tags]


async def wait_trace(pred, t0, timeout, what, tags):
    t1 = time.monotonic()
    while time.monotonic() - t1 < timeout:
        hit = [r for r in recs_after(t0, tags) if pred(r)]
        if hit:
            return hit[0]
        await asyncio.sleep(0.2)
    raise Stop(f"timeout ({timeout:.0f} s): {what}")


async def supersede(c, n, hold):
    """n switches alternating G55 / G54 (n even ends on G54). Each one stands
    until the parse it raised is spawned; the next comes `hold` s into that
    parse. Returns the job log."""
    jobs = []
    t_phase = time.time_ns()
    for k in range(n):
        target = "G55" if k % 2 == 0 else "G54"
        t = time.time_ns()
        await c.cmd({"cmd": "mdi", "text": target})
        sp = await wait_trace(lambda r: r.get("active_idx") == IDX[target], t, 30,
                              f"{target}: a parse spawned for it", ("gcode.spawn_start",))
        jobs.append({"switch": k + 1, "to": target, "job": sp.get("job"), "basis": sp.get("basis"),
                     "reason": sp.get("reason"), "switch_ns": t, "spawn_ns": sp["t_wall_ns"]})
        log(f"switch {k + 1}: {target} -> job {sp.get('job')} ({sp.get('reason')})")
        if k + 1 < n:
            await asyncio.sleep(hold)
            done = recs_after(sp["t_wall_ns"], ("gcode.worker_done", "gcode.publish"))
            if any(r.get("job") == sp.get("job") for r in done):
                log(f"  job {sp.get('job')} finished within {hold} s — too short to supersede")
    last = jobs[-1]
    pub = await wait_trace(lambda r: r.get("job") == last["job"], last["spawn_ns"], 300,
                           f"publish of job {last['job']}", ("gcode.publish",))
    if pub.get("active_idx") != IDX[last["to"]] or pub.get("basis") != last["basis"]:
        raise Stop(f"the published parse is not the last basis: {pub.get('active_idx')} {pub.get('basis')}")
    ends = recs_after(t_phase, ("gcode.parse_cancelled", "gcode.publish", "gcode.reparse_superseded"))
    for j in jobs[:-1]:
        j["ended"] = sorted({r["tag"] for r in ends if r.get("job") == j["job"]})
    jobs[-1]["ended"] = ["gcode.publish"]
    log("supersede: jobs", [(j["job"], j["to"], j["ended"]) for j in jobs])
    return jobs


async def main():
    c = Client()
    await c.connect()
    await asyncio.sleep(2.0)
    stop_rss = asyncio.Event()
    rss_task = None
    if "--check" in sys.argv:
        log("check: status", {k: c.st.get(k) for k in ("estop", "enabled", "homed", "interp_state", "task_mode",
                                                       "g5x_index", "active_file", "safety_trip", "clients")})
        log("check: pages", sorted(mac_pages(time.time_ns() - 60 * 10**9)))
        await c.cmd({"cmd": "arm", "armed": False}, timeout=5)
        await c.ws.close()
        return
    start = opt("--from", "A")
    try:
        if not mac_pages(time.time_ns() - 60 * 10**9):
            raise Stop("no browser-PC page reported in the last 60 s — is the WebUI open and visible?")
        if c.st.get("safety_trip"):
            raise Stop("a safety trip is not acknowledged — the operator acknowledges it, never this script")
        if other_armed(c.st):
            raise Stop("the browser page is ARMED — disarm it (a held key would jog at rest)")
        rss_task = asyncio.get_event_loop().create_task(sample_rss(stop_rss))
        if start == "A":
            bpc.mark("prep")
        if c.st.get("estop"):
            await c.cmd({"cmd": "estop_reset"})
            await c.until(lambda s: not s.get("estop"), 10, "E-Stop reset")
        if not c.st.get("enabled"):
            await c.cmd({"cmd": "machine_on"})
            await c.until(lambda s: s.get("enabled"), 10, "Machine On")
        if not c.st.get("homed"):
            await c.cmd({"cmd": "home_all"})
            await c.until(lambda s: s.get("homed") and s.get("interp_state") == 1, 180, "Home All")
        if c.st.get("g5x_index") != 1:
            await c.cmd({"cmd": "mdi", "text": "G54"})
            await c.until(lambda s: s.get("g5x_index") == 1 and s.get("interp_state") == 1, 30, "G54")
        setup_record(c)

        if ORDER.index(start) <= ORDER.index("A"):
            await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "blank.ngc")})
            await asyncio.sleep(10)
            bpc.mark("A_rest")
            await asyncio.sleep(60)
            if other_armed(c.st):
                raise Stop("the browser page is ARMED — disarm it before the key phase")
            await mdi_msg(c, "jetzt 40 s lang die Pfeiltaste nach unten gedrueckt halten")
            bpc.mark("A_input")
            await asyncio.sleep(40)
            await mdi_msg(c, "Taste loslassen")

        if ORDER.index(start) <= ORDER.index("S"):
            bpc.mark("S_load")
            t = time.time_ns()
            await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "bpc_parse.ngc")})
            await wait_publish(c, t, 600, "bpc_parse.ngc")
            await wait_settled(c, t, 1800, "bpc_parse.ngc check")
            bpc.mark("S_supersede")
            jobs = await supersede(c, opt("--switches", 8), opt("--hold", 1.5))
            with open(os.path.join(HERE, "supersede.json"), "w") as f:
                json.dump(jobs, f, indent=1)
            bpc.mark("S_settle")
            await wait_settled(c, jobs[-1]["spawn_ns"], 1800, "the last basis's check")
            await asyncio.sleep(60)

        bpc.mark("R_load")
        t = time.time_ns()
        await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "bpc_run.ngc")})
        await wait_publish(c, t, 300, "bpc_run.ngc")
        await wait_settled(c, t, 1800, "bpc_run.ngc check", quiet_s=8.0)
        if other_armed(c.st):
            raise Stop("the browser page is ARMED — disarm it before the run (its key phase)")
        bpc.mark("R_run")
        await c.cmd({"cmd": "cycle_start"})
        await c.until(lambda s: s.get("interp_state") != 1, 15, "run started")
        log("running")
        await c.until(lambda s: s.get("interp_state") == 1 and not s.get("tool_change_requested"), 1800, "run end",
                      tick=lambda: confirm_tool_changes(c))
        log("run ended")
        bpc.mark("R_settle")
        await wait_settled(c, t, 1200, "the check after the run", quiet_s=10.0)
        await asyncio.sleep(60)
        bpc.mark("end")
        log("sequence complete")
    except Stop as e:
        log("STOP:", e)
        if c.st.get("interp_state") not in (None, 1):
            try:
                await c.cmd({"cmd": "abort"})
            except Stop as e2:
                log("abort:", e2)
        bpc.mark("stopped")
        raise SystemExit(2)
    finally:
        stop_rss.set()
        if rss_task:
            await asyncio.sleep(0.3)
        try:
            await c.cmd({"cmd": "arm", "armed": False}, timeout=5)
        except Exception:
            pass
        await c.ws.close()


if __name__ == "__main__":
    asyncio.run(main())

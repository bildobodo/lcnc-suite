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
  S_supersede N basis switches of G54's Z offset (z0 − 1, z0, …), each
              STANDING until its parse is spawned (by job id), the next one
              inside that parse: every parse but the last must be cancelled,
              the last one published with the last basis (z0, the start's)
  S_settle    the page's check of that publish, then 60 s of calm
  R_load      bpc_run.ngc loaded; publish and the page's check
  R_run       Cycle Start, each tool change confirmed like the dialog's
              Confirm; the program's messages ask for the key while the
              first run check runs; T7 M600 re-parses during it
  R_settle    the check after the run, then 60 s of calm
  end

Beside it, every 0.25 s: the RSS of the gateway and of every parse worker
(rss.jsonl). A GUARD watches the whole sequence (Codex R182 VP182-03): every
status envelope's own fields — `clients` (each client's armed state), `armed`
(this script's), `safety_trip` (present while a trip is unacknowledged) —
must be fresh (≤ 2 s), no OTHER client armed (the armed count less this
script's own, never an IP filter) and no trip; a breach cancels the sequence
like any refusal. The watchdog's receipt log is anchored on the wall clock
by this script's own E-Stop reset (anchors.json: the one trip_reset dump the
log gained and the one wd.trip_reset the trace gained — Codex R182 VP182-04).
Any refusal, timeout or guard breach stops the run (a running program is
aborted) and says why. The WS token is read from the INI, never printed.

  drive2.py [--check] [--from PHASE] [--to S] [--no-keys] [--switches N] [--hold S]

  --to S ends after S_settle: no R phase, no cycle start (VP188-02 step 0).
  --no-keys asks for no key: one message at the start says so instead of the
  hold / release prompts (a diagnosis run, no input acceptance — Codex R192);
  setup.json records it, the report counts the presses that came anyway.
"""
import asyncio
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import time

import msgspec.msgpack

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpc  # noqa: E402
import drive  # noqa: E402
from drive import NC, Client, Stop, confirm_tool_changes, log, mac_pages, wait_publish, wait_settled  # noqa: E402
from tracetail import TraceTail  # noqa: E402

# Every trace file, read incrementally (tracetail.py: the processes rotate the
# trace each on their own) — for this script and for the waits it borrows
# from drive.py, which read only the newest two files.
_TAIL = TraceTail(time.time_ns() - 30 * 60 * 10**9)
trace_since = _TAIL.since
drive.trace_since = _TAIL.since

RSS = os.path.join(HERE, "rss.jsonl")
ANCHORS = os.path.join(HERE, "anchors.json")
WDLOG = os.path.join(bpc.LOGS, "hal_watchdog.log")
GWLOG = os.path.join(bpc.LOGS, "gateway.log")
ENV_STALE_S = 2.0
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


class Client2(Client):
    """The status ENVELOPE's own fields beside `data`, replaced by every
    status / status_delta that carries them (`clients` and `armed` ride every
    one; `safety_trip` only while a trip is unacknowledged — its absence
    clears it), with the time of that status."""

    def __init__(self):
        super().__init__()
        self.env = None
        self.env_at = 0.0

    async def _read(self):
        async for raw in self.ws:
            try:
                d = msgspec.msgpack.decode(raw) if isinstance(raw, (bytes, bytearray)) else json.loads(raw)
            except Exception:
                continue
            if not isinstance(d, dict):
                continue
            if d.get("type") in ("status", "status_delta"):
                self.env = {"clients": d.get("clients"), "armed": d.get("armed"), "safety_trip": d.get("safety_trip")}
                self.env_at = time.monotonic()
            if isinstance(d.get("data"), dict):
                self.st.update(d["data"])
            if d.get("type") == "reply" or ("ok" in d and "cmd" in d):
                self.replies.append(d)


def guard_breach(c):
    """Why the run must not go on, or None: a stale or missing envelope, an
    armed client other than this script, an unacknowledged trip."""
    if c.env is None or time.monotonic() - c.env_at > ENV_STALE_S:
        return "no fresh status envelope (> 2 s) — the clients' armed states are unknown"
    clients = c.env.get("clients")
    if not isinstance(clients, list):
        return "the status carries no client list"
    others = sum(1 for x in clients if isinstance(x, dict) and x.get("armed")) - (1 if c.env.get("armed") else 0)
    if others > 0:
        return f"{others} other client(s) ARMED — disarm the browser page (a held key would jog at rest)"
    if c.env.get("safety_trip"):
        return "a safety trip is not acknowledged — the operator acknowledges it, never this script"
    return None


async def guard(c, seq, why):
    while not seq.done():
        b = guard_breach(c)
        if b:
            why.append(b)
            seq.cancel()
            return
        await asyncio.sleep(0.25)


def not_still(c):
    """Why the machine is not known to stand idle, or None: a fresh status
    (the guard's freshness) with the interpreter IDLE, in position and no
    velocity (|v| ≤ 0.001, command_policy.motion_still_of) — IDLE alone
    admits a manual jog (Codex R183 VP183-03). Unknown is no pass."""
    if c.env is None or time.monotonic() - c.env_at > ENV_STALE_S:
        return "no fresh status"
    st = c.st
    if st.get("estop"):
        return None                      # E-Stop already holds every axis
    if st.get("interp_state") != 1:
        return f"the interpreter is not idle ({st.get('interp_state')})"
    v = st.get("current_vel")
    if st.get("inpos") is not True or not isinstance(v, (int, float)) or abs(v) > 0.001:
        return f"the machine is not known to stand (inpos {st.get('inpos')}, velocity {v})"
    return None


async def anchored_reset(c):
    """Only at a fresh, known standstill (not_still): E-Stop (if not set) and
    E-Stop Reset by this script: the watchdog dumps
    its arrival ring `[HB-DUMP] +Xms reason=trip_reset` and emits
    `wd.trip_reset` in the same handler. Exactly one of each, new since the
    command, is the anchor of the log's +ms on the wall clock."""
    why = not_still(c)
    if why:
        raise Stop(f"no E-Stop for the anchor: {why}")
    wd_off = os.path.getsize(WDLOG)
    t_cmd = time.time_ns()
    if not c.st.get("estop"):
        await c.cmd({"cmd": "estop"})
        await c.until(lambda s: s.get("estop"), 10, "E-Stop")
    await c.cmd({"cmd": "estop_reset"})
    await c.until(lambda s: not s.get("estop"), 10, "E-Stop reset")
    await asyncio.sleep(1.5)
    with open(WDLOG, "rb") as f:
        f.seek(wd_off)
        new = f.read().decode("utf-8", "replace")
    dumps = re.findall(r"\[HB-DUMP\] \+(\d+)ms reason=trip_reset", new)
    resets = [r for r in trace_since(t_cmd) if r.get("tag") == "wd.trip_reset"]
    if len(dumps) != 1 or len(resets) != 1:
        raise Stop(f"watchdog anchor not unique: {len(dumps)} dump(s), {len(resets)} trace record(s)")
    a = {"wd_ms": int(dumps[0]), "wall_ns": resets[0]["t_wall_ns"], "wd_pid": resets[0].get("pid"),
         "wd_log_bytes": wd_off, "gwlog": os.path.getsize(GWLOG), "local": time.strftime("%H:%M:%S")}
    with open(ANCHORS, "w") as f:
        json.dump(a, f, indent=1)
    log("watchdog anchor", a)


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
    env = []                             # a page's environment is said once, at its connect
    for path in glob.glob(os.path.join(bpc.LOGS, "trace.ndjson*")):
        with open(path, "rb") as f:
            for raw in f:
                if b'"browser.ws.client_env"' in raw:
                    try:
                        r = json.loads(raw)
                    except ValueError:
                        continue
                    if r.get("page") in pages:
                        env.append(r)
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
        "keys_requested": not NO_KEYS,
        "heap": any(r.get("heap_used_mb") is not None for r in perf),
        "programs": [program_record(n) for n in ("bpc_parse.ngc", "bpc_run.ngc")],
        "status": {k: c.st.get(k) for k in ("estop", "enabled", "homed", "g5x_index", "tool_in_spindle")},
    }
    with open(SETUP, "w") as f:
        json.dump(rec, f, indent=1)
    log("setup", {k: rec[k] for k in ("commit", "vm_cpus", "pages", "browser_ua", "event_timing", "heap")})
    return rec


NO_KEYS = "--no-keys" in sys.argv


async def key_msg(c, text):
    """A key prompt — none in a run without input (--no-keys)."""
    if NO_KEYS:
        log("key prompt left out (--no-keys)", text)
        return
    await mdi_msg(c, text)


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
    """n switches of G54's Z offset (G10 L2 P1), alternating z0 − 1 mm and z0
    (n even ends on z0, the start's): an offset drift the gateway re-parses
    on (`wcsoff:G54:z`) — a change of the ACTIVE fixture alone raises no
    parse (no drift edge reads the index), and bpc_parse.ngc selects G54
    itself. Each switch stands until the parse it raised is spawned; the next
    comes `hold` s into that parse. Returns the job log."""
    jobs = []
    t_phase = time.time_ns()
    try:
        z0 = float(c.st["wcs_table"][0]["z"])
    except (KeyError, IndexError, TypeError, ValueError):
        raise Stop("G54's Z offset not in the status (wcs_table)")
    if c.st.get("g5x_index") != 1:
        raise Stop("G54 is not the active fixture")
    for k in range(n):
        z = z0 - 1.0 if k % 2 == 0 else z0
        target = f"G54 Z{z:.3f}"
        t = time.time_ns()
        await c.cmd({"cmd": "mdi", "text": f"G10 L2 P1 Z{z:.3f}"})
        sp = await wait_trace(lambda r: str(r.get("reason") or "").startswith("wcsoff:"), t, 30,
                              f"{target}: a parse spawned for it", ("gcode.spawn_start",))
        jobs.append({"switch": k + 1, "to": target, "z": z, "job": sp.get("job"), "basis": sp.get("basis"),
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
    if pub.get("basis") != last["basis"]:
        raise Stop(f"the published parse is not the last basis: {pub.get('basis')}")
    ends = recs_after(t_phase, ("gcode.parse_cancelled", "gcode.publish", "gcode.reparse_superseded"))
    for j in jobs[:-1]:
        j["ended"] = sorted({r["tag"] for r in ends if r.get("job") == j["job"]})
    jobs[-1]["ended"] = ["gcode.publish"]
    log("supersede: jobs", [(j["job"], j["to"], j["ended"]) for j in jobs])
    return jobs


async def sequence(c, start):
    """The phases, under the guard (main cancels this on a breach)."""
    if start == "A":
        bpc.mark("prep")
    await anchored_reset(c)
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
    if NO_KEYS:
        await mdi_msg(c, "Messlauf ohne Eingabe - bitte keine Taste druecken")

    if ORDER.index(start) <= ORDER.index("A"):
        await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "blank.ngc")})
        await asyncio.sleep(10)
        bpc.mark("A_rest")
        await asyncio.sleep(60)
        await key_msg(c, "jetzt 40 s lang die Pfeiltaste nach unten gedrueckt halten")
        bpc.mark("A_input")
        await asyncio.sleep(40)
        await key_msg(c, "Taste loslassen")

    if ORDER.index(start) <= ORDER.index("S"):
        bpc.mark("S_load")
        t = time.time_ns()
        await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "bpc_parse.ngc")})
        await wait_publish(c, t, 600, "bpc_parse.ngc")
        await wait_settled(c, t, 1800, "bpc_parse.ngc check")
        bpc.mark("S_supersede")
        # the key held through the switches — the input under that load is
        # proven by the events (in_n in S_supersede's rows), not a duration
        await key_msg(c, "jetzt die Pfeiltaste nach unten gedrueckt halten (Versatzwechsel)")
        jobs = await supersede(c, opt("--switches", 8), opt("--hold", 1.5))
        with open(os.path.join(HERE, "supersede.json"), "w") as f:
            json.dump(jobs, f, indent=1)
        bpc.mark("S_settle")
        await key_msg(c, "Taste loslassen")
        await wait_settled(c, jobs[-1]["spawn_ns"], 1800, "the last basis's check")
        await asyncio.sleep(60)
        if opt("--to", "R") == "S":
            # VP188-02 step 0: S alone — no R, no cycle start (Codex R190)
            bpc.mark("end")
            log("sequence complete (to S)")
            return

    bpc.mark("R_load")
    t = time.time_ns()
    await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "bpc_run.ngc")})
    await wait_publish(c, t, 300, "bpc_run.ngc")
    await wait_settled(c, t, 1800, "bpc_run.ngc check", quiet_s=8.0)
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


async def main():
    c = Client2()
    await c.connect()
    await asyncio.sleep(2.0)
    stop_rss = asyncio.Event()
    rss_task = None
    if "--check" in sys.argv:
        log("check: status", {k: c.st.get(k) for k in ("estop", "enabled", "homed", "interp_state", "task_mode",
                                                       "g5x_index", "active_file")})
        log("check: envelope", c.env, "guard:", guard_breach(c) or "ok")
        log("check: pages", sorted(mac_pages(time.time_ns() - 60 * 10**9)))
        await c.cmd({"cmd": "arm", "armed": False}, timeout=5)
        await c.ws.close()
        return
    start = opt("--from", "A")
    why = []
    try:
        if not mac_pages(time.time_ns() - 60 * 10**9):
            raise Stop("no browser-PC page reported in the last 60 s — is the WebUI open and visible?")
        b = guard_breach(c)
        if b:
            raise Stop(b)
        rss_task = asyncio.get_event_loop().create_task(sample_rss(stop_rss))
        seq = asyncio.get_event_loop().create_task(sequence(c, start))
        asyncio.get_event_loop().create_task(guard(c, seq, why))
        try:
            await seq
        except asyncio.CancelledError:
            raise Stop("guard: " + (why[0] if why else "cancelled"))
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

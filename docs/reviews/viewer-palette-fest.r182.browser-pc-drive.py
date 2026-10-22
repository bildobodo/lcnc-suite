#!/usr/bin/env python3
"""Drives the browser-PC measurement on the live XYZAC sim, so the operator's
Mac only keeps the WebUI open (passive: it previews, sweeps and checks the run
as it always does).

A second, ARMED WebSocket client — the same commands the buttons send. Phases
are marked with bpc.py (wall time + gateway.log offset); the report reads what
the suite recorded. Waits read the status (this client) and the trace (the Mac
page's own telemetry: collision.sweep_start / sweep_done from a non-local peer).

  prep  (not measured) E-Stop reset if needed, Machine On, Home All, G54, a
        small program loaded (so B's load parses afresh)
  A     rest, 60 s
  B     load haus.ngc; wait for its publish and the Mac's full check
  C     G54 -> G55 -> G56 -> G54, 1 s apart; wait until parse and check settle
  D     load webui_m600_live.ngc; wait for publish + check; Cycle Start;
        confirm each tool change like the dialog's Confirm; wait for the run's
        end and the check after it
  end

Any refusal or timeout stops the sequence (a running program is aborted) and
says why. Never acknowledges a safety trip: an unacknowledged trip stops here.
The WS token is read from the INI and never printed."""
import asyncio
import json
import os
import re
import sys
import time

import msgspec.msgpack
import websockets

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpc  # noqa: E402

INI = os.path.expanduser("~/linuxcnc/configs/lcnc_suite_sim/lcnc_suite_sim_5axis_xyzac.ini")
NC = os.path.expanduser("~/linuxcnc/nc_files")
TRACE = os.path.expanduser("~/lcnc-suite/runlogs/trace.ndjson")


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


class Stop(Exception):
    pass


def token():
    with open(INI) as f:
        for line in f:
            m = re.match(r"\s*WEBUI_TOKEN\s*=\s*(.*)", line)
            if m:
                return m.group(1).strip()
    return ""


def trace_since(t0_ns):
    """Trace records at or after t0 (the current file and the one before)."""
    out = []
    for path in (TRACE + ".1", TRACE):
        try:
            with open(path, "rb") as f:
                for raw in f:
                    if not raw.startswith(b'{"t_wall_ns":'):
                        continue
                    try:
                        t = int(raw[13:raw.index(b",", 13)])
                    except ValueError:
                        continue
                    if t >= t0_ns:
                        try:
                            out.append(json.loads(raw))
                        except ValueError:
                            pass
        except FileNotFoundError:
            pass
    out.sort(key=lambda r: r["t_wall_ns"])
    return out


def mac_pages(t0_ns):
    """The Mac page's ids: its viewer.perf names its host (the URL's); every
    telemetry record carries `page`. Not the peer — the Vite dev server
    proxies the page's POSTs, so the gateway sees 127.0.0.1 for both."""
    return {r.get("page") for r in trace_since(t0_ns)
            if r.get("tag") == "browser.viewer.perf" and r.get("host") not in bpc.LOCAL}


class Client:
    def __init__(self):
        self.st = {}
        self.replies = []
        self.ws = None

    async def connect(self):
        self.ws = await websockets.connect("ws://127.0.0.1:8000/ws?token=" + token(), max_size=None)
        await self.send({"cmd": "hello"})
        asyncio.get_event_loop().create_task(self._beat())
        asyncio.get_event_loop().create_task(self._read())
        await self.cmd({"cmd": "arm", "armed": True})

    async def send(self, o):
        await self.ws.send(json.dumps(o))

    async def _beat(self):
        while True:
            await self.send({"cmd": "heartbeat"})
            await asyncio.sleep(0.8)

    async def _read(self):
        async for raw in self.ws:
            try:
                d = msgspec.msgpack.decode(raw) if isinstance(raw, (bytes, bytearray)) else json.loads(raw)
            except Exception:
                continue
            if not isinstance(d, dict):
                continue
            if isinstance(d.get("data"), dict):
                self.st.update(d["data"])
            if d.get("type") == "reply" or ("ok" in d and "cmd" in d):
                self.replies.append(d)

    async def cmd(self, o, timeout=60.0):
        rid = f"bpc{time.monotonic_ns()}"
        self.replies.clear()
        await self.send({**o, "req_id": rid})
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            for d in self.replies:
                if d.get("req_id") == rid or (d.get("req_id") is None and d.get("cmd") == o["cmd"]):
                    if not d.get("ok", False):
                        raise Stop(f"{o['cmd']} refused: {d.get('error') or d}")
                    log("ok", o["cmd"], o.get("text") or os.path.basename(o.get("path", "")))
                    return d
            await asyncio.sleep(0.05)
        raise Stop(f"{o['cmd']}: no reply in {timeout:.0f} s")

    async def until(self, pred, timeout, what, tick=None):
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            if tick:
                await tick()
            if pred(self.st):
                return
            await asyncio.sleep(0.25)
        raise Stop(f"timeout ({timeout:.0f} s): {what}")


async def confirm_tool_changes(c):
    if c.st.get("tool_change_requested"):
        log("tool change requested — confirm (the dialog's Confirm)")
        await c.cmd({"cmd": "confirm_tool_change"})
        await asyncio.sleep(0.5)


def published_after(t0):
    return [r for r in trace_since(t0) if r.get("tag") == "gcode.publish"]


async def wait_publish(c, t0, timeout, what):
    t1 = time.monotonic()
    while time.monotonic() - t1 < timeout:
        pubs = published_after(t0)
        if pubs:
            log("published", what, f"{pubs[-1].get('total_ms')} ms encode")
            return pubs[-1]["t_wall_ns"]
        await asyncio.sleep(1.0)
    raise Stop(f"timeout ({timeout:.0f} s): publish of {what}")


async def wait_settled(c, t0, timeout, what, quiet_s=15.0, need_sweep=True):
    """Until no parse runs, nothing new started for quiet_s, and the Mac page's
    last sweep since t0 ended (done/stopped/failed/cancelled after its start)."""
    t1 = time.monotonic()
    while time.monotonic() - t1 < timeout:
        recs = trace_since(t0)
        now = time.time_ns()
        # a parse runs while its spawn is the latest of spawn and every way a
        # parse ends (preview_refresh rides the envelope, not `data`)
        spawn = max((r["t_wall_ns"] for r in recs if r.get("tag") == "gcode.spawn_start"), default=0)
        ended = max((r["t_wall_ns"] for r in recs if r.get("tag") in (
            "gcode.publish", "gcode.worker_done", "gcode.parse_cancelled", "gcode.reparse_superseded")), default=0)
        parse_busy = spawn > ended
        last_parse = max(spawn, ended)
        pages = mac_pages(t0 - 60 * 10**9)
        mac = [r for r in recs if r.get("page") in pages and r.get("tag", "").startswith("browser.collision.")]
        starts = [r for r in mac if r["tag"] == "browser.collision.sweep_start"]
        ends = [r for r in mac if r["tag"] in ("browser.collision.sweep_done", "browser.collision.sweep_stopped",
                                               "browser.collision.sweep_failed", "browser.collision.sweep_cancelled")]
        last_start = max((r["t_wall_ns"] for r in starts), default=0)
        last_end = max((r["t_wall_ns"] for r in ends), default=0)
        sweep_open = last_start > last_end
        # a load must start a sweep; a basis change may not (debounced,
        # or no change the check follows): then 90 s of quiet settle it
        swept = bool(starts) or (not need_sweep and now - t0 > 90e9)
        if (not parse_busy and not sweep_open and swept and now - max(last_parse, last_start, last_end, t0) > quiet_s * 1e9):
            done = [r for r in ends if r["tag"] == "browser.collision.sweep_done"]
            log("settled", what, f"sweeps started {len(starts)}, done {len(done)}, other ends {len(ends) - len(done)}",
                f"last done {done[-1].get('ms') if done else None} ms")
            return
        await asyncio.sleep(2.0)
    raise Stop(f"timeout ({timeout:.0f} s): {what} did not settle")


async def main():
    c = Client()
    await c.connect()
    await asyncio.sleep(2.0)
    if "--check" in sys.argv:
        mac = [r for r in trace_since(time.time_ns() - 60 * 10**9)
               if r.get("tag") == "browser.viewer.perf" and r.get("host") not in bpc.LOCAL]
        log("check: status", {k: c.st.get(k) for k in ("estop", "enabled", "homed", "interp_state", "task_mode",
                                                       "g5x_index", "active_file", "tool_change_requested", "safety_trip")})
        log("check: Mac page", sorted({(r.get("host"), r.get("cid"), r.get("vis")) for r in mac}))
        await c.cmd({"cmd": "arm", "armed": False}, timeout=5)
        await c.ws.close()
        return
    try:
        # a Mac page must be there and visible
        mac = [r for r in trace_since(time.time_ns() - 60 * 10**9)
               if r.get("tag") == "browser.viewer.perf" and r.get("host") not in bpc.LOCAL]
        if not mac:
            raise Stop("no Mac page reported in the last 60 s — is the WebUI open and visible?")
        log("Mac page", sorted({(r.get("host"), r.get("cid"), r.get("vis")) for r in mac}))
        if c.st.get("safety_trip"):
            raise Stop("a safety trip is not acknowledged — the operator acknowledges it, never this script")

        if "--from" not in sys.argv:
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
        start = sys.argv[sys.argv.index("--from") + 1] if "--from" in sys.argv else "A"
        if start <= "A":
            await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "blank.ngc")})
            await asyncio.sleep(10)
            bpc.mark("A_rest")
            await asyncio.sleep(60)

        if start <= "B":
            bpc.mark("B_load_program")
            t = time.time_ns()
            await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "haus.ngc")})
            await wait_publish(c, t, 600, "haus.ngc")
            await wait_settled(c, t, 1800, "haus.ngc check")

        bpc.mark("C_wcs_switches")
        t = time.time_ns()
        for w in ("G55", "G56", "G54"):
            await c.cmd({"cmd": "mdi", "text": w})
            await asyncio.sleep(1.0)
        await c.until(lambda s: s.get("g5x_index") == 1 and s.get("interp_state") == 1, 30, "back on G54")
        await wait_settled(c, t, 1800, "WCS switches", need_sweep=False)

        bpc.mark("D_run_m600")
        t = time.time_ns()
        await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "webui_m600_live.ngc")})
        await wait_publish(c, t, 300, "webui_m600_live.ngc")
        await wait_settled(c, t, 900, "webui_m600_live.ngc check", quiet_s=8.0)
        await c.cmd({"cmd": "cycle_start"})
        await c.until(lambda s: s.get("interp_state") != 1, 15, "run started")
        log("running")
        await c.until(lambda s: s.get("interp_state") == 1 and not s.get("tool_change_requested"), 900, "run end",
                      tick=lambda: confirm_tool_changes(c))
        log("run ended")
        await wait_settled(c, t, 600, "the check after the run", quiet_s=10.0)
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
        try:
            await c.cmd({"cmd": "arm", "armed": False}, timeout=5)
        except Exception:
            pass
        await c.ws.close()


if __name__ == "__main__":
    asyncio.run(main())

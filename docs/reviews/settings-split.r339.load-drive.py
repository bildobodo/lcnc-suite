#!/usr/bin/env python3
"""The driver of the per-device simulation load measurement (settings split
package 2, plan Codex R335 SS334-03; owed after R338). An armed WebSocket
client on the LAN sim (3-axis test config): prep (E-Stop reset if needed —
never a trip's acknowledgement —, Machine On, Home All, G54, blank.ngc), then

  rest0   60 s on blank.ngc: the base line
  load    the big program loaded; its publish; the laptop's check to its end
  basis   G54 Z +0.5, +1.0, back to its start (G10 L2 P1), each standing until
          its publish; then the laptop's check of the last to its end
  rest    120 s of calm with the program loaded

and at its end blank.ngc again and G54 Z as it was. Phases go to marks.jsonl
(wall ms); beside them, every second, the gateway's process tree (the
gateway and its parse workers: CPU seconds, RSS) to gateway.jsonl. The
browsers (browsers.mjs) sample themselves; this script waits for their
`ready` and reads their samples to know when the laptop's check has ended.
The WS token is read from the INI, never printed.

  drive.py <outdir> [program]   (default bpc_parse.ngc)
"""
import asyncio
import json
import os
import re
import sys
import time

import websockets
import msgspec.msgpack

INI = os.path.expanduser("~/linuxcnc/configs/lcnc_suite_sim_look/lcnc_suite_sim_3axis_xyz_test.ini")
NC = os.path.expanduser("~/linuxcnc/nc_files")
TRACE = os.path.expanduser("~/lcnc-suite-gates/runlogs/trace.ndjson")
CLK = os.sysconf("SC_CLK_TCK")
OUT = sys.argv[1]
PROGRAM = sys.argv[2] if len(sys.argv) > 2 else "bpc_parse.ngc"


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


def now_ms():
    return int(time.time() * 1000)


def mark(phase, edge):
    with open(os.path.join(OUT, "marks.jsonl"), "a") as f:
        f.write(json.dumps({"phase": phase, "edge": edge, "t": now_ms()}) + "\n")
    log(phase, edge)


def publishes_since(t_ms):
    out = []
    try:
        with open(TRACE, "rb") as f:
            f.seek(max(0, os.path.getsize(TRACE) - 64 * 1024 * 1024))
            for raw in f:
                if b'"gcode.publish"' not in raw:
                    continue
                try:
                    r = json.loads(raw)
                except ValueError:
                    continue
                if r.get("t_wall_ns", 0) // 1_000_000 >= t_ms:
                    out.append(r)
    except FileNotFoundError:
        pass
    return out


def last_sample():
    try:
        with open(os.path.join(OUT, "samples.jsonl"), "rb") as f:
            f.seek(max(0, os.path.getsize(f.name) - 8192))
            lines = f.read().splitlines()
        return json.loads(lines[-1]) if lines else None
    except (OSError, ValueError):
        return None


def gateway_tree():
    procs = {}
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            with open(f"/proc/{d}/stat") as f:
                st = f.read()
            rest = st[st.rindex(")") + 2:].split()
            with open(f"/proc/{d}/cmdline", "rb") as f:
                cmd = f.read().replace(b"\0", b" ").decode(errors="replace")
            with open(f"/proc/{d}/status") as f:
                rss = int(re.search(r"VmRSS:\s+(\d+)", f.read()).group(1))
            procs[int(d)] = (int(rest[1]), (int(rest[11]) + int(rest[12])) / CLK, rss, cmd)
        except (OSError, AttributeError, ValueError):
            continue
    roots = [p for p, (_, _, _, cmd) in procs.items() if "-m uvicorn gateway:app" in cmd and "python" in cmd.split(" ")[0]]
    ids, grew = set(roots), True
    while grew:
        grew = False
        for p, (pp, *_r) in procs.items():
            if p not in ids and pp in ids:
                ids.add(p)
                grew = True
    gw = [procs[p] for p in roots]
    kids = {p: procs[p] for p in ids if p not in roots}
    # per process: a parse worker is a NEW process each time — its CPU time
    # leaves the sum with it, so the report adds each pid's own delta
    return {"gw_cpu": sum(x[1] for x in gw), "gw_rss_mb": sum(x[2] for x in gw) / 1024,
            "parse_rss_mb": sum(x[2] for x in kids.values()) / 1024, "parse_n": len(kids),
            "kids": {str(p): x[1] for p, x in kids.items()}}


async def sample_gateway():
    while True:
        with open(os.path.join(OUT, "gateway.jsonl"), "a") as f:
            f.write(json.dumps({"t": now_ms(), **gateway_tree()}) + "\n")
        await asyncio.sleep(1.0)


class Client:
    def __init__(self):
        self.st, self.replies, self.ws = {}, [], None

    async def connect(self):
        self.ws = await websockets.connect("ws://127.0.0.1:8000/ws?token=" + token(), max_size=None)
        await self.send({"cmd": "hello", "session": "simload-driver", "resume_armed": False})
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
            if d.get("type") == "reply":
                self.replies.append(d)

    async def cmd(self, o, timeout=60.0):
        rid = f"sl{time.monotonic_ns()}"
        await self.send({**o, "req_id": rid})
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            for d in list(self.replies):
                if d.get("req_id") == rid or (d.get("req_id") is None and d.get("cmd") == o["cmd"]):
                    self.replies.remove(d)
                    if d.get("ok") is False:
                        raise Stop(f"{o['cmd']} refused: {d.get('error')}")
                    return d
            await asyncio.sleep(0.05)
        raise Stop(f"{o['cmd']}: no reply in {timeout:.0f} s")

    async def until(self, pred, timeout, what):
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            if pred(self.st):
                return
            await asyncio.sleep(0.25)
        raise Stop(f"timeout ({timeout:.0f} s): {what}")


async def wait_publish(t_ms, timeout, what):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if publishes_since(t_ms):
            return
        await asyncio.sleep(0.5)
    raise Stop(f"no publish in {timeout} s: {what}")


async def wait_laptop_check(timeout, what):
    """The laptop's check has begun and ended (its worker idle with a result)."""
    t0 = time.monotonic()
    begun = False
    while time.monotonic() - t0 < timeout:
        s = last_sample()
        w = (s or {}).get("laptop", {}).get("work") or {}
        if w.get("busy") or w.get("scheduled"):
            begun = True
        if begun and not w.get("busy") and not w.get("scheduled") and w.get("result"):
            return round(time.monotonic() - t0, 1)
        await asyncio.sleep(0.5)
    raise Stop(f"the laptop's check did not end in {timeout} s: {what}")


async def mdi(c, text):
    await c.cmd({"cmd": "mdi", "text": text})
    await c.until(lambda s: s.get("interp_state") == 1, 30, f"idle after {text}")


async def main():
    os.makedirs(OUT, exist_ok=True)
    while not os.path.exists(os.path.join(OUT, "ready")):
        await asyncio.sleep(1)
    asyncio.get_event_loop().create_task(sample_gateway())
    c = Client()
    await c.connect()
    await c.until(lambda s: "estop" in s, 10, "first status")
    # the VM sim restarted for this run may have latched before its first
    # client: on the VM sim this run acknowledges it (operator 2026-10-24 —
    # never on real hardware)
    await c.send({"cmd": "safety_trip_ack"})   # its reply names no command: sent, not awaited
    await asyncio.sleep(1.0)
    if c.st.get("estop"):
        await c.cmd({"cmd": "estop_reset"})
        await c.until(lambda s: not s.get("estop"), 10, "E-Stop reset")
    if not c.st.get("enabled"):
        await c.cmd({"cmd": "machine_on"})
        await c.until(lambda s: s.get("enabled"), 10, "Machine On")
    if not all(c.st.get("homed_joints") or [False]):
        await c.cmd({"cmd": "home_all"})
        await c.until(lambda s: all(s.get("homed_joints") or [False]), 120, "homed")
    await c.cmd({"cmd": "set_mode", "mode": 3})   # MODE_MDI
    await mdi(c, "G54")
    z0 = (c.st.get("g5x_offset") or [0, 0, 0])[2]
    t = now_ms()
    await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "blank.ngc")})
    await wait_publish(t, 120, "blank.ngc")
    await asyncio.sleep(10)
    record = {"program": PROGRAM, "size": os.path.getsize(os.path.join(NC, PROGRAM)), "g54_z0": z0}
    try:
        mark("rest0", "start")
        await asyncio.sleep(60)
        mark("rest0", "end")

        mark("load", "start")
        t = now_ms()
        await c.cmd({"cmd": "load_file", "path": os.path.join(NC, PROGRAM)}, timeout=120)
        await wait_publish(t, 900, PROGRAM)
        record["load_publish_s"] = round((now_ms() - t) / 1000, 1)
        record["load_check_s"] = await wait_laptop_check(1800, "load")
        mark("load", "end")

        mark("basis", "start")
        await c.cmd({"cmd": "set_mode", "mode": 3})   # MODE_MDI
        for dz in (0.5, 1.0, 0.0):
            t = now_ms()
            await mdi(c, f"G10 L2 P1 Z{z0 + dz:.4f}")
            await wait_publish(t, 900, f"G54 Z {z0 + dz}")
        record["basis_check_s"] = await wait_laptop_check(1800, "basis")
        mark("basis", "end")

        mark("rest", "start")
        await asyncio.sleep(120)
        mark("rest", "end")
    finally:
        try:
            await mdi(c, f"G10 L2 P1 Z{z0:.4f}")
            for attempt in range(10):   # the MDI's start claim ends with a status that proves it
                try:
                    await c.cmd({"cmd": "load_file", "path": os.path.join(NC, "blank.ngc")})
                    break
                except Stop as e:
                    log("cleanup load:", e)
                    await asyncio.sleep(2)
            await c.cmd({"cmd": "arm", "armed": False})
        except Stop as e:
            log("cleanup:", e)
        with open(os.path.join(OUT, "drive.json"), "w") as f:
            json.dump(record, f, indent=2)
        open(os.path.join(OUT, "stop"), "w").close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Stop as e:
        log("STOP:", e)
        open(os.path.join(OUT, "stop"), "w").close()
        sys.exit(1)

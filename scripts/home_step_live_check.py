#!/usr/bin/env python3
"""Live acceptance of Home / Unhome per axis and the step jog on a running
sim (package 3a: F-HOME.S2b and the step jog's travel; Codex R363–R366).

Drives the gateway through the WebSocket as the strip does (`home {axis}`,
`jog_incr`, `jog_cont` / `jog_stop`) and reads the outcome from LinuxCNC's
own status. Never on the operator's live suite: it homes, unhomes and moves
the machine. The target is a scratch install run headless (as
macro_live_check.py's), the gateway on its own port.

Rows (default):
  map         the status' home_axes names one joint per axis, every Home open
  home-<L>    after Unhome All, `home {axis}` homes exactly the axis' joint —
              no other joint changes (STAT.homed)
  step-mdi    a homed step right after an MDI move (motion in coordinated
              mode): the reply ok and the axis moved by the step — never a
              false "Jog mode changed"
  step-jog    a step right after a continuous jog and its stop: the same
  step-span   a step past the axis' travel is refused, nothing moves
Rows (--group: the INI gives every joint HOME_SEQUENCE -1, the operator's
machine's shape — a copy of a profile):
  group-map   home_axes closes Home on every axis with the group's reason
  group-home  `home {axis}` is refused with it, nothing homes
  group-all   Home All homes every joint (the one way, as before)
  group-unhome Unhome per axis stays open (no group rule): one joint unhomed

Usage: home_step_live_check.py <ini> [--group]  (the gateway on 127.0.0.1:WEBUI_PORT)
"""
import asyncio
import json
import sys
import time

import linuxcnc
import msgspec.msgpack
import websockets

RESULTS = []
s = linuxcnc.stat()


def row(name, ok, detail=""):
    RESULTS.append((name, "PASS" if ok else "FAIL", detail))
    print(f"{'PASS' if ok else 'FAIL':4s} {name:12s} {detail}", flush=True)


def ini_value(ini, section, key):
    sec = None
    for line in open(ini):
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            sec = line[1:-1]
        elif sec == section and "=" in line and line.split("=", 1)[0].strip() == key:
            return line.split("=", 1)[1].strip()
    return None


def poll():
    s.poll()
    return s


def homed():
    return [bool(h) for h in poll().homed[:s.joints]]


class Gateway:
    """One armed WS client: heartbeats, replies by req_id, the status DATA
    merged from status and status_delta frames (home_axes is read there)."""

    def __init__(self, url):
        self.url, self.replies, self.seq, self.data, self.frames = url, {}, 0, {}, 0

    async def __aenter__(self):
        self.ws = await websockets.connect(self.url, max_size=None)
        loop = asyncio.get_event_loop()
        self.task, self.beat = loop.create_task(self._reader()), loop.create_task(self._beat())
        await self.ws.send(json.dumps({"cmd": "hello", "session": "home-step-live"}))
        t0 = time.monotonic()
        while self.frames < 3 and time.monotonic() - t0 < 20:
            await asyncio.sleep(0.1)
        r = await self.cmd({"cmd": "arm", "armed": True})
        if not r.get("ok"):
            raise SystemExit(f"arm refused: {r.get('error')}")
        return self

    async def __aexit__(self, *a):
        self.beat.cancel()
        self.task.cancel()
        await self.ws.close()

    async def _beat(self):
        while True:
            await self.ws.send(json.dumps({"cmd": "heartbeat"}))
            await asyncio.sleep(0.8)

    async def _reader(self):
        async for raw in self.ws:
            try:
                d = msgspec.msgpack.decode(raw) if isinstance(raw, (bytes, bytearray)) else json.loads(raw)
            except Exception:
                continue
            if not isinstance(d, dict):
                continue
            if d.get("type") in ("status", "status_delta"):
                self.frames += 1
                self.data.update(d.get("data") or {})
            if d.get("type") == "reply" and d.get("req_id"):
                self.replies[d["req_id"]] = d

    async def cmd(self, obj, timeout=60.0):
        self.seq += 1
        rid = f"hslc-{self.seq}"
        await self.ws.send(json.dumps({**obj, "req_id": rid}))
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            if rid in self.replies:
                return self.replies.pop(rid)
            await asyncio.sleep(0.02)
        return {"ok": False, "error": "no reply"}

    async def settled(self, pred, timeout=5.0):
        """The gateway's own status agrees (a command it judges on a stale
        status is refused): wait for its frames to show `pred`."""
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout and not pred(self.data):
            await asyncio.sleep(0.05)
        return pred(self.data)


async def until(gw, cmd, ok, timeout=15.0):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if ok():
            return
        r = await gw.cmd(cmd)
        t1 = time.monotonic()
        while time.monotonic() - t1 < 2.0 and not ok():
            await asyncio.sleep(0.1)
        if not ok() and not r.get("ok"):
            print(f"     {cmd['cmd']}: {r.get('error')} — again", flush=True)
    if not ok():
        raise SystemExit(f"setup: {cmd['cmd']} never took effect")


async def wait(pred, timeout):
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        if pred():
            return True
        await asyncio.sleep(0.05)
    return False


async def idle(gw, timeout=60.0):
    await asyncio.sleep(0.3)
    ok = await wait(lambda: poll().interp_state == linuxcnc.INTERP_IDLE and s.inpos and s.queue == 0, timeout)
    await gw.settled(lambda d: d.get("interp_state") == linuxcnc.INTERP_IDLE and d.get("inpos") is True)
    return ok


async def mdi(gw, text):
    t0 = time.monotonic()
    while True:
        r = await gw.cmd({"cmd": "mdi", "text": text})
        if r.get("ok") or "wait" not in str(r.get("error")) or time.monotonic() - t0 > 5:
            break
        await asyncio.sleep(0.1)
    await idle(gw)
    return r


async def per_axis(gw, ini):
    axes = gw.data.get("home_axes") or []
    letters = [a["letter"] for a in axes]
    row("map", len(axes) == s.joints and all(a["joint"] == i and a["home"] is None for i, a in enumerate(axes)),
        f"home_axes {[(a['letter'], a['joint'], a['home']) for a in axes]}")
    await until(gw, {"cmd": "unhome_all"}, lambda: not any(homed()), timeout=20)
    await gw.settled(lambda d: not any(d.get("homed_joints") or [True]))
    for i, a in enumerate(axes):
        before = homed()
        r = await gw.cmd({"cmd": "home", "axis": i})
        done = await wait(lambda j=a["joint"]: homed()[j] and poll().inpos, 90)
        changed = [j for j, (x, y) in enumerate(zip(before, homed())) if x != y]
        await gw.settled(lambda d, j=a["joint"]: (d.get("homed_joints") or [False] * 9)[j])
        row(f"home-{a['letter']}", r.get("ok") is True and done and changed == [a["joint"]],
            f"reply {r.get('ok')} {r.get('error') or ''}; joints changed {changed}, expected [{a['joint']}]")
    return letters


async def steps(gw, ini):
    lo, hi = float(ini_value(ini, "AXIS_X", "MIN_LIMIT")), float(ini_value(ini, "AXIS_X", "MAX_LIMIT"))
    mid = round((lo + hi) / 2, 3)
    await mdi(gw, "G49")
    await mdi(gw, f"G53 G0 X{mid}")
    x0 = poll().actual_position[0]
    r = await gw.cmd({"cmd": "jog_incr", "axis": 0, "vel": 10.0, "distance": 1.0})
    await idle(gw)
    x1 = poll().actual_position[0]
    row("step-mdi", r.get("ok") is True and abs(x1 - x0 - 1.0) < 0.01,
        f"reply {r.get('ok')} {r.get('error') or ''}; X {x0:.3f} → {x1:.3f}, motion_mode {s.motion_mode}")
    r = await gw.cmd({"cmd": "jog_cont", "axis": 0, "vel": 5.0})
    await asyncio.sleep(0.4)
    await gw.cmd({"cmd": "jog_stop", "axis": 0})
    await idle(gw)
    x2 = poll().actual_position[0]
    r = await gw.cmd({"cmd": "jog_incr", "axis": 0, "vel": 10.0, "distance": -1.0})
    await idle(gw)
    x3 = poll().actual_position[0]
    row("step-jog", r.get("ok") is True and abs(x3 - x2 + 1.0) < 0.01,
        f"reply {r.get('ok')} {r.get('error') or ''}; X {x2:.3f} → {x3:.3f}")
    span = hi - lo
    r = await gw.cmd({"cmd": "jog_incr", "axis": 0, "vel": 10.0, "distance": span + 1.0})
    await asyncio.sleep(1.0)
    x4 = poll().actual_position[0]
    row("step-span", r.get("ok") is False and "past the travel" in str(r.get("error")) and abs(x4 - x3) < 1e-6,
        f"reply {r.get('ok')} {r.get('error') or ''}; X {x3:.3f} → {x4:.3f}")


async def group(gw):
    axes = gw.data.get("home_axes") or []
    reasons = [a.get("home") for a in axes]
    row("group-map", len(axes) == s.joints and all(r and "together" in r for r in reasons), f"{reasons}")
    await until(gw, {"cmd": "unhome_all"}, lambda: not any(homed()), timeout=20)
    await gw.settled(lambda d: not any(d.get("homed_joints") or [True]))
    r = await gw.cmd({"cmd": "home", "axis": 0})
    await asyncio.sleep(2.0)
    row("group-home", r.get("ok") is False and "together" in str(r.get("error")) and not any(homed()),
        f"reply {r.get('ok')} {r.get('error')}; homed {homed()}")
    await until(gw, {"cmd": "home_all"}, lambda: all(homed()) and poll().inpos, timeout=120)
    row("group-all", all(homed()), f"homed {homed()}")
    await gw.settled(lambda d: all(d.get("homed_joints") or [False]))
    r = await gw.cmd({"cmd": "unhome", "axis": 1})
    await wait(lambda: not homed()[1], 10)
    row("group-unhome", r.get("ok") is True and homed() == [True, False, True][:s.joints],
        f"reply {r.get('ok')} {r.get('error') or ''}; homed {homed()}")


async def main(ini, as_group):
    port = int(ini_value(ini, "DISPLAY", "WEBUI_PORT") or 8000)
    token = ini_value(ini, "DISPLAY", "WEBUI_TOKEN") or ""
    url = f"ws://127.0.0.1:{port}/ws" + (f"?token={token}" if token else "")
    async with Gateway(url) as gw:
        await until(gw, {"cmd": "estop_reset"}, lambda: poll().task_state != linuxcnc.STATE_ESTOP)
        await until(gw, {"cmd": "machine_on"}, lambda: poll().task_state == linuxcnc.STATE_ON)
        await asyncio.sleep(1.5)
        await gw.settled(lambda d: d.get("home_axes") is not None, 10)
        if as_group:
            await group(gw)
        else:
            await per_axis(gw, ini)
            await steps(gw, ini)
    bad = [r for r in RESULTS if r[1] == "FAIL"]
    print(f"RESULT: {'FAIL' if bad else 'PASS'} ({len(RESULTS) - len(bad)}/{len(RESULTS)})", flush=True)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1], "--group" in sys.argv[2:])))

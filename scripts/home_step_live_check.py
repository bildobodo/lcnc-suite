#!/usr/bin/env python3
"""Live acceptance of Home / Unhome per axis, the step jog and the MDI line's
byte limit and the program path's on a running sim (package 3a: F-HOME.S2b,
the step jog's travel, VM-I11; Codex R363–R367).

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
  mdi-binding the binding's own limit: linuxcnc.command().mdi of 255 bytes is
              refused before anything is sent ("limited to 254")
  mdi-edge    a 254-byte MDI line (ASCII comment) goes out and runs: X arrives
  mdi-utf8    a 254-byte line of fewer characters (an umlaut comment) runs too
  mdi-past    a 255-byte line is refused by the gateway with the task mode left
              MANUAL and X unmoved (Codex R366 VM-I11; R367: 254, not 255)
  load-edge   a program whose path is 254 bytes (nested folders) is loaded:
              STAT.file names it
  load-past   one of 255 bytes is refused, and the loaded program stays (the
              binding's program_open would send PLAN_CLOSE before refusing it)
Rows (--group: the INI gives every joint HOME_SEQUENCE -1, the operator's
machine's shape — a copy of a profile):
  group-map   home_axes closes Home on every axis with the group's reason
  group-home  `home {axis}` is refused with it, nothing homes
  group-all   Home All homes every joint (the one way, as before)
  group-unhome Unhome per axis stays open (no group rule): one joint unhomed

Before any connection, arm or controller command (Codex R367 VM-I13) the
target is proven, else the check refuses with the reason:
  target      the requested INI is the one LinuxCNC runs and a shipped
              simulator's installed copy (test_support/live_target.py, the
              read-back check's contract) — or, with --group, exactly the
              home-group fixture of such a copy; the INI names WEBUI_PORT (no
              default port); the process listening there is a gateway whose
              environment names that running INI.

Usage: home_step_live_check.py <ini> [--group]  (the gateway on 127.0.0.1:WEBUI_PORT)
"""
import asyncio
import json
import os
import sys
import time

import linuxcnc
import msgspec.msgpack
import websockets

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # scripts/: the shared target check
from test_support.live_target import (  # noqa: E402 — the read-back check's contract (Codex R367 VM-I13)
    gateway_target_problems, listening_pids, validate_group_target, validate_sim_target)

RESULTS = []
s = None   # the status channel, opened in main() — checked against the target before anything acts


def target_refusal(ini, as_group, pids_of=listening_pids):
    """Why this run may not act on its target, or None (VM-I13): the native
    channel's running INI is the requested one and a shipped simulator's
    copy (or, --group, the home-group fixture of one), WEBUI_PORT is named,
    and the gateway listening there serves that INI."""
    try:
        s.poll()
        running = s.ini_filename
    except Exception as e:  # noqa: BLE001 — no running LinuxCNC is a refusal, named
        return f"no running LinuxCNC: {e}"
    try:
        (validate_group_target if as_group else validate_sim_target)(ini, running)
    except ValueError as e:
        return str(e)
    port = ini_value(ini, "DISPLAY", "WEBUI_PORT")
    if not port:
        return "the INI names no WEBUI_PORT — no default port"
    problems = gateway_target_problems(int(port), running, pids_of(int(port)))
    return problems[0] if problems else None


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


def padded(head, n, fill="x"):
    """`head (` + fill… + `)` of exactly n UTF-8 bytes."""
    base = head + " ("
    room = n - len(base.encode()) - 1
    k = room // len(fill.encode())
    line = base + fill * k + "x" * (room - k * len(fill.encode())) + ")"
    assert len(line.encode()) == n, (len(line.encode()), n)
    return line


async def mdi_limit(gw, ini):
    lo, hi = float(ini_value(ini, "AXIS_X", "MIN_LIMIT")), float(ini_value(ini, "AXIS_X", "MAX_LIMIT"))
    a, b = round(lo + (hi - lo) * 0.4, 3), round(lo + (hi - lo) * 0.6, 3)
    try:
        linuxcnc.command().mdi("x" * 255)     # refused by the binding before any send
        said = "taken"
    except ValueError as e:
        said = str(e)
    row("mdi-binding", "254" in said, said)
    line = padded(f"G53 G0 X{a}", 254)
    r = await mdi(gw, line)
    x = poll().actual_position[0]
    row("mdi-edge", r.get("ok") is True and abs(x - a) < 0.01,
        f"reply {r.get('ok')} {r.get('error') or ''}; {len(line.encode())} bytes; X {x:.3f} (target {a})")
    line = padded(f"G53 G0 X{b}", 254, "ä")
    r = await mdi(gw, line)
    x = poll().actual_position[0]
    row("mdi-utf8", r.get("ok") is True and abs(x - b) < 0.01,
        f"reply {r.get('ok')} {r.get('error') or ''}; {len(line)} characters, {len(line.encode())} bytes; "
        f"X {x:.3f} (target {b})")
    await until(gw, {"cmd": "set_mode", "mode": linuxcnc.MODE_MANUAL}, lambda: poll().task_mode == linuxcnc.MODE_MANUAL)
    await gw.settled(lambda d: d.get("task_mode") == linuxcnc.MODE_MANUAL)
    line = padded(f"G53 G0 X{a}", 255)
    r = await gw.cmd({"cmd": "mdi", "text": line})
    await asyncio.sleep(1.0)
    x = poll().actual_position[0]
    row("mdi-past", r.get("ok") is False and "255 bytes" in str(r.get("error"))
        and s.task_mode == linuxcnc.MODE_MANUAL and abs(x - b) < 1e-6,
        f"reply {r.get('ok')} {r.get('error')}; task_mode {s.task_mode}; X {x:.3f}")


async def program_path(gw, ini):
    prefix = os.path.abspath(os.path.expanduser(ini_value(ini, "DISPLAY", "PROGRAM_PREFIX")))
    sub = os.path.join(prefix, "p3_path_edge_" + "d" * 60)
    os.makedirs(sub, exist_ok=True)

    def at(n):
        path = os.path.join(sub, "e" * (n - len(sub.encode()) - 1 - 4) + ".ngc")
        with open(path, "w") as f:
            f.write("(the program path's byte limit, R367)\nM2\n")
        assert len(path.encode()) == n, (len(path.encode()), n)
        return path
    edge, past = at(254), at(255)
    r = await gw.cmd({"cmd": "load_file", "path": edge})
    loaded = await wait(lambda: poll().file == edge, 15)
    await gw.settled(lambda d: d.get("active_file") == edge, 10)
    row("load-edge", r.get("ok") is True and loaded,
        f"reply {r.get('ok')} {r.get('error') or ''}; {len(edge.encode())} bytes; STAT.file is it: {loaded}")
    r = await gw.cmd({"cmd": "load_file", "path": past})
    await asyncio.sleep(2.0)
    row("load-past", r.get("ok") is False and "255 bytes" in str(r.get("error")) and poll().file == edge
        and gw.data.get("active_file") == edge,
        f"reply {r.get('ok')} {r.get('error')}; STAT.file still the 254-byte one: {s.file == edge}; "
        f"active_file kept: {gw.data.get('active_file') == edge}")


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
    global s
    s = linuxcnc.stat()
    why = target_refusal(ini, as_group)
    if why:
        # before connecting, arming or resetting anything
        row("target", False, why)
        print("RESULT: FAIL (target refused)", flush=True)
        return 1
    row("target", True, f"{os.path.basename(s.ini_filename)}{' (home-group fixture)' if as_group else ''}")
    port = int(ini_value(ini, "DISPLAY", "WEBUI_PORT"))
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
            await mdi_limit(gw, ini)
            await program_path(gw, ini)
    bad = [r for r in RESULTS if r[1] == "FAIL"]
    print(f"RESULT: {'FAIL' if bad else 'PASS'} ({len(RESULTS) - len(bad)}/{len(RESULTS)})", flush=True)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1], "--group" in sys.argv[2:])))

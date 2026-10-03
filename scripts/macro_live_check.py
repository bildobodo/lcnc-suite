#!/usr/bin/env python3
"""Live acceptance of macro FILES on a running sim (package 5, stage B;
plan docs/reviews/makros.plan.md, Codex VP69-01..04).

Drives the gateway through the WebSocket exactly as the macro bar does
(`run_macro` bound to the revision of `GET /macros`) and reads the machine's
outcome from LinuxCNC. Prints one PASS / FAIL / SKIP table. Never run it on
the operator's live suite: it moves the machine, writes into the macro folder
and changes G54. The intended target is a COPY of a sim configuration run
headless (DISPLAY = the suite launcher, WEBUI_BROWSER = 0) whose INI has:

  [DISPLAY] WEBUI_MACRO_DIR = macros         (the example macros in it)
  [RS274NGC] SUBROUTINE_PATH = …:macros:testsubs
  [RS274NGC] REMAP = M499 modalgroup=10 ngc=m499

and `testsubs/m499.ngc` = an MDI remap calling `o<probe_helper> call` (the
script writes probe_helper.ngc itself). The recorded run
(docs/reviews/makros.live-r1.txt) used a fresh install of the examples:
`HOME=<scratch> scripts/install_examples.py --destination <scratch>/configs/x
--backup-root <scratch>/backups` (the fake HOME keeps the installer's ~/linuxcnc
writes out of the real one), the five seeded macros copied into `macros/`, the
gateway on its own port without a token. Each run ends with the check's client
gone — the HAL watchdog trips the sim; restart it for the next run.

Rows:
  examples     every shipped example is listed runnable (the gateway parsed it)
  coolant      coolant_flush runs; the spindle started before keeps turning
               through the forced MDI switch (VP69-01: emcMotionAbort carries
               no spindle command — measured, not assumed)
  units        face_top under G20 + G95 cuts its 10 mm in mm; G20 and G95
               are active again after it (VP69-04, M73 restores at endsub)
  park-below   park from below machine Z0: Z only ever up, X/Y only at the top
               (within the startup code's G64 P — the planner blends the
               corner), the end in machine coordinates (sampled path)
  park-top     park from Z0: Z stays, X/Y move
  g30-top      go_to_g30_macro (the suite's routine, nested) from Z0 and from
  g30-below    below it: the retract rule as for park, the end at the stored
               G30 position (set first, new to this run)
  above-z0     SKIP on a Z0-at-top config (twp_buttons_check.py's reason)
  warmup       spindle_warmup at 1000 rpm: 250, 500, 750, 1000, then off
  tcp          park and go_to_g30_macro are refused under TCP ("Machine
               frame only"), nothing moves
  revision     run_macro with another revision is refused, nothing runs
  claim-done   (Codex R70 VP-I30) an MDI dwell's start claim refuses a macro
               write while it runs ("busy") and is released on its RCS_DONE:
               the write is admitted within 2 s of the end
  claim-error  an MDI line the interpreter refuses (an unknown word) is
               released on its OWN error — or every MDI typo would block the
               macro writes until the next command
  claim-run    run_macro's claim: busy while the macro runs, released after
  refusal      (VP-I31) a PUT on a stale base answers the real route's body:
               exactly the keys of scripts/test_fixtures/macro_refusals.json's
               `conflict`, the revision of the file on disk, its name
  admission    (VP-I33) a link out of the macro folder is no macro: not
               listed, GET 403, run_macro refused
  cache-red    an MDI remap leaves probe_helper in the interpreter's offset
               cache; its header is shortened by 300 bytes; a plain MDI
               `o<probe_helper> call` (no mode switch: the gateway's `mdi`)
               runs from the stale offset — steps missing or an error. This
               is the defect the forced switch removes (the RED case).
  cache-green  the same precondition, then run_macro: all 20 steps in order.

Usage: macro_live_check.py <ini> (the gateway on 127.0.0.1:WEBUI_PORT).
"""
import asyncio
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

import linuxcnc
import msgspec.msgpack
import websockets

RESULTS = []
s = linuxcnc.stat()


def row(name, ok, detail=""):
    RESULTS.append((name, "PASS" if ok else "FAIL", detail))
    print(f"{'PASS' if ok else 'FAIL':4s} {name:12s} {detail}", flush=True)


def skip(name, why):
    RESULTS.append((name, "SKIP", why))
    print(f"SKIP {name:12s} {why}", flush=True)


def ini_value(ini, section, key):
    sec = None
    for line in open(ini):
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            sec = line[1:-1]
        elif sec == section and "=" in line and line.split("=", 1)[0].strip() == key:
            return line.split("=", 1)[1].strip()
    return None


class Gateway:
    """One ARMED WS client: heartbeats, every frame's `errors` collected,
    replies matched by req_id."""

    def __init__(self, url, token, port):
        self.url, self.token, self.port = url, token, port
        self.messages = []          # (t, kind, text) from every status frame
        self.replies = {}
        self.seq = 0
        self.status_frames = 0      # status frames seen: the gateway has a machine state

    async def __aenter__(self):
        self.ws = await websockets.connect(self.url, max_size=None)
        self.task = asyncio.get_event_loop().create_task(self._reader())
        self.beat = asyncio.get_event_loop().create_task(self._beat())
        await self.cmd({"cmd": "hello"}, wait=False)
        t0 = time.monotonic()
        while self.status_frames < 3 and time.monotonic() - t0 < 20:
            await asyncio.sleep(0.1)        # a command before the first status is refused
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
            if d.get("type") == "status":
                self.status_frames += 1
            for e in d.get("errors") or []:
                if isinstance(e, (list, tuple)) and len(e) >= 2:
                    self.messages.append((time.monotonic(), e[0], str(e[1])))
                elif isinstance(e, dict):
                    self.messages.append((time.monotonic(), e.get("kind"), str(e.get("text") or e.get("message"))))
            if d.get("type") == "reply" and d.get("req_id"):
                self.replies[d["req_id"]] = d

    async def cmd(self, obj, wait=True, timeout=60.0):
        self.seq += 1
        rid = f"mlc-{self.seq}"
        await self.ws.send(json.dumps({**obj, "req_id": rid}))
        if not wait:
            return None
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            if rid in self.replies:
                return self.replies.pop(rid)
            await asyncio.sleep(0.02)
        return {"ok": False, "error": "no reply"}

    def http(self, path, method="GET", body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", method=method, data=body,
                                     headers={"X-Auth-Token": self.token})
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.read()

    def macros(self):
        return {m["name"]: m for m in json.loads(self.http("/macros"))["macros"]}

    def status_of(self, path, method="GET", body=None):
        """(HTTP status, the JSON body or text) — a refusal is an answer here."""
        try:
            raw, code = self.http(path, method, body), 200
        except urllib.error.HTTPError as e:
            raw, code = e.read(), e.code
        try:
            return code, json.loads(raw)
        except ValueError:
            return code, raw.decode(errors="replace")


def poll():
    s.poll()
    return s


async def wait_idle(timeout=120.0):
    t0 = time.monotonic()
    await asyncio.sleep(0.3)
    while time.monotonic() - t0 < timeout:
        if poll().interp_state == linuxcnc.INTERP_IDLE and s.queue == 0:
            return True
        await asyncio.sleep(0.05)
    return False


async def send(gw, obj, timeout=5.0):
    """A start the way the operator gets one: while the GATEWAY's last status
    still shows the machine busy (STAT is idle a poll earlier — 5 Hz at idle)
    the command is refused and the button dimmed; try again until it admits it."""
    t0 = time.monotonic()
    while True:
        r = await gw.cmd(obj)
        if r.get("ok") or "busy" not in str(r.get("error")) or time.monotonic() - t0 > timeout:
            return r
        await asyncio.sleep(0.1)


async def mdi(gw, text):
    r = await send(gw, {"cmd": "mdi", "text": text})
    if not r.get("ok"):
        print(f"     mdi {text!r}: {r.get('error')}", flush=True)
    await wait_idle()
    return r


async def run(gw, name, args=(), revision=None):
    m = gw.macros().get(name)
    if m is None:
        return {"ok": False, "error": f"{name} not listed"}
    return await send(gw, {"cmd": "run_macro", "name": name, "args": list(args),
                           "revision": revision or m["revision"]})


HELPER_BODY = "o<probe_helper> sub\n" + "".join(f"(DEBUG, step {i:02d})\n" for i in range(1, 21)) + "o<probe_helper> endsub\n"
HELPER_PADDED = "".join(f"(padding line {i:02d} of the description, it moves the sub header)\n" for i in range(5)) + HELPER_BODY


async def run_sampled(gw, name, args=()):
    """run_macro while the machine position is sampled every 5 ms until the
    motion is idle again — the path, not only where it ends."""
    samples = [tuple(poll().actual_position[:3])]
    task = asyncio.get_event_loop().create_task(run(gw, name, args))
    t0 = time.monotonic()
    while time.monotonic() - t0 < 120:
        p = poll()
        samples.append(tuple(p.actual_position[:3]))
        if task.done() and time.monotonic() - t0 > 0.5 and p.interp_state == linuxcnc.INTERP_IDLE and p.queue == 0:
            break
        await asyncio.sleep(0.005)
    return await task, samples


def retract_first(samples, target_xy, tol):
    """The retract rule of twp_buttons_check.py on the sampled PATH: Z never
    below where it started before X/Y moved, and X/Y travel only at the top —
    every sample before X/Y reaches its target lies on the vertical retract
    (X/Y within `tol` of the start) or on the top plane (Z within `tol` of 0).
    `tol` is the G64 P of the startup code: the planner blends consecutive
    moves within it (measured: X/Y begins with Z 0.02 mm short of the top,
    0.0004 mm off the retract line). Returns (never lowered, the largest corner
    cut, the lowest Z before X/Y moved)."""
    x0, y0, z0 = samples[0]
    tx, ty = target_xy
    first_xy = next((i for i, (x, y, _z) in enumerate(samples) if abs(x - x0) > 1e-3 or abs(y - y0) > 1e-3), len(samples))
    lo = min(z for _x, _y, z in samples[:max(first_xy, 1)])
    cut = 0.0
    for x, y, z in samples:
        if ((x - tx) ** 2 + (y - ty) ** 2) ** 0.5 <= tol:
            break                       # at the X/Y target: the rest is the final Z
        cut = max(cut, min(((x - x0) ** 2 + (y - y0) ** 2) ** 0.5, -z))
    return lo >= z0 - 1e-3, cut <= tol, cut, lo


def blend_tolerance(ini):
    """G64 P of [RS274NGC] RS274NGC_STARTUP_CODE (the path tolerance the
    planner blends within), plus 2 µm for the 5 ms sampling; 2 µm without one."""
    m = re.search(r"G64\s*P\s*([0-9.]+)", ini_value(ini, "RS274NGC", "RS274NGC_STARTUP_CODE") or "", re.I)
    return (float(m.group(1)) if m else 0.0) + 0.002


def z_ceiling(ini):
    """The smaller [JOINT_2] / [AXIS_Z] MAX_LIMIT — above machine zero is
    reachable only when it is clearly above 0 (twp_buttons_check.py)."""
    vals = [float(v) for v in (ini_value(ini, sec, "MAX_LIMIT") for sec in ("JOINT_2", "AXIS_Z")) if v]
    return min(vals) if vals else None


def other_messages(gw, since):
    """What LinuxCNC said besides the helper's steps — the red case's evidence."""
    return [f"{k}:{text}" for t, k, text in gw.messages if t >= since and not re.search(r"step \d\d", text)]


def steps_seen(gw, since):
    out = []
    for t, _k, text in gw.messages:
        m = re.search(r"step (\d\d)", text)
        if t >= since and m:
            out.append(int(m.group(1)))
    return out


async def main(ini):
    token = ini_value(ini, "DISPLAY", "WEBUI_TOKEN") or ""
    port = int(ini_value(ini, "DISPLAY", "WEBUI_PORT") or 8000)
    mdir = ini_value(ini, "DISPLAY", "WEBUI_MACRO_DIR")
    mdir = os.path.join(os.path.dirname(os.path.abspath(ini)), os.path.expanduser(mdir))
    url = f"ws://127.0.0.1:{port}/ws" + (f"?token={token}" if token else "")
    async with Gateway(url, token, port) as gw:
        # a homed machine, identity kinematics, a known G54 — every step waits
        # for LinuxCNC's state (a command the gateway's last status does not
        # admit yet is refused) and a refusal stops the check
        async def until(cmd, ok, timeout=15.0):
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
        await until({"cmd": "estop_reset"}, lambda: poll().task_state != linuxcnc.STATE_ESTOP)
        await until({"cmd": "machine_on"}, lambda: poll().task_state == linuxcnc.STATE_ON)
        await asyncio.sleep(1.5)            # the gateway's policy state must see ON too
        await until({"cmd": "home_all"}, lambda: all(poll().homed[:s.joints]) and s.inpos, timeout=120)
        await asyncio.sleep(1.0)
        await until({"cmd": "set_kins_mode", "mode": 0}, lambda: True)
        for line in ("G10 L2 P1 X0 Y0 Z-300 A0 C0", "G54 G21 G90 G94 G97"):
            r = await mdi(gw, line)
            if not r.get("ok"):
                raise SystemExit(f"setup: {line}: {r.get('error')}")

        listed = gw.macros()
        want = ["coolant_flush", "face_top", "go_to_g30_macro", "park", "spindle_warmup"]
        bad = [n for n in want if n not in listed or not listed[n]["runnable"]]
        row("examples", not bad, f"not runnable: {[(n, listed.get(n, {}).get('reason')) for n in bad]}" if bad else "all five runnable")

        # coolant + the spindle through the forced switch
        await mdi(gw, "M3 S1000")
        t_spin = poll().spindle[0]["speed"]
        r = await run(gw, "coolant_flush", [2])
        await asyncio.sleep(0.8)          # inside the macro's dwell
        during = poll().spindle[0]["speed"]
        flood = s.flood
        await wait_idle()
        row("coolant", r.get("ok") and abs(during - t_spin) < 1e-6 and flood == 1,
            f"reply {r.get('ok')} {r.get('error', '')} spindle {t_spin} → {during} during, flood {flood}")
        await mdi(gw, "M5")

        # units: G20 + G95 active, a 10 mm face in mm, the modes back after
        await mdi(gw, "G20 G95")
        r = await run(gw, "face_top", [10, 4, 0.5, 2, 600, 5])
        xmax = -1e9
        t0 = time.monotonic()
        while time.monotonic() - t0 < 120:
            p = poll()
            xmax = max(xmax, p.actual_position[0] - p.g5x_offset[0])
            if p.interp_state == linuxcnc.INTERP_IDLE and p.queue == 0 and time.monotonic() - t0 > 1:
                break
            await asyncio.sleep(0.02)
        g = set(poll().gcodes)
        row("units", r.get("ok") and abs(xmax - 10.0) < 0.05 and 200 in g and 950 in g,
            f"reply {r.get('ok')} {r.get('error', '')} x max {xmax:.3f} mm, G20 {'on' if 200 in g else 'off'}, G95 {'on' if 950 in g else 'off'}")
        await mdi(gw, "G21 G94")

        # park and go to G30 from below machine Z0 and from its top: a retract
        # only ever lifts, X/Y move only once Z is up (the sampled path)
        start = poll().actual_position[2]            # face_top left Z at its clearance
        tol = blend_tolerance(ini)
        r, smp = await run_sampled(gw, "park", [0, 0])
        never_lower, corner, cut, lo = retract_first(smp, (0, 0), tol)
        p = poll().actual_position
        row("park-below", r.get("ok") and start < -1 and never_lower and corner and min(z for *_x, z in smp) >= start - 1e-3
            and abs(p[0]) < 1e-3 and abs(p[1]) < 1e-3 and abs(p[2]) < 1e-3,
            f"from Z {start:.3f}: reply {r.get('ok')} {r.get('error', '')}, lowest Z {lo:.3f}, corner cut {cut:.4f} (G64 {tol:.3f}), "
            f"end X {p[0]:.3f} Y {p[1]:.3f} Z {p[2]:.3f}")
        r, smp = await run_sampled(gw, "park", [10, 20])
        p = poll().actual_position
        row("park-top", r.get("ok") and max(abs(z) for *_x, z in smp) < 1e-3 and abs(p[0] - 10) < 1e-3 and abs(p[1] - 20) < 1e-3,
            f"from Z 0: reply {r.get('ok')} {r.get('error', '')}, Z range {min(z for *_x, z in smp):.3f}..{max(z for *_x, z in smp):.3f}, "
            f"end X {p[0]:.3f} Y {p[1]:.3f} Z {p[2]:.3f}")

        # go to G30: a stored position new to this run (the var file keeps the
        # last run's), from the top and from below
        for label, z_from in (("g30-top", 0.0), ("g30-below", -100.0)):
            g30 = (round(20 + 40 * (time.time() % 1), 3), -40.0, -20.0)
            ra = await mdi(gw, "#5181=%s #5182=%s #5183=%s" % g30)
            rm = await mdi(gw, f"G53 G0 X10 Y20 Z{z_from}")
            r, smp = await run_sampled(gw, "go_to_g30_macro")
            never_lower, corner, cut, lo = retract_first(smp, g30[:2], tol)
            p = poll().actual_position
            row(label, ra.get("ok") and rm.get("ok") and r.get("ok") and never_lower and corner
                and all(abs(p[i] - g30[i]) < 1e-3 for i in range(3)),
                f"stored {g30}, from Z {z_from}: reply {r.get('ok')} {r.get('error', '')}, lowest Z before X/Y {lo:.3f}, "
                f"corner cut {cut:.4f} (G64 {tol:.3f}), end X {p[0]:.3f} Y {p[1]:.3f} Z {p[2]:.3f}")
        ceil = z_ceiling(ini)
        if ceil is None or ceil > 50:
            skip("above-z0", f"Z MAX_LIMIT {ceil}: not covered by this check — run twp_buttons_check.py there")
        else:
            skip("above-z0", f"Z MAX_LIMIT {ceil}: above machine zero is unreachable on this config")

        # spindle warm-up: four equal steps to the top speed, then off; the
        # spindle was off before and is off after (M73)
        speeds = []
        t_w = asyncio.get_event_loop().create_task(run(gw, "spindle_warmup", [1000, 20]))
        t0 = time.monotonic()
        while time.monotonic() - t0 < 60:
            p = poll()
            sp = p.spindle[0]["speed"] if p.spindle[0]["enabled"] else 0.0   # S stays set while off
            if not speeds or speeds[-1] != sp:
                speeds.append(sp)
            if t_w.done() and time.monotonic() - t0 > 1 and p.interp_state == linuxcnc.INTERP_IDLE and p.queue == 0:
                break
            await asyncio.sleep(0.02)
        r = await t_w
        on = [v for v in speeds if v]
        row("warmup", r.get("ok") and on == [250.0, 500.0, 750.0, 1000.0] and poll().spindle[0]["enabled"] == 0,
            f"reply {r.get('ok')} {r.get('error', '')}, commanded speeds {speeds}, enabled after {s.spindle[0]['enabled']}")

        # TCP: the machine-frame macros are refused, nothing moves
        rk = await send(gw, {"cmd": "set_kins_mode", "mode": 1})
        if not rk.get("ok"):
            print(f"     set_kins_mode 1: {rk.get('error')}", flush=True)
        await asyncio.sleep(1.0)
        before = list(poll().actual_position)
        r1 = await run(gw, "park", [0, 0])
        r2 = await run(gw, "go_to_g30_macro")
        await asyncio.sleep(0.5)
        moved = max(abs(a - b) for a, b in zip(before, poll().actual_position))
        row("tcp", rk.get("ok") and not r1.get("ok") and not r2.get("ok")
            and "Machine frame only" in str(r1.get("error")) and moved < 1e-6,
            f"TCP {rk.get('ok')} | park: {r1.get('error')} | g30: {r2.get('error')} | moved {moved:.6f}")
        rk = await send(gw, {"cmd": "set_kins_mode", "mode": 0})
        if not rk.get("ok"):
            raise SystemExit(f"back to the machine frame: {rk.get('error')}")
        await asyncio.sleep(1.0)

        r = await run(gw, "coolant_flush", [1], revision="0" * 64)
        row("revision", not r.get("ok") and "Macro changed" in str(r.get("error")), f"{r.get('error')}")

        # Codex R70: the write admission against the real controller
        probe = "o<r70_probe> sub\no<r70_probe> endsub\n".encode()

        def write_once():
            """A macro write (create r70_probe, then delete it again): its
            status, and its refusal's kind."""
            code, body = gw.status_of("/macro?name=r70_probe&base=new", "PUT", probe)
            if code == 200:
                gw.status_of(f"/macro?name=r70_probe&base={hashlib.sha256(probe).hexdigest()}", "DELETE")
            return code, (body.get("detail") or {}).get("kind") if isinstance(body, dict) and isinstance(body.get("detail"), dict) else body

        async def admitted_after(t_end, limit=2.0):
            """Seconds from `t_end` until a macro write is admitted, None past `limit`."""
            while time.monotonic() - t_end < limit:
                if write_once()[0] == 200:
                    return time.monotonic() - t_end
                await asyncio.sleep(0.05)
            return None

        # a start that runs (an MDI dwell): busy while it runs, released on its DONE
        r = await send(gw, {"cmd": "mdi", "text": "G4 P2"})
        await asyncio.sleep(0.5)
        during = write_once()
        await wait_idle()
        t_end = time.monotonic()
        lat = await admitted_after(t_end)
        row("claim-done", r.get("ok") and during == (409, "busy") and lat is not None,
            f"reply {r.get('ok')} {r.get('error', '')}, write during the dwell {during}, admitted {lat if lat is None else round(lat, 2)} s after its end")

        # a start the interpreter refuses: released on its own error
        r = await gw.cmd({"cmd": "mdi", "text": "G0 X1 E5"})
        await asyncio.sleep(0.3)
        p = poll()
        state = (p.state, p.exec_state, p.queued_mdi_commands, p.interp_state)
        lat = await admitted_after(time.monotonic())
        row("claim-error", not r.get("ok") and lat is not None,
            f"reply {r.get('ok')} {r.get('error', '')}, (state, exec_state, queued MDI, interp) {state}, "
            f"admitted {lat if lat is None else round(lat, 2)} s after the reply")

        # run_macro's claim: busy while the macro dwells, released after
        r = await run(gw, "coolant_flush", [2])
        await asyncio.sleep(0.8)
        during = write_once()
        await wait_idle()
        lat = await admitted_after(time.monotonic())
        row("claim-run", r.get("ok") and during == (409, "busy") and lat is not None,
            f"reply {r.get('ok')} {r.get('error', '')}, write during the macro {during}, admitted {lat if lat is None else round(lat, 2)} s after")

        # the route's refusal body, as the fixture names it
        fixture = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_fixtures", "macro_refusals.json")))
        disk = hashlib.sha256(open(os.path.join(mdir, "park.ngc"), "rb").read()).hexdigest()
        code, body = gw.status_of(f"/macro?name=park&base={'0' * 64}", "PUT", b"(not saved)\n")
        d = body.get("detail") if isinstance(body, dict) else None
        row("refusal", code == 409 and isinstance(d, dict) and sorted(d) == sorted(fixture["conflict"]["keys"])
            and d.get("kind") == "conflict" and d.get("revision") == disk and d.get("name") == "park",
            f"{code} {d}")

        # a link out of the macro folder is no macro anywhere
        outside = os.path.join(os.path.dirname(mdir), "r70_outside.ngc")
        with open(outside, "w") as f:
            f.write("o<escape> sub\n(DEBUG, outside the macro folder)\no<escape> endsub\n")
        link = os.path.join(mdir, "escape.ngc")
        os.symlink(outside, link)
        try:
            listed = "escape" in gw.macros()
            code, body = gw.status_of("/macro?name=escape")
            r = await send(gw, {"cmd": "run_macro", "name": "escape", "args": [],
                                "revision": hashlib.sha256(open(outside, "rb").read()).hexdigest()})
            row("admission", not listed and code == 403 and not r.get("ok") and "leads out of the macro folder" in str(r.get("error")),
                f"listed {listed}, GET {code} {body}, run_macro {r.get('ok')} {r.get('error')}")
        finally:
            os.unlink(link)
            os.unlink(outside)

        # VP69-01: the stale offset cache, red through the plain MDI, green through run_macro
        helper = os.path.join(mdir, "probe_helper.ngc")
        for label, via_run in (("cache-red", False), ("cache-green", True)):
            with open(helper, "w") as f:
                f.write(HELPER_PADDED)
            await asyncio.sleep(1.2)
            t_m = time.monotonic()
            await mdi(gw, "M499")      # the remap calls probe_helper: its offset stays cached
            first = steps_seen(gw, t_m)
            with open(helper, "w") as f:
                f.write(HELPER_BODY)   # the header gone: the cached offset points into the body
            await asyncio.sleep(1.2)
            t1 = time.monotonic()
            if via_run:
                rev = hashlib.sha256(HELPER_BODY.encode()).hexdigest()
                r = await send(gw, {"cmd": "run_macro", "name": "probe_helper", "args": [], "revision": rev})
            else:
                r = await send(gw, {"cmd": "mdi", "text": "o<probe_helper> call"})
            await wait_idle()
            await asyncio.sleep(0.5)
            seen = steps_seen(gw, t1)
            full = seen == list(range(1, 21))
            # the precondition: the remap really ran the helper (its offset is cached)
            pre = first == list(range(1, 21))
            if via_run:
                row(label, pre and r.get("ok") and full, f"remap saw steps {first}; run_macro: {r.get('ok')} {r.get('error', '')} steps {seen}")
            else:
                row(label, pre and r.get("ok") is not None and not full,
                    f"remap saw steps {first}; plain MDI after the edit: reply {r.get('ok')} {r.get('error', '')} "
                    f"steps {seen}, LinuxCNC said {other_messages(gw, t1)} "
                    f"{'(the stale offset)' if not full else '(NOT red — the cache was empty)'}"
                    f"{'' if pre else ' — PRECONDITION FAILED: the remap did not run the helper'}")
        os.unlink(helper)

    fails = [r for r in RESULTS if r[1] == "FAIL"]
    print(json.dumps({"results": RESULTS}, indent=1))
    return 1 if fails else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(asyncio.run(main(sys.argv[1])))

#!/usr/bin/env python3
"""Live certification of the MOTION BUTTONS per kinematics mode (2026-09-04).

The operator's standard after two days of gate/mode work: "I feel our
system is somewhat inconsistent." The unit layer was green; the layer the
operator touches was verified per feature, never as one table. This script
IS the table: every motion button × every kinematics mode, driven through
the WebSocket exactly as the button does (policy included), asserting the
REPLY and the MACHINE OUTCOME, printed as PASS / FAIL / SKIP per cell.

Modes: Machine (M428), TCP (M429, table at A=0), Plane (plane captured at
the tip, G59 active). Rows: → Zero, → Home / → G30 (gate), Zero All
(touch-off route), tool measure/load (gate; SKIP without a toolsetter),
probe op (gate), Cycle Start (gate incl. the post-M2 stranded state), the
two operator-reported sequences (Zero All at A=20 → jog A → → Zero lands
on the datum; release the A jog mid-move → the move completes).

Pattern: twp_touchoff_plane_check.py (mdi/snap/check, refuses on a machine
that cannot execute, restores every row it touches) + twp_capture_check.py's
armed WS helper. Needs the suite live and the gateway that carries
go_to_zero (2026-09-04) — an older gateway answers "Unknown command" and
that is a FAIL, not a skip.
"""
import atexit
import json
import math
import os
import select
import subprocess
import sys
import time

import linuxcnc

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "lcnc-gateway"))
from gateway_util import wcs_prov_params  # noqa: E402

c = linuxcnc.command()
s = linuxcnc.stat()
err = linuxcnc.error_channel()
RESULTS = []          # (row, mode, verdict, detail)
MODES = ("Machine", "TCP", "Plane")


def cell(row, mode, verdict, detail=""):
    RESULTS.append((row, mode, verdict, detail))
    print(f"  {verdict:4s}  [{mode}] {row}{'  — ' + detail if detail else ''}")


def check(row, mode, ok, detail=""):
    cell(row, mode, "PASS" if ok else "FAIL", "" if ok else detail)


def skip(row, mode, why):
    cell(row, mode, "SKIP", why)


def require_ready():
    s.poll()
    problems = []
    if s.task_state != linuxcnc.STATE_ON:
        problems.append(f"task_state={s.task_state} (need STATE_ON)")
    if not all(s.homed[:6]):
        problems.append(f"homed={list(s.homed[:6])}")
    if problems:
        raise SystemExit("PRECONDITIONS NOT MET — refusing to report: " + "; ".join(problems))


def halget(pin):
    out = subprocess.run(["halcmd", "getp", pin], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"halcmd getp {pin}: {out.stderr.strip()}")
    return float(out.stdout.strip().replace("TRUE", "1").replace("FALSE", "0"))


def poll():
    s.poll()


def wait_idle(timeout=180.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        poll()
        if s.interp_state == linuxcnc.INTERP_IDLE and not s.current_vel:
            return True
        time.sleep(0.05)
    return False


def _drain_errors():
    msgs = []
    while True:
        e = err.poll()
        if not e:
            return msgs
        kind, text = e
        if kind in (linuxcnc.NML_ERROR, linuxcnc.OPERATOR_ERROR):
            msgs.append(str(text))


def mdi(line, timeout=180.0):
    _drain_errors()
    c.mode(linuxcnc.MODE_MDI)
    c.wait_complete()
    c.mdi(line)
    rc = c.wait_complete(timeout)
    idle = wait_idle(timeout)
    poll()
    errors = _drain_errors()
    if rc == linuxcnc.RCS_ERROR or rc == -1 or not idle or errors:
        raise SystemExit(f"MDI {line!r} did not complete cleanly: rc={rc} idle={idle} errors={errors}")


def read_params(nums, timeout=5.0):
    import tempfile
    path = os.path.join(tempfile.gettempdir(), f"twp_buttons_params_{os.getpid()}.txt")
    try:
        os.remove(path)
    except OSError:
        pass
    mdi(f"(LOGOPEN,{path})")
    mdi("(LOG,PARAMS " + " ".join(f"#{n}" for n in nums) + ")")
    mdi("(LOGCLOSE)")
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with open(path) as f:
                for ln in f:
                    if "PARAMS" in ln:
                        vals = ln.split("PARAMS", 1)[1].split()
                        if len(vals) == len(nums):
                            os.remove(path)
                            return [float(v) for v in vals]
        except OSError:
            pass
        time.sleep(0.05)
    raise SystemExit(f"could not read interpreter parameters ({path})")


def dro():
    poll()
    return [s.actual_position[i] - s.g5x_offset[i] - s.g92_offset[i] - s.tool_offset[i]
            for i in range(3)]


def joints():
    poll()
    return list(s.joint_actual_position[:6])


# ---------------------------------------------------------------- WS helper (the real button path)
_WS_HELPER_SRC = r"""
import asyncio, json, sys, time
import msgspec.msgpack
import websockets

async def main():
    url = sys.argv[1]
    async with websockets.connect(url, max_size=None) as ws:
        async def send(o):
            await ws.send(json.dumps(o))
        await send({"cmd": "hello"})
        await send({"cmd": "arm", "armed": True})
        last_status = {}
        async def beat():
            while True:
                await send({"cmd": "heartbeat"})
                await asyncio.sleep(0.8)
        asyncio.get_event_loop().create_task(beat())
        loop = asyncio.get_event_loop()
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            if not line:
                return
            req = json.loads(line)
            if req.get("_status"):
                # one FULL status snapshot's requested keys (nested `data`)
                t0 = time.time(); out = None
                while time.time() - t0 < 5:
                    raw = await asyncio.wait_for(ws.recv(), 5)
                    try:
                        d = msgspec.msgpack.decode(raw) if isinstance(raw, (bytes, bytearray)) else json.loads(raw)
                    except Exception:
                        continue
                    data = d.get("data") if isinstance(d, dict) and isinstance(d.get("data"), dict) else None
                    if data:
                        last_status.update(data)
                    if all(k in last_status for k in req["_status"]):
                        out = {k: last_status[k] for k in req["_status"]}; break
                print(json.dumps(out), flush=True)
                continue
            if req.get("_sleep"):
                await asyncio.sleep(req["_sleep"]); print("{}", flush=True); continue
            await send(req)
            if req.get("_nowait"):
                print("{}", flush=True); continue
            while True:
                raw = await asyncio.wait_for(ws.recv(), 90)
                try:
                    d = msgspec.msgpack.decode(raw) if isinstance(raw, (bytes, bytearray)) else json.loads(raw)
                except Exception:
                    continue
                if isinstance(d, dict) and isinstance(d.get("data"), dict):
                    last_status.update(d["data"])
                if isinstance(d, dict) and "ok" in d and d.get("cmd") == req.get("cmd"):
                    print(json.dumps(d), flush=True)
                    break

asyncio.run(main())
"""
_ws_proc = None


def _ws(obj, timeout=90.0):
    global _ws_proc
    venv = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "lcnc-gateway", ".venv", "bin", "python3")
    if _ws_proc is None or _ws_proc.poll() is not None:
        tok = os.environ.get("LCNC_WS_TOKEN", "")
        url = "ws://127.0.0.1:8000/ws" + (f"?token={tok}" if tok else "")
        _ws_proc = subprocess.Popen([venv, "-c", _WS_HELPER_SRC, url],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    text=True, bufsize=1)
        time.sleep(2.0)
    _ws_proc.stdin.write(json.dumps(obj) + "\n")
    _ws_proc.stdin.flush()
    r, _, _ = select.select([_ws_proc.stdout], [], [], timeout)
    if not r:
        raise SystemExit(f"WS command {obj} timed out")
    return json.loads(_ws_proc.stdout.readline())


def ws_cmd(obj):
    """Send a typed command through the persistent ARMED client — the
    real button path — and return the reply dict."""
    time.sleep(0.6)   # let the broadcast poll see the settled state (the gate reads it)
    return _ws(obj)


def permissions():
    d = _ws({"_status": ["permissions"]})
    return (d or {}).get("permissions") or {}


# ---------------------------------------------------------------- save / restore
G54_ROW = list(range(5221, 5231))
_PROV = wcs_prov_params(1)
_PROV_ROWS = [_PROV[k] for k in ("stamped", "kins", "a", "x", "y", "z")]

print("=== 0. preconditions ===")
require_ready()
_saved_g54 = read_params(G54_ROW)
_saved_prov = read_params(_PROV_ROWS)
_saved_tool_vars = read_params([3100, 3101, 3102])
TOOLSETTER = any(abs(v) > 1e-9 for v in _saved_tool_vars)
print(f"  G54={[round(v, 3) for v in _saved_g54[:3]]} stamped={_saved_prov[0]:.0f} toolsetter={'yes' if TOOLSETTER else 'NO (tool rows SKIP)'}")


def _teardown():
    global _ws_proc
    if _ws_proc is not None and _ws_proc.poll() is None:
        _ws_proc.stdin.close()
        try:
            _ws_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            _ws_proc.kill()
        time.sleep(1.0)
    try:
        mdi("g69")
        mdi("M428")
        mdi("G0 A0 B0 C0")
        mdi("G53 G0 Z0")
        poll()
        words = lambda g: " ".join(f"{L}{g[i]:.6f}" for i, L in enumerate("XYZABCUVW")
                                   if s.axis_mask & (1 << i))
        mdi("G92.1")
        mdi(f"G10 L2 P1 {words(_saved_g54)} R{_saved_g54[9]:.6f}")
        mdi(" ".join(f"#{_PROV[k]}={v:.6f}" for k, v in
                     zip(("kins", "a", "x", "y", "z", "stamped"),
                         (_saved_prov[1], _saved_prov[2], _saved_prov[3],
                          _saved_prov[4], _saved_prov[5], _saved_prov[0]))))
        mdi("G54")
        print("  (teardown: g69, M428, rotaries 0, Z up, G54 + provenance restored)")
    except SystemExit as e:
        print(f"  (teardown incomplete: {e})")


atexit.register(_teardown)


def gate_row(row, mode, perms, key, expect):
    check(f"{row} gate '{key}' {'open' if expect else 'closed'}", mode,
          bool(perms.get(key)) is expect, f"permissions.{key}={perms.get(key)}")


# ---------------------------------------------------------------- MACHINE frame
print("\n=== 1. Machine frame (M428) ===")
M = "Machine"
mdi("g69"); mdi("M428"); mdi("G54")
mdi("G0 A0 B0 C0")
mdi("G53 G0 Z0")
mdi("G53 G0 X40 Y-30")
mdi("G53 G0 Z-60")
r = ws_cmd({"cmd": "touchoff", "axes": {"X": 0, "Y": 0, "Z": 0}})
check("Zero All routes to the mdi touch-off and stamps G54", M,
      r.get("ok") is True and r.get("route") == "mdi", str(r))
prov = read_params(_PROV_ROWS)
check("G54 stamp: kins 0, A 0", M, abs(prov[0] - 1) < 1e-9 and abs(prov[1]) < 1e-9 and abs(prov[2]) < 1e-9, str(prov[:3]))
p = permissions()
gate_row("→ Home / → G30", M, p, "machineFrame", True)
gate_row("→ Zero", M, p, "goZero", True)
gate_row("Cycle Start", M, p, "run", True)
gate_row("Tool measure / load", M, p, "machineFrame", True)
gate_row("Probe op", M, p, "machineFrame", True)
# → Zero from a jogged-away table, fixture stamped at A0
mdi("G0 A12")
mdi("G53 G0 X10 Y10")
r = ws_cmd({"cmd": "go_to_zero"})
wait_idle()
d = dro(); j = joints(); poll()
check("→ Zero: Z at machine top, X/Y at work zero, A back to the stamp (0)", M,
      r.get("ok") is True and abs(s.actual_position[2]) < 1e-3 and abs(d[0]) < 1e-3 and abs(d[1]) < 1e-3 and abs(j[3]) < 1e-3,
      f"reply={r} dro={[round(v, 3) for v in d]} A={j[3]:.3f} Zmach={s.actual_position[2]:.3f}")
# the operator's sequence: Zero All at A=20, jog A to 0, → Zero → tip ON the datum
mdi("G0 A20")
mdi("G53 G0 Z-60")
r = ws_cmd({"cmd": "touchoff", "axes": {"X": 0, "Y": 0, "Z": 0}})
prov = read_params(_PROV_ROWS)
check("Zero All at A=20 stamps A 20", M, r.get("ok") is True and abs(prov[2] - 20) < 1e-6, f"{r} stamp={prov[:3]}")
mdi("G0 A0")
mdi("G53 G0 X-20 Y15")
r = ws_cmd({"cmd": "go_to_zero"})
wait_idle()
d = dro(); j = joints()
check("→ Zero after jogging A away: table returns to A 20 and X/Y read zero (tip on the datum)", M,
      r.get("ok") is True and abs(j[3] - 20) < 1e-3 and abs(d[0]) < 1e-3 and abs(d[1]) < 1e-3,
      f"reply={r} A={j[3]:.3f} dro={[round(v, 3) for v in d]}")
# release the A jog mid-move: the move must COMPLETE
mdi("G53 G0 X30 Y-40")
mdi("G0 A-10")
_ws({"cmd": "jog_cont", "axis": 3, "vel": 5.0})
time.sleep(0.4)
_ws({"cmd": "go_to_zero", "_nowait": True})
time.sleep(0.3)
_ws({"cmd": "jog_stop", "axis": 3})
_ws({"_sleep": 0.2})
# drain the go_to_zero reply (it is the next reply-bearing frame for that cmd)
t0 = time.time()
while time.time() - t0 < 60:
    poll()
    if s.interp_state == linuxcnc.INTERP_IDLE and not s.current_vel and time.time() - t0 > 1.5:
        break
    time.sleep(0.1)
wait_idle()
d = dro(); j = joints()
check("→ Zero while the A jog is released mid-move still completes (A 20, X/Y zero)", M,
      abs(j[3] - 20) < 1e-3 and abs(d[0]) < 1e-3 and abs(d[1]) < 1e-3,
      f"A={j[3]:.3f} dro={[round(v, 3) for v in d]}")
if TOOLSETTER:
    skip("Tool measure (M600) run", M, "toolsetter configured — run manually, not by this script")
else:
    skip("Tool measure (M600) run", M, "no toolsetter position in the var file")
# a fixture stamped under TCP refuses → Zero in Machine frame
mdi(" ".join(f"#{_PROV[k]}={v}" for k, v in (("kins", 1), ("a", 0), ("stamped", 1))))
r = ws_cmd({"cmd": "go_to_zero"})
check("→ Zero refuses a fixture stamped under TCP (numbers are table-frame)", M,
      r.get("ok") is False and "TCP" in str(r.get("error", "")), str(r))
mdi(" ".join(f"#{_PROV[k]}={v}" for k, v in (("kins", 0), ("a", 20), ("stamped", 1))))

# ---------------------------------------------------------------- TCP
print("\n=== 2. TCP (M429, table at A=0) ===")
T = "TCP"
mdi("G0 A0")
mdi("M429")
p = permissions()
gate_row("→ Home / → G30", T, p, "machineFrame", False)
gate_row("→ Zero", T, p, "goZero", False)
gate_row("Cycle Start", T, p, "run", True)
gate_row("Tool measure / load", T, p, "machineFrame", False)
gate_row("Probe op", T, p, "machineFrame", False)
r = ws_cmd({"cmd": "go_to_zero"})
check("→ Zero refused with a reason naming TCP", T, r.get("ok") is False and "TCP" in str(r.get("error", "")), str(r))
r = ws_cmd({"cmd": "tool_change", "tool_number": 1})
check("tool_change refused backend-side (Machine frame required)", T,
      r.get("ok") is False and "Machine frame" in str(r.get("error", "")), str(r))
r = ws_cmd({"cmd": "touchoff", "axes": {"Z": 0}})
check("Zero Z at A=0 routes to the mdi touch-off", T, r.get("ok") is True and r.get("route") == "mdi", str(r))
mdi("M428")

# ---------------------------------------------------------------- PLANE
print("\n=== 3. Plane (captured at the tip, G59) ===")
P = "Plane"
mdi("g69")
mdi(f"#{_PROV['stamped']}=0")
mdi("G0 A0 B20 C-15")
mdi("G10 L2 P1 X0 Y0 Z0 A0 B0 C0 R0")
mdi("G53 G0 Z-80")
r = ws_cmd({"cmd": "twp_capture"})
wait_idle()
check("Capture defines the plane at the tip (kins 2, G59)", P,
      r.get("ok") is True and halget("motion.switchkins-type") == 2 and s.g5x_index == 6, f"{r} kins={halget('motion.switchkins-type')} g5x={s.g5x_index}")
p = permissions()
gate_row("→ Home / → G30", P, p, "machineFrame", False)
gate_row("→ Zero", P, p, "goZero", True)
gate_row("Cycle Start", P, p, "run", True)
gate_row("Tool measure / load", P, p, "machineFrame", False)
gate_row("Probe op", P, p, "machineFrame", False)
r = ws_cmd({"cmd": "touchoff", "axes": {"Z": 12.5}})
d = dro()
check("Zero Z routes through the plane; DRO reads the entered value", P,
      r.get("ok") is True and r.get("route") == "plane" and abs(d[2] - 12.5) < 1e-3, f"{r} dro={[round(v, 3) for v in d]}")
r = ws_cmd({"cmd": "touchoff", "axes": {"Z": 0}})
# move off the origin in the plane, then → Zero
mdi("G0 X10 Y5")
mdi("G0 Z-3")
j0 = joints()
r = ws_cmd({"cmd": "go_to_zero"})
wait_idle()
d = dro(); j = joints()
check("→ Zero: retracts along the tool axis to ≥ 25, then X0 Y0 in the plane; rotaries untouched", P,
      r.get("ok") is True and d[2] > 24.99 and abs(d[0]) < 1e-3 and abs(d[1]) < 1e-3
      and all(abs(j[i] - j0[i]) < 1e-6 for i in (3, 4, 5)),
      f"reply={r} dro={[round(v, 3) for v in d]} rotaries={[round(j[i], 3) for i in (3, 4, 5)]} before={[round(j0[i], 3) for i in (3, 4, 5)]}")
# the post-M2 stranded state: G54 selected under TOOL kins → Cycle Start closed, → Zero closed
mdi("G54")
p = permissions()
gate_row("Cycle Start (G54 under Plane kins — the M2 strand)", P, p, "run", False)
gate_row("→ Zero (G54 under Plane kins)", P, p, "goZero", False)
mdi("G59")
p = permissions()
gate_row("Cycle Start (G59 again)", P, p, "run", True)

print("\n=== table ===")
rows = []
for row, mode, verdict, detail in RESULTS:
    rows.append(f"{verdict:4s} | {mode:7s} | {row}")
print("\n".join(rows))
fails = [r for r in RESULTS if r[2] == "FAIL"]
print(f"\n{'ALL PASS' if not fails else str(len(fails)) + ' FAIL'} ({sum(1 for r in RESULTS if r[2] == 'PASS')} pass, {sum(1 for r in RESULTS if r[2] == 'SKIP')} skip)")
sys.exit(1 if fails else 0)

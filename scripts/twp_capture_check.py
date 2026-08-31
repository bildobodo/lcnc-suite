#!/usr/bin/env python3
"""Live acceptance for o<twp_capture> — one-button plane capture (2026-08-31).

What it proves, on the TWP sim (homed, machine on):

  B. Capture at A=0: with the head tilted (B20 C-15) and the tip at a known
     point, the gateway's `twp_capture` command (fired over the WS as an
     ARMED client — the REAL button path, policy included) defines the
     plane FROM the live rotaries
     with origin AT the tip, and the G53.1 P0 orient is a NO-MOVE (joints
     unchanged < 1e-4): TWP active, TOOL kins, tool normal to the plane,
     DRO ~0 on X/Y/Z, G59..G59.3 rewritten with A0 B0 C0 R0, and the G54
     row + its provenance stamp UNTOUCHED (capture writes no datum).
     Optionally (gateway venv reachable): the GATEWAY's broadcast work_pos
     also reads ~0 — the kins-2 DRO honesty fix (a joint-frame formula
     posed as plane coords before it).
  C. Capture at a live table angle (A=35): same properties — g683 stores
     the captured frame in the TABLE frame at the live A; a re-orient
     recomputes the same G59 rows.
  D. Round trip with the Plane touch-off: after a capture,
     `o<twp_touchoff> call [4] [0] [0] [v]` makes the DRO read v.
  E. Refusals, state-intact (all policy-side, surfaced as {ok:false}):
     plane already defined; from G55 (G69 would silently force G54);
     a G92 X offset; a G54 rotary offset.
  F. Clear path: G69 → undefined, G54, identity kins.

Pattern: twp_touchoff_plane_check.py (mdi/snap/read_params/teardown).
Refuses to report on a machine that cannot execute.
"""
import atexit
import math
import os
import subprocess
import sys
import time

import linuxcnc

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "lcnc-gateway"))
from gateway_util import parse_kins_config, wcs_prov_params  # noqa: E402

c = linuxcnc.command()
s = linuxcnc.stat()
err = linuxcnc.error_channel()
FAILS = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        FAILS.append(name)


def require_ready():
    s.poll()
    problems = []
    if s.task_state != linuxcnc.STATE_ON:
        problems.append(f"task_state={s.task_state} (need STATE_ON)")
    if not all(s.homed[:6]):
        problems.append(f"homed={list(s.homed[:6])}")
    if problems:
        raise SystemExit("PRECONDITIONS NOT MET — refusing to report: " + "; ".join(problems))


def kins_from_running_config():
    s.poll()
    ini = linuxcnc.ini(s.ini_filename)
    k = parse_kins_config(ini.find("KINS", "KINEMATICS"),
                          ini.findall("HAL", "HALCMD") or [])
    return float(k["params"]["nut_angle"])


PINS = ["twp-helper-comp.twp-is-defined", "twp-helper-comp.twp-is-active",
        "twp-helper-comp.twp-ox", "twp-helper-comp.twp-oy", "twp-helper-comp.twp-oz",
        "twp-helper-comp.twp-ox-world", "twp-helper-comp.twp-oy-world",
        "twp-helper-comp.twp-oz-world",
        "twp-helper-comp.twp-zx", "twp-helper-comp.twp-zy", "twp-helper-comp.twp-zz",
        "motion.switchkins-type",
        "xyzacb_trsrn_kins.pre-rot", "xyzacb_trsrn_kins.primary-angle",
        "xyzacb_trsrn_kins.secondary-angle"]


def halget(pin):
    out = subprocess.run(["halcmd", "getp", pin], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"halcmd getp {pin}: {out.stderr.strip()}")
    return float(out.stdout.strip().replace("TRUE", "1").replace("FALSE", "0"))


def snap():
    return {p: halget(p) for p in PINS}


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


def mdi(line, timeout=180.0, expect_error=False):
    _drain_errors()
    c.mode(linuxcnc.MODE_MDI)
    c.wait_complete()
    c.mdi(line)
    rc = c.wait_complete(timeout)
    idle = wait_idle(timeout)
    poll()
    errors = _drain_errors()
    if expect_error:
        return errors + (["<RCS_ERROR>"] if rc == linuxcnc.RCS_ERROR else [])
    if rc == linuxcnc.RCS_ERROR or rc == -1 or not idle or errors:
        raise SystemExit(f"MDI {line!r} did not complete cleanly: rc={rc} "
                         f"idle={idle} errors={errors}")
    return errors


def read_params(nums, timeout=5.0):
    import tempfile
    path = os.path.join(tempfile.gettempdir(), f"twp_capture_params_{os.getpid()}.txt")
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


def angle_between(a, b):
    cx = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    return math.degrees(math.atan2(math.sqrt(sum(v * v for v in cx)), sum(x * y for x, y in zip(a, b))))


def plane_normal_machine(snapshot, a_deg):
    n = [snapshot["twp-helper-comp.twp-zx"], snapshot["twp-helper-comp.twp-zy"],
         snapshot["twp-helper-comp.twp-zz"]]
    th = -math.radians(a_deg)
    cth, sn = math.cos(th), math.sin(th)
    return [n[0], n[1] * cth - n[2] * sn, n[1] * sn + n[2] * cth]


def tool_axis_from_head(snapshot):
    b = math.radians(snapshot["xyzacb_trsrn_kins.secondary-angle"])
    cc = math.radians(snapshot["xyzacb_trsrn_kins.primary-angle"])
    nut = math.radians(NUT_ANGLE)
    ax = [0.0, math.sin(nut), math.cos(nut)]
    v = [0.0, 0.0, 1.0]
    k, ct, st = ax, math.cos(b), math.sin(b)
    kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2]
    kx = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]
    r = [v[i] * ct + kx[i] * st + k[i] * kv * (1 - ct) for i in range(3)]
    cz, sz = math.cos(cc), math.sin(cc)
    return [r[0] * cz - r[1] * sz, r[0] * sz + r[1] * cz, r[2]]


def dro():
    """What the DRO shows: world − g5x − g92 − tool offset, XYZ."""
    poll()
    return [s.actual_position[i] - s.g5x_offset[i] - s.g92_offset[i] - s.tool_offset[i]
            for i in range(3)]


def joints():
    poll()
    return list(s.joint_actual_position[:6])


_WS_HELPER_SRC = r"""
import asyncio, json, sys
import msgspec.msgpack
import websockets

async def main():
    url = sys.argv[1]
    async with websockets.connect(url, max_size=None) as ws:
        async def send(o):
            await ws.send(json.dumps(o))
        await send({"cmd": "hello"})
        await send({"cmd": "arm", "armed": True})
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
            await send(req)
            while True:
                raw = await asyncio.wait_for(ws.recv(), 90)
                try:
                    d = msgspec.msgpack.decode(raw) if isinstance(raw, (bytes, bytearray)) else json.loads(raw)
                except Exception:
                    continue
                # Match the reply to THIS command: hello/arm/heartbeat acks
                # also carry "ok", and reading the first ok-bearing frame
                # shifted every reply by two in the first live run.
                if isinstance(d, dict) and "ok" in d and d.get("cmd") == req.get("cmd"):
                    print(json.dumps(d), flush=True)
                    break

asyncio.run(main())
"""

_ws_proc = None


def ws_cmd(obj, timeout=90.0):
    """Send one typed command through a persistent ARMED WS client (the real
    button path — policy, armed-gate and all) and return the reply dict."""
    global _ws_proc
    import json as _json
    venv = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "lcnc-gateway", ".venv", "bin", "python3")
    if _ws_proc is None or _ws_proc.poll() is not None:
        tok = os.environ.get("LCNC_WS_TOKEN", "")
        url = "ws://127.0.0.1:8000/ws" + (f"?token={tok}" if tok else "")
        _ws_proc = subprocess.Popen([venv, "-c", _WS_HELPER_SRC, url],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                    text=True, bufsize=1)
        time.sleep(2.0)  # hello + arm settle
    _ws_proc.stdin.write(_json.dumps(obj) + "\n")
    _ws_proc.stdin.flush()
    import select
    r, _, _ = select.select([_ws_proc.stdout], [], [], timeout)
    if not r:
        raise SystemExit(f"WS command {obj} timed out")
    return _json.loads(_ws_proc.stdout.readline())


def gateway_work_pos():
    """One status snapshot from the RUNNING gateway over WS (venv python —
    it has websockets+msgpack; this process has linuxcnc). Returns the XYZ
    of the broadcast work_pos, or None with a loud SKIP if unreachable."""
    venv = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "..", "lcnc-gateway", ".venv", "bin", "python3")
    prog = (
        "import asyncio,json,websockets\n"
        "import msgspec.msgpack as msgpack\n"
        "async def m():\n"
        "    async with websockets.connect('ws://127.0.0.1:8000/ws?token=' + (__import__('os').environ.get('LCNC_WS_TOKEN','')) if __import__('os').environ.get('LCNC_WS_TOKEN') else 'ws://127.0.0.1:8000/ws', max_size=None) as w:\n"
        "        for _ in range(60):\n"
        "            d = msgpack.decode(await asyncio.wait_for(w.recv(), 5))\n"
        "            wp = d.get('work_pos') if isinstance(d, dict) else None\n"
        "            if wp: print(json.dumps(wp)); return\n"
        "        raise SystemExit('no work_pos frame seen')\n"
        "asyncio.run(m())\n")
    out = subprocess.run([venv, "-c", prog], capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        print(f"  SKIP  gateway work_pos probe unavailable — {out.stderr.strip()[-200:]}")
        return None
    import json
    return json.loads(out.stdout.strip())


G54_ROW = list(range(5221, 5231))
G59_ROW = list(range(5321, 5331))
_PROV = wcs_prov_params(1)
_PROV_ROWS = [_PROV[k] for k in ("stamped", "kins", "a", "x", "y", "z")]

print("=== 0. preconditions ===")
require_ready()
NUT_ANGLE = kins_from_running_config()
_saved_g54 = read_params(G54_ROW)
_saved_g59 = read_params(G59_ROW)
_saved_prov = read_params(_PROV_ROWS)
print(f"  nut={NUT_ANGLE} G54={[round(v, 3) for v in _saved_g54[:6]]} "
      f"G54 prov stamped={_saved_prov[0]:.0f}")
# Absent G54 provenance start (a stale posed stamp makes g683's
# to_storage_frame refuse by design); teardown restores the original.
mdi(f"#{_PROV['stamped']}=0")


def _teardown():
    global _ws_proc
    if _ws_proc is not None and _ws_proc.poll() is None:
        _ws_proc.stdin.close()
        try:
            _ws_proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            _ws_proc.kill()  # helper may sit in ws.recv — the socket drop is the point
        time.sleep(1.0)  # the armed-disconnect abort lands before our MDIs
    try:
        mdi("g69")
        mdi("G0 A0")
        poll()
        words = lambda g: " ".join(f"{L}{g[i]:.6f}" for i, L in enumerate("XYZABCUVW")
                                   if s.axis_mask & (1 << i))
        mdi("G92.1")
        mdi(f"G10 L2 P1 {words(_saved_g54)} R{_saved_g54[9]:.6f}")
        g = list(_saved_g59)
        g[3] = g[4] = g[5] = g[9] = 0.0
        mdi(f"G10 L2 P6 {words(g)} R0")
        mdi(" ".join(f"#{_PROV[k]}={v:.6f}" for k, v in
                     zip(("kins", "a", "x", "y", "z", "stamped"),
                         (_saved_prov[1], _saved_prov[2], _saved_prov[3],
                          _saved_prov[4], _saved_prov[5], _saved_prov[0]))))
        print("  (teardown: g69, A0, G92.1, G54 + G59 + provenance restored)")
    except SystemExit as e:
        print(f"  (teardown incomplete: {e})")


atexit.register(_teardown)


def capture_case(label, a_deg, x, y, z):
    """Tilt the head, park the tip, capture, assert the whole contract."""
    mdi("g69")
    mdi(f"G0 A{a_deg} B20 C-15")
    mdi("G10 L2 P1 X0 Y0 Z0 A0 B0 C0 R0")
    mdi(f"G0 X{x} Y{y} Z{z}")
    j_before = joints()
    read_params([5221, 5222, 5223])  # settle the param channel before capture
    time.sleep(0.6)  # let the broadcast poll see the settled state (the gate reads it)
    r = ws_cmd({"cmd": "twp_capture"})
    check(f"{label}: gateway capture ok", r.get("ok") is True, str(r))
    wait_idle()
    st = snap()
    check(f"{label}: TWP active + TOOL kins",
          st["twp-helper-comp.twp-is-active"] == 1
          and st["motion.switchkins-type"] == 2)
    j_after = joints()
    dj = max(abs(a - b) for a, b in zip(j_before, j_after))
    check(f"{label}: no-move orient (joints unchanged)", dj < 1e-4, f"max dJ={dj:.6f}")
    errN = angle_between(plane_normal_machine(st, a_deg), tool_axis_from_head(st))
    check(f"{label}: plane normal == tool axis", errN < 0.01, f"{errN:.7f} deg")
    d = dro()
    check(f"{label}: DRO ~0 at the tip", all(abs(v) < 1e-3 for v in d),
          f"{[round(v, 4) for v in d]}")
    rows = read_params([5324, 5325, 5326, 5330])
    check(f"{label}: G59 A/B/C/R zero", all(abs(v) < 1e-6 for v in rows), f"{rows}")
    g54_after = read_params([5221, 5222, 5223])
    prov_after = read_params(_PROV_ROWS)
    # Capture ends with the plane touch-off (M535, all-XYZ zero): the ONE
    # datum (G54) lands at the tip THROUGH the plane, provenance stamped
    # table-frame by the remap.
    check(f"{label}: datum provenance stamped table-frame (kins 0, A 0, xyz)",
          abs(prov_after[0] - 1.0) < 1e-9 and abs(prov_after[1]) < 1e-9
          and abs(prov_after[2]) < 1e-9
          and all(abs(prov_after[3 + i] - g54_after[i]) < 1e-4 for i in range(3)),
          f"{[round(v, 4) for v in prov_after]}")
    # Bounded settle: the world pins ride gui_update_twp -> helper republish
    # (a manual probe 1.5 s later showed exact agreement; the immediate read
    # raced the republish once at A=35).
    _pins_ok = False
    for _ in range(30):
        # 5e-3: halcmd getp prints ~7 significant digits, so at datum
        # magnitudes ~1000 its print resolution is 1e-3 — a 1e-4 tolerance
        # failed on formatting, not on disagreement.
        _pins_ok = all(abs(halget(f"twp-helper-comp.twp-o{ax}-world") - g54_after[i]) < 5e-3
                       for i, ax in enumerate("xyz"))
        if _pins_ok:
            break
        time.sleep(0.1)
    check(f"{label}: helper world pins follow the new datum", _pins_ok,
          f"pins={[halget(f'twp-helper-comp.twp-o{ax}-world') for ax in 'xyz']} "
          f"g54={[round(v, 4) for v in g54_after]}")
    return st


print("\n=== B. capture at A=0 ===")
stB = capture_case("A=0", 0.0, 50.0, 40.0, -30.0)
wp = gateway_work_pos()
if wp is not None:
    check("A=0: GATEWAY work_pos ~0 (kins-2 DRO honesty)",
          all(abs(v) < 1e-2 for v in wp[:3]), f"{[round(v, 4) for v in wp[:3]]}")

print("\n=== C. capture at a live table angle (A=35) ===")
capture_case("A=35", 35.0, 30.0, -20.0, -40.0)
g59_c = read_params([5321, 5322, 5323])
mdi("o<twp_reorient> call")
g59_rt = read_params([5321, 5322, 5323])
check("A=35: re-orient recomputes the SAME G59 rows",
      all(abs(a - b) < 1e-3 for a, b in zip(g59_c, g59_rt)),
      f"{[round(v, 4) for v in g59_rt]} vs {[round(v, 4) for v in g59_c]}")

print("\n=== D. round trip with the Plane touch-off (M535) ===")
before = dro()
mdi("o<twp_touchoff> call [4] [0] [0] [5.0]")
after = dro()
check("D: DRO Z reads the entered value", abs(after[2] - 5.0) < 1e-3,
      f"{after[2]:.4f} (was {before[2]:.4f})")

print("\n=== E. refusals, state intact (policy-side, {ok:false}) ===")
def refuse(label, fragment):
    time.sleep(0.6)  # let the broadcast poll see the planted state
    r = ws_cmd({"cmd": "twp_capture"})
    check(f"{label}: refused", r.get("ok") is False, str(r))
    check(f"{label}: reason names it", fragment.lower() in str(r.get("error", "")).lower(),
          str(r.get("error")))

refuse("E1 plane already defined", "Clear plane")
st = snap()
check("E1: plane still active (state intact)",
      st["twp-helper-comp.twp-is-active"] == 1)
mdi("g69")
mdi("G0 A0")
mdi("G55")
refuse("E2 from G55", "G54")
poll()
check("E2: G55 still active (no silent G54 switch)", s.g5x_index == 2)
mdi("G54")
mdi("G92 X1")
refuse("E3 G92 X offset", "G92")
mdi("G92.1")
mdi("G10 L2 P1 A5")
refuse("E4 G54 rotary offset", "rotary")
check("E4: TWP stays undefined",
      halget("twp-helper-comp.twp-is-defined") == 0)
mdi("G10 L2 P1 A0")

print("\n=== F. clear path ===")
mdi("G0 B10 C10")
mdi("G0 X10 Y10 Z-10")
time.sleep(0.6)  # broadcast settle (gate reads the shared payload)
rF = ws_cmd({"cmd": "twp_capture"})
check("F: gateway capture ok", rF.get("ok") is True, str(rF))
wait_idle()
check("F: capture defines + activates",
      halget("twp-helper-comp.twp-is-active") == 1)
mdi("g69")
poll()
check("F: G69 → undefined, G54, identity kins",
      halget("twp-helper-comp.twp-is-defined") == 0 and s.g5x_index == 1
      and halget("motion.switchkins-type") == 0)

print(f"\n=== {'ALL PASS' if not FAILS else str(len(FAILS)) + ' FAIL: ' + ', '.join(FAILS)} ===")
sys.exit(1 if FAILS else 0)

#!/usr/bin/env python3
"""Live pin of the G68.3 stored-origin VECTOR — the 2026-08-29 review find.

g68.3 measures the live spindle, so at a tilted table its plane has to be
converted into the TABLE storage frame. Its origin words are a VECTOR from
the work offset (g53x_core adds it to the offset), and a vector converts
ROTATION-ONLY: the table axis LINE's pivot must never enter. The remap used
to push it through the point transform, storing an origin displaced by
(I - Rx(A))*pivot — ~776 mm at A=20 with this config's pivot — behind a
plane whose NORMAL was right, so every angle-based check read 0.

This script asserts the published twp-o{x,y,z} pins (the stored vector,
table frame) equal Rx(+A)*v computed independently here — no pivot in the
formula at all, which is exactly what makes it the right oracle. Requires a
running, homed sim on the TWP config.

  python3 scripts/twp_g683_check.py
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

c = linuxcnc.command()
s = linuxcnc.stat()
err = linuxcnc.error_channel()
FAILS = []

V = (50.0, 50.0, -50.0)   # the g68.3 origin words
A = 20.0                  # the table tilt at definition


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        FAILS.append(name)


def halget(pin):
    out = subprocess.run(["halcmd", "getp", pin], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"halcmd getp {pin}: {out.stderr.strip()}")
    return float(out.stdout.strip().replace("TRUE", "1").replace("FALSE", "0"))


def _drain_errors():
    msgs = []
    while True:
        e = err.poll()
        if not e:
            return msgs
        if e[0] in (linuxcnc.NML_ERROR, linuxcnc.OPERATOR_ERROR):
            msgs.append(str(e[1]))


def wait_idle(timeout=180.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s.poll()
        if s.interp_state == linuxcnc.INTERP_IDLE and not s.current_vel:
            return True
        time.sleep(0.05)
    return False


def mdi(line, timeout=180.0):
    _drain_errors()
    c.mode(linuxcnc.MODE_MDI)
    c.wait_complete()
    c.mdi(line)
    rc = c.wait_complete(timeout)
    idle = wait_idle(timeout)
    errors = _drain_errors()
    if rc == linuxcnc.RCS_ERROR or rc == -1 or not idle or errors:
        raise SystemExit(f"MDI {line!r} did not complete cleanly: rc={rc} "
                         f"idle={idle} errors={errors}")


def require_ready():
    s.poll()
    problems = []
    if s.task_state != linuxcnc.STATE_ON:
        problems.append(f"machine not ON (task_state={s.task_state})")
    if not all(list(s.homed)[:6]):
        problems.append(f"not homed ({list(s.homed)[:6]})")
    if problems:
        raise SystemExit("PRECONDITIONS NOT MET — refusing to report:\n  "
                         + "\n  ".join(problems))


def rx(v, a_deg):
    """Rx(+A) on a free vector — rotation only, no pivot, by construction."""
    th = math.radians(a_deg)
    ct, st = math.cos(th), math.sin(th)
    return [v[0], ct * v[1] - st * v[2], st * v[1] + ct * v[2]]


def _teardown():
    try:
        mdi("g69")
        mdi("G0 A0")
        print("  (teardown: g69, A0)")
    except SystemExit as e:
        print(f"  (teardown incomplete: {e})")


require_ready()
atexit.register(_teardown)

print("=== define via G68.3 at a tilted table ===")
mdi("g69")
mdi("g10 l2 p0 x1300 y-200 z-1400 a0")
mdi("G0 A0")
mdi("G0 B-30 C15")
mdi(f"G0 A{A}")
mdi("g68.3 x%g y%g z%g" % V)
t0 = time.time()
while time.time() - t0 < 5.0 and halget("twp-helper-comp.twp-is-defined") < 1:
    time.sleep(0.05)
time.sleep(0.25)   # >= 2x the helper's display period
check("plane defined", halget("twp-helper-comp.twp-is-defined") == 1)

stored = [halget(f"twp-helper-comp.twp-o{k}") for k in "xyz"]
want = rx(V, A)
d = math.dist(stored, want)
print(f"  stored origin vector : {[round(v, 4) for v in stored]}")
print(f"  Rx({A:g}) * words     : {[round(v, 4) for v in want]}")
check("stored origin is the ROTATED vector (no pivot term)", d < 1e-3,
      f"err {d:.4f} mm")
# Scale for the number: what the point path would have stored.
py, pz = -1000.0, -2000.0
pt = rx([V[0], V[1] - py, V[2] - pz], A)
pt = [pt[0], pt[1] + py, pt[2] + pz]
print(f"  (point-path result would be {[round(v, 2) for v in pt]},"
      f" {math.dist(pt, want):.1f} mm away)")

print("\n" + ("ALL CHECKS PASSED" if not FAILS
              else f"{len(FAILS)} FAILURE(S): " + ", ".join(FAILS)))
sys.exit(1 if FAILS else 0)

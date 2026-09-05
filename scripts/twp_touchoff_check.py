#!/usr/bin/env python3
"""Live acceptance for touch-off provenance (W1).

THE CLAIM: you can touch off at any table angle. Before this, the work
offset was read as a table-frame point, so it was only true if you touched
off with A at 0 — a precondition stated in three places and checkable in
none, because LinuxCNC records no touch-off pose.

THE TEST is physical, not algebraic. Bolt a part to the table and touch off
one feature; do it again with the table rotated. Both describe the SAME
physical point, so both must produce the SAME stored (table-frame) plane
origin. The second offset is computed here from the rigid-body rotation

    machine(A) = Rx(-A) . (table - pivot) + pivot

which is the kinematics' own definition of the work frame, written out
independently — NOT by calling the transform under test. That is what keeps
this a check rather than a restatement.

Run with the machine homed, armed and out of E-stop.
"""
import json
import os
import math
import atexit
import subprocess
import sys
import time

import linuxcnc

# Table axis line + nutation: read from the RUNNING INI (below), never a
# constant copied from the code under test — a hardcoded pivot here would
# turn the independent oracle into a restatement the moment someone
# "fixed" it by pasting the value from twp_transform.
Y_ROT_AXIS = Z_ROT_AXIS = NUT_ANGLE = None
O_TABLE = [100.0, 50.0, -200.0]      # the physical feature, table frame
TILT = 20.0                           # the second touch-off angle
GATEWAY = "http://127.0.0.1:8000"

c = linuxcnc.command()
s = linuxcnc.stat()
_errch = linuxcnc.error_channel()   # not `err`: section C reuses that name for the angle
FAILS = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        FAILS.append(name)


def halget(pin):
    out = subprocess.run(["halcmd", "getp", pin], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"halcmd getp {pin}: {out.stderr.strip()}")
    return float(out.stdout.strip().replace("TRUE", "1").replace("FALSE", "0"))


def wait_idle(timeout=180.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s.poll()
        if s.interp_state == linuxcnc.INTERP_IDLE and not s.current_vel:
            return True
        time.sleep(0.05)
    return False


def _drain_errors():
    msgs = []
    while True:
        e = _errch.poll()
        if not e:
            return msgs
        kind, text = e
        if kind in (linuxcnc.NML_ERROR, linuxcnc.OPERATOR_ERROR):
            msgs.append(str(text))


def mdi(line, timeout=180.0):
    """Run one MDI line and REFUSE to continue on a rejection or timeout —
    a `G0 A20` rejected at a limit would otherwise run the touch-off at the
    wrong physical pose and report a feature failure."""
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


def read_params(nums, timeout=5.0):
    """Interpreter parameters via RS274's (LOGOPEN)/(LOG)/(LOGCLOSE) — the
    interp expands #-params into a file we own. A (DEBUG,...) message on the
    error channel is the obvious alternative, but the gateway drains that
    NML queue at 30 Hz and usually wins the race for it; a var file is
    written only at save time. The log file has no such reader to lose to."""
    import tempfile
    path = os.path.join(tempfile.gettempdir(), f"twp_touchoff_params_{os.getpid()}.txt")
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


def machine_from_table(p, a_deg):
    """Rigid-body: where a table-fixed point SITS in machine coords at A."""
    th = math.radians(-a_deg)
    ct, st = math.cos(th), math.sin(th)
    y, z = p[1] - Y_ROT_AXIS, p[2] - Z_ROT_AXIS
    return [p[0], y * ct - z * st + Y_ROT_AXIS, y * st + z * ct + Z_ROT_AXIS]


def set_wcs(x, y, z):
    """Touch off G54 through the GATEWAY — the path that stamps provenance."""
    payload = json.dumps({"cmd": "set_wcs", "target": "G54",
                          "x": x, "y": y, "z": z})
    # The gateway venv, not sys.executable: this script runs under the
    # system python (which has the linuxcnc bindings) while the WS client
    # needs `websockets`, which only the venv has.
    r = subprocess.run([os.path.join(GW_DIR, ".venv/bin/python3"),
                        WS_SEND, payload],
                       capture_output=True, text=True, cwd=GW_DIR)
    if r.returncode != 0:
        raise SystemExit(f"set_wcs failed: {r.stderr[:400]}")
    time.sleep(1.5)


WS_SEND = sys.argv[1] if len(sys.argv) > 1 else None
GW_DIR = sys.argv[2] if len(sys.argv) > 2 else None
if not WS_SEND or not GW_DIR or not os.path.isdir(GW_DIR):
    raise SystemExit("usage: twp_touchoff_check.py <ws_send.py> <gateway_dir>")
sys.path.insert(0, GW_DIR)
from gateway_util import parse_kins_config, wcs_prov_params  # noqa: E402

def require_ready():
    """Refuse to run against a machine that cannot execute.

    Learned here: an earlier run of this script executed end to end against
    an E-STOPPED, unhomed machine. Every MDI was silently rejected, the
    plane pins kept values from a previous session, and the report read as
    three failures OF THE FEATURE. A test whose preconditions are unmet must
    say so and stop, never produce findings.
    """
    s.poll()
    problems = []
    if s.task_state != linuxcnc.STATE_ON:
        problems.append(f"machine not ON (task_state={s.task_state})")
    if not all(list(s.homed)[:6]):
        problems.append(f"not homed ({list(s.homed)[:6]})")
    if problems:
        raise SystemExit("PRECONDITIONS NOT MET — refusing to report:\n  "
                         + "\n  ".join(problems))


PLANE = "g68.2 x0 y0 z0 q121 i30 j15"


def establish(a_deg, offset):
    """Table to A, touch off G54 = offset, define the plane, report storage."""
    mdi("g69")
    mdi(f"G0 A{a_deg}")
    set_wcs(*offset)
    s.poll()
    live = [float(v) for v in s.g5x_offset[:3]]
    if any(abs(live[i] - offset[i]) > 1e-3 for i in range(3)):
        raise SystemExit(
            f"set_wcs did not take: asked {[round(v,3) for v in offset]}, "
            f"G54 reads {[round(v,3) for v in live]} — is a client armed?")
    mdi(PLANE)
    # twp-*-world is NOT a direct readback of the remap's stored offset.
    # twp-helper-comp publishes the LIVE g5x_offset while twp-is-defined is
    # false and only switches to the remap's value once it is — and that
    # whole block is throttled to 20 Hz because it is display state. Reading
    # too early returns the raw fixture offset, which at A=0 is identical to
    # the stored value and at A=20 is exactly the wrong answer this test is
    # looking for. So: wait for the flag, then for the throttle.
    t0 = time.time()
    while time.time() - t0 < 5.0:
        if halget("twp-helper-comp.twp-is-defined") == 1:
            break
        time.sleep(0.05)
    else:
        raise SystemExit("g68.2 did not define a plane — cannot read storage")
    time.sleep(0.25)   # >= 2x the helper's 50 ms display period
    return [halget(f"twp-helper-comp.twp-o{k}-world") for k in "xyz"]


require_ready()

s.poll()
_ini = linuxcnc.ini(s.ini_filename)
_k = parse_kins_config(_ini.find("KINS", "KINEMATICS"),
                       _ini.findall("HAL", "HALCMD") or [])["params"]
Y_ROT_AXIS, Z_ROT_AXIS = float(_k["y_rot_axis"]), float(_k["z_rot_axis"])
NUT_ANGLE = float(_k["nut_angle"])

# Capture the operator's G54 and its provenance rows BEFORE touching
# anything, and put them back on every exit path — this check overwrites
# the work offset, and destroying a real setup is the one side effect that
# costs an operator setup time. Restored via plain MDI (G10 + #-params),
# NOT through the gateway, so the original stamp comes back verbatim.
_PROV = wcs_prov_params(1)
_saved_g54 = read_params([5221, 5222, 5223, 5224, 5225, 5226, 5227, 5228, 5229, 5230])
_saved_prov = read_params([_PROV[k] for k in ("stamped", "kins", "a", "x", "y", "z")])


def _teardown():
    try:
        mdi("g69")
        mdi("G0 A0")
        g = _saved_g54
        # Only CONFIGURED axes: the interpreter rejects a G10 that names an
        # axis the machine lacks (U/V/W here) — rc 3, no message text.
        s.poll()
        words = " ".join(f"{L}{g[i]:.6f}" for i, L in enumerate("XYZABCUVW")
                         if s.axis_mask & (1 << i))
        mdi(f"G10 L2 P1 {words} R{g[9]:.6f}")
        mdi(" ".join(f"#{_PROV[k]}={v:.6f}" for k, v in
                     zip(("kins", "a", "x", "y", "z", "stamped"),
                         (_saved_prov[1], _saved_prov[2], _saved_prov[3],
                          _saved_prov[4], _saved_prov[5], _saved_prov[0]))))
        print("  (teardown: g69, A0, G54 + provenance restored)")
    except SystemExit as e:
        print(f"  (teardown incomplete: {e})")


atexit.register(_teardown)

print("=== A: touch off at A=0 (the historical precondition) ===")
o0 = machine_from_table(O_TABLE, 0.0)
store0 = establish(0.0, o0)
print(f"  G54 = {[round(v,4) for v in o0]}")
print(f"  stored (table frame) = {[round(v,4) for v in store0]}")
check("A=0 storage is the offset itself (datum: table == machine at A=0)",
      all(abs(store0[i] - o0[i]) < 1e-3 for i in range(3)))

print(f"\n=== B: SAME physical feature, touched off at A={TILT} ===")
o20 = machine_from_table(O_TABLE, TILT)
print(f"  the feature has moved to machine {[round(v,4) for v in o20]}")
store20 = establish(TILT, o20)
print(f"  stored (table frame) = {[round(v,4) for v in store20]}")

# CONTRACT SINCE 2026-09-01/02 (program zero rides the part; W1's automatic
# conversion of typed values is gone): a TYPED set_wcs is a fixture-frame
# STATEMENT — stored unchanged and stamped table frame (kins 0 / A 0,
# gateway set_wcs pose_override) — while a real TOUCH-OFF at a tilted pose
# stores the live point and stamps THAT A. The old assertion here ("both
# touch-offs store the SAME table-frame origin") certified the removed W1
# behaviour and failed by 723.7 mm on 2026-09-05 — the check, not the product.
check("typed set_wcs at A=20 stores the typed numbers unchanged (a fixture-frame statement)",
      all(abs(store20[i] - o20[i]) < 1e-3 for i in range(3)),
      f"stored {[round(v, 4) for v in store20]} vs typed {[round(v, 4) for v in o20]}")
prov_typed = read_params([_PROV[k] for k in ("stamped", "kins", "a")])
check("…and stamps table frame (stamped, kins 0, A 0) — not the live A=20",
      abs(prov_typed[0] - 1) < 1e-9 and abs(prov_typed[1]) < 1e-9 and abs(prov_typed[2]) < 1e-9,
      f"stamp={prov_typed}")
d_raw = math.dist(store0, store20)
print(f"\n  (the two statements differ by {d_raw:.3f} mm — the same physical feature"
      f" seen from A=0 and from A=20; a touch-off, not a typed value, is what"
      f" carries the pose)")

print("\n=== C: orient at the tilted pose and land on the face ===")
mdi("G53.1")
kins = halget("motion.switchkins-type")
active = halget("twp-helper-comp.twp-is-active")
check("TOOL kins entered", kins == 2)
check("TWP active", active == 1)
n = [halget(f"twp-helper-comp.twp-z{k}") for k in "xyz"]
th = math.radians(-TILT)
ct, st = math.cos(th), math.sin(th)
n_machine = [n[0], n[1] * ct - n[2] * st, n[1] * st + n[2] * ct]
b = math.radians(halget("xyzacb_trsrn_kins.secondary-angle"))
cc = math.radians(halget("xyzacb_trsrn_kins.primary-angle"))
nut = math.radians(NUT_ANGLE)
ax = [0.0, math.sin(nut), math.cos(nut)]
v = [0.0, 0.0, 1.0]
kv = ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2]
kx = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2],
      ax[0] * v[1] - ax[1] * v[0]]
r = [v[i] * math.cos(b) + kx[i] * math.sin(b) + ax[i] * kv * (1 - math.cos(b))
     for i in range(3)]
cz, sz = math.cos(cc), math.sin(cc)
tool = [r[0] * cz - r[1] * sz, r[0] * sz + r[1] * cz, r[2]]
crossx = n_machine[1] * tool[2] - n_machine[2] * tool[1]
crossy = n_machine[2] * tool[0] - n_machine[0] * tool[2]
crossz = n_machine[0] * tool[1] - n_machine[1] * tool[0]
err = math.degrees(math.atan2(
    math.hypot(crossx, crossy, crossz),
    sum(n_machine[i] * tool[i] for i in range(3))))
check("tool normal to the plane after a TILTED touch-off", err < 0.01,
      f"{err:.7f} deg")

print("\n" + ("ALL CHECKS PASSED" if not FAILS
              else f"{len(FAILS)} FAILURE(S): " + ", ".join(FAILS)))
sys.exit(1 if FAILS else 0)

#!/usr/bin/env python3
"""Live acceptance for the TWP re-orient (Wave 2).

Claims under test, each with a way to be wrong:

  1. Re-orient RE-SOLVES the head at the current table pose — B/C move, and
     the tool ends NORMAL to the plane. Measured as the angle between the
     plane's stored normal and the tool axis from the live head solve, via
     atan2(|a x b|, a.b): acos near 1 is catastrophic and produced a
     phantom 0.0118 deg here before.
  2. The stored plane SURVIVES it — twp-ox/oy/oz and the z/x direction pins
     are unchanged across the call. This is the one that used to fail.
  3. The staleness stamp CLEARS — twp-pose-a follows the table.
  4. No JOINT STEP at the kins switch: joint feedback is continuous.
  5. A bare G53.1 while TWP is active still REFUSES — and now leaves the
     plane intact (upstream wiped it via reset_twp_params).
"""
import math
import subprocess
import atexit
import os
import sys
import time

import linuxcnc

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "lcnc-gateway"))
from gateway_util import parse_kins_config  # noqa: E402

c = linuxcnc.command()
s = linuxcnc.stat()
err = linuxcnc.error_channel()


def require_ready():
    """Refuse to run against a machine that cannot execute.

    Backported from twp_touchoff_check.py, where it was learned: a run of
    the sibling script executed end to end against an E-STOPPED, unhomed
    machine — every MDI silently rejected, plane pins holding a previous
    session's values — and reported failures OF THE FEATURE. This script
    predated that lesson and could do the same. A test whose preconditions
    are unmet must say so and stop, never produce findings.
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


def kins_from_running_config():
    """Nutation angle from the RUNNING INI, never a constant copied from the
    code under test (a hardcoded 55 here was documented as 45 — the number
    was right and the comment wrong, which is how such constants drift)."""
    s.poll()
    ini = linuxcnc.ini(s.ini_filename)
    k = parse_kins_config(ini.find("KINS", "KINEMATICS"),
                          ini.findall("HAL", "HALCMD") or [])
    return float(k["params"]["nut_angle"])

PINS = ["twp-helper-comp.twp-is-defined", "twp-helper-comp.twp-is-active",
        "twp-helper-comp.twp-ox", "twp-helper-comp.twp-oy", "twp-helper-comp.twp-oz",
        "twp-helper-comp.twp-zx", "twp-helper-comp.twp-zy", "twp-helper-comp.twp-zz",
        "twp-helper-comp.twp-xx", "twp-helper-comp.twp-xy", "twp-helper-comp.twp-xz",
        "twp-helper-comp.twp-pose-a", "motion.switchkins-type",
        "xyzacb_trsrn_kins.pre-rot", "xyzacb_trsrn_kins.primary-angle",
        "xyzacb_trsrn_kins.secondary-angle"]


def halget(pin):
    out = subprocess.run(["halcmd", "getp", pin], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"halcmd getp {pin} failed: {out.stderr.strip()}")
    return float(out.stdout.strip().replace("TRUE", "1").replace("FALSE", "0"))


def snap():
    return {p: halget(p) for p in PINS}


def poll():
    s.poll()
    return s


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
    """Run one MDI line and REFUSE to continue on a rejection or timeout.

    An MDI that LinuxCNC rejects (wrong mode, limits, interp error) used to
    return normally here, so a "check" could pass or fail on state the
    command never produced. `expect_error=True` is for the one probe whose
    whole point is the refusal (a bare G53.1 while TWP is active)."""
    _drain_errors()
    c.mode(linuxcnc.MODE_MDI)
    c.wait_complete()
    c.mdi(line)
    rc = c.wait_complete(timeout)
    idle = wait_idle(timeout)
    poll()
    errors = _drain_errors()
    if expect_error:
        # The gateway polls the same NML error queue at 30 Hz and usually
        # wins the race for the message text, so the RCS status is the
        # reliable signal that the interpreter rejected the line.
        return errors + (["<RCS_ERROR>"] if rc == linuxcnc.RCS_ERROR else [])
    if rc == linuxcnc.RCS_ERROR or rc == -1 or not idle or errors:
        raise SystemExit(f"MDI {line!r} did not complete cleanly: rc={rc} "
                         f"idle={idle} errors={errors}")
    return errors


def joints():
    poll()
    return [round(v, 6) for v in s.joint_actual_position[:6]]


def angle_between(a, b):
    """Stable angle in degrees. atan2(|axb|, a.b) — NOT acos(a.b), which
    loses all precision near 1 and reported a phantom 0.0118 deg here."""
    cx = a[1] * b[2] - a[2] * b[1]
    cy = a[2] * b[0] - a[0] * b[2]
    cz = a[0] * b[1] - a[1] * b[0]
    return math.degrees(math.atan2(math.hypot(cx, cy, cz),
                                   a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))


def plane_normal_machine(snapshot, a_deg):
    """The stored plane's normal expressed in MACHINE coordinates.

    The twp-z* pins are TABLE-relative — that is the storage that makes the
    plane ride the workpiece — so they are CONSTANT as the table turns and
    comparing them directly against a machine-frame tool axis is valid only
    at A=0. The mapping is taken from the code under test
    (twp_transform.compose_table_a: `th = -radians(d_a)`, rotate about X),
    not fitted to make this pass; it independently reproduces the machine-
    frame normal [0.258819, 0.084186, 0.962250] measured at A=35 earlier.
    """
    n = [snapshot["twp-helper-comp.twp-zx"], snapshot["twp-helper-comp.twp-zy"],
         snapshot["twp-helper-comp.twp-zz"]]
    th = -math.radians(a_deg)
    c, sn = math.cos(th), math.sin(th)
    return [n[0], n[1] * c - n[2] * sn, n[1] * sn + n[2] * c]


def tool_axis_from_head(snapshot):
    """Tool axis in machine coords from the LIVE head solve (B secondary,
    C primary, nutating B at the config's nut-angle). Independent of the
    plane pins, which is what makes the comparison a check and not a
    restatement."""
    b = math.radians(snapshot["xyzacb_trsrn_kins.secondary-angle"])
    cc = math.radians(snapshot["xyzacb_trsrn_kins.primary-angle"])
    nut = math.radians(NUT_ANGLE)
    # Rotate -Z tool vector about the nutating B axis, then about C (Z).
    ax = [0.0, math.sin(nut), math.cos(nut)]
    v = [0.0, 0.0, 1.0]
    k, ct, st = ax, math.cos(b), math.sin(b)
    kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2]
    kx = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]]
    r = [v[i] * ct + kx[i] * st + k[i] * kv * (1 - ct) for i in range(3)]
    cz, sz = math.cos(cc), math.sin(cc)
    return [r[0] * cz - r[1] * sz, r[0] * sz + r[1] * cz, r[2]]


FAILS = []


def check(name, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        FAILS.append(name)


print("=== 0. preconditions ===")
require_ready()
NUT_ANGLE = kins_from_running_config()
poll()


def _teardown():
    """Leave the machine as found: no plane, TOOL kins off, table at A=0.
    Registered atexit so every exit path — pass, fail, SystemExit from a
    rejected MDI — restores it; the next tool (or the next run of this
    script) must not inherit A=35 / TOOL kins / an active plane, which is
    the stale-session trap the decision record documents."""
    try:
        mdi("g69")
        mdi("G0 A0")
        print("  (teardown: g69, A0)")
    except SystemExit as e:
        print(f"  (teardown incomplete: {e})")


atexit.register(_teardown)
print(f"  homed={list(s.homed)[:6]} tool={s.tool_in_spindle} "
      f"pos={[round(v,3) for v in s.actual_position[:6]]}")

# Start from an ABSENT G54 provenance record (W1): a stamp left by a
# previous session — e.g. a fixture edit made under Plane kinematics before
# the 2026-08-30 touch-off gates — makes G68.2 refuse by design, which is
# not what this check is about. Restored by the teardown.
_PROV_STAMPED = 5231
_saved_stamp = None
try:
    import tempfile as _tf
    _pp = os.path.join(_tf.gettempdir(), f"twp_reorient_prov_{os.getpid()}.txt")
    mdi(f"(LOGOPEN,{_pp})"); mdi(f"(LOG,STAMP #{_PROV_STAMPED})"); mdi("(LOGCLOSE)")
    with open(_pp) as _f:
        for _ln in _f:
            if "STAMP" in _ln:
                _saved_stamp = float(_ln.split("STAMP", 1)[1].split()[0])
    os.remove(_pp)
except (OSError, ValueError, IndexError):
    _saved_stamp = None
mdi(f"#{_PROV_STAMPED}=0")
if _saved_stamp is not None:
    atexit.register(lambda: mdi(f"#{_PROV_STAMPED}={_saved_stamp:.6f}"))

print("\n=== 1. define a plane and orient at A=0 ===")
mdi("g69")
mdi("G0 A0")
mdi("g68.2 x50 y50 z-50 q121 i30 j15")
st = snap()
check("plane defined", st["twp-helper-comp.twp-is-defined"] == 1)
mdi("G53.1")
after_orient = snap()
print(f"  B={after_orient['xyzacb_trsrn_kins.secondary-angle']:.5f} "
      f"C={after_orient['xyzacb_trsrn_kins.primary-angle']:.5f} "
      f"kins={after_orient['motion.switchkins-type']:.0f} "
      f"pose_a={after_orient['twp-helper-comp.twp-pose-a']:.3f}")
check("TWP active", after_orient["twp-helper-comp.twp-is-active"] == 1)
check("TOOL kins entered", after_orient["motion.switchkins-type"] == 2)

err0 = angle_between(plane_normal_machine(after_orient, 0.0),
                     tool_axis_from_head(after_orient))
check("tool normal to plane at A=0", err0 < 0.01, f"{err0:.7f} deg")

print("\n=== 2. move the table; the head solve goes stale ===")
mdi("G0 A35")
stale = snap()
print(f"  live A=35  pose_a={stale['twp-helper-comp.twp-pose-a']:.3f}")
check("staleness detectable (pose_a still 0)",
      abs(stale["twp-helper-comp.twp-pose-a"]) < 1e-6)
err_stale = angle_between(plane_normal_machine(stale, 35.0),
                          tool_axis_from_head(stale))
# NOT "about 35 degrees" — that was my first guess and it is wrong. The
# normal rides a CONE about the A axis (X): if it sits phi off that axis,
# a table move of theta separates it from the frozen tool axis by
#   cos(psi) = cos^2(phi) + sin^2(phi) * cos(theta)
# Here phi = 75 deg, so a 35 deg table move gives 33.77 deg, not 35. Assert
# the prediction, which tests the geometry instead of tolerating a fudge.
_n = [stale["twp-helper-comp.twp-zx"], stale["twp-helper-comp.twp-zy"],
      stale["twp-helper-comp.twp-zz"]]
_cosphi = _n[0] / math.hypot(*_n)
_pred = math.degrees(math.acos(
    _cosphi ** 2 + (1 - _cosphi ** 2) * math.cos(math.radians(35.0))))
check("tool is OFF-normal by the predicted cone angle (the defect)",
      abs(err_stale - _pred) < 0.01,
      f"{err_stale:.4f} deg, predicted {_pred:.4f} deg (phi="
      f"{math.degrees(math.acos(_cosphi)):.2f} deg off the A axis)")

print("\n=== 3. a bare G53.1 must REFUSE and must NOT destroy the plane ===")
before_bare = snap()
refusal = mdi("G53.1", expect_error=True)
check("bare G53.1 was refused", bool(refusal), "; ".join(refusal)[:120])
after_bare = snap()
# The wrapper demoted kins to identity before M530, so a status still
# claiming ACTIVE would be a lie; the refusal now demotes it to DEFINED
# (M68 E2 Q1 on the error path — live-verified here, the precedent for
# an M-code before CANON_ERROR was success-path only).
check("refusal left kins at identity", after_bare["motion.switchkins-type"] == 0)
check("refusal demoted status to DEFINED (not active)",
      after_bare["twp-helper-comp.twp-is-defined"] == 1
      and after_bare["twp-helper-comp.twp-is-active"] == 0,
      f"defined={after_bare['twp-helper-comp.twp-is-defined']:.0f} "
      f"active={after_bare['twp-helper-comp.twp-is-active']:.0f}")
# GEOMETRY pins only: the refusal now legitimately demotes twp-is-active
# (kins is identity after the wrapper's M68 E3 Q0, so ACTIVE would be a lie).
plane_keys = [k for k in PINS if k.startswith("twp-helper-comp.twp-")
              and k.split(".")[-1][4:] in ("ox", "oy", "oz", "zx", "zy", "zz",
                                            "xx", "xy", "xz")]
kept = all(abs(before_bare[k] - after_bare[k]) < 1e-9 for k in plane_keys)
check("plane survived the refusal", kept,
      "" if kept else "WIPED: " + ", ".join(
          f"{k.split('.')[-1]} {before_bare[k]:.4f}->{after_bare[k]:.4f}"
          for k in plane_keys if abs(before_bare[k] - after_bare[k]) >= 1e-9))

print("\n=== 4. RE-ORIENT ===")
j_before = joints()
t0 = time.time()
mdi("o<twp_reorient> call")
dt = time.time() - t0
# The pose stamp is written by the remap AFTER the queued moves complete
# (post-yield), behind the helper's 50 ms display period: give it a moment
# rather than reading the previous value.
_t = time.time()
while time.time() - _t < 3.0 and abs(halget("twp-helper-comp.twp-pose-a") - 35.0) > 1e-3:
    time.sleep(0.05)
done = snap()
print(f"  took {dt:.1f}s   B={done['xyzacb_trsrn_kins.secondary-angle']:.5f} "
      f"C={done['xyzacb_trsrn_kins.primary-angle']:.5f} "
      f"kins={done['motion.switchkins-type']:.0f} "
      f"pose_a={done['twp-helper-comp.twp-pose-a']:.3f}")
check("staleness cleared (pose_a -> 35)",
      abs(done["twp-helper-comp.twp-pose-a"] - 35.0) < 1e-3)
check("still in TOOL kins", done["motion.switchkins-type"] == 2)
check("TWP still active", done["twp-helper-comp.twp-is-active"] == 1)
check("head actually moved",
      abs(done["xyzacb_trsrn_kins.secondary-angle"]
          - stale["xyzacb_trsrn_kins.secondary-angle"]) > 1e-3
      or abs(done["xyzacb_trsrn_kins.primary-angle"]
             - stale["xyzacb_trsrn_kins.primary-angle"]) > 1e-3)

err1 = angle_between(plane_normal_machine(done, 35.0),
                     tool_axis_from_head(done))
check("tool normal to plane again", err1 < 0.01, f"{err1:.7f} deg")

plane_kept = all(abs(after_orient[k] - done[k]) < 1e-6 for k in plane_keys)
check("stored plane unchanged by the re-orient", plane_kept)

j_after = joints()
print(f"\n  joints before : {j_before}")
print(f"  joints after  : {j_after}")
# The kins switch is a RELABEL: it must move nothing by itself. Only the
# two rotaries the solve commands may change; X/Y/Z and the A table must be
# bit-identical across the whole call. A step here would be the failure
# mode remap.py warns about (the kins comp reads its frame pins every servo
# cycle with no interpolation), and it is the reason the safe ordering
# exists — identity kins, write pins inert, move rotaries, enter TOOL.
for i, name in ((0, "X"), (1, "Y"), (2, "Z"), (3, "A")):
    check(f"no joint step on {name} across the re-orient",
          abs(j_after[i] - j_before[i]) < 1e-6,
          f"{j_before[i]} -> {j_after[i]}")

print("\n" + ("ALL CHECKS PASSED" if not FAILS
              else f"{len(FAILS)} FAILURE(S): " + ", ".join(FAILS)))
sys.exit(1 if FAILS else 0)

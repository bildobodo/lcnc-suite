#!/usr/bin/env python3
"""Live acceptance for touch-off under kinematics modes (2026-08-30).

What it proves, on the TWP sim (homed, armed, machine on):

  A. A rotary offset in the reserved fixture (the live poison: Zero All
     under the Plane jog frame wrote A/B/C into G59) no longer displaces the
     orient — g53x_core moves the head in MACHINE coordinates (G53) and
     rewrites G59..G59.3 completely (A0 B0 C0 R0): after G53.1 the tool is
     normal to the plane and the rows read zero.
  B. A G54 rotary offset (identity-mode rotary touch-off is allowed) still
     cannot displace the orient: joints B/C land on the solved angles the
     kins pins hold.
  C. Plane-mode touch-off (o<twp_touchoff>, the gateway's Plane route) sets
     the WORKPIECE datum through the plane: the DRO reads the entered value
     at once, a Re-orient recomputes the SAME G59 rows from G54 (the round
     trip — the datum lives in G54), G54's provenance rows are stamped
     table-frame (kins 0 / A 0), and the helper's world pins follow G54.
     Repeated at A=35 (the table-frame map at a live table angle).
  D. The fixture rides the kins mode: M428 leaves G59 for G54, M430
     selects G59.

Pattern: twp_reorient_check.py (mdi/snap/check) + twp_touchoff_check.py
(read_params via LOGOPEN, row-restoring teardown). Refuses to report on a
machine that cannot execute. Run with the suite live (the gateway drains
the NML error queue; the RCS status is the reliable rejection signal).
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
        "twp-helper-comp.twp-pose-a", "motion.switchkins-type",
        "xyzacb_trsrn_kins.pre-rot", "xyzacb_trsrn_kins.primary-angle",
        "xyzacb_trsrn_kins.secondary-angle"]


def halget(pin):
    out = subprocess.run(["halcmd", "getp", pin], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"halcmd getp {pin}: {out.stderr.strip()}")
    return float(out.stdout.strip().replace("TRUE", "1").replace("FALSE", "0"))


def snap():
    return {p: halget(p) for p in PINS}


def halget_moved(pin, prev, timeout=1.0):
    """The pin's value once it differs from `prev` (the helper copies the seq
    out pin LAST in its 20 Hz pass — a read straight after the MDI can
    precede it), or the unchanged value after `timeout`."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        v = halget(pin)
        if abs(v - prev) > 1e-9:
            return v
        time.sleep(0.02)
    return halget(pin)


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
    path = os.path.join(tempfile.gettempdir(), f"twp_plane_touchoff_params_{os.getpid()}.txt")
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


def joints_bc():
    poll()
    return s.joint_actual_position[4], s.joint_actual_position[5]


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
      f"G59 rotary rows A/B/C={[round(v, 3) for v in _saved_g59[3:6]]} "
      f"G54 prov stamped={_saved_prov[0]:.0f} kins={_saved_prov[1]:.0f} a={_saved_prov[2]:.3f}")
# Start from an ABSENT G54 provenance record: a stamp left by a previous
# session (e.g. a table edit made under Plane kinematics) makes G68.2 refuse
# by design (W1: "touched off under non-identity kinematics"), which is not
# what this check is about. The teardown puts the original stamp back.
mdi(f"#{_PROV['stamped']}=0")


def _teardown():
    try:
        mdi("g69")
        mdi("G0 A0")
        poll()
        words = lambda g: " ".join(f"{L}{g[i]:.6f}" for i, L in enumerate("XYZABCUVW")
                                   if s.axis_mask & (1 << i))
        mdi(f"G10 L2 P1 {words(_saved_g54)} R{_saved_g54[9]:.6f}")
        # The reserved rows go back as they were EXCEPT the rotary/R poison,
        # which the orient clears by design — restoring it would re-plant it.
        g = list(_saved_g59)
        g[3] = g[4] = g[5] = g[9] = 0.0
        mdi(f"G10 L2 P6 {words(g)} R0")
        mdi(" ".join(f"#{_PROV[k]}={v:.6f}" for k, v in
                     zip(("kins", "a", "x", "y", "z", "stamped"),
                         (_saved_prov[1], _saved_prov[2], _saved_prov[3],
                          _saved_prov[4], _saved_prov[5], _saved_prov[0]))))
        print("  (teardown: g69, A0, G54 + G59 + provenance restored)")
    except SystemExit as e:
        print(f"  (teardown incomplete: {e})")


atexit.register(_teardown)

print("\n=== A. foreign rotary offset in G59 must not displace the orient ===")
mdi("g69")
mdi("G0 A0")
mdi("G10 L2 P1 X0 Y0 Z0 A0 B0 C0 R0")
mdi("G10 L2 P6 B5 C-7 R3")           # the poison (rotary + rotation rows)
mdi("g68.2 x50 y50 z-50 q121 i30 j15")
mdi("G53.1")
st = snap()
check("TWP active + TOOL kins", st["twp-helper-comp.twp-is-active"] == 1
      and st["motion.switchkins-type"] == 2)
errA = angle_between(plane_normal_machine(st, 0.0), tool_axis_from_head(st))
check("tool normal to plane despite the G59 poison", errA < 0.01, f"{errA:.7f} deg")
rows = read_params([5324, 5325, 5326, 5330])
check("G59 A/B/C/R cleared by the orient", all(abs(v) < 1e-6 for v in rows),
      f"{rows}")
bj, cj = joints_bc()
check("joints B/C on the solved angles",
      abs(bj - st["xyzacb_trsrn_kins.secondary-angle"]) < 1e-3
      and abs(cj - st["xyzacb_trsrn_kins.primary-angle"]) < 1e-3,
      f"B {bj:.4f} vs {st['xyzacb_trsrn_kins.secondary-angle']:.4f}, "
      f"C {cj:.4f} vs {st['xyzacb_trsrn_kins.primary-angle']:.4f}")

print("\n=== B. a G54 rotary offset cannot displace the orient (G53 move) ===")
mdi("g69")
mdi("G0 A0 B0 C0")
mdi("g68.2 x50 y50 z-50 q121 i30 j15")
mdi("G10 L2 P1 B5 C-7")               # allowed (identity + G54) — after definition
mdi("G53.1")
st = snap()
bj, cj = joints_bc()
check("joints B/C on the solved angles with G54 B5 C-7",
      abs(bj - st["xyzacb_trsrn_kins.secondary-angle"]) < 1e-3
      and abs(cj - st["xyzacb_trsrn_kins.primary-angle"]) < 1e-3,
      f"B {bj:.4f} vs {st['xyzacb_trsrn_kins.secondary-angle']:.4f}, "
      f"C {cj:.4f} vs {st['xyzacb_trsrn_kins.primary-angle']:.4f}")
errB = angle_between(plane_normal_machine(st, 0.0), tool_axis_from_head(st))
check("tool normal to plane with a G54 rotary offset", errB < 0.01, f"{errB:.7f} deg")
mdi("g69")
mdi("G10 L2 P1 B0 C0")
r = mdi("g68.2 x50 y50 z-50 q121 i30 j15", expect_error=False)
mdi("G10 L2 P1 B5")
errs = mdi("G53.1", expect_error=True)
# (definition with a rotary offset is refused by the remap — pinned here
#  through the G68.2 path, which reads the same rotary_offsets_nonzero)
mdi("g69")
mdi("G10 L2 P1 B0")
errs2 = mdi("g68.2 x50 y50 z-50 q121 i30 j15", expect_error=True)
check("definition on a clean G54 accepted", not errs2, f"{errs2}")
mdi("g69")
mdi("G10 L2 P1 B5")
errs3 = mdi("g68.2 x50 y50 z-50 q121 i30 j15", expect_error=True)
check("definition refused while G54 carries a rotary offset", bool(errs3), f"{errs3}")
mdi("G10 L2 P1 B0")


def plane_touchoff_roundtrip(label, a_deg, z_value):
    poll()
    check(f"{label}: G59 active under TOOL kins", s.g5x_index == 6
          and halget("motion.switchkins-type") == 2)
    before = dro()
    g54_before = read_params([5221, 5222, 5223])
    seq_before = halget("twp-helper-comp.twp-datum-seq")
    mdi(f"o<twp_touchoff> call [4] [0] [0] [{z_value}]")
    after = dro()
    # Datum-write epoch (2026-09-05): M535 bumps it exactly once, after the
    # datum pins — the gateway's settle keys on it instead of on the value.
    seq_after = halget_moved("twp-helper-comp.twp-datum-seq", seq_before)
    check(f"{label}: twp-datum-seq +1 per M535", abs(seq_after - seq_before - 1) < 1e-9,
          f"{seq_before:.0f} → {seq_after:.0f}")
    check(f"{label}: DRO Z reads the entered value", abs(after[2] - z_value) < 1e-3,
          f"{after[2]:.4f} (was {before[2]:.4f})")
    check(f"{label}: DRO X/Y untouched", abs(after[0] - before[0]) < 1e-3
          and abs(after[1] - before[1]) < 1e-3)
    g59_after = read_params([5321, 5322, 5323])
    g54_after = read_params([5221, 5222, 5223])
    delta = [g54_after[i] - g54_before[i] for i in range(3)]
    mag = math.sqrt(sum(d * d for d in delta))
    exp = abs(before[2] - z_value)
    check(f"{label}: G54 moved by the touch-off amount", abs(mag - exp) < 1e-3,
          f"|dG54|={mag:.4f} expected {exp:.4f}")
    stt = snap()
    n_tab = [stt["twp-helper-comp.twp-zx"], stt["twp-helper-comp.twp-zy"],
             stt["twp-helper-comp.twp-zz"]]
    along = abs(sum(d * n for d, n in zip(delta, n_tab)))
    check(f"{label}: G54 moved ALONG the plane normal (table frame)",
          abs(along - mag) < 1e-3, f"along={along:.4f} |d|={mag:.4f}")
    check(f"{label}: helper world pins follow G54",
          all(abs(stt[f"twp-helper-comp.twp-o{ax}-world"] - g54_after[i]) < 1e-4
              for i, ax in enumerate("xyz")))
    prov = read_params(_PROV_ROWS)
    check(f"{label}: G54 provenance stamped table-frame (kins 0, A 0, xyz)",
          abs(prov[0] - 1.0) < 1e-9 and abs(prov[1]) < 1e-9 and abs(prov[2]) < 1e-9
          and all(abs(prov[3 + i] - g54_after[i]) < 1e-4 for i in range(3)),
          f"{[round(v, 4) for v in prov]}")
    mdi("o<twp_reorient> call")
    rt = dro()
    g59_rt = read_params([5321, 5322, 5323])
    check(f"{label}: Re-orient keeps the DRO (round trip through G54)",
          abs(rt[2] - z_value) < 1e-3, f"{rt[2]:.4f}")
    check(f"{label}: Re-orient recomputes the SAME G59 rows",
          all(abs(g59_rt[i] - g59_after[i]) < 1e-3 for i in range(3)),
          f"{[round(v, 4) for v in g59_rt]} vs {[round(v, 4) for v in g59_after]}")
    errN = angle_between(plane_normal_machine(rt_snap := snap(), a_deg),
                         tool_axis_from_head(rt_snap))
    check(f"{label}: tool normal after re-orient", errN < 0.01, f"{errN:.7f} deg")


print("\n=== C. Plane-mode touch-off writes G54 through the plane ===")
mdi("g69")
mdi("G0 A0")
mdi("G10 L2 P1 X0 Y0 Z0 A0 B0 C0 R0")
mdi("g68.2 x50 y50 z-50 q121 i30 j15")
mdi("G53.1")
plane_touchoff_roundtrip("A=0", 0.0, 12.5)
mdi("G0 A35")
mdi("o<twp_reorient> call")
plane_touchoff_roundtrip("A=35", 35.0, -3.25)
errs = mdi("o<twp_touchoff> call [0] [0] [0] [0]", expect_error=True)
check("touch-off with an empty mask refused", bool(errs), f"{errs}")

print("\n=== D. the fixture rides the kins mode ===")
mdi("M428")
poll()
check("M428 leaves G59 for G54", s.g5x_index == 1 and halget("motion.switchkins-type") == 0)
mdi("M430")
poll()
check("M430 selects G59", s.g5x_index == 6 and halget("motion.switchkins-type") == 2)
mdi("M428")
mdi("G55")
mdi("M429")
poll()
check("M429 keeps an operator fixture (G55)", s.g5x_index == 2)
mdi("M428")
mdi("G54")
mdi("g69")
poll()
check("G69 restores G54 on identity kins", s.g5x_index == 1
      and halget("motion.switchkins-type") == 0)

print(f"\n=== {'ALL PASS' if not FAILS else str(len(FAILS)) + ' FAIL: ' + ', '.join(FAILS)} ===")
sys.exit(1 if FAILS else 0)

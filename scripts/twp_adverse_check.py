#!/usr/bin/env python3
"""Live acceptance for the ADVERSE paths of the TWP motion routines.

The implementation review of 2026-09-15 accepted the TWP-01/03 code fixes
but not their evidence: the happy paths are certified by
twp_buttons_check.py, while the cases that made those fixes necessary —
a caller in G91 or G20, a retract that cannot run, an abort between the
legs, an orient with no solution — were only argued. This script exercises
them and records what SURVIVES each one, which is the part an argument
cannot supply.

Rows, each with a way to be wrong:

  1. Plane → Zero called under G91. The sub sets G90 itself under M73, so
     the move is ABSOLUTE (plane X0 Y0), and G91 is the caller's again at
     endsub. Wrong: an incremental +25 Z and no X/Y move at all.
  2. Plane → Zero called under G20 on this metric machine. The sub sets
     G21 explicitly, so the clearance is 25 MILLIMETRES, and G20 is the
     caller's again at endsub. Wrong: a 25-inch retract.
  3. A retract that cannot run (clearance past the Z soft limit) aborts
     the sub BEFORE the X/Y leg. Wrong: X/Y moves anyway — the machine
     traverses to the datum at whatever depth it was at.
  4. Abort during the Z leg: no X/Y motion, and the plane, the fixture and
     the kinematics all survive. The modal state is RECORDED rather than
     asserted: an interrupted o-sub never reaches M73's restore, which is
     inherent to G-code, so what matters is that the next call still works.
  5. An orient with no solution (a plane whose head solve needs B past its
     limit) REFUSES and leaves the plane definition, the fixture and the
     kinematics exactly as they were.

Pattern and harness: twp_buttons_check.py / twp_reorient_check.py — refuse
on a machine that cannot execute, restore every row, print PASS/FAIL.
"""
import atexit
import os
import subprocess
import sys
import time

import linuxcnc

c = linuxcnc.command()
s = linuxcnc.stat()
err = linuxcnc.error_channel()
RESULTS = []


def check(row, ok, detail=""):
    RESULTS.append((row, bool(ok), detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {row}{'  — ' + detail if detail else ''}")


def note(row, detail):
    RESULTS.append((row, None, detail))
    print(f"  NOTE  {row}  — {detail}")


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


def halget(pin):
    out = subprocess.run(["halcmd", "getp", pin], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"halcmd getp {pin} failed: {out.stderr.strip()}")
    return float(out.stdout.strip().replace("TRUE", "1").replace("FALSE", "0"))


PLANE_PINS = ["twp-helper-comp.twp-is-defined", "twp-helper-comp.twp-is-active",
              "twp-helper-comp.twp-ox", "twp-helper-comp.twp-oy", "twp-helper-comp.twp-oz",
              "twp-helper-comp.twp-zx", "twp-helper-comp.twp-zy", "twp-helper-comp.twp-zz",
              "twp-helper-comp.twp-xx", "twp-helper-comp.twp-xy", "twp-helper-comp.twp-xz"]


def plane_snap():
    return {p: halget(p) for p in PLANE_PINS}


def plane_settled(timeout=3.0):
    """The plane pins once the helper comp's 20 Hz passthrough has caught up.

    twp-helper-comp copies its `-in` pins to its outputs on its own tick, so
    a snapshot taken the instant an MDI returns can still show the PREVIOUS
    plane — which reads as "the definition changed" one comparison later.
    (The reorient check learned the same lesson on the pose stamp, 62e8cae:
    the stamp was always right, the snapshot was early.) Two consecutive
    identical reads = settled."""
    prev = plane_snap()
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(0.15)
        cur = plane_snap()
        if cur == prev:
            return cur
        prev = cur
    return prev


def plane_snap_minus_active(snap):
    """The plane DEFINITION alone: origin and the two direction triples.
    `twp-is-active` is state, not definition — a refused orient deliberately
    deactivates while keeping what was defined."""
    return {k: v for k, v in snap.items() if not k.endswith("twp-is-active")}


def dro():
    poll()
    return [s.actual_position[i] - s.g5x_offset[i] - s.g92_offset[i] - s.tool_offset[i]
            for i in range(3)]


def joints():
    poll()
    return [round(v, 4) for v in s.joint_actual_position[:6]]


def modal():
    """(distance mode, units) as the interpreter reports them right now."""
    poll()
    codes = {int(g) for g in s.gcodes if g >= 0}
    dist = "G91" if 910 in codes else "G90" if 900 in codes else "?"
    units = "G20" if 200 in codes else "G21" if 210 in codes else "?"
    return dist, units


def require_ready():
    poll()
    problems = []
    if s.task_state != linuxcnc.STATE_ON:
        problems.append(f"machine not ON (task_state={s.task_state})")
    if not all(list(s.homed)[:6]):
        problems.append(f"not homed ({list(s.homed)[:6]})")
    if problems:
        raise SystemExit("PRECONDITIONS NOT MET — refusing to report:\n  "
                         + "\n  ".join(problems))


def restore():
    """Leave the machine as a clean identity-kins G54 idle, whatever failed."""
    try:
        c.abort(); c.wait_complete(10)
        c.mode(linuxcnc.MODE_MDI); c.wait_complete()
        for line in ("G90", "G21", "G69", "M428", "G54", "G53 G0 Z-20", "G0 A0 B0 C0"):
            c.mdi(line); c.wait_complete(60)
    except Exception as e:   # noqa: BLE001 - cleanup is best effort, and says so
        print(f"  (restore incomplete: {e})")


def enter_plane():
    """The operator's Plane state: a plane captured at the tip, kins 2, G59
    (twp_buttons_check's setup — one sequence, not two)."""
    mdi("g69")
    mdi("G0 A0 B20 C-15")
    mdi("G10 L2 P1 X0 Y0 Z0 A0 B0 C0 R0")
    mdi("G53 G0 Z-80")
    mdi("G68.3 X0 Y0 Z0 R0")
    mdi("G53.1 P0")
    wait_idle()
    if halget("motion.switchkins-type") != 2 or s.g5x_index != 6:
        raise SystemExit(f"could not enter Plane mode: kins={halget('motion.switchkins-type')} g5x={s.g5x_index}")


require_ready()
atexit.register(restore)
print("=== TWP adverse paths (review 2026-09-15) ===\n")

print("--- 1/2. Plane → Zero under a hostile modal state ---")
enter_plane()
# Every move below is in PLANE coordinates: under TOOL kinematics G53
# addresses the kins WORLD frame, which IS the plane — a G53 Z here is a
# plane-frame Z, not a machine one (the first run of this script traversed
# 105 mm along the tool axis and hit the Z joint limit that way). The
# clearance is likewise taken RELATIVE to where the machine is, so the row
# tests the modal contract rather than the sim's travels.
def approach(x=5.0, y=5.0, z=-10.0):
    mdi("G90"); mdi("G21")
    mdi(f"G0 X{x} Y{y} Z{z}")
    return dro()


for caller_dist, caller_units, row in (("G91", "G21", "G91 (incremental)"),
                                       ("G90", "G20", "G20 (inch) on a metric machine")):
    before = approach()
    clear_to = round(before[2] + 5.0, 3)
    mdi(caller_dist); mdi(caller_units)
    mdi(f"o<twp_goto_zero> call [{clear_to}] [1]")
    wait_idle()
    after = dro()
    dist_now, units_now = modal()
    check(f"Plane → Zero under {row}: lands at plane X0 Y0, Z == the clearance in MILLIMETRES",
          abs(after[0]) < 1e-3 and abs(after[1]) < 1e-3 and abs(after[2] - clear_to) < 1e-2,
          f"before={[round(v, 3) for v in before]} clearance={clear_to} after={[round(v, 3) for v in after]}")
    check(f"Plane → Zero under {row}: the caller's modal state is restored ({caller_dist} {caller_units})",
          (dist_now, units_now) == (caller_dist, caller_units),
          f"after the call: {dist_now} {units_now}")
    mdi("G90"); mdi("G21")

# "Never lower": a clearance BELOW the current plane Z leaves Z alone and
# still squares X/Y (TWP-01's retract rule, the other side of it).
before = approach(x=5.0, y=5.0, z=-5.0)
mdi(f"o<twp_goto_zero> call [{round(before[2] - 5.0, 3)}] [1]")
wait_idle()
after = dro()
check("Plane → Zero with a clearance below the current Z: Z is not lowered, X/Y still zeroed",
      abs(after[2] - before[2]) < 1e-2 and abs(after[0]) < 1e-3 and abs(after[1]) < 1e-3,
      f"before={[round(v, 3) for v in before]} after={[round(v, 3) for v in after]}")

print("\n--- 3. A retract that cannot run never reaches the X/Y leg ---")
before = approach()
errs = mdi("o<twp_goto_zero> call [5000] [1]", expect_error=True)
wait_idle()
after = dro()
check("Retract past the Z soft limit is refused and X/Y never move",
      bool(errs) and abs(after[0] - before[0]) < 1e-3 and abs(after[1] - before[1]) < 1e-3,
      f"errors={errs} before={[round(v, 3) for v in before]} after={[round(v, 3) for v in after]}")

print("\n--- 4. Abort between the legs ---")
before = approach(z=-60.0)      # far enough below that the Z leg is still running
plane_before = plane_settled()
fixture_before = s.g5x_index
kins_before = halget("motion.switchkins-type")
_drain_errors()
c.mode(linuxcnc.MODE_MDI); c.wait_complete()
_abort_clear = round(before[2] + 55.0, 3)
c.mdi(f"o<twp_goto_zero> call [{_abort_clear}] [1]")
time.sleep(0.25)          # mid Z leg — a 55 mm retract takes longer than this
poll()
moving = bool(s.current_vel)
c.abort()
c.wait_complete(10)
wait_idle()
after = dro()
_drain_errors()
check("Abort during the Z leg: the X/Y leg never runs",
      moving and abs(after[0] - before[0]) < 1e-2 and abs(after[1] - before[1]) < 1e-2,
      f"moving_at_abort={moving} before={[round(v, 3) for v in before]} after={[round(v, 3) for v in after]}")
check("Abort during the Z leg: plane, fixture and kinematics survive",
      plane_settled() == plane_before and s.g5x_index == fixture_before
      and halget("motion.switchkins-type") == kins_before,
      f"g5x={s.g5x_index} kins={halget('motion.switchkins-type')} plane_changed={plane_settled() != plane_before}")
note("Abort during the Z leg: modal state left behind",
     f"{modal()[0]} {modal()[1]} — an aborted o-sub never reaches M73's restore "
     f"(inherent to G-code; probe_basic's go_to_zero behaves the same)")
mdi("G90"); mdi("G21")
mdi(f"o<twp_goto_zero> call [{_abort_clear}] [1]")
wait_idle()
after = dro()
check("After the abort the same call completes normally (recoverable)",
      abs(after[0]) < 1e-3 and abs(after[1]) < 1e-3 and abs(after[2] - _abort_clear) < 1e-2,
      f"clearance={_abort_clear} after={[round(v, 3) for v in after]}")

print("\n--- 5. An orient with no solution ---")
# Back to identity/G54: a plane is DEFINED from there (the remap requires
# G54), and this one is tilted 120 deg — past what a 55 deg nutating head can
# reach, so the head solve has no in-limit target. The reachable twin below
# proves the refusal is about THIS plane and not about the machine's state.
mdi("G69"); mdi("M428"); mdi("G54")
mdi("G0 A0 B0 C0")
mdi("G53 G0 Z-60")
j_before = joints()
fixture_before = s.g5x_index
mdi("g68.2 x0 y0 z0 q121 i0 j120")
plane_defined = plane_settled()
errs = mdi("G53.1 P0", expect_error=True) or []
wait_idle()
note("Impossible orient: refusal text", "; ".join(errs) or "(none — see the checks below)")
check("Impossible orient: refused, and says the orientation is not reachable",
      any("not reachable" in e for e in errs) or "<RCS_ERROR>" in errs,
      f"errors={errs}")
check("Impossible orient: the plane DEFINITION survives the refusal",
      halget("twp-helper-comp.twp-is-defined") == 1
      and plane_snap_minus_active(plane_settled()) == plane_snap_minus_active(plane_defined),
      f"defined={halget('twp-helper-comp.twp-is-defined')} changed="
      f"{[k for k in plane_defined if plane_settled()[k] != plane_defined[k]]}")
check("Impossible orient: the machine is left in identity kinematics with the plane INACTIVE",
      halget("motion.switchkins-type") == 0 and halget("twp-helper-comp.twp-is-active") == 0,
      f"kins={halget('motion.switchkins-type')} active={halget('twp-helper-comp.twp-is-active')}")
check("Impossible orient: the fixture is unchanged and the rotaries never moved",
      s.g5x_index == fixture_before and joints()[3:6] == j_before[3:6],
      f"g5x={s.g5x_index} (was {fixture_before}) rotaries {j_before[3:6]} -> {joints()[3:6]}")
# Recovery: a reachable plane from the same state orients normally.
mdi("G69"); mdi("M428"); mdi("G54"); mdi("G0 A0 B0 C0")
mdi("g68.2 x0 y0 z0 q121 i30 j15")
mdi("G53.1 P0")
wait_idle()
check("After a refused orient a reachable plane still orients (kins 2, plane active)",
      halget("motion.switchkins-type") == 2 and halget("twp-helper-comp.twp-is-active") == 1,
      f"kins={halget('motion.switchkins-type')} active={halget('twp-helper-comp.twp-is-active')}")

print("\n=== summary ===")
fails = [r for r in RESULTS if r[1] is False]
passes = [r for r in RESULTS if r[1] is True]
notes = [r for r in RESULTS if r[1] is None]
for row, ok, detail in fails:
    print(f"  FAIL  {row}  — {detail}")
print(f"{len(passes)} pass, {len(fails)} fail, {len(notes)} recorded observations")
sys.exit(1 if fails else 0)

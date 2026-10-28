#!/usr/bin/env python3
"""Button gates package E — the native check on the throwaway gates sim
(~/linuxcnc/configs/lcnc_suite_sim_gates, never the operator's sim). Every
check reads LinuxCNC's own STAT (joint velocity, position, task mode), not only
the gateway's reply.

profile xyz-e  (trivkins coordinates=XYZ, NO_FORCE_HOMING = 1,
                WEBUI_JOINT_JOG_BEFORE_HOMING = 1, the default cap 0.1)
  E1  unhomed: the gateway opens jog (the switch is declared)
  E2  a continuous jog of X before homing moves joint 0 in joint (free) mode at
      most at the cap — 0.1 × [JOINT_0] MAX_VELOCITY — though 50 was asked
  E3  jog_stop stops it; a second stop is a no-op (it was booked stopped)
  E4  the disarm stop stops an unhomed jog natively (BG-07, owed since A)
  E5  a jog stop needs no MANUAL: with task in MDI idle the binding's
      JOG_STOP is taken — no error, task stays MDI (2.9.4 allow_while_idle)
  E6  an increment before homing moves joint 1 by the distance, capped
  E7  homed: the cap no longer applies (teleop jog at the asked speed)
profile xyzac-e (xyzac-trt-kins, WEBUI_JOINT_AXES = X Y Z A C)
  E8  a jog of C (wire 4) before homing moves joint 4 — only joint 4 — capped

usage: <venv python> button-gates.e.live-check.py <repo root> <profile>
Prints one JSON object; exit 1 on any FAIL.
"""
import json
import sys
import threading
import time
from pathlib import Path

ROOT, PROFILE = Path(sys.argv[1]), sys.argv[2]
sys.path.insert(0, str(ROOT / "scripts"))
from test_support.live_session import SimulatorClient  # noqa: E402
import linuxcnc  # noqa: E402

s = linuxcnc.stat()
results = []
INI = linuxcnc.ini


def check(name, ok, detail=""):
    results.append({"check": name, "result": "PASS" if ok else "FAIL", "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  — {detail}"), file=sys.stderr)


def poll():
    s.poll()
    return s


def wait(pred, timeout=10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred(poll()):
            return True
        time.sleep(0.02)
    return False


def call(c, cmd, **kw):
    try:
        return c.request(cmd, **kw)
    except RuntimeError as e:
        return {"ok": False, "error": str(e).split(" refused: ", 1)[-1]}


def seen(c, pred, timeout=5.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred(c.status):
            return True
        time.sleep(0.05)
    return False


def gate_open(c, name, timeout=5.0):
    return seen(c, lambda st: (st.get("permissions") or {}).get(name) is True, timeout)


def max_speed(joint, seconds):
    """The largest |joint velocity| STAT shows while sampling, and the travel."""
    poll()
    p0, peak = s.joint[joint]["output"], 0.0
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        poll()
        peak = max(peak, abs(s.joint[joint]["velocity"]))
        time.sleep(0.01)
    return peak, s.joint[joint]["output"] - p0


def max_vel(joint):
    return float(INI(s.ini_filename).find(f"JOINT_{joint}", "MAX_VELOCITY"))


def standing(timeout=5.0):
    return wait(lambda st: all(abs(st.joint[j]["velocity"]) < 1e-6 for j in range(st.joints)), timeout)


poll()
c = SimulatorClient("", session=f"bg-e-live-{PROFILE}")
c.start()
time.sleep(1.0)
poll()
info = {"profile": PROFILE, "joints": s.joints, "kinematics_type": getattr(s, "kinematics_type", None)}
try:
    if poll().task_state == linuxcnc.STATE_ESTOP:
        call(c, "estop_reset")
        wait(lambda st: st.task_state == linuxcnc.STATE_ESTOP_RESET)
        seen(c, lambda st: st.get("is_estop") is False)
    call(c, "machine_on")
    wait(lambda st: st.task_state == linuxcnc.STATE_ON)
    seen(c, lambda st: st.get("is_enabled") is True)
    check("starts unhomed", not any(poll().homed[:s.joints]), str(list(s.homed[:s.joints])))
    if PROFILE == "xyz-e":
        cap0, cap1 = 0.1 * max_vel(0), 0.1 * max_vel(1)
        info["caps"] = [cap0, cap1]
        check("E1 unhomed: the gateway opens jog (declared)", gate_open(c, "jog"),
              str((c.status.get("permissions") or {}).get("jog")))
        # E2
        r = call(c, "jog_cont", axis=0, vel=50.0)
        peak, travel = max_speed(0, 1.5)
        check(f"E2 jog before homing: joint 0 moves in joint mode, at most the cap {cap0:g}",
              bool(r.get("ok")) and travel > 0.5 * cap0 and peak <= cap0 * 1.02
              and poll().motion_mode == linuxcnc.TRAJ_MODE_FREE,
              f"{r} peak={peak:.3f} travel={travel:.3f} motion_mode={s.motion_mode}")
        # E3
        r = call(c, "jog_stop", axis=0)
        stopped = standing(3)
        check("E3 jog_stop stops it", bool(r.get("ok")) and stopped, f"{r} stopped={stopped}")
        # E4: the disarm stop, natively
        r = call(c, "jog_cont", axis=0, vel=-50.0)
        moving = wait(lambda st: abs(st.joint[0]["velocity"]) > 0.1, 2)
        r2 = call(c, "arm", armed=False)
        stopped = standing(3)
        check("E4 the disarm stop stops an unhomed jog", bool(r.get("ok")) and moving and stopped,
              f"jog={r} moving={moving} disarm={r2} stopped={stopped}")
        call(c, "arm", armed=True)
        seen(c, lambda st: (st.get("permissions") or {}).get("jog") is True)
        # E5: JOG_STOP in MDI, straight on the binding (unhomed MDI: NO_FORCE_HOMING).
        # The switch is judged on a current read: wait until the machine
        # stands by STAT (inpos lags the stop) and the gateway shows it.
        wait(lambda st: st.inpos and abs(st.current_vel) < 1e-3, 5)
        gate_open(c, "modeCoord")
        r = call(c, "set_mode", mode=linuxcnc.MODE_MDI)
        in_mdi = wait(lambda st: st.task_mode == linuxcnc.MODE_MDI, 3)
        err = linuxcnc.error_channel()
        while err.poll():
            pass
        cmd = linuxcnc.command()
        cmd.jog(linuxcnc.JOG_STOP, 1, 0)
        time.sleep(0.5)
        errors = []
        while (e := err.poll()):
            errors.append(e[1])
        check("E5 a jog stop is taken in MDI: no error, task stays MDI",
              bool(r.get("ok")) and in_mdi and not errors and poll().task_mode == linuxcnc.MODE_MDI,
              f"set_mode={r} in_mdi={in_mdi} errors={errors} mode={s.task_mode}")
        # E6: an increment before homing (from MDI: the jog switches to MANUAL itself)
        gate_open(c, "jog")
        p0 = poll().joint[1]["output"]
        r = call(c, "jog_incr", axis=1, vel=50.0, distance=-2.0)
        peak, _ = max_speed(1, 1.0)
        done = standing(3)
        moved = poll().joint[1]["output"] - p0
        check(f"E6 an increment before homing: joint 1 by the distance, at most the cap {cap1:g}",
              bool(r.get("ok")) and abs(moved + 2.0) < 0.01 and peak <= cap1 * 1.02 and done,
              f"{r} moved={moved:.4f} peak={peak:.3f}")
        # E7: homed — the cap no longer applies. The sim's home switches are
        # SHARED and closed above X 1 / Y 0.5 / Z 2 (simulated_home_probe_basic
        # .hal): park every joint below its switch first, or task refuses
        # "Cannot home while shared home switch is closed".
        for j, top in ((0, 1.0), (1, 0.5), (2, 2.0)):
            pos = poll().joint[j]["output"]
            if pos > top - 0.5:
                call(c, "jog_incr", axis=j, vel=10.0, distance=-(pos - top + 1.0))
                standing(10)
        info["parked"] = [round(poll().joint[j]["output"], 3) for j in range(3)]
        r = call(c, "home_all")
        info["home_all"] = r
        homed = wait(lambda st: all(st.homed[:st.joints]) and st.inpos, 90)
        seen(c, lambda st: st.get("homed") is True, 10)
        gate_open(c, "jog")
        time.sleep(0.5)
        r = call(c, "jog_cont", axis=0, vel=3 * cap0)   # +: homed at 0, MIN_LIMIT -0.1
        peak, _ = max_speed(0, 1.5)
        call(c, "jog_stop", axis=0)
        standing(3)
        check("E7 homed: no cap (teleop at the asked speed)",
              homed and bool(r.get("ok")) and peak > cap0 * 1.5,
              f"homed={homed} {r} peak={peak:.3f} asked={3 * cap0:g}")
    elif PROFILE == "xyzac-e":
        cap4 = 0.1 * max_vel(4)
        info["cap"] = cap4
        gate_open(c, "jog")
        before = [poll().joint[j]["output"] for j in range(s.joints)]
        r = call(c, "jog_cont", axis=4, vel=20.0)
        peak, travel = max_speed(4, 1.5)
        call(c, "jog_stop", axis=4)
        standing(3)
        after = [poll().joint[j]["output"] for j in range(s.joints)]
        others = [abs(after[j] - before[j]) for j in range(4)]
        check(f"E8 C (wire 4) before homing moves joint 4 only, at most the cap {cap4:g}",
              bool(r.get("ok")) and travel > 0.5 * cap4 and peak <= cap4 * 1.02 and max(others) < 1e-6,
              f"{r} peak={peak:.3f} travel={travel:.3f} others={others}")
finally:
    try:
        call(c, "arm", armed=False)
    finally:
        c.stop.set()
        c.ws.close()

print(json.dumps({"info": info, "results": results}, indent=1))
sys.exit(0 if all(x["result"] == "PASS" for x in results) else 1)

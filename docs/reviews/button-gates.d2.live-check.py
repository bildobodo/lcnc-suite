#!/usr/bin/env python3
"""Button gates package D (R217: + L10 / L11) — the native check on the throwaway gates sim
(~/linuxcnc/configs/lcnc_suite_sim_gates, never the operator's sim). Every
check reads LinuxCNC's own STAT, not only the gateway's reply.

profile xyzac  (xyzac-trt-kins, no D switches)
  L1  a program loads in E-Stop, off, ON unhomed and partially homed — no
      AUTO switch (task mode unchanged), STAT.file and the load record name it
  L2  the task mode: MANUAL unhomed and in E-Stop; MDI unhomed refused with the
      reason (motion's kinType is not identity); homed MDI / AUTO switch
  L3  a program loaded in MANUAL starts from line 1 (the start's own AUTO
      switch closes and PLAN_RUN re-opens it); STAT.file stays
  L4  the G30 read: confirmed with the machine off; refused ON in AUTO with
      the reason; confirmed again in MDI
  L5  the spindle without the switch: unhomed refused
  L6  a program loaded with the machine off survives Machine On; whether
      homing survives Machine Off is recorded (the matrix's H)
  L10 (R216 BG-31) the spindle Fwd from MDI idle, homed: the current read
      admits it, a real MANUAL switch lands between the two reads, it turns
  L11 (R216, the same class) Home from MDI idle: switched to MANUAL, homes
  L7  the recovery order after a real trip (gateway SIGSTOPped past the HAL
      watchdog): E-Stop Reset refused until acknowledged, arming refused for a
      disarmed client and armEnable closed with the reason; then ack → Reset → On
profile xyz-d  (trivkins + [TRAJ] NO_FORCE_HOMING = 1 + WEBUI_SPINDLE_BEFORE_HOMING = 1)
  L8  unhomed MDI switches (identity kinematics + NO_FORCE_HOMING)
  L9  the spindle unhomed in MANUAL turns (STAT); in MDI refused with the reason

usage: <venv python> button-gates.d.live-check.py <repo root> <nc dir> <profile>
Prints one JSON object; exit 1 on any FAIL. Removes its program file.
"""
import json
import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT, NC, PROFILE = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
sys.path.insert(0, str(ROOT / "scripts"))
from test_support.live_session import SimulatorClient  # noqa: E402
import linuxcnc  # noqa: E402

s = linuxcnc.stat()
results = []


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
        time.sleep(0.05)
    return False


class Disarmed(SimulatorClient):
    """SimulatorClient.start() ARMS; a disarmed check must never have."""

    def start(self):
        from urllib.parse import urlencode
        from websockets.sync.client import connect
        self.ws = connect("ws://127.0.0.1:8000/ws?" + urlencode({"token": self.token}),
                          max_size=None, close_timeout=2)
        self.threads = [threading.Thread(target=self.receive, daemon=True),
                        threading.Thread(target=self.heartbeat, daemon=True)]
        for t in self.threads:
            t.start()
        self.request("hello", session=self.session)


def call(c, cmd, **kw):
    try:
        return c.request(cmd, **kw)
    except RuntimeError as e:
        return {"ok": False, "error": str(e).split(" refused: ", 1)[-1]}


def mode_name(m):
    return {linuxcnc.MODE_MANUAL: "MANUAL", linuxcnc.MODE_AUTO: "AUTO", linuxcnc.MODE_MDI: "MDI"}.get(m, m)


def load_record():
    p = ROOT / "runlogs" / "loaded_program.json"
    try:
        return json.loads(p.read_text())
    except Exception as e:  # noqa: BLE001
        return {"unreadable": str(e)}


def gateway_pid():
    out = subprocess.run(["pgrep", "-f", "uvicorn gateway:app.*lcnc-suite-gates/lcnc-gateway"],
                         capture_output=True, text=True).stdout.split()
    return int(out[0]) if len(out) == 1 else None


def seen(c, pred, timeout=5.0):
    """Wait until the GATEWAY's published status (what its policy judges)
    shows `pred` — it lags the controller by a poll cycle (5 Hz idle)."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if pred(c.status):
            return True
        time.sleep(0.05)
    return False


def gate_open(c, name, timeout=5.0):
    return seen(c, lambda st: (st.get("permissions") or {}).get(name) is True, timeout)


stamp = time.strftime("%H%M%S")
prog = NC / f"bg_d_live_{stamp}.ngc"
prog.write_text("(bg d live)\nG4 P0.3\nM2\n")
c = SimulatorClient("", session=f"bg-d-live-{PROFILE}")
c.start()
time.sleep(1.0)
poll()
info = {"profile": PROFILE, "kinematics_type": getattr(s, "kinematics_type", None),
        "start_state": s.task_state, "joints": s.joints}
try:
    if PROFILE == "xyzac":
        # ── L1: loads without AUTO, in every pre-run state ──
        def load_in(label):
            before = mode_name(poll().task_mode)
            r = call(c, "load_file", path=str(prog))
            ok = r.get("ok") and wait(lambda st: st.file == str(prog), 5)
            after = mode_name(poll().task_mode)
            end = time.monotonic() + 5   # the record settles at the next status tick
            while time.monotonic() < end and str(prog) not in json.dumps(load_record()):
                time.sleep(0.1)
            rec = load_record()
            check(f"L1 load in {label}: ok, STAT.file, task mode unchanged ({before})",
                  bool(ok) and after == before and str(prog) in json.dumps(rec),
                  f"reply={r} file={s.file} mode {before}->{after} record={rec}")

        if poll().task_state != linuxcnc.STATE_ESTOP:
            call(c, "estop")
            wait(lambda st: st.task_state == linuxcnc.STATE_ESTOP)
        load_in("E-Stop")
        # L2 in E-Stop: MANUAL switches
        r = call(c, "set_mode", mode=linuxcnc.MODE_MANUAL)
        check("L2 MANUAL in E-Stop", r.get("ok") and poll().task_mode == linuxcnc.MODE_MANUAL, f"{r} mode={mode_name(s.task_mode)}")
        call(c, "estop_reset")
        wait(lambda st: st.task_state == linuxcnc.STATE_ESTOP_RESET)
        call(c, "unload_file")
        load_in("off")
        # L4: the G30 read with the machine off (synch allowed)
        r = call(c, "read_g30")
        check("L4 G30 read with the machine off: confirmed", r.get("ok") is True and r.get("confirmed", True) is not False, str(r))
        call(c, "machine_on")
        wait(lambda st: st.task_state == linuxcnc.STATE_ON)
        load_in("ON unhomed")
        # L2 unhomed: MDI refused, MANUAL fine
        r = call(c, "set_mode", mode=linuxcnc.MODE_MDI)
        check("L2 MDI unhomed refused with the reason (kins not identity)",
              r.get("ok") is False and "Not homed" in r.get("error", "") and poll().task_mode != linuxcnc.MODE_MDI, str(r))
        # L5: the spindle without the switch
        r = call(c, "spindle_forward", speed=500)
        check("L5 spindle unhomed without the switch: refused", r.get("ok") is False and "Not homed" in r.get("error", ""), str(r))
        # partially homed
        call(c, "home", joint=0)
        wait(lambda st: st.homed[0], 30)
        wait(lambda st: st.inpos, 10)
        load_in("partially homed")
        # homed
        call(c, "home_all")
        check("homing completes", wait(lambda st: all(st.homed[:st.joints]) and st.inpos, 60))
        for m in (linuxcnc.MODE_MDI, linuxcnc.MODE_AUTO, linuxcnc.MODE_MANUAL):
            gate_open(c, "modeCoord")
            r = call(c, "set_mode", mode=m)
            check(f"L2 homed: {mode_name(m)} switches", r.get("ok") and wait(lambda st: st.task_mode == m, 3), f"{r} mode={mode_name(s.task_mode)}")
        # L3: loaded in MANUAL, the start runs it from line 1
        load_in("ON homed MANUAL")
        r = call(c, "cycle_start")
        ran = wait(lambda st: st.interp_state != linuxcnc.INTERP_IDLE, 5)
        done = wait(lambda st: st.interp_state == linuxcnc.INTERP_IDLE, 15)
        check("L3 the program loaded in MANUAL runs from the start; STAT.file stays",
              bool(r.get("ok")) and ran and done and poll().file == str(prog) and s.task_mode == linuxcnc.MODE_AUTO,
              f"{r} ran={ran} done={done} file={s.file} mode={mode_name(s.task_mode)}")
        # L4: ON in AUTO the read is refused; in MDI confirmed
        seen(c, lambda st: st.get("interp_state") == linuxcnc.INTERP_IDLE and st.get("task_mode") == linuxcnc.MODE_AUTO)
        r = call(c, "read_g30")
        check("L4 G30 read ON in AUTO: refused with the reason", r.get("ok") is False and "AUTO" in r.get("error", ""), str(r))
        call(c, "set_mode", mode=linuxcnc.MODE_MDI)
        wait(lambda st: st.task_mode == linuxcnc.MODE_MDI, 3)
        gate_open(c, "parameterRead")
        r = call(c, "read_g30")
        check("L4 G30 read in MDI: confirmed", r.get("ok") is True and r.get("confirmed", True) is not False, str(r))
        # L10: Fwd from MDI idle — the switch to MANUAL is real here
        seen(c, lambda st: st.get("task_mode") == linuxcnc.MODE_MDI)
        gate_open(c, "spindleManual")
        r = call(c, "spindle_forward", speed=500)
        turning = wait(lambda st: st.spindle[0]["direction"] == 1, 3)
        check("L10 spindle Fwd from MDI idle (homed): switched to MANUAL, turns",
              bool(r.get("ok")) and turning and poll().task_mode == linuxcnc.MODE_MANUAL,
              f"{r} direction={s.spindle[0]['direction']} mode={mode_name(s.task_mode)}")
        seen(c, lambda st: st.get("spindle_direction") == 1)
        r = call(c, "spindle_stop")
        check("L10 spindle stops", bool(r.get("ok")) and wait(lambda st: st.spindle[0]["direction"] == 0, 3), str(r))
        # L11: Home from MDI idle
        call(c, "set_mode", mode=linuxcnc.MODE_MDI)
        wait(lambda st: st.task_mode == linuxcnc.MODE_MDI, 3)
        seen(c, lambda st: st.get("task_mode") == linuxcnc.MODE_MDI)
        gate_open(c, "zero")
        r = call(c, "home", joint=0)
        switched = wait(lambda st: st.task_mode == linuxcnc.MODE_MANUAL, 3)
        started = wait(lambda st: st.joint[0]["homing"] or not st.homed[0], 3)
        rehomed = wait(lambda st: all(st.homed[:st.joints]) and st.inpos
                       and not any(j["homing"] for j in st.joint[:st.joints]), 60)
        check("L11 Home from MDI idle: switched to MANUAL, joint 0 homed again",
              bool(r.get("ok")) and switched and rehomed,
              f"{r} switched={switched} started={started} rehomed={rehomed} mode={mode_name(s.task_mode)}")
        gate_open(c, "modeCoord")
        call(c, "set_mode", mode=linuxcnc.MODE_MDI)
        wait(lambda st: st.task_mode == linuxcnc.MODE_MDI, 3)
        # L6: off with the program loaded, then on
        call(c, "machine_off")
        wait(lambda st: st.task_state == linuxcnc.STATE_OFF)
        gate_open(c, "programLoad")
        homed_after_off = list(poll().homed[:s.joints])
        info["homed_after_machine_off"] = homed_after_off
        call(c, "unload_file")
        load_in("off (homed before)")
        call(c, "machine_on")
        wait(lambda st: st.task_state == linuxcnc.STATE_ON)
        check("L6 a program loaded with the machine off survives Machine On",
              wait(lambda st: st.file == str(prog), 3) and str(prog) in json.dumps(load_record()),
              f"file={s.file} record={load_record()}")
        gate_open(c, "modeManual")
        r = call(c, "set_mode", mode=linuxcnc.MODE_MDI)
        info["mdi_after_off_on"] = {"reply": r, "mode": mode_name(poll().task_mode), "homed": list(s.homed[:s.joints])}
        # ── L7: the recovery order after a real trip ──
        pid = gateway_pid()
        check("L7 gateway process found", pid is not None, str(pid))
        if pid:
            os.kill(pid, signal.SIGSTOP)
            time.sleep(1.2)
            os.kill(pid, signal.SIGCONT)
            tripped = wait(lambda st: st.task_state == linuxcnc.STATE_ESTOP, 5)
            # the gateway's published reasons name the trip (the banner's
            # safety_trip rides the frame, not its data)
            reported = seen(c, lambda st: "Acknowledge" in (st.get("permission_reasons") or {}).get("estopReset", ""))
            check("L7 the trip latched E-Stop and the gateway's policy names it", tripped and reported,
                  f"estop={tripped} estopReset reason={(c.status.get('permission_reasons') or {}).get('estopReset')}")
            r = call(c, "estop_reset")
            check("L7 E-Stop Reset refused until acknowledged",
                  r.get("ok") is False and "Acknowledge" in r.get("error", "") and poll().task_state == linuxcnc.STATE_ESTOP, str(r))
            d = Disarmed("", session="bg-d-live-observer")
            d.start()
            time.sleep(0.6)
            r = call(d, "arm", armed=True)
            perms, reasons = d.status.get("permissions") or {}, d.status.get("permission_reasons") or {}
            check("L7 arming refused while the trip waits; armEnable closed with the reason",
                  r.get("ok") is False and perms.get("armEnable") is False and "Acknowledge" in reasons.get("armEnable", ""),
                  f"arm={r} armEnable={perms.get('armEnable')} reason={reasons.get('armEnable')}")
            d.send({"cmd": "safety_trip_ack"})
            opened = gate_open(d, "armEnable")
            check("L7 acknowledged: armEnable open", opened, str((d.status.get("permissions") or {}).get("armEnable")))
            d.stop.set()
            d.ws.close()
            r = call(c, "estop_reset")
            reset = wait(lambda st: st.task_state == linuxcnc.STATE_ESTOP_RESET, 5)
            seen(c, lambda st: st.get("is_estop") is False)   # the gateway judges what it published
            r2 = call(c, "machine_on")
            on = wait(lambda st: st.task_state == linuxcnc.STATE_ON, 5)
            check("L7 then Reset and On", bool(r.get("ok")) and reset and bool(r2.get("ok")) and on, f"{r} {r2} reset={reset} on={on}")
    elif PROFILE == "xyz-d":
        if poll().task_state == linuxcnc.STATE_ESTOP:
            call(c, "estop_reset")
            wait(lambda st: st.task_state == linuxcnc.STATE_ESTOP_RESET)
            seen(c, lambda st: st.get("is_estop") is False)
        call(c, "machine_on")
        wait(lambda st: st.task_state == linuxcnc.STATE_ON)
        seen(c, lambda st: st.get("is_enabled") is True)
        check("xyz-d starts unhomed", not any(poll().homed[:s.joints]), str(list(s.homed[:s.joints])))
        r = call(c, "set_mode", mode=linuxcnc.MODE_MDI)
        check("L8 unhomed MDI switches (identity kins + NO_FORCE_HOMING)",
              r.get("ok") and wait(lambda st: st.task_mode == linuxcnc.MODE_MDI, 3), f"{r} mode={mode_name(s.task_mode)}")
        seen(c, lambda st: st.get("task_mode") == linuxcnc.MODE_MDI)
        r = call(c, "spindle_forward", speed=500)
        check("L9 spindle unhomed in MDI: refused with the reason", r.get("ok") is False and "Manual mode only" in r.get("error", ""), str(r))
        call(c, "set_mode", mode=linuxcnc.MODE_MANUAL)
        wait(lambda st: st.task_mode == linuxcnc.MODE_MANUAL, 3)
        gate_open(c, "spindleManual")
        r = call(c, "spindle_forward", speed=500)
        turning = wait(lambda st: st.spindle[0]["direction"] == 1, 3)
        check("L9 spindle unhomed in MANUAL with the switch: turns", bool(r.get("ok")) and turning,
              f"{r} direction={s.spindle[0]['direction']} speed={s.spindle[0]['speed']}")
        seen(c, lambda st: st.get("spindle_direction") == 1)
        r = call(c, "spindle_stop")
        check("spindle stops", bool(r.get("ok")) and wait(lambda st: st.spindle[0]["direction"] == 0, 3), str(r))
finally:
    try:
        call(c, "arm", armed=False)
    finally:
        c.stop.set()
        c.ws.close()
        prog.unlink(missing_ok=True)

print(json.dumps({"info": info, "results": results}, indent=1))
sys.exit(0 if all(x["result"] == "PASS" for x in results) else 1)

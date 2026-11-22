"""One-off (Fable 2026-11-22, P1b merge): does LinuxCNC's task ABORT alone
stop a continuous jog in progress? On the VM LAN sim, homed (teleop/world
jog). A jog_cont (no lease — the LAN gateway is the live tree), moving for
1 s, then ONLY `abort`; the standstill judged by the position. Run under the
heavy lock. Prints one JSON line.

  python3 -I abort_check.py <p1b tree>
"""
import json
import sys
import time

sys.path.insert(0, sys.argv[1] + "/scripts")
from test_support.live_session import SimulatorClient  # noqa: E402
from test_support.live_target import ini_values  # noqa: E402
from test_support.system_host import SystemHost  # noqa: E402
from pathlib import Path  # noqa: E402

host = SystemHost()
token = (ini_values(Path(host.gateway_ini()).read_text()).get(("DISPLAY", "WEBUI_TOKEN")) or [""])[-1]
c = SimulatorClient(token, session="p1b-abort-check")
c.start(arm=True)
out = {"steps": []}


def pos():
    p = (c.status or {}).get("joint_pos") or []
    return p[0] if p else None


def wait(pred, s, what):
    end = time.monotonic() + s
    while time.monotonic() < end:
        if pred(c.status or {}):
            return True
        time.sleep(0.05)
    out["steps"].append(f"timeout: {what}")
    return False


try:
    st = c.status or {}
    out["homed"] = st.get("homed")
    out["estop"] = st.get("estop")
    out["enabled"] = st.get("enabled")
    if not st.get("enabled"):
        c.request("estop_reset") if st.get("estop") else None
        time.sleep(0.5)
        c.request("machine_on")
        wait(lambda s: s.get("enabled"), 5, "machine on")
    if not bool((c.status or {}).get("homed")):
        c.request("home_all")
        wait(lambda s: bool(s.get("homed")) and s.get("interp_state") == 1, 90, "homed")
    c.request("set_mode", mode=1)
    time.sleep(0.5)
    p0 = pos()
    c.request("jog_cont", axis=0, vel=20.0)
    time.sleep(1.0)
    p1 = pos()
    t_abort = time.monotonic()
    c.request("abort")
    samples = []
    while time.monotonic() - t_abort < 2.0:
        samples.append((round(time.monotonic() - t_abort, 3), pos()))
        time.sleep(0.05)
    still = [p for t, p in samples if t >= 1.0 and p is not None]
    out.update(p0=p0, p1_moving=p1, moved_mm=None if p0 is None or p1 is None else round(p1 - p0, 3),
               after_1s_span_mm=None if not still else round(max(still) - min(still), 4),
               last=samples[-1] if samples else None)
    out["verdict"] = ("PASS: moving before, standing after the abort alone"
                      if out["moved_mm"] and abs(out["moved_mm"]) > 5 and out["after_1s_span_mm"] is not None
                      and out["after_1s_span_mm"] < 0.01 else "NOT SHOWN")
finally:
    try:
        c.request("jog_stop", axis=0)
    except Exception as e:  # noqa: BLE001
        out["steps"].append(f"cleanup jog_stop: {e}")
    c.drop()
print(json.dumps(out))

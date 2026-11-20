"""Machine-day step 1.4 timed once on the LAN sim (2026-11-20): the latch
cleared by an armed client, then the keepalive (the only client) stopped and
the seconds to the HAL latch read straight from HAL (halcmd, no client); then
the keepalive back, the trip acknowledged, disarmed. The token is read from the
INI and never printed. usage: <gates venv python> step14.py <repo> <ini>"""
import re, subprocess, sys, time
from pathlib import Path
sys.path.insert(0, sys.argv[1] + "/scripts")
from test_support.live_session import SimulatorClient  # noqa: E402
INI = Path(sys.argv[2]); PY = sys.executable
tok = (re.search(r"^WEBUI_TOKEN\s*=\s*(\S+)", INI.read_text(), re.M) or [None, ""])[1]
def pin(name):
    return subprocess.run(["halcmd", "getp", name], capture_output=True, text=True).stdout.strip()
def wait_pin(name, value, limit):
    t = time.monotonic()
    while time.monotonic() - t < limit:
        if pin(name) == value:
            return time.monotonic() - t
        time.sleep(0.02)
    return None
print("before: fault-out", pin("webui-hb-latch.fault-out"), "emc-enable-in", pin("iocontrol.0.emc-enable-in"))
c = SimulatorClient(tok, session="p4-step14", auto_confirm=False)
c.start(arm=True)
print("estop_reset", c.request("estop_reset"))
print("latch cleared after", wait_pin("webui-hb-latch.fault-out", "FALSE", 5), "s")
c.request("arm", armed=False)
c.drop()
time.sleep(1.0)
assert pin("webui-hb-latch.fault-out") == "FALSE", "latch not clear before the measurement"
subprocess.run(["systemctl", "--user", "stop", "bg-keepalive"], check=True)
t0 = time.monotonic()
conn = wait_pin("webui-safety.connected", "FALSE", 10)
trip = wait_pin("webui-hb-latch.fault-out", "TRUE", 10)
total = time.monotonic() - t0 if trip is not None else None
print(f"keepalive stopped → connected FALSE after {conn and round(conn, 2)} s; latch TRUE after {total and round(total, 2)} s (from the stop)")
print("after: emc-enable-in", pin("iocontrol.0.emc-enable-in"))
subprocess.run(["systemctl", "--user", "reset-failed", "bg-keepalive"])
subprocess.run(["systemd-run", "--user", "--unit=bg-keepalive", f"--working-directory={Path.home()}", PY,
                str(Path.home() / "claude-work/bg/keepalive_ini.py"), str(INI)], check=True)
time.sleep(2)
c = SimulatorClient(tok, session="p4-step14-ack", auto_confirm=False)
c.start(arm=False)
for _ in range(50):
    if c.safety_trip:
        break
    time.sleep(0.1)
print("banner trip:", {k: c.safety_trip.get(k) for k in ("reason", "id")} if c.safety_trip else None)
if c.safety_trip:
    print("ack", c.request("safety_trip_ack", id=c.safety_trip["id"]))
c.drop()
print("end: fault-out", pin("webui-hb-latch.fault-out"), "emc-enable-in", pin("iocontrol.0.emc-enable-in"))

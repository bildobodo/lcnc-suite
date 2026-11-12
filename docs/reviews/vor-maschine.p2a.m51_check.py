"""Fable's 2a check (2026-11-12): does M51 P0 / P1 toggle the real binding's
spindle[0]["override_enabled"] — the field status_runtime now reports?
On the LAN sim: arm, estop_reset, machine_on, home_all, then MDI M51 P0 / P1
through the gateway, the binding read directly; M51 P1 left (the default),
disarmed. Token from the INI, never printed.
usage: <venv python> m51_check.py <repo root> <ini>"""
import configparser
import sys
import time

sys.path.insert(0, sys.argv[1] + "/scripts")
import linuxcnc  # noqa: E402
from test_support.live_session import SimulatorClient  # noqa: E402

ini = configparser.ConfigParser(strict=False, interpolation=None)
ini.read(sys.argv[2])
token = ini.get("DISPLAY", "WEBUI_TOKEN", fallback="").strip()
c = SimulatorClient(token, session="m51-check")
c.start()
s = linuxcnc.stat()


def settle(pred, what):
    for _ in range(120):
        s.poll()
        if pred():
            return True
        time.sleep(0.25)
    print("TIMEOUT", what)
    return False


try:
    print("arm", c.request("arm", armed=True).get("ok"))
    for cmd in ("estop_reset", "machine_on", "home_all"):
        print(cmd, c.request(cmd).get("ok"))
        time.sleep(0.5)
    settle(lambda: s.task_state == linuxcnc.STATE_ON and all(s.homed[:s.joints]) and s.interp_state == linuxcnc.INTERP_IDLE, "on+homed")
    out = {}
    for word, want in (("M51 P0", False), ("M51 P1", True)):
        r = c.request("mdi", text=word)
        ok = settle(lambda: s.interp_state == linuxcnc.INTERP_IDLE and bool(s.spindle[0]["override_enabled"]) is want, word)
        out[word] = (r.get("ok"), s.spindle[0]["override_enabled"], ok)
        print(word, "reply ok", r.get("ok"), "→ spindle[0].override_enabled =", s.spindle[0]["override_enabled"])
    print("RESULT", "PASS" if all(v[2] for v in out.values()) else "FAIL")
finally:
    c.request("arm", armed=False)
    c.stop.set()
    c.ws.close()

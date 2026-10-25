#!/usr/bin/env python3
"""Button gates, package A — the stops without arm on the RUNNING simulator
(BG-08 / BG-18, review docs/reviews/button-gates.review.md R205).

Through the gateway's WebSocket exactly as the buttons send them, with two
clients: one ARMED (it starts what is to be stopped) and one OBSERVER that
never arms. Checks, each against the controller's own status (linuxcnc.stat):

  S1  the observer's spindle stop at idle in MDI: ok, the spindle stops, the
      task stays in MDI (no MANUAL switch on the way)
  S2  the observer's spindle stop while an MDI move runs: refused, the
      spindle keeps turning (the program owns it)
  S3  the observer pauses the running MDI move: ok, the motion pauses
  S4  the observer's resume: refused (resuming is new motion — arm)
  S5  the observer's abort: ok, the interpreter returns to idle

Needs the suite live, the machine ON, homed and idle. Moves the simulator by
5 mm in Z (relative, downward, F30) and runs the spindle at 1000 rpm; leaves
the spindle off, G90, the task idle. Simulator only.

usage: <venv python> button-gates.a.live-stops.py <token> <repo root>
"""
import json
import sys
import threading
import time
from pathlib import Path

TOKEN, ROOT = sys.argv[1], Path(sys.argv[2])
sys.path.insert(0, str(ROOT / "scripts"))
from test_support.live_session import SimulatorClient  # noqa: E402
import linuxcnc  # noqa: E402

s = linuxcnc.stat()
RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, "PASS" if ok else "FAIL", detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  — ' + detail}", flush=True)


class Observer(SimulatorClient):
    """Connected and heartbeating, never armed; answers no tool change."""

    def start(self):
        from websockets.sync.client import connect
        from urllib.parse import urlencode
        self.ws = connect("ws://127.0.0.1:8000/ws?" + urlencode({"token": self.token}),
                          max_size=None, close_timeout=2)
        self.threads = [threading.Thread(target=self.receive, daemon=True),
                        threading.Thread(target=self.heartbeat, daemon=True)]
        for t in self.threads:
            t.start()
        self.request("hello", session=self.session)

    def ask(self, cmd, **kw):
        """The reply, refused or not (request() raises on a refusal)."""
        try:
            return self.request(cmd, **kw)
        except RuntimeError as e:
            return {"ok": False, "error": str(e)}

    def close(self):
        self.stop.set()
        try:
            self.ws.close()
        except Exception:
            pass


def wait(pred, timeout=10.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        s.poll()
        if pred():
            return True
        time.sleep(0.05)
    return False


def spindle_on():
    return s.spindle[0]["direction"] != 0


armed = SimulatorClient(TOKEN, session="button-gates-a-armed")
observer = Observer(TOKEN, session="button-gates-a-observer")
armed.start()
observer.start()
s.poll()
assert s.task_state == linuxcnc.STATE_ON and all(s.homed[:s.joints]), "machine must be ON and homed"
assert s.interp_state == linuxcnc.INTERP_IDLE, "machine must be idle"
print("=== stops without arm (observer) ===", flush=True)
try:
    # S1 — the spindle stop at idle in MDI, no MANUAL switch
    armed.request("mdi", text="M3 S1000")
    ok = wait(lambda: spindle_on() and s.interp_state == linuxcnc.INTERP_IDLE)
    mode_before = s.task_mode
    r = observer.ask("spindle_stop")
    stopped = wait(lambda: not spindle_on())
    s.poll()
    check("S1 spindle stop at idle, disarmed: ok, stopped, task mode unchanged",
          ok and r.get("ok") is True and stopped and s.task_mode == mode_before == linuxcnc.MODE_MDI,
          f"started={ok} reply={r} stopped={stopped} mode {mode_before}->{s.task_mode}")

    # S2 — refused while an MDI move runs; S3 pause; S4 resume refused; S5 abort
    armed.request("mdi", text="M3 S1000")
    wait(spindle_on)
    armed.request("mdi", text="G91 G1 Z-5 F30")
    moving = wait(lambda: s.interp_state != linuxcnc.INTERP_IDLE and abs(s.current_vel) > 0)
    time.sleep(0.6)   # the broadcast snapshot sees the run (the gate reads it)
    r = observer.ask("spindle_stop")
    s.poll()
    check("S2 spindle stop while an MDI move runs, disarmed: refused, the spindle keeps turning",
          moving and r.get("ok") is False and spindle_on(), f"moving={moving} reply={r} spindle_on={spindle_on()}")
    r = observer.ask("cycle_pause")
    paused = wait(lambda: s.paused or s.interp_state == linuxcnc.INTERP_PAUSED)
    still = wait(lambda: abs(s.current_vel) < 1e-6, timeout=3)
    check("S3 pause of the running MDI move, disarmed: ok, motion paused",
          r.get("ok") is True and paused and still, f"reply={r} paused={paused} still={still}")
    time.sleep(0.6)
    r = observer.ask("cycle_resume")
    s.poll()
    check("S4 resume, disarmed: refused", r.get("ok") is False and (s.paused or s.interp_state == linuxcnc.INTERP_PAUSED),
          f"reply={r} paused={s.paused} interp={s.interp_state}")
    r = observer.ask("abort")
    idle = wait(lambda: s.interp_state == linuxcnc.INTERP_IDLE)
    check("S5 abort, disarmed: ok, the interpreter idles", r.get("ok") is True and idle, f"reply={r} idle={idle}")
finally:
    try:
        armed.request("abort")
        wait(lambda: s.interp_state == linuxcnc.INTERP_IDLE)
        armed.request("mdi", text="M5")
        armed.request("mdi", text="G90")
    except Exception as e:
        print("cleanup:", e)
    observer.close()
    armed.close()

print(json.dumps({"results": RESULTS}, indent=1))
sys.exit(0 if all(v == "PASS" for _n, v, _d in RESULTS) else 1)

#!/usr/bin/env python3
"""Button gates, package C — the armed side and the machine reads of the live
check (button-gates.c.live-browser.mjs drives the disarmed BROWSER; this helper
does what an ARMED operator elsewhere does, and reads LinuxCNC's own state).

  shutdown-disarmed      a disarmed connection sends `shutdown`: refused "Not
                         armed", LinuxCNC still answers 2 s later (package C:
                         the gateway used to accept it from any connection)
  start <nc_dir> <name>  an armed connection uploads a 30 s dwell, loads it and
                         starts it; returns once the interpreter runs
  state                  task mode, interpreter state, paused (STAT)
  cleanup <nc_dir> <name>  removes the dwell file

Simulator only. Prints one JSON object.
usage: <venv python> button-gates.c.live-helper.py <repo root> <cmd> [args]
"""
import json
import sys
import time
from pathlib import Path

ROOT, CMD, ARGS = Path(sys.argv[1]), sys.argv[2], sys.argv[3:]
sys.path.insert(0, str(ROOT / "scripts"))
from test_support.live_session import SimulatorClient, gateway_load  # noqa: E402
import httpx  # noqa: E402
import linuxcnc  # noqa: E402

s = linuxcnc.stat()


def stat():
    s.poll()
    return {"task_mode": s.task_mode, "interp_state": s.interp_state, "paused": bool(s.paused),
            "task_state": s.task_state, "file": s.file}


class Client(SimulatorClient):
    """SimulatorClient.start() ARMS — a check of what a DISARMED connection
    may do must never have armed (the first run of this check sent its
    shutdown from an armed connection; the gateway rightly obeyed)."""

    def start(self):
        import threading
        from urllib.parse import urlencode
        from websockets.sync.client import connect
        self.ws = connect("ws://127.0.0.1:8000/ws?" + urlencode({"token": self.token}),
                          max_size=None, close_timeout=2)
        self.threads = [threading.Thread(target=self.receive, daemon=True),
                        threading.Thread(target=self.heartbeat, daemon=True)]
        for t in self.threads:
            t.start()


def client(arm):
    c = Client("", session=f"bg-c-helper-{CMD}")
    c.start()
    hello = c.request("hello", session=c.session)
    c.key = hello.get("conn_key")
    assert hello.get("armed") is False, hello
    if arm:
        c.request("arm", armed=True)
    return c


def close(c, armed):
    try:
        if armed:
            c.request("arm", armed=False)
    finally:
        c.stop.set()
        c.ws.close()


if CMD == "shutdown-disarmed":
    c = client(False)
    try:
        try:
            r = c.request("shutdown")
        except RuntimeError as e:
            r = {"ok": False, "error": str(e)}
    finally:
        close(c, False)
    time.sleep(2)
    alive = True
    try:
        stat()
    except Exception as e:  # noqa: BLE001
        alive = str(e)
    print(json.dumps({"reply": r, "linuxcnc_alive": alive}))
elif CMD == "start":
    nc_dir, name = Path(ARGS[0]), ARGS[1]
    c = client(True)
    try:
        r = httpx.post("http://127.0.0.1:8000/upload", headers={"X-Conn-Key": c.key},
                       files={"file": (name, b"(bg c dwell)\nG4 P30\nM2\n", "text/plain")}, timeout=10)
        assert r.status_code == 200, (r.status_code, r.text)
        gateway_load(str(nc_dir / name), "")
        c.request("cycle_start")
        for _ in range(100):
            if stat()["interp_state"] != linuxcnc.INTERP_IDLE:
                break
            time.sleep(0.05)
    finally:
        close(c, True)
    print(json.dumps(stat()))
elif CMD == "state":
    print(json.dumps(stat()))
elif CMD == "cleanup":
    p = Path(ARGS[0]) / ARGS[1]
    p.unlink(missing_ok=True)
    print(json.dumps({"removed": str(p)}))
else:
    raise SystemExit(f"unknown command {CMD}")

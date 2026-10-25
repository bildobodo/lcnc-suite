#!/usr/bin/env python3
"""Button gates, package A rest (Codex R205 BG-17): the M6 confirmation names
the request it answers — on the RUNNING simulator, through the gateway's
WebSocket as the dialog sends it, against the real iocontrol handshake
(tool-change → the watchdog's tool-changed).

  M1  a confirmation naming an EARLIER request is refused; the request stays
  M2  the confirmation naming the CURRENT request completes the change
  M3  the same confirmation again is refused; nothing is pending
  M4  a confirmation without its request is refused (an old client)

Needs the suite live, the machine ON, homed and idle, Machine frame. Loads
tool 2 through the gateway's tool_change (the UI's path: T2 M6 + G43, fire
and forget — the M6 waits for the operator), then puts the tool in the
spindle at the start back the same way. Simulator only.

usage: <venv python> button-gates.a2.live-m6.py <token> <repo root>
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


class Armed(SimulatorClient):
    """Armed and heartbeating, WITHOUT the runner's automatic M6 confirm."""

    def receive(self):
        import msgspec
        try:
            for raw in self.ws:
                msg = msgspec.msgpack.decode(raw) if isinstance(raw, bytes) else json.loads(raw)
                if isinstance(msg.get("data"), dict):
                    self.status.update(msg["data"])
                if "ok" in msg:
                    self.replies.put(msg)
        except Exception as exc:
            if not self.stop.is_set():
                self.error = str(exc)

    def ask(self, cmd, **kw):
        try:
            return self.request(cmd, **kw)
        except RuntimeError as e:
            return {"ok": False, "error": str(e)}


def wait(pred, timeout=15.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        s.poll()
        if pred():
            return True
        time.sleep(0.05)
    return False


def pending():
    return client.status.get("tool_change_requested") is True and client.status.get("tool_change_seq") is not None


def change_to(tool):
    """tool_change <tool>, answered with the CURRENT request (the dialog's path)."""
    client.ask("tool_change", tool_number=tool)
    if not wait(pending):
        return False
    seq = client.status["tool_change_seq"]
    client.ask("confirm_tool_change", request=seq)
    return wait(lambda: s.tool_in_spindle == tool and s.interp_state == linuxcnc.INTERP_IDLE)


client = Armed(TOKEN, session="button-gates-a2-m6")
client.start()
s.poll()
assert s.task_state == linuxcnc.STATE_ON and all(s.homed[:s.joints]), "machine must be ON and homed"
assert s.interp_state == linuxcnc.INTERP_IDLE, "machine must be idle"
tool_before = s.tool_in_spindle
target = 2 if tool_before != 2 else 3
print(f"=== M6 confirmation bound to its request (tool {tool_before} -> {target}) ===", flush=True)
try:
    client.ask("tool_change", tool_number=target)
    ok = wait(pending)
    seq = client.status.get("tool_change_seq")
    time.sleep(0.6)   # the broadcast snapshot carries the request (the gate reads it)
    r = client.ask("confirm_tool_change", request=(seq or 0) - 1)
    s.poll()
    check("M1 a confirmation naming an earlier request is refused, the request stays",
          ok and r.get("ok") is False and "changed" in str(r.get("error")) and pending()
          and s.tool_in_spindle == tool_before, f"pending={ok} seq={seq} reply={r} tool={s.tool_in_spindle}")
    r = client.ask("confirm_tool_change")
    s.poll()
    check("M4 a confirmation without its request is refused",
          r.get("ok") is False and pending(), f"reply={r}")
    r = client.ask("confirm_tool_change", request=seq)
    done = wait(lambda: s.tool_in_spindle == target and s.interp_state == linuxcnc.INTERP_IDLE)
    check("M2 the confirmation naming the current request completes the change",
          r.get("ok") is True and done, f"reply={r} tool={s.tool_in_spindle} interp={s.interp_state}")
    time.sleep(0.6)
    r = client.ask("confirm_tool_change", request=seq)
    s.poll()
    check("M3 the same confirmation again is refused, nothing pending",
          r.get("ok") is False and client.status.get("tool_change_requested") is not True,
          f"reply={r} requested={client.status.get('tool_change_requested')}")
finally:
    try:
        client.ask("abort")
        wait(lambda: s.interp_state == linuxcnc.INTERP_IDLE)
        s.poll()
        if s.tool_in_spindle != tool_before:
            print("restore:", change_to(tool_before), "tool", s.tool_in_spindle, flush=True)
    except Exception as e:
        print("cleanup:", e)
    client.close()

print(json.dumps({"results": RESULTS}, indent=1))
sys.exit(0 if all(v == "PASS" for _n, v, _d in RESULTS) else 1)

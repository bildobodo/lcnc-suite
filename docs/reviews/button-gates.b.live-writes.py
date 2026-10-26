#!/usr/bin/env python3
"""Button gates, package B — the writes on the RUNNING simulator (BG-14,
BG-19; review docs/reviews/button-gates.review.md).

Through the gateway exactly as the page writes: the WebSocket for the hello,
arm, settings and tool-table commands, HTTP for uploads, saves and settings,
with the connection key (`X-Conn-Key`, the beacon's body) the hello reply
gave. Two connections: one ARMED, one OBSERVER that never arms. Each refused
write is checked on the disk (bytes, inode, mtime) — nothing replaced.

  K1  the hello reply names a key; a second hello on the same connection
      names the SAME key; the observer's connection has another
  U1  upload without a key: 403 "Connection unknown", nothing written
  U2  upload with the observer's key: 403 "Not armed", nothing written
  U3  upload with the armed key: 200, the file on the disk
  U4  save while a program runs: refused, the file unchanged
  U5  save with the key of a CLOSED connection: 403, unchanged
  S1  a display section, observer: saved (Q2)
  S2  a protected section over HTTP, observer: 403, the store unchanged
  S3  the same over WS, observer: refused; armed: saved (restored after)
  S4  the global reset, observer: 403, the store unchanged
  S5  a page-hide beacon of a closed connection (key in the body): refused
  T1  a tool-table edit while an M6 request waits: refused, table unchanged
  T2  a tool-table edit in E-Stop, armed: admitted (maintenance)
  U6  upload in E-Stop, armed: admitted

Needs the suite live, the machine ON, homed and idle. Runs a 3 s dwell
program (no motion), asks for one tool change (T2, or T3 when T2 is in;
answered at once, not changed back), puts
the machine in E-Stop at the end and back ON (not homed). Restores the
settings it changed (a section absent before is saved back EMPTY — the same
as absent when the page loads it) and the tool's remark; removes its files.
Simulator only.

usage: <venv python> button-gates.b.live-writes.py <token> <repo root>
"""
import json
import os
import sys
import time
from pathlib import Path

import httpx

TOKEN, ROOT = sys.argv[1], Path(sys.argv[2])
sys.path.insert(0, str(ROOT / "scripts"))
from test_support.live_session import SimulatorClient, gateway_load  # noqa: E402
import linuxcnc  # noqa: E402

BASE = "http://127.0.0.1:8000"
s = linuxcnc.stat()
RESULTS = []
STAMP = time.strftime("%H%M%S")


def check(name, ok, detail=""):
    RESULTS.append((name, "PASS" if ok else "FAIL", detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'' if ok else '  — ' + detail}", flush=True)


class Client(SimulatorClient):
    """A connection that keeps its hello reply (the key) and arms only when
    asked; no automatic M6 confirmation (the test answers it)."""

    def __init__(self, token, session, arm):
        super().__init__(token, session=session)
        self.arm = arm
        self.key = None

    def start(self):
        from websockets.sync.client import connect
        import threading
        from urllib.parse import urlencode
        self.ws = connect("ws://127.0.0.1:8000/ws?" + urlencode({"token": self.token}),
                          max_size=None, close_timeout=2)
        self.threads = [threading.Thread(target=self.receive, daemon=True),
                        threading.Thread(target=self.heartbeat, daemon=True)]
        for t in self.threads:
            t.start()
        self.key = self.request("hello", session=self.session).get("conn_key")
        if self.arm:
            self.request("arm", armed=True)

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

    def close(self):
        if self.ws:
            if self.arm:
                try:
                    self.request("arm", armed=False)
                except Exception:
                    pass
            self.stop.set()
            self.ws.close()
        for t in self.threads:
            t.join(timeout=3)


def http(method, path, key=None, **kw):
    headers = dict(kw.pop("headers", {}))
    if TOKEN:
        headers["X-Auth-Token"] = TOKEN
    if key:
        headers["X-Conn-Key"] = key
    return httpx.request(method, BASE + path, headers=headers, timeout=30, **kw)


def detail(r):
    try:
        b = r.json()
        return str(b.get("detail") or b.get("error") or b)
    except Exception:
        return r.text[:120]


def disk(p):
    try:
        st = os.stat(p)
        return (Path(p).read_bytes(), st.st_ino, st.st_mtime_ns)
    except FileNotFoundError:
        return None


def upload(name, body, key, overwrite=False):
    q = "?overwrite=1" if overwrite else ""
    return http("POST", "/upload" + q, key, files={"file": (name, body, "text/plain")})


def wait(pred, timeout=15.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        s.poll()
        if pred():
            return True
        time.sleep(0.05)
    return False


def settings():
    """The gateway's settings store (GET /settings answers {ok, settings})."""
    body = http("GET", "/settings").json()
    assert body.get("ok") is True and isinstance(body.get("settings"), dict), body
    return body["settings"]


s.poll()
assert s.task_state == linuxcnc.STATE_ON and all(s.homed[:s.joints]), "machine must be ON and homed"
assert s.interp_state == linuxcnc.INTERP_IDLE, "machine must be idle"
nc_dir = Path(os.path.expanduser(linuxcnc.ini(s.ini_filename).find("DISPLAY", "PROGRAM_PREFIX")))
tbl = Path(s.ini_filename).parent / linuxcnc.ini(s.ini_filename).find("EMCIO", "TOOL_TABLE")
f_new = nc_dir / f"bg_b_live_{STAMP}.ngc"
f_dwell = nc_dir / f"bg_b_dwell_{STAMP}.ngc"
f_estop = nc_dir / f"bg_b_estop_{STAMP}.ngc"
armed = Client(TOKEN, "button-gates-b-armed", arm=True)
observer = Client(TOKEN, "button-gates-b-observer", arm=False)
armed.start()
observer.start()
before = settings()
remark_before = None
print(f"=== package B writes (program folder {nc_dir}, table {tbl}) ===", flush=True)
try:
    # K1
    again = armed.request("hello", session=armed.session).get("conn_key")
    check("K1 the hello names a key, the same one on a second hello, another per connection",
          bool(armed.key) and again == armed.key and bool(observer.key) and observer.key != armed.key,
          f"armed={armed.key!r} again={again!r} observer={observer.key!r}")

    # U1–U3
    r = upload(f_new.name, b"(bg b)\nM2\n", None)
    check("U1 upload without a key: 403 Connection unknown, nothing written",
          r.status_code == 403 and "Connection unknown" in detail(r) and disk(f_new) is None, f"{r.status_code} {detail(r)}")
    r = upload(f_new.name, b"(bg b)\nM2\n", observer.key)
    check("U2 upload with the observer's key: 403 Not armed, nothing written",
          r.status_code == 403 and "Not armed" in detail(r) and disk(f_new) is None, f"{r.status_code} {detail(r)}")
    r = upload(f_new.name, b"(bg b)\nM2\n", armed.key)
    check("U3 upload with the armed key: 200, the file on the disk",
          r.status_code == 200 and disk(f_new) is not None and disk(f_new)[0] == b"(bg b)\nM2\n", f"{r.status_code} {detail(r)}")

    # U4 — a program runs (a dwell, no motion)
    r = upload(f_dwell.name, b"(bg b dwell)\nG4 P3\nM2\n", armed.key)
    gateway_load(str(f_dwell), TOKEN)
    time.sleep(0.6)
    armed.ask("cycle_start")
    running = wait(lambda: s.interp_state != linuxcnc.INTERP_IDLE, 5)
    time.sleep(0.6)   # the broadcast snapshot shows the run
    d0 = disk(f_new)
    r = http("PUT", f"/save?path={f_new}", armed.key, content=b"(changed while running)\nM2\n",
             headers={"Content-Type": "text/plain; charset=utf-8"})
    check("U4 save while a program runs: refused, the file unchanged",
          running and r.status_code in (403, 409) and disk(f_new) == d0, f"running={running} {r.status_code} {detail(r)}")
    wait(lambda: s.interp_state == linuxcnc.INTERP_IDLE, 10)

    # U5 — a closed connection's key
    gone = Client(TOKEN, "button-gates-b-gone", arm=True)
    gone.start()
    gone_key = gone.key
    gone.close()
    time.sleep(0.5)
    d0 = disk(f_new)
    r = http("PUT", f"/save?path={f_new}", gone_key, content=b"(after the close)\nM2\n",
             headers={"Content-Type": "text/plain; charset=utf-8"})
    check("U5 save with the key of a closed connection: 403, unchanged",
          r.status_code == 403 and "Connection unknown" in detail(r) and disk(f_new) == d0, f"{r.status_code} {detail(r)}")

    # S1–S5 — settings
    disp = dict(before.get("display") or {})
    r = http("PUT", "/settings/display", observer.key, json={"data": {**disp, "bgLive": STAMP}})
    after = settings()
    check("S1 a display section, observer: saved",
          r.status_code == 200 and (after.get("display") or {}).get("bgLive") == STAMP, f"{r.status_code} {detail(r)}")
    kb = before.get("keyboard")
    snap = settings()
    r = http("PUT", "/settings/keyboard", observer.key, json={"data": {**(kb or {}), "bgLive": STAMP}})
    check("S2 a protected section over HTTP, observer: 403, the store unchanged",
          r.status_code == 403 and "Not armed" in detail(r) and settings() == snap, f"{r.status_code} {detail(r)}")
    r1 = observer.ask("save_settings", section="keyboard", data={**(kb or {}), "bgLive": STAMP})
    unchanged = settings() == snap
    r2 = armed.ask("save_settings", section="keyboard", data={**(kb or {}), "bgLive": STAMP})
    saved = (settings().get("keyboard") or {}).get("bgLive") == STAMP
    check("S3 a protected section over WS: the observer refused, the armed client saved",
          r1.get("ok") is False and "Not armed" in str(r1.get("error")) and unchanged and r2.get("ok") is True and saved,
          f"observer={r1} armed={r2} saved={saved}")
    snap = settings()
    r = http("DELETE", "/settings", observer.key)
    check("S4 the global reset, observer: 403, the store unchanged",
          r.status_code == 403 and settings() == snap, f"{r.status_code} {detail(r)}")
    r = httpx.put(BASE + "/settings/keyboard" + (f"?token={TOKEN}" if TOKEN else ""),
                  json={"data": {**(kb or {}), "bgBeacon": STAMP}, "conn_key": gone_key}, timeout=10)
    check("S5 a page-hide beacon of a closed connection: refused, nothing stored",
          r.status_code == 403 and "Connection unknown" in detail(r) and "bgBeacon" not in (settings().get("keyboard") or {}),
          f"{r.status_code} {detail(r)}")

    # T1 — an M6 request waits
    tools = armed.ask("get_tool_table").get("tools") or []
    t1 = next((t for t in tools if t.get("T") == 1), None)
    remark_before = (t1 or {}).get("remark", "")
    s.poll()
    target = 2 if s.tool_in_spindle != 2 else 3
    tool_before = s.tool_in_spindle
    armed.ask("tool_change", tool_number=target)
    pending = wait(lambda: armed.status.get("tool_change_requested") is True, 10)
    time.sleep(0.6)
    d0 = disk(tbl)
    r = armed.ask("save_tool", tool_number=1, remark=f"bg-b {STAMP}")
    check("T1 a tool-table edit while an M6 request waits: refused, the table unchanged",
          pending and r.get("ok") is False and disk(tbl) == d0, f"pending={pending} reply={r}")
    armed.ask("confirm_tool_change", request=armed.status.get("tool_change_seq"))
    wait(lambda: s.tool_in_spindle == target and s.interp_state == linuxcnc.INTERP_IDLE, 15)

    # T2, U6 — E-Stop
    armed.ask("estop")
    estop = wait(lambda: s.task_state == linuxcnc.STATE_ESTOP, 5)
    time.sleep(0.6)
    r = armed.ask("save_tool", tool_number=1, remark=f"bg-b {STAMP}")
    tools = armed.ask("get_tool_table").get("tools") or []
    got = next((t.get("remark") for t in tools if t.get("T") == 1), None)
    check("T2 a tool-table edit in E-Stop, armed: admitted",
          estop and r.get("ok") is True and got == f"bg-b {STAMP}", f"estop={estop} reply={r} remark={got!r}")
    r = upload(f_estop.name, b"(bg b estop)\nM2\n", armed.key)
    check("U6 upload in E-Stop, armed: admitted",
          r.status_code == 200 and disk(f_estop) is not None, f"{r.status_code} {detail(r)}")
finally:
    try:
        if remark_before is not None:
            armed.ask("save_tool", tool_number=1, remark=remark_before)
        for sec in ("display", "keyboard"):
            armed.ask("save_settings", section=sec, data=before.get(sec, {}))
        print("settings restored:", {k: settings().get(k) == before.get(k, {}) for k in ("display", "keyboard")}, flush=True)
        s.poll()
        if s.task_state == linuxcnc.STATE_ESTOP:
            armed.ask("estop_reset")
            wait(lambda: s.task_state == linuxcnc.STATE_ESTOP_RESET, 5)
            armed.ask("machine_on")
            wait(lambda: s.task_state == linuxcnc.STATE_ON, 5)
        for f in (f_new, f_dwell, f_estop):
            try:
                f.unlink()
            except FileNotFoundError:
                pass
    except Exception as e:
        print("cleanup:", e)
    observer.close()
    armed.close()

print(json.dumps({"results": RESULTS}, indent=1))
sys.exit(0 if all(v == "PASS" for _n, v, _d in RESULTS) else 1)

"""A protocol client in its own process (native stage step 3, plan Codex
R313–R315): the disconnect case drops exactly this connection, or stops this
process so its heartbeat lapses — the run's own client stays.

    proto_client.py <session>      (the token in LCNC_NATIVE_TOKEN, never in argv)

It connects with a hello asking for an armed resume (`resume_armed`), which
with a fresh session traces session.resume_denied_no_match carrying this
connection's client_id; it does not arm by itself. Then it reads JSON lines
on stdin and answers each on stdout:
  {"op": "request", "cmd": …, "kw": {…}}  → {"op": "reply", "cmd", "reply" | "error"}
  {"op": "drop"}                        → the connection ends WITHOUT abort or
                                          disarm; {"op": "dropped"}; exit
The first line out is {"op": "hello", "reply" | "error"} (conn_key removed)."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from test_support.live_session import SimulatorClient  # noqa: E402


def out(obj) -> None:
    print(json.dumps(obj, default=str), flush=True)


def main(argv=None) -> int:
    session = (argv or sys.argv[1:])[0]
    c = SimulatorClient(os.environ.get("LCNC_NATIVE_TOKEN", ""), session=session, auto_confirm=False)
    try:
        c.start(arm=False, resume=True)
    except Exception as e:  # noqa: BLE001 — the parent decides
        out({"op": "hello", "error": f"{type(e).__name__}: {e}"})
        return 1
    out({"op": "hello", "reply": {k: v for k, v in c.hello_reply.items() if k != "conn_key"}})
    for line in sys.stdin:
        msg = json.loads(line)
        if msg.get("op") == "drop":
            c.drop()
            out({"op": "dropped"})
            return 0
        try:
            out({"op": "reply", "cmd": msg["cmd"], "reply": c.request(msg["cmd"], **msg.get("kw", {}))})
        except Exception as e:  # noqa: BLE001
            out({"op": "reply", "cmd": msg["cmd"], "error": f"{type(e).__name__}: {e}"})
    c.drop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

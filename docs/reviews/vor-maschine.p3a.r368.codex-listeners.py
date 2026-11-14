"""R368 offline target proof: preserve evidence about EVERY listener.

Only the real pure helpers are executed. ss and /proc are injected text;
no native module, socket, process discovery or controller is used.
"""
import json
from pathlib import Path

from test_support import live_target as lt

OUT = []
INI = "/tmp/r368-run/lcnc_suite_sim_3axis_xyz.ini"
KNOWN = 'LISTEN 0 2048 127.0.0.2:4188 0.0.0.0:* users:(("python3",pid=77,fd=9))\n'
UNKNOWN = 'LISTEN 0 2048 127.0.0.1:4188 0.0.0.0:*\n'


def check(name, ss_text):
    def read(pid, kind):
        assert pid == 77
        return ([b"python3", b"-m", b"uvicorn", b"gateway:app"] if kind == "cmdline"
                else [b"INI_FILE_NAME=" + INI.encode()])
    pids = lt.listening_pids(4188, run=lambda argv: ss_text)
    problems = lt.gateway_target_problems(4188, INI, pids, read)
    result = {"case": name, "ss": ss_text, "pids": pids, "problems": problems,
              "driver_connects_to": "ws://127.0.0.1:4188/ws"}
    OUT.append(result)
    Path("/tmp/r368-listeners.json").write_text(json.dumps(OUT, indent=2))
    return problems


def test_unknown_listener_alone_is_refused():
    assert check("unknown_alone", UNKNOWN)


def test_known_listener_on_the_connection_endpoint_is_accepted():
    assert check("known_on_loopback", KNOWN.replace("127.0.0.2", "127.0.0.1")) == []


def test_unknown_loopback_listener_beside_a_known_gateway_is_refused():
    assert check("unknown_loopback_beside_known_gateway", KNOWN + UNKNOWN), \
        "The known process on 127.0.0.2 does not prove the listener on 127.0.0.1."

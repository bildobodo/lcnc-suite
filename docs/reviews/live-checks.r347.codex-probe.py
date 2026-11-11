"""R347 independent offline counterchecks. No real network or LinuxCNC.

Usage: gateway-venv/bin/python probe_r347.py /tmp/archive-00adb83c
External effects are replaced; real Viewer reader/request, preview scenario,
trace sender/parser, trace_window and run() are exercised.
"""
import asyncio
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import types
from unittest.mock import patch

ROOT = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(ROOT / "lcnc-gateway"))
from gateway_util import parse_telemetry_batch


def load(path):
    spec = importlib.util.spec_from_file_location("r347_perf", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


results = {"preview": {}, "trace": {}}
with tempfile.TemporaryDirectory(prefix="codex-r347-probe-") as temp:
    temp = Path(temp)
    ini = temp / "fake.ini"
    ini.write_text("[DISPLAY]\nWEBUI_PORT = 1\nWEBUI_TOKEN = fake\n")
    with patch.dict(os.environ, {"LCNC_INI_FILE": str(ini), "LCNC_WEBUI_PORT": "1", "LCNC_WEBUI_TOKEN": "fake"}):
        pm = load(ROOT / "scripts/perf_matrix.py")
    program = temp / "fixture.ngc"

    def local_open(path, *a, **kw):
        return open(program if str(path) == "/tmp/perfmatrix-big.ngc" else path, *a, **kw)

    def make_program(*a):
        program.write_text("G21 G90\nG0 X1\nM2\n")

    def preview_case(case):
        sent = []

        class Wire:
            def __init__(self):
                self.q = asyncio.Queue()
                self.writer = False

            def __aiter__(self):
                return self

            async def __anext__(self):
                return await self.q.get()

            def reply(self, value):
                self.q.put_nowait(json.dumps(value))

            async def send(self, raw):
                m = json.loads(raw)
                sent.append(m)
                if m["cmd"] == "hello":
                    self.writer = m["session"] == "perfmx-writer"
                    self.reply({"type": "reply", "ok": True, "conn_key": "fake-key"})
                    self.reply({"type": "status", "data": {"interp_state": 1}})
                    return
                if m["cmd"] == "heartbeat":
                    return
                own_reply = {"type": "reply", "cmd": m["cmd"], "req_id": m.get("req_id"), "ok": True}
                if m["cmd"] == "arm":
                    # Successful foreign answer must not satisfy this request.
                    if case == "arm_wrong_echo" and m["armed"] and not self.writer:
                        self.reply({**own_reply, "req_id": "someone-else"})
                    else:
                        self.reply({**own_reply, "armed": m["armed"]})
                elif m["cmd"] == "load_file":
                    source = hashlib.sha256(program.read_bytes()).hexdigest()
                    ready = {"type": "viewer_gcode_ready", "version": 21,
                             "file": m["path"], "origin": {"source": source}}
                    if case == "load_wrong_echo_with_own_ready":
                        self.reply({**own_reply, "req_id": "someone-else"})
                        self.reply(ready)
                    elif case == "load_refused_with_own_ready":
                        self.reply({**own_reply, "ok": False, "error": "busy"})
                        self.reply(ready)
                    elif case == "ready_before_load_reply":
                        self.reply(ready)
                        self.reply(own_reply)
                    elif case == "unknown_source":
                        self.reply(own_reply)
                        self.reply({**ready, "origin": {"source": None}})
                    elif case == "foreign_source":
                        self.reply(own_reply)
                        self.reply({**ready, "origin": {"source": "0" * 64}})
                    else:
                        self.reply(own_reply)
                        self.reply({**ready, "version": 20, "origin": {"source": "0" * 64}})
                        self.reply(ready)

            async def close(self):
                pass

        async def connect(*a, **kw):
            return Wire()

        with patch.object(pm.websockets, "connect", connect), \
                patch.object(pm, "gen_gcode", make_program), \
                patch.object(pm, "open", local_open, create=True), \
                patch.object(pm.requests, "post", lambda *a, **k: types.SimpleNamespace(status_code=200)), \
                patch.object(pm, "REPLY_TIMEOUT_S", 0.08), patch.object(pm, "PUBLISH_TIMEOUT_S", 0.08), \
                patch.object(pm, "STALE_NOTIFY_S", 0), patch.object(pm, "SETTLE_S", 0), \
                patch.object(pm, "LIVENESS_FAILED", False), patch.object(pm, "DELIVERY_FAILED", False), \
                contextlib.redirect_stdout(io.StringIO()):
            direct = asyncio.run(pm.sc_preview(types.SimpleNamespace(allow_arm=True, upload_mb=1)))
            verdict = "FAIL" if pm.scenario_failure(direct) or pm.DELIVERY_FAILED or pm.LIVENESS_FAILED else "PASS"
        if case == "arm_wrong_echo":
            assert direct["arm_ok"] is False and not any(m["cmd"] == "load_file" for m in sent)
        elif case.startswith("load_"):
            assert direct["load_ok"] is False and "delivered" not in direct
        elif case in ("unknown_source", "foreign_source"):
            assert direct["delivered"] is False
        else:
            assert direct["delivered"] is True and direct["version_after"] == 21
        assert verdict == ("PASS" if case in ("ready_before_load_reply", "foreign_then_own") else "FAIL")
        return {"verdict": verdict, "direct": direct}

    for case in ("arm_wrong_echo", "load_wrong_echo_with_own_ready", "load_refused_with_own_ready",
                 "unknown_source", "foreign_source", "ready_before_load_reply", "foreign_then_own"):
        results["preview"][case] = preview_case(case)

    def trace_case(case):
        folder = temp / case
        folder.mkdir()
        trace = folder / "trace.ndjson"
        if case != "missing":
            trace.touch()
        posts = []

        def post(url, *, data, headers, timeout):
            assert url.endswith("/telemetry")
            assert headers["Content-Type"] == "application/x-ndjson"
            events, rejected = parse_telemetry_batch(data)
            assert rejected == 0 and len(events) == 1
            kind, fields = events[0]
            assert kind == "perfmatrix_mark" and fields["run"] == pm.RUN_ID
            posts.append(fields["at"])
            record = {"t_wall_ns": time.time_ns(), "pid": 4242, "proc": "gateway",
                      "tag": "browser." + kind, **fields}
            write = case not in ("missing", "empty")
            if case == "only_start" and fields["at"] == "end": write = False
            if case == "only_end" and fields["at"] == "start": write = False
            if case == "old": record["t_wall_ns"] = 1
            if case == "other_run": record["run"] = "another-run"
            if case == "other_scenario": record["scenario"] = "another-scenario"
            if case == "other_pid" or (case == "mixed_pid" and fields["at"] == "end"): record["pid"] = 999
            if write:
                with trace.open("a") as f: f.write(json.dumps(record) + "\n")
            return types.SimpleNamespace(status_code=200, json=lambda: {"ok": True, "events": 1})

        async def measured(args):
            return {"status": 200, "status_rx": 3}

        with patch.object(pm, "REPO", str(folder)), patch.object(pm, "TRACE", str(trace)), \
                patch.object(pm, "SCENARIOS", {"probe": measured}), patch.object(pm, "SCENARIO_FAILURES", {}), \
                patch.object(pm, "LIVENESS_FAILED", False), patch.object(pm, "DELIVERY_FAILED", False), \
                patch.object(pm, "TRACE_PAD_S", 0), patch.object(pm, "gateway_pid", lambda: 4242), \
                patch.object(pm, "gateway_rss_kb", lambda _: 1000), \
                patch.object(pm.subprocess, "run", lambda *a, **k: types.SimpleNamespace(stdout="00adb83c\n")), \
                patch.object(pm.requests, "post", post), contextlib.redirect_stdout(io.StringIO()):
            rc = asyncio.run(pm.run(types.SimpleNamespace(scenarios=["probe"])))
        report = json.loads(next((folder / "runlogs/perf-matrix").iterdir()).read_text())
        assert posts == ["start", "end"]
        assert rc == (0 if case == "valid_no_lag" else 1)
        return {"exit": rc, **report["scenarios"]["probe"]}

    for case in ("missing", "empty", "old", "other_run", "other_scenario", "only_start", "only_end",
                 "other_pid", "mixed_pid", "valid_no_lag"):
        results["trace"][case] = trace_case(case)

print(json.dumps(results, ensure_ascii=False, indent=2))

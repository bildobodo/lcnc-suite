"""Offline guards of perf_matrix.py's own verdict (2026-11-11 live checks).

The matrix measured upload_during_stream and save_during_stream against a
gateway that refused both writes 403 in 6–62 ms (no X-Conn-Key since button
gates BG-14) and still answered 0: a scenario's own result never decided the
run. These pin the two halves of the fix: `armed_writer` gets the hello
reply's conn_key and an armed connection (or raises), and `run()` fails on a
scenario whose result is no measurement (`scenario_failure`)."""
import asyncio
import importlib
import json
import os
import socket
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import websockets

HERE = Path(__file__).resolve().parent


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


PORT = _free_port()
_INI = tempfile.NamedTemporaryFile("w", suffix=".ini", delete=False)
_INI.write(f"[DISPLAY]\nWEBUI_PORT = {PORT}\n")
_INI.close()
with mock.patch.dict(os.environ, {"LCNC_INI_FILE": _INI.name}):
    os.environ.pop("LCNC_WEBUI_TOKEN", None)
    os.environ.pop("LCNC_WEBUI_PORT", None)
    sys.path.insert(0, str(HERE))
    pm = importlib.import_module("perf_matrix")

#: the scenarios' `direct` results of the first live pass (2026-11-11,
#: f54f3120, runlogs/perf-matrix/20261111T185606Z-f54f3120.json) — the run
#: answered 0 for the two 403s
PASS1 = {
    "upload_during_stream": {"status": 403, "upload_ms": 62, "size_mb": 40.0, "viewer_frames": 57},
    "save_during_stream": {"status": 403, "save_ms": 6, "size_mb": 40.0},
    "fusion_near_limit": {"status": 200, "import_ms": 504, "size_mb": 13.8},
    "sigstop_trip": {"latch_before": "FALSE", "latch_after_resume": "TRUE", "sticky_ok": True,
                     "latch_after_reset": "FALSE", "recovered_ok": True},
    "idle_baseline": {"viewer_frames": 248, "status_rx": 200},
}


class ScenarioFailure(unittest.TestCase):
    def test_the_first_pass_403s_fail_and_the_measurements_stand(self):
        got = {k: pm.scenario_failure(v) for k, v in PASS1.items()}
        self.assertEqual(got["upload_during_stream"], "status 403")
        self.assertEqual(got["save_during_stream"], "status 403")
        for name in ("fusion_near_limit", "sigstop_trip", "idle_baseline"):
            self.assertIsNone(got[name], name)

    def test_an_upload_status_an_exception_and_a_property_not_held_fail(self):
        self.assertEqual(pm.scenario_failure({"upload_status": 409, "delivered": True}), "upload_status 409")
        self.assertEqual(pm.scenario_failure({"error": "RuntimeError: no armed writer"}),
                         "error: RuntimeError: no armed writer")
        self.assertEqual(pm.scenario_failure({"sticky_ok": False, "recovered_ok": True}), "sticky_ok False")
        self.assertEqual(pm.scenario_failure({"recovered_ok": None}), "recovered_ok None")
        self.assertEqual(pm.scenario_failure({"status": None}), "status None")

    def test_a_skipped_scenario_is_no_failure(self):
        self.assertIsNone(pm.scenario_failure({"skipped": "needs --allow-arm"}))


class _FakeGateway:
    """hello → the reply with conn_key (no req_id, like the gateway); arm →
    its reply, refused when `arm_ok` is False. Records every frame."""

    def __init__(self, arm_ok=True):
        self.arm_ok, self.frames = arm_ok, []

    async def handler(self, ws):
        async for raw in ws:
            msg = json.loads(raw)
            self.frames.append(msg)
            if msg.get("cmd") == "hello":
                await ws.send(json.dumps({"type": "reply", "ok": True, "armed": False, "conn_key": "ck-1"}))
            elif msg.get("cmd") == "arm":
                ok = self.arm_ok or not msg.get("armed")
                await ws.send(json.dumps({"type": "reply", "cmd": "arm", "ok": ok,
                                          **({} if ok else {"error": "Safety trip — acknowledge first"})}))


class ArmedWriter(unittest.TestCase):
    def _run(self, gw, body):
        async def main():
            async with websockets.serve(gw.handler, "127.0.0.1", PORT):
                return await body()
        return asyncio.run(main())

    def test_the_writes_name_the_armed_connection_and_it_disarms_after(self):
        gw = _FakeGateway()

        async def body():
            async with pm.armed_writer() as hdrs:
                return dict(hdrs)
        hdrs = self._run(gw, body)
        self.assertEqual(hdrs.get("X-Conn-Key"), "ck-1")
        arms = [f["armed"] for f in gw.frames if f.get("cmd") == "arm"]
        self.assertEqual(arms, [True, False])

    def test_a_refused_arm_raises_before_any_write(self):
        gw = _FakeGateway(arm_ok=False)
        reached = []

        async def body():
            async with pm.armed_writer():
                reached.append(True)
        with self.assertRaisesRegex(RuntimeError, "no armed writer"):
            self._run(gw, body)
        self.assertEqual(reached, [])


class RunVerdict(unittest.TestCase):
    def test_a_scenario_that_measured_nothing_fails_the_run(self):
        async def refused(_args):
            return dict(PASS1["upload_during_stream"])

        async def no_pad(_s):
            return None
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.object(pm, "SCENARIOS", {"upload_during_stream": refused}), \
                mock.patch.object(pm, "SCENARIO_FAILURES", {}), \
                mock.patch.object(pm, "REPO", tmp), \
                mock.patch.object(pm, "gateway_pid", lambda: 4242), \
                mock.patch.object(pm, "gateway_rss_kb", lambda _pid: 1), \
                mock.patch.object(pm, "trace_window", lambda _a, _b: {}), \
                mock.patch.object(pm.asyncio, "sleep", no_pad):
            args = mock.Mock(scenarios=[], allow_arm=True, allow_trip=True)
            rc = asyncio.run(pm.run(args))
            report = json.loads(next(Path(tmp, "runlogs", "perf-matrix").iterdir()).read_text())
        self.assertEqual(rc, 1)
        self.assertEqual(report["scenarios"]["upload_during_stream"]["FAIL"], "status 403")


if __name__ == "__main__":
    unittest.main()

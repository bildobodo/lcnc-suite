"""Offline guards of perf_matrix.py's own verdict (2026-11-11 live checks).

The matrix measured upload_during_stream and save_during_stream against a
gateway that refused both writes 403 in 6–62 ms (no X-Conn-Key since button
gates BG-14) and still answered 0: a scenario's own result never decided the
run. These pin the two halves of the fix: `armed_writer` gets the hello
reply's conn_key and an armed connection (or raises), and `run()` fails on a
scenario whose result is no measurement (`scenario_failure`)."""
import asyncio
import contextlib
import hashlib
import importlib
import io
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
    """The gateway's wire as its handlers send it (gateway.py
    _execute_client_command): hello → the reply with conn_key and NO req_id;
    every command → {"type": "reply", "cmd", "req_id" echoed, ...}. `arm`
    is refused when `arm_ok` is False — with "viewer", only for a connection
    whose hello session is not the writer's. `load_file` per `load`: "ok", "refused"
    (the busy machine's reason), "silent" (no reply); then `ready` frames are
    pushed — "own" = the uploaded program's source (sha256 of
    /tmp/perfmatrix-big.ngc as the load finds it), "other" = another program's
    publication with a newer version. Records every frame."""

    def __init__(self, arm_ok=True, load="ok", ready=()):
        self.arm_ok, self.load, self.ready_kinds, self.frames = arm_ok, load, ready, []

    async def handler(self, ws):
        session = None
        async for raw in ws:
            msg = json.loads(raw)
            self.frames.append(msg)
            echo = {"req_id": msg["req_id"]} if "req_id" in msg else {}
            if msg.get("cmd") == "hello":
                session = msg.get("session")
                await ws.send(json.dumps({"type": "reply", "ok": True, "armed": False, "conn_key": "ck-1"}))
            elif msg.get("cmd") == "arm":
                ok = (self.arm_ok is True or not msg.get("armed")
                      or (self.arm_ok == "viewer" and session == "perfmx-writer"))
                await ws.send(json.dumps({"type": "reply", "cmd": "arm", **echo, "ok": ok,
                                          **({"armed": bool(msg.get("armed"))} if ok
                                             else {"error": "Safety trip — acknowledge first"})}))
            elif msg.get("cmd") == "load_file":
                if self.load == "ok":
                    await ws.send(json.dumps({"type": "reply", "cmd": "load_file", **echo, "ok": True}))
                elif self.load == "refused":
                    await ws.send(json.dumps({"type": "reply", "cmd": "load_file", **echo, "ok": False,
                                              "error": "A program or macro is starting or running — wait"}))
                with open("/tmp/perfmatrix-big.ngc", "rb") as f:
                    own = hashlib.sha256(f.read()).hexdigest()
                for n, kind in enumerate(self.ready_kinds):
                    await ws.send(json.dumps({
                        "type": "viewer_gcode_ready", "version": 11 + n, "file": msg.get("path"),
                        "origin": {"source": own if kind == "own" else "f" * 64, "version": 11 + n}}))


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


class ArmOnlyWithTheFlag(unittest.TestCase):
    def test_the_writes_skip_without_allow_arm_and_nothing_is_armed(self):
        gw = _FakeGateway()

        async def main():
            async with websockets.serve(gw.handler, "127.0.0.1", PORT):
                args = mock.Mock(allow_arm=False, upload_mb=1)
                return [await pm.SCENARIOS[n](args) for n in ("upload_during_stream", "save_during_stream")]
        got = asyncio.run(main())
        self.assertTrue(all("skipped" in r for r in got), got)
        self.assertEqual(gw.frames, [])          # not even a connection's hello


def _no_pause(test):
    """The scenario and runner pauses at zero, the publication wait short —
    never asyncio.sleep itself (the fake server and websockets use it)."""
    for name, value in (("TRACE_PAD_S", 0.0), ("STALE_NOTIFY_S", 0.0), ("SETTLE_S", 0.0),
                        ("PUBLISH_TIMEOUT_S", 1.5), ("REPLY_TIMEOUT_S", 1.5)):
        patcher = mock.patch.object(pm, name, value)
        patcher.start()
        test.addCleanup(patcher.stop)


class RunVerdict(unittest.TestCase):
    """The run's verdict over a scenario's own result AND its trace (Codex
    R346 LC-04): the REAL trace_window on a temp trace file; only the mark
    sender is replaced — `writes` decides whether the "gateway" writes the
    marks into that file, and with which pid."""

    GATEWAY = 4242

    def setUp(self):
        _no_pause(self)
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(lambda: __import__("shutil").rmtree(self.tmp, ignore_errors=True))

    def run_matrix(self, direct, trace, writes=None, run_id=None, delivery_failed=False):
        """`trace`: "missing" | "empty" | "old" | "fresh"; `writes`: the pid
        the marks are written with, None = not written; `run_id`: whose run
        the written marks name (default: this run). → (rc, entry, stdout)."""
        path = self.tmp / "trace.ndjson"
        if trace == "empty":
            path.touch()
        elif trace in ("old", "fresh"):
            old = [{"t_wall_ns": 1, "pid": self.GATEWAY, "tag": "lag.window", "drift_ms": 0.0},
                   {"t_wall_ns": 2, "pid": self.GATEWAY, "tag": "browser.perfmatrix_mark", "run": "an-old-run",
                    "scenario": "probe", "at": "start"}]
            path.write_text("".join(json.dumps(e) + "\n" for e in old))

        async def mark(scenario, at):
            if writes is None:
                return "ConnectionError: refused"
            with open(path, "a") as f:
                f.write(json.dumps({"t_wall_ns": __import__("time").time_ns(), "proc": "gateway", "pid": writes,
                                    "tag": "browser.perfmatrix_mark", "run": run_id or pm.RUN_ID,
                                    "scenario": scenario,
                                    "at": at, "peer": "127.0.0.1:1"}) + "\n")
            return "ok"

        async def scenario(_args):
            return dict(direct)
        out = self.tmp / "out"
        with mock.patch.object(pm, "SCENARIOS", {"probe": scenario}), \
                mock.patch.object(pm, "SCENARIO_FAILURES", {}), \
                mock.patch.object(pm, "DELIVERY_FAILED", delivery_failed), \
                mock.patch.object(pm, "LIVENESS_FAILED", False), \
                contextlib.redirect_stdout(io.StringIO()) as printed, \
                mock.patch.object(pm, "REPO", str(out)), mock.patch.object(pm, "TRACE", str(path)), \
                mock.patch.object(pm, "gateway_pid", lambda: self.GATEWAY), \
                mock.patch.object(pm, "gateway_rss_kb", lambda _pid: 1), \
                mock.patch.object(pm, "trace_mark", mark):
            rc = asyncio.run(pm.run(mock.Mock(scenarios=[], allow_arm=True, allow_trip=True)))
        report = json.loads(next(Path(out, "runlogs", "perf-matrix").iterdir()).read_text())
        self.printed = printed.getvalue()
        return rc, report["scenarios"]["probe"]

    MEASURED = {"status": 200, "upload_ms": 90, "size_mb": 40.0, "status_rx": 36}

    def test_a_scenario_that_measured_nothing_fails_the_run(self):
        rc, entry = self.run_matrix(PASS1["upload_during_stream"], "fresh", writes=self.GATEWAY)
        self.assertEqual(rc, 1)
        self.assertEqual(entry["FAIL"], "status 403")

    def test_a_valid_window_without_a_lag_event_passes(self):
        rc, entry = self.run_matrix(self.MEASURED, "fresh", writes=self.GATEWAY)
        self.assertEqual((rc, entry.get("FAIL")), (0, None))
        self.assertEqual((entry["trace"]["lag_windows"], entry["trace"]["marks"]), (0, ["end", "start"]))

    def test_a_missing_trace_fails(self):            # Codex's trace_missing
        rc, entry = self.run_matrix(self.MEASURED, "missing")
        self.assertEqual(rc, 1)
        self.assertIn("trace: no trace file", entry["FAIL"])

    def test_an_empty_trace_fails(self):             # Codex's trace_empty
        rc, entry = self.run_matrix(self.MEASURED, "empty")
        self.assertEqual(rc, 1)
        self.assertIn("no start/end mark of run", entry["FAIL"])
        self.assertIn("start mark ConnectionError", entry["FAIL"])

    def test_an_old_trace_fails_even_with_an_old_runs_mark(self):     # Codex's trace_old
        rc, entry = self.run_matrix(self.MEASURED, "old")
        self.assertEqual(rc, 1)
        self.assertIn("no start/end mark of run", entry["FAIL"])

    def test_marks_of_another_run_in_the_window_fail(self):
        rc, entry = self.run_matrix(self.MEASURED, "fresh", writes=self.GATEWAY, run_id="another-run")
        self.assertEqual(rc, 1)
        self.assertIn("no start/end mark of run", entry["FAIL"])

    def test_the_result_names_every_reason(self):
        rc, _entry = self.run_matrix(PASS1["save_during_stream"], "fresh", writes=self.GATEWAY,
                                     delivery_failed=True)
        result = [ln for ln in self.printed.splitlines() if ln.startswith("RESULT:")]
        self.assertEqual(rc, 1)
        self.assertEqual(len(result), 1)
        self.assertIn("(delivery)", result[0])
        self.assertIn("(scenario) probe: status 403", result[0])

    def test_marks_another_process_wrote_fail(self):
        rc, entry = self.run_matrix(self.MEASURED, "fresh", writes=999)
        self.assertEqual(rc, 1)
        self.assertIn("written by pid [999], the measured gateway is 4242", entry["FAIL"])


class PreviewBinding(unittest.TestCase):
    """preview_publish's delivery is ITS upload published after ITS taken
    load (Codex R346 LC-03): the real scenario and Viewer against the fake
    gateway's wire; only the HTTP upload is replaced (200)."""

    def setUp(self):
        _no_pause(self)
        for name, value in (("DELIVERY_FAILED", False),):
            patcher = mock.patch.object(pm, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.addCleanup(lambda: os.path.exists("/tmp/perfmatrix-big.ngc") and os.remove("/tmp/perfmatrix-big.ngc"))

    def preview(self, gw):
        async def main():
            async with websockets.serve(gw.handler, "127.0.0.1", PORT):
                with mock.patch.object(pm.requests, "post",
                                       lambda *a, **k: mock.Mock(status_code=200, json=lambda: {"ok": True})):
                    return await pm.SCENARIOS["preview_publish"](mock.Mock(allow_arm=True, upload_mb=1))
        return asyncio.run(main())

    def test_a_refused_load_with_another_publication_fails(self):     # Codex's preview_refused_with_other_ready
        d = self.preview(_FakeGateway(load="refused", ready=("other",)))
        self.assertEqual((d["load_ok"], d["load_error"]), (False, "A program or macro is starting or running — wait"))
        self.assertNotIn("delivered", d)
        self.assertEqual(pm.scenario_failure(d), "load_ok False")

    def test_a_taken_load_with_only_another_publication_is_no_delivery(self):
        gw = _FakeGateway(load="ok", ready=("other", "other"))
        d = self.preview(gw)
        self.assertEqual((d["load_ok"], d["delivered"]), (True, False))
        self.assertTrue(pm.DELIVERY_FAILED)
        self.assertEqual([r["version"] for r in d["other_ready"]], [11, 12])

    def test_a_load_without_reply_fails(self):
        d = self.preview(_FakeGateway(load="silent", ready=("own",)))
        self.assertEqual((d["load_ok"], d["load_error"]), (False, "no reply"))

    def test_a_refused_writer_arm_ends_before_the_upload(self):
        gw = _FakeGateway(arm_ok=False)
        with self.assertRaisesRegex(RuntimeError, "no armed writer"):
            self.preview(gw)
        self.assertFalse([f for f in gw.frames if f.get("cmd") == "load_file"])

    def test_a_refused_viewer_arm_sends_no_load(self):
        gw = _FakeGateway(arm_ok="viewer", ready=("own",))
        d = self.preview(gw)
        self.assertEqual((d["arm_ok"], d["arm_error"]), (False, "Safety trip — acknowledge first"))
        self.assertEqual(pm.scenario_failure(d), "arm_ok False")
        self.assertFalse([f for f in gw.frames if f.get("cmd") == "load_file"])

    def test_its_own_publication_after_another_is_the_delivery(self):
        gw = _FakeGateway(load="ok", ready=("other", "own"))
        d = self.preview(gw)
        self.assertEqual((d["load_ok"], d["delivered"], d["version_after"]), (True, True, 12))
        self.assertFalse(pm.DELIVERY_FAILED)
        self.assertIsNone(pm.scenario_failure(d))
        disarm = [f for f in gw.frames if f.get("cmd") == "arm"][-1]
        self.assertEqual(disarm["armed"], False)


if __name__ == "__main__":
    unittest.main()

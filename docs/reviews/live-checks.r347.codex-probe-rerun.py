"""RERUN COPY (Claude, R347): Codex's R346 probe with its exit-0 asserts turned into records.
R346 review probes. Only fake transports; no LinuxCNC, HAL or live ports.

Usage: gateway-venv/bin/python probe_r346.py /tmp/archive-c5516463
Prints observations as JSON; assertions pin the observed head, not a fix.
"""
import ast
import asyncio
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import types
from unittest.mock import patch

ROOT = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(ROOT / "scripts"))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


with tempfile.TemporaryDirectory(prefix="r346-probe-") as tmp:
    tmp = Path(tmp)
    ini = tmp / "fake.ini"
    ini.write_text("[DISPLAY]\nWEBUI_PORT = 1\nWEBUI_TOKEN = fake\n")
    with patch.dict(os.environ, {"LCNC_INI_FILE": str(ini), "LCNC_WEBUI_TOKEN": "fake", "LCNC_WEBUI_PORT": "1"}):
        pm = load("r346_perf", ROOT / "scripts/perf_matrix.py")
    # Importing the real LinuxCNC binding would bind the live controller.
    with patch.dict(sys.modules, {"linuxcnc": types.SimpleNamespace(stat=lambda: object())}):
        ml = load("r346_macro", ROOT / "scripts/macro_live_check.py")

    results = {}

    class Wire:
        def __aiter__(self):
            async def frames():
                yield json.dumps({"type": "reply", "ok": True, "conn_key": "fake-connection"})
                yield json.dumps({"type": "reply", "ok": True, "req_id": "mlc-7"})
            return frames()

    macro = ml.Gateway("ws://unused", "fake-token", 1)
    macro.ws = Wire()
    asyncio.run(macro._reader())
    captured = []

    def urlopen(req, **kw):
        captured.append(dict(req.header_items()))
        return contextlib.closing(io.BytesIO(b"{}"))

    with patch.object(ml.urllib.request, "urlopen", urlopen):
        macro.http("/macro", "PUT", b"fake")
    assert macro.conn_key == "fake-connection"
    assert captured[0]["X-conn-key"] == macro.conn_key
    assert "mlc-7" in macro.replies
    results["macro_hello_without_req_id_and_http_header"] = "PASS"

    # Execute the actual nested predicate, not a second implementation.
    tree = ast.parse((ROOT / "scripts/macro_live_check.py").read_text())
    busy_node = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "busy")
    scope = {"MACHINE_BUSY": ml.MACHINE_BUSY}
    exec(compile(ast.Module(body=[busy_node], type_ignores=[]), "macro-busy", "exec"), scope)
    accepted = {reason: scope["busy"]((409, "busy", reason)) for reason in
                (*ml.MACHINE_BUSY, "Connection unknown", "Not armed")}
    assert list(accepted.values()) == [True, True, False, False]
    results["macro_busy_reason"] = accepted

    # The settings reader must copy the received revision map.
    from test_support.live_session import SimulatorClient
    c = SimulatorClient("fake")
    revs = {"toolsetter": 3}
    c.take({"type": "settings_init", "revs": revs})
    revs["toolsetter"] = 999
    assert c.settings_revs == {"toolsetter": 3}
    c.take({"type": "settings_changed", "revs": {"toolsetter": 4}})
    c.take({"type": "status_delta", "data": {"interp_state": 1}})
    assert c.settings_revs == {"toolsetter": 4}
    results["settings_revisions"] = "PASS"

    async def no_sleep(_):
        pass

    async def measured(_):
        return {"status": 200, "upload_ms": 90, "size_mb": 40, "status_rx": 36}

    def run_case(name, scenario, trace_path):
        out = tmp / name
        out.mkdir()
        with patch.object(pm, "REPO", str(out)), patch.object(pm, "TRACE", str(trace_path)), \
                patch.object(pm, "gateway_pid", lambda: 4242), \
                patch.object(pm, "gateway_rss_kb", lambda _: 81920), \
                patch.object(pm, "SCENARIOS", {name: scenario}), \
                patch.object(pm, "SCENARIO_FAILURES", {}), \
                patch.object(pm, "LIVENESS_FAILED", False), patch.object(pm, "DELIVERY_FAILED", False), \
                patch.object(pm.asyncio, "sleep", no_sleep), \
                patch.object(pm.subprocess, "run", lambda *a, **k: types.SimpleNamespace(stdout="c5516463\n")), \
                contextlib.redirect_stdout(io.StringIO()):
            rc = asyncio.run(pm.run(types.SimpleNamespace(scenarios=[name], allow_arm=True, upload_mb=1)))
        report = json.loads(next((out / "runlogs/perf-matrix").iterdir()).read_text())
        return {"exit": rc, **report["scenarios"][name]}

    missing = tmp / "absent-trace.ndjson"
    empty = tmp / "empty-trace.ndjson"
    empty.touch()
    stale = tmp / "old-trace.ndjson"
    stale.write_text(json.dumps({"tag": "ws.connect.accept", "t_wall_ns": 1}) + "\n")
    for name, path in (("trace_missing", missing), ("trace_empty", empty), ("trace_old", stale)):
        results[name] = run_case(name, measured, path)
        pass  # rerun: recorded, not asserted

    # A rejected load plus another ready notification. Run the real preview
    # scenario, Viewer orchestration and verdict; fake ONLY external effects.
    commands = []

    class FakeViewer:
        def __init__(self, *a, **k):
            self.status_frames = 3
            self.gcode_version = 10
            self.last_reply_error = None

        async def connect(self):
            pass

        async def close(self):
            pass

        async def send(self, obj):
            commands.append(obj)
            if obj["cmd"] == "load_file":
                self.last_reply_error = "A program or macro is starting or running — wait"
                # E.g. a previously in-flight parse or another client's one.
                self.gcode_version = 11

    @contextlib.asynccontextmanager
    async def writer():
        yield {"X-Conn-Key": "fake-connection"}

    program = tmp / "program.ngc"
    program.write_text("M2\n")

    def fake_open(path, *a, **kw):
        if str(path) == "/tmp/perfmatrix-big.ngc":
            path = program
        return open(path, *a, **kw)

    with patch.object(pm, "Viewer", FakeViewer), patch.object(pm, "armed_writer", writer), \
            patch.object(pm, "gen_gcode", lambda *a: None), patch.object(pm, "open", fake_open, create=True), \
            patch.object(pm.requests, "post", lambda *a, **k: types.SimpleNamespace(status_code=200)), \
            patch.object(pm, "trace_window", lambda *a: {"ws_connects": 2, "lag_windows": 1, "lag_max_drift_ms": 1}):
        results["preview_refused_with_other_ready"] = run_case("preview_publish", pm.sc_preview, missing)
    got = results["preview_refused_with_other_ready"]
    results["preview_commands"] = commands
    print(json.dumps(results, ensure_ascii=False, indent=2))

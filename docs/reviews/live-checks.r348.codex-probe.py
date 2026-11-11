"""R348 independent review probe. No systemd, LinuxCNC, LAN or real gate.

Usage: gateway-venv/bin/python probe_r348.py /tmp/archive-c7f72261
Uses isolated AF_UNIX test sockets under /tmp; all host and gate effects
are replaced with sentinels. The production entry points remain unchanged.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import sys
import tempfile
import types
from unittest.mock import patch

ROOT = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(ROOT / "scripts"))
import install_probe as ip
from test_support import install_cases as ic, install_restore as ir
from test_select import round_gate as rg

HEAD = "c7f7226180a03a3b0761a4fb6ffe3c167309b3b7"
results = {"socket_boundaries": [], "probe_entry": [], "gate_entry": []}


def forbidden(*a, **k):
    raise AssertionError("forbidden host/run operation reached")


with tempfile.TemporaryDirectory(prefix="r348-") as raw:
    temp = Path(raw)

    def run_path(n, label):
        base = temp / label
        left = n - len(os.fsencode(base / "home/.rtapi_fifo"))
        assert left >= 0
        return Path(str(base) + "x" * left)

    for n, label in ((106, "ascii-a"), (107, "ascii-b"), (108, "ascii-c"), (140, "ascii-d"),
                     (107, "unicode-ä"), (108, "unicode-ö")):
        run = run_path(n, label)
        home = run / "home"
        home.mkdir(parents=True)
        fifo = Path(ic.child_env(run, home)["HOME"]) / ".rtapi_fifo"
        assert len(os.fsencode(fifo)) == n
        problem = ic.run_dir_problem(run)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            try:
                s.bind(str(fifo))
                bound, error = True, None
            except OSError as e:
                bound, error = False, str(e)
        if fifo.exists(): fifo.unlink()
        assert bound == (n < 108) == (problem is None)
        results["socket_boundaries"].append({"label": label, "bytes": n, "characters": len(str(fifo)),
                                             "bind_ok": bound, "bind_error": error, "refusal": problem})

    # The exact entry point rejects before creating a host or taking a lock.
    # Its ExecStopPost also exits without any host operation (no pre.json).
    for n, label in ((108, "entry-ascii"), (108, "entry-ä"), (140, "entry-long")):
        run = run_path(n, label)
        with patch.object(ip, "in_probe_unit", lambda: True), \
                patch.object(ip.subprocess, "run", lambda *a, **k: types.SimpleNamespace(stdout=HEAD)), \
                patch.object(ip, "heavy_lock", forbidden), patch.object(ip, "run", forbidden), \
                patch.object(ic, "InstallProbeHost", forbidden), contextlib.redirect_stdout(io.StringIO()):
            rc = ip.main(["--run-dir", str(run), "--commit", HEAD, "--run-id", "own-r348"])
        report = json.loads((run / "report.json").read_text())
        assert rc == 1 and report["verdict"] == "FAIL" and report["commit"] == HEAD
        assert report["run_id"] == "own-r348" and report["steps"] == []
        assert not (run / "pre.json").exists()
        status, reasons = ic.gate_status(report, None)
        assert status == "FAIL" and f"is {n} bytes" in reasons[0]
        with patch.object(ir, "InstallProbeHost", forbidden), patch.object(ir.rl, "main", forbidden), \
                contextlib.redirect_stdout(io.StringIO()):
            restored = ir.main(["--from", str(run / "pre.json"), "--out", str(run / "restore-post.json")])
        assert restored == 0
        results["probe_entry"].append({"label": label, "bytes": n, "exit": rc, "restore_exit": restored,
                                       "status": status, "reasons": reasons})

    class StopAtLint(Exception):
        pass

    def out_path(n, label):
        out = temp / (label + ".json")
        planned = out.with_suffix(".logs") / ("install-probe-" + "0" * rg.PROBE_RUN_ID_LEN) / "home/.rtapi_fifo"
        count = n - len(os.fsencode(planned))
        assert count >= 0
        return out.with_name(label + "x" * count + ".json")

    for n, label in ((107, "gate"), (108, "gate2"), (108, "gate-ä")):
        out = out_path(n, label)
        calls = []
        @contextlib.contextmanager
        def fake_lock(*a, **k):
            calls.append("lock")
            yield
        def gate_run(name, *a, **k):
            calls.append(name)
            if name == "selection-guards": return {"name": name, "status": "PASS"}
            if name == "lint": raise StopAtLint()
            raise AssertionError(name)
        class Host:
            def lan_trip(self):
                calls.append("lan_trip")
                return None
        sel = {"base": "00adb83c", "head": HEAD, "unmatched": [], "unit": {"heavy": []},
               "browser": {"run": [], "reasons": []}, "backend": {"run": False, "reasons": []},
               "firefox": {}, "live": {}}
        with patch.object(rg, "run", gate_run), patch.object(rg, "heavy_lock", fake_lock), \
                patch.object(rg.selector, "select", lambda *a: sel), \
                patch.object(rg.selector, "vitest_changed", lambda *a: []), \
                patch.object(rg.subprocess, "run", lambda *a, **k: types.SimpleNamespace(stdout="")), \
                patch.object(rg, "output", lambda *a: "fake"), patch.object(rg, "resources", lambda: {}), \
                patch("test_support.system_host.SystemHost", Host), contextlib.redirect_stdout(io.StringIO()):
            try:
                rc = rg.main(["--merge", "--base", "00adb83c", "--out", str(out)])
            except StopAtLint:
                assert n == 107
                rc = "admitted; stopped by probe before lint"
        if n >= 108:
            assert rc == 1 and calls == ["selection-guards", "lock"]
            report = json.loads(out.read_text())
            assert report["verdict"] == "FAIL"
            assert f"is {n} bytes" in report["checks"][-1]["why"][0]
        else:
            assert calls == ["selection-guards", "lock", "lan_trip", "lint"]
        # Compare the estimate with the REAL unit-launch command, stopping
        # at subprocess.run before any command is executed.
        commands = []
        class NoLaunch(Exception): pass
        def stop_launch(cmd, **kw):
            commands.append(cmd)
            raise NoLaunch()
        with patch.object(rg.subprocess, "run", stop_launch):
            try: rg.install_probe(out.with_suffix(".logs"), HEAD)
            except NoLaunch: pass
        assert len(commands) == 1 and commands[0][0] == "systemd-run"
        cmd = commands[0]
        actual = Path(cmd[cmd.index("--run-dir") + 1])
        size = len(os.fsencode(ic.child_env(actual, actual / "home")["HOME"] + "/.rtapi_fifo"))
        assert size == n
        assert len(cmd[cmd.index("--run-id") + 1]) == rg.PROBE_RUN_ID_LEN == 12
        results["gate_entry"].append({"label": label, "planned_bytes": n, "actual_command_bytes": size,
                                      "exit": rc, "called": calls, "unit_started": False})

print(json.dumps(results, ensure_ascii=False, indent=2))

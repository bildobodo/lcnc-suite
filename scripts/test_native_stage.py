"""The native stage's offline guards (plan Codex R282–R285, build step 1):
the heavy lock, the run tree's isolation, the restore and the case
evaluators — every pure part, without LinuxCNC (the orchestrator never
imports linuxcnc or hal: a bare import binds the running sim)."""
from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_support import heavy_lock as hl  # noqa: E402


@pytest.fixture(autouse=True)
def own_heavy_lock(tmp_path, monkeypatch):
    """Each test its own lock file: inside a gate the gate holds the real one
    (the restore CLI waited 600 s for it in the round gate of 2026-11-05)."""
    monkeypatch.setattr(hl, "LOCK", tmp_path / "test-heavy.lock")


def test_two_holders_of_the_heavy_lock_run_one_after_the_other(tmp_path):
    """One lock for the gates, the load runs and the native stage (R269):
    a second holder waits for the first, a bounded wait gives up with the
    holder named."""
    lock = tmp_path / "heavy.lock"
    holder = subprocess.Popen([sys.executable, "-c", (
        "import sys, time; sys.path.insert(0, sys.argv[1]);"
        "from test_support.heavy_lock import heavy_lock\n"
        "with heavy_lock('first', path=__import__('pathlib').Path(sys.argv[2])):\n"
        "    print('held', flush=True); time.sleep(1.5)"), str(HERE), str(lock)], stdout=subprocess.PIPE, text=True)
    assert holder.stdout.readline().strip() == "held"
    with pytest.raises(TimeoutError, match="first"):
        with hl.heavy_lock("second", wait=0.2, path=lock):
            pass
    started = time.monotonic()
    with hl.heavy_lock("third", path=lock):
        waited = time.monotonic() - started
    holder.wait(timeout=5)
    assert waited > 0.8, "the third holder waited for the first"


# ── The run tree and its copy (R268/R269 FI265-04, R283/R284) ────────────
from test_support import live_target as lt  # noqa: E402

REPO = HERE.parent


def _install_copy(tmp_path, monkeypatch):
    """The copy as the native stage makes it: the run's folder layout like
    ~/linuxcnc, programs and macros relative to the configuration."""
    import install_examples as installer
    monkeypatch.setattr(installer, "assert_stopped", lambda: None)
    monkeypatch.setattr(installer.Path, "home", lambda: tmp_path / "home")
    run = tmp_path / "run"
    config = run / "configs/sim"
    installer.install(REPO, config, run / "config-backups/sim", nc_files="nc_files", macro_dir="macros", confine=run)
    return run, config


def test_the_copy_passes_the_target_check_with_its_own_options_and_fails_with_a_changed_key(tmp_path, monkeypatch):
    run, config = _install_copy(tmp_path, monkeypatch)
    ini = config / "lcnc_suite_sim_3axis_xyz.ini"
    suite = {"hal_reader.py": REPO / "lcnc-gateway/hal_reader.py", "hal_watchdog.py": REPO / "lcnc-gateway/hal_watchdog.py",
             "compensation.py": REPO / "subroutines/surfacemap/compensation.py"}
    which = lambda n: str(suite[n]) if n in suite else f"/usr/bin/{n}"  # noqa: E731
    lt.check_copy(str(ini), str(REPO / "examples/sim_config"), which, nc_files="nc_files", macro_dir="macros")
    with pytest.raises(ValueError, match="differs"):   # rendered without the options: the copy is no template
        lt.check_copy(str(ini), str(REPO / "examples/sim_config"), which)
    text = ini.read_text().replace("MAX_LINEAR_VELOCITY = 100", "MAX_LINEAR_VELOCITY = 500")
    ini.write_text(text)
    with pytest.raises(ValueError, match="differs"):
        lt.check_copy(str(ini), str(REPO / "examples/sim_config"), which, nc_files="nc_files", macro_dir="macros")


def test_a_helper_the_hal_starts_by_name_must_resolve_into_the_run_tree(tmp_path, monkeypatch):
    run, config = _install_copy(tmp_path, monkeypatch)
    ini = config / "lcnc_suite_sim_3axis_xyz.ini"
    other = tmp_path / "other-checkout/lcnc-gateway/hal_reader.py"
    other.parent.mkdir(parents=True)
    other.write_text("")
    which = lambda n: str(other) if n == "hal_reader.py" else f"/usr/bin/{n}"  # noqa: E731
    with pytest.raises(ValueError, match="hal_reader.py runs from"):
        lt.check_copy(str(ini), str(REPO / "examples/sim_config"), which, nc_files="nc_files", macro_dir="macros")


def test_every_mutable_path_lies_in_the_run_and_its_folders_exist(tmp_path, monkeypatch):
    run, config = _install_copy(tmp_path, monkeypatch)
    ini = config / "lcnc_suite_sim_3axis_xyz.ini"
    tree = run / "tree"
    (tree / "lcnc-gateway").mkdir(parents=True)
    assert lt.confinement_problems(ini, run, tree) == []
    # POSITION_FILE apart from PARAMETER_FILE: one pointing out is named
    ini.write_text(ini.read_text().replace("[TRAJ]\n", "[TRAJ]\nPOSITION_FILE = ~/position.txt\n", 1))
    assert any("POSITION_FILE" in p for p in lt.confinement_problems(ini, run, tree))
    # a program folder that does not exist: the gateway would fall back to ~/linuxcnc/nc_files
    _install_copy(tmp_path, monkeypatch)
    import shutil
    shutil.rmtree(config / "nc_files")
    assert any("PROGRAM_PREFIX" in p and "missing" in p for p in lt.confinement_problems(ini, run, tree))


def test_a_hardlinked_node_modules_is_no_copy(tmp_path):
    original = tmp_path / "orig/node_modules/.tmp"
    original.mkdir(parents=True)
    (original / "app.tsbuildinfo").write_text("x")
    linked = tmp_path / "run/tree/node_modules/.tmp"
    linked.mkdir(parents=True)
    (linked / "app.tsbuildinfo").hardlink_to(original / "app.tsbuildinfo")
    assert lt.shared_inodes(tmp_path / "run/tree/node_modules", tmp_path / "orig/node_modules")
    copied = tmp_path / "copy/node_modules/.tmp"
    copied.mkdir(parents=True)
    (copied / "app.tsbuildinfo").write_text("x")
    assert lt.shared_inodes(tmp_path / "copy/node_modules", tmp_path / "orig/node_modules") == []


def test_the_process_proof_names_a_helper_outside_the_run_tree(tmp_path):
    tree, config = tmp_path / "run/tree", tmp_path / "run/configs/sim"
    ini = config / "lcnc_suite_sim_3axis_xyz.ini"
    good = [
        {"cmdline": ["bash", str(tree / "lcnc-suite"), "-ini", str(ini)]},
        {"cmdline": ["python3", "-m", "uvicorn", "gateway:app", "--app-dir", str(tree / "lcnc-gateway")]},
        {"cmdline": ["python3", str(tree / "lcnc-gateway/hal_reader.py")]},
        {"cmdline": ["python3", str(tree / "lcnc-gateway/hal_watchdog.py")]},
        {"cmdline": ["python3", str(tree / "subroutines/surfacemap/compensation.py"), "probe-results.txt", "cubic"]},
        {"cmdline": ["python3", "sim_toolsetter/sim_toolsetter_feed.py"], "cwd": str(tree)},
    ]
    assert lt.process_problems(good, tree, ini) == []
    bad = [dict(p) for p in good]
    bad[2] = {"cmdline": ["python3", "/home/cnc/lcnc-suite/lcnc-gateway/hal_reader.py"]}
    assert any("hal_reader.py" in p for p in lt.process_problems(bad, tree, ini))
    assert any("hal_watchdog.py" in p and "not running" in p for p in lt.process_problems(good[:3] + good[4:], tree, ini))


# ── The restore to the LAN instance (R268/R269, R283/R284: three outcomes) ──
from test_support import restore_lan as rl  # noqa: E402


class FakeHost:
    """The LAN instance as the restore sees it: units, readiness, processes,
    the tree's HEAD, the hashes of the operator's files, the trip state."""

    def __init__(self):
        self.units = {"lcnc-sim-gates": {"ExecStart": ["/usr/bin/env", "linuxcnc", "lan.ini"], "WorkingDirectory": "/cfg"},
                      "bg-keepalive": {"ExecStart": ["/py", "keepalive.py", "lan.ini"], "WorkingDirectory": "/"}}
        self.active = {"lcnc-sim-gates": True, "bg-keepalive": True}
        self.instance = ("linuxcncsvr", 100, 5000)       # (name, pid, start ticks)
        self.head = "abc"
        self.hashes = {"nc_files": "h1", "macros": "h2", "settings": "h3", "config": "h4"}
        self.trip = None
        self.ready = True
        self.fail_start = set()
        self.started = []
        self.heartbeat_seen = True
        self.owner_ok = True
        self.removed = []
        self.test_instance = None        # the run's own LinuxCNC while native-sim runs

    def unit(self, name): return self.units[name]
    def is_active(self, name): return self.active.get(name, False)

    def stop(self, name):
        self.active[name] = False
        if name == "native-sim":
            self.test_instance = None
        if name == "lcnc-sim-gates":
            self.instance = ()
    def unit_owns(self, unit, pid): return self.owner_ok
    def remove_tree(self, tree, of): self.removed.append(tree)
    def start(self, name, spec):
        if name in self.fail_start:
            raise RuntimeError(f"{name} did not start")
        self.started.append(name)
        self.active[name] = True
        if name == "lcnc-sim-gates":
            self.last = getattr(self, "last", 100) + 1
            self.instance = ("linuxcncsvr", self.last, 5000 + self.last)
    def wait_ready(self, timeout): return self.ready
    def lan_instance(self): return self.test_instance or self.instance
    def gateway_ini(self): return "lan.ini"
    def tree_head(self): return self.head
    def tree_dir(self): return "/lan-tree"
    def file_hashes(self): return dict(self.hashes)
    def lan_trip(self): return self.trip
    def keepalive_connected_since(self, t): return self.heartbeat_seen


def test_a_complete_restore_proves_every_point():
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    out = rl.restore(h, pre)
    assert out["outcome"] == "complete" and out["isolation"] == [], out
    assert h.started == ["lcnc-sim-gates", "bg-keepalive"]
    assert out["instance"] != pre["instance"], "a new LinuxCNC instance"


def test_a_trip_after_the_return_is_named_apart_and_never_acknowledged():
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.trip = {"reason": "heartbeat"}
    out = rl.restore(h, pre)
    assert out["outcome"] == "lan_started_trip_unacked"
    assert not hasattr(h, "acked"), "the restore never acknowledges a trip"


@pytest.mark.parametrize("break_it, reason", [
    (lambda h: h.fail_start.add("lcnc-sim-gates"), "did not start"),
    (lambda h: setattr(h, "ready", False), "/ready"),
    (lambda h: setattr(h, "head", "zzz"), "HEAD"),
    (lambda h: setattr(h, "heartbeat_seen", False), "keepalive"),
])
def test_a_restore_that_cannot_prove_a_point_says_not_returned(break_it, reason):
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    break_it(h)
    out = rl.restore(h, pre)
    assert out["outcome"] == "not_returned" and any(reason in r for r in out["reasons"]), out


def test_a_changed_file_of_the_operator_fails_the_isolation_and_the_lan_still_comes_back():
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.hashes.update(nc_files="changed")
    out = rl.restore(h, pre)
    assert out["outcome"] == "complete" and out["isolation"] == ["nc_files changed"]
    assert h.started == ["lcnc-sim-gates", "bg-keepalive"]


def test_a_second_restore_finds_the_lan_returned_and_starts_nothing():
    """finally AND ExecStopPost both run it: the second one only proves."""
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    rl.restore(h, pre)
    h.started.clear()
    assert rl.restore(h, pre)["outcome"] == "complete" and h.started == []


def test_a_lan_trip_before_the_take_over_refuses_it():
    h = FakeHost()
    h.trip = {"reason": "heartbeat"}
    with pytest.raises(rl.TakeOverRefused, match="unacknowledged trip"):
        rl.record(h)


from test_support import system_host as sh  # noqa: E402


def test_the_exec_start_line_and_the_trace_proof():
    line = "{ path=/usr/bin/env ; argv[]=/usr/bin/env -u DISPLAY LCNC_WEBUI_BROWSER=0 linuxcnc lan.ini ; ignore_errors=no ; }"
    assert sh.parse_exec_start(line) == ["/usr/bin/env", "-u", "DISPLAY", "LCNC_WEBUI_BROWSER=0", "linuxcnc", "lan.ini"]
    tick = lambda pid, t, n: json.dumps({"tag": "loop.tick", "pid": pid, "t_wall_ns": int(t * 1e9), "clients": n})  # noqa: E731
    assert sh.clients_since([tick(7, 105, 1)], 7, 100)
    assert not sh.clients_since([tick(7, 99, 1)], 7, 100), "before the restore began"
    assert not sh.clients_since([tick(6, 105, 1)], 7, 100), "the old gateway"
    assert not sh.clients_since([tick(7, 105, 0)], 7, 100), "no client"


# ── The case evaluators (R283/R284 FI282-05: bounds before the run) ──────
from test_support import native_cases as nc  # noqa: E402


def test_home_all_and_home_per_joint():
    assert nc.eval_home("home-all", [True, True, True], [True, True, True])["status"] == "PASS"
    assert nc.eval_home("home-joint-0", [True, False, False], [True, False, False])["status"] == "PASS"
    planted = nc.eval_home("home-joint-0", [True, False, False], [True, True, False])
    assert planted["status"] == "FAIL" and "joint 1" in planted["detail"]
    assert nc.eval_home("home-joint-2", [False, False, True], None)["status"] == "incomplete"


def _jog(sign=1, axis=0, moved=15.0, brake=1.5, stop_at=0.12, vel=50.0):
    """A jog as measured: start 300, the anchor (jog_stop's reply) `moved` on,
    standstill `brake` further at `stop_at` s after the anchor."""
    p0, anchor = 300.0, 300.0 + sign * moved
    samples = [(0.02, anchor + sign * brake * 0.5, vel * 0.5), (stop_at, anchor + sign * brake, 0.0)]
    return nc.eval_jog(f"jog-{'xyz'[axis]}{'+' if sign > 0 else '-'}", axis, sign, p0, anchor, samples)


def test_a_jog_moves_in_its_sign_and_stops_within_its_bounds():
    assert _jog()["status"] == "PASS"
    assert _jog(sign=-1)["status"] == "PASS"
    assert _jog(axis=2, brake=2.4)["status"] == "PASS", "Z brakes on 600 mm/s² (OFFSET_AV_RATIO 0.2)"
    assert _jog(axis=0, brake=2.4)["status"] == "FAIL", "X: 2.1 mm"


def test_a_jog_with_the_wrong_sign_or_no_stop_is_red():
    inverted = nc.eval_jog("jog-x+", 0, 1, 300.0, 285.0, [(0.1, 284.0, 0.0)])
    assert inverted["status"] == "FAIL" and "sign" in inverted["detail"]
    late = _jog(stop_at=0.7)
    assert late["status"] == "FAIL" and "0.5 s" in late["detail"]
    moving = nc.eval_jog("jog-x+", 0, 1, 300.0, 315.0, [(0.1, 316.0, 20.0), (0.45, 316.5, 5.0)])
    assert moving["status"] == "FAIL", "no standstill sample within 0.5 s"
    assert nc.eval_jog("jog-x+", 0, 1, 300.0, 315.0, [])["status"] == "incomplete"


# ── The orchestrator's ending (R282 FI282-01: the two closing counter-cases) ──
import native_run as nr  # noqa: E402


def test_a_failure_right_after_the_lan_stop_still_restores_and_reports(tmp_path):
    h = FakeHost()

    def boom(ctx):
        raise RuntimeError("the run tree could not be made")
    report = nr.run(h, [("tree", boom)], tmp_path / "run")
    assert "the run tree could not be made" in report["error"]
    assert report["restore"]["outcome"] == "complete"
    assert h.started == ["lcnc-sim-gates", "bg-keepalive"]
    assert nr.verdict(report) == "FAIL"
    assert json.loads((tmp_path / "run/report.json").read_text())["restore"]["outcome"] == "complete"


class FileHost(FakeHost):
    """A FakeHost whose state lives in a file: the killed run and the
    ExecStopPost restore see the same LAN."""

    def __init__(self, path):
        super().__init__()
        self.path = path
        if path.exists():
            st = json.loads(path.read_text())
            self.active, self.instance = st["active"], tuple(st["instance"])
            self.test_instance = tuple(st["test"]) if st.get("test") else None
            self.last = st.get("last", 100)

    def _save(self):
        self.path.write_text(json.dumps({"active": self.active, "instance": list(self.instance),
                                         "test": list(self.test_instance) if self.test_instance else None,
                                         "last": getattr(self, "last", 100)}))

    def stop(self, name):
        super().stop(name)
        self._save()

    def start(self, name, spec):
        super().start(name, spec)
        self._save()


def test_a_killed_orchestrator_is_restored_by_the_unit_from_pre_json(tmp_path):
    state, run = tmp_path / "lan.json", tmp_path / "run"
    code = (
        "import sys, time, json; sys.path[:0] = [sys.argv[1], sys.argv[2]]\n"
        "import native_run as nr, test_native_stage as t\n"
        "from pathlib import Path\n"
        "h = t.FileHost(Path(sys.argv[3]))\n"
        "def hang(ctx):\n"
        "    print('stopped', flush=True); time.sleep(60)\n"
        "nr.run(h, [('hang', hang)], Path(sys.argv[4]))\n")
    p = subprocess.Popen([sys.executable, "-c", code, str(HERE), str(HERE), str(state), str(run)],
                         stdout=subprocess.PIPE, text=True)
    assert p.stdout.readline().strip() == "stopped"
    assert json.loads(state.read_text())["active"] == {"lcnc-sim-gates": False, "bg-keepalive": False}
    p.kill()
    p.wait(timeout=5)
    assert not (run / "report.json").exists(), "killed: no finally ran"
    out = run / "restore-post.json"
    assert rl.main(["--from", str(run / "pre.json"), "--out", str(out)], host_factory=lambda pre: FileHost(state)) == 0
    restored = json.loads(out.read_text())
    assert restored["outcome"] == "complete" and restored["isolation"] == [], restored
    assert {k: v for k, v in json.loads(state.read_text())["active"].items() if k != "native-sim"} == \
        {"lcnc-sim-gates": True, "bg-keepalive": True}


# ── R286 FI-I18: the PATH LinuxCNC's own launcher builds ─────────────────
LAUNCHER = """LINUXCNC_HOME=/usr; export LINUXCNC_HOME
LINUXCNC_BIN_DIR=/usr/bin
if [ -d $HOME/.local/bin ]; then
    if [[ "$PATH" != *".local/bin"* ]]; then
        PATH=$HOME/.local/bin:$PATH
    fi
fi
PATH=$LINUXCNC_BIN_DIR:$PATH
[ -d $LINUXCNC_HOME/scripts ] && PATH=$LINUXCNC_HOME/scripts:$PATH
"""


def test_the_effective_path_follows_the_installed_launchers_rule(tmp_path):
    home = tmp_path / "home"
    (home / ".local/bin").mkdir(parents=True)
    script = tmp_path / "linuxcnc"
    script.write_text(LAUNCHER)
    # a PATH without ".local/bin": the launcher puts ~/.local/bin (the main checkout's links) first
    eff = lt.linuxcnc_path("/run/bin:/usr/bin:/bin", home=home, script=script)
    assert eff.split(":")[:2] == ["/usr/bin", str(home / ".local/bin")]
    # the run's bin named .local/bin: nothing prepended but the launcher's own bin dir
    eff = lt.linuxcnc_path("/run/.local/bin:/usr/bin:/bin", home=home, script=script)
    assert eff.split(":")[:2] == ["/usr/bin", "/run/.local/bin"]
    # a launcher whose PATH rule is not the known one: refused, never guessed
    script.write_text("PATH=/opt/odd:$PATH\n")
    with pytest.raises(ValueError, match="PATH rule"):
        lt.linuxcnc_path("/run/.local/bin:/usr/bin", home=home, script=script)


def test_the_installed_launcher_would_run_the_main_checkouts_helpers_without_the_run_bin_name():
    """The counter-case against THIS VM's /usr/bin/linuxcnc (read only)."""
    import shutil
    if not Path("/usr/bin/linuxcnc").is_file():
        pytest.skip("no installed LinuxCNC launcher")
    eff = lt.linuxcnc_path("/tmp/run/bin:/usr/bin:/bin")
    if (Path.home() / ".local/bin").is_dir():
        assert str(Path.home() / ".local/bin") in eff.split(":"), "the launcher's rule as installed"
    eff = lt.linuxcnc_path("/tmp/run/.local/bin:/usr/bin:/bin")
    assert str(Path.home() / ".local/bin") not in eff.split(":")
    assert shutil.which("hal_reader.py", path=eff) in (None, "/tmp/run/.local/bin/hal_reader.py")


# ── R286 FI-I22 / FI-I23: no PASS without completion or known values ─────
def test_a_home_whose_completion_never_came_is_red_with_the_right_bits():
    timed_out = nc.eval_home("home-all", [True, True, True], [True, True, True], completed=False)
    assert timed_out["status"] == "FAIL" and "completion" in timed_out["detail"]


def test_an_unknown_or_non_finite_jog_value_is_never_a_standstill():
    nan = float("nan")
    assert nc.eval_jog("jog-x+", 0, 1, 300.0, nan, [(0.1, 301.0, 0.0)])["status"] == "incomplete"
    assert nc.eval_jog("jog-x+", 0, 1, 300.0, 315.0, [(0.01, 315.0, None), (0.02, 315.0, nan)])["status"] == "incomplete"
    # an anchor frame older than its bound: the anchor is not proven
    stale = nc.eval_jog("jog-x+", 0, 1, 300.0, 315.0, [(0.1, 316.0, 0.0)], anchor_age=0.25)
    assert stale["status"] == "incomplete" and "anchor" in stale["detail"]


def test_the_client_takes_only_status_frames_as_status():
    from test_support.live_session import SimulatorClient
    seen = []
    c = SimulatorClient("", auto_confirm=False, on_status=lambda t, st: seen.append(st))
    c.take({"type": "status", "data": {"current_vel": 3.0}})
    c.take({"type": "status_delta", "data": {"current_vel": 1.0}})
    c.take({"type": "tool_table", "data": {"current_vel": 99.0}})   # a reply carrying data: no status
    assert [s["current_vel"] for s in seen] == [3.0, 1.0] and c.status["current_vel"] == 1.0


def test_the_process_proof_checks_the_feed_the_interpreters_and_the_gateways_logs(tmp_path):
    tree, config = tmp_path / "run/tree", tmp_path / "run/configs/sim"
    ini = config / "lcnc_suite_sim_3axis_xyz.ini"
    feed = tree / "examples/sim_config/sim_toolsetter/sim_toolsetter_feed.py"
    feed.parent.mkdir(parents=True)
    feed.write_text("")
    config.mkdir(parents=True)
    (config / "sim_toolsetter").symlink_to(feed.parent, target_is_directory=True)
    py = "/usr/bin/python3.13"
    procs = [
        {"cmdline": ["bash", str(tree / "lcnc-suite"), "-ini", str(ini)], "exe": "/usr/bin/bash", "cwd": str(config)},
        {"cmdline": ["python3", "-m", "uvicorn", "gateway:app", "--app-dir", str(tree / "lcnc-gateway")], "exe": py, "cwd": str(tree)},
        {"cmdline": ["python3", str(tree / "lcnc-gateway/hal_reader.py")], "exe": py, "cwd": str(config)},
        {"cmdline": ["python3", str(tree / "lcnc-gateway/hal_watchdog.py")], "exe": py, "cwd": str(config)},
        {"cmdline": ["python3", str(tree / "subroutines/surfacemap/compensation.py"), "x", "cubic"], "exe": py, "cwd": str(config)},
        {"cmdline": ["python3", "sim_toolsetter/sim_toolsetter_feed.py"], "exe": py, "cwd": str(config)},
    ]
    assert lt.process_problems(procs, tree, ini) == []
    odd = [dict(p) for p in procs]
    odd[5] = {**odd[5], "cwd": "/home/cnc/linuxcnc/configs/lcnc_suite_sim_gates"}
    assert any("sim_toolsetter_feed.py" in p for p in lt.process_problems(odd, tree, ini))
    odd = [dict(p) for p in procs]
    odd[2] = {**odd[2], "exe": "/home/x/other-venv/bin/python3"}
    assert any("interpreter" in p for p in lt.process_problems(odd, tree, ini))
    logs = tmp_path / "run/logs"
    assert lt.log_problems([str(logs / "trace.ndjson"), "/dev/null"], logs) == []
    assert lt.log_problems([str(logs / "trace.ndjson"), "/home/cnc/lcnc-suite-gates/runlogs/trace.ndjson"], logs)
    assert lt.log_problems([], logs), "no log file open at all is no proof"


def test_a_mutable_file_hardlinked_to_one_outside_is_named(tmp_path, monkeypatch):
    run, config = _install_copy(tmp_path, monkeypatch)
    ini = config / "lcnc_suite_sim_3axis_xyz.ini"
    tree = run / "tree"
    (tree / "lcnc-gateway").mkdir(parents=True)
    outside = tmp_path / "outside.var"
    outside.write_text("5220 1\n")
    var = config / "xyz3/sim.var"
    var.unlink()
    var.hardlink_to(outside)
    assert any("PARAMETER_FILE" in p and "inode" in p for p in lt.confinement_problems(ini, run, tree))


def test_a_run_folder_that_exists_already_is_refused_before_anything(tmp_path):
    h = FakeHost()
    (tmp_path / "run").mkdir()
    with pytest.raises(FileExistsError):
        nr.run(h, [], tmp_path / "run")
    assert h.started == [] and all(h.active.values()), "nothing recorded, nothing stopped"


# ── R286 FI-I19 / FI-I21: the test instance ends first, the return is bound ──
def _started_test(h, run):
    """The run's own instance up: native-sim active, holding the VM's LinuxCNC."""
    h.active["native-sim"] = True
    h.test_instance = ("linuxcncsvr", 900, 9000)
    state = {"test_unit": "native-sim", "tree": str(run / "tree"), "tree_of": "/wt"}
    (run / "state.json").write_text(json.dumps(state))
    return state


def test_a_kill_after_the_test_start_ends_the_test_instance_before_the_lan_returns(tmp_path):
    state, run = tmp_path / "lan.json", tmp_path / "run"
    h = FileHost(state)
    run.mkdir()
    pre = rl.record(h)
    (run / "pre.json").write_text(json.dumps(pre))
    rl.stop_lan(h, pre)
    (run / "pre.json").write_text(json.dumps(pre))
    _started_test(h, run)
    h._save()
    # the orchestrator dies here; ExecStopPost runs the restore
    out = run / "restore-post.json"
    assert rl.main(["--from", str(run / "pre.json"), "--out", str(out)], host_factory=lambda pre: FileHost(state)) == 0
    got = json.loads(out.read_text())
    assert got["outcome"] == "complete" and got["isolation"] == [] and got["cleanup"] == []
    assert json.loads(state.read_text())["test"] is None, "the test instance ended first"
    assert json.loads((run / "state.json").read_text())["tree_removed"] is True


def test_a_test_instance_that_does_not_end_keeps_the_lan_down_and_says_so(tmp_path, monkeypatch):
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.test_instance = ("linuxcncsvr", 900, 9000)      # native-sim gone, its LinuxCNC still there
    monkeypatch.setattr(rl, "TEST_END_S", 0.1)
    out = rl.restore(h, pre, {"test_unit": "native-sim"})
    assert out["outcome"] == "not_returned" and any("still runs" in r for r in out["reasons"])
    assert h.started == [], "never a second LinuxCNC beside it"


def test_a_restore_interrupted_after_the_test_end_is_completed_by_the_next(tmp_path):
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    state = {"test_unit": "native-sim", "tree": "/run/tree", "tree_of": "/wt"}
    h.active["native-sim"], h.test_instance = True, ("linuxcncsvr", 900, 9000)
    h.fail_start.add("lcnc-sim-gates")
    first = tmp_path / "restore.json"
    assert rl.restore(h, pre, state, first)["outcome"] == "not_returned"
    assert not first.exists(), "no return to bind"
    h.fail_start.clear()
    out = rl.restore(h, pre, state, first)
    assert out["outcome"] == "complete" and h.removed == ["/run/tree"], "the tree removed once"


@pytest.mark.parametrize("break_it, reason", [
    (lambda h: setattr(h, "owner_ok", False), "does not belong"),
])
def test_the_returned_instance_must_be_the_restored_units(break_it, reason):
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    break_it(h)
    out = rl.restore(h, pre)
    assert out["outcome"] == "not_returned" and any(reason in r for r in out["reasons"]), out


def test_the_same_instance_as_before_the_stop_is_no_return():
    h = FakeHost()
    pre = rl.record(h)
    # nothing was stopped: the recorded instance itself still runs
    out = rl.restore(h, pre)
    assert out["outcome"] == "not_returned" and any("not a new one" in r for r in out["reasons"])


def test_a_running_unit_with_another_command_is_no_return():
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.start("lcnc-sim-gates", pre["units"]["lcnc-sim-gates"])
    h.units["lcnc-sim-gates"] = {**h.units["lcnc-sim-gates"], "ExecStart": ["/usr/bin/env", "linuxcnc", "other.ini"]}
    out = rl.restore(h, pre)
    assert out["outcome"] == "not_returned" and any("another command" in r for r in out["reasons"])


def test_the_second_restore_keeps_the_first_isolation_failure_and_an_unproven_one_stays_unknown(tmp_path):
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.hashes.update(config="changed")
    first = tmp_path / "restore.json"
    assert rl.restore(h, pre, {}, first)["isolation"] == ["config changed"]
    again = rl.restore(h, pre, {}, first)
    assert again["isolation"] == ["config changed"] and again["repeat_of"] == "complete"
    assert nr.verdict({"rows": [{"status": "PASS"}], "restore": again}) == "FAIL"
    # no first record and the LAN already up: the isolation was never proven
    unknown = rl.restore(h, pre, {}, tmp_path / "none.json")
    assert unknown["isolation"] is None
    assert nr.verdict({"rows": [{"status": "PASS"}], "restore": unknown}) == "FAIL"

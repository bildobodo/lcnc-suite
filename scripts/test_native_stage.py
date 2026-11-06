"""The native stage's offline guards (plan Codex R282–R285, build step 1):
the heavy lock, the run tree's isolation, the restore and the case
evaluators — every pure part, without LinuxCNC (the orchestrator never
imports linuxcnc or hal: a bare import binds the running sim)."""
from __future__ import annotations

import json
import math
import subprocess
import shutil
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
        {"cmdline": ["python3", "-m", "uvicorn", "gateway:app", "--app-dir", str(tree / "lcnc-gateway")], "exe": "/usr/bin/python3"},
        {"cmdline": ["python3", str(tree / "lcnc-gateway/hal_reader.py")], "exe": "/usr/bin/python3"},
        {"cmdline": ["python3", str(tree / "lcnc-gateway/hal_watchdog.py")], "exe": "/usr/bin/python3"},
        {"cmdline": ["python3", str(tree / "subroutines/surfacemap/compensation.py"), "probe-results.txt", "cubic"],
         "exe": "/usr/bin/python3"},
        {"cmdline": ["python3", "sim_toolsetter/sim_toolsetter_feed.py"], "cwd": str(tree), "exe": "/usr/bin/python3"},
    ]
    assert lt.process_problems(good, tree, ini) == []
    bad = [dict(p) for p in good]
    bad[2] = {"cmdline": ["python3", "/home/cnc/lcnc-suite/lcnc-gateway/hal_reader.py"], "exe": "/usr/bin/python3"}
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
        self.invocations = {}

    def unit(self, name): return self.units[name]
    def is_active(self, name):
        """`systemctl is-active`: 0 for "active" alone — activating and deactivating are not (measured)."""
        return self.active.get(name, False) and getattr(self, "states", {}).get(name, "active") == "active"

    def stop(self, name):
        self.active[name] = False
        if name.startswith("native-sim"):
            self.test_instance = None
        if name == "lcnc-sim-gates":
            self.instance = ()
    def unit_owns(self, unit, pid): return self.owner_ok
    def remove_tree(self, tree, of): self.removed.append(tree)

    def unit_status(self, unit):
        """systemd's view: LoadState, ActiveState, InvocationID, the pids of its cgroup."""
        if getattr(self, "query_fails", False):
            raise RuntimeError("systemctl show failed")
        active = getattr(self, "states", {}).get(unit) or ("active" if self.active.get(unit) else "inactive")
        alive = bool(self.test_instance) and unit.startswith("native-sim") and active != "inactive"
        spec = self.units.get(unit, {})
        loaded = unit in self.units or self.active.get(unit) or unit in getattr(self, "states", {})
        return {"load": "loaded" if loaded else "not-found", "active": active,
                "invocation": self.invocations.get(unit), "exec": spec.get("ExecStart", []),
                "wd": spec.get("WorkingDirectory", ""), "pids": [self.test_instance[1]] if alive else []}
    def unit_instance(self, unit):
        return self.test_instance if self.active.get(unit) and unit.startswith("native-sim") else None

    def run_test_unit(self, unit, wd, ini):
        """What `systemd-run --unit=<unit>` does: the unit and its instance exist."""
        self.units[unit] = {"ExecStart": ["linuxcnc", str(ini)], "WorkingDirectory": str(wd)}
        self.active[unit], self.invocations[unit] = True, "inv-crash"
        self.test_instance = ("linuxcncsvr", 900, 9000)
    def process_alive(self, pid, start): return bool(self.test_instance) and self.test_instance[1:] == (pid, start)
    def start(self, name, spec):
        if name in self.fail_start:
            raise RuntimeError(f"{name} did not start")
        self.started.append(name)
        self.active[name] = True
        if name == "lcnc-sim-gates":
            self.last = getattr(self, "last", 100) + 1
            self.instance = ("linuxcncsvr", self.last, 5000 + self.last)
            self.answered = False
        if name == "bg-keepalive" and getattr(self, "connect_once", False):
            # the live keepalive connects ONCE: before the gateway answers it
            # ends on the refused connection, its unit failed, no heartbeat
            alive = getattr(self, "answered", True)
            self.active[name] = self.heartbeat_seen = alive
    def wait_ready(self, timeout):
        if self.ready:
            self.answered = True
        return self.ready
    def lan_instance(self): return self.test_instance or self.instance
    def gateway_ini(self): return "lan.ini"
    def tree_head(self): return self.head
    def tree_dir(self): return "/lan-tree"
    def file_hashes(self): return dict(self.hashes)
    def lan_trip(self): return self.trip
    def keepalive_heartbeat_since(self, t): return self.heartbeat_seen


def test_a_complete_restore_proves_every_point():
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    out = rl.restore(h, pre)
    assert out["outcome"] == "complete" and out["isolation"] == [], out
    assert h.started == ["lcnc-sim-gates", "bg-keepalive"]
    assert out["instance"] != pre["instance"], "a new LinuxCNC instance"


def test_the_keepalive_starts_only_once_the_returned_gateway_answers():
    """Live run 2026-11-05: the keepalive connects ONCE and ends on a refused
    connection. Started beside the gateway it was gone before /ready, the
    first return lacked its heartbeat (not_returned), and only the
    ExecStopPost's second return, 23 s later, brought it back."""
    h = FakeHost()
    h.connect_once = True
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    out = rl.restore(h, pre)
    assert out["outcome"] == "complete", out
    assert h.started == ["lcnc-sim-gates", "bg-keepalive"]


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
    """A jog as measured: start 300, the last frame before jog_stop's reply
    `moved` on (5 ms before it), standstill `brake` further at `stop_at` s."""
    p0, before = 300.0, 300.0 + sign * moved
    samples = [(0.02, before + sign * brake * 0.5, vel * 0.5), (stop_at, before + sign * brake, 0.0)]
    return nc.eval_jog(f"jog-{'xyz'[axis]}{'+' if sign > 0 else '-'}", axis, sign, p0, (-0.005, before), samples)


def test_a_jog_moves_in_its_sign_and_stops_within_its_bounds():
    assert _jog()["status"] == "PASS"
    assert _jog(sign=-1)["status"] == "PASS"
    assert _jog(axis=2, brake=2.4)["status"] == "PASS", "Z brakes on 600 mm/s² (OFFSET_AV_RATIO 0.2)"
    assert _jog(axis=0, brake=2.4)["status"] == "incomplete", "X: 2.1 mm — beyond by the frame before, unproven"


def test_a_jog_with_the_wrong_sign_or_no_stop_is_red():
    inverted = nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.01, 285.0), [(0.1, 284.0, 0.0)])
    assert inverted["status"] == "FAIL" and "sign" in inverted["detail"]
    late = _jog(stop_at=0.7)
    assert late["status"] == "incomplete" and "0.5 s" in late["detail"], "a late RECEIPT proves no late standstill"
    moving = nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.01, 315.0), [(0.1, 316.0, 20.0), (0.45, 316.5, 5.0)])
    assert moving["status"] == "incomplete", "no standstill received within 0.5 s — not proven either way"
    assert nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.01, 315.0), [])["status"] == "incomplete"


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
            self.invocations = st.get("invocations", {})
            self.units = st.get("units", self.units)

    def _save(self):
        self.path.write_text(json.dumps({"active": self.active, "instance": list(self.instance),
                                         "test": list(self.test_instance) if self.test_instance else None,
                                         "last": getattr(self, "last", 100), "invocations": self.invocations,
                                         "units": self.units}))

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
    assert nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.01, nan), [(0.1, 301.0, 0.0)])["status"] == "incomplete"
    assert nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.01, 315.0), [(0.01, 315.0, None), (0.02, 315.0, nan)])["status"] == "incomplete"
    assert nc.eval_jog("jog-x+", 0, 1, 300.0, None, [(0.1, 316.0, 0.0)])["status"] == "incomplete", "no frame before the reply"


def test_the_unseen_travel_before_the_first_frame_never_vanishes():
    """Codex R287 FI-I23: the reply at 315, the first frame 90 ms later at
    318.4875 (27.5 mm/s), standstill at 320 — 5 mm of real braking, which
    the later frame as anchor reported as 1.5125 → PASS. The bracket: the
    upper bound from the frame BEFORE the reply, the lower from the first
    after; between them the evidence is incomplete, never a PASS."""
    for sign in (1, -1):
        before = (-0.005, 300 + sign * 15)
        samples = [(0.09, 300 + sign * 18.4875, 27.5), (0.2, 300 + sign * 20, 0.0)]
        r = nc.eval_jog("jog-x", 0, sign, 300.0, before, samples)
        assert r["status"] == "incomplete", r
        assert (r["brake_upper_mm"], r["first_after_mm"]) == (5.0, 1.5125), r
    # beyond the bound by the frame before: no PASS — and no FAIL either, frames
    # received after the reply may have been captured before it (R288)
    over = nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.005, 315.0), [(0.01, 317.6, 5.0), (0.2, 320.0, 0.0)])
    assert over["status"] == "incomplete"
    within = nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.005, 315.0), [(0.01, 315.4, 20.0), (0.2, 316.5, 0.0)])
    assert within["status"] == "PASS"



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



def test_the_launcher_log_folder_is_read_from_the_gateway_it_started():
    """Live run 2026-11-05: a shell's /proc/<pid>/environ is its START
    environment, so the launcher's own never shows LCNC_RESOLVED_LOG_DIR,
    which it exports later; the gateway it starts after the export carries
    it. The run read the launcher's, got None and refused a start whose
    logs were all in the run's folder."""
    logs = Path("/run/x/logs")
    procs = [{"pid": 10, "cmdline": ["bash", "/run/x/tree/lcnc-suite", "-ini", "/run/x/configs/sim/a.ini"]},
             {"pid": 11, "cmdline": ["python3", "-m", "uvicorn", "gateway:app", "--app-dir", "/run/x/tree/lcnc-gateway"]}]
    envs = {10: {"PATH": "/run/x/bin", "LCNC_LOG_DIR": "/run/x/logs"}, 11: {"LCNC_RESOLVED_LOG_DIR": "/run/x/logs"}}
    assert lt.launcher_log_problems(procs, logs, envs.__getitem__) == []
    envs[11] = {"LCNC_RESOLVED_LOG_DIR": "/home/cnc/lcnc-suite-gates/runlogs"}
    assert any("runlogs" in p for p in lt.launcher_log_problems(procs, logs, envs.__getitem__))
    envs[11] = {}
    assert lt.launcher_log_problems(procs, logs, envs.__getitem__), "an unread folder is no proof"
    assert lt.launcher_log_problems(procs[:1], logs, envs.__getitem__), "no gateway, nothing read"

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
def _started_test(h, run, unit="native-sim-r1"):
    """The run's own instance up: its unit active (owned: its invocation
    recorded), holding the VM's LinuxCNC."""
    h.active[unit] = True
    h.invocations[unit] = "inv-1"
    h.test_instance = ("linuxcncsvr", 900, 9000)
    state = {"test_unit": unit, "test_unit_invocation": "inv-1", "test_instance": [900, 9000],
             "tree": str(run / "tree"), "tree_of": "/wt"}
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
    assert json.loads((run / "state.json").read_text())["test_ended"] is True


def test_a_test_instance_that_does_not_end_keeps_the_lan_down_and_says_so(tmp_path, monkeypatch):
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.test_instance = ("linuxcncsvr", 900, 9000)      # its unit gone, its LinuxCNC still there
    monkeypatch.setattr(rl, "TEST_END_S", 0.1)
    out = rl.restore(h, pre, {"test_unit": "native-sim-r1", "test_unit_invocation": "inv-1", "test_instance": [900, 9000],
                              "tree": "/run/tree", "tree_of": "/wt"})
    assert out["outcome"] == "not_returned" and any("still runs" in r for r in out["reasons"])
    assert h.started == [], "never a second LinuxCNC beside it"
    assert h.removed == [], "the tree stays while its processes live"


def test_a_restore_interrupted_after_the_test_end_is_completed_by_the_next(tmp_path):
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    state = {"test_unit": "native-sim-r1", "test_unit_invocation": "inv-1", "test_instance": [900, 9000],
             "tree": "/run/tree", "tree_of": "/wt"}
    h.active["native-sim-r1"], h.invocations["native-sim-r1"] = True, "inv-1"
    h.test_instance = ("linuxcncsvr", 900, 9000)
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



# ── R287: the double ending, ownership, a partial return, the repeat's proofs ──
def test_the_normal_double_ending_recognises_the_returned_lan(tmp_path):
    """finally, then ExecStopPost — with the test unit and the tree in the state (R287 FI-I19 A)."""
    h = FakeHost()
    run = tmp_path / "run"
    run.mkdir()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    state = _started_test(h, run)
    first = run / "restore.json"
    a = rl.restore(h, pre, state, first)
    b = rl.restore(h, pre, state, first)
    assert a["outcome"] == "complete" and b["outcome"] == "complete" and b["repeat_of"] == "complete", b
    assert h.removed == [str(run / "tree")], "removed once"


def test_a_failure_after_the_lan_start_resumes_and_starts_the_keepalive(tmp_path):
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    state, first = {}, tmp_path / "restore.json"
    h.fail_start.add("bg-keepalive")
    assert rl.restore(h, pre, state, first)["outcome"] == "not_returned"
    assert h.active["lcnc-sim-gates"] and state["isolation"] == [], "the isolation proven before the LAN start, kept"
    h.fail_start.clear()
    out = rl.restore(h, pre, state, first)
    assert out["outcome"] == "complete" and out["isolation"] == [] and h.active["bg-keepalive"], out


def test_an_intended_unit_that_was_never_ours_is_left_alone(tmp_path):
    """systemd-run failed (the name existed): the intent is no ownership (R287 FI-I19 B)."""
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.active["native-sim-r1"], h.invocations["native-sim-r1"] = True, "someone-elses"
    out = rl.restore(h, pre, {"test_unit_intent": "native-sim-r1"})
    assert h.active["native-sim-r1"], "a unit the run never owned is not stopped"
    # owned once, but now another incarnation of that name runs: not stopped either
    out = rl.restore(h, pre, {"test_unit": "native-sim-r1", "test_unit_invocation": "inv-1"})
    assert h.active["native-sim-r1"]


def test_the_repeat_restore_proves_the_current_state_again(tmp_path):
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    first = tmp_path / "restore.json"
    assert rl.restore(h, pre, {}, first)["outcome"] == "complete"
    h.head = "moved"
    again = rl.restore(h, pre, {}, first)
    assert again["outcome"] == "not_returned" and any("HEAD" in r for r in again["reasons"])
    h.head = "abc"
    h.units["bg-keepalive"] = {**h.units["bg-keepalive"], "ExecStart": ["/py", "other.py"]}
    again = rl.restore(h, pre, {}, first)
    assert again["outcome"] == "not_returned" and any("another command" in r for r in again["reasons"])


def test_an_unknown_interpreter_is_named():
    """R287 FI-I18: /proc/<pid>/exe unreadable → no proof, never silence."""
    tree, ini = Path("/run/tree"), Path("/run/configs/sim/lcnc_suite_sim_3axis_xyz.ini")
    procs = [{"cmdline": ["python3", str(tree / "lcnc-gateway/hal_reader.py")], "exe": None, "cwd": "/"}]
    assert any("interpreter unknown" in p for p in lt.process_problems(procs, tree, ini))



# ── R288 FI-I19 B / A: a start whose record was lost; phases on disk ─────
def _intent(run):
    return {"test_unit_intent": "native-sim-r1", "test_unit_wd": str(run / "configs/sim"),
            "test_ini": str(run / "configs/sim/x.ini"), "tree": str(run / "tree"), "tree_of": "/wt"}


def test_a_start_whose_ownership_was_never_written_is_still_ended_first(tmp_path):
    """Killed after systemd-run started the unit, before its ownership was
    written: the intent is resolved against the unit itself (R288 FI-I19 B)."""
    run = tmp_path / "run"
    run.mkdir()
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    state = _intent(run)
    h.run_test_unit("native-sim-r1", state["test_unit_wd"], state["test_ini"])
    out = rl.restore(h, pre, state, run / "restore.json")
    assert out["outcome"] == "complete", out
    assert not h.active["native-sim-r1"] and h.test_instance is None, "the run's own unit ended first"
    assert h.removed == [str(run / "tree")]


def test_an_intended_name_running_something_else_is_unresolved_and_blocks(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.run_test_unit("native-sim-r1", "/elsewhere", "/other.ini")
    out = rl.restore(h, pre, _intent(run), run / "restore.json")
    assert out["outcome"] == "not_returned" and any("unresolved" in r for r in out["reasons"]), out
    assert h.active["native-sim-r1"] and h.removed == [] and h.started == [], "neither stopped, nor the tree, nor the LAN"


def test_the_phases_are_on_disk_before_the_lan_starts(tmp_path):
    """R288 FI-I19 A: killed right after the LAN start, the next restore
    reads state.json from the FILE — the isolation proven before it stays."""
    state_path = tmp_path / "state.json"
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.hashes.update(nc_files="changed")
    seen = {}

    class Killed(BaseException):
        pass

    def start(name, spec, _orig=h.start):
        _orig(name, spec)
        seen.update(json.loads(state_path.read_text()))
        raise Killed()
    h.start = start
    with pytest.raises(Killed):
        rl.restore(h, pre, {}, tmp_path / "restore.json", save=lambda st: state_path.write_text(json.dumps(st)))
    assert seen.get("isolation") == ["nc_files changed"] and seen.get("test_ended") is True, seen
    del h.start
    h.hashes.update(nc_files="h1", config="the LAN wrote its own state")
    out = rl.restore(h, pre, json.loads(state_path.read_text()), tmp_path / "restore.json")
    assert out["isolation"] == ["nc_files changed"], "the proof made before the LAN ran, not a later hash"



def test_a_frame_received_after_the_reply_may_be_captured_before_it():
    """Codex R288 FI-I23: 50 mm/s, 750 mm/s²; the reply at 315, the frame
    received 5 ms before it captured at 311.7 (−66 ms), the one received 5 ms
    after it captured at 313.35 (−33 ms), standstill 316.667 — 1.667 mm of
    real braking, within 2.067. The receipt order gives no lower bound: no
    FAIL; the upper bound (316.667 − 311.7 = 4.967) gives no PASS."""
    for sign in (1, -1):
        r = nc.eval_jog("jog-x", 0, sign, 300.0, (-0.005, 300 + sign * 11.7),
                        [(0.005, 300 + sign * 13.35, 50.0), (0.08, 300 + sign * 16.667, 0.0)])
        assert r["status"] == "incomplete", r
    wrong_way = nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.01, 290.0), [(0.1, 289.0, 0.0)])
    assert wrong_way["status"] == "FAIL", "a proven wrong direction stays a FAIL"
    short = nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.01, 302.0), [(0.1, 303.0, 0.0)])
    assert short["status"] == "incomplete", "a frame before the reply may be stale: 2 mm proves no short jog"



# ── R289 FI-I19 B: not active is not ended ───────────────────────────────
def _owned_state(run):
    return {"test_unit": "native-sim-r1", "test_unit_invocation": "inv-1", "test_unit_wd": str(run / "configs/sim"),
            "test_ini": str(run / "configs/sim/x.ini"), "tree": str(run / "tree"), "tree_of": "/wt"}


@pytest.mark.parametrize("state_name", ["activating", "deactivating"])
def test_a_unit_in_transition_with_a_live_process_keeps_the_tree_and_the_lan_back(tmp_path, monkeypatch, state_name):
    monkeypatch.setattr(rl, "TEST_END_S", 0.2)
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    run = tmp_path / "run"
    h.run_test_unit("native-sim-r1", run / "configs/sim", run / "configs/sim/x.ini")
    h.invocations["native-sim-r1"] = "inv-1"
    h.states = {"native-sim-r1": state_name}
    h.stop = lambda name: None          # the unit does not finish its stop in time
    out = rl.restore(h, pre, _owned_state(run), tmp_path / "restore.json")
    assert out["outcome"] == "not_returned", out
    assert h.removed == [] and h.started == [], "neither the tree nor the LAN while its process lives"


def test_a_failed_unit_query_is_unresolved_and_blocks(tmp_path):
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    h.query_fails = True
    out = rl.restore(h, pre, _owned_state(tmp_path / "run"), tmp_path / "restore.json")
    assert out["outcome"] == "not_returned" and any("not read" in r for r in out["reasons"]), out
    assert h.removed == [] and h.started == []


def test_an_abort_during_the_stop_leaves_the_found_instance_on_disk(tmp_path, monkeypatch):
    """R289: the instance found by the ending is written BEFORE the stop; a
    new CLI that meets the unit `deactivating` waits for exactly that process."""
    monkeypatch.setattr(rl, "TEST_END_S", 0.2)
    state_path = tmp_path / "state.json"
    h = FakeHost()
    pre = rl.record(h)
    rl.stop_lan(h, pre)
    run = tmp_path / "run"
    h.run_test_unit("native-sim-r1", run / "configs/sim", run / "configs/sim/x.ini")
    h.invocations["native-sim-r1"] = "inv-1"

    class Killed(BaseException):
        pass

    def dies_in_the_stop(name):
        h.states = {name: "deactivating"}
        raise Killed()
    h.stop = dies_in_the_stop
    with pytest.raises(Killed):
        rl.restore(h, pre, _owned_state(run), tmp_path / "restore.json",
                   save=lambda st: state_path.write_text(json.dumps(st)))
    on_disk = json.loads(state_path.read_text())
    assert on_disk["test_instance"] == [900, 9000], "found and written before the stop"
    h.stop = lambda name: None          # `systemctl stop` joins the pending stop job, which has not ended
    out = rl.restore(h, pre, on_disk, tmp_path / "restore.json")
    assert out["outcome"] == "not_returned" and h.removed == [] and h.started == [], "still deactivating, alive"
    h.states, h.test_instance = {"native-sim-r1": "inactive"}, None      # its stop finished
    out = rl.restore(h, pre, on_disk, tmp_path / "restore.json")
    assert out["outcome"] == "complete" and h.removed == [str(run / "tree")], out


# ── R289 FI-I23: the whole collected course decides ──────────────────────
def test_a_course_that_contradicts_the_stop_never_passes():
    back = nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.005, 315.0), [(0.06, 316.65, 5.0), (0.2, 314.5, 0.0)])
    assert back["status"] == "FAIL" and "against" in back["detail"], back
    back_neg = nc.eval_jog("jog-x-", 0, -1, 300.0, (-0.005, 285.0), [(0.06, 283.35, 5.0), (0.2, 285.5, 0.0)])
    assert back_neg["status"] == "FAIL", back_neg
    again = nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.005, 315.0),
                        [(0.01, 315.4, 0.0), (0.2, 325.0, 50.0), (0.45, 337.5, 50.0), (0.8, 355.0, 50.0)])
    assert again["status"] == "FAIL" and "after its standstill" in again["detail"], again
    again_neg = nc.eval_jog("jog-x-", 0, -1, 300.0, (-0.005, 285.0),
                            [(0.01, 284.6, 0.0), (0.2, 275.0, 50.0), (0.45, 262.5, 50.0)])
    assert again_neg["status"] == "FAIL" and "after its standstill" in again_neg["detail"], again_neg
    ok = nc.eval_jog("jog-x+", 0, 1, 300.0, (-0.005, 315.0), [(0.01, 315.4, 20.0), (0.2, 316.5, 0.0), (0.8, 316.5, 0.0)])
    assert ok["status"] == "PASS" and "first_after_mm" in ok and "brake_lower_mm" not in ok


def test_a_shown_working_directory_is_given_back_in_the_form_systemd_run_takes():
    """Measured 2026-11-05: `systemctl show` prints a missing-ok folder as
    "!/home/cnc" (the keepalive's — systemd-run's default), `systemd-run -p`
    refuses "!" ("expects an absolute path or '~'") and takes "-/home/cnc",
    which shows as "!/home/cnc" again: the restore would not start the
    keepalive, and the LAN sim with no client trips."""
    from test_support.system_host import settable_wd
    assert settable_wd("!/home/cnc") == "-/home/cnc"
    assert settable_wd("!~") == "-~"
    assert settable_wd("/home/cnc/linuxcnc/configs/x") == "/home/cnc/linuxcnc/configs/x"
    assert settable_wd("") == "/"



# ── R290 FI-I23: every known value counts, the tolerance is fixed ────────
@pytest.mark.parametrize("sign", [1, -1])
@pytest.mark.parametrize("later", ["position known", "velocity known"])
def test_a_known_value_contradicts_the_standstill_even_when_its_partner_is_unknown(sign, later):
    """Codex R290 rest A: 315.4 at standstill after 10 ms, then a frame whose
    position (325, velocity unknown) or velocity (50, position unknown) says
    it moved — dropping the whole frame made it a PASS."""
    p = lambda d: 300 + sign * d
    frame = (0.2, p(25.0), None) if later == "position known" else (0.2, None, 50.0)
    for tail in ([], [(0.5, p(15.4), 0.0)]):      # alone, and with a valid standstill frame after it
        r = nc.eval_jog("jog", 0, sign, 300.0, (-0.005, p(15.0)), [(0.01, p(15.4), 0.0), frame] + tail)
        # the EARLIEST contradiction is named — 325 then back to 315.4 is a step back too, but later
        assert r["status"] == "FAIL" and "after its standstill at +0.010 s" in r["detail"] \
            and "at +0.200 s" in r["detail"], (tail, r)


@pytest.mark.parametrize("sign", [1, -1])
def test_small_backward_steps_cannot_add_up_past_the_tolerance(sign):
    """Codex R290 rest B: 317.040, then nine steps of 0.009 back to 316.959
    at standstill — each under 0.01, together 0.081 from the furthest point."""
    p = lambda d: 300 + sign * d
    samples = [(0.01, p(17.040), 20.0)] + [(0.01 + 0.033 * k, p(17.040 - 0.009 * k), 5.0) for k in range(1, 9)]
    samples.append((0.307, p(16.959), 0.0))
    r = nc.eval_jog("jog", 0, sign, 300.0, (-0.005, p(15.0)), samples)
    assert r["status"] == "FAIL" and "furthest" in r["detail"], r
    # noise of a few thousandths around the furthest point stays a PASS
    ok = nc.eval_jog("jog", 0, sign, 300.0, (-0.005, p(15.0)),
                     [(0.01, p(16.5), 20.0), (0.04, p(16.497), 1.0), (0.07, p(16.499), 0.0), (0.2, p(16.498), 0.0)])
    assert ok["status"] == "PASS" and ok["brake_upper_mm"] == 1.5, ok


def test_an_unknown_position_before_the_standstill_leaves_the_course_unshown():
    r = nc.eval_jog("jog", 0, 1, 300.0, (-0.005, 315.0), [(0.03, None, 30.0), (0.1, 316.5, 0.0)])
    assert r["status"] == "incomplete" and "unknown" in r["detail"], r


@pytest.mark.parametrize("sign", [1, -1])
def test_the_upper_bound_runs_to_the_furthest_point_not_the_net_distance(sign):
    """R290: 2.070 mm to the furthest point (past the 2.067 bound), back
    0.008 within the tolerance to 2.062 at standstill — the net distance
    would pass, the travel did not."""
    p = lambda d: 300 + sign * d
    r = nc.eval_jog("jog", 0, sign, 300.0, (-0.005, p(15.0)), [(0.02, p(17.070), 3.0), (0.06, p(17.062), 0.0)])
    assert r["status"] == "incomplete" and r["brake_upper_mm"] == 2.07, r


# ── step 2: the M6 helper at the real interface (plan R284 FI282-02) ─────
from test_support import tool_change as tc  # noqa: E402


def _st(requested=False, seq=None, tool=None, number=0, interp=2, **extra):
    st = {"tool_change_requested": requested, "tool_change_seq": seq, "tool_number": number, "interp_state": interp}
    if tool is not None or requested:
        st["tool_change_tool"] = tool
    st.update(extra)
    return st


def _feed(changes, frames, t0=0.0, dt=0.05):
    """Each (status) at 20 Hz; the actions the helper asked for."""
    out = []
    for i, st in enumerate(frames):
        out.append(changes.step(t0 + i * dt, st))
    return out


def test_the_first_request_null_to_one_is_confirmed_once_and_completes():
    ch = tc.ToolChanges([1])
    assert ch.precheck(_st()) is None
    acts = _feed(ch, [_st(), _st(True, 1, 1), _st(True, 1, 1), _st(False, None, None, number=1)])
    assert acts == [None, ("confirm", 1), None, None], acts
    assert ch.served == [{"tool": 1, "seq": 1}] and ch.idle()


def test_tool_zero_is_a_tool_and_a_missing_tool_field_never_is():
    ch = tc.ToolChanges([0])
    assert _feed(ch, [_st(True, 4, 0, number=1), _st(number=0)]) == [("confirm", 4), None]
    missing = tc.ToolChanges([0])
    with pytest.raises(tc.ToolChangeError, match="unknown"):
        _feed(missing, [{"tool_change_requested": True, "tool_change_seq": 5, "tool_number": 1}])
    assert missing.confirmed == [], "never confirmed"


def test_an_old_open_request_before_the_trigger_refuses_the_sequence():
    ch = tc.ToolChanges([1])
    assert "open" in ch.precheck(_st(True, 7, 3))
    assert "open" in ch.precheck(_st(False, 7, None)), "a sequence number without a request is no clean start"
    assert "unknown" in ch.precheck({"tool_change_seq": None, "tool_number": 0}), "an unread request is no clean start"


def test_a_wrong_or_undeclared_tool_is_never_confirmed():
    ch = tc.ToolChanges([1])
    with pytest.raises(tc.ToolChangeError, match="T3"):
        _feed(ch, [_st(True, 2, 3)])
    assert ch.confirmed == []
    after = tc.ToolChanges([1])
    _feed(after, [_st(True, 2, 1), _st(number=1)])
    with pytest.raises(tc.ToolChangeError, match="undeclared"):
        _feed(after, [_st(True, 3, 1, number=1)])
    assert after.confirmed == [2]


def test_declared_changes_are_taken_in_their_order_and_may_be_skipped():
    ch = tc.ToolChanges([0, 1, 5])
    _feed(ch, [_st(True, 1, 1, number=0), _st(number=1), _st(True, 2, 5, number=1), _st(number=5)])
    assert [s["tool"] for s in ch.served] == [1, 5], "0 skipped: allowed is not required"
    back = tc.ToolChanges([1, 5])
    _feed(back, [_st(True, 1, 5), _st(number=5)])
    with pytest.raises(tc.ToolChangeError, match="T1"):
        _feed(back, [_st(True, 2, 1, number=5)])     # 1 came before 5: not after it


def test_the_connection_ending_while_waiting_confirms_nothing():
    c = FrameClient([(0.0, _st(True, 1, 1))])
    c.error = "Simulator WebSocket closed during the gate"
    ch = tc.ToolChanges([1])
    with pytest.raises(tc.ToolChangeError, match="connection"):
        tc.serve(c, ch, done=lambda t, st: False, deadline_s=1.0, cursor=0)
    assert c.sent == [] and ch.confirmed == []


def test_a_request_replaced_before_its_completion_is_refused():
    ch = tc.ToolChanges([1, 2])
    _feed(ch, [_st(True, 1, 1)])
    with pytest.raises(tc.ToolChangeError, match="before"):
        _feed(ch, [_st(True, 2, 2)])


# the hold sequence (R283 FI282-02): 5 s held, the whole interval checked at 20 Hz
def _held(n, **change):
    return [_st(True, 9, 99, number=1, interp=2)] * n + ([_st(True, 9, 99, number=1, interp=2, **change)] if change else [])


def test_the_hold_confirms_only_after_its_whole_interval():
    ch = tc.ToolChanges([99], hold_s=5.0)
    acts = _feed(ch, _held(101) + [_st(number=99)])
    assert acts[:100] == [None] * 100 and acts[100] == ("confirm", 9), acts[95:]
    assert ch.holds[0]["samples"] >= 100 and ch.holds[0]["max_gap_s"] <= 0.06


@pytest.mark.parametrize("change, reason", [
    ({"interp_state": 1}, "idle"),
    ({"tool_number": 5}, "tool"),
    ({"tool_change_requested": False}, "request"),
    ({"tool_change_seq": 10}, "request"),
])
def test_the_hold_fails_on_any_sample_that_breaks_it(change, reason):
    ch = tc.ToolChanges([99], hold_s=5.0)
    frames = _held(40)
    frames[20] = {**frames[20], **change}
    with pytest.raises(tc.ToolChangeError, match=reason):
        _feed(ch, frames)
    assert ch.confirmed == []


def test_a_gap_in_the_holds_frames_is_unobserved_never_a_proven_hold():
    """R292 FI-I24: a stretch with no frame is no observation — the hold is
    not proven (incomplete), and no sample in it contradicts anything."""
    ch = tc.ToolChanges([99], hold_s=5.0)
    acts = [ch.step(t, _st(True, 9, 99, number=1)) for t in [0.0, 0.05, 0.1, 1.5] + [1.5 + 0.05 * k for k in range(1, 80)]]
    assert ("confirm", 9) in acts and ch.holds[0]["max_gap_s"] == pytest.approx(1.4)
    assert nc.eval_m6_hold("m6-hold", ch.holds, 1, 99, 50.0, 99, 50.0, 5.0)["status"] == "incomplete"


# ── step 2: the evaluators (plan R283–R285 FI282-05) ─────────────────────
def test_a_counter_probe_passes_only_when_its_planted_value_is_refused():
    """R292 FI-I27: the planted value must be the reason — the measurement it
    re-judges passed against the true value, and fails against the planted."""
    good = nc.eval_probe_z("probe-z", 1, -180.0004, expected=-180.0)
    c = nc.counter("probe-z.counter-plate-1", nc.eval_probe_z("probe-z", 1, -180.0004, expected=-179.0), good)
    assert c["status"] == "PASS" and c["inner"]["status"] == "FAIL" and c["counter"] is True
    same = nc.counter("probe-z.counter-plate-1", nc.eval_probe_z("probe-z", 1, -179.0, expected=-179.0),
                      nc.eval_probe_z("probe-z", 1, -179.0, expected=-180.0))
    assert same["status"] == "incomplete", "a base that failed proves nothing"
    passed = nc.counter("probe-z.counter-plate-1", nc.eval_probe_z("probe-z", 1, -180.0, expected=-180.0), good)
    assert passed["status"] == "FAIL", "a planted value that passes: the check does not hold"
    nocontact = nc.eval_probe_z("probe-z", 0, -180.0, expected=-180.0)
    assert nc.counter("x", nc.eval_probe_z("probe-z", 0, -180.0, expected=-179.0), nocontact)["status"] == "incomplete"


@pytest.mark.parametrize("contact, g54, errors, status", [
    (1, -180.0004, [], "PASS"), (1, -180.0031, [], "FAIL"), (1, -179.9969, [], "FAIL"),
    (0, -180.0, [], "FAIL"), (None, -180.0, [], "incomplete"), (1, None, [], "incomplete"),
    (1, float("nan"), [], "incomplete"),
    (None, -175.0, [], "FAIL"),                  # R292 FI-I28: a known G54 out of bounds, the contact unread
    (0, None, [], "FAIL"),                       # a known "no contact", G54 unread
    (1, -180.0, [(11, "Probe tripped during non-probe move")], "FAIL"),
    (1, -180.0, [(13, "Probing: retry 1")], "PASS"),     # a DEBUG line is no failure
])
def test_the_z_probe_needs_its_contact_and_the_plate_within_its_tolerance(contact, g54, errors, status):
    r = nc.eval_probe_z("probe-z", contact, g54, expected=-180.0, errors=errors)
    assert r["status"] == status, r


@pytest.mark.parametrize("contact, before, after, errors, status", [
    (0, 0.0, 0.0, [(11, "G38.2 move finished without making contact.")], "PASS"),
    (1, 0.0, 0.0, [(11, "G38.2 move finished without making contact.")], "FAIL"),
    (0, 0.0, -180.0, [(11, "G38.2 move finished without making contact.")], "FAIL"),
    (0, 0.0, 0.0, [], "incomplete"),                        # the error may have ridden a skipped tick
    (None, 0.0, 0.0, [(11, "G38.2 move finished without making contact.")], "incomplete"),
    (None, 0.0, -1.0, [(11, "G38.2 move finished without making contact.")], "FAIL"),                      # R292 FI-I28: G54 changed, #5070 unread
    (1, None, None, [(11, "G38.2 move finished without making contact.")], "FAIL"),                        # a contact, G54 unread
])
def test_a_probe_without_contact_reports_none_and_sets_nothing(contact, before, after, errors, status):
    r = nc.eval_probe_miss("probe-z-miss", contact, before, after, errors)
    assert r["status"] == status, r


@pytest.mark.parametrize("length, g43, errors, status", [
    (50.0015, 50.0015, [], "PASS"), (50.0025, 50.0025, [], "FAIL"), (49.0, 49.0, [], "FAIL"),
    (50.0, 0.0, [], "FAIL"), (None, 50.0, [], "incomplete"), (50.0, None, [], "incomplete"),
    (60.0, None, [], "FAIL"),                    # R292 FI-I28: the length already out of bounds, G43 unread
    (50.0, 50.0, [(11, "Tool length offset probe failed!")], "FAIL"),
])
def test_m600_measures_the_length_and_applies_the_same(length, g43, errors, status):
    r = nc.eval_m600("m600-t1", 50.0, length, g43, errors=errors)
    assert r["status"] == status, r


@pytest.mark.parametrize("length, g43, tool, errors, status", [
    (49.0005, 49.0005, 1, [], "PASS"),           # #3102 one mm up: the length one mm short, applied as measured
    (50.0, 0.0, 1, [(11, "G38.2 move finished without making contact.")], "FAIL"),   # Codex R292: an aborted run
    (50.0, 50.0, 1, [], "FAIL"),                 # the plant changed nothing: the check would not see it
    (49.0, 50.0, 1, [], "FAIL"),                 # measured and applied differ
    (49.0, 49.0, 0, [], "FAIL"),                 # not the tool it measured
    (47.5, 47.5, 1, [], "FAIL"),                 # neither the true nor the planted reference
    (None, 49.0, 1, [], "incomplete"),
    (49.0005, 49.0005, 1, [(11, "Slow Tool Length Offset Probe Failed!")], "FAIL"),   # the values fit, the run did not
])
def test_the_m600_counter_needs_its_own_run_and_the_predicted_deviation(length, g43, tool, errors, status):
    r = nc.eval_m600_counter("m600-t1.counter-3102", base=50.0, true_3102=-180.0, planted_3102=-179.0,
                             length=length, g43=g43, tool_after=tool, tool=1, errors=errors)
    assert r["status"] == status, r


def _lock(seq, done_at):
    """(t, status): feed_override_enabled per frame (and optionally its
    |current_vel|; by default moving until done), done = interp idle + no
    request from `done_at` on."""
    out = []
    for item in seq:
        t, en = item[0], item[1]
        done = done_at is not None and t >= done_at
        vel = item[2] if len(item) > 2 else (0.0 if done else 5.0)
        out.append((t, {"feed_override_enabled": en, "interp_state": 1 if done else 2, "current_vel": vel,
                        "tool_change_seq": None, "tool_change_requested": False}))
    return out


def test_the_m600_lock_as_codex_drew_it_passes():
    frames = _lock([(0.03, True, 0.0), (0.2, False), (0.6, False), (1.0, False), (1.033, True)], done_at=1.033)
    r = nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)
    assert r["status"] == "PASS", r


def test_no_release_within_two_seconds_of_the_completion_fails():
    window = [(1.033 + 0.2 * k, False) for k in range(12)]           # the idle cadence, through 3.233 s
    frames = _lock([(0.03, True, 0.0), (0.2, False), (1.0, False)] + window, done_at=1.033)
    assert nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)["status"] == "FAIL"


def test_a_frame_after_the_window_is_no_coverage_of_it():
    """Codex R293 FI-I26 B: locked at the completion, no frame for two
    seconds, a locked one at 3.1 s — the window was not seen: incomplete."""
    frames = _lock([(0.03, True, 0.0), (0.2, False), (1.0, False), (1.033, False), (3.1, False)], done_at=1.033)
    r = nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)
    assert r["status"] == "incomplete" and "gap" in r["detail"], r


def test_a_release_after_unknown_motion_is_no_proven_standstill():
    """Codex R293 FI-I26 A: free at 0.4 and 0.8 s with the motion unread —
    whether the axis stood there is not shown: incomplete; free at a known
    standstill followed by known motion: FAIL."""
    unknown = _lock([(0.03, True, 0.0), (0.2, False), (0.4, True, None), (0.8, True, None), (1.033, True)],
                    done_at=1.033)
    assert nc.eval_override_lock("m600-lock", unknown, t_trigger=0.0)["status"] == "incomplete"
    resumed = _lock([(0.03, True, 0.0), (0.2, False), (0.4, True, 0.0), (0.8, True, 3.0), (1.033, True)],
                    done_at=1.033)
    assert nc.eval_override_lock("m600-lock", resumed, t_trigger=0.0)["status"] == "FAIL"


def test_a_window_not_observed_to_its_end_is_not_yet_a_failure():
    """R292 FI-I26 B: the completion frame still locked, the 2 s not yet past —
    incomplete; a fresh free frame 33 ms later makes the same course a PASS."""
    early = _lock([(0.03, True, 0.0), (0.2, False), (1.0, False), (1.033, False)], done_at=1.033)
    assert nc.eval_override_lock("m600-lock", early, t_trigger=0.0)["status"] == "incomplete"
    later = early + _lock([(1.066, True)], done_at=1.033)
    assert nc.eval_override_lock("m600-lock", later, t_trigger=0.0)["status"] == "PASS"


def test_free_while_the_axis_still_moves_fails_even_without_a_later_locked_frame():
    """R292 FI-I26 A: locked at 0.2, free again at 0.4 and 0.8 while moving —
    the phase is the motion's, not the span between locked frames."""
    frames = _lock([(0.03, True, 0.0), (0.2, False), (0.4, True), (0.8, True), (1.033, True)], done_at=1.033)
    assert nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)["status"] == "FAIL"
    after_motion = _lock([(0.03, True, 0.0), (0.2, False), (0.9, False), (0.95, True, 0.0), (1.033, True)],
                         done_at=1.033)
    assert nc.eval_override_lock("m600-lock", after_motion, t_trigger=0.0)["status"] == "PASS", \
        "free once the axis stands, before the routine's end: allowed"


def test_only_a_stale_true_from_before_the_completion_fails():
    # free at 0.9 while still moving, completed at 1.033 locked — and locked through the window
    frames = _lock([(0.03, True, 0.0), (0.2, False), (0.9, True)], done_at=None)
    frames += _lock([(1.033, False), (3.2, False)], done_at=1.033)
    assert nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)["status"] == "FAIL"


def test_no_observed_locked_phase_is_incomplete():
    frames = _lock([(0.03, True), (0.5, True), (1.0, True)], done_at=1.0)
    assert nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)["status"] == "incomplete"


def test_a_release_inside_the_measuring_phase_fails_and_a_stale_start_is_incomplete():
    flicker = _lock([(0.03, True, 0.0), (0.2, False), (0.4, True), (0.6, False), (1.033, True)], done_at=1.033)
    assert nc.eval_override_lock("m600-lock", flicker, t_trigger=0.0)["status"] == "FAIL"
    stale = _lock([(-0.5, True), (0.2, False), (1.033, True)], done_at=1.033)   # the only true is from before the trigger
    assert nc.eval_override_lock("m600-lock", stale, t_trigger=0.0)["status"] == "incomplete"


def test_a_routine_ends_only_after_it_was_seen_busy_unless_told_otherwise():
    end = tc.RoutineEnd()
    assert [end(t, {"interp_state": s, "inpos": True}) for t, s in [(0, 1), (3.0, 1), (3.1, 2), (3.2, 1)]] == \
        [False, False, False, True]
    short = tc.RoutineEnd(require_busy=False, grace=2.0)
    assert [short(t, {"interp_state": 1, "inpos": True}) for t in (0, 1.0, 2.0)] == [False, False, True]
    moving = tc.RoutineEnd()
    assert [moving(t, {"interp_state": s, "inpos": p}) for t, s, p in [(0, 2, False), (1, 1, False), (2, 1, True)]] == \
        [False, False, True]


def test_a_failed_step_keeps_the_rows_it_measured(tmp_path):
    h = FakeHost()

    def step(ctx):
        raise nr.StepFailed([{"case": "m6-hold", "status": "FAIL", "detail": "an undeclared tool change"}],
                            "the M6 sequence ended — the instance goes down")
    report = nr.run(h, [("m6", step)], tmp_path / "run")
    assert report["rows"] == [{"case": "m6-hold", "status": "FAIL", "detail": "an undeclared tool change"}]
    assert "the M6 sequence ended" in report["error"] and nr.verdict(report) == "FAIL"


# ── step 2: the client keeps the envelope (errors ride one tick only) ─────
def test_the_client_harvests_every_frames_errors_and_the_envelope():
    from test_support.live_session import SimulatorClient
    c = SimulatorClient("t", auto_confirm=False)
    c.take({"type": "status", "data": {"interp_state": 2}, "errors": [[11, "G38.2 move finished without making contact."]],
            "rfl_status": {"phase": "measuring", "ok": None}, "preview_origin": {"version": 4, "source": "ab"}})
    c.take({"type": "status_delta", "data": {}, "errors": [], "probe_results": {"z_minus": -180.0}})
    c.take({"type": "status_delta", "data": {"interp_state": 1}, "errors": [[13, "a note"]]})
    assert [(k, x) for _, k, x in c.errors] == [(11, "G38.2 move finished without making contact."), (13, "a note")]
    assert c.rfl_status == {"phase": "measuring", "ok": None} and [p["phase"] for _, p in c.rfl_history] == ["measuring"]
    assert c.preview_origin == {"version": 4, "source": "ab"} and c.probe_results == {"z_minus": -180.0}
    assert c.status["interp_state"] == 1
    c.take({"type": "reply", "cmd": "mdi", "ok": True, "errors": [[1, "not an envelope"]]})
    assert len(c.errors) == 2, "a reply is no status frame"


def test_the_plate_comes_from_the_copys_hal_and_must_be_whole():
    hal = "loadrt foo\nsetp sim-toolsetter.0.plate-x 10\nsetp sim-toolsetter.0.plate-y 10\n  setp sim-toolsetter.0.plate-z -180\n"
    assert nr.plate_from_hal(["# none", hal]) == {"x": 10.0, "y": 10.0, "z": -180.0}
    with pytest.raises(nr.Refused, match="plate"):
        nr.plate_from_hal(["setp sim-toolsetter.0.plate-x 10\nsetp sim-toolsetter.0.plate-y 10\n"])


def _hold(samples=101, gap=0.05):
    return [{"tool": 99, "seq": 3, "t0": 0.0, "last_t": 5.0, "samples": samples, "max_gap_s": gap, "tool_before": 1}]


@pytest.mark.parametrize("holds, after, offset, status", [
    (_hold(), 99, 50.0, "PASS"),
    (_hold(samples=60), 99, 50.0, "incomplete"),     # 5 s at 20 Hz is ≥ 90 received frames — fewer: unobserved
    (_hold(gap=0.2), 99, 50.0, "incomplete"),     # R292 FI-I24: unobserved, not contradicted
    (_hold(gap=0.2), 1, 50.0, "FAIL"),            # a known contradiction stays one
    ([], 99, 50.0, "FAIL"),                          # no request ever held: M6 did not wait for anything
    (_hold(), 1, 50.0, "FAIL"),                      # it did not go on with the new tool
    (_hold(), 99, 40.0, "FAIL"),                     # nor with its length
    (_hold(), 99, None, "incomplete"),
])
def test_m6_waits_held_and_goes_on_with_the_new_tool(holds, after, offset, status):
    r = nc.eval_m6_hold("m6-hold", holds, 1, after, offset, 99, 50.0, 5.0)
    assert r["status"] == status, r


class FrameClient:
    """A live client's surface for the case helpers: the frames it RECEIVED,
    in order, each (t, status) — `status` the latest; requests recorded and
    answered with scripted arrivals (`on[cmd]`: the frames that cmd brings)."""

    def __init__(self, frames=(), on=None):
        self.frames, self.sent, self.errors, self.error = list(frames), [], [], None
        self.on = {k: list(v) for k, v in (on or {}).items()}

    @property
    def status(self):
        return dict(self.frames[-1][1]) if self.frames else {}

    def request(self, cmd, **kw):
        self.sent.append((cmd, kw))
        self.frames += self.on.pop(cmd, [])
        return {"ok": True}


_IDLE = {"tool_change_requested": False, "tool_change_seq": None, "inpos": True, "interp_state": 1}


def test_a_routine_ends_on_its_started_effect_seen_while_it_runs():
    """The start latch (the probe's M50 P0) shows only WHILE it runs: a
    done-check that evaluates it only on idle frames never ends."""
    run = [{**_IDLE, "feed_override_enabled": True}] + \
          [{**_IDLE, "interp_state": 2, "feed_override_enabled": False, "inpos": False}] * 3 + \
          [{**_IDLE, "interp_state": 2, "feed_override_enabled": True}] + \
          [{**_IDLE, "feed_override_enabled": True}] * 3
    c = FrameClient([(0.0, {**_IDLE, "feed_override_enabled": True})],
                    on={"mdi": [(0.1 * (k + 1), st) for k, st in enumerate(run)]})
    seen = {"on": False}

    def ran(st):
        seen["on"] = seen["on"] or st.get("feed_override_enabled") is False
        return seen["on"]
    r = nr._routine(c, "O<probe_z_minus_wco> CALL", vars={3030: 0}, deadline=2.0, extra=ran)
    assert c.sent[0] == ("mdi", {"text": "O<probe_z_minus_wco> CALL", "vars": {"3030": 0}}) and r["served"] == []


def test_a_held_change_ends_its_routine_on_the_real_path():
    """R292 FI-I25: serve → RoutineEnd with a held change: busy only while M6
    waits, the next frame after the confirmation already idle, in position,
    the new tool — a valid course that must end."""
    held = [(0.033 * k, _st(True, 9, 99, number=1, interp=4, inpos=True)) for k in range(1, 160)]
    c = FrameClient([(0.0, {**_IDLE, "tool_number": 1})],
                    on={"tool_change": held, "confirm_tool_change": [(5.4, {**_IDLE, "tool_number": 99})]})
    changes = tc.ToolChanges([99], hold_s=5.0)
    cursor = len(c.frames)
    c.request("tool_change", tool_number=99)
    end = tc.RoutineEnd()
    served = tc.serve(c, changes, lambda t, st: end(t, st) and st.get("tool_number") == 99, 2.0, cursor=cursor)
    assert served == [{"tool": 99, "seq": 9}] and changes.holds[0]["samples"] >= 150


def test_the_hold_counts_received_frames_never_reads_of_the_cache():
    """R292 FI-I24 on the real client: ONE open M6 frame, then none — the
    cache read every 50 ms used to make that 102 samples and a PASS."""
    from test_support.live_session import SimulatorClient
    c = SimulatorClient("t", auto_confirm=False, keep=("tool_change_requested", "tool_change_seq", "tool_change_tool",
                                                      "tool_number", "interp_state", "inpos"))
    c.send = lambda command: None
    c.take({"type": "status", "data": {**_st(True, 9, 99, number=1, interp=4), "inpos": True}})
    assert len(c.frames) == 1
    changes = tc.ToolChanges([99], hold_s=5.0)
    with pytest.raises(tc.ToolChangeError, match="not done"):
        tc.serve(c, changes, lambda t, st: False, 0.6, cursor=0)
    assert changes.confirmed == [] and changes.holds[0]["samples"] == 1, "one frame received: one sample"


class EchoClient(FrameClient):
    """The interpreter answers a DEBUG line through the error channel —
    except the attempts listed as lost (a skipped status tick); every request
    brings two idle frames a second apart (the idle status cadence)."""

    def __init__(self, lost=()):
        super().__init__([(0.0, dict(_IDLE))])
        self.lost, self.debug = set(lost), 0

    def request(self, cmd, **kw):
        super().request(cmd, **kw)
        t = self.frames[-1][0]
        self.frames += [(t + 1.0, dict(_IDLE)), (t + 2.0, dict(_IDLE))]
        text = kw.get("text", "")
        if text.startswith("(DEBUG,"):
            self.debug += 1
            if self.debug not in self.lost:
                tag = text[7:].split()[0]
                self.errors.append((time.monotonic(), 13, f"{tag} P5070=1.000000 P5063=-130.000000"))
        return {"ok": True}


def test_parameters_without_a_status_field_are_read_through_a_tagged_debug_line(monkeypatch):
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    monkeypatch.setattr(nr, "DEBUG_WAIT", 0.2)
    c = EchoClient()
    assert nr._read_params(c, [5070, 5063]) == {5070: 1.0, 5063: -130.0}
    assert c.sent[0][1]["text"].endswith(" P5070=#5070 P5063=#5063)")
    lost_once = EchoClient(lost={1})
    assert nr._read_params(lost_once, [5070])[5070] == 1.0 and lost_once.debug == 2, "a lost tick is read again"
    never = EchoClient(lost={1, 2, 3})
    assert nr._read_params(never, [5070]) == {5070: None}, "unread stays unknown, never 0"


@pytest.mark.parametrize("served, after, offset, status", [
    ([{"tool": 0, "seq": 4}], 0, 0.0, "PASS"),
    ([], 0, 0.0, "PASS"),               # nothing was in the spindle: allowed, not required
    ([{"tool": 0, "seq": 4}], 1, 0.0, "FAIL"),
    ([{"tool": 0, "seq": 4}], 0, 50.0, "FAIL"),   # the old length still applied
    ([{"tool": 0, "seq": 4}], 0, None, "incomplete"),
])
def test_unloading_leaves_the_spindle_empty_and_no_length_applied(served, after, offset, status):
    assert nc.eval_unload("m600-unload", served, after, offset)["status"] == status


def test_a_late_frame_still_showing_the_served_request_is_not_confirmed_again():
    ch = tc.ToolChanges([1, 1])
    acts = _feed(ch, [_st(True, 1, 1), _st(number=1), _st(True, 1, 1, number=1), _st(number=1)])
    assert acts == [("confirm", 1), None, None, None] and ch.confirmed == [1], acts


def test_a_change_without_a_hold_ends_its_routine_when_the_next_frame_is_already_done():
    """Codex R292 FI-I25 as drawn: one busy frame with the new request, the
    confirmation, the next frame idle, in position, the new tool."""
    c = FrameClient([(0.0, {**_IDLE, "tool_number": 1})],
                    on={"tool_change": [(0.03, _st(True, 10, 99, number=1, interp=4, inpos=True))],
                        "confirm_tool_change": [(0.06, {**_IDLE, "tool_number": 99})]})
    changes, cursor = tc.ToolChanges([99]), 1
    c.request("tool_change", tool_number=99)
    end = tc.RoutineEnd()
    assert tc.serve(c, changes, end, 1.0, cursor=cursor) == [{"tool": 99, "seq": 10}] and end.seen_busy


def test_the_m600_step_refuses_a_counter_that_failed_for_another_reason(monkeypatch):
    """Codex R292 FI-I27 at the whole step: the counter run aborts without a
    contact (length unchanged, G43 cancelled) — its row FAILs with the
    routine's error kept, the other three rows stand on their own."""
    lock = lambda t, en, idle=False, vel=0.0: (t, {"feed_override_enabled": en, "interp_state": 1 if idle else 2,  # noqa: E731
                                                    "current_vel": vel, "tool_change_seq": None,
                                                    "tool_change_requested": False})

    class Client:
        def __init__(self):
            self.status = {"tool_number": 99, "tool_offset": [0, 0, 50], "tool_table_z": 50}
            self.vars = {n: 0 for n in nr.TOOLSETTER_VARS} | {3102: -180}
            self.table = 50.0

        def request(self, cmd, **kw):
            if cmd == "get_tool_table":
                return {"tools": [{"T": 1, "Z": self.table}]}
            if cmd == "get_probe_vars":
                return {"vars": {str(k): self.vars[k] for k in kw["vars"]}}
            if cmd == "save_tool":
                self.table = kw["z_offset"]
                return {"ok": True}
            if cmd == "set_probe_vars":
                self.vars.update({int(k): v for k, v in kw["vars"].items()})
                return {"ok": True}
            raise AssertionError((cmd, kw))
    c, frames, calls = Client(), [], []
    no_contact = [(11, "G38.2 move finished without making contact.")]

    def routine(client, text, vars=None, **kw):
        past = time.monotonic() - 10
        if text == "T0 M600":
            client.status.update(tool_number=0, tool_offset=[0, 0, 0])
            return {"t0": 0, "t_done": past, "served": [{"tool": 0, "seq": 1}], "errors": []}
        calls.append(vars[3102])
        first = len(calls) == 1
        client.status.update(tool_number=1, tool_table_z=50.0, tool_offset=[0, 0, 50.0] if first else [0, 0, 0])
        if first:
            frames.extend([lock(0.03, True), lock(0.2, False, vel=1.0), lock(1.033, True, idle=True)])
        return {"t0": 0, "t_done": past, "served": [{"tool": 1, "seq": 2}], "errors": [] if first else no_contact}

    def short(client, text):
        assert text == "G43 H1"
        client.status["tool_offset"] = [0, 0, client.table]
    monkeypatch.setattr(nr, "_routine", routine)
    monkeypatch.setattr(nr, "_short", short)
    monkeypatch.setattr(nr, "_to", lambda client, x, y, z: None)
    monkeypatch.setattr(nr, "_vars", lambda client, nums: {n: client.vars[n] for n in nums})
    rows = nr.m600_cases()[1]({"client": c, "frames": frames, "plate": {"x": 10, "y": 10, "z": -180}})
    by = {r["case"]: r for r in rows}
    assert calls == [-180, -179], "the counter ran with #3102 planted 1 mm up"
    assert [by[k]["status"] for k in ("m600-unload", "m600-t1", "m600-t1-override-lock")] == ["PASS"] * 3, rows
    assert by["m600-t1.counter-3102"]["status"] == "FAIL" and by["m600-t1.counter-3102"]["errors"] == no_contact


# ── step 2b: run from line (Codex R292 FI292-01) ─────────────────────────
L = 7                       # "G61.1 G1 X200 F3000"
L0 = 50.0


def _rfl_frame(t, line, xyz, *, mode=2, level=0, vel=50.0, interp=2, tool=1, offset=50.0, table=50.0,
               sdir=1, speed=1000.0):
    return (t, {"task_mode": mode, "call_level": level, "motion_line": line, "current_vel": vel, "interp_state": interp,
                "inpos": vel == 0.0, "joint_pos": list(xyz), "tool_number": tool, "tool_offset": [0, 0, offset],
                "tool_table_z": table, "spindle_direction": sdir, "spindle_speed": speed})


def _rfl_run(**witness):
    """A clean run: measuring (MDI, subroutine), safe Z up, XY to the entry,
    then the program from line 7 to its end — Z descends only by the
    program's own words (the dialog's contract): lines 7 and 8 run at the
    safe height, line 9 (G0 Z-80) takes T1's joint to -30 (live run
    2026-11-05: line 7 at joint 0, where the entry left it)."""
    hist = [(0.0, {"phase": "measuring", "ok": None}), (20.0, {"phase": "safe_z", "ok": None}),
            (21.0, {"phase": "positioning", "ok": None}), (23.0, {"phase": "starting", "ok": None}),
            (23.2, {"phase": "running", "ok": True})]
    frames = [_rfl_frame(5.0, 120, (10, 10, -128), mode=3, level=2, vel=3.0, tool=1, offset=0.0),   # inside M600
              _rfl_frame(20.1, 0, (10, 10, -100), mode=3, vel=80.0), _rfl_frame(20.9, 0, (10, 10, 0.0), mode=3, vel=0.0),
              _rfl_frame(21.5, 0, (60, 60, 0.0), mode=3, vel=100.0), _rfl_frame(22.9, 0, (100, 100, 0.0), mode=3, vel=0.0),
              _rfl_frame(23.3, L, (101, 100, 0.0), **witness), _rfl_frame(24.3, L, (150, 100, 0.0)),
              _rfl_frame(25.3, 8, (200, 101, 0.0)), _rfl_frame(27.3, 9, (200, 200, -15)),
              _rfl_frame(28.0, 11, (200, 200, -30.0), vel=0.0, interp=1)]
    return hist, frames


def _line(hist, frames, line=L):
    return nc.eval_rfl_line("rfl-line", hist, frames, line=line, tool=1, l0=L0, spindle_speed=1000.0,
                            end_point=(200.0, None, nr.RFL_SAFE_Z), final=(200.0, 200.0, nr.RFL_Z_END + L0),
                            line_holds={1: 100.0, 2: nr.RFL_SAFE_Z})


def test_the_run_from_line_witness_is_a_motion_of_line_l_with_its_tool_and_spindle():
    hist, frames = _rfl_run()
    r = _line(hist, frames)
    assert r["status"] == "PASS" and r["witness_line"] == L, r


@pytest.mark.parametrize("change, part", [
    ({"line": 6}, "line 6"),                       # an earlier line moved first
    ({"tool": 99}, "T99"),
    ({"offset": 40.0}, "offset"),                  # applied ≠ the table's
    ({"table": 50.004, "offset": 50.004}, "L0"),   # measured outside L0 ± 0.002
    ({"sdir": -1}, "spindle"), ({"speed": 800.0}, "spindle"),
])
def test_a_witness_that_contradicts_the_start_fails(change, part):
    hist, frames = _rfl_run()
    line = change.pop("line", L)
    frames[5] = _rfl_frame(23.3, line, (101, 100, -0.5), **change)
    r = _line(hist, frames)
    assert r["status"] == "FAIL" and part in r["detail"], r


def test_line_l_must_reach_its_end_and_the_program_its_own():
    hist, frames = _rfl_run()
    frames[7] = _rfl_frame(25.3, 8, (199.0, 101, -50))
    assert "end" in _line(hist, frames)["detail"] and _line(hist, frames)["status"] == "FAIL"
    hist, frames = _rfl_run()
    frames[-1] = _rfl_frame(28.0, 11, (200, 150, 0.0), vel=0.0, interp=1)
    assert _line(hist, frames)["status"] == "FAIL"
    hist, frames = _rfl_run()
    frames[6] = _rfl_frame(24.3, L, (150, 102, -25))          # line 7 moved Y, which it holds
    assert _line(hist, frames)["status"] == "FAIL" and "joint 1" in _line(hist, frames)["detail"]
    hist, frames = _rfl_run()
    assert _line(hist, frames[:-1])["status"] == "incomplete", "the program's end not received"


def test_a_failed_phase_fails_and_no_start_is_incomplete():
    hist, frames = _rfl_run()
    bad = hist[:2] + [(20.5, {"phase": "safe_z_failed", "ok": False, "error": "Z not reached"})]
    assert _line(bad, frames)["status"] == "FAIL"
    assert _line(hist[:3], frames)["status"] == "incomplete", "running is the start message"
    assert _line(hist, frames[:5])["status"] == "incomplete", "no motion of the program after the start"


def test_the_line_counter_is_anchored_at_the_witness_of_l():
    hist, frames = _rfl_run()
    base = _line(hist, frames)
    c = nc.counter("rfl-line.counter-line+1", _line(hist, frames, line=L + 1), base)
    assert c["status"] == "PASS" and "line 7" in c["inner"]["detail"], c
    no_witness = nc.counter("x", _line(hist, frames[:5], line=L + 1), _line(hist, frames[:5]))
    assert no_witness["status"] == "incomplete", "no witness of L: no counter-proof"


def test_no_earlier_line_is_said_of_the_observed_main_program_frames_only():
    hist, frames = _rfl_run()
    r = nc.eval_rfl_no_earlier("rfl-no-earlier-line", hist, frames, line=L)
    assert r["status"] == "PASS" and r["scope"] == "observed frames", r
    frames.insert(5, _rfl_frame(23.25, 5, (100, 100, 0.0), vel=0.0))     # line 5 shown after the start
    assert nc.eval_rfl_no_earlier("rfl-no-earlier-line", hist, frames, line=L)["status"] == "FAIL"
    assert nc.eval_rfl_no_earlier("x", hist, frames[:5], line=L)["status"] == "incomplete"


def test_the_start_point_fails_on_an_observed_contradiction_and_is_otherwise_unproven():
    hist, frames = _rfl_run()
    r = nc.eval_rfl_start_point("rfl-start-point", hist, frames, entry_xy=(100.0, 100.0))
    assert r["status"] == "incomplete" and "2c" in r["detail"], r
    lowered = list(frames)
    lowered[2] = _rfl_frame(20.9, 0, (10, 10, -101.0), mode=3, vel=0.0)      # below its start in the safe-Z stage
    assert nc.eval_rfl_start_point("x", hist, lowered, entry_xy=(100.0, 100.0))["status"] == "FAIL"
    off = list(frames)
    off[4] = _rfl_frame(22.9, 0, (100, 99.5, 0.0), mode=3, vel=0.0)          # the entry not reached
    assert nc.eval_rfl_start_point("x", hist, off, entry_xy=(100.0, 100.0))["status"] == "FAIL"
    dipped = list(frames)
    dipped[3] = _rfl_frame(21.5, 0, (60, 60, -5.0), mode=3, vel=100.0)       # XY moved below the safe height
    assert nc.eval_rfl_start_point("x", hist, dipped, entry_xy=(100.0, 100.0))["status"] == "FAIL"


def test_the_run_from_line_program_is_what_its_constants_say():
    lines = nr.RFL_PROGRAM.splitlines()
    assert lines[nr.RFL_LINE - 1] == "G61.1 G1 X200 F3000" and lines[nr.RFL_LINE] == "G1 Y200"
    assert "G0 X100 Y100" in lines[:nr.RFL_LINE - 1] and "G54" in lines[1] and "G21" in lines[1]
    assert f"G0 Z{nr.RFL_Z_LINE:g}" in lines[:nr.RFL_LINE - 1] and f"G0 Z{nr.RFL_Z_END:g}" in lines[nr.RFL_LINE:]
    # T1 with L0 = 50 keeps every joint Z inside its window (MAX_LIMIT 0.1)
    assert nr.RFL_Z_LINE + 50 <= 0 and nr.RFL_Z_END + 50 <= 0


def test_a_subroutines_motion_is_never_the_witness_of_the_program_line():
    """A remap or subroutine numbers ITS file: motion_line 3 at call_level 1
    is no line 3 of the program (R292: call_level 0 only)."""
    hist, frames = _rfl_run()
    frames.insert(5, _rfl_frame(23.25, 3, (100, 100, -0.2), level=1, vel=5.0))
    r = _line(hist, frames)
    assert r["status"] == "PASS" and r["witness_line"] == L, r



def test_the_counter_predicts_from_its_own_base_not_the_first_measurements():
    """Codex R293 FI-I27: the first measurement left 49.9985 (within ± 0.002
    of L0 50); the sim's physical length IS the table's — the counter run
    starts from 49.9985 and gives 48.9970: within its own prediction."""
    r = nc.eval_m600_counter("m600-t1.counter-3102", base=49.9985, true_3102=-180.0, planted_3102=-179.0,
                             length=48.9970, g43=48.9970, tool_after=1, tool=1)
    assert r["status"] == "PASS" and r["base"] == 49.9985, r


# ── R293 FI-I24: a gap is no contradiction, up to the step's row ──────────
def test_every_end_of_the_m6_helper_says_its_cause():
    with pytest.raises(tc.ToolChangeError) as e:
        _feed(tc.ToolChanges([1]), [_st(True, 2, 3)])
    assert e.value.cause == "contradiction"
    ch = tc.ToolChanges([99], hold_s=5.0)
    with pytest.raises(tc.ToolChangeError) as e:
        _feed(ch, [_st(True, 9, 99, number=1), _st(True, 9, 99, number=1, interp=1)])
    assert e.value.cause == "contradiction"
    c = FrameClient([(0.0, _st(True, 1, 1))])
    with pytest.raises(tc.ToolChangeError) as e:
        tc.serve(c, tc.ToolChanges([1], hold_s=5.0), lambda t, st: False, 0.2, cursor=0)
    assert e.value.cause == "unobserved"
    c.error = "closed"
    with pytest.raises(tc.ToolChangeError) as e:
        tc.serve(c, tc.ToolChanges([1]), lambda t, st: False, 0.2, cursor=0)
    assert e.value.cause == "unobserved"

    class Refusing(FrameClient):
        def request(self, cmd, **kw):
            from test_support.live_session import Refused
            raise Refused("confirm_tool_change refused: Tool change request changed — confirm again")
    with pytest.raises(tc.ToolChangeError) as e:
        tc.serve(Refusing([(0.0, _st(True, 1, 1))]), tc.ToolChanges([1]), lambda t, st: False, 0.2, cursor=0)
    assert e.value.cause == "refused"


@pytest.mark.parametrize("arrive, status", [
    ([(0.03, _st(True, 9, 99, number=1, interp=4))], "incomplete"),           # one frame, then none: unobserved
    ([(0.03, _st(True, 9, 99, number=1, interp=4)), (0.06, _st(True, 9, 99, number=1, interp=1))], "FAIL"),
])
def test_the_hold_step_tells_a_gap_from_a_contradiction(monkeypatch, arrive, status):
    """Codex R293 FI-I24 at the whole m6_hold_case: the run still ends (the
    instance goes down), but only an observed violation is a FAIL."""
    monkeypatch.setattr(nr, "M6_DEADLINE", 0.3)
    c = FrameClient([(0.0, {**_IDLE, "tool_number": 1})], on={"tool_change": arrive})
    with pytest.raises(nr.StepFailed) as e:
        nr.m6_hold_case()[1]({"client": c})
    assert e.value.rows[0]["case"] == "m6-hold" and e.value.rows[0]["status"] == status, e.value.rows
    assert not any(cmd == "confirm_tool_change" for cmd, _ in c.sent)


def test_the_m600_step_predicts_the_counter_from_the_length_the_first_measurement_left(monkeypatch):
    """Codex R293 FI-I27 at the whole step: the first measurement leaves
    49.9985 (the sim's physical length from then on), the counter run gives
    48.9970 — PASS against its own base; L0 is what the reset restores."""
    lock = lambda t, en, idle=False, vel=0.0: (t, {"feed_override_enabled": en, "interp_state": 1 if idle else 2,  # noqa: E731
                                                    "current_vel": vel, "tool_change_seq": None,
                                                    "tool_change_requested": False})

    class Client:
        def __init__(self):
            self.status = {"tool_number": 99, "tool_offset": [0, 0, 50], "tool_table_z": 50.0}
            self.vars = {n: 0 for n in nr.TOOLSETTER_VARS} | {3102: -180}
            self.table = 50.0

        def request(self, cmd, **kw):
            if cmd == "get_tool_table":
                return {"tools": [{"T": 1, "Z": self.table}]}
            if cmd == "get_probe_vars":
                return {"vars": {str(k): self.vars[k] for k in kw["vars"]}}
            if cmd == "save_tool":
                self.table = kw["z_offset"]
                return {"ok": True}
            if cmd == "set_probe_vars":
                self.vars.update({int(k): v for k, v in kw["vars"].items()})
                return {"ok": True}
            raise AssertionError((cmd, kw))
    c, frames, measured = Client(), [], iter([49.9985, 48.9970])

    def routine(client, text, vars=None, **kw):
        past = time.monotonic() - 10
        if text == "T0 M600":
            client.status.update(tool_number=0, tool_offset=[0, 0, 0])
            return {"t0": 0, "t_done": past, "served": [{"tool": 0, "seq": 1}], "errors": []}
        length = next(measured)
        client.table = length                       # G10 L1: the table — the sim's physical length
        client.status.update(tool_number=1, tool_table_z=length, tool_offset=[0, 0, length])
        if not frames:
            frames.extend([lock(0.03, True), lock(0.2, False, vel=1.0), lock(1.033, True, idle=True)])
        return {"t0": 0, "t_done": past, "served": [{"tool": 1, "seq": 2}], "errors": []}

    def short(client, text):
        client.status["tool_offset"] = [0, 0, client.table]
    monkeypatch.setattr(nr, "_routine", routine)
    monkeypatch.setattr(nr, "_short", short)
    monkeypatch.setattr(nr, "_to", lambda client, x, y, z: None)
    monkeypatch.setattr(nr, "_vars", lambda client, nums: {n: client.vars[n] for n in nums})
    rows = nr.m600_cases()[1]({"client": c, "frames": frames, "plate": {"x": 10, "y": 10, "z": -180}})
    by = {r["case"]: r for r in rows}
    assert by["m600-t1"]["status"] == "PASS", by["m600-t1"]
    assert by["m600-t1.counter-3102"]["status"] == "PASS" and by["m600-t1.counter-3102"]["base"] == 49.9985, rows
    assert c.table == 50.0 and c.status["tool_offset"][2] == 50.0, "L0 restored and applied"


# ── R294: the window needs known values; ends need their proof; per axis; errors reach the rows ──
def test_frames_without_a_lock_value_do_not_cover_the_window():
    """Codex R294 FI-I26: the cadence holds, but no frame after the
    completion says whether the override is locked or free: incomplete."""
    window = [(1.033 + 0.2 * k, None) for k in range(12)]
    frames = _lock([(0.03, True, 0.0), (0.2, False), (1.0, False)] + window, done_at=1.033)
    r = nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)
    assert r["status"] == "incomplete", r


def test_a_missed_witness_of_l_is_incomplete_and_an_earlier_line_a_contradiction():
    """Codex R294 FI-I29: both frames of line 7 missed, the first program
    motion received is line 8 — no witness, no proof of a wrong start."""
    hist, frames = _rfl_run()
    del frames[5:7]
    r = _line(hist, frames)
    assert r["status"] == "incomplete" and "line 8" in r["detail"], r


def test_line_ls_end_comes_only_from_the_line_that_holds_its_axes():
    """Codex R294 FI-I29: line 8's frame missed — line 9 already moves Z: its
    position proves nothing about line 7's end."""
    hist, frames = _rfl_run()
    del frames[7]
    r = _line(hist, frames)
    assert r["status"] == "incomplete", r


def test_positions_are_judged_per_axis():
    """Codex R294 FI-I30: an axis line 7 holds, never read, is no PASS; a
    known wrong axis beside an unread one is a FAIL."""
    hist, frames = _rfl_run()
    for i in (5, 6):
        t, st = frames[i]
        frames[i] = (t, {**st, "joint_pos": [st["joint_pos"][0], None, st["joint_pos"][2]]})
    assert _line(hist, frames)["status"] == "incomplete"
    hist, frames = _rfl_run()
    frames[7] = _rfl_frame(25.3, 8, (199.0, 101, None))
    assert _line(hist, frames)["status"] == "FAIL"
    hist, frames = _rfl_run()
    frames[-1] = _rfl_frame(28.0, 11, (200, 150, None), vel=0.0, interp=1)
    assert _line(hist, frames)["status"] == "FAIL"


def test_the_entry_is_judged_where_the_machine_stood_not_at_the_phases_last_frame():
    """Codex R294 FI-I29: the last positioning frame still moves at
    99.8/99.8, the next one stands at 100/100 — no contradiction."""
    hist, frames = _rfl_run()
    frames[4] = _rfl_frame(22.9, 0, (99.8, 99.8, 0.0), mode=3, vel=20.0)
    frames.insert(5, _rfl_frame(23.0, 0, (100, 100, 0.0), mode=3, vel=0.0))
    r = nc.eval_rfl_start_point("rfl-start-point", hist, frames, entry_xy=(100.0, 100.0))
    assert r["status"] == "incomplete", r
    frames[5] = _rfl_frame(23.0, 0, (99.5, 100, 0.0), mode=3, vel=0.0)     # standing beside the entry
    assert nc.eval_rfl_start_point("x", hist, frames, entry_xy=(100.0, 100.0))["status"] == "FAIL"


def test_an_error_of_the_attempt_fails_the_line():
    hist, frames = _rfl_run()
    r = nc.eval_rfl_line("rfl-line", hist, frames, line=L, tool=1, l0=L0, spindle_speed=1000.0,
                         end_point=(200.0, None, nr.RFL_SAFE_Z), final=(200.0, 200.0, nr.RFL_Z_END + L0),
                         line_holds={1: 100.0, 2: nr.RFL_SAFE_Z}, errors=[(11, "Probe tripped during non-probe move")])
    assert r["status"] == "FAIL" and "reported" in r["detail"], r


# the 3-axis copy's toolsetter values (examples/sim_config/xyz3/sim.var): a set-up section
_TS_SHIPPED = {n: 0 for n in nr.TOOLSETTER_VARS} | {3004: 2000, 3006: 500, 3007: 180, 3009: 3, 3010: 180,
                                                     3102: -180, 3106: 1, 3107: 5}


class RflClient(FrameClient):
    """The whole rfl_cases step against a scripted gateway: the run's frames,
    phases and errors arrive with the auto_run (times relative to it)."""

    def __init__(self, run_frames, history, errors=(), refuse=None, after_confirm=()):
        super().__init__([(0.0, {**_IDLE, "tool_number": 99, "task_mode": 3})])
        self.rfl_history, self.preview_origin = [], None
        self.table, self.vars = 50.0, dict(_TS_SHIPPED)
        self.run_frames, self.history, self.run_errors = run_frames, history, list(errors)
        self.refuse, self.after_confirm = refuse or {}, list(after_confirm)

    def request(self, cmd, **kw):
        import hashlib
        self.sent.append((cmd, kw))
        t = self.frames[-1][0]
        if cmd in self.refuse:
            raise self.refuse[cmd]
        if cmd == "confirm_tool_change":
            self.frames += [(t + ft, {"tool_change_requested": False, "tool_change_seq": None, **st})
                            for ft, st in self.after_confirm]
            return {"ok": True}
        if cmd == "get_tool_table":
            return {"tools": [{"T": 1, "Z": self.table}]}
        if cmd == "save_settings":
            return {"ok": True}
        if cmd == "mdi":
            self.frames += [(t + 1.0, {**_IDLE, "task_mode": 3}), (t + 2.0, {**_IDLE, "task_mode": 3})]
            if kw["text"].startswith("(DEBUG,"):
                # the interpreter's answer to a tagged read: its line in the error channel
                import re
                tag = kw["text"][len("(DEBUG,"):].split()[0]
                vals = " ".join(f"P{n}={self.vars[int(n)]:.6f}" for n in re.findall(r"#(\d+)", kw["text"]))
                self.errors.append((t + 1.0, 13, f"{tag} {vals}"))
            return {"ok": True}
        if cmd == "load_file":
            self.preview_origin = {"file": kw["path"], "version": 3,
                                   "source": hashlib.sha256(nr.RFL_PROGRAM.encode()).hexdigest()}
            return {"ok": True}
        if cmd == "auto_run":
            self.frames += [(t + ft, {"tool_change_requested": False, "tool_change_seq": None, **st})
                            for ft, st in self.run_frames]
            self.rfl_history += [(t + ht, p) for ht, p in self.history]
            self.errors += [(t + et, k, x) for et, k, x in self.run_errors]
            return {"ok": True, "rfl": "started"}
        raise AssertionError((cmd, kw))


def _rfl_step(tmp_path, client):
    (tmp_path / nr.NC_FILES).mkdir()
    # the run tree: this checkout (the routine's texts give its motion lines — 2c-b)
    ctx = {"client": client, "frames": client.frames, "config": tmp_path, "report": {},
           "tree": Path(__file__).resolve().parent.parent}
    return ctx, nr.rfl_cases()[1]


def test_the_whole_run_from_line_step_gives_its_four_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    hist, frames = _rfl_run()
    c = RflClient(frames, hist)
    ctx, step = _rfl_step(tmp_path, c)
    by = {r["case"]: r["status"] for r in step(ctx)}
    assert by == {"rfl-line": "PASS", "rfl-line.counter-line+1": "PASS", "rfl-no-earlier-line": "PASS",
                  "rfl-start-point": "incomplete"}, by
    run = next(kw for cmd, kw in c.sent if cmd == "auto_run")
    assert (run["line"], run["pre_tool"], run["entry_wcs"], run["entry_units"]) == (7, 1, "G54", "G21")
    # P2: the dialog's values must be the server's section — saved before the start, the same numbers
    cmds = [cmd for cmd, _ in c.sent]
    saved = next(kw for cmd, kw in c.sent if cmd == "save_settings")
    assert cmds.index("save_settings") < cmds.index("auto_run") and saved["section"] == "toolsetter"
    assert saved["data"]["touchZ"] == run["probe_vars"]["3102"] == -180 and saved["data"]["slowFeed"] == 20.0


def test_run_from_line_refuses_a_copy_whose_toolsetter_is_not_set_up(tmp_path, monkeypatch):
    """P2: run from line with a pre-measurement needs the server's section —
    values the gateway's rule calls invalid end the step before anything starts."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    hist, frames = _rfl_run()
    c = RflClient(frames, hist)
    c.vars = {n: 0 for n in nr.TOOLSETTER_VARS} | {3102: -180}
    ctx, step = _rfl_step(tmp_path, c)
    with pytest.raises(nr.Refused, match="would not be set up"):
        step(ctx)
    assert [cmd for cmd, _ in c.sent if cmd in ("save_settings", "auto_run")] == []


def test_a_program_error_reaches_the_line_row(tmp_path, monkeypatch):
    """Codex R294 FI-I31 1: an error of kind 11 while line 9 runs — idle at
    the right coordinates is no clean run."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    hist, frames = _rfl_run()
    c = RflClient(frames, hist, errors=[(27.5, 11, "Unexpected realtime delay")])
    ctx, step = _rfl_step(tmp_path, c)
    try:
        rows = step(ctx)
    except nr.StepFailed as e:
        rows = e.rows
    line = next(r for r in rows if r["case"] == "rfl-line")
    assert line["status"] == "FAIL" and "Unexpected realtime delay" in line["detail"], line
    assert next(r for r in rows if r["case"] == "rfl-line.counter-line+1")["status"] != "PASS"


def test_a_failed_pre_measurement_ends_the_step_at_once_with_its_row(tmp_path, monkeypatch):
    """Codex R294 FI-I31 2: measure_failed, then idle in MDI — AUTO never
    comes. The step ends now (not after 300 s), keeps the history and says
    FAIL with the phase."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    hist = [(0.0, {"phase": "measuring", "ok": None}),
            (5.0, {"phase": "measure_failed", "ok": False, "error": "verification failed"})]
    frames = [_rfl_frame(2.0, 120, (10, 10, -128), mode=3, level=2, vel=3.0),
              _rfl_frame(5.1, 0, (10, 10, -100), mode=3, vel=0.0, interp=1)]
    c = RflClient(frames, hist)
    ctx, step = _rfl_step(tmp_path, c)
    t0 = time.monotonic()
    with pytest.raises(nr.StepFailed) as e:
        step(ctx)
    assert time.monotonic() - t0 < 5.0
    line = next(r for r in e.value.rows if r["case"] == "rfl-line")
    assert line["status"] == "FAIL" and "measure_failed" in line["detail"], line
    assert [p["phase"] for _, p in ctx["report"]["rfl_history"]] == ["measuring", "measure_failed"]



# ── R295: the entry bound to the positioning's end; one completion; per axis; one attempt outcome ──
def test_a_standstill_followed_by_positioning_motion_is_no_entry_proof():
    """Codex R295 FI-I29 A: standing at 10/10 when the positioning begins,
    then moving at 60/60 and 99.8/99.8, the end not received — the standstill
    before the move proves nothing; nor does a later program frame."""
    hist, frames = _rfl_run()
    frames[3] = _rfl_frame(21.1, 0, (10, 10, 0.0), mode=3, vel=0.0)
    frames[4] = _rfl_frame(21.5, 0, (60, 60, 0.0), mode=3, vel=100.0)
    frames.insert(5, _rfl_frame(22.9, 0, (99.8, 99.8, 0.0), mode=3, vel=20.0))
    assert nc.eval_rfl_start_point("x", hist, frames, entry_xy=(100.0, 100.0))["status"] == "incomplete"
    no_program = [f for f in frames if f[1]["task_mode"] != 2 or f[1]["interp_state"] == 1]
    assert nc.eval_rfl_start_point("x", hist, no_program, entry_xy=(100.0, 100.0))["status"] == "incomplete"
    already = list(_rfl_run()[1])
    already[3] = _rfl_frame(21.5, 0, (100, 100, 0.0), mode=3, vel=0.0)          # no move needed
    assert nc.eval_rfl_start_point("x", hist, already, entry_xy=(100.0, 100.0))["status"] == "incomplete"
    wrong = list(_rfl_run()[1])
    wrong[4] = _rfl_frame(22.9, 0, (100, 99.5, 0.0), mode=3, vel=0.0)            # stood beside it: a proof
    assert nc.eval_rfl_start_point("x", hist, wrong, entry_xy=(100.0, 100.0))["status"] == "FAIL"


def test_the_program_end_is_the_completion_the_step_confirmed():
    """Codex R295 FI-I29 B: idle at 5.2 s still moving at Z −20 (not in
    position), the confirmed rest at the end point later — the end is the
    rest, as the step's own RoutineEnd has it."""
    hist, frames = _rfl_run()
    frames[-1:] = [_rfl_frame(27.9, 11, (200, 200, -20.0), vel=50.0, interp=1),
                   _rfl_frame(28.6, 11, (200, 200, -30.0), vel=0.0, interp=1)]
    assert _line(hist, frames)["status"] == "PASS", _line(hist, frames)
    frames[-1] = _rfl_frame(28.6, 11, (200, 190, -30.0), vel=0.0, interp=1)
    assert _line(hist, frames)["status"] == "FAIL"


def test_a_known_z_violation_is_seen_with_x_unread():
    """Codex R295 FI-I30: Z −81 in the safe-Z stage that began at −80 — X
    unread in that frame changes nothing."""
    hist, frames = _rfl_run()
    frames[1] = _rfl_frame(20.1, 0, (10, 10, -80.0), mode=3, vel=80.0)
    frames.insert(2, (20.5, {**_rfl_frame(20.5, 0, (0, 10, -81.0), mode=3, vel=80.0)[1],
                             "joint_pos": [None, 10, -81.0]}))
    assert nc.eval_rfl_start_point("x", hist, frames, entry_xy=(100.0, 100.0))["status"] == "FAIL"


def _request(tool, seq):
    return _rfl_frame(2.0, 278, (10, 10, 0.0), mode=3, level=2, vel=0.0, tool=99) [1] | \
        {"tool_change_requested": True, "tool_change_seq": seq, "tool_change_tool": tool}


from test_support import live_session as ls  # noqa: E402


@pytest.mark.parametrize("arrange, status, cause", [
    (dict(run_frames=[(2.0, _request(2, 5))]), "FAIL", "contradiction"),                 # T2, T1 declared
    (dict(run_frames=[(2.0, _request(1, 5))],
          refuse={"confirm_tool_change": ls.Refused("confirm_tool_change refused: Tool change request changed")}),
     "FAIL", "refused"),
    (dict(run_frames=[(2.0, _request(1, 5))],                                           # R296 FI-I31 A
          refuse={"confirm_tool_change": ls.NoReply("No gateway reply to confirm_tool_change")}),
     "incomplete", "unobserved"),
    (dict(run_frames=[(2.0, _request(1, 5))],
          refuse={"confirm_tool_change": ls.TransportLost("the connection closed while sending")}),
     "incomplete", "unobserved"),
    (dict(run_frames=[], refuse={"auto_run": ls.Refused("auto_run refused: Program changed — confirm again")}),
     "FAIL", "refused"),
    (dict(run_frames=[], refuse={"auto_run": ls.NoReply("No gateway reply to auto_run")}), "incomplete", "unobserved"),
    (dict(run_frames=[], refuse={"auto_run": ls.TransportLost("the connection closed while sending")}),   # R296 B
     "incomplete", "unobserved"),
])
def test_every_end_of_the_attempt_reaches_the_line_row(tmp_path, monkeypatch, arrange, status, cause):
    """Codex R295 FI-I31: from the auto_run on ONE outcome — a known
    contradiction or refusal is the line's FAIL, a missing answer incomplete;
    the history and the errors are in the report on every path."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    monkeypatch.setattr(nr, "RFL_DEADLINE", 1.0)
    c = RflClient(history=[(0.0, {"phase": "measuring", "ok": None})], **arrange)
    ctx, step = _rfl_step(tmp_path, c)
    with pytest.raises(nr.StepFailed) as e:
        step(ctx)
    line = next(r for r in e.value.rows if r["case"] == "rfl-line")
    assert (line["status"], line.get("cause")) == (status, cause), line
    assert next(r for r in e.value.rows if r["case"] == "rfl-line.counter-line+1")["status"] == "incomplete"
    assert "rfl_history" in ctx["report"] and "rfl_errors" in ctx["report"]
    confirms = [cmd for cmd, _ in c.sent if cmd == "confirm_tool_change"]
    assert len(confirms) <= 1, "a confirmation is never repeated"


def test_an_error_in_the_pre_measurement_ends_the_attempt_at_once(tmp_path, monkeypatch):
    """Codex R295 FI-I31: kind 11 while measuring, then idle — no terminal
    phase received; the known error ends it now, not at the deadline."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    frames = [_rfl_frame(2.0, 120, (10, 10, -128), mode=3, level=2, vel=3.0),
              _rfl_frame(4.1, 0, (10, 10, -100), mode=3, vel=0.0, interp=1)]
    c = RflClient(frames, [(0.0, {"phase": "measuring", "ok": None})],
                  errors=[(4.0, 11, "Tool length offset probe failed!")])
    ctx, step = _rfl_step(tmp_path, c)
    t0 = time.monotonic()
    with pytest.raises(nr.StepFailed) as e:
        step(ctx)
    assert time.monotonic() - t0 < 5.0
    line = next(r for r in e.value.rows if r["case"] == "rfl-line")
    assert line["status"] == "FAIL" and "probe failed" in line["detail"], line



# ── R296: the client's ends typed at its boundary; skipped phases; every negative phase ──
class _Closed:
    def send(self, data):
        import websockets.exceptions
        raise websockets.exceptions.ConnectionClosedError(None, None)


def test_the_real_client_types_its_ends_at_the_boundary():
    """Codex R296 FI-I31 B: the real SimulatorClient.request — a send into a
    closed WebSocket raises the library's ConnectionClosedError (no
    RuntimeError): the client says TransportLost; a refusal reply Refused;
    no reply NoReply. A programming error is none of them."""
    c = ls.SimulatorClient("t", auto_confirm=False)
    c.ws = _Closed()
    with pytest.raises(ls.TransportLost):
        c.request("auto_run", line=7)
    c = ls.SimulatorClient("t", auto_confirm=False)
    c.ws = type("W", (), {"send": lambda self, d: None})()
    c.replies.put({"type": "reply", "cmd": "auto_run", "ok": False, "error": "Program changed"})
    with pytest.raises(ls.Refused, match="auto_run refused: Program changed"):
        c.request("auto_run", line=7)
    c.error = "Simulator WebSocket closed during the gate"
    with pytest.raises(ls.TransportLost):
        c.request("auto_run", line=7)
    assert not issubclass(ls.TransportLost, ls.Refused) and not issubclass(ls.NoReply, ls.Refused)


def test_a_real_close_at_the_auto_run_keeps_the_rows_and_the_history(tmp_path, monkeypatch):
    """Codex R296 FI-I31 B at the whole step: the library's own close at the
    auto_run — the four rows, the history and the errors are in the report."""
    import websockets.exceptions
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    c = RflClient([], [(0.0, {"phase": "measuring", "ok": None})])
    real = c.request

    def request(cmd, **kw):
        if cmd == "auto_run":
            try:
                _Closed().send(None)
            except websockets.exceptions.ConnectionClosed as e:
                raise ls.TransportLost(f"the connection closed while sending: {e!r}") from e
        return real(cmd, **kw)
    c.request = request
    ctx, step = _rfl_step(tmp_path, c)
    with pytest.raises(nr.StepFailed) as e:
        step(ctx)
    line = next(r for r in e.value.rows if r["case"] == "rfl-line")
    assert (line["status"], line["cause"]) == ("incomplete", "unobserved")
    assert len(e.value.rows) == 4 and "rfl_history" in ctx["report"] and "rfl_errors" in ctx["report"]


def test_a_program_frame_at_a_skipped_phase_boundary_is_no_positioning_frame():
    """Codex R296 FI-I29 A: `starting` skipped (the gateway sends its last
    phase) — the frame carrying `running` already shows line 7 at Z −0.5:
    no XY move below the safe height; the program's end point is no entry."""
    hist, frames = _rfl_run()
    hist = [h for h in hist if h[1]["phase"] != "starting"]
    hist[-1] = (23.3, hist[-1][1])                                        # running arrives with line 7's frame
    r = nc.eval_rfl_start_point("x", hist, frames, entry_xy=(100.0, 100.0))
    assert r["status"] == "incomplete", r
    end_first = [f for f in frames if f[0] < 23.3] + [_rfl_frame(23.3, 11, (200, 200, 0.0), vel=0.0, interp=1)]
    r = nc.eval_rfl_start_point("x", hist, end_first, entry_xy=(100.0, 100.0))
    assert r["status"] == "incomplete", r
    # an EARLIER wrong MDI standstill, then the program's frame at the boundary:
    # the earlier standstill proves no wrong END point (Codex R297) — the
    # wrong entry stays a FAIL where the boundary frame IS the positioning's
    # end (test_a_standstill_followed_by_positioning_motion_is_no_entry_proof)
    wrong = list(frames)
    wrong[4] = _rfl_frame(22.9, 0, (100, 99.5, 0.0), mode=3, vel=0.0)
    assert nc.eval_rfl_start_point("x", hist, wrong, entry_xy=(100.0, 100.0))["status"] == "incomplete"
    unassigned = list(frames)
    unassigned[4] = _rfl_frame(22.9, 0, (100, 99.5, 0.0), mode=None, vel=0.0)   # whose frame is it? not known
    assert nc.eval_rfl_start_point("x", hist, unassigned, entry_xy=(100.0, 100.0))["status"] == "incomplete"


def test_every_negative_phase_the_gateway_sends_fails_the_line_at_once(tmp_path, monkeypatch):
    """Codex R296 FI-I31 C: flag_clear_failed (ok: false) after the
    measurement, then idle — no earlier failed phase received."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    hist = [(0.0, {"phase": "measuring", "ok": None}),
            (6.0, {"phase": "flag_clear_failed", "ok": False, "error": "#3116 not cleared"})]
    frames = [_rfl_frame(2.0, 120, (10, 10, -128), mode=3, level=2, vel=3.0),
              _rfl_frame(6.1, 0, (10, 10, -100), mode=3, vel=0.0, interp=1)]
    c = RflClient(frames, hist)
    ctx, step = _rfl_step(tmp_path, c)
    t0 = time.monotonic()
    with pytest.raises(nr.StepFailed) as e:
        step(ctx)
    assert time.monotonic() - t0 < 5.0
    line = next(r for r in e.value.rows if r["case"] == "rfl-line")
    assert line["status"] == "FAIL" and "flag_clear_failed" in line["detail"], line
    # any phase sent with ok: false is a failure, named or not
    other = [(0.0, {"phase": "measuring", "ok": None}), (1.0, {"phase": "something_new", "ok": False, "error": "x"})]
    assert _line(other, _rfl_run()[1])["status"] == "FAIL"


def test_program_frames_before_the_running_message_are_not_the_safe_z_stages():
    """R296 FI-I29 A for the safe-Z stage: no entry move, `starting` skipped,
    the program's first frames (AUTO, line 7 descending to −45) arrive before
    `running` — they are the program's, no lowering in the safe-Z stage."""
    hist = [(0.0, {"phase": "measuring", "ok": None}), (20.0, {"phase": "safe_z", "ok": None}),
            (23.5, {"phase": "running", "ok": True})]
    frames = [_rfl_frame(20.1, 0, (10, 10, -40.0), mode=3, vel=80.0), _rfl_frame(20.9, 0, (10, 10, 0.0), mode=3, vel=0.0),
              _rfl_frame(23.3, L, (11, 10, -0.5)), _rfl_frame(23.4, L, (30, 10, -45.0))]
    r = nc.eval_rfl_start_point("x", hist, frames, entry_xy=(100.0, 100.0))
    assert r["status"] == "incomplete", r



def test_the_boundary_frame_itself_decides_never_an_earlier_standstill():
    """Codex R297 FI-I29 A: standing at 10/10 when the positioning begins,
    its move and its end never received, `starting` skipped — the next frame
    is the program's (AUTO, line 7 at X 101): no proof of the entry, and the
    standstill BEFORE the move is no end point (the whole step as Codex ran it)."""
    hist = [(0.0, {"phase": "measuring", "ok": None}), (20.0, {"phase": "safe_z", "ok": None}),
            (21.0, {"phase": "positioning", "ok": None}), (23.3, {"phase": "running", "ok": True})]
    frames = [_rfl_frame(20.1, 0, (10, 10, -100), mode=3, vel=80.0), _rfl_frame(20.9, 0, (10, 10, 0.0), mode=3, vel=0.0),
              _rfl_frame(21.1, 0, (10, 10, 0.0), mode=3, vel=0.0),
              _rfl_frame(23.3, L, (101, 100, 0.0)), _rfl_frame(24.3, L, (150, 100, 0.0)),
              _rfl_frame(25.3, 8, (200, 101, 0.0)), _rfl_frame(27.3, 9, (200, 200, -15)),
              _rfl_frame(28.0, 11, (200, 200, -30.0), vel=0.0, interp=1)]
    r = nc.eval_rfl_start_point("rfl-start-point", hist, frames, entry_xy=(100.0, 100.0))
    assert r["status"] == "incomplete", r
    assert _line(hist, frames)["status"] == "PASS"
    # the same, the boundary frame the positioning's own end at the entry: no contradiction either
    ended = frames[:3] + [_rfl_frame(23.3, 0, (100, 100, 0.0), mode=3, vel=0.0)] + frames[3:]
    ended[4:] = [(t + 0.1, st) for t, st in ended[4:]]
    assert nc.eval_rfl_start_point("x", hist, ended, entry_xy=(100.0, 100.0))["status"] == "incomplete"


# ── step 2c: the servo measurement (plan Codex R299–R301) ────────────────
from test_support import servo as sv  # noqa: E402
from test_support import servo_cases as sc  # noqa: E402

SHOW_PIN = """Component Pins:
Owner   Type  Dir         Value  Name
    45  float OUT             0  joint.0.pos-fb ==> sim-ts-x
    45  float OUT             0  joint.0.vel-cmd
    45  s32   OUT             0  motion.program-line
"""
SHOW_THREAD = """Realtime Threads:
     Period  FP     Name               (     Time, Max-Time )
    1000000  YES          servo-thread (     2917, 40753937 )
                  1 motion-command-handler
                  2 motion-controller
                  3 sampler.0
"""


def test_the_halcmd_answers_are_read_as_printed():
    assert sv.signal_of(SHOW_PIN, "joint.0.pos-fb") == "sim-ts-x"
    assert sv.signal_of(SHOW_PIN, "joint.0.vel-cmd") is None
    assert sv.thread_of(SHOW_THREAD) == {"period_ns": 1000000, "functions": ["motion-command-handler",
                                                                             "motion-controller", "sampler.0"]}
    # the channels, the mark, then step 3's bits and the controller's period (u32)
    assert sv.parse_line("12 1.5 2.5 -3.0 0.0 0.0 50.0 7 1 5 1 0 1 1000412\n") == \
        (12, (1.5, 2.5, -3.0, 0.0, 0.0, 50.0, 7, 1, 5, 1, 0, 1, 1000412))
    assert sv.parse_line("12 1.5 2.5 -3.0 0.0 0.0 50.0 7 1 5\n") is None      # the 2c width is no sample now
    assert sv.parse_line("overrun\n") is None and sv.parse_line("12 1.5 nan\n") is None


def test_the_one_halcmd_gate_refuses_a_change_while_a_section_is_open():
    """R301: the run owns the sampler — while a section is open only the
    mark and reading commands pass."""
    calls = []
    gate = sv.HalGate(run=lambda argv: calls.append(argv) or "")
    gate("setp", "sampler.0.enable", "1")
    gate.open_section = 3
    gate("sets", sv.MARK_SIGNAL, "7")
    gate("getp", "sampler.0.overruns")
    gate("show", "thread", "servo-thread")
    for change in (("setp", "sampler.0.enable", "0"), ("delf", "sampler.0", "servo-thread"),
                   ("sets", "other-signal", "1"), ("linksp", sv.MARK_SIGNAL, "x")):
        with pytest.raises(sv.GateRefused):
            gate(*change)
    assert [c[1] for c in calls] == ["setp", "sets", "getp", "show"]


def _samples(rows, t0=0.0, n0=100, dt=0.001, mark=1):
    """rows: (x, y, z, vx, vy, vz) per servo period → (t_recv, n, values) with the mark."""
    return [(t0 + i * dt, n0 + i, (*r, 0, 1, mark)) for i, r in enumerate(rows)]


def _ok(**k):
    base = {"enable_start": True, "enable_end": True, "overruns_start": 0, "overruns_end": 0, "depth_end": 10,
            "depth": 65536, "period_ns": 1000000, "ini_period_ns": 1000000, "reader_overrun": False,
            "reader_alive": True}
    base.update(k)
    return base


def test_a_section_is_its_marks_and_its_integrity():
    stream = _samples([(0, 0, 0, 0, 0, 0)] * 5, mark=3) + _samples([(1, 0, 0, 0, 0, 0)] * 5, n0=105, mark=4)
    s = sv.section(stream, start_mark=3, end_mark=4, integrity=_ok())
    assert s["problems"] == [] and len(s["samples"]) == 5 and s["first_n"] == 100 and s["end_n"] == 105


@pytest.mark.parametrize("name, stream, integrity, problem", [
    ("truncated end, no gap", _samples([(0, 0, 0, 0, 0, 0)] * 5, mark=3), _ok(), "end mark"),
    ("backlog: a later restart unread", _samples([(0, 0, 0, 0, 0, 0)] * 5, mark=3), _ok(reader_alive=False), "end mark"),
    ("a number gap", _samples([(0, 0, 0, 0, 0, 0)] * 2, mark=3) + _samples([(0, 0, 0, 0, 0, 0)] * 2, n0=110, mark=3)
     + _samples([(0, 0, 0, 0, 0, 0)], n0=112, mark=4), _ok(), "gap"),
    ("a non-finite value", _samples([(0, 0, 0, 0, 0, 0), (float("nan"), 0, 0, 0, 0, 0)], mark=3)
     + _samples([(0, 0, 0, 0, 0, 0)], n0=102, mark=4), _ok(), "finite"),
    ("enable false", _samples([(0, 0, 0, 0, 0, 0)], mark=3) + _samples([(0, 0, 0, 0, 0, 0)], n0=101, mark=4),
     _ok(enable_end=False), "enable"),
    ("the effective period", _samples([(0, 0, 0, 0, 0, 0)], mark=3) + _samples([(0, 0, 0, 0, 0, 0)], n0=101, mark=4),
     _ok(period_ns=2000000), "period"),
    ("overruns rose", _samples([(0, 0, 0, 0, 0, 0)], mark=3) + _samples([(0, 0, 0, 0, 0, 0)], n0=101, mark=4),
     _ok(overruns_end=1), "overrun"),
    ("the FIFO at its depth", _samples([(0, 0, 0, 0, 0, 0)], mark=3) + _samples([(0, 0, 0, 0, 0, 0)], n0=101, mark=4),
     _ok(depth_end=65536), "depth"),
    ("the reader said overrun", _samples([(0, 0, 0, 0, 0, 0)], mark=3) + _samples([(0, 0, 0, 0, 0, 0)], n0=101, mark=4),
     _ok(reader_overrun=True), "overrun"),
])
def test_every_flaw_of_a_section_is_named(name, stream, integrity, problem):
    s = sv.section(stream, start_mark=3, end_mark=4, integrity=integrity)
    assert any(problem in p for p in s["problems"]), (name, s["problems"])


def test_a_foreign_mark_never_belongs_to_the_section():
    """The previous attempt's samples (mark 2) are no part of attempt 3/4."""
    stream = _samples([(9, 9, 9, 0, 0, 0)] * 3, mark=2) + _samples([(0, 0, 0, 0, 0, 0)] * 3, n0=103, mark=3) \
        + _samples([(0, 0, 0, 0, 0, 0)], n0=106, mark=4)
    s = sv.section(stream, start_mark=3, end_mark=4, integrity=_ok())
    assert all(v[0] == 0 for _, _, v in s["samples"]) and s["problems"] == []


def _jog_stream(sign=1, axis=0, latency=0.002, creep_s=0.0, restart=False, delay_at=None, delay_s=0.0,
                other=0.0, mark=3, still_ms=100):
    """A jog in servo samples (1 ms): standing at 300 for `still_ms`, 300 ms at
    50 mm/s, the stop at the reply, 66.7 ms of braking at 750 mm/s², then
    standstill (an optional creep at 0.01 mm/s first, an optional restart).
    Receipt = capture + `latency`; `delay_at` puts `delay_s` of late
    invocations before that sample number (no number gap). → (samples, t_reply)"""
    v, a, T = 50.0, (750.0, 750.0, 600.0)[axis], 0.001
    rows, t, p = [], 0.0, 300.0
    def add(p, vel):
        pos = [300.0, 300.0, -50.0]
        pos[axis] = p
        pos[(axis + 1) % 3] += other * abs(p - 300.0) / 15.0     # another axis drifting with the jog
        vels = [0.0, 0.0, 0.0]
        vels[axis] = vel
        rows.append((*pos, *vels))
    for _ in range(still_ms):
        add(p, 0.0)
    for _ in range(300):
        p += sign * v * T
        add(p, sign * v)
    t_stop = (still_ms + 300) * T
    vel = v
    while vel > 0:
        vel = max(0.0, vel - a * T)
        p += sign * vel * T
        add(p, sign * vel)
    for _ in range(int(creep_s / T)):
        p += sign * 0.01 * T
        add(p, sign * 0.01)
    for k in range(200):
        if restart and 33 <= k < 53:
            p += sign * 0.05
            add(p, sign * 50.0)
        else:
            add(p, 0.0)
    out, extra = [], 0.0
    for i, r in enumerate(rows):
        if delay_at is not None and i == delay_at:
            extra += delay_s
        out.append((i * T + extra + latency, 1000 + i, (*r, 0, 1, mark)))
    return out, t_stop + 0.0025          # the reply 2.5 ms after the stop's capture; samples arrive `latency` late


def _jog_servo(samples, t_reply, sign=1, axis=0, problems=()):
    return sc.eval_jog_servo("jog-x+.servo", axis, sign, {"samples": samples, "problems": list(problems)}, t_reply)


@pytest.mark.parametrize("sign, axis", [(1, 0), (-1, 0), (1, 2), (-1, 1)])
def test_a_clean_jog_in_servo_samples_passes(sign, axis):
    s, t_reply = _jog_stream(sign=sign, axis=axis)
    r = _jog_servo(s, t_reply, sign, axis)
    assert r["status"] == "PASS" and r["travel_mm"] >= 5 and r["brake_upper_mm"] <= r["bound_mm"], r


def test_no_motion_is_no_jog_proof():
    s, t_reply = _jog_stream()
    still = [(t, n, (300.0, 300.0, -50.0, 0.0, 0.0, 0.0, 0, 1, 3)) for t, n, _ in s]
    assert _jog_servo(still, t_reply)["status"] == "incomplete"


@pytest.mark.parametrize("sign", [1, -1])
def test_a_creep_past_half_a_second_is_no_timely_standstill(sign):
    """Codex R299: braking, then 0.01 mm/s until 1.0 s — the travel stays
    under the bound, the standstill does not come within 0.5 s."""
    s, t_reply = _jog_stream(sign=sign, creep_s=1.0)
    r = _jog_servo(s, t_reply, sign)
    assert r["status"] == "incomplete" and "0.5" in r["detail"], r


def test_late_servo_invocations_are_no_time_proof():
    """Codex R300: 67 samples to the standstill, 480 ms of late invocations
    among them — the receipt is past reply + 0.5 s: incomplete, whatever 67 × T says."""
    s, t_reply = _jog_stream(delay_at=420, delay_s=0.48)
    assert _jog_servo(s, t_reply)["status"] == "incomplete"


@pytest.mark.parametrize("sign", [1, -1])
def test_motion_after_the_first_standstill_fails_even_with_a_later_rest(sign):
    """Codex R300: standstill, a restart, a new rest — the FIRST confirmed
    standstill is the reference."""
    s, t_reply = _jog_stream(sign=sign, restart=True)
    r = _jog_servo(s, t_reply, sign)
    assert r["status"] == "FAIL" and "after its standstill" in r["detail"], r


def test_a_jog_against_its_sign_or_moving_another_axis_fails():
    s, t_reply = _jog_stream(sign=-1)
    assert _jog_servo(s, t_reply, sign=1)["status"] == "FAIL"
    s, t_reply = _jog_stream(other=0.05)
    assert _jog_servo(s, t_reply)["status"] == "FAIL"


def test_a_late_reading_makes_the_upper_bound_unproven_never_a_failure():
    s, t_reply = _jog_stream(latency=0.06)            # the anchor captured 60 ms before the reply
    r = _jog_servo(s, t_reply)
    assert r["status"] == "incomplete" and r["brake_upper_mm"] > r["bound_mm"], r


def test_a_flawed_section_is_incomplete_but_a_seen_contradiction_stays_one():
    s, t_reply = _jog_stream()
    assert _jog_servo(s, t_reply, problems=["end mark not received"])["status"] == "incomplete"
    s, t_reply = _jog_stream(restart=True)
    assert _jog_servo(s, t_reply, problems=["end mark not received"])["status"] == "FAIL"


def _plateau(speed, n=4000, x0=100.0, gap_at=None):
    rows, x = [], x0
    for i in range(n):
        x += speed * 0.001
        rows.append((x, 300.0, -50.0, speed, 0.0, 0.0))
    s = _samples(rows)
    if gap_at is not None:
        s = s[:gap_at] + [(t, nn + 5, v) for t, nn, v in s[gap_at:]]
    return {"samples": s, "problems": []}


@pytest.mark.parametrize("speed, expected, status", [(100.0, 100.0, "PASS"), (50.0, 50.0, "PASS"),
                                                    (50.0, 100.0, "FAIL"), (106.0, 100.0, "FAIL"), (96.0, 100.0, "PASS")])
def test_the_plateau_median_from_adjacent_servo_samples(speed, expected, status):
    r = sc.eval_plateau("override-plateau-100", _plateau(speed), expected, period_s=0.001)
    assert r["status"] == status, r


def test_the_plateau_needs_its_window_and_holds_its_counter():
    short = _plateau(100.0, n=1600)                                  # reaches 260: in the window, but…
    short["samples"] = [x for x in short["samples"] if x[2][0] < 151]   # …fewer than 20 samples kept
    assert sc.eval_plateau("p", short, 100.0, period_s=0.001)["status"] == "incomplete"
    flawed = _plateau(100.0)
    flawed["problems"] = ["a number gap"]
    assert sc.eval_plateau("p", flawed, 100.0, period_s=0.001)["status"] == "incomplete"
    gapped = _plateau(100.0, gap_at=2000)       # the pair across the gap is never used
    assert sc.eval_plateau("p", gapped, 100.0, period_s=0.001)["status"] == "PASS"
    base = sc.eval_plateau("override-plateau-100", _plateau(100.0), 100.0, period_s=0.001)
    planted = sc.eval_plateau("override-plateau-100", _plateau(100.0), 75.0, period_s=0.001)
    assert nc.counter("override-plateau.counter-75", planted, base)["status"] == "PASS"


def _path(points, steps=50, vel=10.0):
    """Linear servo path through `points` (x, y, z), `steps` samples per leg, a rest at the end."""
    rows = []
    for (a, b) in zip(points, points[1:]):
        for k in range(1, steps + 1):
            f = k / steps
            rows.append((*(a[i] + (b[i] - a[i]) * f for i in range(3)), vel, vel, vel))
    rows += [(*points[-1], 0.0, 0.0, 0.0)] * 20
    return {"samples": _samples([(*points[0], 0.0, 0.0, 0.0)] * 10 + rows), "problems": []}


START, ZERO = (200.0, 200.0, -60.0), (100.0, 100.0, 0.0)


@pytest.mark.parametrize("points, status", [
    ([START, (200, 200, 0), ZERO], "PASS"),                        # Z up first, then X/Y
    ([START, (100, 100, -60), ZERO], "FAIL"),                      # X/Y first
    ([START, (200, 200, 0), (150, 150, -0.02), ZERO], "FAIL"),     # Z dips while X/Y move
    ([START, (200, 200, 0), (100, 100.5, 0)], "FAIL"),             # ends off its target
    ([START, START], "incomplete"),                                # no motion
])
def test_the_retract_path_rises_first_then_moves_and_ends_at_its_target(points, status):
    r = sc.eval_retract_path("goto-zero", _path(points), start=START, target=ZERO)
    assert r["status"] == status, r


def test_the_g30_descent_comes_only_after_x_y_arrived():
    g30 = (0.0, 0.0, -20.0)
    ok = sc.eval_retract_path("goto-g30", _path([START, (200, 200, 0), (0, 0, 0), g30]), start=START, target=g30)
    assert ok["status"] == "PASS", ok
    early = sc.eval_retract_path("goto-g30", _path([START, (200, 200, 0), (50, 50, -10), g30]), start=START, target=g30)
    assert early["status"] == "FAIL", early
    flat = sc.eval_retract_path("goto-g30", _path([START, (200, 200, 0), (0, 0, 0)]), start=START, target=(0, 0, 0))
    assert flat["status"] == "PASS" and "no descent" in flat["detail"], flat


def test_the_xy_first_counter_is_refused_against_a_passing_zero():
    base = sc.eval_retract_path("goto-zero", _path([START, (200, 200, 0), ZERO]), start=START, target=ZERO)
    xy_first = sc.eval_retract_path("goto-zero", _path([START, (100, 100, -60), ZERO]), start=START, target=ZERO)
    assert nc.counter("goto-zero.counter-xy-first", xy_first, base)["status"] == "PASS"


# ── step 2c wiring: the whole steps against a scripted client and a fake measurement ──
class FakeMeasurement:
    """The run's Measurement surface: each end() hands the next prepared section."""

    def __init__(self, sections):
        self.sections, self.begun, self.ended = list(sections), 0, 0

    def begin(self):
        self.begun += 1
        return {"k": self.begun}

    def end(self, attempt):
        self.ended += 1
        return self.sections.pop(0)


class MotionClient(FrameClient):
    """G53 moves land where they say; set_feed_override shows in the status;
    read_g30 answers the copy's zeros."""

    def __init__(self):
        super().__init__([(0.0, {**_IDLE, "joint_pos": [0.0, 0.0, 0.0], "feed_override": 1.0})])
        self.pos, self.fo = [0.0, 0.0, 0.0], 1.0

    def _frames(self, busy=True):
        t = self.frames[-1][0]
        st = {**_IDLE, "joint_pos": list(self.pos), "feed_override": self.fo}
        self.frames += ([(t + 0.1, {**st, "interp_state": 2, "inpos": False})] if busy else []) + \
            [(t + 1.0, st), (t + 2.0, st), (t + 3.0, st)]

    def request(self, cmd, **kw):
        import re
        self.sent.append((cmd, kw))
        if cmd == "mdi":
            if "G53" in kw["text"]:
                for a, v in re.findall(r"([XYZ])(-?[\d.]+)", kw["text"]):
                    self.pos["XYZ".index(a)] = float(v)
            self._frames()
        elif cmd == "go_to_zero":
            self._frames()
        elif cmd == "set_feed_override":
            self.fo = kw["scale"]
            self._frames(busy=False)
        elif cmd == "read_g30":
            return {"ok": True, "confirmed": True, "values": {"X": 0.0, "Y": 0.0, "Z": 0.0}}
        return {"ok": True}


def test_a_servo_section_ends_on_every_path():
    calls = []
    gate = sv.HalGate(run=lambda argv: calls.append(argv) or (
        SHOW_THREAD if argv[1] == "show" else "TRUE" if argv[1] == "getp" and "enable" in argv[2] else "0"))

    class EchoReader:
        def __init__(self):
            self.samples, self.overrun, self.alive, self.recv_ns = [], False, True, {}

        def wait_for_mark(self, mark, deadline_s, since=0):
            self.samples.append((time.monotonic(), len(self.samples), (0.0,) * 8 + (mark,)))
            return len(self.samples) - 1
    m = sv.Measurement(gate, EchoReader(), ini_period_ns=1000000, period_ns=1000000)
    ctx = {"servo": m, "report": {}}
    with pytest.raises(ZeroDivisionError):
        with nr._section(ctx, "jog-x+.servo") as box:
            assert gate.open_section == 1
            1 / 0
    assert gate.open_section is None and "section" in box, "the end mark set, the gate open again"
    assert box["section"]["integrity"]["thread_start"] == box["section"]["integrity"]["thread_end"] == \
        ["motion-command-handler", "motion-controller", "sampler.0"]
    assert ctx["report"]["servo_sections"][0]["case"] == "jog-x+.servo"
    assert [c[1:3] for c in calls if c[1] == "sets"] == [["sets", sv.MARK_SIGNAL], ["sets", sv.MARK_SIGNAL]]


def test_the_plateau_step_gives_its_rows(monkeypatch):
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    c = MotionClient()
    ctx = {"client": c, "servo": FakeMeasurement([_plateau(100.0), _plateau(50.0)]), "servo_period_s": 0.001,
           "report": {}}
    rows = nr.plateau_cases()[1](ctx)
    assert [(r["case"], r["status"]) for r in rows] == [("override-plateau-100", "PASS"), ("override-plateau-50", "PASS"),
                                                        ("override-plateau.counter-75", "PASS")], rows
    overrides = [kw["scale"] for cmd, kw in c.sent if cmd == "set_feed_override"]
    assert overrides == [1.0, 0.5, 1.0], "set before each move, put back after"


def test_the_goto_step_gives_its_rows(monkeypatch):
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    c = MotionClient()
    home = (0.0, 0.0, 0.0)
    sections = [_path([START, (200, 200, 0), ZERO]), _path([START, (200, 200, 0), home]),
                _path([START, (200, 200, 0), home]), _path([START, (100, 100, -60), ZERO])]
    ctx = {"client": c, "servo": FakeMeasurement(sections), "report": {}}
    rows = nr.goto_cases()[1](ctx)
    assert [(r["case"], r["status"]) for r in rows] == [("goto-zero", "PASS"), ("goto-home", "PASS"), ("goto-g30", "PASS"),
                                                        ("goto-zero.counter-xy-first", "PASS")], rows
    assert ctx["report"]["goto"]["targets"]["goto-zero"] == (100.0, 100.0, 0.0)
    assert ("go_to_zero", {}) in c.sent and any(kw.get("text") == "G64 P0.001" for _, kw in c.sent)


def test_the_run_from_line_step_records_its_servo_stream(tmp_path, monkeypatch):
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    hist, frames = _rfl_run()
    c = RflClient(frames, hist)
    ctx, step = _rfl_step(tmp_path, c)
    ctx["run"] = tmp_path
    ctx["servo"] = FakeMeasurement([{"samples": _samples([(1.0, 2.0, 3.0, 0, 0, 0)] * 3), "problems": []}])
    by = {r["case"]: r["status"] for r in step(ctx)}
    assert by["rfl-start-point"] == "incomplete" and ctx["servo"].ended == 1
    lines = (tmp_path / "servo-rfl.jsonl").read_text().splitlines()
    rec = next(a for a in ctx["report"]["servo_sections"] if a["case"] == "rfl")
    assert len(lines) == 3 and rec["samples"] == 3 and rec["file"] == "servo-rfl.jsonl"


def test_a_clean_but_short_jog_is_no_proof_of_its_minimum_travel():
    """FI299-02: under 5 mm by the anchor, everything else in order: incomplete."""
    s, t_reply = _jog_stream()
    short = [(t, n, (300.0 + (v[0] - 300.0) * 0.2, *v[1:])) for t, n, v in s]     # 3 mm instead of 15
    r = _jog_servo(short, t_reply)
    assert r["status"] == "incomplete" and "5.0 not shown" in r["detail"], r


def test_only_adjacent_samples_make_a_speed():
    """Every other sample missing (numbers in steps of two): no adjacent pair
    — never a speed from two samples apart (it would read double)."""
    sec = _plateau(100.0)
    sec["samples"] = [(t, 2 * n, v) for t, n, v in sec["samples"]]
    assert sc.eval_plateau("p", sec, 200.0, period_s=0.001)["status"] == "incomplete"


def test_every_jog_case_has_its_servo_case():
    assert set(nr.JOG_SERVO_CASES) == {c for c, _, _ in nr.JOG_CASES}


# ── R302: the retract to its end and per axis; integrity; the audit; a failing end; informational rows ──
def _xyz_path(points, steps=50, nan_at=None):
    sec = _path(points, steps)
    if nan_at is not None:
        i, axis = nan_at
        t, n, v = sec["samples"][i]
        v = list(v)
        v[axis] = float("nan")
        sec["samples"][i] = (t, n, tuple(v))
    return sec


@pytest.mark.parametrize("name, points, target", [
    ("zero_descends_after_xy", [START, (200, 200, 0), ZERO, (100, 100, -5), ZERO], ZERO),
    ("xy_leaves_target_below_top", [START, (200, 200, 0), ZERO, (100, 100, -3), (110, 100, -3), (100, 100, -3), ZERO],
     ZERO),
    ("g30_xy_leaves_during_descent", [START, (200, 200, 0), (0, 0, 0), (0, 0, -10), (10, 0, -10), (0, 0, -20)],
     (0.0, 0.0, -20.0)),
])
def test_the_retract_is_checked_to_the_end_of_its_section(name, points, target):
    """Codex R302 FI-I32 A: the first XY arrival does not end the check — an
    up target keeps Z up, a G30 descent keeps X/Y on the target."""
    r = sc.eval_retract_path("goto-x", _xyz_path(points), start=START, target=target)
    assert r["status"] == "FAIL", (name, r)


def test_a_known_wrong_x_is_seen_with_y_unread():
    """Codex R302 FI-I32 B: X 1 mm off its start while Z is still low, Y NaN."""
    sec = _path([START, (200, 200, 0), ZERO])
    rows = sec["samples"]
    t, n, v = rows[12]                                   # Z still near −60: the rise has just begun
    rows[12] = (t, n, (201.0, float("nan"), v[2], *v[3:]))
    r = sc.eval_retract_path("goto-zero", sec, start=START, target=ZERO)
    assert r["status"] == "FAIL" and "with Z at" in r["detail"], r


def test_a_dead_reader_or_a_foreign_mark_inside_is_a_flaw():
    """Codex R302 FI-I33: the reader ended though the end mark came; a
    foreign mark BETWEEN the marks breaks the coverage (before them it is
    another attempt's)."""
    stream = _samples([(0, 0, 0, 0, 0, 0)] * 5, mark=3) + _samples([(0, 0, 0, 0, 0, 0)], n0=105, mark=4)
    assert any("reader" in p for p in sv.section(stream, 3, 4, _ok(reader_alive=False))["problems"])
    inside = _samples([(0, 0, 0, 0, 0, 0)] * 2, mark=3) + _samples([(0, 0, 0, 0, 0, 0)], n0=102, mark=99) \
        + _samples([(0, 0, 0, 0, 0, 0)] * 2, n0=103, mark=3) + _samples([(0, 0, 0, 0, 0, 0)], n0=105, mark=4)
    assert any("foreign" in p for p in sv.section(inside, 3, 4, _ok())["problems"])
    s, t_reply = _jog_stream(restart=True)
    s = [(t, n, (*v[:8], 99 if 1600 <= n < 1610 else v[8])) for t, n, v in s] + \
        [(s[-1][0] + 0.001, s[-1][1] + 1, (*s[-1][2][:8], 4))]
    sec = sv.section(s, 3, 4, _ok())
    assert sc.eval_jog_servo("jog-x+.servo", 0, 1, sec, t_reply)["status"] != "PASS"


class AuditMeasurement(FakeMeasurement):
    """end() returns sections carrying their audit as the real Measurement does."""

    def end(self, attempt):
        sec = super().end(attempt)
        return {**sec, "attempt": attempt["k"], "start_mark": 2 * attempt["k"] + 1, "end_mark": 2 * attempt["k"] + 2,
                "first_n": sec["samples"][0][1], "end_n": sec["samples"][-1][1] + 1,
                "integrity": _ok(thread_start=["sampler.0"], thread_end=["sampler.0"]), "hal": [["sets", "natv-mark", "3"]]}


def test_every_section_is_in_the_report_with_its_audit_and_its_samples(tmp_path, monkeypatch):
    """Codex R302 FI-I34: per attempt — the case, its marks, its number
    bounds, its integrity, the HAL commands — in the report, the raw samples
    in a file beside it."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    c = MotionClient()
    ctx = {"client": c, "servo": AuditMeasurement([_plateau(100.0), _plateau(50.0)]), "servo_period_s": 0.001,
           "report": {}, "run": tmp_path}
    nr.plateau_cases()[1](ctx)
    audit = ctx["report"]["servo_sections"]
    assert [a["case"] for a in audit] == ["override-plateau-100", "override-plateau-50"]
    a = audit[0]
    assert {"attempt", "start_mark", "end_mark", "first_n", "end_n", "integrity", "problems", "hal", "file"} <= set(a)
    assert a["integrity"]["thread_start"] == ["sampler.0"]
    assert len((tmp_path / a["file"]).read_text().splitlines()) == len(_plateau(100.0)["samples"])


def test_setup_reads_the_wiring_back_and_each_section_reads_the_thread_at_both_ends():
    shown = {}

    def run(argv):
        verb = argv[1]
        if verb == "show" and argv[2] == "pin":
            pin = argv[3]
            if pin.startswith("sampler.0.pin."):
                i = int(pin.rsplit(".", 1)[1])
                sig = shown.get(i, "")
                return f"    9  float IN  0  {pin} <== {sig}\n" if sig else f"    9  float IN  0  {pin}\n"
            return f"    4  float OUT  0  {pin}\n"
        if verb == "net":
            shown[int(argv[4].rsplit(".", 1)[1])] = argv[2]
        if verb == "linksp":
            shown[int(argv[3].rsplit(".", 1)[1])] = argv[2]
        if verb == "show" and argv[2] == "thread":
            return SHOW_THREAD
        return ""
    gate = sv.HalGate(run=run)
    rep = sv.setup(gate)
    assert [w["read_back"] for w in rep["wiring"]] == [w["signal"] for w in rep["wiring"]]
    assert rep["mark_read_back"] == sv.MARK_SIGNAL


def test_a_failing_section_end_keeps_the_run_from_line_rows(tmp_path, monkeypatch):
    """Codex R302 FI-I31: the auto_run refused, then the section's end fails
    reading the overruns — the rows, the history and the errors stay, the
    gate closes, the step still ends the run."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)

    class BrokenEnd(FakeMeasurement):
        def end(self, attempt):
            raise RuntimeError("halcmd getp sampler.0.overruns: no such pin")
    c = RflClient([], [(0.0, {"phase": "measuring", "ok": None})],
                  refuse={"auto_run": ls.Refused("auto_run refused: Program changed — confirm again")})
    ctx, step = _rfl_step(tmp_path, c)
    ctx["run"], ctx["servo"] = tmp_path, BrokenEnd([])
    with pytest.raises(nr.StepFailed) as e:
        step(ctx)
    line = next(r for r in e.value.rows if r["case"] == "rfl-line")
    assert line["status"] == "FAIL" and "servo" in str(e.value) and "rfl_history" in ctx["report"]


def test_the_status_jog_rows_inform_and_never_hold_back_the_servo_proof():
    """Codex R302 FI-I35: the servo row decides; the status row's missing
    proof does not; a known contradiction there still does."""
    restore = {"outcome": "complete", "isolation": [], "cleanup": []}
    servo = {"case": "jog-x+.servo", "status": "PASS"}
    info_open = {"case": "jog-x+", "status": "incomplete", "informational": True}
    info_fail = {"case": "jog-x+", "status": "FAIL", "informational": True}
    assert nr.verdict({"rows": [servo, info_open], "restore": restore}) == "PASS"
    assert nr.verdict({"rows": [servo, info_fail], "restore": restore}) == "FAIL"
    assert nr.verdict({"rows": [info_open], "restore": restore}) == "incomplete", "information alone proves nothing"


def test_a_failing_read_at_the_end_still_closes_the_section_in_the_gate():
    """R302 FI-I31: Measurement.end raises after reading fails — the gate is open again."""
    state = {"fail": False}

    def run(argv):
        if argv[1] == "show":
            return SHOW_THREAD
        if argv[1] == "getp" and argv[2] == "sampler.0.overruns" and state["fail"]:
            raise RuntimeError("halcmd getp sampler.0.overruns: no such pin")
        return "TRUE" if argv[1] == "getp" and "enable" in argv[2] else "0"
    gate = sv.HalGate(run=run)

    class EchoReader:
        samples, overrun, alive, recv_ns = [], False, True, {}

        def wait_for_mark(self, mark, deadline_s, since=0):
            self.samples.append((time.monotonic(), len(self.samples), (0.0,) * 8 + (mark,)))
            return len(self.samples) - 1
    m = sv.Measurement(gate, EchoReader(), ini_period_ns=1000000, period_ns=1000000)
    attempt = m.begin()
    state["fail"] = True
    sec = m.end(attempt)
    assert "overruns" in sec["end_error"] and gate.open_section is None


def test_a_channel_that_reads_back_on_another_signal_stops_the_setup():
    def run(argv):
        if argv[1] == "show" and argv[2] == "pin":
            pin = argv[3]
            if pin == "sampler.0.pin.3":
                return f"    9  float IN  0  {pin} <== someone-else\n"
            if pin.startswith("sampler.0.pin."):
                i = int(pin.rsplit(".", 1)[1])
                sig = sv.MARK_SIGNAL if i == sv.MARK_INDEX else f"natv-ch{i}"
                return f"    9  float IN  0  {pin} <== {sig}\n"
            return f"    4  float OUT  0  {pin}\n"
        return SHOW_THREAD if argv[1] == "show" else ""
    with pytest.raises(RuntimeError, match="reads back"):
        sv.setup(sv.HalGate(run=run))


# ── R303: unknown transitions, the partial audit, the read periods, the rows before the abort ──
def _nan(sec, i, axis):
    t, n, v = sec["samples"][i]
    v = list(v)
    v[axis] = float("nan")
    sec["samples"][i] = (t, n, tuple(v))
    return sec


def test_an_unknown_phase_transition_is_unproven_never_a_failure():
    """Codex R303 FI-I32: a valid → Zero with Z unread where it reaches the
    top and at the first X/Y step; a valid → G30 with X unread at the arrival
    and the first descent — incomplete, not FAIL."""
    zero = _path([START, (200, 200, 0), ZERO])
    rows = zero["samples"]
    top = next(i for i, (_, _, v) in enumerate(rows) if v[2] >= -0.010)
    for i in (top, top + 1):
        _nan(zero, i, 2)
    r = sc.eval_retract_path("goto-zero", zero, start=START, target=ZERO)
    assert r["status"] == "incomplete", r
    g30_target = (0.0, 0.0, -20.0)
    g30 = _path([START, (200, 200, 0), (0, 0, 0), g30_target])
    arrive = next(i for i, (_, _, v) in enumerate(g30["samples"]) if abs(v[0]) <= 0.01 and abs(v[1]) <= 0.01)
    for i in (arrive, arrive + 1):
        _nan(g30, i, 0)
    r = sc.eval_retract_path("goto-g30", g30, start=START, target=g30_target)
    assert r["status"] == "incomplete", r


class _HalSeq:
    """A HAL whose `show thread` answers a scripted period per call and whose
    `getp sampler.0.overruns` may fail from a given call on."""

    def __init__(self, periods=(1000000,), fail_overruns_from=None):
        self.periods, self.calls, self.overruns_calls = list(periods), 0, 0
        self.fail_from = fail_overruns_from

    def __call__(self, argv):
        if argv[1] == "show":
            p = self.periods[min(self.calls, len(self.periods) - 1)]
            self.calls += 1
            return SHOW_THREAD.replace("1000000", str(p))
        if argv[1] == "getp" and argv[2] == "sampler.0.overruns":
            self.overruns_calls += 1
            if self.fail_from is not None and self.overruns_calls >= self.fail_from:
                raise RuntimeError("halcmd getp sampler.0.overruns: no such pin")
        return "TRUE" if argv[1] == "getp" and "enable" in argv[2] else "0"


class _MarkReader:
    def __init__(self):
        self.samples, self.overrun, self.alive, self.recv_ns = [], False, True, {}

    def wait_for_mark(self, mark, deadline_s, since=0):
        self.samples.append((time.monotonic(), len(self.samples), (0.0,) * 8 + (mark,)))
        return len(self.samples) - 1


@pytest.mark.parametrize("periods", [(1000000, 2000000), (2000000, 2000000)])
def test_the_periods_read_at_the_section_ends_are_checked(periods):
    """Codex R303 FI-I34 B: the effective period read at either end, not the setup's."""
    m = sv.Measurement(sv.HalGate(run=_HalSeq(periods)), _MarkReader(), ini_period_ns=1000000, period_ns=1000000)
    sec = m.end(m.begin())
    assert sec["integrity"]["period_ns_start"] == periods[0] and sec["integrity"]["period_ns_end"] == periods[1]
    assert any("period" in p for p in sec["problems"]), sec["problems"]


def test_a_failing_end_read_still_gives_its_partial_section_and_audit(tmp_path):
    """Codex R303 FI-I34 A: the overruns unreadable at the end — the section
    with what was read, the failure named, the audit and the samples kept,
    the gate open again, the box's error set (the run ends after the rows)."""
    gate = sv.HalGate(run=_HalSeq(fail_overruns_from=2))
    m = sv.Measurement(gate, _MarkReader(), ini_period_ns=1000000, period_ns=1000000)
    ctx = {"servo": m, "report": {}, "run": tmp_path}
    with nr._section(ctx, "goto-zero") as box:
        pass
    assert gate.open_section is None and "error" in box and "section" in box
    rec = ctx["report"]["servo_sections"][0]
    assert rec["case"] == "goto-zero" and rec["end_error"] and rec["integrity"]["overruns_end"] is None
    assert any("not read" in p for p in rec["problems"]) and (tmp_path / rec["file"]).is_file()


def test_a_samples_file_that_cannot_be_written_keeps_the_rows(tmp_path, monkeypatch):
    """Codex R303 FI-I31 A: the run-from-line samples cannot be written (a
    directory stands where the file goes) — the auto_run refusal stays the
    line's FAIL, the write error is named, the run ends."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    c = RflClient([], [(0.0, {"phase": "measuring", "ok": None})],
                  refuse={"auto_run": ls.Refused("auto_run refused: Program changed — confirm again")})
    ctx, step = _rfl_step(tmp_path, c)
    ctx["run"] = tmp_path
    (tmp_path / "servo-rfl.jsonl").mkdir()
    ctx["servo"] = FakeMeasurement([{"samples": _samples([(1.0, 2.0, 3.0, 0, 0, 0)] * 3), "problems": []}])
    with pytest.raises(nr.StepFailed) as e:
        step(ctx)
    line = next(r for r in e.value.rows if r["case"] == "rfl-line")
    assert line["status"] == "FAIL" and "not written" in str(e.value)
    assert ctx["report"]["servo_sections"][0]["file_error"]


def test_the_current_case_is_judged_before_a_failing_end_ends_the_step(monkeypatch):
    """Codex R303 FI-I31 B: → Zero's own section shows X/Y first, then the
    end's read fails — goto-zero's FAIL is in the rows of the abort."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    xy_first = {**_path([START, (100, 100, -60), ZERO]), "end_error": "halcmd getp sampler.0.overruns: no such pin"}
    ctx = {"client": MotionClient(), "servo": FakeMeasurement([xy_first]), "report": {}}
    with pytest.raises(nr.StepFailed) as e:
        nr.goto_cases()[1](ctx)
    assert [(r["case"], r["status"]) for r in e.value.rows] == [("goto-zero", "FAIL")], e.value.rows


@pytest.mark.parametrize("unread", [0, 1])
def test_a_known_descent_after_the_proven_arrival_fails_with_x_or_y_unread(unread):
    """Codex R304 FI-I32: on the Zero target (proven, every axis read), Z
    sinks to −1 and back with X (or Y) unread meanwhile — still FAIL."""
    sec = _path([START, (200, 200, 0), ZERO, (100, 100, -1), ZERO])
    rows = sec["samples"]
    arrived = next(i for i, (_, _, v) in enumerate(rows) if abs(v[0] - 100) <= 0.01 and abs(v[1] - 100) <= 0.01)
    for i in range(arrived + 1, len(rows)):
        if rows[i][2][2] < -0.010:
            _nan(sec, i, unread)
    r = sc.eval_retract_path("goto-zero", sec, start=START, target=ZERO)
    assert r["status"] == "FAIL" and "up target" in r["detail"], r


class _FreshGatewayClient:
    """A client of a gateway that has not polled yet: every command whose
    gate needs a state is refused until its first status arrives (the
    gateway's "Machine status not read yet — wait", BG-12) — which comes
    after a few reads of the status, as frames arrive after the connect."""
    instances: list = []

    def __init__(self, token, session=None, auto_confirm=False, keep=()):
        self.error, self.frames, self.sent, self._reads = None, [], [], 0
        self._status = {"is_estop": True, "is_enabled": False}
        _FreshGatewayClient.instances.append(self)

    @property
    def status(self):
        self._reads += 1
        return dict(self._status) if self._reads > 3 else {}

    def start(self): pass

    def request(self, cmd, **kw):
        from test_support.live_session import Refused
        if self._reads <= 3:
            raise Refused(f"{cmd} refused: Machine status not read yet — wait")
        self.sent.append(cmd)
        self._status.update({"estop_reset": {"is_estop": False}, "machine_on": {"is_enabled": True}}.get(cmd, {}))
        return {"ok": True}


def test_the_connect_step_waits_for_the_gateways_first_status(tmp_path, monkeypatch):
    """Live run 2026-11-05 (second): the copy's gateway answered /ready, the
    client connected and sent estop_reset at once — refused, "Machine status
    not read yet — wait". The step waits for the first status first."""
    from test_support import live_session
    monkeypatch.setattr(live_session, "SimulatorClient", _FreshGatewayClient)
    ini = tmp_path / "a.ini"
    ini.write_text("[DISPLAY]\nWEBUI_TOKEN = t\n")
    _, step = nr.connect_client()
    assert step({"ini": ini}) == []
    assert _FreshGatewayClient.instances[-1].sent == ["estop_reset", "machine_on"]


class HomingClient(MotionClient):
    """The 3-axis sim's homing (simulated_home_probe_basic.hal + the profile):
    a switch closes at motor X ≥ 1, Y ≥ 0.5, Z ≥ 2; homing searches up to it
    and latches there at the joint coordinate HOME_OFFSET (X, Y 0, Z 1), then
    goes to HOME 0 — a homed X or Y rests ON its switch. A home with its
    shared switch closed is refused, nothing moves (LinuxCNC's "Cannot home
    while shared home switch is closed", live run 2026-11-05)."""
    SWITCH, HOME_OFFSET = (1.0, 0.5, 2.0), (0.0, 0.0, 1.0)

    def __init__(self, refuse_from=None):
        self.homed, self.offset, self.refusals, self.refuse_from, self.homes = [False] * 3, [0.0] * 3, [], refuse_from, 0
        super().__init__()
        self._frames(busy=False)

    def closed(self, j):
        return self.pos[j] + self.offset[j] >= self.SWITCH[j]

    def _frames(self, busy=True):
        t = self.frames[-1][0]
        st = {**_IDLE, "joint_pos": list(self.pos), "feed_override": self.fo, "homed_joints": list(self.homed)}
        self.frames += ([(t + 0.1, {**st, "interp_state": 2, "inpos": False})] if busy else []) + \
            [(t + 1.0, st), (t + 2.0, st)]

    def request(self, cmd, **kw):
        from test_support.live_session import Refused
        if cmd in ("home", "home_all", "unhome_all"):
            self.sent.append((cmd, kw))
            if cmd == "unhome_all":
                self.homed = [False] * 3
            self.homes += cmd != "unhome_all"
            for j in ([kw["joint"]] if cmd == "home" else range(3) if cmd == "home_all" else ()):
                if self.closed(j) or (self.refuse_from is not None and self.homes >= self.refuse_from):
                    self.refusals.append(j)
                    continue
                self.offset[j] = self.SWITCH[j] + 0.01 - self.HOME_OFFSET[j]   # the latch is HOME_OFFSET
                self.pos[j], self.homed[j] = 0.0, True                          # then to HOME 0
            self._frames(busy=False)
            return {"ok": True}
        if cmd == "mdi" and not all(self.homed):
            raise Refused("mdi refused: Machine not homed")     # the ready gate
        return super().request(cmd, **kw)


def _short_waits(monkeypatch):
    orig = nr._wait
    monkeypatch.setattr(nr, "_wait", lambda c, pred, timeout, what: orig(c, pred, min(timeout, 0.3), what))
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)


def test_each_home_case_starts_where_linuxcnc_can_home(monkeypatch):
    """Live run 2026-11-05 (third): after Home All the sim's X and Y rest on
    their shared home switches; the next case's home was refused, and so was
    the closing Home All for the jogs. Each case starts with every joint
    homed, X and Y moved off their switches, then all unhomed."""
    _short_waits(monkeypatch)
    c = HomingClient()
    _, step = nr.home_cases(3)
    rows = step({"client": c})
    assert [(r["case"], r["status"]) for r in rows] == [(case, "PASS") for case, _ in nr.HOME_CASES], rows
    assert c.homed == [True] * 3 and c.refusals == [], "homed for the jogs, no home refused"


def test_a_home_step_that_cannot_go_on_keeps_its_rows(monkeypatch):
    """A failure after a measured case ends the run with the rows (FI-I31's
    rule): the third run's rows were lost with the final wait's error."""
    _short_waits(monkeypatch)
    c = HomingClient(refuse_from=5)      # three single homes and the Home All case, then every home refused
    _, step = nr.home_cases(3)
    with pytest.raises(nr.StepFailed) as e:
        step({"client": c})
    assert [(r["case"], r["status"]) for r in e.value.rows] == [("home-all", "PASS"), ("home-joint-0", "FAIL")]


# ── the fourth live run (2026-11-05): the rows of a failing step, the stale
#    #5070 after a miss, the M600 return, the start claim after an error ──
def test_a_step_that_raises_keeps_the_rows_it_measured(tmp_path):
    """The m600 step raised at its reset (a refused save_tool) and its four
    measured rows were lost: a step's rows live in ctx["rows"], kept on any
    exception."""
    def step(ctx):
        ctx["rows"].append({"case": "m600-t1", "status": "PASS"})
        raise RuntimeError("save_tool refused: A program or macro is starting or running — wait")
    report = nr.run(FakeHost(), [("m600", step)], tmp_path / "run")
    assert report["rows"] == [{"case": "m600-t1", "status": "PASS"}] and "save_tool" in report["error"]


def _claim_client(refusals, text="A program or macro is starting or running — wait"):
    from test_support.live_session import Refused

    class C:
        asked = 0
        table = None

        def request(self, cmd, **kw):
            self.asked += 1
            if cmd == "get_tool_table":
                return {"tools": [{"T": 1, "Z": self.table}]}
            if self.asked <= refusals:
                raise Refused(f"{cmd} refused: {text}")
            self.table = kw.get("z_offset")
            return {"ok": True}
    return C()


def test_a_write_after_an_errored_routine_waits_for_the_released_start_claim(monkeypatch):
    """Live: a T1 M600 ended in an error, the next save_tool came before the
    gateway released the routine's start claim (~0.3 s after the error) —
    refused "starting or running — wait". The write is asked again while the
    claim is held; any other refusal ends it at once."""
    monkeypatch.setattr(nr, "CLAIM_WAIT_S", 1.0)
    c = _claim_client(2)
    nr._set_tool_length(c, 1, 48.9991)
    assert c.table == 48.9991
    other = _claim_client(1, text="Not armed — press Arm")
    with pytest.raises(RuntimeError, match="Not armed"):
        nr._set_tool_length(other, 1, 48.9991)
    assert other.asked == 1, "another refusal is not asked again"
    monkeypatch.setattr(nr, "CLAIM_WAIT_S", 0.2)
    with pytest.raises(RuntimeError, match="starting or running"):
        nr._set_tool_length(_claim_client(10 ** 6), 1, 48.9991)


def test_the_probe_miss_reads_a_planted_5070(monkeypatch):
    """Live: a G38.2 that ends without contact aborts its routine and leaves
    #5070 as the LAST probe wrote it — 1 from the hit before; the miss was
    judged FAIL on that stale 1. #5070 is planted 0 and read back before the
    miss (rs274: #5070 is writable), so its read after is evidence."""
    from test_support import tool_change as tc
    params, g54, probes = {5070: 0.0, 5063: 0.0}, {"z": 0.0}, []

    class Client:
        frames = []
        status = {"tool_offset": [0, 0, nr.PROBE_L0], "tool_number": nr.PROBE_TOOL}

        def request(self, cmd, **kw):
            if cmd == "get_probe_vars":
                return {"vars": {str(k): 1.0 for k in kw["vars"]}}
            return {"ok": True}

    def short(c, text):
        if text.startswith("#5070="):
            params[5070] = float(text.split("=")[1])
        if text == "G10 L2 P1 Z0":
            g54["z"] = 0.0

    def routine(c, text, vars=None, **kw):
        probes.append(text)
        if len(probes) == 1:                       # the hit: contact, G54 Z = the plate
            params[5070], g54["z"] = 1.0, -180.0
            return {"errors": []}
        return {"errors": [(11, "G38.2 move finished without making contact.")]}   # #5070 untouched
    for name, fn in {"plate_from_hal": lambda t: {"x": 10.0, "y": 10.0, "z": -180.0}, "_hal_texts": lambda ini: "",
                     "_set_tool_length": lambda c, t, l: None, "_short": short, "_routine": routine,
                     "_to": lambda c, x, y, z: None, "_g54_z": lambda st: g54["z"],
                     "_read_params": lambda c, nums, tries=3: {n: params.get(n, 1.0) for n in nums}}.items():
        monkeypatch.setattr(nr, name, fn)
    monkeypatch.setattr(tc, "serve", lambda *a, **k: [])
    monkeypatch.setattr(tc.ToolChanges, "precheck", lambda self, st: None)
    rows = nr.probe_cases()[1]({"client": Client(), "ini": Path("x.ini"), "report": {}, "rows": []})
    by = {r["case"]: r for r in rows}
    assert by["probe-z"]["status"] == "PASS", by["probe-z"]
    assert by["probe-z-miss"]["status"] == "PASS", by["probe-z-miss"]


def test_each_t1_measurement_starts_where_the_unload_left_it_and_its_return_is_judged(monkeypatch):
    """With M600's return at the top (2026-11-05) the T1 measurement starts
    where the unload left the spindle — on G30, the top in the copy — as in
    the operator's own flow; no detour down. The return row reads the call's
    joint position before the send and the end at the completion: at the
    call's X/Y, Z at the top. A T1 ending 20 mm down is a FAIL."""
    order = []

    class Client:
        def __init__(self):
            self.status = {"tool_number": 99, "tool_offset": [0, 0, 50], "tool_table_z": 50.0,
                           "joint_pos": [10.0, 10.0, -60.0]}
            self.vars = {n: 0 for n in nr.TOOLSETTER_VARS} | {3102: -180, 3106: 1}   # the copy's return on
            self.table = 50.0
            self.t1_end_z = 0.0

        def request(self, cmd, **kw):
            if cmd == "get_tool_table":
                return {"tools": [{"T": 1, "Z": self.table}]}
            if cmd in ("save_tool", "set_probe_vars"):
                self.table = kw.get("z_offset", self.table)
                self.vars.update({int(k): v for k, v in kw.get("vars", {}).items()})
                return {"ok": True}
            raise AssertionError((cmd, kw))

    def routine(client, text, vars=None, **kw):
        order.append(text)
        if text == "T0 M600":       # the unload ends on G30 = 0/0/0
            client.status.update(tool_number=0, tool_offset=[0, 0, 0], joint_pos=[0.0, 0.0, 0.0])
        else:
            client.status.update(tool_number=1, tool_offset=[0, 0, client.table],
                                 joint_pos=[0.0, 0.0, client.t1_end_z])
        return {"t0": 0, "t_done": time.monotonic() - 10, "served": [{"tool": 1, "seq": len(order)}], "errors": []}
    monkeypatch.setattr(nr, "_routine", routine)
    monkeypatch.setattr(nr, "_short", lambda client, text: client.status.__setitem__("tool_offset", [0, 0, client.table]))
    monkeypatch.setattr(nr, "_to", lambda client, x, y, z: order.append(("to", x, y, z)))
    monkeypatch.setattr(nr, "_vars", lambda client, nums: {n: client.vars[n] for n in nums})
    c = Client()
    rows = nr.m600_cases()[1]({"client": c, "frames": [], "plate": {"x": 10, "y": 10, "z": -180}})
    assert [o for o in order if isinstance(o, str)] == ["T0 M600", "T1 M600", "T0 M600", "T1 M600"], order
    assert not [o for o in order if isinstance(o, tuple)], "no detour down before a T1 measurement"
    by = {r["case"]: r for r in rows}
    assert by["m600-t1-return"]["status"] == "PASS", by["m600-t1-return"]
    assert by["m600-t1-return.counter-x+1"]["status"] == "PASS"
    order.clear()
    c = Client()
    c.t1_end_z = -20.0
    rows = nr.m600_cases()[1]({"client": c, "frames": [], "plate": {"x": 10, "y": 10, "z": -180}})
    assert {r["case"]: r for r in rows}["m600-t1-return"]["status"] == "FAIL"


_RET = dict(setting=1.0, call_tool=0, call_offset=0.0, tool=1, end_tool=1, table=49.9996, applied=49.9996)


@pytest.mark.parametrize("change, status, part", [
    ({}, "PASS", "T0 0.000 mm"),
    ({"end": (0, 0, -20)}, "FAIL", "Z ended"),
    ({"end": (1, 0, 0)}, "FAIL", "X ended"),
    ({"errors": ((11, "Linear move on line 596 would exceed Z's positive limit"),)}, "FAIL", "596"),
    ({"end_tool": 99}, "FAIL", "T99"),
    ({"applied": 50.0}, "FAIL", "applied"),
    ({"call": (None, 0, 0), "end": (0, 0, -20)}, "FAIL", "Z ended"),   # a known contradiction beats an unread value
    ({"call": (None, 0, 0)}, "incomplete", "not read"),
    ({"call": (0, 0, -60)}, "incomplete", "not the top"),           # no climb to prove from below
    ({"setting": 0.0}, "incomplete", "#3106"),                        # the return not on
    ({"setting": None}, "incomplete", "#3106"),
    ({"call_tool": 3, "call_offset": 73.0}, "incomplete", "not longer"),   # the new tool is no climb
    ({"call_offset": None}, "incomplete", "not read"),
    ({"applied": None}, "incomplete", "not read"),
])
def test_the_m600_return_is_judged_at_the_top_and_the_calls_xy(change, status, part):
    """Codex R307: the fixed case shows #3106 = 1, a start from the top with an
    empty spindle or a shorter applied length (the climb the old return could
    not make), the target tool with its stored and applied length equal, the
    end at the call's X/Y at Z0 and no NML error — "no error" alone is no PASS."""
    args = {"call": (0, 0, 0), "end": (0, 0, 0), "errors": (), **_RET, **change}
    r = nc.eval_m600_return("m600-t1-return", args.pop("call"), args.pop("end"), 0.0, **args)
    assert r["status"] == status and part in r["detail"], r


def test_parameters_are_read_from_the_interpreter_not_the_var_file(monkeypatch):
    """Live run 2026-11-05 (fifth): the reset wrote #3102 = -180 and its MDI
    set the interpreter, but get_probe_vars read -179 — it reads the var
    FILE, which an interp synch had rewritten from the interpreter's memory
    between the file write and the MDI. A routine reads the interpreter:
    _vars reads there (a tagged DEBUG line, in portions under LinuxCNC's
    255-character line); a number not read ends the run."""
    interp, asked = {3102: -180.0, 3100: 10.0}, []

    class FileOnly:
        def request(self, cmd, **kw):
            assert cmd == "get_probe_vars"
            return {"vars": {str(k): -179.0 for k in kw["vars"]}}   # the file before the next synch

    def read_params(c, nums, tries=3):
        asked.append(list(nums))
        return {n: interp.get(n) for n in nums}
    monkeypatch.setattr(nr, "_read_params", read_params)
    assert nr._vars(FileOnly(), [3102, 3100]) == {3102: -180.0, 3100: 10.0}
    asked.clear()
    interp.update({n: 1.0 for n in nr.TOOLSETTER_VARS})
    nr._vars(FileOnly(), nr.TOOLSETTER_VARS)
    assert all(len(a) <= nr.VARS_PER_READ for a in asked) and sum(map(len, asked)) == len(nr.TOOLSETTER_VARS)
    with pytest.raises(RuntimeError, match="3999"):
        nr._vars(FileOnly(), [3102, 3999])


def test_line_7_plunging_to_the_skipped_depth_is_a_fail():
    """The model the fifth live run disproved, kept as the counter-case: line
    7 diving from the safe height to the skipped G0 Z-100 (a diagonal entry)
    breaks the dialog's contract that Z descends only by the program's own
    words — line 7 holds Z."""
    hist, frames = _rfl_run()
    frames[5] = _rfl_frame(23.3, L, (101, 100, -0.5))
    frames[6] = _rfl_frame(24.3, L, (150, 100, -25))
    r = _line(hist, frames)
    assert r["status"] == "FAIL", r


# ── Codex R306: FI-I36 (a finished servo row) and FI-I37 (the retry's bounds) ──
def test_a_finished_servo_row_survives_a_later_refusal(tmp_path, monkeypatch):
    """FI-I36: the first section shows Y moving in the X jog — jog-x+.servo
    FAIL. The second case's start is refused ("Not armed"); the report must
    still hold that FAIL (the servo rows lived in a local list only the
    normal return and a failing section end handed on). The section's audit
    keeps the jog_stop reply time beside it (Codex's request for the
    recomputation)."""
    from test_support import live_session as ls

    class JogClient:
        error, frames = None, []
        status = {"joint_pos": list(nr.JOG_START)}
        mdis = 0

        def request(self, cmd, **kw):
            if cmd == "mdi":
                JogClient.mdis += 1
                if JogClient.mdis == 2:
                    raise ls.Refused("mdi refused: Not armed — press Arm")
            return {"ok": True}
    bad = {"samples": _samples([(300., 300., -50., 0., 0., 0.), (300., 301., -50., 0., 0., 0.)]), "problems": []}
    c = JogClient()

    def setup(ctx):
        ctx.update(client=c, frames=[], servo=FakeMeasurement([bad]))
    monkeypatch.setattr(nr, "_servo_prep", lambda c: None)
    monkeypatch.setattr(nr, "_wait", lambda *a: None)
    monkeypatch.setattr(nr.time, "sleep", lambda s: None)
    out = nr.run(FakeHost(), [("setup", setup), nr.jog_cases(3)], tmp_path / "run")
    assert any(r["case"] == "jog-x+.servo" and r["status"] == "FAIL" for r in out["rows"]), out["rows"]
    assert "Not armed" in out["error"]
    assert isinstance(out["servo_sections"][0].get("t_reply"), float), out["servo_sections"][0]


class _Clock:
    def __init__(self):
        self.t = 100.0

    def monotonic(self):
        return self.t

    def sleep(self, s):
        self.t += s


class _RetriedClient:
    """Refused for the start claim `refusals` times — idle frames arrive
    meanwhile — then accepted: busy, and done only when `finish`."""
    error = None

    def __init__(self, clock, refusals, finish):
        self.clock, self.refusals, self.finish, self.n = clock, refusals, finish, 0
        self.frames, self.errors, self.sent_at = [], [], None
        self.status = {"tool_change_requested": False, "tool_change_seq": None, "interp_state": 1, "inpos": True}

    def request(self, cmd, **kw):
        from test_support import live_session as ls
        self.n += 1
        if self.n <= self.refusals:
            self.frames.append((self.clock.t, dict(self.status)))
            raise ls.Refused(f"{cmd} refused: A program or macro is starting or running — wait")
        self.sent_at = self.clock.t
        self.status = {**self.status, "interp_state": 2, "inpos": False}
        self.frames.append((self.clock.t, dict(self.status)))
        if self.finish:
            self.clock.t += 0.2
            self.status = {**self.status, "interp_state": 1, "inpos": True}
            self.frames.append((self.clock.t, dict(self.status)))
        return {"ok": True}


@pytest.mark.parametrize("refusals, finish, completes", [(22, False, False), (0, False, False), (22, True, True), (0, True, True)])
def test_a_retried_block_ends_only_on_frames_after_its_acceptance(monkeypatch, refusals, finish, completes):
    """FI-I37: 2.2 s of start-claim refusals bring only idle frames; the
    accepted G49 then shows busy and never completes. Its end may come only
    from frames received after the ACCEPTED send — the refused attempts'
    idle frames gave it a completion before its acceptance. Controls: no
    refusal, and a real completion after the retry."""
    clock = _Clock()
    monkeypatch.setattr(nr.time, "monotonic", clock.monotonic)
    monkeypatch.setattr(nr.time, "sleep", clock.sleep)
    c = _RetriedClient(clock, refusals, finish)
    if completes:
        out = nr._routine(c, "G49", require_busy=False, deadline=0.5)
        assert out["t_done"] >= c.sent_at and out["t0"] <= c.sent_at
    else:
        with pytest.raises(RuntimeError):
            nr._routine(c, "G49", require_busy=False, deadline=0.5)
    assert c.n == refusals + 1


@pytest.mark.parametrize("kind, asked", [("Refused", 2), ("TransportLost", 1), ("NoReply", 1)])
def test_only_a_known_claim_refusal_is_asked_again(monkeypatch, kind, asked):
    """FI-I37: the type decides, never the text — a lost transport or a
    missing reply carrying the same words is an unknown delivery and ends
    the run at once."""
    from test_support import live_session as ls
    cls = getattr(ls, kind)

    class C:
        n = 0

        def request(self, cmd, **kw):
            C.n += 1
            if C.n == 1:
                raise cls("A program or macro is starting or running — wait")
            return {"ok": True}
    monkeypatch.setattr(nr.time, "sleep", lambda s: None)
    try:
        nr._when_free(C(), "mdi", text="G49")
    except RuntimeError:
        pass
    assert C.n == asked


# ── 2c-b: the run-from-line start point from the servo stream (R309/R310) ──
R_LINES = frozenset({308, 341, 453, 587, 601})        # the routine's motion lines (a sample of them)
P_LINES = frozenset(range(1, 12))                     # the program's lines 1…11


def _seg(line, frm, to, n=20, inpos=0):
    """n samples moving linearly frm → to on `line` (vel-cmd along it)."""
    out = []
    for i in range(n):
        f = i / max(n - 1, 1)
        p = tuple(a + (b - a) * f for a, b in zip(frm, to))
        v = tuple((b - a) for a, b in zip(frm, to))
        out.append((line, (*p, *v), inpos))
    return out


def _rest(line, at, n=15):
    return [(line, (*at, 0.0, 0.0, 0.0), 1) for _ in range(n)]


def _rfl_servo(*parts, n0=1000):
    """(line, (x, y, z, vx, vy, vz), inpos) rows → a servo section."""
    rows = [r for p in parts for r in p]
    samples = [(i * 0.001, n0 + i, (*v, line, inpos, 7)) for i, (line, v, inpos) in enumerate(rows)]
    return {"samples": samples, "problems": []}


def _good(**over):
    parts = {"measure": _seg(587, (10, 10, -127), (10, 10, 0)) + _seg(601, (10, 10, 0), (0, 0, 0)),
             "runout": [(0, (0, 0, 0, -0.01, -0.01, 0), 0)] * 2,
             "entry": _seg(0, (0, 0, 0), (100, 100, 0)),
             "rest": _rest(0, (100, 100, 0)),
             "l7": _seg(7, (100, 100, 0), (200, 100, 0)) + _rest(7, (200, 100, 0), 3),
             "l8": _seg(8, (200, 100, 0), (200, 200, 0)) + _rest(8, (200, 200, 0), 3),
             "l9": _seg(9, (200, 200, 0), (200, 200, -30)) + _rest(9, (200, 200, -30), 3),
             "end": _rest(0, (200, 200, -30), 5)}
    parts.update(over)
    return _rfl_servo(*parts.values())


def _start(sec, entry=(100.0, 100.0)):
    return sc.eval_rfl_start_servo("rfl-start-point", sec, line=7, entry_xy=entry, safe_z=0.0,
                                   routine_lines=R_LINES, program_lines=P_LINES)


def test_the_start_point_from_the_servo_stream_passes_a_clean_entry():
    r = _start(_good())
    assert r["status"] == "PASS", r


@pytest.mark.parametrize("name, over, status, part", [
    # R309/R310 counter-cases: each a known contradiction — FAIL
    ("line 6 moved before line 7", {"rest": _rest(0, (100, 100, 0)) + _seg(6, (100, 100, 0), (100, 100, -5))
                                    + _seg(0, (100, 100, -5), (100, 100, 0)) + _rest(0, (100, 100, 0))}, "FAIL", "line 6"),
    ("Z sank before line 7", {"entry": _seg(0, (0, 0, 0), (100, 100, -20))}, "FAIL", "descent"),
    ("small steps add up to a descent", {"entry": _seg(0, (0, 0, 0), (100, 100, 0)) + _seg(0, (100, 100, 0), (100, 100, -0.05), n=50)},
     "FAIL", "descent"),
    ("line 7 starts beside the entry", {"rest": _rest(0, (99.5, 100, 0)), "l7": _seg(7, (99.5, 100, 0), (200, 100, 0))},
     "FAIL", "entry"),
    ("an excursion after the anchor", {"rest": _rest(0, (100, 100, 0)) + _seg(0, (100, 100, 0), (100.02, 100, 0), n=5)
                                       + _seg(0, (100.02, 100, 0), (100, 100, 0), n=5) + _rest(0, (100, 100, 0))},
     "FAIL", "after reaching the entry"),
    ("line 7 moves Z", {"l7": _seg(7, (100, 100, 0), (200, 100, -1))}, "FAIL", "line 7 moved"),
    # R310: a later routine line never cuts a known earlier program motion
    ("line 6 moved before a later routine line", {"measure": _seg(587, (10, 10, -127), (10, 10, 0))
                                                  + _seg(6, (10, 10, 0), (10, 10, -3)) + _seg(601, (10, 10, -3), (0, 0, 0))},
     "FAIL", "line 6"),
    ("line 6 moved before the first routine line", {"measure": _seg(6, (10, 10, -100), (10, 10, -127))
                                                    + _seg(587, (10, 10, -127), (10, 10, 0)) + _seg(601, (10, 10, 0), (0, 0, 0))},
     "FAIL", "line 6"),
    # missing proofs: incomplete
    ("no line 7", {"l7": [], "l8": [], "l9": []}, "incomplete", "line 7"),
    ("no rest at the entry", {"rest": []}, "incomplete", "rest"),
    ("a routine line after the program began", {"end": _seg(601, (200, 200, -30), (200, 200, 0))}, "incomplete", "order"),
    ("an unattributed motion", {"entry": _seg(0, (0, 0, 0), (100, 100, 0)) + [(44, (100, 100, 0, 1.0, 0, 0), 0)] * 3},
     "incomplete", "attribut"),
    ("line 8 moves X: the mapping fails its self-check", {"l8": _seg(8, (200, 100, 0), (202, 200, 0))}, "incomplete", "self-check"),
])
def test_the_start_point_counter_cases(name, over, status, part):
    r = _start(_good(**over))
    assert r["status"] == status and part in r["detail"], (name, r)


def test_a_self_check_failure_never_lowers_a_known_fail():
    r = _start(_good(entry=_seg(0, (0, 0, 0), (100, 100, -20)), l8=_seg(8, (200, 100, 0), (202, 200, 0))))
    assert r["status"] == "FAIL" and "descent" in r["detail"], r


def test_the_receipt_times_do_not_decide():
    sec = _good(entry=_seg(0, (0, 0, 0), (100, 100, -20)))
    shifted = {"samples": [(t + 5.0, n, v) for t, n, v in sec["samples"]], "problems": []}
    assert _start(sec)["status"] == _start(shifted)["status"] == "FAIL"


def test_a_section_problem_is_incomplete_and_a_planted_entry_fails():
    bad = {**_good(), "problems": ["a number gap"]}
    assert _start(bad)["status"] == "incomplete"
    assert _start(_good(), entry=(101.0, 100.0))["status"] == "FAIL"


def test_the_routine_lines_come_from_its_text_and_never_meet_the_program():
    text = "G21\n(LOG,x)\nG53 G1 Z0\n#1=2\nG38.2 Z-10\nG0 X1 ; G1 in a comment\nM2\n"
    assert sc.motion_lines(text) == frozenset({3, 5, 6})
    r = sc.eval_rfl_start_servo("x", _good(), line=7, entry_xy=(100.0, 100.0), safe_z=0.0,
                                routine_lines=frozenset({7, 600}), program_lines=P_LINES)
    assert r["status"] == "incomplete" and "meet" in r["detail"], r


def test_the_run_from_line_step_judges_its_start_from_the_servo_stream(tmp_path, monkeypatch):
    """2c-b at the whole step: the attempt's servo section judged with the run
    tree's routine lines — a clean entry PASS, the counter (entry planted
    1 mm off in X) refused; an entry that sinks before line 7 FAIL."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    for stream, status in ((_good(), "PASS"), (_good(entry=_seg(0, (0, 0, 0), (100, 100, -20))), "FAIL")):
        hist, frames = _rfl_run()
        c = RflClient(frames, hist)
        (tmp_path / status).mkdir()
        ctx, step = _rfl_step(tmp_path / status, c)
        ctx["run"] = tmp_path / status
        ctx["servo"] = FakeMeasurement([stream])
        by = {}
        try:
            by = {r["case"]: r for r in step(ctx)}
        except nr.StepFailed as e:
            by = {r["case"]: r for r in e.rows}
        assert by["rfl-start-point"]["status"] == status, by["rfl-start-point"]
        if status == "PASS":
            assert by["rfl-start-point.counter-entry-x+1"]["status"] == "PASS"


# ── P2 on the real task: the section saved while off reaches the program's M600 (Codex R308–R309) ──

def _ts_judge(**over):
    args = dict(l0=50.0, old_3102=-180.0, new_3102=-179.0, length=49.0005, g43=49.0005,
                note={"digest": "d", "set_up": True, "synced": True}, interp_before=-180.0, interp_after=-179.0,
                errors=())
    args.update(over)
    return nc.eval_ts_sync("ts-sync-program-m600", **args)


@pytest.mark.parametrize("over, status, part", [
    ({}, "PASS", "applied at the start"),
    ({"length": 49.9995, "g43": 49.9995}, "FAIL", "old #3102"),              # the live red case (R309)
    ({"length": 48.5, "g43": 48.5}, "FAIL", "expected 49"),
    ({"errors": [(11, "Unable to find …")]}, "FAIL", "reported"),
    ({"note": None}, "FAIL", "names no toolsetter sync"),
    ({"note": {"digest": "d", "set_up": True, "synced": False}}, "FAIL", "nothing was written"),
    ({"interp_before": -179.0}, "incomplete", "prove nothing"),
    ({"g43": 48.0}, "FAIL", "applied G43"),
    ({"interp_after": -180.0}, "FAIL", "after the start"),
    ({"interp_after": None}, "incomplete", "not read"),
    ({"length": None}, "incomplete", "not read"),
    ({"errors": [(13, "NATIVE1 P3102=-179.000000")]}, "PASS", "applied"),     # a DEBUG line is no failure
])
def test_the_program_start_measures_only_with_the_new_basis(over, status, part):
    r = _ts_judge(**over)
    assert r["status"] == status and part in r["detail"], r


def test_the_old_basis_counter_refuses_the_new_length():
    base = _ts_judge()
    c = nc.counter("ts-sync-program-m600.counter-old-basis", _ts_judge(new_3102=-180.0), base)
    assert c["status"] == "PASS" and "refused" in c["detail"], c


_TS_OLD = {k: 0.0 for k in nc.TS_KEYS} | {"3102": -180.0}
_TS_NEW = _TS_OLD | {"3102": -179.0}


def _canon(v):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lcnc-gateway"))
    import toolsetter_rules as tr
    return tr.canonical(v)


def _booking(version, origin="applied", base=None, **values):
    keys = {k: {"value": v, "origin": origin} for k, v in (base or _TS_OLD).items()}
    for k, v in values.items():
        keys[k[1:]] = v if isinstance(v, dict) else {"value": v, "origin": origin}
    return {"version": version, "keys": keys}


@pytest.mark.parametrize("before, after, status, part", [
    (_booking(4), _booking(5, base=_TS_NEW), "PASS", "the form: confirmed"),
    (_booking(4, "read"), _booking(5, "read", base=_TS_NEW), "PASS", "the form: confirmed"),
    (_booking(4, k3005={"value": 0.0, "origin": "read"}), _booking(5, base=_TS_NEW), "PASS", "confirmed"),
    (None, _booking(5, base=_TS_NEW), "incomplete", "not received"),
    # R312 FI-I43 — the form's equality, no tolerance: a sixth decimal off is "pending" there
    (_booking(4), _booking(5, base=_TS_NEW, k3102=-178.999999), "FAIL", "other numbers than the section"),
    # …the before-state bound to the prepared basis: nothing booked, only assumed, a wrong old number
    ({"version": 4, "keys": {}}, _booking(5, base=_TS_NEW), "incomplete", "not confirmed"),
    (_booking(4, k3102={"value": -180.0, "origin": "assumed"}), _booking(5, base=_TS_NEW), "incomplete",
     "not confirmed"),
    (_booking(4, k3102=-42.0), _booking(5, base=_TS_NEW), "FAIL", "prepared basis"),
    (_booking(4, base=_TS_NEW), _booking(5, base=_TS_NEW), "FAIL", "prepared basis"),   # the new number already
    (_booking(4), _booking(5), "FAIL", "other numbers than the section"),                 # #3102 still old
    (_booking(4), _booking(5, base=_TS_NEW, k3005={"value": 0.0, "origin": "assumed"}), "incomplete",
     "not confirmed"),
    (_booking(4), _booking(4, base=_TS_NEW), "FAIL", "version"),
])
def test_the_booking_shows_the_prepared_numbers_before_and_the_section_after(before, after, status, part):
    r = nc.eval_ts_booking("ts-sync-booking", _TS_OLD, _TS_NEW, before, after, canon=_canon)
    assert r["status"] == status and part in r["detail"], r


@pytest.mark.parametrize("note, v0, v1, errors, status", [
    ({"synced": False}, 5, 5, [], "PASS"),
    ({"synced": False}, 5, 5, [(11, "near line 2: unknown word")], "FAIL"),     # R312 FI-I44
    ({"synced": False}, 5, 5, [(13, "NATIVE1 P3102=-179.000000")], "PASS"),     # a DEBUG line is no error
    ({"synced": True}, 5, 6, [], "FAIL"),
    (None, 5, 5, [], "FAIL"),
    ({"synced": False}, 5, 6, [], "FAIL"),
    ({"synced": False}, None, 5, [], "incomplete"),
])
def test_a_second_start_with_the_same_section_writes_nothing(note, v0, v1, errors, status):
    assert nc.eval_ts_stable("ts-sync-stable", note, v0, v1, errors=errors)["status"] == status


class TsClient(FrameClient):
    """The ts-sync step against a scripted gateway with the sim's physics: the
    physical T1 length IS its table length, M600 measures it + |#3102| −
    |the plate|. `sync`: the gateway applies the saved section at a program
    start (P2) — "none" sends no note and writes nothing (the old gateway),
    "claim" says it synced but writes nothing, "always" writes on every start."""
    PLATE = -180.0

    def __init__(self, sync="p2"):
        self.base = {**_IDLE, "is_enabled": True, "homed_joints": [True] * 3, "tool_number": 99,
                     "tool_offset": [0.0, 0.0, 50.0], "tool_table_z": 50.0, "task_mode": 1}
        super().__init__([(0.0, dict(self.base))])
        self.sync, self.table, self.vars = sync, {1: 50.0}, dict(_TS_SHIPPED)
        self.section, self.preview_origin = None, None
        self.toolsetter_booking = {"version": 3, "keys": {str(k): {"value": float(v), "origin": "applied"}
                                                          for k, v in self.vars.items()}}
        self.after_confirm, self.starts = [], 0
        self.error_on = {}      # (cmd, the program's text contains) → an error that request brings

    def _frames(self, *states, dt=1.0):
        t = self.frames[-1][0]
        for i, st in enumerate(states):
            self.base.update(st)
            self.frames.append((t + dt * (i + 1), dict(self.base)))

    def _book(self, vals):
        keys = dict(self.toolsetter_booking["keys"])
        changed = False
        for k, v in vals.items():
            new = {"value": float(v), "origin": "applied"}
            changed = changed or keys.get(str(k)) != new
            keys[str(k)] = new
            self.vars[int(k)] = float(v)
        if changed:
            self.toolsetter_booking = {"version": self.toolsetter_booking["version"] + 1, "keys": keys}

    def request(self, cmd, **kw):
        import hashlib
        import re
        self.sent.append((cmd, kw))
        program = Path(kw.get("path") or (self.preview_origin or {}).get("file") or "/nonexistent")
        text = program.read_text() if program.is_file() else ""
        for (on_cmd, part), err in self.error_on.items():
            if on_cmd == cmd and part in text:
                self.errors.append((self.frames[-1][0] + 0.5, *err))
        if cmd == "get_tool_table":
            return {"tools": [{"T": t, "Z": z} for t, z in self.table.items()]}
        if cmd == "mdi":
            m = re.match(r"G43 H(\d+)", kw["text"])
            if m:
                self.base["tool_offset"] = [0.0, 0.0, self.table[int(m.group(1))]]
            self._frames({}, {})
            if kw["text"].startswith("(DEBUG,"):
                tag = kw["text"][len("(DEBUG,"):].split()[0]
                vals = " ".join(f"P{n}={self.vars[int(n)]:.6f}" for n in re.findall(r"#(\d+)", kw["text"]))
                self.errors.append((self.frames[-1][0], 13, f"{tag} {vals}"))
            return {"ok": True}
        if cmd == "set_probe_vars":
            self._book(kw["vars"])
            return {"ok": True, "mdi_set": True}
        if cmd == "save_settings":
            self.section = dict(kw["data"])
            return {"ok": True}
        if cmd in ("machine_off", "machine_on"):
            self._frames({"is_enabled": cmd == "machine_on"})
            return {"ok": True}
        if cmd == "load_file":
            self.preview_origin = {"file": kw["path"], "version": 1,
                                   "source": hashlib.sha256(Path(kw["path"]).read_text().encode()).hexdigest()}
            return {"ok": True}
        if cmd == "save_tool":
            self.table[kw["tool_number"]] = kw["z_offset"]
            return {"ok": True}
        if cmd == "cycle_start":
            self.starts += 1
            import toolsetter_rules as tr
            want = {str(k): v for k, v in tr.setup(self.section)["values"].items()}
            differ = any(self.toolsetter_booking["keys"].get(k, {}).get("value") != v for k, v in want.items())
            write = self.sync == "always" or (self.sync == "p2" and differ)
            if write:
                self._book(want)
            note = None if self.sync == "none" else {"digest": "d", "set_up": True,
                                                       "synced": write or self.sync == "claim"}
            text = Path(self.preview_origin["file"]).read_text()
            if "M600" in text:
                measured = self.table[1] + abs(self.vars[3102]) - abs(self.PLATE)
                self._frames({"interp_state": 2, "inpos": False},
                             {"tool_change_requested": True, "tool_change_seq": self.starts, "tool_change_tool": 1})
                self.after_confirm = [{"tool_change_requested": False, "tool_change_seq": None, "tool_number": 1},
                                      {"interp_state": 2, "inpos": False},
                                      {"interp_state": 1, "inpos": True, "tool_table_z": measured,
                                       "tool_offset": [0.0, 0.0, measured]}]
                self.table[1] = measured
            else:
                self._frames({"interp_state": 2}, {"interp_state": 1}, {})
            return {"ok": True, "toolsetter": note} if note else {"ok": True}
        if cmd == "confirm_tool_change":
            self._frames(*self.after_confirm)
            return {"ok": True}
        raise AssertionError((cmd, kw))


def _ts_step(tmp_path, client):
    (tmp_path / nr.NC_FILES).mkdir()
    ctx = {"client": client, "frames": client.frames, "config": tmp_path, "report": {},
           "plate": {"z": TsClient.PLATE}, "tree": Path(__file__).resolve().parent.parent}
    return ctx, nr.ts_sync_cases()[1]


@pytest.fixture
def _ts_rules_on_path(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parent.parent / "lcnc-gateway"))
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)


@pytest.mark.parametrize("sync, rows", [
    ("p2", {"ts-sync-program-m600": "PASS", "ts-sync-program-m600.counter-old-basis": "PASS",
            "ts-sync-booking": "PASS", "ts-sync-stable": "PASS"}),
    ("none", {"ts-sync-program-m600": "FAIL", "ts-sync-program-m600.counter-old-basis": "incomplete",
              "ts-sync-booking": "FAIL", "ts-sync-stable": "FAIL"}),
    ("claim", {"ts-sync-program-m600": "FAIL", "ts-sync-program-m600.counter-old-basis": "incomplete",
               "ts-sync-booking": "FAIL", "ts-sync-stable": "FAIL"}),
    ("always", {"ts-sync-program-m600": "PASS", "ts-sync-program-m600.counter-old-basis": "PASS",
                "ts-sync-booking": "PASS", "ts-sync-stable": "FAIL"}),
])
def test_the_whole_ts_sync_step(tmp_path, _ts_rules_on_path, sync, rows):
    """The step at its whole course: the saved-while-off section applied by
    the start (PASS); the old gateway (no note, nothing written — the R309
    red case, measured with the old #3102); one that claims a sync it did not
    write; one that writes again on the same section."""
    c = TsClient(sync)
    ctx, step = _ts_step(tmp_path, c)
    by = {r["case"]: r for r in step(ctx)}
    assert {k: r["status"] for k, r in by.items()} == rows, {k: (r["status"], r["detail"]) for k, r in by.items()}
    if sync == "claim":
        assert "old #3102" in by["ts-sync-program-m600"]["detail"], by["ts-sync-program-m600"]
    # the course: the section saved, the machine off, the moved section saved, on, the program started
    cmds = [cmd for cmd, _ in c.sent if cmd in ("save_settings", "machine_off", "machine_on", "cycle_start")]
    assert cmds[:5] == ["save_settings", "machine_off", "save_settings", "machine_on", "cycle_start"], cmds
    saves = [kw["data"]["touchZ"] for cmd, kw in c.sent if cmd == "save_settings"]
    assert saves == [-180.0, -179.0, -180.0] and c.section["slowFeed"] == 20.0
    # put back: T1's length, #3102 and the offset
    assert c.table[1] == 50.0 and c.vars[3102] == -180.0 and c.base["tool_offset"][2] == 50.0

# ── Codex R311: the boundary into the entry, a missing routine, the checked texts ──

_BACK_UP = _seg(0, (0, 0, -0.002), (0, 0, 0)) + _seg(0, (0, 0, 0), (100, 100, 0))


@pytest.mark.parametrize("over, status, part", [
    # FI-I40: the first step after the routine's last sample (Z 0) goes down,
    # then back up — the correct start later must not hide it
    ({"runout": [(0, (0, 0, -0.002, 0, 0, -0.5), 0)], "entry": _BACK_UP}, "FAIL", "descent"),
    # …as small steps across the boundary that add up past STILL_POS
    # (each step 0.0006, under STILL_POS alone; the climb back from the lowest)
    ({"runout": [(0, (0, 0, -0.0006, 0, 0, -0.1), 0), (0, (0, 0, -0.0012, 0, 0, -0.1), 0)],
      "entry": _seg(0, (0, 0, -0.0012), (0, 0, 0)) + _seg(0, (0, 0, 0), (100, 100, 0))}, "FAIL", "descent"),
    # the routine's last Z unread: no proven step into the entry
    ({"measure": _seg(587, (10, 10, -127), (10, 10, 0)) + _seg(601, (10, 10, 0), (0, 0, 0))[:-1]
      + [(601, (0, 0, None, 0, 0, 0), 0)]}, "incomplete", "not proven"),
    # an XY run-out at a constant Z stays allowed
    ({"runout": [(0, (0, 0, 0, -0.02, -0.02, 0), 0)] * 3}, "PASS", "at rest"),
    # FI-I41: no routine sample — the boundary is not proven…
    ({"measure": [], "runout": []}, "incomplete", "routine"),
    # …but a known contradiction stays one
    ({"measure": _seg(6, (10, 10, -100), (10, 10, -127)), "runout": []}, "FAIL", "line 6 moved"),
    ({"measure": [], "runout": [], "l7": _seg(7, (100, 100, 0), (200, 100, -1))}, "FAIL", "line 7 moved"),
])
def test_the_entry_starts_at_the_routines_end(over, status, part):
    r = _start(_good(**over))
    assert r["status"] == status and part in r["detail"], r


def _tree_with(tmp_path, change):
    """A run tree holding the routine texts, `change`d: {rel: text | None (missing)}."""
    root = Path(__file__).resolve().parent.parent
    tree = tmp_path / "tree"
    # the step also judges the toolsetter section with the run tree's rule (P2)
    (tree / "lcnc-gateway").mkdir(parents=True)
    shutil.copy(root / "lcnc-gateway" / "toolsetter_rules.py", tree / "lcnc-gateway")
    for rel in nr.ROUTINE_TEXTS:
        (tree / rel).parent.mkdir(parents=True, exist_ok=True)
        text = change.get(rel, (root / rel).read_text())
        if text is not None:
            (tree / rel).write_text(text)
    return tree


_TTO, _M600 = list(nr.ROUTINE_TEXTS)


def _with_line_after(rel, n, extra):
    lines = (Path(__file__).resolve().parent.parent / rel).read_text().splitlines(keepends=True)
    return "".join(lines[:n] + [extra + "\n"] + lines[n:])


@pytest.mark.parametrize("change, part", [
    # the R311 probe: a modal axis word after line 601 — the word scan misses it, the hash does not
    ({_TTO: _with_line_after(_TTO, 601, "X25")}, "not the checked one"),
    ({_M600: _with_line_after(_M600, 1, "(a changed wrapper)")}, "not the checked one"),
    ({_M600: None}, "not readable"),
])
def test_routine_texts_not_the_checked_ones_map_nothing(tmp_path, monkeypatch, change, part):
    """FI-I42: the attribution reads only the checked texts — a changed routine,
    a changed wrapper, a missing one: no start-point claim either way."""
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    hist, frames = _rfl_run()
    c = RflClient(frames, hist)
    ctx, step = _rfl_step(tmp_path, c)
    ctx.update(run=tmp_path, servo=FakeMeasurement([_good()]), tree=_tree_with(tmp_path, change))
    by = {r["case"]: r for r in step(ctx)}
    assert by["rfl-start-point"]["status"] == "incomplete" and part in by["rfl-start-point"]["detail"], by
    assert by["rfl-start-point.counter-entry-x+1"]["status"] == "incomplete"


def test_the_checked_texts_are_the_shipped_ones_and_the_previews_pin(tmp_path, monkeypatch):
    """The pins are the shipped texts; the routine's is the preview's
    MARKED_POS_ROUTINES (read from the source, never by importing the
    gateway); the clean step names every source it judged with."""
    import hashlib
    import re
    root = Path(__file__).resolve().parent.parent
    for rel, sha in nr.ROUTINE_TEXTS.items():
        assert hashlib.sha256((root / rel).read_bytes()).hexdigest() == sha, rel
    util = (root / "lcnc-gateway" / "gateway_util.py").read_text()
    marked = re.search(r"MARKED_POS_ROUTINES = frozenset\(\{([^}]*)\}\)", util).group(1)
    assert nr.ROUTINE_TEXTS[_TTO] in marked
    monkeypatch.setattr(nr, "SHORT_GRACE", 0.02)
    hist, frames = _rfl_run()
    c = RflClient(frames, hist)
    ctx, step = _rfl_step(tmp_path, c)
    ctx.update(run=tmp_path, servo=FakeMeasurement([_good()]))
    row = next(r for r in step(ctx) if r["case"] == "rfl-start-point")
    assert row["status"] == "PASS", row
    assert row["sources"] == {**nr.ROUTINE_TEXTS, "program": hashlib.sha256(nr.RFL_PROGRAM.encode()).hexdigest()}


@pytest.mark.parametrize("error_on, stable", [
    ({("cycle_start", "M2"): (11, "near line 2: unknown word")}, "FAIL"),   # the second start's own error…
    ({("load_file", "G21 G90\nM2"): (11, "a load error before")}, "PASS"),  # …not one before its attempt
])
def test_the_second_starts_errors_reach_its_row(tmp_path, _ts_rules_on_path, error_on, stable):
    """R312 FI-I44 at the whole step: an NML error of the second start is
    ts-sync-stable's FAIL and the run's; an error before its accepted
    attempt is not its own. (The first start's program text has M600: the
    idle program alone is 'G21 G90 / M2'.)"""
    c = TsClient("p2")
    c.error_on = {(cmd, part if cmd == "load_file" else nr.TS_IDLE_PROGRAM): err
                  for (cmd, part), err in error_on.items()}
    ctx, step = _ts_step(tmp_path, c)
    rows = step(ctx)
    by = {r["case"]: r for r in rows}
    assert by["ts-sync-stable"]["status"] == stable, by["ts-sync-stable"]
    assert by["ts-sync-program-m600"]["status"] == "PASS"
    report = {"rows": rows, "restore": {"outcome": "complete", "isolation": [], "cleanup": []}}
    assert nr.verdict(report) == ("FAIL" if stable == "FAIL" else "PASS")


# ── Step 3: the servo stream's own time (plan Codex R313–R316) ──
from test_support import servo_time as st  # noqa: E402

MS = 1_000_000
CLOCK_OK = st.clock_contract(st.RTAPI_SHA256, st.PACKAGE_VERSION)


def _timed(lps, hb=None, latch=None, hb_ok=None, mark=3, reader_delay=MS):
    """A contiguous span: lps[k] = C_k − C_(k−1) (lps[0] the period into the
    first sample); hb: the oneshot input per sample. The receipts lag the
    controller by `reader_delay`; t0 lies before C_0."""
    c, t, samples, recv = 10_000 * MS, [], [], {}
    for k, lp in enumerate(lps):
        c += lp
        v = (0.0,) * 6 + (0, 1, mark, (hb_ok or [1] * len(lps))[k], (latch or [0] * len(lps))[k],
                          (hb or [0] * len(lps))[k], lp)
        samples.append((c / 1e9, 500 + k, v))
        recv[500 + k] = c + reader_delay
    return samples, recv, 10_000 * MS


def _hb_at(n, edges):
    """The oneshot input toggling at the given sample indices."""
    out, v = [], 0
    for k in range(n):
        if k in edges:
            v ^= 1
        out.append(v)
    return out


@pytest.mark.parametrize("lps, i, j, verdict", [
    ([MS] * 400, 2, 102, "PASS"),                         # 100 ms: 98…102 → PASS
    ([MS] * 400, 2, 262, "FAIL"),                         # 260 ms: 258…262 → FAIL
    # R314: 100 ms between the controller and the sampler at the second edge —
    # the controller's NEXT period (lp at j+1) carries it: 197…301 → incomplete, not FAIL
    ([MS] * 202 + [101 * MS] + [MS] * 200, 2, 201, "incomplete"),
])
def test_an_edge_gap_is_judged_by_its_bounds_in_three_ways(lps, i, j, verdict):
    samples, recv, t0 = _timed(lps)
    rng = st.proven(samples, recv, t0, CLOCK_OK)
    assert rng["ok"], rng
    b = st.gap_bounds(samples, rng, i, j)
    assert st.judge(b) == verdict, b


def test_the_same_observation_with_gaps_200_and_200_is_incomplete_too():
    """R315: two courses with the same periods, captures and bits — 300/100 and
    200/200 — are told apart by nothing: the upper bound over 250 is no proof."""
    samples, recv, t0 = _timed([MS] * 202 + [101 * MS] + [MS] * 200)
    rng = st.proven(samples, recv, t0, CLOCK_OK)
    upper, lower = st.gap_bounds(samples, rng, 2, 201)
    assert lower < st.HB_LIMIT_NS < upper and st.judge((upper, lower)) == "incomplete"


@pytest.mark.parametrize("lps, recv_shift, why", [
    # one interval of 4 301 000 000 ns cut to u32 (6 032 704) — the numbers clean
    ([MS] * 50 + [4_301_000_000 % (1 << 32)] + [MS] * 50, 4_301_000_000 - 4_301_000_000 % (1 << 32), "wrap"),
    ([MS] * 100, -5 * MS, "negative"),                    # receipts before the controller: contradictory
    ([MS] * 100, (1 << 32), "wrap"),                      # the rest exactly 2³²: not excluded
])
def test_the_wrap_proof_refuses_what_it_cannot_exclude(lps, recv_shift, why):
    samples, recv, t0 = _timed(lps)
    last = samples[-1][1]
    recv[last] += recv_shift
    rng = st.proven(samples, recv, t0, CLOCK_OK)
    assert not rng["ok"] and why in rng["why"], rng


def test_a_period_outside_the_proven_range_gives_no_bound():
    samples, recv, t0 = _timed([MS] * 100)
    rng = st.proven(samples, recv, t0, CLOCK_OK)
    assert st.gap_bounds(samples, rng, 1, 50) is None            # needs lp_1: before lo = 2
    assert st.gap_bounds(samples, rng, 10, 99) is None           # needs lp_100: past hi
    assert st.duration_lower(samples, rng, 0, 99) == 98 * MS     # C_99 − C_1


def test_the_lower_duration_after_a_mark_set_during_a_delay():
    """R314 C: the controller ran, then a pause before the sampler; the mark W
    is set during it — the first W sample's period starts before W, so only
    Σ from a+2 counts: 100 W samples at 1 ms are ~98 ms, never 2 s."""
    samples, recv, t0 = _timed([MS] * 50 + [2100 * MS] + [MS] * 100)
    rng = st.proven(samples, recv, t0, CLOCK_OK)
    assert st.duration_lower(samples, rng, 50, 150) == 99 * MS


@pytest.mark.parametrize("sha, version, ok", [
    (st.RTAPI_SHA256, st.PACKAGE_VERSION, True),
    ("0" * 64, st.PACKAGE_VERSION, False),
    (st.RTAPI_SHA256, "1:2.9.5-1", False),
])
def test_the_clock_is_proven_only_on_the_checked_binary(sha, version, ok):
    c = st.clock_contract(sha, version)
    assert c["ok"] is ok and (ok or "not proven" in c["why"])


def _latch(before=30, outage=20, after=40, delay=0, release_at=None, early_at=None, resume=True, mark=3):
    """The heartbeat chain per sample: oneshot.0.in toggles every 5 samples
    while the gateway beats, oneshot.0.out TRUE, then the outage (no edges,
    out FALSE), then — `resume` — beats again and out TRUE; fault-out TRUE
    from the edge (+ `delay` samples), FALSE again at `release_at`."""
    rows, hb_in = [], 0
    n = before + outage + after
    for k in range(n):
        beating = k < before or (resume and k >= before + outage)
        if beating and k % 5 == 0:
            hb_in ^= 1
        ok = 1 if beating else 0
        latch = 1 if k >= before + delay else 0
        if early_at is not None and k == early_at:
            latch = 1
        if release_at is not None and k >= release_at:
            latch = 0
        rows.append((k * 0.001, 700 + k, (0.0,) * 6 + (0, 1, mark, ok, latch, hb_in, MS)))
    return {"samples": rows, "problems": []}


@pytest.mark.parametrize("sec, delayed, status, part", [
    (_latch(), False, "PASS", "in the sample oneshot.0.out fell"),   # TRUE in the very sample
    (_latch(delay=1), False, "FAIL", "one cycle late"),      # the production row refuses a one-cycle delay
    (_latch(delay=1), True, "PASS", "exactly one cycle late"),   # …which the delayed variant must show
    (_latch(), True, "FAIL", "did not show"),                # a variant that latched at once is no counter-evidence
    (_latch(early_at=10), False, "FAIL", "before the expiry"),
    (_latch(outage=0, after=0), False, "incomplete", "no falling edge"),
    ({**_latch(), "problems": ["a number gap (701 → 703)"]}, False, "incomplete", "the section"),
])
def test_the_latch_is_judged_at_the_assigned_falling_edge(sec, delayed, status, part):
    r = sc.eval_latch_same_cycle("latch-same-cycle", sec, delayed=delayed)
    assert r["status"] == status and part in r["detail"], r


def test_the_edge_is_the_outages_not_the_last_true_of_the_section():
    """R315/R316: after the resume oneshot.0.out is TRUE again to the end — the
    edge judged is the FIRST FALSE after a TRUE, not 'after the last TRUE'."""
    sec = _latch(after=200)
    assert sc.falling_edge(sec["samples"]) == 30
    assert sc.eval_latch_same_cycle("latch-same-cycle", sec)["status"] == "PASS"


REFUSED = {"ok": False, "error": "Safety trip not acknowledged"}


@pytest.mark.parametrize("sec, reply, frames, status, part", [
    (_latch(), REFUSED, [{"ts": 1}] * 3, "PASS", "stayed TRUE"),
    (_latch(release_at=60), REFUSED, [{"ts": 1}] * 3, "FAIL", "released before the reset"),
    (_latch(), {"ok": True}, [{"ts": 1}] * 3, "FAIL", "accepted before"),
    (_latch(resume=False), REFUSED, [{"ts": 1}] * 3, "incomplete", "did not return"),
    (_latch(), REFUSED, [], "incomplete", "no frame"),
    (_latch(), REFUSED, [{"ts": 1}, None], "FAIL", "no unacknowledged trip"),
    (_latch(), None, [{"ts": 1}], "incomplete", "not asked"),
])
def test_the_latch_stays_through_the_resume_and_the_early_reset(sec, reply, frames, status, part):
    r = sc.eval_latch_sticky("latch-sticky", sec, reply, frames)
    assert r["status"] == status and part in r["detail"], r


def _recovery(cleared_at=10, again_at=None, n=40):
    rows = []
    for k in range(n):
        latch = 0 if k >= cleared_at and (again_at is None or k < again_at) else 1
        rows.append((k * 0.001, 900 + k, (0.0,) * 6 + (0, 1, 5, 1, latch, k // 5 % 2, MS)))
    return {"samples": rows, "problems": []}


@pytest.mark.parametrize("sec, frames, status, part", [
    (_recovery(), [(None, False, True)], "PASS", "machine on"),
    (_recovery(cleared_at=99), [(None, False, True)], "FAIL", "stayed TRUE"),
    (_recovery(again_at=30), [(None, False, True)], "FAIL", "TRUE again"),
    (_recovery(), [({"ts": 1}, False, True)], "FAIL", "not clear"),
    (_recovery(), [(None, False, False)], "FAIL", "not clear"),
    (_recovery(), [], "incomplete", "no frame"),
    ({"samples": [], "problems": ["start mark not received"]}, [(None, False, True)], "incomplete", "recovery section"),
    ({**_recovery(), "problems": ["a number gap (905 → 907)"]}, [(None, False, True)], "incomplete", "number gap"),
])
def test_the_recovery_is_its_own_section(sec, frames, status, part):
    r = sc.eval_latch_recovered("latch-recovered", sec, frames)
    assert r["status"] == status and part in r["detail"], r


# ── Step 3: the stopped processes and the own trip (test_support/trip.py) ──
from test_support import trip as tp  # noqa: E402


def test_a_process_is_stopped_only_after_its_identity_is_on_disk():
    import signal
    events, state = [], {}
    rec = tp.stop(state, lambda s: events.append(("save", list(s["stopped"]))), 4242, "gateway",
                  kill=lambda pid, sig: events.append(("kill", pid, sig)), ticks=lambda pid: 77)
    assert events == [("save", [rec]), ("kill", 4242, signal.SIGSTOP)] and rec == {"pid": 4242, "start": 77,
                                                                                    "what": "gateway"}
    with pytest.raises(RuntimeError, match="not found"):
        tp.stop({}, lambda s: None, 1, "gone", kill=lambda *a: None, ticks=lambda pid: None)


@pytest.mark.parametrize("now, signalled, outcome", [(77, True, "continued"), (78, False, "no signal"),
                                                     (None, False, "no signal")])
def test_a_stopped_process_is_continued_only_as_itself(now, signalled, outcome):
    import signal
    sent, state = [], {"stopped": [{"pid": 4242, "start": 77, "what": "gateway"}]}
    out = tp.cont(state, lambda s: None, state["stopped"][0], kill=lambda pid, sig: sent.append((pid, sig)),
                  ticks=lambda pid: now)
    assert (sent == [(4242, signal.SIGCONT)]) is signalled and outcome in out and state["stopped"] == []


def test_the_restore_continues_the_recorded_stops_before_it_ends_the_test_instance(monkeypatch):
    """ExecStopPost's path: a stopped gateway still itself gets its SIGCONT, a
    record whose pid is now another process gets none — both before the
    test unit is stopped."""
    import os
    import signal
    host = FakeHost()
    host.run_test_unit("native-sim-x", "/wd", "/ini")
    order = []
    monkeypatch.setattr(os, "kill", lambda pid, sig: order.append(("kill", pid, sig)))
    real_alive, real_stop = host.process_alive, host.stop
    host.process_alive = lambda pid, start: (pid, start) == (4242, 77) or real_alive(pid, start)
    host.stop = lambda name: (order.append(("stop", name)), real_stop(name))
    state = {"test_unit": "native-sim-x", "test_unit_invocation": "inv-crash", "test_instance": [900, 9000],
             "stopped": [{"pid": 4242, "start": 77, "what": "gateway"}, {"pid": 4343, "start": 88, "what": "A2"}]}
    assert rl.end_test_resources(host, state) == []
    assert order == [("kill", 4242, signal.SIGCONT), ("stop", "native-sim-x")]
    assert [c["outcome"] for c in state["continued"]] == ["continued", "gone or another process — no signal"]
    assert state["stopped"] == []


@pytest.mark.parametrize("before, edge, clear, latched, complete, inst_a, inst_b, ok", [
    (None, 30, True, 730, True, [100, 5000], [100, 5000], True),
    ({"ts": 1}, 30, True, 730, True, [100, 5000], [100, 5000], False),   # a trip waited before: never acknowledged
    (None, None, None, None, True, [100, 5000], [100, 5000], False),    # no own edge
    (None, 30, False, 730, True, [100, 5000], [100, 5000], False),      # fault-out not FALSE before (R317 FI-I46)
    (None, 30, True, None, True, [100, 5000], [100, 5000], False),      # no own transition to TRUE
    (None, 30, True, 730, False, [100, 5000], [100, 5000], False),      # an incomplete section (R318 FI-I46)
    (None, 30, True, 730, True, [100, 5000], [101, 5001], False),       # another instance
])
def test_only_the_runs_own_trip_may_be_acknowledged(before, edge, clear, latched, complete, inst_a, inst_b, ok):
    assert (tp.own_trip(before, edge, clear, latched, complete, inst_a, inst_b) is None) is ok


class LatchClient(FrameClient):
    """The latch step against a scripted gateway: after the gateway is
    continued, frames with the waiting trip; estop_reset refused while it
    waits (or `early_reset`: accepted); the acknowledgement clears it."""

    def __init__(self, early_reset=False, trip_before=None):
        super().__init__([(time.monotonic(), {**_IDLE, "is_estop": True, "is_enabled": False})])
        self.trip_history = [(time.monotonic(), trip_before)]
        self.safety_trip, self.early_reset, self.acked = trip_before, early_reset, False

    def frame(self, **st):
        t = time.monotonic()
        self.frames.append((t, {**self.status, **st}))
        trip = None if self.acked else {"ts": 1}
        self.trip_history.append((t, trip))
        self.safety_trip = trip

    def request(self, cmd, **kw):
        from test_support.live_session import Refused as SessionRefused
        self.sent.append((cmd, kw))
        if cmd == "estop_reset":
            if not self.acked and not self.early_reset:
                raise SessionRefused("Safety trip not acknowledged — press Acknowledge")
            self.frame(is_estop=False)
        elif cmd == "safety_trip_ack":
            self.acked = True
            self.frame()
        elif cmd == "machine_on":
            self.frame(is_enabled=True)
        return {"ok": True}


def _latch_step(tmp_path, monkeypatch, client, sections, own_instance=True):
    from test_support import system_host as sh_mod
    stops = []

    class Host:
        n = 0

        def unit_instance(self, unit):
            Host.n += 1
            return ("linuxcncsvr", 100, 5000) if own_instance or Host.n == 1 else ("linuxcncsvr", 101, 5001)
    monkeypatch.setattr(sh_mod, "SystemHost", Host)
    monkeypatch.setattr(nr, "_gateway_pid", lambda ctx: 4242)
    monkeypatch.setattr(nr, "LATCH_STOP_S", 0.0)
    monkeypatch.setattr(nr, "LATCH_POST_S", 0.0)
    monkeypatch.setattr(nr, "RECOVERY_POST_S", 0.0)

    def stop(state, save, pid, what, **kw):
        stops.append(("stop", pid))
        rec = {"pid": pid, "start": 1, "what": what}
        state.setdefault("stopped", []).append(rec)
        return rec

    def cont(state, save, rec, **kw):
        stops.append(("cont", rec["pid"]))
        state["stopped"] = []
        import threading
        threading.Timer(0.02, client.frame).start()   # the gateway answers again, after the continue
        return "continued"
    monkeypatch.setattr(tp, "stop", stop)
    monkeypatch.setattr(tp, "cont", cont)
    ctx = {"client": client, "frames": client.frames, "report": {}, "run": tmp_path,
           "state": {"test_unit": "native-sim-x"}, "servo": FakeMeasurement(sections)}
    return ctx, stops


def test_the_whole_latch_step_proves_the_trip_and_recovers(tmp_path, monkeypatch):
    c = LatchClient()
    ctx, stops = _latch_step(tmp_path, monkeypatch, c, [_latch(after=200), _recovery()])
    by = {r["case"]: r for r in nr.latch_cases()[1](ctx)}
    assert {k: r["status"] for k, r in by.items()} == {"latch-same-cycle": "PASS", "latch-sticky": "PASS",
                                                      "latch-recovered": "PASS"}, by
    assert stops == [("stop", 4242), ("cont", 4242)]
    cmds = [cmd for cmd, _ in c.sent]
    # the early reset is asked (and refused) BEFORE the acknowledgement; the recovery's order
    assert cmds == ["estop_reset", "safety_trip_ack", "arm", "estop_reset", "machine_on"], cmds


def test_the_latch_step_never_acknowledges_a_trip_it_cannot_prove_its_own(tmp_path, monkeypatch):
    c = LatchClient()
    ctx, _ = _latch_step(tmp_path, monkeypatch, c, [_latch(after=200), _recovery()], own_instance=False)
    with pytest.raises(nr.StepFailed, match="not proven the run's own"):
        nr.latch_cases()[1](ctx)
    assert "safety_trip_ack" not in [cmd for cmd, _ in c.sent]
    c2 = LatchClient(trip_before={"ts": 0})
    ctx2, stops2 = _latch_step(tmp_path, monkeypatch, c2, [_latch(), _recovery()])
    with pytest.raises(nr.Refused, match="never acknowledged"):
        nr.latch_cases()[1](ctx2)
    assert stops2 == [] and c2.sent == []


def test_the_delayed_variant_is_its_counter_evidence_and_never_production(tmp_path, monkeypatch):
    c = LatchClient()
    ctx, _ = _latch_step(tmp_path, monkeypatch, c, [_latch(after=200, delay=1), _recovery()])
    rows = nr.latch_cases("latch-delayed")[1](ctx)
    assert [(r["case"], r["status"], r.get("variant")) for r in rows] == [
        ("latch-same-cycle.delayed-order", "PASS", "latch-delayed"), ("latch-sticky", "PASS", "latch-delayed"),
        ("latch-recovered", "PASS", "latch-delayed")]
    assert not any(r["case"] == "latch-same-cycle" for r in rows)


def test_an_early_reset_accepted_fails_the_sticky_row(tmp_path, monkeypatch):
    c = LatchClient(early_reset=True)
    ctx, _ = _latch_step(tmp_path, monkeypatch, c, [_latch(after=200), _recovery()])
    by = {r["case"]: r for r in nr.latch_cases()[1](ctx)}
    assert by["latch-sticky"]["status"] == "FAIL" and "accepted" in by["latch-sticky"]["detail"]


def test_the_delayed_order_is_moved_through_the_gate_and_read_back():
    order = ["motion-command-handler", "motion-controller", "oneshot.0", "webui-hb-latch", "and2.0", "sampler.0"]
    log = []

    def run(argv):
        log.append(argv[1:])
        verb = argv[1]
        if verb == "delf":
            order.remove(argv[2])
        if verb == "addf":
            order.insert(int(argv[4]) - 1, argv[2])
        if verb == "show":
            return "Realtime Threads:\n     Period  FP     Name\n   1000000  YES  servo-thread\n" + \
                "".join(f"                  {i + 1} {f}\n" for i, f in enumerate(order))
        return ""
    ctx = {"servo": type("M", (), {"gate": sv.HalGate(run=run)})(), "report": {}}
    nr.latch_order()[1](ctx)
    after = ctx["report"]["latch_order"]["after"]
    assert after.index("webui-hb-latch") < after.index("oneshot.0") and after[-1] == "sampler.0"
    assert ["delf", "webui-hb-latch", "servo-thread"] in log and ["addf", "webui-hb-latch", "servo-thread", "3"] in log


SHM_HEAD = "       key      shmid perms                  size  cpid  lpid nattch   uid   gid  cuid  cgid\n"


def _shm(*rows):
    return SHM_HEAD + "".join(f"{k} {i} 600 {sz} {cp} 0 {na} 1000 1000 1000 1000\n" for k, i, sz, cp, na in rows)


def test_a_left_over_stream_segment_is_removed_before_the_sampler_loads():
    """2026-11-06: an earlier run's sampler.0 segment (5 243 008 bytes, nattch 0)
    made step 3's wider loadrt fail; the setup removes it — and only it."""
    table = [_shm((sv.STREAM_KEY, 622636, 5243008, 1640832, 0), (1212238898, 884737, 1048576, 2311749, 8))]
    removed = []

    def remove(shmid):
        removed.append(shmid)
        table[0] = _shm((1212238898, 884737, 1048576, 2311749, 8))
    got = sv.clear_stale_stream(read=lambda: table[0], remove=remove)
    assert removed == [622636] and got == {"shmid": 622636, "size": 5243008, "cpid": 1640832, "nattch": 0,
                                           "removed": True}
    assert sv.clear_stale_stream(read=lambda: table[0], remove=remove) is None and removed == [622636]


def test_an_attached_stream_segment_is_another_sampler_and_refused():
    with pytest.raises(RuntimeError, match="another sampler"):
        sv.clear_stale_stream(read=lambda: _shm((sv.STREAM_KEY, 7, 5243008, 1, 1)), remove=lambda shmid: None)
    with pytest.raises(RuntimeError, match="not removed"):
        sv.clear_stale_stream(read=lambda: _shm((sv.STREAM_KEY, 7, 5243008, 1, 0)), remove=lambda shmid: None)


def test_the_run_unloads_its_sampler_at_its_end():
    calls = []

    class Reader:
        def stop(self):
            calls.append("reader.stop")

    class Client:
        def close(self, strict=False):
            calls.append("client.close")
    gate = sv.HalGate(run=lambda argv: calls.append(argv[1:]) or "")
    ctx = {"servo_reader": Reader(), "servo": type("M", (), {"gate": gate})(), "client": Client(), "report": {}}
    nr._stop_copy(ctx)
    assert calls == ["reader.stop", ["unloadrt", "sampler"], "client.close"] and ctx["report"]["servo_unload"] == \
        "unloaded"


def test_the_acknowledgements_reply_without_a_cmd_is_its_own():
    """Live 2026-11-06: the gateway answers safety_trip_ack in its reader with
    {"type": "reply", "ok": true} — no cmd; the client waited 30 s for it."""
    from test_support.live_session import SimulatorClient
    c = SimulatorClient("t", auto_confirm=False)
    c.send = lambda command: c.replies.put({"type": "reply", "ok": True})
    assert c.request("safety_trip_ack") == {"type": "reply", "ok": True}


W_MARK = -101


def _disc(n_before=500, n_w=2600, stop_at=None, creep=False, reverse_at=None, trip_at=None, problems=()):
    """A program moving X at 100 mm/s (0.1 mm per 1 ms sample) on line 4;
    the mark W from sample n_before. `stop_at` (index in W): from there line
    0 and no motion (an abort); `creep`: 0.001 mm per sample on line 4;
    `reverse_at`: the direction turns there (a regular halt, still line 4)."""
    rows, recv, x, c = [], {}, 100.0, 10_000 * MS
    for k in range(n_before + n_w):
        w = k - n_before
        stopped = stop_at is not None and w >= stop_at
        step = 0.0 if stopped else (0.001 if creep and w >= 0 else 0.1)
        if reverse_at is not None and w >= reverse_at:
            step = -step
        x += step
        c += MS
        v = (x, 300.0, 0.0, step * 1000, 0.0, 0.0, 0 if stopped else 4, 0, W_MARK if w >= 0 else 3,
             1, 1 if trip_at is not None and k >= trip_at else 0, k // 100 % 2, MS)
        rows.append((c / 1e9, 1000 + k, v))
        recv[1000 + k] = c + MS
    return {"samples": rows, "problems": list(problems), "phase_first": {W_MARK: n_before}, "recv_ns": recv,
            "t0_ns": 10_000 * MS, "clock": CLOCK_OK}


RUNNING = [(1.0, {"interp_state": 2, "task_mode": 2})] * 3
EVENT = {"tag": "ws.disconnect", "client_id": 7}


@pytest.mark.parametrize("sec, event, frames, status, part", [
    (_disc(), EVENT, RUNNING, "PASS", "ran on"),
    (_disc(reverse_at=1200), EVENT, RUNNING, "PASS", "ran on"),            # a regular reversal in the window
    (_disc(stop_at=0), EVENT, RUNNING, "FAIL", "stopped after the event"),  # aborted exactly at the timeout
    (_disc(stop_at=1500), EVENT, RUNNING, "FAIL", "stopped after the event"),
    (_disc(creep=True), EVENT, RUNNING, "FAIL", "motion ended"),           # line kept, no travel in ≥ 2 s
    (_disc(trip_at=800), EVENT, RUNNING, "FAIL", "a trip"),
    (_disc(), EVENT, [(1.0, {"interp_state": 1, "task_mode": 2})], "FAIL", "saw the program stop"),
    (_disc(), None, RUNNING, "incomplete", "no traced"),                    # no processed timeout / a foreign one
    (_disc(), EVENT, [], "incomplete", "no frame of the remaining client"),
    (_disc(n_w=1500), EVENT, RUNNING, "incomplete", "not proven 2 s"),
    (_disc(problems=["a number gap (1200 → 1202)"]), EVENT, RUNNING, "incomplete", "the section"),
])
def test_the_program_runs_on_after_the_clients_own_event(sec, event, frames, status, part):
    r = sc.eval_disconnect("disconnect-close", sec, W_MARK, event, frames, frozenset(range(1, 9)))
    assert r["status"] == status and part in r["detail"], r


class DiscClient(FrameClient):
    def __init__(self):
        super().__init__([(time.monotonic(), {**_IDLE, "interp_state": 1, "task_mode": 1})])
        self.preview_origin = None

    def run(self):
        self.frames += [(time.monotonic(), {**_IDLE, "interp_state": 2, "task_mode": 2, "inpos": False})] * 2

    def request(self, cmd, **kw):
        self.sent.append((cmd, kw))
        if cmd == "abort":
            self.frames.append((time.monotonic(), {**_IDLE, "interp_state": 1, "task_mode": 2, "inpos": True}))
        return {"ok": True}


def _disc_step(tmp_path, monkeypatch, events=None, sessions=1):
    import hashlib
    c, log, made = DiscClient(), [], []

    class FakeHelper:
        def __init__(self, ctx, session):
            self.session, self.pid = session, 5000 + len(made)
            self.hello = {"op": "hello", "reply": {"type": "reply", "ok": True, "armed": False}}
            made.append(self)

        def request(self, cmd, **kw):
            log.append(("helper", cmd))
            if cmd == "load_file":
                c.preview_origin = {"source": hashlib.sha256(nr.DISC_PROGRAM.encode()).hexdigest()}
            if cmd == "cycle_start":
                c.run()
            return {"armed": True} if cmd == "arm" else {"ok": True}

        when_free = request

        def drop(self):
            log.append(("helper", "drop"))
            return {"op": "dropped"}

        def end(self):
            log.append(("helper", "end"))
            self.proc = None

    FakeHelper.proc = type("P", (), {"poll": lambda self: 0})()
    trace = events if events is not None else {"ws.disconnect": 7, "safety.hb_stall_disarmed": 7}

    def trace_events(ctx, pred):
        out = [{"tag": "session.resume_denied_no_match", "session_id": h.session, "client_id": 7}
               for h in made[-1:] for _ in range(sessions)]
        out += [{"tag": t, "client_id": cid} for t, cid in trace.items()]
        return [e for e in out if pred(e)]

    class Meas(FakeMeasurement):
        def phase(self, attempt, p):
            import threading
            log.append(("phase", p))
            threading.Timer(0.01, c.run).start()      # B keeps receiving frames in the window
            return W_MARK
    monkeypatch.setattr(nr, "Helper", FakeHelper)
    monkeypatch.setattr(nr, "_trace_events", trace_events)
    monkeypatch.setattr(nr, "DISC_WINDOW_S", 0.1)
    monkeypatch.setattr(nr, "DISC_EVENT_S", {"close": 0.2, "heartbeat": 0.2})
    monkeypatch.setattr(tp, "stop", lambda state, save, pid, what, **kw: log.append(("stop", pid)) or
                        {"pid": pid, "start": 1, "what": what})
    monkeypatch.setattr(tp, "cont", lambda state, save, rec, **kw: log.append(("cont", rec["pid"])) or "continued")
    (tmp_path / nr.NC_FILES).mkdir()
    ctx = {"client": c, "frames": c.frames, "report": {}, "run": tmp_path, "config": tmp_path,
           "state": {}, "servo": Meas([_disc(), _disc()]), "clock": CLOCK_OK}
    return ctx, c, log


def test_the_whole_disconnect_step(tmp_path, monkeypatch):
    ctx, c, log = _disc_step(tmp_path, monkeypatch)
    rows = nr.disconnect_cases()[1](ctx)
    assert [(r["case"], r["status"]) for r in rows] == [("disconnect-close", "PASS"), ("disconnect-heartbeat", "PASS")], rows
    # close: the drop, THEN the mark W; heartbeat: the stop, then W, B's abort, then the continue
    assert log.index(("helper", "drop")) < log.index(("phase", 1))
    hb = log[log.index(("stop", 5001)):]
    assert hb[:2] == [("stop", 5001), ("phase", 1)] and ("cont", 5001) in hb
    assert [cmd for cmd, _ in c.sent].count("abort") == 2


def test_no_event_of_this_client_leaves_the_case_open_and_b_still_aborts(tmp_path, monkeypatch):
    ctx, c, log = _disc_step(tmp_path, monkeypatch, events={"ws.disconnect": 99, "safety.hb_stall_disarmed": 99})
    rows = nr.disconnect_cases()[1](ctx)
    assert [r["status"] for r in rows] == ["incomplete", "incomplete"] and ("phase", 1) not in log
    assert [cmd for cmd, _ in c.sent].count("abort") == 2


def test_a_helper_not_bound_to_one_client_starts_nothing(tmp_path, monkeypatch):
    ctx, c, log = _disc_step(tmp_path, monkeypatch, sessions=2)        # two session events: no identity
    rows = nr.disconnect_cases()[1](ctx)
    assert all(r["status"] == "incomplete" and "not bound" in r["detail"] for r in rows)
    assert ("helper", "cycle_start") not in log


W1, W2 = -201, -202


def _hbsec(edges, n=5000, w=(1500, 3500), lps=None, latch_at=None, problems=()):
    """oneshot.0.in toggling at `edges` (sample indices); the window marks at
    w[0] and w[1]; 1 ms periods unless `lps` says otherwise."""
    rows, recv, c, v_in = [], {}, 10_000 * MS, 0
    lps = lps or {}
    for k in range(n):
        if k in edges:
            v_in ^= 1
        lp = lps.get(k, MS)
        c += lp
        mark = 3 if k < w[0] else (W1 if k < w[1] else W2)
        rows.append((c / 1e9, 4000 + k, (0.0,) * 6 + (0, 1, mark, 1, 1 if latch_at is not None and k >= latch_at
                                                                     else 0, v_in, lp)))
        recv[4000 + k] = c + MS
    return {"samples": rows, "problems": list(problems), "phase_first": {W1: w[0], W2: w[1]}, "recv_ns": recv,
            "t0_ns": 10_000 * MS, "clock": CLOCK_OK}


HELLOS = [{"ok": True, "armed": False}] * 4
FETCHES = [{"status": 200, "sha256": "ab", "bytes": 9, "version": 9}] * 4
PUB = {"ok": True, "version": 9}
EVERY_100 = set(range(50, 5000, 100))


@pytest.mark.parametrize("sec, hellos, fetches, status, part", [
    (_hbsec(EVERY_100), HELLOS, FETCHES, "PASS", "the longest"),
    (_hbsec(EVERY_100 - set(range(2050, 2310, 100)) | {2310}), HELLOS, FETCHES, "FAIL", "at least"),   # 260 ms
    # 100 ms between the controller and the sampler at an edge: undecidable, not FAIL
    (_hbsec(set(range(50, 1900, 100)) | {2051} | set(range(2152, 5000, 100)), lps={2052: 101 * MS}),
     HELLOS, FETCHES, "incomplete", "not decided"),
    # an edgeless border over 250 ms at the window's start
    (_hbsec(set(range(50, 1450, 100)) | set(range(1750, 5000, 100))), HELLOS, FETCHES, "FAIL", "at least"),
    (_hbsec(set(range(1600, 5000, 100))), HELLOS, FETCHES, "incomplete", "before the window"),   # no edge in pre
    (_hbsec(EVERY_100, latch_at=2600), HELLOS, FETCHES, "FAIL", "a trip"),
    (_hbsec(EVERY_100), HELLOS[:3], FETCHES, "incomplete", "unarmed connections"),
    (_hbsec(EVERY_100), HELLOS, FETCHES[:3] + [{"status": 503, "sha256": None}], "incomplete", "fetches"),
    (_hbsec(EVERY_100, w=(500, 3500)), HELLOS, FETCHES, "incomplete", "1 s"),                   # pre too short
])
def test_the_heartbeat_keeps_its_edges_while_clients_fetch(sec, hellos, fetches, status, part):
    r = sc.eval_clients("clients-4", sec, W1, W2, 4, hellos, fetches, PUB)
    assert r["status"] == status and part in r["detail"], r


def test_the_whole_clients_step(tmp_path, monkeypatch):
    import hashlib
    from test_support import live_session as ls_mod
    log = []

    class Watch:
        def __init__(self, token, session, auto_confirm=True, **kw):
            self.session = session

        def start(self, arm=True, resume=False):
            log.append(("start", arm))
            self.hello_reply = {"type": "reply", "ok": True, "armed": False, "conn_key": "secret"}

        def drop(self):
            log.append(("drop", self.session))

    class B(FrameClient):
        preview_origin = None

        def request(self, cmd, **kw):
            self.sent.append((cmd, kw))
            log.append(("B", cmd))
            if cmd == "load_file":
                p = Path(kw["path"])
                self.preview_origin = {"file": str(p), "source": hashlib.sha256(p.read_bytes()).hexdigest(),
                                       "version": 9}
            return {"ok": True}

    class Meas(FakeMeasurement):
        def phase(self, attempt, p):
            log.append(("phase", p))
            return {1: W1, 2: W2}[p]
    monkeypatch.setattr(ls_mod, "SimulatorClient", Watch)
    monkeypatch.setattr(nr, "_gen_load", lambda path, mb: path.write_text("G21 G90\nM2\n"))
    monkeypatch.setattr(nr, "_fetch_preview", lambda token, version: log.append(("fetch", version)) or
                        {"status": 200, "bytes": 9, "sha256": "ab", "version": version})
    for k in ("CLIENTS_PRE_S", "CLIENTS_TAIL_S", "CLIENTS_POST_S"):
        monkeypatch.setattr(nr, k, 0.0)
    (tmp_path / nr.NC_FILES).mkdir()
    ini = tmp_path / "m.ini"
    ini.write_text("[DISPLAY]\nWEBUI_TOKEN = t\n")
    c = B([(0.0, dict(_IDLE))])
    ctx = {"client": c, "frames": c.frames, "report": {}, "run": tmp_path, "config": tmp_path, "ini": ini,
           "state": {}, "servo": Meas([_hbsec(EVERY_100), _hbsec(EVERY_100)]), "clock": CLOCK_OK}
    rows = nr.clients_cases()[1](ctx)
    assert [(r["case"], r["status"]) for r in rows] == [("clients-4", "PASS"), ("clients-8", "PASS")], rows
    assert all("conn_key" not in h for r in rows for h in r["hellos"])
    first = log[:log.index(("phase", 2)) + 1]
    assert first[:4] == [("start", False)] * 4 and first[4:6] == [("phase", 1), ("B", "load_file")]
    assert first.count(("fetch", 9)) == 4 and first[-1] == ("phase", 2)
    assert sum(1 for e in log if e[0] == "drop") == 12


def test_the_helper_asks_again_only_while_the_start_claim_is_held(monkeypatch):
    """Live run 20261106T024906: A2's load_file right after B's abort was
    refused 'A program or macro is starting or running — wait'."""
    monkeypatch.setattr(nr, "CLAIM_WAIT_S", 0.5)
    h = nr.Helper.__new__(nr.Helper)
    answers = [nr.Refused("helper load_file: load_file refused: A program or macro is starting or running — wait"),
               {"ok": True}]
    h.request = lambda cmd, **kw: (lambda a: (_ for _ in ()).throw(a) if isinstance(a, Exception) else a)(answers.pop(0))
    assert h.when_free("load_file", path="/p") == {"ok": True} and answers == []
    h.request = lambda cmd, **kw: (_ for _ in ()).throw(nr.Refused("helper load_file: Not armed"))
    with pytest.raises(nr.Refused, match="Not armed"):
        h.when_free("load_file", path="/p")


# ── Codex R317: FI-I45..49 ──

def test_no_period_is_a_time_without_the_clock_read_in_the_run():
    samples, recv, t0 = _timed([MS] * 100)
    for clock in (None, {}, st.clock_contract("0" * 64, st.PACKAGE_VERSION)):
        r = st.proven(samples, recv, t0, clock)
        assert not r["ok"] and ("clock" in r["why"]), r


def test_the_servo_step_reads_the_clock_and_every_section_carries_it(tmp_path, monkeypatch):
    """FI-I45 at the wiring: the run READS the contract; a section gets it —
    an unproven clock leaves the 4- and 8-client rows open."""
    from test_support import servo_time as stime
    reads = []
    bad = st.clock_contract("0" * 64, st.PACKAGE_VERSION)
    monkeypatch.setattr(stime, "read_clock_contract", lambda: reads.append(1) or bad)
    monkeypatch.setattr(sv, "setup", lambda gate, clear=None: {"thread": {"period_ns": 1000000}})

    class Rd:
        def start(self):
            pass
    monkeypatch.setattr(sv, "Reader", Rd)
    ini = tmp_path / "m.ini"
    ini.write_text("[EMCMOT]\nSERVO_PERIOD = 1000000\n")
    ctx = {"ini": ini, "report": {}}
    nr.servo_device()[1](ctx)
    assert reads == [1] and ctx["clock"] is bad and ctx["report"]["clock"] is bad
    box_ctx = {"servo": FakeMeasurement([_hbsec(EVERY_100)]), "clock": bad, "report": {}}
    with nr._section(box_ctx, "clients-4") as box:
        pass
    assert box["section"]["clock"] is bad
    r = sc.eval_clients("clients-4", box["section"], W1, W2, 4, HELLOS, FETCHES, PUB)
    assert r["status"] == "incomplete" and "clock" in r["detail"], r


def _latch_set_before(sec):
    rows = [(t, n, v[:10] + (1,) + v[11:]) for t, n, v in sec["samples"]]
    return {**sec, "samples": rows}


@pytest.mark.parametrize("sec", [_latch_set_before(_latch(after=200)), _latch(after=200, early_at=10)])
def test_a_latch_set_before_the_own_edge_is_never_acknowledged(tmp_path, monkeypatch, sec):
    """FI-I46: no trip reported before, the same instance, the own edge — but
    fault-out was TRUE before it (throughout, or a pulse): S4b FAIL and NO
    recovery command."""
    c = LatchClient()
    ctx, _ = _latch_step(tmp_path, monkeypatch, c, [sec, _recovery()])
    with pytest.raises(nr.StepFailed, match="not FALSE before the own edge"):
        nr.latch_cases()[1](ctx)
    assert [cmd for cmd, _ in c.sent if cmd != "estop_reset"] == []        # only the early, refused reset


@pytest.mark.parametrize("frames, status, part", [
    ([(1.0, {})], "incomplete", "state unknown"),
    ([(1.0, {"interp_state": 2})], "incomplete", "state unknown"),
    ([(1.0, {"task_mode": 2})], "incomplete", "state unknown"),
    ([(1.0, {"interp_state": 3, "task_mode": 2})], "FAIL", "saw the program stop"),     # paused
    ([(1.0, {"interp_state": 2, "task_mode": 3})], "FAIL", "saw the program stop"),     # MDI
])
def test_the_remaining_client_must_show_a_known_running_auto(frames, status, part):
    """FI-I47: a frame missing a field proves nothing about B."""
    r = sc.eval_disconnect("disconnect-close", _disc(), W_MARK, EVENT, frames, frozenset(range(1, 9)))
    assert r["status"] == status and part in r["detail"], r


@pytest.mark.parametrize("fetches", [
    [{"status": 200, "sha256": "ab", "bytes": 9, "version": 8}] * 4,                    # all an older preview
    FETCHES[:3] + [{"status": 200, "sha256": "ab", "bytes": 9, "version": 10}],         # one other
    [{"status": 200, "sha256": "ab", "bytes": 9}] * 4,                                  # no version said
])
def test_every_fetch_must_be_the_published_preview(fetches):
    """FI-I48: `?v=` is a cache-buster; the served X-Preview-Version binds it."""
    r = sc.eval_clients("clients-4", _hbsec(EVERY_100), W1, W2, 4, HELLOS, fetches, PUB)
    assert r["status"] == "incomplete" and "published version" in r["detail"], r


def test_a_fetch_keeps_the_version_the_server_says(monkeypatch):
    import io
    import urllib.request

    class Resp(io.BytesIO):
        status, headers = 200, {"X-Preview-Version": "9"}

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None: Resp(b"preview"))
    assert nr._fetch_preview("t", 9) == {"status": 200, "bytes": 7, "version": 9,
                                         "sha256": __import__("hashlib").sha256(b"preview").hexdigest()}


def test_a_known_failure_comes_before_a_missing_proof():
    """FI-I49: the four R317 forms — each was incomplete."""
    lines = frozenset(range(1, 9))
    r = sc.eval_disconnect("disconnect-close", _disc(trip_at=800), W_MARK, None, RUNNING, lines)
    assert r["status"] == "FAIL" and "trip" in r["detail"], r
    r = sc.eval_disconnect("disconnect-close", {**_disc(), "t0_ns": None}, W_MARK, EVENT,
                           [(1.0, {"interp_state": 1, "task_mode": 2})], lines)
    assert r["status"] == "FAIL" and "saw the program stop" in r["detail"], r
    r = sc.eval_latch_sticky("latch-sticky", {**_latch(release_at=60), "problems": ["the end's integrity not read"]},
                             REFUSED, [{"ts": 1}])
    assert r["status"] == "FAIL" and "released" in r["detail"], r
    r = sc.eval_latch_recovered("latch-recovered", {**_recovery(again_at=30), "problems": ["the end's integrity "
                                                                                           "not read"]},
                                [(None, False, True)])
    assert r["status"] == "FAIL" and "TRUE again" in r["detail"], r
    # …and a time not proven stays open: the R314 case is no FAIL
    samples, recv, t0 = _timed([MS] * 202 + [101 * MS] + [MS] * 200)
    assert st.judge(st.gap_bounds(samples, st.proven(samples, recv, t0, CLOCK_OK), 2, 201)) == "incomplete"


# ── Codex R318: the rests of FI-I46 and FI-I49 ──

def _latch_through_section(hide):
    """R318's probe through servo.section: an early latch pulse at sample 710,
    then the sample missing (a number gap) or carrying a foreign mark."""
    rows = _latch(after=200, early_at=10)["samples"]
    rows = [(t, n, v) for t, n, v in rows if not (hide == "gap" and n == 710)]
    if hide == "foreign":
        rows = [(t, n, v[:8] + (999,) + v[9:]) if n == 710 else (t, n, v) for t, n, v in rows]
    end = rows[-1]
    stream = rows + [(end[0] + 0.001, end[1] + 1, end[2][:8] + (4,) + end[2][9:])]
    return sv.section(stream, start_mark=3, end_mark=4, integrity=_ok())


@pytest.mark.parametrize("hide, problem", [("gap", "number gap"), ("foreign", "foreign mark")])
def test_an_incomplete_outage_section_is_no_ownership_proof(tmp_path, monkeypatch, hide, problem):
    """FI-I46 rest: 'nothing TRUE before' over a section with a hole proves
    nothing — S4b incomplete, and NO recovery command."""
    sec = _latch_through_section(hide)
    assert any(problem in p for p in sec["problems"]), sec["problems"]
    c = LatchClient()
    ctx, _ = _latch_step(tmp_path, monkeypatch, c, [sec, _recovery()])
    with pytest.raises(nr.StepFailed, match="not complete"):
        nr.latch_cases()[1](ctx)
    assert [cmd for cmd, _ in c.sent] == ["estop_reset"]          # only the early, refused reset


def test_the_complete_delayed_variant_still_owns_its_trip(tmp_path, monkeypatch):
    c = LatchClient()
    ctx, _ = _latch_step(tmp_path, monkeypatch, c, [_latch(after=200, delay=1), _recovery()])
    nr.latch_cases("latch-delayed")[1](ctx)
    assert "safety_trip_ack" in [cmd for cmd, _ in c.sent]


def test_a_failure_proven_on_its_own_survives_another_missing_proof():
    """FI-I49 rest A: the R318 forms — each with its control without the extra flaw."""
    gap358 = _hbsec(set(range(50, 2050, 100)) | set(range(2408, 5000, 100)))     # 2050 → 2408: ≥ 356 ms
    old = [{"status": 200, "sha256": "ab", "bytes": 9, "version": 8}] * 4
    for fetches in (FETCHES, old):
        r = sc.eval_clients("clients-4", gap358, W1, W2, 4, HELLOS, fetches, PUB)
        assert r["status"] == "FAIL" and "at least" in r["detail"], r
    flawed = ["the end's integrity not read: overruns"]
    for problems in ([], flawed):
        r = sc.eval_latch_sticky("latch-sticky", {**_latch(), "problems": problems}, REFUSED, [{"ts": 1}, None])
        assert r["status"] == "FAIL" and "no unacknowledged trip" in r["detail"], (problems, r)
        r = sc.eval_latch_recovered("latch-recovered", {**_recovery(), "problems": problems},
                                    [({"ts": 1}, False, True)])
        assert r["status"] == "FAIL" and "not clear" in r["detail"], (problems, r)
    # a heartbeat gap is judged only on a complete section: a hole may hide an edge
    r = sc.eval_clients("clients-4", {**gap358, "problems": ["a number gap (6100 → 6102)"]}, W1, W2, 4, HELLOS,
                        FETCHES, PUB)
    assert r["status"] == "incomplete", r


def test_an_unknown_position_is_no_proven_stop():
    """FI-I49 rest B: line 0 after W with X not finite — neither motion nor a
    stop is known; B still reports AUTO running: incomplete, not FAIL."""
    sec = _disc(stop_at=500)
    rows = [(t, n, (float("nan"),) + v[1:]) if k >= 500 + 500 else (t, n, v) for k, (t, n, v) in enumerate(sec["samples"])]
    sec = {**sec, "samples": rows, "problems": ["a non-finite channel value"]}
    r = sc.eval_disconnect("disconnect-close", sec, W_MARK, EVENT, RUNNING, frozenset(range(1, 9)))
    assert r["status"] == "incomplete", r
    # the control: the same stop with X seen standing is a FAIL
    r = sc.eval_disconnect("disconnect-close", _disc(stop_at=500), W_MARK, EVENT, RUNNING, frozenset(range(1, 9)))
    assert r["status"] == "FAIL" and "stopped" in r["detail"], r


# ── Package G2 (Codex R326): the workpiece, the scan, the compensation ─────

def test_the_plate_is_instance_0_and_a_second_declaration_is_refused():
    """Instance 1 (the workpiece) declares plate-x/-y too: the last match used
    to win — the plate would have been read at X550 Y550."""
    hal = ("setp sim-toolsetter.0.plate-x 10\nsetp sim-toolsetter.0.plate-y 10\nsetp sim-toolsetter.0.plate-z -180\n"
           "setp sim-toolsetter.1.plate-x 550\nsetp sim-toolsetter.1.plate-y 550\n")
    assert nr.plate_from_hal([hal]) == {"x": 10.0, "y": 10.0, "z": -180.0}
    with pytest.raises(nr.Refused, match="more than once"):
        nr.plate_from_hal([hal, "setp sim-toolsetter.0.plate-x 11\n"])


def _ideal_points():
    return [[x, y, nc.surface_z(x, y) - nc.SURFACE_BASE] for x, y in nc.scan_order()]


def test_the_scan_is_the_grid_in_its_snake_on_the_surface():
    pts = _ideal_points()
    assert nc.eval_surface_scan("s", pts)["status"] == "PASS"
    assert [tuple(p[:2]) for p in pts[:6]] == [(518, 518), (534, 518), (550, 518), (566, 518), (582, 518),
                                                (582, 534)], "row 2 runs back"
    near = [[x, y, z + 0.004] for x, y, z in pts]
    assert nc.eval_surface_scan("s", near)["status"] == "PASS"
    bad = {
        "a point missing": pts[:-1],
        "a point added": pts + [pts[-1]],
        "not snaked": [[x, y, nc.surface_z(x, y) - nc.SURFACE_BASE] for y in nc.SCAN_AXIS for x in nc.SCAN_AXIS],
        "off the surface": [p if i != 12 else [p[0], p[1], p[2] + 0.006] for i, p in enumerate(pts)],
        "a word no number": [p if i != 3 else [p[0], None, p[2]] for i, p in enumerate(pts)],
        "X/Y swapped": [[y, x, z] for x, y, z in pts],
    }
    for name, points in bad.items():
        assert nc.eval_surface_scan("s", points)["status"] == "FAIL", name
    assert nc.eval_surface_scan("s", pts, errors=[(11, "Probe tripped during non-probe move")])["status"] == "FAIL"
    assert nc.eval_surface_scan("s", None)["status"] == "incomplete"


def test_the_scan_counters_refuse_their_plants():
    pts = _ideal_points()
    base = nc.eval_surface_scan("s", pts)
    node = nc.eval_surface_scan("s", pts, expect=lambda x, y: nc.surface_z(x, y) + (1.0 if (x, y) == nr.COMP_A else 0))
    swap = nc.eval_surface_scan("s", pts, expect=lambda x, y: nc.surface_z(y, x))
    assert nc.counter("c1", node, base)["status"] == "PASS" and nc.counter("c2", swap, base)["status"] == "PASS"


def test_the_map_reload_needs_the_version_to_advance():
    assert nc.eval_map_reload("m", 3, 4)["status"] == "PASS"
    assert nc.eval_map_reload("m", 3, 3)["status"] == "FAIL"
    assert nc.eval_map_reload("m", None, 4)["status"] == "incomplete"


def test_the_reference_follows_compensations_path_from_the_recorded_points():
    """The values Codex R326 computed independently (scipy 1.15.3): at Q the
    three methods 4.5856 / 4.9392 / 5.0701, the surface 5.0544."""
    refs = {m: nc.comp_reference(_ideal_points(), m, nr.COMP_Q) for m in nc.METHODS}
    assert refs["nearest"] == pytest.approx(4.5856, abs=1e-4)
    assert refs["linear"] == pytest.approx(4.9392, abs=1e-4)
    assert refs["cubic"] == pytest.approx(5.0701, abs=1e-4)
    assert nc.surface_z(*nr.COMP_Q) - nc.SURFACE_BASE == pytest.approx(5.0544, abs=1e-4)
    # the 1-mm node: a point off the grid takes its nearest node's value
    assert nc.comp_reference(_ideal_points(), "linear", (538.3, 549.8)) == pytest.approx(refs["linear"])


def _reading(e, method="cubic", enabled=True, z_control=-113.0, at=None, **kw):
    at = at or nr.COMP_Q
    return {"settled": True, "eoffset": e, "x": at[0], "y": at[1], "joint_z": z_control + e, "enabled": enabled,
            "method": nc.METHODS.index(method), "version": 4, "limited": False, **kw}


def _method_case(method, e, **kw):
    pts = _ideal_points()
    refs = {m: nc.comp_reference(pts, m, nr.COMP_Q) for m in nc.METHODS}
    recorded = {"near": nc.point_z(pts, *nr.COMP_EDGE[0]), "far": nc.point_z(pts, *nr.COMP_EDGE[1])}
    f_dev = nc.surface_z(*nr.COMP_Q) - nc.SURFACE_BASE
    reading = kw.pop("reading", None) or _reading(e, method)
    return nc.eval_comp_method("c", method, reading, kw.pop("refs", refs), recorded, f_dev, -113.0, nr.COMP_Q)


def test_each_method_is_its_reference_and_the_independent_checks_hold():
    truncated = {"nearest": 4.585, "linear": 4.939, "cubic": 5.070}
    for m, e in truncated.items():
        assert _method_case(m, e)["status"] == "PASS", m
    # another method's value, or the analytic surface for cubic (Codex R326:
    # it passes both inequalities and misses the reference by 0.0157)
    assert _method_case("cubic", 4.939)["status"] == "FAIL"
    assert _method_case("linear", 4.585)["status"] == "FAIL"
    assert _method_case("cubic", 5.0544)["status"] == "FAIL"
    # the joint Z does not carry the offset
    assert _method_case("cubic", 5.070, reading={**_reading(5.070), "joint_z": -113.0})["status"] == "FAIL"


def test_a_wrong_reference_is_caught_by_the_independent_checks():
    """scipy's value planted wrong for nearest and linear: the recorded nodes
    (the nearer one; 0.75/0.25 on the edge) still refuse it."""
    pts = _ideal_points()
    refs = {m: nc.comp_reference(pts, m, nr.COMP_Q) for m in nc.METHODS}
    assert _method_case("nearest", 4.700, refs={**refs, "nearest": 4.700})["status"] == "FAIL"
    assert _method_case("linear", 5.000, refs={**refs, "linear": 5.000})["status"] == "FAIL"
    assert _method_case("cubic", 4.960, refs={**refs, "cubic": 4.960})["status"] == "FAIL", "within 0.05 of linear"
    # a cubic reference that is its own value and far from linear, but farther
    # from the surface than linear: the curvature check alone refuses it
    assert _method_case("cubic", 4.800, refs={**refs, "cubic": 4.800})["status"] == "FAIL", "not closer than linear"


def test_a_reading_that_is_not_one_is_incomplete_and_a_point_that_tells_nothing_too():
    for reading in ({"settled": False, "why": "frames stopped"}, {**_reading(5.070), "method": 1},
                    {**_reading(5.070), "enabled": None}, {**_reading(5.070), "limited": True},
                    {**_reading(5.070), "eoffset": None}):
        assert _method_case("cubic", 5.070, reading=reading)["status"] == "incomplete", reading
    flat = {m: 4.939 for m in nc.METHODS}
    assert _method_case("linear", 4.939, refs=flat)["status"] == "incomplete"


def test_on_off_and_after_the_move_the_tip_keeps_its_distance():
    z_a = nc.surface_z(*nr.COMP_A) - nc.SURFACE_BASE
    z_b = nc.surface_z(*nr.COMP_B) - nc.SURFACE_BASE
    gap_off_a = nr.COMP_Z - z_a
    A, B = nr.COMP_A, nr.COMP_B
    on = nc.eval_comp_reading("o", _reading(6.0, at=A), True, z_a, 12.0, -113.0, 50.0, A)
    off = nc.eval_comp_reading("o", _reading(0.0, enabled=False, at=A), False, z_a, gap_off_a, -113.0, 50.0, A)
    assert on["status"] == "PASS" and off["status"] == "PASS" and on["gap_mm"] == pytest.approx(12.0)
    assert off["gap_mm"] == pytest.approx(6.0)
    assert nc.eval_comp_pair("o", on, off)["status"] == "PASS"
    # off with the offset left in, on 0.05 short, frozen at A after the move to B
    assert nc.eval_comp_reading("o", _reading(0.003, enabled=False, at=A), False, z_a, gap_off_a, -113.0, 50.0,
                                A)["status"] == "FAIL"
    assert nc.eval_comp_reading("o", _reading(6.0, at=A), True, z_a, 12.05, -113.0, 50.0, A)["status"] == "FAIL"
    b_on = _reading(round(z_b, 3), at=B)
    assert nc.eval_comp_reading("b", b_on, True, z_b, 12.0, -113.0, 50.0, B)["status"] == "PASS"
    assert nc.eval_comp_reading("b", b_on, True, z_a, 12.0, -113.0, 50.0, B)["status"] == "FAIL"
    assert nc.eval_comp_reading("b", _reading(6.0, at=B), True, z_b, 12.0, -113.0, 50.0, B)["status"] == "FAIL", \
        "the offset frozen at A's value: the tip 7.475 mm too high at B"


def test_a_pair_reports_a_contradiction_before_a_missing_reading():
    p, f, i = ({"case": "x", "status": s, "detail": s} for s in ("PASS", "FAIL", "incomplete"))
    assert nc.eval_comp_pair("x", i, f)["status"] == "FAIL"
    assert nc.eval_comp_pair("x", p, i)["status"] == "incomplete"
    assert nc.eval_comp_pair("x", p, p)["status"] == "PASS"


def _settle_frames(n=20, dt=0.033, e=5.07, z=-107.93, v=4, **over):
    return [(k * dt, {"eoffset_z": e, "joint_pos": [538.0, 550.0, z], "comp_grid_version": v,
                      "eoffset_enabled": True, **over}) for k in range(n)]


def test_a_settled_window_needs_fresh_quiet_frames_for_half_a_second():
    on = lambda st: st.get("eoffset_enabled") is True  # noqa: E731
    assert nc.settled_window(_settle_frames(), on) is not None
    assert nc.settled_window(_settle_frames(n=10), on) is None, "0.3 s of frames is no window"
    gap = _settle_frames()
    gap = gap[:5] + [(t + 0.5, st) for t, st in gap[5:]]
    assert nc.settled_window(gap[:8], on) is None, "a 0.5 s gap inside the window"
    drift = [(t, {**st, "eoffset_z": 5.07 - 0.001 * k}) for k, (t, st) in enumerate(_settle_frames())]
    assert nc.settled_window(drift, on) is None, "the offset still ramps"
    bumped = _settle_frames()
    bumped[-3] = (bumped[-3][0], {**bumped[-3][1], "comp_grid_version": 5})
    assert nc.settled_window(bumped, on) is None, "the map changed inside the window"
    assert nc.settled_window(_settle_frames(eoffset_enabled=False), on) is None
    assert nc.settled_window(_settle_frames(e=None), on) is None


_SHOW_SIG = """Signals:
Type          Value  Name     (linked to)
float      75.76577  sim-ts-x
                         <== joint.0.pos-fb
                         ==> sim-toolsetter.0.x
bit           FALSE  probe-in
                         ==> sim-toolsetter.0.manual
"""


def test_the_signals_parse_with_their_writer_and_readers():
    sigs = nr.parse_signals(_SHOW_SIG)
    assert sigs == {"sim-ts-x": {"writers": ["joint.0.pos-fb"], "readers": ["sim-toolsetter.0.x"]},
                    "probe-in": {"writers": [], "readers": ["sim-toolsetter.0.manual"]}}


def _good_fixture():
    sigs = {s: {"writers": [w] if w else [], "readers": sorted(r)} for s, (w, r) in nr.surface_wiring().items()}
    functions = ["motion-command-handler", "motion-controller", "ddt_x", *nr.SURFACE_CHAIN, "sim-toolsetter.1",
                 "sim-toolsetter.0", "limit_speed"]
    values = {**{k: float(v) for k, v in nr.surface_constants().items()}, "sim-toolsetter.1.tool-length": 50.0,
              "sim-toolsetter.1.enable": True, "compensation.fade-height": 0.0}
    return sigs, functions, values


def test_the_fixture_check_reads_wiring_order_and_constants():
    sigs, functions, values = _good_fixture()
    assert nr.surface_fixture_problems(sigs, functions, values, 50.0) == []
    defects = {
        "plate-z set, not wired": ({**sigs, "surf-height": {"writers": ["surf-z.out"], "readers": []}}, functions, values),
        "another writer": ({**sigs, "sim-ts-x": {**sigs["sim-ts-x"], "writers": ["joint.0.motor-pos-fb"]}},
                           functions, values),
        "probe-in written": ({**sigs, "probe-in": {"writers": ["qtpyvcp.probe-in.out"],
                                                   "readers": ["sim-toolsetter.1.manual"]}}, functions, values),
        "the pass-through missing": ({k: v for k, v in sigs.items() if k != "sim-ts-pass"}, functions, values),
        "instance 0 before 1": (sigs, [f for f in functions if f != "sim-toolsetter.1"][:-1]
                                + ["sim-toolsetter.1", "limit_speed"], values),
        "the chain after instance 1": (sigs, ["motion-controller", "sim-toolsetter.1", *nr.SURFACE_CHAIN,
                                              "sim-toolsetter.0"], values),
        "the chain before the motion controller": (sigs, [*nr.SURFACE_CHAIN, "motion-controller", "sim-toolsetter.1",
                                                          "sim-toolsetter.0"], values),
        "a step missing": (sigs, [f for f in functions if f != "surf-curve"], values),
        "a constant off": (sigs, functions, {**values, "surf-curve.gain1": -0.0025}),
        "the length not the probe's": (sigs, functions, {**values, "sim-toolsetter.1.tool-length": 40.0}),
        "not enabled": (sigs, functions, {**values, "sim-toolsetter.1.enable": False}),
        "a fade": (sigs, functions, {**values, "compensation.fade-height": 5.0}),
        "a value not read": (sigs, functions, {**values, "surf-z.offset": None}),
    }
    for name, (s, f, v) in defects.items():
        assert nr.surface_fixture_problems(s, f, v, 50.0), name


def test_the_constants_are_the_literal_surface():
    """f from the chain's constants = nc.surface_z at the window's corners and centre."""
    k = nr.surface_constants()
    for x, y in ((510, 510), (550, 550), (590, 510), (538, 566)):
        dx, dy = x + k["surf-dx.offset"], y + k["surf-dy.offset"]
        tilt = k["surf-tilt.gain0"] * dx + k["surf-tilt.gain1"] * dy + k["surf-tilt.offset"]
        curve = k["surf-curve.gain0"] * dx * dx + k["surf-curve.gain1"] * dy * dy + k["surf-curve.offset"]
        assert tilt + curve + k["surf-z.offset"] == pytest.approx(nc.surface_z(x, y))


def test_the_scan_releases_the_override_only_after_its_return():
    """Codex R326 FI326-01 on the REAL evaluator: the routine freed the
    override before its last two moves (LOGCLOSE → M50 P1 → G53 Z0 → X/Y) —
    free while the axis moves is a FAIL; freed after the return, it passes."""
    def course(release_during_return):
        frames = [(0.0, {**_IDLE, "feed_override_enabled": True, "current_vel": 0.0})]
        t = 0.0
        for k in range(20):                         # probing, locked
            t += 0.05
            frames.append((t, {**_IDLE, "interp_state": 2, "feed_override_enabled": False, "current_vel": 20.0,
                               "inpos": False}))
        for k in range(6):                          # the return: G53 Z0, then X/Y
            t += 0.05
            frames.append((t, {**_IDLE, "interp_state": 2, "feed_override_enabled": release_during_return,
                               "current_vel": 80.0, "inpos": False}))
        t += 0.05
        frames.append((t, {**_IDLE, "feed_override_enabled": True, "current_vel": 0.0}))
        frames += [(t + 0.1 * k, {**_IDLE, "feed_override_enabled": True, "current_vel": 0.0}) for k in range(1, 25)]
        return frames
    assert nc.eval_override_lock("x", course(True), 0.0)["status"] == "FAIL"
    assert nc.eval_override_lock("x", course(False), 0.0)["status"] == "PASS"


def test_the_shipped_scan_frees_the_override_after_its_last_move():
    """The routine's text: M50 P1 after the last motion line, before DONE."""
    lines = [ln.split(";")[0].strip() for ln in
             (HERE.parent / "subroutines/surfacemap/surface_scan.ngc").read_text().splitlines()]
    code = [ln for ln in lines if ln]
    release = max(i for i, ln in enumerate(code) if ln.startswith("M50 P1"))
    done = next(i for i, ln in enumerate(code) if "LCNC_SURFACE_SCAN_DONE" in ln)
    moves = [i for i, ln in enumerate(code) if ln.startswith(("G0", "G1", "G38"))]
    assert max(moves) < release < done, (code[max(moves)], code[release])
    assert sum(ln.startswith("M50 P1") for ln in code) == 1


class SurfaceSim:
    """The surface step's counterpart offline: a client whose status follows
    the commands — the scan writes its file and reloads the map, the
    compensation applies compensation.py's value at the X/Y (the reference
    path, counts truncated) with a ramp-free settle. `defect` plants one
    wrong behaviour; every request brings 0.66 s of frames."""

    def __init__(self, config: Path, defect=None):
        self.config, self.defect = config, defect
        self._frames, self.errors, self.error, self.sent = [], [], None, []
        self.t, self.xy, self.on, self.method, self.version = 0.0, (518.0, 518.0), False, 2, 1
        self.zj, self.moves = 0.0, []            # the control point's joint Z (G53 Z0 after the scan)
        self.g54_z, self.free, self.points, self.e = 0.0, True, None, 0.0
        self.enables = self.offs = 0
        self.tick()

    @property
    def frames(self):
        """The frames received so far — each look brings the next one, as the
        status stream of a real client keeps arriving."""
        self.tick(6)
        return self._frames

    @property
    def status(self):
        return dict(self._frames[-1][1])

    def _e(self):
        if not self.on or self.points is None:
            return 0.0
        m = 2 if self.defect == "method ignored" else self.method
        v = nc.comp_reference(self.points, nc.METHODS[m], self.xy)
        return math.trunc(v / 0.001) * 0.001

    def tick(self, n=20, **over):
        g54_x = 5.0 if self.defect == "g54 x" else 0.0
        st = {**_IDLE, "g5x_index": 1, "g5x_offset": [g54_x, 0.0, self.g54_z], "g92_offset": [0.0, 0.0, 0.0],
              "rotation_xy": 0.0, "tool_offset": [0.0, 0.0, 50.0], "tool_number": 99, "eoffset_z": self.e,
              "eoffset_enabled": self.on, "comp_method": self.method,
              "comp_grid_version": None if (self.defect == "missing version" and self.on) else self.version,
              "joint_pos": [self.xy[0], self.xy[1], self.zj + self.e], "feed_override_enabled": self.free,
              "current_vel": 0.0, **over}
        for _ in range(n):
            self.t += 0.033
            self._frames.append((self.t, dict(st)))

    def request(self, cmd, **kw):
        self.sent.append((cmd, kw))
        if cmd == "set_compensation":
            self.enables += kw["enable"] is True
            self.offs += kw["enable"] is False
            # the 5th enable is the one before the move (3 methods, ON/OFF at
            # A); the 1st off drains after nearest — each defect ignores its one
            ignored = (self.defect == "late enable" and kw["enable"] is True and self.enables == 5) or \
                      (self.defect == "no drain" and kw["enable"] is False and self.offs == 1)
            if not ignored:
                self.on = kw["enable"]
                self.e = self._e()
        elif cmd == "set_compensation_method":
            self.method, self.version = kw["method"], self.version + 1
            self.e = self._e()
        self.tick()
        return {"ok": True}

    def routine(self, text):
        t0 = self.t
        if text == "O<surface_scan> CALL":
            pts = [[x, y, nc.surface_z(x, y) - nc.SURFACE_BASE + (1.0 if self.defect == "scan off" and (x, y)
                                                                 == nr.COMP_A else 0.0)] for x, y in nc.scan_order()]
            (self.config / nr.SCAN_FILE).write_text("".join(f"{x:g} {y:g} {z:.6f}\n" for x, y, z in pts))
            self.tick(2)
            self.free = False
            self.tick(30, interp_state=2, current_vel=20.0, inpos=False)
            self.free = self.defect == "early release"
            self.tick(6, interp_state=2, current_vel=80.0, inpos=False)
            self.free = True
            self.points = pts
            self.version += 0 if self.defect == "no reload" else 1
            self.xy, self.zj = (518.0, 518.0), 0.0       # the routine's return: G53 Z0, then X0 Y0 of its grid
        elif text.startswith("G1 ") and self.defect == "move refused":
            raise RuntimeError(f"{text}: refused")
        elif text.startswith(("G0 ", "G1 ")):
            # a block that goes nowhere never shows busy: its end is never seen
            words = dict((w[0], float(w[1:])) for w in text.split()[1:])
            to_xy = (words.get("X", self.xy[0]), words.get("Y", self.xy[1]))
            to_z = -175.0 + 50.0 + words["Z"] if "Z" in words else self.zj
            if to_xy == self.xy and abs(to_z - self.zj) < 1e-9:
                raise RuntimeError(f"{text}: no travel — not done within 60.0 s")
            self.moves.append(text)
            keep = self.e
            self.xy, self.zj = to_xy, to_z
            if self.defect == "wrong arrival" and text.startswith("G1"):
                self.xy = (to_xy[0], to_xy[1] + 0.4)     # Codex R327: 0.4 mm past Y, the 1-mm map value unchanged
            self.e = keep if (self.defect == "frozen" and text.startswith("G1")) else self._e()
        self.tick()
        return {"t0": t0, "t_done": self.t, "errors": [], "served": []}


def _surface_step(monkeypatch, tmp_path, defect=None):
    sim = SurfaceSim(tmp_path, defect)

    def short(c, text):
        if text.startswith("G10 L2 P1"):
            sim.g54_z = float(text.split("Z")[1].split()[0])
        if text == "M50 P1":
            sim.free = True
        sim.tick(2)
    for name, fn in {"_probe_tool": lambda c: None, "_set_tool_length": lambda c, t, l: None, "_short": short,
                     "_routine": lambda c, text, **kw: sim.routine(text), "_vars": lambda c, nums: {3014: 99.0},
                     "_surface_fixture": lambda ctx, length: {}, "_limited": lambda ctx: False,
                     "_comp_python_versions": lambda ctx: {}}.items():
        monkeypatch.setattr(nr, name, fn)
    monkeypatch.setattr(nr, "SETTLE_DEADLINE", 2.0)
    monkeypatch.setattr(nr, "MAP_RELOAD_S", 1.0)
    ctx = {"client": sim, "frames": sim._frames, "config": tmp_path, "report": {}, "rows": []}
    try:
        rows = nr.surface_cases()[1](ctx)
        error = None
    except nr.StepFailed as e:
        rows, error = e.rows, str(e)
    return {r["case"]: r for r in rows}, ctx, sim, error


def test_the_surface_step_passes_on_a_sim_that_does_what_it_should(monkeypatch, tmp_path):
    by, ctx, sim, error = _surface_step(monkeypatch, tmp_path)
    assert error is None
    assert sorted(by) == sorted(["surface-scan", "surface-scan.counter-node+1", "surface-scan.counter-xy-swapped",
                                 "surface-override-lock", "surface-scan.map", "comp-nearest",
                                 "comp-nearest.counter-linear", "comp-linear", "comp-linear.counter-cubic",
                                 "comp-cubic", "comp-cubic.counter-nearest", "comp-on-off",
                                 "comp-on-off.counter-gap+0.05", "comp-after-xy", "comp-after-xy.counter-frozen"])
    assert all(r["status"] == "PASS" for r in by.values()), {k: r["detail"] for k, r in by.items()
                                                             if r["status"] != "PASS"}
    # every method switch a change, the start method (cubic) last and restored
    methods = [kw["method"] for cmd, kw in sim.sent if cmd == "set_compensation_method"]
    assert methods == [0, 1, 2]
    # from the scan's end (G53 Z0) down to Z12 once, then X/Y only
    assert sim.moves == ["G0 Z12", "G0 X538 Y550", "G0 X550 Y550", "G1 X518 Y582 F1000"], sim.moves
    after = ctx["report"]["surface_cleanup"]["after"]
    assert after["eoffset_enabled"] is False and after["comp_method"] == 2 and after["g54_z"] == 0.0


def test_the_surface_step_names_each_planted_defect(monkeypatch, tmp_path):
    cases = {"method ignored": ("comp-nearest", "FAIL"), "frozen": ("comp-after-xy", "FAIL"),
             "no reload": ("surface-scan.map", "FAIL"), "early release": ("surface-override-lock", "FAIL"),
             "wrong arrival": ("comp-after-xy", "FAIL"), "missing version": ("comp-nearest", "incomplete"),
             "scan off": ("surface-scan", "FAIL")}
    for i, (defect, (case, status)) in enumerate(cases.items()):
        sub = tmp_path / str(i)
        sub.mkdir()
        by, ctx, sim, error = _surface_step(monkeypatch, sub, defect)
        assert by[case]["status"] == status, (defect, by[case]["detail"])
        assert ctx["report"]["surface_cleanup"]["after"]["eoffset_enabled"] is False, defect
    # a scan that failed starts no compensation and ends the step with its rows
    assert error and "the scan did not pass" in error and not any(k.startswith("comp-") for k in by)



def test_a_step_that_fails_with_compensation_on_turns_it_off(monkeypatch, tmp_path):
    """The XY move with compensation ON refused: the step ends with its rows,
    and the cleanup turns the compensation off and drains it, puts the
    method back and G54 Z0 — read back (Codex R326)."""
    by, ctx, sim, error = _surface_step(monkeypatch, tmp_path, "move refused")
    assert error and "refused" in error
    assert by["comp-on-off"]["status"] == "PASS" and "comp-after-xy" not in by
    assert sim.on is False
    after = ctx["report"]["surface_cleanup"]["after"]
    assert after["eoffset_enabled"] is False and after["comp_method"] == 2 and after["g54_z"] == 0.0
    assert ("set_compensation", {"enable": False}) in sim.sent[-6:], sim.sent[-6:]


def test_the_expected_wiring_is_the_shipped_hal():
    """surface_wiring() (what the run requires of the RUNNING HAL) is what the
    shipped HAL files declare — writer and readers, signal by signal."""
    sigs = {}
    for name in ("sim_toolsetter.hal", "sim_surface.hal"):
        for ln in (HERE.parent / "examples/sim_config/hallib" / name).read_text().splitlines():
            w = ln.split("#", 1)[0].split()
            if not w or w[0] != "net":
                continue
            s = sigs.setdefault(w[1], {"writers": [], "readers": []})
            rest = w[2:]
            i = rest.index("=>") if "=>" in rest else len(rest)
            s["writers"] += rest[:i]
            s["readers"] += rest[i + 1:]
    for sig, (writer, readers) in nr.surface_wiring().items():
        assert sigs[sig]["writers"] == ([writer] if writer else []), sig
        assert readers <= set(sigs[sig]["readers"]), (sig, readers - set(sigs[sig]["readers"]))



def test_a_reading_is_judged_at_its_measured_position():
    """Codex R327 FI-I56: B reached 0.4 mm past Y — the 1-mm map value is
    still B's, the joint Z consistent; the tip's distance at the MEASURED
    X/Y is 12.074 and the arrival itself is refused. Unknown X/Y: incomplete."""
    z_b = nc.surface_z(*nr.COMP_B) - nc.SURFACE_BASE
    off_b = {**_reading(round(z_b, 3), at=nr.COMP_B), "y": nr.COMP_B[1] + 0.4}
    row = nc.eval_comp_reading("b", off_b, True, z_b, 12.0, -113.0, 50.0, nr.COMP_B)
    assert row["status"] == "FAIL" and "not at" in row["detail"]
    near = {**_reading(round(z_b, 3), at=nr.COMP_B), "y": nr.COMP_B[1] + 0.0005}
    assert nc.eval_comp_reading("b", near, True, z_b, 12.0, -113.0, 50.0, nr.COMP_B)["status"] == "PASS"
    for unknown in ({"x": None}, {"y": float("nan")}):
        r = {**_reading(round(z_b, 3), at=nr.COMP_B), **unknown}
        assert nc.eval_comp_reading("b", r, True, z_b, 12.0, -113.0, 50.0, nr.COMP_B)["status"] == "incomplete"
    assert _method_case("cubic", 5.070, reading={**_reading(5.070), "x": 538.5})["status"] == "FAIL"
    assert _method_case("cubic", 5.070, reading={**_reading(5.070), "x": None})["status"] == "incomplete"


def test_an_unknown_map_version_carries_no_reading():
    """Codex R327 FI-I57: None == None is no stable version."""
    on = lambda st: st.get("eoffset_enabled") is True  # noqa: E731
    assert nc.settled_window(_settle_frames(v=None), on) is None
    late = _settle_frames()
    late[-4] = (late[-4][0], {**late[-4][1], "comp_grid_version": None})
    assert nc.settled_window(late, on) is None
    win = nc.settled_window(_settle_frames(), on)
    assert win["frames"][0][0] == pytest.approx(win["t_from"], abs=1e-4) and len(win["frames"]) >= 15
    assert _method_case("cubic", 5.070, reading={**_reading(5.070), "version": None})["status"] == "incomplete"
    moved = [(t, {**st, "joint_pos": [538.0 + 0.001 * k, 550.0, -107.93]}) for k, (t, st) in enumerate(_settle_frames())]
    assert nc.settled_window(moved, on) is None, "X still moving"


def test_a_row_of_three_readings_takes_the_worst():
    p, f, i = ({"case": "x", "status": s, "detail": s} for s in ("PASS", "FAIL", "incomplete"))
    assert nc.eval_comp_pair("x", p, i, f)["status"] == "FAIL"
    assert nc.eval_comp_pair("x", p, p, i)["status"] == "incomplete"
    assert nc.eval_comp_pair("x", p)["status"] == "PASS"


def test_no_move_without_a_confirmed_enable_and_no_switch_without_a_drain(monkeypatch, tmp_path):
    """Codex R327 FI-I55: the enable before the move to B not confirmed → no
    G1 is sent, comp-after-xy incomplete, the results before kept; the drain
    after nearest not confirmed → no further switch, the rest incomplete."""
    (tmp_path / "a").mkdir()
    by, ctx, sim, error = _surface_step(monkeypatch, tmp_path / "a", "late enable")
    assert error is None and not any(m.startswith("G1") for m in sim.moves), sim.moves
    assert by["comp-after-xy"]["status"] == "incomplete" and "no move sent" in by["comp-after-xy"]["detail"]
    assert all(by[k]["status"] == "PASS" for k in ("comp-nearest", "comp-linear", "comp-cubic", "comp-on-off"))
    (tmp_path / "b").mkdir()
    by, ctx, sim, error = _surface_step(monkeypatch, tmp_path / "b", "no drain")
    assert by["comp-nearest"]["status"] == "PASS"
    assert [kw["method"] for cmd, kw in sim.sent if cmd == "set_compensation_method"][:1] == [0]
    assert 1 not in [kw["method"] for cmd, kw in sim.sent if cmd == "set_compensation_method"][:-1], \
        "no switch to linear after the drain failed (the cleanup may put the start method back)"
    for case in ("comp-linear", "comp-cubic", "comp-on-off", "comp-after-xy"):
        assert by[case]["status"] == "incomplete" and "drained after nearest" in by[case]["detail"], case
    assert ctx["report"]["surface_cleanup"]["after"]["eoffset_enabled"] is False


def test_the_cleanup_needs_the_override_free_in_a_status_after_the_write(monkeypatch):
    """Codex R327 FI-I58: M50 P1 ended normally but the status says locked or
    nothing — the cleanup names it; free in a frame after the write passes."""
    monkeypatch.setattr(nr, "OVERRIDE_CONFIRM_S", 0.3)
    monkeypatch.setattr(nr, "_comp_off", lambda ctx, c: {"settled": True, "enabled": False, "eoffset": 0.0})
    class Streaming:
        """Status frames keep arriving: each look brings the latest state again."""

        def __init__(self, st):
            self.f, self.errors, self.error = [(0.0, dict(st))], [], None

        @property
        def frames(self):
            self.f.append((self.f[-1][0] + 0.033, dict(self.f[-1][1])))
            return self.f

        @property
        def status(self):
            return dict(self.f[-1][1])

    for after, ok in ((True, True), (False, False), (None, False)):
        c = Streaming({**_IDLE, "feed_override_enabled": False, "comp_method": 2, "g5x_index": 1,
                       "g5x_offset": [0.0, 0.0, 0.0]})

        def short(cl, text, after=after):
            cl.f.append((cl.f[-1][0] + 0.1, {**cl.status, "feed_override_enabled": after}))
        monkeypatch.setattr(nr, "_short", short)
        out = nr._surface_cleanup({}, c, "cubic")
        assert bool(out.get("error")) is (not ok), (after, out)
        if not ok:
            assert "override" in out["error"]


def test_the_scipy_is_the_one_the_process_mapped():
    maps = ("ffff0000-ffff1000 r-xp 00000000 fe:01 1 /usr/lib/python3/dist-packages/scipy/spatial/_qhull.so\n"
            "ffff2000-ffff3000 r-xp 00000000 fe:01 2 /usr/lib/aarch64-linux-gnu/libc.so.6\n")
    read = {"/usr/lib/python3/dist-packages/scipy/version.py": 'version = "1.15.3"\nfull_version = version\n'}
    assert nr.mapped_scipy(maps, read.__getitem__) == "1.15.3 (/usr/lib/python3/dist-packages/scipy/)"
    two = maps + "ffff4000-ffff5000 r-xp 0 fe:01 3 /opt/other/scipy/linalg/_fblas.so\n"
    assert nr.mapped_scipy(two, read.__getitem__).startswith("not read")
    assert nr.mapped_scipy("", read.__getitem__).startswith("not read")



def test_the_scan_needs_its_g54_x_y_at_zero(monkeypatch, tmp_path):
    """Codex R327: the basis checks G54 X/Y too — the map and the readouts
    are in the WCS, the points in G53."""
    with pytest.raises(nr.Refused, match="basis"):
        _surface_step(monkeypatch, tmp_path, "g54 x")

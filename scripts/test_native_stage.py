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
    def wait_ready(self, timeout): return self.ready
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
    class Client:
        error = "Simulator WebSocket closed during the gate"
        status = _st(True, 1, 1)
        sent = []

        def request(self, *a, **k):
            self.sent.append((a, k))
    ch = tc.ToolChanges([1])
    with pytest.raises(tc.ToolChangeError, match="connection"):
        tc.serve(Client(), ch, done=lambda t, st: False, deadline_s=1.0)
    assert Client.sent == [] and ch.confirmed == []


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


def test_a_hold_with_a_gap_in_its_sampling_is_no_hold():
    ch = tc.ToolChanges([99], hold_s=5.0)
    with pytest.raises(tc.ToolChangeError, match="gap"):
        for t in [0.0, 0.05, 0.1, 1.5] + [1.5 + 0.05 * k for k in range(1, 80)]:
            ch.step(t, _st(True, 9, 99, number=1))
    assert ch.confirmed == []


# ── step 2: the evaluators (plan R283–R285 FI282-05) ─────────────────────
def test_a_counter_probe_passes_only_when_its_planted_value_is_refused():
    wrong = nc.eval_probe_z("probe-z", 1, -180.0004, expected=-179.0)
    assert wrong["status"] == "FAIL"
    c = nc.counter("probe-z.counter-179", wrong)
    assert c["status"] == "PASS" and c["inner"]["status"] == "FAIL" and c["counter"] is True
    passed = nc.counter("probe-z.counter-179", nc.eval_probe_z("probe-z", 1, -179.0, expected=-179.0))
    assert passed["status"] == "FAIL", "a planted wrong value that passes: the check does not hold"
    unknown = nc.counter("probe-z.counter-179", nc.eval_probe_z("probe-z", None, -180.0, expected=-179.0))
    assert unknown["status"] == "incomplete"


@pytest.mark.parametrize("contact, g54, status", [
    (1, -180.0004, "PASS"), (1, -180.0031, "FAIL"), (1, -179.9969, "FAIL"),
    (0, -180.0, "FAIL"), (None, -180.0, "incomplete"), (1, None, "incomplete"), (1, float("nan"), "incomplete"),
])
def test_the_z_probe_needs_its_contact_and_the_plate_within_its_tolerance(contact, g54, status):
    r = nc.eval_probe_z("probe-z", contact, g54, expected=-180.0)
    assert r["status"] == status, r


@pytest.mark.parametrize("contact, before, after, errors, status", [
    (0, 0.0, 0.0, ["G38.2 move finished without making contact."], "PASS"),
    (1, 0.0, 0.0, ["G38.2 move finished without making contact."], "FAIL"),
    (0, 0.0, -180.0, ["G38.2 move finished without making contact."], "FAIL"),
    (0, 0.0, 0.0, [], "incomplete"),                        # the error may have ridden a skipped tick
    (None, 0.0, 0.0, ["G38.2 move finished without making contact."], "incomplete"),
])
def test_a_probe_without_contact_reports_none_and_sets_nothing(contact, before, after, errors, status):
    r = nc.eval_probe_miss("probe-z-miss", contact, before, after, errors)
    assert r["status"] == status, r


@pytest.mark.parametrize("length, g43, status", [
    (50.0015, 50.0015, "PASS"), (50.0025, 50.0025, "FAIL"), (49.0, 49.0, "FAIL"),
    (50.0, 0.0, "FAIL"), (None, 50.0, "incomplete"), (50.0, None, "incomplete"),
])
def test_m600_measures_the_length_and_applies_the_same(length, g43, status):
    r = nc.eval_m600("m600-t1", 50.0, length, g43)
    assert r["status"] == status, r


def _lock(seq, done_at):
    """(t, status): feed_override_enabled per frame, done = interp idle + no request from `done_at` on."""
    out = []
    for t, en in seq:
        done = done_at is not None and t >= done_at
        out.append((t, {"feed_override_enabled": en, "interp_state": 1 if done else 2,
                        "tool_change_seq": None, "tool_change_requested": False}))
    return out


def test_the_m600_lock_as_codex_drew_it_passes():
    frames = _lock([(0.03, True), (0.2, False), (0.6, False), (1.0, False), (1.033, True)], done_at=1.033)
    r = nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)
    assert r["status"] == "PASS", r


def test_no_release_within_two_seconds_of_the_completion_fails():
    frames = _lock([(0.03, True), (0.2, False), (1.0, False), (1.033, False), (2.0, False), (3.1, False)], done_at=1.033)
    assert nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)["status"] == "FAIL"


def test_only_a_stale_true_from_before_the_completion_fails():
    # released at 0.9, completed at 1.033 — but no frame AFTER the completion shows it
    frames = _lock([(0.03, True), (0.2, False), (0.9, True)], done_at=None)
    frames.append((1.033, {"feed_override_enabled": False, "interp_state": 1, "tool_change_seq": None,
                           "tool_change_requested": False}))
    assert nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)["status"] == "FAIL"


def test_no_observed_locked_phase_is_incomplete():
    frames = _lock([(0.03, True), (0.5, True), (1.0, True)], done_at=1.0)
    assert nc.eval_override_lock("m600-lock", frames, t_trigger=0.0)["status"] == "incomplete"


def test_a_release_inside_the_measuring_phase_fails_and_a_stale_start_is_incomplete():
    flicker = _lock([(0.03, True), (0.2, False), (0.4, True), (0.6, False), (1.033, True)], done_at=1.033)
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
    (_hold(samples=60), 99, 50.0, "FAIL"),           # 5 s at 20 Hz is ≥ 90 samples
    (_hold(gap=0.2), 99, 50.0, "FAIL"),
    ([], 99, 50.0, "FAIL"),                          # no request ever held: M6 did not wait for anything
    (_hold(), 1, 50.0, "FAIL"),                      # it did not go on with the new tool
    (_hold(), 99, 40.0, "FAIL"),                     # nor with its length
    (_hold(), 99, None, "incomplete"),
])
def test_m6_waits_held_and_goes_on_with_the_new_tool(holds, after, offset, status):
    r = nc.eval_m6_hold("m6-hold", holds, 1, after, offset, 99, 50.0, 5.0)
    assert r["status"] == status, r


class ScriptedClient:
    """A live client's surface for the case helpers: each status READ shows
    the next scripted frame (the last one stays); requests are recorded."""

    def __init__(self, frames):
        self.frames, self.i, self.sent, self.errors, self.error = list(frames), 0, [], [], None

    @property
    def status(self):
        st = self.frames[min(self.i, len(self.frames) - 1)]
        self.i += 1
        return dict(st)

    def request(self, cmd, **kw):
        self.sent.append((cmd, kw))
        return {"ok": True}


def test_a_routine_ends_on_its_started_effect_seen_while_it_runs():
    """The start latch (the probe's M50 P0) shows only WHILE it runs: a
    done-check that evaluates it only on idle frames never ends."""
    base = {"tool_change_requested": False, "tool_change_seq": None, "inpos": True}
    frames = [{**base, "interp_state": 1, "feed_override_enabled": True}] * 2 + \
             [{**base, "interp_state": 2, "feed_override_enabled": False, "inpos": False}] * 3 + \
             [{**base, "interp_state": 2, "feed_override_enabled": True}] + \
             [{**base, "interp_state": 1, "feed_override_enabled": True}] * 3
    seen = {"on": False}

    def ran(st):
        seen["on"] = seen["on"] or st.get("feed_override_enabled") is False
        return seen["on"]
    c = ScriptedClient(frames)
    r = nr._routine(c, "O<probe_z_minus_wco> CALL", vars={3030: 0}, deadline=2.0, extra=ran)
    assert c.sent[0] == ("mdi", {"text": "O<probe_z_minus_wco> CALL", "vars": {"3030": 0}}) and r["served"] == []


class EchoClient(ScriptedClient):
    """The interpreter answers a DEBUG line through the error channel —
    except the attempts listed as lost (a skipped status tick)."""

    def __init__(self, lost=()):
        super().__init__([{"interp_state": 1, "inpos": True, "tool_change_requested": False, "tool_change_seq": None}])
        self.lost, self.debug = set(lost), 0

    def request(self, cmd, **kw):
        super().request(cmd, **kw)
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

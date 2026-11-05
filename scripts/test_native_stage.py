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
    rows = nr.m600_cases()[1]({"client": c, "frames": frames, "plate": {"x": 10, "y": 10, "z": -180}})
    by = {r["case"]: r for r in rows}
    assert calls == [-180, -179], "the counter ran with #3102 planted 1 mm up"
    assert [by[k]["status"] for k in ("m600-unload", "m600-t1", "m600-t1-override-lock")] == ["PASS"] * 3, rows
    assert by["m600-t1.counter-3102"]["status"] == "FAIL" and by["m600-t1.counter-3102"]["errors"] == no_contact


# ── step 2b: run from line (Codex R292 FI292-01) ─────────────────────────
L = 7                       # "G1 X200 F3000"
L0 = 50.0


def _rfl_frame(t, line, xyz, *, mode=2, level=0, vel=50.0, interp=2, tool=1, offset=50.0, table=50.0,
               sdir=1, speed=1000.0):
    return (t, {"task_mode": mode, "call_level": level, "motion_line": line, "current_vel": vel, "interp_state": interp,
                "inpos": vel == 0.0, "joint_pos": list(xyz), "tool_number": tool, "tool_offset": [0, 0, offset],
                "tool_table_z": table, "spindle_direction": sdir, "spindle_speed": speed})


def _rfl_run(**witness):
    """A clean run: measuring (MDI, subroutine), safe Z up, XY to the entry,
    then the program from line 7 to its end."""
    hist = [(0.0, {"phase": "measuring", "ok": None}), (20.0, {"phase": "safe_z", "ok": None}),
            (21.0, {"phase": "positioning", "ok": None}), (23.0, {"phase": "starting", "ok": None}),
            (23.2, {"phase": "running", "ok": True})]
    frames = [_rfl_frame(5.0, 120, (10, 10, -128), mode=3, level=2, vel=3.0, tool=1, offset=0.0),   # inside M600
              _rfl_frame(20.1, 0, (10, 10, -100), mode=3, vel=80.0), _rfl_frame(20.9, 0, (10, 10, 0.0), mode=3, vel=0.0),
              _rfl_frame(21.5, 0, (60, 60, 0.0), mode=3, vel=100.0), _rfl_frame(22.9, 0, (100, 100, 0.0), mode=3, vel=0.0),
              _rfl_frame(23.3, L, (101, 100, -0.5), **witness), _rfl_frame(24.3, L, (150, 100, -25)),
              _rfl_frame(25.3, 8, (200, 101, -50)), _rfl_frame(27.3, 9, (200, 200, -40)),
              _rfl_frame(28.0, 11, (200, 200, 0.0), vel=0.0, interp=1)]
    return hist, frames


def _line(hist, frames, line=L):
    return nc.eval_rfl_line("rfl-line", hist, frames, line=line, tool=1, l0=L0, spindle_speed=1000.0,
                            end_point=(200.0, None, -100 + L0), final=(200.0, 200.0, -50 + L0), line_holds={1: 100.0})


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
    assert lines[nr.RFL_LINE - 1] == "G1 X200 F3000" and lines[nr.RFL_LINE] == "G1 Y200"
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
            raise RuntimeError("confirm_tool_change refused: Tool change request changed — confirm again")
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
                         end_point=(200.0, None, -100 + L0), final=(200.0, 200.0, -50 + L0), line_holds={1: 100.0},
                         errors=[(11, "Probe tripped during non-probe move")])
    assert r["status"] == "FAIL" and "reported" in r["detail"], r


class RflClient(FrameClient):
    """The whole rfl_cases step against a scripted gateway: the run's frames,
    phases and errors arrive with the auto_run (times relative to it)."""

    def __init__(self, run_frames, history, errors=(), refuse=None, after_confirm=()):
        super().__init__([(0.0, {**_IDLE, "tool_number": 99, "task_mode": 3})])
        self.rfl_history, self.preview_origin = [], None
        self.table, self.vars = 50.0, {n: 0 for n in nr.TOOLSETTER_VARS} | {3102: -180}
        self.run_frames, self.history, self.run_errors = run_frames, history, list(errors)
        self.refuse, self.after_confirm = refuse or {}, list(after_confirm)

    def request(self, cmd, **kw):
        import hashlib
        self.sent.append((cmd, kw))
        t = self.frames[-1][0]
        if cmd in self.refuse:
            raise RuntimeError(self.refuse[cmd])
        if cmd == "confirm_tool_change":
            self.frames += [(t + ft, {"tool_change_requested": False, "tool_change_seq": None, **st})
                            for ft, st in self.after_confirm]
            return {"ok": True}
        if cmd == "get_tool_table":
            return {"tools": [{"T": 1, "Z": self.table}]}
        if cmd == "get_probe_vars":
            return {"vars": {str(k): self.vars[k] for k in kw["vars"]}}
        if cmd == "mdi":
            self.frames += [(t + 1.0, {**_IDLE, "task_mode": 3}), (t + 2.0, {**_IDLE, "task_mode": 3})]
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
    ctx = {"client": client, "frames": client.frames, "config": tmp_path, "report": {}}
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
    """Codex R295 FI-I29 B: idle at 5.2 s still moving at Z −40 (not in
    position), the confirmed rest at the end point later — the end is the
    rest, as the step's own RoutineEnd has it."""
    hist, frames = _rfl_run()
    frames[-1:] = [_rfl_frame(27.9, 11, (200, 200, -40.0), vel=50.0, interp=1),
                   _rfl_frame(28.6, 11, (200, 200, 0.0), vel=0.0, interp=1)]
    assert _line(hist, frames)["status"] == "PASS", _line(hist, frames)
    frames[-1] = _rfl_frame(28.6, 11, (200, 190, 0.0), vel=0.0, interp=1)
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


@pytest.mark.parametrize("arrange, status, cause", [
    (dict(run_frames=[(2.0, _request(2, 5))]), "FAIL", "contradiction"),                 # T2, T1 declared
    (dict(run_frames=[(2.0, _request(1, 5))],
          refuse={"confirm_tool_change": "confirm_tool_change refused: Tool change request changed — confirm again"}),
     "FAIL", "refused"),
    (dict(run_frames=[], refuse={"auto_run": "auto_run refused: Program changed — confirm Run from line again"}),
     "FAIL", "refused"),
    (dict(run_frames=[], refuse={"auto_run": "No gateway reply to auto_run"}), "incomplete", "unobserved"),
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
    assert not any(cmd == "confirm_tool_change" for cmd, _ in c.sent) or cause == "refused"


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

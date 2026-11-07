"""The install probe's offline guards (package I, operator 2026-11-07, plan
Codex R329): install.sh's non-interactive contract, the evaluators (a
missing proof is never PASS), the protection record, the clone's cleanup,
the child environment, the gate's verdict and the browser start's detection.
Never imports linuxcnc or hal; no unit is started, no LinuxCNC touched."""
from __future__ import annotations

import http.server
import json
import os
import socketserver
import subprocess
import sys
import threading
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from test_support import install_cases as ic  # noqa: E402
from test_support import restore_lan as rl  # noqa: E402
from test_support.system_host import _hash_tree  # noqa: E402

INSTALL = ROOT / "install.sh"


# ── install.sh: the non-interactive contract ─────────────────────────────
TOOLS = ("git", "git-lfs", "python3", "mktemp", "rm", "awk", "cut", "tr", "node", "npm", "curl", "halcompile",
         "sed", "ls", "cat", "basename", "dirname", "env")


def shim_path(tmp: Path, missing=()) -> tuple[str, Path]:
    """A PATH of links to the real tools — minus `missing` — and a sudo that
    records its arguments and refuses."""
    bin_ = tmp / "bin"
    bin_.mkdir()
    for name in TOOLS:
        real = subprocess.run(["bash", "-c", f"command -v {name}"], capture_output=True, text=True).stdout.strip()
        if name not in missing and real:
            (bin_ / name).symlink_to(real)
    log = tmp / "sudo.log"
    sudo = bin_ / "sudo"
    sudo.write_text(f"#!/bin/bash\necho \"$*\" >> {log}\nexit 1\n")
    sudo.chmod(0o755)
    return str(bin_), log


def run_install(tmp: Path, args, missing=("halcompile",), stdin=subprocess.DEVNULL):
    path, log = shim_path(tmp, missing)
    home = tmp / "home"
    home.mkdir()
    work = tmp / "work"          # not a clone: the script stops before step 3 in these cases
    work.mkdir()
    r = subprocess.run(["/bin/bash", str(INSTALL), *args], cwd=work, stdin=stdin, capture_output=True, text=True,
                       timeout=60, env={"PATH": path, "HOME": str(home), "TERM": "dumb"})
    return r, (log.read_text() if log.exists() else "")


def test_install_unknown_option_is_refused(tmp_path):
    r, sudo = run_install(tmp_path, ["--bogus"])
    assert r.returncode == 2 and "unknown option --bogus" in r.stderr
    assert sudo == ""


def test_install_help_names_the_options(tmp_path):
    r, _ = run_install(tmp_path, ["--help"])
    assert r.returncode == 0 and "--yes" in r.stdout and "--no-root" in r.stdout


def test_install_no_root_stops_at_a_missing_package_without_sudo(tmp_path):
    r, sudo = run_install(tmp_path, ["--yes", "--no-root"])
    assert r.returncode == 1
    assert "linuxcnc-uspace-dev" in r.stdout and "--no-root: these need root" in r.stdout
    assert sudo == "", "--no-root never calls sudo"


def test_install_without_a_terminal_stops_and_says_why(tmp_path):
    """No --yes, no terminal: a finite stop with the reason — never a read
    nobody answers (and no sudo)."""
    r, sudo = run_install(tmp_path, [])
    assert r.returncode == 1 and "No terminal to ask — re-run with --yes" in r.stdout
    assert sudo == ""


def test_install_without_a_terminal_and_an_open_unanswered_input_still_ends(tmp_path):
    """Codex R329: an OPEN input nobody writes to is another case than a closed
    one (a closed input ends `read` at once) — the script must not wait on it.
    The pipe stays open until the script has ended or 30 s passed."""
    path, log = shim_path(tmp_path, ("halcompile",))
    (tmp_path / "home").mkdir()
    (tmp_path / "work").mkdir()
    p = subprocess.Popen(["/bin/bash", str(INSTALL)], cwd=tmp_path / "work", stdin=subprocess.PIPE,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                         env={"PATH": path, "HOME": str(tmp_path / "home"), "TERM": "dumb"})
    try:
        rc = p.wait(timeout=30)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait()
        pytest.fail("the installer waited on an input nobody answers")
    out = p.stdout.read()
    p.stdin.close()
    assert rc == 1 and "No terminal to ask" in out
    assert not log.exists()


def test_install_yes_installs_without_asking(tmp_path):
    r, sudo = run_install(tmp_path, ["--yes"])
    assert "apt-get update" in sudo, "--yes goes straight to the package install"
    assert r.returncode != 0          # the recording sudo refuses


def test_install_script_contract_in_the_source():
    """What the probe relies on, in the script itself: npm ci and the build,
    a failed import is fatal, a fresh install's drift fails, every profile
    checked, the components compiled under --no-root."""
    text = INSTALL.read_text()
    assert "npm ci" in text and "npm install" not in text
    assert "npm run build" in text
    imports = text[text.index('info "Verifying Python imports..."'):]
    assert "exit 1" in imports[:imports.index("deactivate")]
    assert 'FRESH_CONFIG' in text and 'A fresh install differs from the repo templates' in text
    assert "profiles.json" in text and "halcompile --compile" in text
    assert "Build the frontend" not in text, "the next steps no longer ask for a build"


# ── the child environment (FI329-02) ─────────────────────────────────────
def test_child_env_inherits_nothing(tmp_path, monkeypatch):
    for k, v in {"LCNC_LOG_DIR": "/elsewhere/logs", "npm_config_cache": "/elsewhere/npm",
                 "PIP_CACHE_DIR": "/elsewhere/pip", "PYTHONPATH": "/elsewhere", "DISPLAY": ":0"}.items():
        monkeypatch.setenv(k, v)
    env = ic.child_env(tmp_path, tmp_path / "home")
    assert "PYTHONPATH" not in env and "DISPLAY" not in env
    assert env["LCNC_LOG_DIR"] == str(tmp_path / "logs")
    assert ic.write_targets(env, tmp_path) == []
    assert env["PATH"].split(":")[0] == str(tmp_path / "home/.local/bin")


def test_write_targets_name_a_target_outside_the_run(tmp_path):
    env = {**ic.child_env(tmp_path, tmp_path / "home"), "LCNC_LOG_DIR": "/elsewhere/logs"}
    assert ic.write_targets(env, tmp_path) == ["LCNC_LOG_DIR = /elsewhere/logs lies outside the run"]
    env.pop("npm_config_cache")
    assert "npm_config_cache is not set" in ic.write_targets(env, tmp_path)


# ── the protection record (FI329-02) ─────────────────────────────────────
def test_a_retargeted_link_changes_the_record(tmp_path):
    """SystemHost._hash_tree skips links: a launcher link bent to another
    tree hashed the same (Codex R329). The manifest records the target."""
    b = tmp_path / "bin"
    b.mkdir()
    (tmp_path / "a").write_text("a")
    (tmp_path / "b").write_text("b")
    (b / "lcnc-suite").symlink_to(tmp_path / "a")
    before_old, before = _hash_tree(b), ic.manifest(b)
    (b / "lcnc-suite").unlink()
    (b / "lcnc-suite").symlink_to(tmp_path / "b")
    assert _hash_tree(b) == before_old, "the old record does not see it (the finding)"
    after = ic.manifest(b)
    assert ic.manifest_digest(after) != ic.manifest_digest(before)
    assert ic.manifest_diff(before, after) == [f"lcnc-suite: link:{tmp_path / 'a'} → link:{tmp_path / 'b'}"]


def test_the_record_sees_content_type_and_absence(tmp_path):
    d = tmp_path / "d"
    d.mkdir()
    (d / "f").write_text("1")
    m1 = ic.manifest(d)
    (d / "f").write_text("2")
    assert ic.manifest(d) != m1
    (d / "f").unlink()
    (d / "f").mkdir()
    assert ic.manifest(d)["f"] == "dir"
    assert ic.manifest(tmp_path / "none") == {".": "absent"}


def test_host_isolation_covers_the_home_links(tmp_path):
    home = tmp_path / "home"
    (home / ".local/bin").mkdir(parents=True)
    (home / ".local/bin/lcnc-suite").symlink_to("/opt/a")
    host = ic.InstallProbeHost(run=tmp_path / "run", home=home)
    h1 = host.file_hashes()
    (home / ".local/bin/lcnc-suite").unlink()
    (home / ".local/bin/lcnc-suite").symlink_to("/opt/b")
    h2 = host.file_hashes()
    assert h1["home:.local/bin"] != h2["home:.local/bin"]
    assert {k for k in h1 if h1[k] != h2[k]} == {"home:.local/bin"}


# ── the clone's cleanup (FI329-04) ───────────────────────────────────────
def test_the_clone_is_removed_as_a_folder_of_the_run(tmp_path, monkeypatch):
    run = tmp_path / "run"
    src = run / "src"
    (src / ".git").mkdir(parents=True)
    (src / "f").write_text("x")
    calls = []
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: calls.append(a) or subprocess.CompletedProcess(a, 0))
    ic.InstallProbeHost(run=run).remove_tree(src, ROOT)
    assert not src.exists()
    assert calls == [], "never `git worktree remove` on a clone (it refuses: 'is not a working tree')"


def test_an_incomplete_clone_the_run_made_is_removed(tmp_path):
    """Codex R330 FI-I62: an abort before git made .git — the folder is the
    run's by the identity the probe recorded when it made it."""
    run = tmp_path / "run"
    src = run / "src"
    src.mkdir(parents=True)
    st = src.stat()
    (run / "state.json").write_text(json.dumps({"tree_id": [st.st_dev, st.st_ino]}))
    ic.InstallProbeHost(run=run).remove_tree(src, ROOT)
    assert not src.exists()


def test_an_incomplete_clone_the_run_did_not_make_is_refused(tmp_path):
    run = tmp_path / "run"
    src = run / "src"
    src.mkdir(parents=True)
    other = tmp_path / "other"
    other.mkdir()
    st = other.stat()
    (run / "state.json").write_text(json.dumps({"tree_id": [st.st_dev, st.st_ino]}))
    with pytest.raises(RuntimeError):
        ic.InstallProbeHost(run=run).remove_tree(src, ROOT)
    assert src.exists()


def test_end_test_resources_after_an_early_clone_abort(tmp_path):
    """The early abort's return: the folder the run made, without .git, no
    processes — cleaned, no cleanup reason that would keep the LAN down."""
    run = tmp_path / "run"
    src = run / "src"
    src.mkdir(parents=True)
    st = src.stat()
    (run / "state.json").write_text(json.dumps({"tree_id": [st.st_dev, st.st_ino]}))
    state = {"tree": str(src), "tree_of": str(ROOT), "tree_id": [st.st_dev, st.st_ino]}
    assert rl.end_test_resources(ic.InstallProbeHost(run=run), state) == []
    assert not src.exists() and state["test_ended"]


@pytest.mark.parametrize("where", ["outside", "the run itself", "no .git"])
def test_the_cleanup_refuses_what_is_not_the_runs_clone(tmp_path, where):
    run = tmp_path / "run"
    run.mkdir()
    target = {"outside": tmp_path / "other", "the run itself": run, "no .git": run / "src"}[where]
    target.mkdir(exist_ok=True)
    if where == "outside":
        (target / ".git").mkdir()
    with pytest.raises(RuntimeError):
        ic.InstallProbeHost(run=run).remove_tree(target, ROOT)
    assert target.exists()


def test_end_test_resources_removes_the_clone_with_the_probe_host(tmp_path):
    """restore_lan's end of the run's resources, the probe's host: the unit
    ended, the clone removed — no cleanup error that would block the LAN start."""
    run = tmp_path / "run"
    src = run / "src"
    (src / ".git").mkdir(parents=True)

    class Host(ic.InstallProbeHost):
        def unit_status(self, unit):
            return {"load": "not-found", "active": "inactive", "pids": [], "invocation": None}

        def process_alive(self, pid, start):
            return False
    state = {"tree": str(src), "tree_of": str(ROOT), "test_unit": "install-probe-sim-x", "test_instance": [1, 2]}
    assert rl.end_test_resources(Host(run=run), state) == []
    assert not src.exists() and state["test_ended"]


# ── the safety chain proven positively (FI329-01) ────────────────────────
T0 = 100.0
GOOD_EVENTS = [{"proc": "gateway", "pid": 7, "tag": "hal.socket_connected"},
               {"proc": "gateway", "pid": 7, "tag": "hal.admitted"},
               {"proc": "gateway", "pid": 7, "tag": "reader.connected", "outcome": "admitted"}]
GOOD_HAL = {"latch_fault": "FALSE", "oneshot_out": "TRUE"}


def frames(n=12, start=T0 + 19, step=0.4, env=None, data=None):
    return [(start + i * step, dict(env or {}), {"comp_grid_version": 0, **(data or {})}) for i in range(n)]


def test_safety_pass_needs_every_positive_proof():
    r = ic.eval_safety(frames(), GOOD_EVENTS, GOOD_HAL, 7, T0)
    assert r["status"] == "PASS", r


def test_safety_watchdog_connected_reader_unknown_no_banner_is_no_pass():
    """Codex R329's counter-case: the grace over, the watchdog connected, the
    reader not fresh and the latch unknown — evaluate_safety_chain answers
    None, no banner rides the frame. That is no proof."""
    events = [e for e in GOOD_EVENTS if e["tag"] != "reader.connected"]
    r = ic.eval_safety(frames(data={"comp_grid_version": None}), events, {"latch_fault": None, "oneshot_out": "TRUE"},
                       7, T0)
    assert r["status"] != "PASS"
    assert "reader" in r["detail"] and "latch" in r["detail"]


@pytest.mark.parametrize("env,expect", [({"safety_chain_incomplete": "watchdog (webui-safety) not connected"}, "banner"),
                                        ({"reader_stale": True}, "reader_stale"),
                                        ({"safety_trip": {"reason": "hb"}}, "a trip waits")])
def test_safety_a_contradiction_is_fail(env, expect):
    r = ic.eval_safety(frames(env=env), GOOD_EVENTS, GOOD_HAL, 7, T0)
    assert r["status"] == "FAIL" and expect in r["detail"]


def test_safety_only_this_gateways_events_count():
    other = [{**e, "pid": 8} for e in GOOD_EVENTS]
    assert ic.eval_safety(frames(), other, GOOD_HAL, 7, T0)["status"] == "incomplete"


def test_safety_frames_inside_the_grace_prove_nothing():
    early = frames(start=T0 + 1)
    assert ic.eval_safety(early, GOOD_EVENTS, GOOD_HAL, 7, T0)["status"] == "incomplete"


def test_safety_a_helper_refusal_or_a_fault_is_fail():
    rejected = GOOD_EVENTS + [{"proc": "gateway", "pid": 7, "tag": "reader.rejected"}]
    assert ic.eval_safety(frames(), rejected, GOOD_HAL, 7, T0)["status"] == "FAIL"
    assert ic.eval_safety(frames(), GOOD_EVENTS, {"latch_fault": "TRUE", "oneshot_out": "TRUE"}, 7, T0)["status"] == "FAIL"
    assert ic.eval_safety(frames(), GOOD_EVENTS, {"latch_fault": "FALSE", "oneshot_out": "FALSE"}, 7, T0)["status"] == "FAIL"
    tripped = GOOD_EVENTS + [{"proc": "gateway", "pid": 7, "tag": "safety.tripped"}]
    assert ic.eval_safety(frames(), tripped, GOOD_HAL, 7, T0)["status"] == "FAIL"


def test_safety_the_boot_set_latch_the_gateway_classified_is_pass():
    """A fresh LinuxCNC boots with the latch set until E-Stop Reset; the
    gateway's first sight is safety.latch_faulted_on_connect — no banner, no
    trip (live run 2026-11-07: the first green run judged it a fault)."""
    boot = GOOD_EVENTS + [{"proc": "gateway", "pid": 7, "tag": "safety.latch_faulted_on_connect"}]
    r = ic.eval_safety(frames(), boot, {"latch_fault": "TRUE", "oneshot_out": "TRUE"}, 7, T0)
    assert r["status"] == "PASS" and "set at boot" in r["detail"]
    other = GOOD_EVENTS + [{"proc": "gateway", "pid": 8, "tag": "safety.latch_faulted_on_connect"}]
    assert ic.eval_safety(frames(), other, {"latch_fault": "TRUE", "oneshot_out": "TRUE"}, 7, T0)["status"] == "FAIL"


def test_safety_without_the_gateways_binding_is_incomplete():
    assert ic.eval_safety(frames(), GOOD_EVENTS, GOOD_HAL, None, T0)["status"] == "incomplete"


# ── the browser start (FI329-03) ─────────────────────────────────────────
GOOD_BROWSER = {"scripts": [{"url": "/static/index-x.js", "status": 200, "type": "text/javascript", "ok": True}],
                "bad_responses": [], "page_errors": [], "console_errors": [], "mounted": True, "connected": True,
                "status_applied": True}


def test_browser_pass():
    assert ic.eval_browser(GOOD_BROWSER)["status"] == "PASS"


@pytest.mark.parametrize("change,expect", [
    ({"bad_responses": [{"url": "/static/index-x.js", "status": 404, "type": "text/html"}]}, "404"),
    ({"mounted": False}, "did not mount"),
    ({"connected": False}, "viewer_init"),
    ({"status_applied": False}, "no status"),
    ({"status_applied": None}, "no status"),
    ({"scripts": []}, "no script"),
    ({"page_errors": ["TypeError: x"]}, "page error"),
    ({"error": "Timeout"}, "the check ended")])
def test_browser_fail(change, expect):
    r = ic.eval_browser({**GOOD_BROWSER, **change})
    assert r["status"] == "FAIL" and expect in r["detail"]


def test_browser_without_a_result_is_incomplete():
    assert ic.eval_browser(None)["status"] == "incomplete"


APP_JS = """const s = document.createElement('div'); s.className = 'safetyStrip'; s.textContent = 'S';
const i = document.createElement('input'); i.className = 'setupInput';
document.getElementById('app').append(s, i);"""
# the status the instance sends, applied: the strip's E-Stop reads "Reset E-Stop"
STATUS_JS = """const b = document.createElement('button'); b.setAttribute('aria-label', 'Reset E-Stop'); b.textContent = 'Reset';
document.querySelector('.safetyStrip').append(b);"""


def serve(root: Path, spa: bool):
    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(root), **k)

        def log_message(self, *a):
            pass

        def send_head(self):
            p = Path(self.translate_path(self.path))
            if spa and not p.exists():
                self.path = "/index.html"          # the SPA fallback: every unknown path answers the page
            return super().send_head()
    srv = socketserver.TCPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


@pytest.mark.parametrize("case", ["whole", "entry missing", "spa fallback", "viewer_init only"])
def test_the_browser_check_sees_a_missing_entry_module(tmp_path, case):
    """A real Chromium against a fake build: the page alone is the same in
    all four (HTTP 200); only the whole build mounts (Codex R329 FI329-03)
    AND shows a status applied (R330 FI-I61: the DRO fields of a viewer_init
    alone passed)."""
    webui = ROOT / "lcnc-webui"
    if not (webui / "node_modules/playwright").is_dir():
        pytest.skip("no playwright in lcnc-webui/node_modules")
    site = tmp_path / "site"
    (site / "static").mkdir(parents=True)
    (site / "index.html").write_text('<!doctype html><div id="app"></div><script type="module" src="/static/app.js"></script>')
    if case in ("whole", "viewer_init only"):
        (site / "static/app.js").write_text(APP_JS + ("\n" + STATUS_JS if case == "whole" else ""))
    srv = serve(site, spa=case == "spa fallback")
    try:
        out = tmp_path / "browser.json"
        subprocess.run(["node", str(ROOT / "scripts/install_probe_browser.mjs"), "--webui", str(webui),
                        "--url", f"http://127.0.0.1:{srv.server_address[1]}/", "--out", str(out), "--step-ms", "4000",
                        "--expect-estop"],
                       timeout=120, check=False, capture_output=True)
        result = json.loads(out.read_text())
    finally:
        srv.shutdown()
    assert result.get("page", {}).get("status") == 200
    r = ic.eval_browser(result)
    assert (r["status"] == "PASS") == (case == "whole"), (case, r)


# ── the gate's verdict (FI329-04) ────────────────────────────────────────
GOOD_REPORT = {"verdict": "PASS", "restore": {"outcome": "complete", "isolation": []}}


POST = {"outcome": "complete"}


@pytest.mark.parametrize("report,post,ok", [
    (GOOD_REPORT, POST, True),
    (GOOD_REPORT, None, False),
    (None, POST, False),
    ({**GOOD_REPORT, "verdict": "FAIL"}, POST, False),
    ({**GOOD_REPORT, "restore": {"outcome": "not_returned", "isolation": []}}, POST, False),
    ({**GOOD_REPORT, "restore": {"outcome": "complete", "isolation": None}}, POST, False),
    ({**GOOD_REPORT, "restore": {"outcome": "complete", "isolation": ["home:.local/bin changed"]}}, POST, False),
    (GOOD_REPORT, {"outcome": "not_returned", "reasons": ["x"]}, False)])
def test_gate_status(report, post, ok):
    """Each case fails for ITS reason alone: every other proof holds (a case
    with two faults hid the isolation check from a mutant, inst-mut-2)."""
    status, why = ic.gate_status(report, post)
    assert (status == "PASS") == ok and (why == []) == ok
    assert len(why) == (0 if ok else 1), why


SHA = "4013b1b2528d7dd7367a392108edfc66015cb1db"


def gate_fake(states, report=lambda run_id: {**GOOD_REPORT, "run_id": run_id, "commit": SHA,
                                              "rows": [{"case": "install-run", "status": "PASS"}]},
              post_at="inactive"):
    """A fake systemd for round_gate.install_probe: the unit's states in turn
    (None = not read), its report written at the start, its restore's record
    once it is `post_at`. Returns (fake run, calls)."""
    seq, calls, box = iter(states), [], {}

    def fake(cmd, **kw):
        calls.append(cmd)
        if cmd[0] == "systemd-run":
            box["dir"] = Path(cmd[cmd.index("--run-dir") + 1])
            box["id"] = cmd[cmd.index("--run-id") + 1]
            box["dir"].mkdir(parents=True)
            rep = report(box["id"])
            if rep is not None:
                (box["dir"] / "report.json").write_text(json.dumps(rep))
            return subprocess.CompletedProcess(cmd, 0, "", "")
        if cmd[:3] == ["systemctl", "--user", "show"]:
            state = next(seq, "inactive")
            if state is None:
                return subprocess.CompletedProcess(cmd, 1, "", "Failed to connect to bus")
            if state == post_at and box.get("dir"):
                (box["dir"] / "restore-post.json").write_text(json.dumps({"outcome": "complete"}))
            return subprocess.CompletedProcess(cmd, 0, f"ActiveState={state}\nLoadState=loaded\nExecMainStatus=0", "")
        if cmd[:3] == ["systemctl", "--user", "stop"]:
            box["stopped"] = True
        return subprocess.CompletedProcess(cmd, 0, "", "")
    return fake, calls


def rg_module():
    sys.path.insert(0, str(ROOT / "scripts/test_select"))
    import round_gate as rg
    return rg


def test_the_merge_gate_check_waits_for_the_units_end_and_judges_its_own_run(tmp_path, monkeypatch):
    rg = rg_module()
    # the unit's ExecStopPost runs while it is "deactivating"
    fake, calls = gate_fake(["active", "deactivating", "deactivating", "inactive"])
    monkeypatch.setattr(rg.subprocess, "run", fake)
    c = rg.install_probe(tmp_path / "gate.logs", SHA, unit="install-probe-test", sleep=lambda s: None)
    assert c["status"] == "PASS", c
    start = calls[0]
    assert start[start.index("--commit") + 1] == SHA, "the gate's commit, not HEAD resolved later"
    assert not any("--under-gate" in a or "--no-lock" in a for a in start), "the probe holds its own lock"
    assert ["systemctl", "--user", "stop", "install-probe-test"] not in calls


def test_a_repeated_out_path_never_reads_the_earlier_runs_pass(tmp_path, monkeypatch):
    """Codex R330 FI-I59: the same --out twice; the first run's PASS stays,
    the second ends at once without a report — FAIL, not the old PASS."""
    rg = rg_module()
    logs = tmp_path / "gate.logs"
    fake, _ = gate_fake(["inactive"])
    monkeypatch.setattr(rg.subprocess, "run", fake)
    first = rg.install_probe(logs, SHA, unit="install-probe-a", sleep=lambda s: None)
    assert first["status"] == "PASS"
    fake, _ = gate_fake(["failed"], report=lambda run_id: None, post_at="none")
    monkeypatch.setattr(rg.subprocess, "run", fake)
    second = rg.install_probe(logs, SHA, unit="install-probe-b", sleep=lambda s: None)
    assert second["status"] == "FAIL" and second["run"] != first["run"]
    assert (Path(first["run"]) / "report.json").is_file(), "the earlier evidence is kept"


@pytest.mark.parametrize("field,value", [("run_id", "0123456789ab"), ("commit", "a61337c3" + "0" * 32)])
def test_a_report_of_another_run_or_commit_is_no_pass(tmp_path, monkeypatch, field, value):
    rg = rg_module()
    fake, _ = gate_fake(["inactive"], report=lambda run_id: {**GOOD_REPORT, "run_id": run_id, "commit": SHA, field: value})
    monkeypatch.setattr(rg.subprocess, "run", fake)
    c = rg.install_probe(tmp_path / "gate.logs", SHA, unit="install-probe-test", sleep=lambda s: None)
    assert c["status"] == "FAIL" and "not this run's" in c["why"][0]


def test_the_merge_gate_check_stops_a_probe_past_its_deadline(tmp_path, monkeypatch):
    rg = rg_module()
    fake, calls = gate_fake(["active", "inactive"])
    monkeypatch.setattr(rg.subprocess, "run", fake)
    c = rg.install_probe(tmp_path / "gate.logs", SHA, unit="install-probe-test", probe_s=-1, sleep=lambda s: None)
    assert c["status"] == "FAIL" and "stopped" in c["why"][0]
    assert ["systemctl", "--user", "stop", "install-probe-test"] in calls


def test_an_unreadable_unit_is_stopped_and_named(tmp_path, monkeypatch):
    """R330 FI-I60: a state that cannot be read ends the wait in finite time."""
    rg = rg_module()
    fake, calls = gate_fake([None, None, None, "inactive"])
    monkeypatch.setattr(rg.subprocess, "run", fake)
    clock = iter(range(0, 10_000, 40))
    monkeypatch.setattr(rg.time, "monotonic", lambda: float(next(clock)))
    c = rg.install_probe(tmp_path / "gate.logs", SHA, unit="install-probe-test", unread_s=60, sleep=lambda s: None)
    assert c["status"] == "FAIL" and "not read" in c["why"][0]
    assert ["systemctl", "--user", "stop", "install-probe-test"] in calls


def test_a_gate_ended_while_waiting_stops_its_probe_and_awaits_its_end(tmp_path, monkeypatch):
    """R330 FI-I60: an interrupt of the gate leaves no probe running: stopped,
    its end (the restore) awaited, then the interrupt goes on."""
    rg = rg_module()
    fake, calls = gate_fake(["active", "inactive"])
    monkeypatch.setattr(rg.subprocess, "run", fake)
    n = {"sleeps": 0}

    def sleep(s):
        n["sleeps"] += 1
        if n["sleeps"] == 1:
            raise KeyboardInterrupt
    with pytest.raises(KeyboardInterrupt):
        rg.install_probe(tmp_path / "gate.logs", SHA, unit="install-probe-test", sleep=sleep)
    i = calls.index(["systemctl", "--user", "stop", "install-probe-test"])
    assert any(c[:3] == ["systemctl", "--user", "show"] for c in calls[i + 1:]), "its end is awaited after the stop"


def test_the_probe_runs_after_the_gates_heavy_section_and_holds_its_own_lock():
    """R330 FI-I60: the gate is no lock owner of its probe — the probe runs
    after the `with heavy_lock(...)` block and takes the lock itself."""
    import ast
    tree = ast.parse((ROOT / "scripts/test_select/round_gate.py").read_text())
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    locked = [n for n in ast.walk(main) if isinstance(n, ast.With)
              and any("heavy_lock" in ast.unparse(i.context_expr) for i in n.items)]
    assert locked, "the gate's heavy section"
    inside = {id(c) for w in locked for c in ast.walk(w) if isinstance(c, ast.Call)}
    calls = [n for n in ast.walk(main) if isinstance(n, ast.Call) and ast.unparse(n.func) == "install_probe"]
    assert calls and all(id(c) not in inside for c in calls)
    probe = (ROOT / "scripts/install_probe.py").read_text()
    assert 'with heavy_lock("install_probe", wait=0):' in probe and "--under-gate" not in probe


def test_the_restore_always_takes_the_lock(tmp_path, monkeypatch):
    import test_support.heavy_lock as hl
    from contextlib import contextmanager
    taken = []

    @contextmanager
    def lock(who, wait=None, path=None):
        taken.append(who)
        yield
    monkeypatch.setattr(hl, "heavy_lock", lock)
    pre = tmp_path / "pre.json"
    pre.write_text(json.dumps({"units": {}, "ini": None, "head": None, "tree": None, "instance": [], "hashes": {}}))
    monkeypatch.setattr(rl, "restore", lambda *a, **k: {"outcome": "complete"})
    assert rl.main(["--from", str(pre), "--out", str(tmp_path / "out.json")], host_factory=lambda p: object()) == 0
    assert taken == ["restore_lan"]


# ── the installed result's evaluators ────────────────────────────────────
def test_links_profiles_and_tracked_files(tmp_path):
    home, src = tmp_path / "home", tmp_path / "src"
    (home / ".local/bin").mkdir(parents=True)
    for name, rel in ic.LINKS.items():
        (src / rel).parent.mkdir(parents=True, exist_ok=True)
        (src / rel).write_text("")
        (home / ".local/bin" / name).symlink_to(src / rel)
    assert ic.eval_links(home, src)["status"] == "PASS"
    (home / ".local/bin/lcnc-suite").unlink()
    (home / ".local/bin/lcnc-suite").symlink_to("/home/cnc/lcnc-suite/lcnc-suite")
    assert ic.eval_links(home, src)["status"] == "FAIL"
    cat = tmp_path / "profiles.json"
    cat.write_text(json.dumps({"profiles": [{"ini": "a.ini"}, {"ini": "b.ini"}]}))
    (tmp_path / "cfg").mkdir()
    (tmp_path / "cfg/a.ini").write_text("")
    r = ic.eval_profiles(tmp_path / "cfg", cat)
    assert r["status"] == "FAIL" and "b.ini" in r["detail"]
    assert ic.eval_clean_clone("")["status"] == "PASS"
    assert ic.eval_clean_clone(" M lcnc-webui/package-lock.json\n")["status"] == "FAIL"


def test_the_probe_runs_only_in_its_unit_and_names_its_limits():
    text = (ROOT / "scripts/install_probe.py").read_text()
    for limit in ("compiled only", "a new machine's path", "the bootstrap path"):
        assert limit in text
    r = subprocess.run([sys.executable, "-I", str(ROOT / "scripts/install_probe.py"), "--run-dir", "/nonexistent/x"],
                       capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k != "INVOCATION_ID"})
    assert r.returncode == 2 and "runs only in a user unit" in r.stdout


def test_the_unit_is_the_last_service_of_the_cgroup():
    """A user unit's cgroup path holds user@<uid>.service first (live red run
    2026-11-07: the probe took that one and refused to run)."""
    import install_probe as ip
    cg = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/install-probe.service\n"
    assert ip.unit_of(cg) == "install-probe.service"
    assert ip.unit_of("0::/init.scope\n") is None


def test_the_restore_with_nothing_recorded_ends_quietly(tmp_path):
    from test_support import install_restore
    assert install_restore.main(["--from", str(tmp_path / "pre.json"), "--out", str(tmp_path / "o.json")]) == 0


# the surviving mutants of the first red-check (inst-mut-1): each proof alone
def test_safety_without_the_readers_admission_alone_is_no_pass():
    events = [e for e in GOOD_EVENTS if e["tag"] != "reader.connected"]
    r = ic.eval_safety(frames(), events, GOOD_HAL, 7, T0)
    assert r["status"] == "incomplete" and "reader.connected" in r["detail"]


def test_safety_without_the_readers_values_alone_is_no_pass():
    r = ic.eval_safety(frames(data={"comp_grid_version": None}), GOOD_EVENTS, GOOD_HAL, 7, T0)
    assert r["status"] == "incomplete" and "comp_grid_version" in r["detail"]


@pytest.mark.parametrize("n,step", [(2, 2.0), (12, 0.1)])
def test_safety_a_short_window_is_no_pass(n, step):
    """Two frames, or many over less than the window: no settled proof."""
    r = ic.eval_safety(frames(n=n, step=step), GOOD_EVENTS, GOOD_HAL, 7, T0)
    assert r["status"] == "incomplete" and "need ≥ 3" in r["detail"]


@pytest.mark.parametrize("rc,fresh,want", [(0, 1, "ok"), (0, 0, "ok"), (1, 0, "warn"), (1, 1, "fail-drift"),
                                           (2, 0, "fail-check"), (2, 1, "fail-check")])
def test_install_sync_verdict(rc, fresh, want):
    """Q329-2: a fresh install's drift fails, an upgrade's warns, the
    checker's own failure is an error — the script's own function."""
    fn = INSTALL.read_text()
    fn = fn[fn.index("sync_verdict() {"):]
    fn = fn[:fn.index("\n}\n") + 3]
    out = subprocess.run(["bash", "-c", fn + f"sync_verdict {rc} {fresh}"], capture_output=True, text=True)
    assert out.stdout.strip() == want


def test_the_merge_gate_refuses_at_once_a_lan_trip_the_probe_may_not_take():
    """Rehearsal 2026-11-07: a VM pause had tripped the LAN instance before the
    gate began; the probe refused it after the heavy hour. Now at the start."""
    sys.path.insert(0, str(ROOT / "scripts/test_select"))
    import round_gate as rg

    class Host:
        def __init__(self, trip):
            self.trip = trip

        def lan_trip(self):
            if isinstance(self.trip, Exception):
                raise self.trip
            return self.trip
    assert "unacknowledged trip" in rg.install_probe_refusal(Host({"reason": "hal_heartbeat_timeout"}))
    assert rg.install_probe_refusal(Host(None)) is None
    assert rg.install_probe_refusal(Host(OSError("no gateway"))) is None

#!/usr/bin/env python3
"""The install probe (package I, operator 2026-11-07, plan Codex R329): the
merge gate's proof that `install.sh` installs the suite cleanly and
automatically, and that what it installed starts.

  heavy lock (its own, through the restore — also under the merge gate) → record the LAN
  instance (an unacknowledged trip refuses) → stop it, record the operator's
  files (links by their target) → a fresh CLONE of the commit in the run →
  `./install.sh --yes --no-root` in it with a NEW environment (HOME, caches,
  logs, pycache, tmp: all in the run) → the installed result (links, venv,
  build, profiles, config sync, no tracked file changed, the native stage's
  target and confinement checks) → start the installed 3-axis profile through
  the installed launcher (production: the built UI) → the process proof → the
  safety chain proven POSITIVELY by the probe's own unarmed client, the trace
  and HAL → a browser starts the built UI against that gateway → the restore
  in `finally`: the test unit ended, the clone removed, the LAN instance
  returned with its proof and the isolation compared before it runs again.

What it does NOT show (the operator's scope, R329): the realtime components'
INSTALLATION (compiled only — --no-root; the system's modules are not proven
to be these sources'), a new machine's path (apt, nodesource: everything is
present on the VM), the bootstrap path (wget + a clone from GitHub — the probe
runs install.sh inside a clone, the second documented way; the clone comes
from the local repository).

Never imports linuxcnc or hal: the gateway by its WebSocket, HAL by halcmd.
It runs only as a user unit whose ExecStopPost is the restore:

  RUN=~/claude-work/live-tier/install-$(date +%Y%m%dT%H%M%S); PY=<worktree>/lcnc-gateway/.venv/bin/python3
  systemd-run --user --unit=install-probe -p WorkingDirectory=<worktree> \\
    -p "ExecStopPost=$PY -I <worktree>/scripts/test_support/install_restore.py --from $RUN/pre.json --out $RUN/restore-post.json" \\
    $PY -I <worktree>/scripts/install_probe.py --run-dir $RUN --commit <commit>

The merge gate starts it the same way AFTER its heavy section, with its
commit and a run id of its own (round_gate.install_probe): the probe takes
the heavy lock itself and keeps it through the restore in `finally`; its
ExecStopPost's restore takes it again — a gate that ends meanwhile leaves
no probe without a lock owner (Codex R330 FI-I60).
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from native_run import Refused, StepFailed, run, verdict, write_json  # noqa: E402
from test_support import install_cases as ic  # noqa: E402
from test_support import live_target as lt  # noqa: E402
from test_support.heavy_lock import heavy_lock  # noqa: E402

UNIT = "install-probe-sim"
PROFILE = "lcnc_suite_sim_3axis_xyz.ini"
#: finite deadlines (FI329-04): the installer with its fresh downloads, the
#: start, the browser check
INSTALL_S = 1800
READY_S = 180
BROWSER_S = 180
CMD_S = 120
#: the operator's Playwright browsers: a READ-ONLY shared resource of the
#: browser check (the clone's npm ci downloads none — PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD)
BROWSERS = Path.home() / ".cache/ms-playwright"


def save_state(ctx):
    write_json(ctx["run"] / "state.json", ctx["state"])


def _sh(cmd, ctx, cwd=None, timeout=CMD_S, env=None):
    return subprocess.run(cmd, cwd=cwd, env=env or ctx["env"], capture_output=True, text=True,
                          timeout=timeout, stdin=subprocess.DEVNULL)


def clone(commit: str, abort_at=None):
    def step(ctx):
        run = ctx["run"]
        src, home = run / "src", run / "home"
        # the clone is the run's tree: the restore removes it (as a folder of the run)
        ctx["state"].update(tree=str(src), tree_of=str(HERE.parent))
        save_state(ctx)
        for d in ("home", "logs", "pycache", "cache", "tmp"):
            (run / d).mkdir(parents=True, exist_ok=True)
        env = ic.child_env(run, home)
        problems = ic.write_targets(env, run)
        if problems:
            raise Refused("the child environment: " + "; ".join(problems))
        ctx["report"]["env"] = env
        # from here on an abort ends what the run started (an installer in its own session)
        ctx["cleanup"] = lambda: _close(ctx)
        # the clone's folder made HERE, exclusively, its identity on disk before
        # git writes into it: an abort before git made .git leaves a folder the
        # restore can prove its own (Codex R330 FI-I62)
        src.mkdir()
        st = src.stat()
        ctx["state"]["tree_id"] = [st.st_dev, st.st_ino]
        save_state(ctx)
        if abort_at == "clone":
            os.kill(os.getpid(), signal.SIGKILL)    # before git made .git: ExecStopPost restores
        r = _sh(["git", "clone", "--quiet", "--no-checkout", "--no-hardlinks", str(HERE.parent), str(src)], {"env": env},
                timeout=600)
        if r.returncode:
            raise Refused(f"the clone failed: {r.stderr.strip()[-400:]}")
        r = _sh(["git", "-C", str(src), "checkout", "--quiet", "--detach", commit], {"env": env}, timeout=300)
        if r.returncode:
            raise Refused(f"the checkout of {commit} failed: {r.stderr.strip()[-400:]}")
        head = _sh(["git", "-C", str(src), "rev-parse", "HEAD"], {"env": env}).stdout.strip()
        ctx.update(src=src, home=home, env=env, commit=head)
        ctx["report"]["commit"] = head
        return []
    return ("clone", step)


def install(abort_at=None):
    def step(ctx):
        run, src, env = ctx["run"], ctx["src"], ctx["env"]
        log = run / "logs/install.log"
        t0 = time.monotonic()
        with open(log, "w") as f:
            p = subprocess.Popen(["bash", "./install.sh", "--yes", "--no-root"], cwd=src, env=env,
                                 stdin=subprocess.DEVNULL, stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
            ctx["state"]["installer"] = p.pid
            save_state(ctx)
            ctx["installer"] = p
            if abort_at == "installer":
                time.sleep(5)
                raise RuntimeError("abort requested during the installer (--abort-at installer)")
            try:
                rc = p.wait(timeout=INSTALL_S)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL)
                p.wait()
                rc = None
        took = time.monotonic() - t0
        ctx["report"]["install_s"] = round(took, 1)
        tail = log.read_text(errors="replace").splitlines()[-15:]
        rows = [ic.row("install-run", "PASS" if rc == 0 else "FAIL",
                       f"exit 0 after {took:.0f} s" if rc == 0 else
                       (f"timed out after {INSTALL_S} s" if rc is None else f"exit {rc} after {took:.0f} s"),
                       tail=tail if rc != 0 else None)]
        if rc != 0:
            raise StepFailed(rows, "the installer did not complete")
        home = ctx["home"]
        config = home / "linuxcnc/configs/lcnc_suite_sim"
        ctx["config"], ctx["ini"] = config, config / PROFILE
        rows.append(ic.eval_links(home, src))
        venv = src / "lcnc-gateway/.venv/bin/python3"
        r = _sh([str(venv), "-c", "import linuxcnc, fastapi, uvicorn"], ctx)
        r2 = _sh([str(venv), str(src / "lcnc-gateway/venv_check.py")], ctx)
        rows.append(ic.row("install-venv", "PASS" if r.returncode == 0 and r2.returncode == 0 else "FAIL",
                           "the venv imports linuxcnc, fastapi, uvicorn; numpy is the system's"
                           if r.returncode == 0 and r2.returncode == 0 else (r.stderr + r2.stdout + r2.stderr).strip()[-300:]))
        index = src / "lcnc-webui/dist/index.html"
        rows.append(ic.row("install-build", "PASS" if index.is_file() else "FAIL",
                           "lcnc-webui/dist/index.html built" if index.is_file() else "no dist/index.html"))
        rows.append(ic.eval_profiles(config, src / "examples/sim_config/profiles.json"))
        r = _sh(["python3", str(src / "scripts/config_sync_check.py"), "--repo", str(src / "examples/sim_config"),
                 "--deployed", str(config)], ctx)
        rows.append(ic.row("install-config-sync", "PASS" if r.returncode == 0 else "FAIL",
                           f"exit {r.returncode}: " + r.stdout.strip().splitlines()[-1][:200] if r.stdout.strip()
                           else f"exit {r.returncode}"))
        r = _sh(["git", "-C", str(src), "status", "--porcelain", "--untracked-files=no"], ctx)
        rows.append(ic.eval_clean_clone(r.stdout if r.returncode == 0 else f"?? git status failed: {r.stderr}"))
        # the native stage's checks on what the REAL installer made (FI329-02),
        # `~` resolved in the sandbox's home as LinuxCNC there will
        path = lt.linuxcnc_path(env["PATH"], home=home)
        which = lambda n: shutil.which(n, path=path)  # noqa: E731
        saved = os.environ.get("HOME")
        os.environ["HOME"] = str(home)
        try:
            try:
                lt.check_copy(str(ctx["ini"]), str(src / "examples/sim_config"), which)
                target = []
            except ValueError as e:
                target = [str(e)]
            confined = lt.confinement_problems(ctx["ini"], run, src)
        finally:
            os.environ["HOME"] = saved or ""
        rows.append(ic.row("install-target", "FAIL" if target else "PASS",
                           target[0] if target else "the installed profile is the shipped simulator; every program "
                                                    "its HAL starts by name resolves into the clone"))
        rows.append(ic.row("install-confinement", "FAIL" if confined else "PASS",
                           "; ".join(confined) if confined else "every mutable path of the profile lies in the run"))
        if any(r["status"] != "PASS" for r in rows):
            raise StepFailed(rows, "the installed result does not hold — not started")
        return rows
    return ("install", step)


def start(abort_at=None):
    def step(ctx):
        from test_support.system_host import SystemHost
        run, ini = ctx["run"], ctx["ini"]
        env = {**ctx["env"], "LCNC_WEBUI_BROWSER": "0", "LCNC_WEBUI_DEV": "0", "LCNC_WEBUI_HOST": "127.0.0.1"}
        unit = f"{UNIT}-{run.name}"
        ctx["state"].update(test_unit_intent=unit, test_unit_wd=str(ctx["config"]), test_ini=str(ini))
        save_state(ctx)
        subprocess.run(["systemd-run", "--user", f"--unit={unit}", "-p", f"WorkingDirectory={ctx['config']}"]
                       + [f"-E{k}={v}" for k, v in env.items()] + ["linuxcnc", str(ini)], check=True, capture_output=True)
        sh = SystemHost()
        invocation = sh.unit_status(unit)["invocation"]
        if not invocation:
            raise Refused(f"{unit} started without an InvocationID — its ownership is not proven")
        ctx["state"].update(test_unit=unit, test_unit_invocation=invocation)
        save_state(ctx)
        if abort_at == "start":
            time.sleep(8)       # inside the start: LinuxCNC and the launcher are coming up
            os.kill(os.getpid(), signal.SIGKILL)    # the orchestrator dies: ExecStopPost restores
        t0 = time.monotonic()
        if not sh.wait_ready(READY_S):
            raise StepFailed([ic.row("start-ready", "FAIL", f"/ready did not answer within {READY_S} s")],
                             "the installed suite did not start")
        ctx["t_ready"] = time.monotonic()
        rows = [ic.row("start-ready", "PASS", f"/ready after {ctx['t_ready'] - t0:.0f} s")]
        inst = sh.unit_instance(unit)
        if not inst or not sh.unit_owns(unit, inst[1]):
            raise StepFailed(rows + [ic.row("start-instance", "FAIL", f"no LinuxCNC instance of {unit}")],
                             "no instance of the test unit")
        ctx["state"]["test_instance"] = [inst[1], inst[2]]
        save_state(ctx)
        procs = lt.read_procs()
        src = ctx["src"]
        problems = lt.process_problems(procs, src, ini, venv=(src / "lcnc-gateway/.venv").resolve())
        gw = next((p for p in procs if "gateway:app" in p["cmdline"]), None)
        problems += lt.log_problems(lt.open_files(gw["pid"]), run / "logs") if gw else []
        problems += lt.launcher_log_problems(procs, run / "logs", lt.proc_env)
        rows.append(ic.row("start-processes", "FAIL" if problems else "PASS",
                           "; ".join(problems[:4]) if problems else "launcher, gateway, helpers and the tool setter's "
                           "feed run the clone's code with the installed profile; logs in the run"))
        ctx["gw_pid"] = gw["pid"] if gw else None
        if problems:
            raise StepFailed(rows, "the started processes are not the installed ones")
        return rows
    return ("start", step)


class _ProbeClient:
    """The probe's own UNARMED client: heartbeats from the connect to the
    stop (FI329-01), and every status frame's envelope (the banner fields the
    test client does not keep) with its data."""

    def __new__(cls, *a, **kw):
        from test_support.live_session import SimulatorClient

        class Client(SimulatorClient):
            def __init__(self):
                super().__init__("", session="install-probe", auto_confirm=False,
                                 keep=("comp_grid_version", "task_state"))
                self.envelopes = []

            def take(self, msg, confirmed=None):
                if msg.get("type") in ("status", "status_delta") and isinstance(msg.get("data"), dict):
                    self.envelopes.append((time.monotonic(),
                                           {k: msg.get(k) for k in ("safety_chain_incomplete", "reader_stale",
                                                                    "safety_trip")}))
                return super().take(msg, confirmed)
        return Client()


def safety():
    def step(ctx):
        client = _ProbeClient()
        ctx["client"] = client
        client.start(arm=False)
        until = ctx["t_ready"] + ic.SAFETY_GRACE_S + ic.SAFETY_MARGIN_S + ic.SAFETY_WINDOW_S + 1.0
        while time.monotonic() < until:
            if client.error:
                raise StepFailed([ic.row("start-safety-chain", "FAIL", f"the client lost its connection: {client.error}")],
                                 "the probe's client lost the gateway")
            time.sleep(0.2)
        ctx["is_estop"] = client.status.get("is_estop")
        # each status frame: its envelope and the kept data, paired by order
        frames = [(t, env, data) for (t, env), (_t2, data) in zip(client.envelopes, client.frames)]
        events = []
        trace = ctx["run"] / "logs/trace.ndjson"
        for line in trace.read_text(errors="replace").splitlines() if trace.is_file() else []:
            try:
                events.append(json.loads(line))
            except ValueError:
                continue
        hal = {}
        for key, pin in (("latch_fault", "webui-hb-latch.fault-out"), ("oneshot_out", "oneshot.0.out")):
            r = _sh(["halcmd", "getp", pin], ctx)
            hal[key] = r.stdout.strip() if r.returncode == 0 else None
        ctx["report"]["safety"] = {"frames": len(frames), "hal": hal,
                                   "events": [e.get("tag") for e in events if e.get("pid") == ctx.get("gw_pid")][:40]}
        rows = [ic.eval_safety(frames, events, hal, ctx.get("gw_pid"), ctx["t_ready"])]
        if rows[0]["status"] != "PASS":
            raise StepFailed(rows, "the safety chain is not proven")
        return rows
    return ("safety", step)


def browser():
    def step(ctx):
        src, run = ctx["src"], ctx["run"]
        out = run / "browser.json"
        # the state the browser must show: the instance's own E-Stop as the
        # probe's client received it — a fresh instance boots in E-Stop, and
        # without a status the app shows none (Codex R330 FI-I61)
        if ctx.get("is_estop") is not True:
            raise StepFailed([ic.row("start-browser", "incomplete",
                                     f"the instance's is_estop is {ctx.get('is_estop')!r}, not the boot E-Stop the "
                                     "browser's status is checked by")], "no state to check the browser by")
        env = {**ctx["env"], "PLAYWRIGHT_BROWSERS_PATH": str(BROWSERS)}
        r = _sh(["node", str(src / "scripts/install_probe_browser.mjs"), "--webui", str(src / "lcnc-webui"),
                 "--url", "http://127.0.0.1:8000/", "--out", str(out), "--expect-estop"], ctx, timeout=BROWSER_S, env=env)
        result = json.loads(out.read_text()) if out.is_file() else {"error": (r.stderr or r.stdout).strip()[-300:]}
        ctx["report"]["browser"] = result
        ctx["report"]["browsers_shared"] = str(BROWSERS)
        rows = [ic.eval_browser(result)]
        if rows[0]["status"] != "PASS":
            raise StepFailed(rows, "the built UI did not start")
        return rows
    return ("browser", step)


def _close(ctx):
    """The client's end (no abort, no arm: it never armed) and an installer
    still running after an abort (its own session) — before the restore."""
    client = ctx.pop("client", None)
    if client:
        client.drop()
    p = ctx.pop("installer", None)
    if p is not None and p.poll() is None:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        p.wait()


def unit_of(cgroup: str) -> str | None:
    """The unit a process runs in, from /proc/<pid>/cgroup: the LAST
    `.service` of the path — a user unit sits under user@<uid>.service."""
    parts = [p for p in cgroup.strip().split("/") if p.endswith(".service")]
    return parts[-1] if parts else None


def in_probe_unit() -> bool:
    """This process is the main process of a user unit whose ExecStopPost is
    the install probe's restore."""
    if not os.environ.get("INVOCATION_ID"):
        return False
    try:
        unit = unit_of(Path("/proc/self/cgroup").read_text())
    except OSError:
        return False
    if not unit:
        return False
    out = subprocess.run(["systemctl", "--user", "show", unit, "-p", "ExecStopPost", "-p", "MainPID", "--no-pager"],
                         capture_output=True, text=True).stdout
    return "install_restore.py" in out and f"MainPID={os.getpid()}" in out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-dir", type=Path, required=True)
    ap.add_argument("--commit", default="HEAD")
    ap.add_argument("--run-id", help="the merge gate's id of this run, written into the report (FI-I59)")
    ap.add_argument("--abort-at", choices=("clone", "installer", "start"),
                    help="an abort probe: the orchestrator killed before the clone has .git, an exception during "
                         "the installer, the orchestrator killed during the start")
    a = ap.parse_args(argv)
    if not in_probe_unit():
        print("install_probe: runs only in a user unit with the install restore as its ExecStopPost (see --help)")
        return 2
    commit = subprocess.run(["git", "-C", str(HERE.parent), "rev-parse", a.commit], capture_output=True, text=True,
                            check=True).stdout.strip()
    host = ic.InstallProbeHost(run=a.run_dir)
    steps = [clone(commit, a.abort_at), install(a.abort_at), start(a.abort_at), safety(), browser()]

    with heavy_lock("install_probe", wait=0):
        report = run(host, steps, a.run_dir)
    report["verdict"] = verdict(report)
    report["run_id"] = a.run_id
    report["abort_at"] = a.abort_at
    write_json(a.run_dir / "report.json", report)
    print(f"install_probe: {report['verdict']} — restore {report['restore']['outcome']} → {a.run_dir / 'report.json'}")
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

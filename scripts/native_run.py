#!/usr/bin/env python3
"""The native stage: cases on the VM's REAL LinuxCNC (plan Codex R282–R285,
the run contract R268/R269 FI265-04). Build step 1, the vertical slice:

  heavy lock → record the LAN instance (a trip nobody acknowledged refuses)
  → stop it, hash the operator's files → a run tree of the tested commit
  (its own build, a REAL node_modules copy) → the copy (install_examples
  --nc-files/--macro-dir relative, --confine the run) → the target check
  BEFORE the start (the copy as the template renders it, every mutable path
  and folder in the run, every helper the HAL starts by name the run tree's)
  → start (DISPLAY absolute, PATH=<run>/bin with the run tree's helpers)
  → the process proof → the cases (Home All, Home per joint 0/1/2, jog per
  axis and sign) → the report → the restore in `finally`.

Never imports linuxcnc or hal: the gateway by its WebSocket, HAL by halcmd.
It runs only as a user unit whose ExecStopPost is the restore, so a killed
orchestrator still gives the LAN instance back:

  RUN=~/claude-work/live-tier/$(date +%Y%m%dT%H%M%S); PY=<worktree>/lcnc-gateway/.venv/bin/python3
  systemd-run --user --unit=native-run -p WorkingDirectory=<worktree> \\
    -p "ExecStopPost=$PY -I <worktree>/scripts/test_support/restore_lan.py --from $RUN/pre.json --out $RUN/restore-post.json" \\
    $PY -I <worktree>/scripts/native_run.py --run-dir $RUN --commit <commit>
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from test_support import live_target as lt  # noqa: E402
from test_support import native_cases as nc  # noqa: E402
from test_support import restore_lan as rl  # noqa: E402
from test_support.heavy_lock import heavy_lock  # noqa: E402

PROFILES = {"3axis_xyz": ("lcnc_suite_sim_3axis_xyz.ini", 3)}
UNIT = "native-sim"
#: The suite's programs the copy's HAL starts by name — linked in <run>/bin to the RUN tree's.
HELPERS = {"hal_reader.py": "lcnc-gateway/hal_reader.py", "hal_watchdog.py": "lcnc-gateway/hal_watchdog.py",
           "compensation.py": "subroutines/surfacemap/compensation.py", "lcnc-suite": "lcnc-suite"}
NC_FILES, MACROS = "nc_files", "macros"
JOG_START = (300.0, 300.0, -50.0)   # G53, inner: away from every limit (R283 FI282-05)


class Refused(RuntimeError):
    """A precondition of the run does not hold — nothing of the machine was touched past it."""


def write_json(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, default=str) + "\n")
    tmp.replace(path)


def run(host, steps, run_dir: Path) -> dict:
    """The core: record, stop, the steps, the restore in `finally`. `steps`
    is a list of (name, fn(ctx)) — fn returns rows or raises. pre.json is on
    disk from the record on, with the hashes from the stop on: whatever kills
    this process, ExecStopPost restores from it."""
    # a NEW, empty run folder — nothing in it was put there before the run (R286 FI-I20)
    run_dir.parent.mkdir(parents=True, exist_ok=True)
    run_dir.mkdir()
    report: dict = {"started": time.time(), "steps": [], "rows": []}
    pre = rl.record(host)                     # raises TakeOverRefused: nothing touched
    pre_path = run_dir / "pre.json"
    write_json(pre_path, pre)
    ctx = {"run": run_dir, "pre": pre, "report": report}
    try:
        rl.stop_lan(host, pre)
        write_json(pre_path, pre)             # with the hashes the stop left
        for name, fn in steps:
            report["steps"].append(name)
            rows = fn(ctx) or []
            report["rows"] += rows
    except Exception as e:  # noqa: BLE001 — every failure ends in the restore and the report
        report["error"] = f"{type(e).__name__}: {e}"
        report["traceback"] = traceback.format_exc()
    finally:
        cleanup = ctx.get("cleanup")
        if cleanup:
            try:
                cleanup()
            except Exception as e:  # noqa: BLE001
                report["cleanup_error"] = f"{type(e).__name__}: {e}"
        report["restore"] = rl.restore(host, pre)
        report["ended"] = time.time()
        write_json(run_dir / "report.json", report)
    return report


def verdict(report: dict) -> str:
    """PASS only with every row PASS, no error, the LAN returned complete and
    its isolation proven (an empty list — None was proven elsewhere)."""
    if report.get("error") or report.get("cleanup_error"):
        return "FAIL"
    r = report.get("restore", {})
    if r.get("outcome") != "complete" or r.get("isolation"):
        return "FAIL"
    rows = report.get("rows", [])
    if not rows or any(x["status"] != "PASS" for x in rows):
        return "FAIL" if any(x["status"] == "FAIL" for x in rows) else "incomplete"
    return "PASS"


# ── The real steps ──────────────────────────────────────────────────────

def in_restore_unit(unit: str = "native-run") -> bool:
    """This process runs in the user unit whose ExecStopPost is the restore."""
    if not os.environ.get("INVOCATION_ID"):
        return False
    out = subprocess.run(["systemctl", "--user", "show", unit, "-p", "ExecStopPost", "-p", "MainPID", "--no-pager"],
                         capture_output=True, text=True).stdout
    return "restore_lan.py" in out and f"MainPID={os.getpid()}" in out


def make_tree(commit: str, profile: str):
    def step(ctx):
        run = ctx["run"]
        tree = run / "tree"
        subprocess.run(["git", "-C", str(HERE.parent), "worktree", "add", "--detach", str(tree), commit],
                       check=True, capture_output=True)
        ctx["cleanup_tree"] = tree
        src = HERE.parent / "lcnc-webui/node_modules"
        subprocess.run(["cp", "-a", "--reflink=auto", str(src), str(tree / "lcnc-webui/node_modules")], check=True)
        same = lt.shared_inodes(tree / "lcnc-webui/node_modules", src)
        if same:
            raise Refused(f"node_modules shares files with the original ({', '.join(same)}) — no copy")
        venv = HERE.parent / "lcnc-gateway/.venv"
        (tree / "lcnc-gateway/.venv").symlink_to(venv.resolve())   # read-only shared resource (R269), its freeze in the report
        ctx["report"]["venv"] = {"path": str(venv.resolve()), "freeze": subprocess.run(
            [str(venv / "bin/python3"), "-m", "pip", "freeze"], capture_output=True, text=True).stdout}
        b = subprocess.run(["npm", "run", "build"], cwd=tree / "lcnc-webui", capture_output=True, text=True)
        if b.returncode:
            raise Refused(f"the run tree's build failed: {b.stdout[-400:]}{b.stderr[-400:]}")
        ctx["tree"] = tree
        ctx["commit"] = ctx["report"]["commit"] = subprocess.run(["git", "-C", str(tree), "rev-parse", "HEAD"],
                                                                 capture_output=True, text=True, check=True).stdout.strip()
        ctx["report"]["profile"] = profile
        return []
    return ("tree", step)


def make_copy(profile: str):
    def step(ctx):
        run, tree = ctx["run"], ctx["tree"]
        config = run / "configs/sim"
        r = subprocess.run([sys.executable, "-I", str(tree / "scripts/install_examples.py"), "--repo", str(tree),
                            "--destination", str(config), "--backup-root", str(run / "config-backups/sim"),
                            "--nc-files", NC_FILES, "--macro-dir", MACROS, "--confine", str(run)],
                           capture_output=True, text=True)
        if r.returncode:
            raise Refused(f"the copy was refused: {r.stderr.strip()[-400:]}")
        # named .local/bin: the installed `linuxcnc` script puts ~/.local/bin (the
        # MAIN checkout's links) first when PATH holds no ".local/bin" (R286 FI-I18)
        bin_ = run / ".local/bin"
        bin_.mkdir(parents=True)
        for name, rel in HELPERS.items():
            (bin_ / name).symlink_to(tree / rel)
        ini = config / PROFILES[profile][0]
        path = f"{bin_}:/usr/local/bin:/usr/bin:/bin"
        effective = lt.linuxcnc_path(path)            # what HAL will search: the launcher's own rule
        which = lambda n: shutil.which(n, path=effective)  # noqa: E731
        try:
            lt.check_copy(str(ini), str(tree / "examples/sim_config"), which, nc_files=NC_FILES, macro_dir=MACROS)
        except ValueError as e:
            raise Refused(f"target check: {e}") from None
        problems = lt.confinement_problems(ini, run, tree)
        if problems:
            raise Refused("paths: " + "; ".join(problems))
        ctx.update(config=config, ini=ini, path=path)
        return []
    return ("copy", step)


def start_copy():
    def step(ctx):
        run, ini = ctx["run"], ctx["ini"]
        env = {"PATH": ctx["path"], "LCNC_LOG_DIR": str(run / "logs"), "PYTHONPYCACHEPREFIX": str(run / "pycache"),
               "LCNC_WEBUI_BROWSER": "0", "LCNC_WEBUI_HOST": "127.0.0.1", "LCNC_WEBUI_DEV": "0"}
        (run / "logs").mkdir(exist_ok=True)
        subprocess.run(["systemctl", "--user", "reset-failed", UNIT], capture_output=True)
        subprocess.run(["systemd-run", "--user", f"--unit={UNIT}", "-p", f"WorkingDirectory={ctx['config']}"]
                       + [f"-E{k}={v}" for k, v in env.items()] + ["linuxcnc", str(ini)], check=True, capture_output=True)
        ctx["cleanup"] = lambda: _stop_copy(ctx)
        if not rl_host_ready(180):
            raise Refused("the copy's gateway did not answer /ready within 180 s")
        procs = lt.read_procs()
        problems = lt.process_problems(procs, ctx["tree"], ini, venv=(HERE.parent / "lcnc-gateway/.venv").resolve())
        gw = next((p for p in procs if "gateway:app" in p["cmdline"]), None)
        problems += lt.log_problems(lt.open_files(gw["pid"]), run / "logs") if gw else []
        if problems:
            raise Refused("process proof: " + "; ".join(problems))
        log_env = _launcher_env(ini).get("LCNC_RESOLVED_LOG_DIR")
        if log_env is None or Path(log_env).resolve() != (run / "logs").resolve():
            raise Refused(f"the launcher logs to {log_env}, not the run's folder")
        return []
    return ("start", step)


def rl_host_ready(timeout) -> bool:
    from test_support.system_host import SystemHost
    return SystemHost().wait_ready(timeout)


def _launcher_env(ini: Path) -> dict:
    for p in lt.read_procs():
        c = p["cmdline"]
        if len(c) >= 4 and c[1].endswith("/lcnc-suite") and c[2] == "-ini" and Path(c[3]).resolve() == ini.resolve():
            raw = Path(f"/proc/{p['pid']}/environ").read_bytes()
            return dict(kv.split("=", 1) for kv in raw.decode(errors="replace").split("\0") if "=" in kv)
    return {}


def _stop_copy(ctx):
    client = ctx.pop("client", None)
    if client:
        try:
            client.close()        # aborts and disarms its own instance, then closes
        except Exception:  # noqa: BLE001
            pass
    subprocess.run(["systemctl", "--user", "stop", UNIT], capture_output=True)
    tree = ctx.get("cleanup_tree")
    if tree:
        subprocess.run(["git", "-C", str(HERE.parent), "worktree", "remove", "--force", str(tree)], capture_output=True)


def connect_client():
    def step(ctx):
        from test_support.live_session import SimulatorClient
        token = (lt.ini_values(ctx["ini"].read_text()).get(("DISPLAY", "WEBUI_TOKEN")) or [""])[-1]
        frames: list = []
        client = SimulatorClient(token, session="native-stage", auto_confirm=False,
                                 on_status=lambda t, st: frames.append((t, st)))
        client.start()
        ctx.update(client=client, frames=frames)
        client.request("estop_reset")
        _wait(client, lambda s: s.get("is_estop") is False, 10, "E-Stop reset")
        client.request("machine_on")
        _wait(client, lambda s: s.get("is_enabled") is True, 10, "machine on")
        return []
    return ("connect", step)


def _wait(client, pred, timeout, what):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if client.error:
            raise RuntimeError(client.error)
        if pred(client.status):
            return dict(client.status)
        time.sleep(0.02)
    raise RuntimeError(f"{what}: not reached within {timeout} s")


def home_cases(joints: int):
    def step(ctx):
        c, rows = ctx["client"], []
        for case, joint in [("home-all", None)] + [(f"home-joint-{j}", j) for j in range(joints)]:
            c.request("unhome_all")
            _wait(c, lambda s: s.get("homed_joints") is not None and not any(s["homed_joints"]), 15, "unhomed")
            expected = [True] * joints if joint is None else [j == joint for j in range(joints)]
            c.request("home_all") if joint is None else c.request("home", joint=joint)
            try:
                st = _wait(c, lambda s: (s.get("homed_joints") or []) == expected and s.get("inpos"), 60, case)
                observed, completed = st.get("homed_joints"), True
            except RuntimeError:
                # the bits alone are no PASS: the completion never came (R286 FI-I22)
                observed, completed = c.status.get("homed_joints"), False
            rows.append(nc.eval_home(case, expected, observed, completed))
        c.request("home_all")
        _wait(c, lambda s: all(s.get("homed_joints") or [False]) and s.get("inpos"), 60, "homed for the jogs")
        return rows
    return ("home", step)


def jog_cases(joints: int):
    def step(ctx):
        c, frames, rows = ctx["client"], ctx["frames"], []
        start = "G53 G0 " + " ".join(f"{a}{v:g}" for a, v in zip("XYZ", JOG_START))
        for axis in range(joints):
            for sign in (1, -1):
                case = f"jog-{'xyz'[axis]}{'+' if sign > 0 else '-'}"
                c.request("mdi", text=start)
                _wait(c, lambda s: s.get("inpos") and s.get("interp_state") == 1 and _near(s, JOG_START), 30, "the jog start")
                c.request("set_mode", mode=1)   # MANUAL for the jog
                p0 = c.status["joint_pos"][axis]
                c.request("jog_cont", axis=axis, vel=sign * nc.JOG_SPEED)
                time.sleep(0.3)
                c.request("jog_stop", axis=axis)
                t_reply = time.monotonic()
                time.sleep(1.0)
                after = [(t - t_reply, st) for t, st in list(frames) if t >= t_reply]
                # the anchor: the FIRST status frame after the reply, with its age (R286 FI-I23)
                anchor, age = (_pos(after[0][1], axis), after[0][0]) if after else (float("nan"), float("nan"))
                samples = [(t, _pos(st, axis), _vel(st)) for t, st in after]
                rows.append(nc.eval_jog(case, axis, sign, p0, anchor, samples, anchor_age=age))
        return rows
    return ("jog", step)


def _pos(st, axis):
    pos = st.get("joint_pos")
    return pos[axis] if isinstance(pos, list) and len(pos) > axis else None


def _vel(st):
    v = st.get("current_vel")
    return abs(v) if isinstance(v, (int, float)) else None   # unknown stays unknown, never 0


def _near(st, target, tol=0.01) -> bool:
    pos = st.get("joint_pos") or []
    return len(pos) >= len(target) and all(abs(p - t) <= tol for p, t in zip(pos, target))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-dir", type=Path, required=True)
    ap.add_argument("--commit", default="HEAD")
    ap.add_argument("--profile", default="3axis_xyz", choices=sorted(PROFILES))
    a = ap.parse_args(argv)
    if not in_restore_unit():
        print("native_run: runs only in the user unit `native-run` with the restore as its ExecStopPost (see --help)")
        return 2
    from test_support.system_host import SystemHost
    joints = PROFILES[a.profile][1]
    with heavy_lock("native_run", wait=0):
        report = run(SystemHost(), [make_tree(a.commit, a.profile), make_copy(a.profile), start_copy(),
                                    connect_client(), home_cases(joints), jog_cases(joints)], a.run_dir)
    report["verdict"] = verdict(report)
    write_json(a.run_dir / "report.json", report)
    print(f"native_run: {report['verdict']} — restore {report['restore']['outcome']} → {a.run_dir / 'report.json'}")
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

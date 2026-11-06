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

Build step 2a (plan R283–R285): Z probing on the plate (+ the miss beyond the
search depth, a planted plate 1 mm off), M600 (unload T0, measure T1 with the
override lock, #3102 planted 1 mm off, the reset read back) and the M6 hold.
The client confirms nothing itself: every routine runs under the M6 helper
(test_support/tool_change.py) with its declared changes, fed the frames the
client RECEIVED, in order (R292 FI-I24); a routine ends on the interpreter
seen busy, then idle, AND its effect, judged on every frame (FI-I25).
Step 2b, run from line (contract FI292-01): the run writes and loads its
program, sends ONE auto_run as the UI does and judges the frames received
(the witness of line 7, the line's and the program's end, no earlier line
seen, the start point, the L+1 counter). The start point, the override
plateau and the retract path wait for the servo measurement, step 2c.

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
from contextlib import contextmanager
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
#: the case ids, LITERAL: a native evidence names its case and the binder
#: finds the title in this file (an f-string over expressions it cannot)
HOME_CASES = (("home-all", None), ("home-joint-0", 0), ("home-joint-1", 1), ("home-joint-2", 2))
#: where X and Y leave their sim home switches open: the switches close at
#: motor X > 1, Y > 0.5 (simulated_home_probe_basic.hal, hysteresis 0.02) and
#: a homed X or Y rests ON its latch (HOME = HOME_OFFSET = 0) — LinuxCNC
#: refuses a home with its shared switch closed ("Cannot home while shared
#: home switch is closed", live run 2026-11-05); the X/Y limit is -0.1
HOME_OFF_SWITCH = (-0.08, -0.08, 0.0)
JOG_CASES = (("jog-x+", 0, 1), ("jog-x-", 0, -1), ("jog-y+", 1, 1), ("jog-y-", 1, -1), ("jog-z+", 2, 1),
             ("jog-z-", 2, -1))
#: the same jogs judged from servo samples (step 2c) — F-JOG.S5 binds these
JOG_SERVO_CASES = {"jog-x+": "jog-x+.servo", "jog-x-": "jog-x-.servo", "jog-y+": "jog-y+.servo",
                   "jog-y-": "jog-y-.servo", "jog-z+": "jog-z+.servo", "jog-z-": "jog-z-.servo"}
#: what a case reads from a status frame — kept per frame, the rest is not
FRAME_KEYS = ("joint_pos", "current_vel", "interp_state", "inpos", "feed_override_enabled", "tool_number",
              "tool_offset", "tool_table_z", "tool_change_requested", "tool_change_seq", "tool_change_tool",
              "g5x_index", "g5x_offset", "motion_line", "call_level", "task_mode", "spindle_direction",
              "spindle_speed", "is_estop", "is_enabled")
# step 2a (plan R283–R285 FI282-05): the probe tool T99 at L0 = 50, started
# 8 mm over its contact (joint Z = plate + L0) inside #3020 = 10; the miss 15
# mm over it; the toolsetter's values as the copy ships them, #3005 slow 20
PROBE_TOOL, PROBE_L0 = 99, 50.0
PROBE_OVER, MISS_OVER = 8.0, 15.0
PROBE_VARS = (3014, 3015, 3016, 3017, 3020, 3021, 3030)          # what probe_z_minus_wco reads
TOOLSETTER_VARS = (3004, 3005, 3006, 3007, 3009, 3010, 3013) + tuple(range(3100, 3116))   # toolsetterVarMap
M600_SLOW = 20.0
#: M600's return (#3106 = 1) ends at the top of travel — the routine's
#: drive-free G53 Z0 (Z0 is the top on every config); since 2026-11-05 it
#: never puts the new TIP back at the start Z (from the top with a longer tool
#: that asked for the spindle past the Z limit — the first live runs)
M600_TOP_Z = 0.0
#: a write or start right after a routine waits this long for the gateway to
#: release the routine's start claim (~0.3 s after an error, live run 2026-11-05)
CLAIM_WAIT_S = 3.0
#: parameters per tagged DEBUG read ("P3100=#3100 " is 12 characters)
VARS_PER_READ = 12
MEASURED_TOOL = 1       # its case ids below name it literally ("m600-t1")
HOLD_S = 5.0
M6_DEADLINE = 60.0      # s for the held change to complete
# step 2b, run from line (Codex R292 FI292-01): the program the run writes
# into the copy's nc_files. Line 7 starts from the entry the dialog derives
# (X100 Y100 in G54, G21 — scanEntryPositionBefore); every Z keeps the joint
# within its window with T1's 50 mm (program Z + length ≤ 0). Z descends only
# by the program's own words (the dialog: "Z descends from safe height per the
# program's own words"): lines 7 and 8 run at the safe height the entry left,
# line 9 takes the joint to -30 (live run 2026-11-05 — the first expectation,
# line 7 at the skipped G0 Z-100, was the test's error)
RFL_PROGRAM = "\n".join([
    "(native stage: run from line - Codex R292 FI292-01)",
    "G21 G90 G94 G17 G54",
    "T1 M600",
    "S1000 M3",
    "G0 X100 Y100",
    "G0 Z-100",
    "G61.1 G1 X200 F3000",
    "G1 Y200",
    "G0 Z-80",
    "M5",
    "M2"]) + "\n"
RFL_FILE, RFL_LINE, RFL_ENTRY, RFL_SPEED = "native_rfl.ngc", 7, (100.0, 100.0), 1000.0
RFL_Z_LINE, RFL_Z_END = -100.0, -80.0
#: 2c-b (Codex R309–R310): G61.1 on line 7 itself (exact stop, modal: 8 and 9
#: too — a skipped line would not set it), so each line's axes are its own in
#: the servo stream; the routine's motion lines (from the run tree's text)
#: never meet the program's 1…N
#: — each text bound to the one checked (Codex R311 FI-I42): the routine is
#: MARKED_POS_ROUTINES' (gateway_util), the wrapper has no motion line
ROUTINE_TEXTS = {
    "subroutines/tool_length_probe/tool_touch_off.ngc":
        "4990c7b303cb43bf0aa8cb11948277072874558f5902d3c48a59133ec555097d",
    "subroutines/tool_length_probe/m600.ngc": "acbaeb68313eb7f769eea45f5b1bf83455d55976515857f47811c1d0d773e919"}
RFL_SAFE_Z = 0.0        # the joint Z the safe-Z step leaves (G53 Z0) — lines 7 and 8 run there
#: P2 (Codex R308–R309): a PROGRAM's M600 after a section saved with the
#: machine off; then a program with no motion — the same section, no write
TS_FILE, TS_IDLE_FILE = "native_ts_sync.ngc", "native_ts_idle.ngc"
TS_PROGRAM = f"G21 G90\nT{MEASURED_TOOL} M600\nM2\n"
TS_IDLE_PROGRAM = "G21 G90\nM2\n"
TS_DEADLINE = 240.0
#: step 3, the latch (plan Codex R283–R285, R313–R316): the gateway stopped
#: past the 0.5 s oneshot budget, then the post window; the recovery's own
#: post window. A variant is a run of its own — one instance each (R313 point 2)
LATCH_STOP_S, LATCH_POST_S, RECOVERY_POST_S = 0.9, 1.5, 1.0
VARIANTS = ("latch-delayed",)
#: step 3, the disconnect (SYS-CONN.S4): X back and forth at F6000 in the
#: machine frame (~20 s); a helper client A in its own process starts it and
#: goes away; the event read from the trace, then the window W
DISC_FILE = "native_disconnect.ngc"
DISC_PROGRAM = "\n".join(["G21 G90 G94", "G53 G0 Z0", "G53 G0 X100 Y300", "G53 G1 X600 F6000",
                           "G53 G1 X100", "G53 G1 X600", "G53 G1 X100", "M2"]) + "\n"
DISC_EVENT_S = {"close": 10.0, "heartbeat": 8.0}   # the gateway's own event, at most this long after
DISC_WINDOW_S = 3.0                                # observed after W (≥ 2 s proven from the periods)
#: step 3, many clients (SYS-CONN.S1): the perf matrix's big program (its
#: random walk, seed 42, 40 MB) without its tool change; N unarmed clients
#: fetch /preview at once after the load is published
CLIENTS_N, CLIENTS_MB = (4, 8), 40
CLIENTS_PRE_S, CLIENTS_TAIL_S, CLIENTS_POST_S = 1.3, 5.0, 1.3
CLIENTS_PUBLISH_S = 600.0
RFL_DEADLINE = 300.0    # s: the pre-measurement, the entry and the program
# step 2c (plan Codex R299–R301)
PLATEAU_START, PLATEAU_END, PLATEAU_FEED = (100.0, 300.0, -50.0), 500.0, 6000.0
GOTO_START, GOTO_G54 = (200.0, 200.0, -60.0), (100.0, 100.0)
SHORT_GRACE = 2.0       # s: a block too short to show busy ends after this idle time (the gateway's own rule)
DEBUG_WAIT = 3.0        # s for a DEBUG line to come back through the error channel, per attempt


class Refused(RuntimeError):
    """A precondition of the run does not hold — nothing of the machine was touched past it."""


class StepFailed(RuntimeError):
    """A step that ends the run after measuring: its rows stay in the report
    (a sequence that ends FAIL takes its instance down — R283 FI282-02)."""

    def __init__(self, rows: list[dict], reason: str):
        super().__init__(reason)
        self.rows = rows


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
    # what the run OWNS — its tree, its test unit — on disk before each exists
    # (R286 FI-I19): ExecStopPost ends them from here when this process died
    ctx = {"run": run_dir, "pre": pre, "report": report, "state": {}}
    try:
        rl.stop_lan(host, pre)
        write_json(pre_path, pre)             # with the hashes the stop left
        for name, fn in steps:
            report["steps"].append(name)
            ctx["rows"] = []            # the step's rows as it measures them: kept on ANY exception
            rows = fn(ctx) or []
            report["rows"] += rows
    except Exception as e:  # noqa: BLE001 — every failure ends in the restore and the report
        rows = getattr(e, "rows", None)
        report["rows"] += rows if rows is not None else ctx.get("rows", [])
        report["error"] = f"{type(e).__name__}: {e}"
        report["traceback"] = traceback.format_exc()
    finally:
        cleanup = ctx.get("cleanup")
        if cleanup:
            try:
                cleanup()
            except Exception as e:  # noqa: BLE001
                report["cleanup_error"] = f"{type(e).__name__}: {e}"
        report["restore"] = rl.restore(host, pre, ctx["state"], first=run_dir / "restore.json",
                                       save=lambda st: write_json(run_dir / "state.json", st))
        write_json(run_dir / "state.json", ctx["state"])
        report["ended"] = time.time()
        write_json(run_dir / "report.json", report)
    return report


def verdict(report: dict) -> str:
    """PASS only with every row PASS, no error, the run's own resources ended,
    the LAN returned complete and its isolation proven (an empty list)."""
    if report.get("error") or report.get("cleanup_error"):
        return "FAIL"
    r = report.get("restore", {})
    # isolation: [] is proven; a list names what changed; None was never proven (R286 FI-I21)
    if r.get("outcome") != "complete" or r.get("isolation") != [] or r.get("cleanup"):
        return "FAIL"
    # an informational row (the status-frame jog beside its servo row, R302
    # FI-I35) decides only with a contradiction — its missing proof never
    rows = [x for x in report.get("rows", []) if not (x.get("informational") and x["status"] != "FAIL")]
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
        ctx["state"].update(tree=str(tree), tree_of=str(HERE.parent))
        save_state(ctx)
        subprocess.run(["git", "-C", str(HERE.parent), "worktree", "add", "--detach", str(tree), commit],
                       check=True, capture_output=True)
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
        # one unit name per run, never reused: a name intended is no unit owned
        # (R287 FI-I19 B) — ownership is the InvocationID the START gave
        unit = f"{UNIT}-{run.name}"
        # what identifies the start if this process dies before its ownership is written (R288)
        ctx["state"].update(test_unit_intent=unit, test_unit_wd=str(ctx["config"]), test_ini=str(ini))
        save_state(ctx)
        subprocess.run(["systemd-run", "--user", f"--unit={unit}", "-p", f"WorkingDirectory={ctx['config']}"]
                       + [f"-E{k}={v}" for k, v in env.items()] + ["linuxcnc", str(ini)], check=True, capture_output=True)
        from test_support.system_host import SystemHost
        sh = SystemHost()
        invocation = sh.unit_status(unit)["invocation"]
        if not invocation:
            raise Refused(f"{unit} started without an InvocationID — its ownership is not proven")
        ctx["state"].update(test_unit=unit, test_unit_invocation=invocation)
        save_state(ctx)
        if not rl_host_ready(180):
            raise Refused("the copy's gateway did not answer /ready within 180 s")
        inst = sh.lan_instance()
        if not inst or not sh.unit_owns(unit, inst[1]):
            raise Refused(f"no LinuxCNC instance of {unit} found")
        ctx["state"]["test_instance"] = [inst[1], inst[2]]
        save_state(ctx)
        procs = lt.read_procs()
        problems = lt.process_problems(procs, ctx["tree"], ini, venv=(HERE.parent / "lcnc-gateway/.venv").resolve())
        gw = next((p for p in procs if "gateway:app" in p["cmdline"]), None)
        problems += lt.log_problems(lt.open_files(gw["pid"]), run / "logs") if gw else []
        if problems:
            raise Refused("process proof: " + "; ".join(problems))
        problems = lt.launcher_log_problems(procs, run / "logs", lt.proc_env)
        if problems:
            raise Refused("; ".join(problems))
        return []
    return ("start", step)


def rl_host_ready(timeout) -> bool:
    from test_support.system_host import SystemHost
    return SystemHost().wait_ready(timeout)


def _stop_copy(ctx):
    """The client's own end (abort, disarm, close) — its failure is named.
    The test unit and the tree are the restore's (rl.end_test_resources),
    one code for `finally` and ExecStopPost."""
    reader = ctx.pop("servo_reader", None)
    if reader:
        reader.stop()
        # the stream segment goes with the sampler — never left for the next run
        try:
            ctx["servo"].gate("unloadrt", "sampler")
            ctx["report"]["servo_unload"] = "unloaded"
        except Exception as e:  # noqa: BLE001 — named; the next run's setup clears it
            ctx["report"]["servo_unload"] = f"{type(e).__name__}: {e}"
    client = ctx.pop("client", None)
    if client:
        client.close(strict=True)


def save_state(ctx):
    write_json(ctx["run"] / "state.json", ctx["state"])


def connect_client():
    def step(ctx):
        from test_support.live_session import SimulatorClient
        token = (lt.ini_values(ctx["ini"].read_text()).get(("DISPLAY", "WEBUI_TOKEN")) or [""])[-1]
        client = SimulatorClient(token, session="native-stage", auto_confirm=False, keep=FRAME_KEYS)
        ctx.update(client=client, frames=client.frames, cleanup=lambda: _stop_copy(ctx))
        client.start()
        # the gateway refuses every command with a state gate until its first
        # poll ("Machine status not read yet", BG-12) — live run 2026-11-05
        _wait(client, lambda s: s.get("is_estop") is not None, 30, "the gateway's first status")
        client.request("estop_reset")
        _wait(client, lambda s: s.get("is_estop") is False, 10, "E-Stop reset")
        client.request("machine_on")
        _wait(client, lambda s: s.get("is_enabled") is True, 10, "machine on")
        return []
    return ("connect", step)


def servo_device():
    """Step 2c (plan Codex R299–R301): the sampler loaded and wired into the
    TEST instance at run time, its reader started; the halcmd changes, the
    wiring and the thread as read back go into the report."""
    def step(ctx):
        from test_support import servo as sv
        ini_period = int(float((lt.ini_values(ctx["ini"].read_text()).get(("EMCMOT", "SERVO_PERIOD")) or ["0"])[-1]))
        gate = sv.HalGate()
        ctx["report"]["servo"] = setup = sv.setup(gate, clear=sv.clear_stale_stream)
        reader = sv.Reader()
        reader.start()
        ctx["servo_reader"] = reader
        ctx["servo"] = sv.Measurement(gate, reader, ini_period_ns=ini_period, period_ns=setup["thread"]["period_ns"])
        ctx["servo_period_s"] = setup["thread"]["period_ns"] / 1e9
        return []
    return ("servo", step)


@contextmanager
def _section(ctx, case: str):
    """ONE attempt's servo section for `case`: the start mark awaited before
    the body runs, the end mark set and read after it — on every path, so
    the gate closes. The section is in the yielded box afterwards, its audit
    (marks, number bounds, integrity, the HAL commands) in the report and its
    raw samples in a file beside it (R302 FI-I34). A failing END is kept as
    the box's "error" — the caller ends the run AFTER its rows (FI-I31)."""
    m = ctx["servo"]
    attempt = m.begin()
    box: dict = {"attempt": attempt}       # a step's own phase marks go through it (step 3)
    try:
        yield box
    finally:
        try:
            sec = m.end(attempt)
        except Exception as e:  # noqa: BLE001 — named and ends the run after the rows
            sec = None
            box["error"] = f"{type(e).__name__}: {e}"
        record = {"case": case, "attempt": attempt.get("k"), "end_error": box.get("error")}
        if "t_reply" in box:
            record["t_reply"] = box["t_reply"]     # the reply the case is judged from (R306)
        if sec is not None:
            box["section"] = sec
            if sec.get("end_error"):
                box["error"] = sec["end_error"]
            record.update(start_mark=sec.get("start_mark"), end_mark=sec.get("end_mark"), first_n=sec.get("first_n"),
                          end_n=sec.get("end_n"), integrity=sec.get("integrity"), problems=sec.get("problems"),
                          hal=sec.get("hal"), samples=len(sec["samples"]), file=None, end_error=box.get("error"))
            if ctx.get("run"):
                name = f"servo-{case}.jsonl"
                try:
                    with (ctx["run"] / name).open("w") as f:
                        for t, n, vals in sec["samples"]:
                            f.write(json.dumps([t, n, list(vals)]) + "\n")
                    record["file"] = name
                    # the time evidence beside it (step 3, R315): t0, the phase
                    # marks and each sample's receipt, integer ns
                    write_json(ctx["run"] / f"servo-{case}.time.json",
                               {"t0_ns": sec.get("t0_ns"), "phases": sec.get("phases"),
                                "recv_ns": sorted((sec.get("recv_ns") or {}).items())})
                    record["time_file"] = f"servo-{case}.time.json"
                except OSError as e:
                    # the samples not written: named, kept in memory, the run ends after the rows (R303)
                    record["file_error"] = f"{type(e).__name__}: {e}"
                    box.setdefault("error", f"the servo samples not written — {record['file_error']}")
        ctx.setdefault("report", {}).setdefault("servo_sections", []).append(record)


def _servo_failed(box, rows, what):
    """A section whose END failed: the rows measured so far stay, the run ends."""
    if "error" in box:
        raise StepFailed(rows, f"{what}: the servo measurement failed — {box['error']}")


def _servo_prep(c):
    """The common preparation of every 2c case (R300): units, the fixture,
    no G92, no tool offset — read back where the status shows it."""
    for line in ("G21", "G90", "G94", "G54", "G92.1", "G49"):
        _short(c, line)


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
        c, rows = ctx["client"], ctx.setdefault("rows", [])
        if len(HOME_CASES) != joints + 1:
            raise Refused(f"the home cases name {len(HOME_CASES) - 1} joints, the profile has {joints}")
        try:
            for case, joint in HOME_CASES:
                # each case from a start LinuxCNC homes from: every joint
                # homed, X and Y off their switches, then all unhomed
                _home_joints(c, joints)
                _to(c, *HOME_OFF_SWITCH)
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
            _home_joints(c, joints)         # homed for the jogs
        except StepFailed:
            raise
        except RuntimeError as e:
            # the measured cases stay in the report (FI-I31's rule for every step)
            raise StepFailed(rows, f"the home step: {e}") from e
        return rows
    return ("home", step)


def _home_joints(c, joints: int):
    """Every joint homed: each one not homed ALONE, in joint order — a Home
    All would re-home the homed ones, which may rest on their switch."""
    for j in range(joints):
        if not (c.status.get("homed_joints") or [False] * joints)[j]:
            c.request("home", joint=j)
            _wait(c, lambda s, j=j: (s.get("homed_joints") or [False] * joints)[j] and s.get("inpos"), 60,
                  f"joint {j} homed")


def jog_cases(joints: int):
    def step(ctx):
        # every row as it is judged into the step's rows — a servo row too,
        # kept on any later exception (Codex R306 FI-I36)
        c, frames, rows = ctx["client"], ctx["frames"], ctx.setdefault("rows", [])
        start = "G53 G0 " + " ".join(f"{a}{v:g}" for a, v in zip("XYZ", JOG_START))
        if {axis for _, axis, _ in JOG_CASES} != set(range(joints)):
            raise Refused(f"the jog cases do not name the profile's {joints} axes")
        if "servo" in ctx:
            _servo_prep(c)
        for case, axis, sign in JOG_CASES:
            c.request("mdi", text=start)
            _wait(c, lambda s: s.get("inpos") and s.get("interp_state") == 1 and _near(s, JOG_START), 30, "the jog start")
            c.request("set_mode", mode=1)   # MANUAL for the jog
            p0 = c.status["joint_pos"][axis]
            box = {}
            with (_section(ctx, JOG_SERVO_CASES[case]) if "servo" in ctx else _no_section()) as box:
                c.request("jog_cont", axis=axis, vel=sign * nc.JOG_SPEED)
                time.sleep(0.3)
                c.request("jog_stop", axis=axis)
                t_reply = box["t_reply"] = time.monotonic()   # in the section's audit (R306)
                time.sleep(1.0)             # the post window: 1.0 s from the reply (R300)
            if "section" in box:
                from test_support import servo_cases as sc
                rows.append(sc.eval_jog_servo(JOG_SERVO_CASES[case], axis, sign, box["section"], t_reply))
            _servo_failed(box, rows, case)
            if c.error:
                raise RuntimeError(f"{case}: the session ended — {c.error}")
            seen = list(frames)
            # the bracket around the reply (R287 FI-I23): the last frame before it, every one after
            prior = [(t - t_reply, st) for t, st in seen if t < t_reply]
            before = (prior[-1][0], _pos(prior[-1][1], axis)) if prior else None
            samples = [(t - t_reply, _pos(st, axis), _vel(st)) for t, st in seen if t >= t_reply]
            row = nc.eval_jog(case, axis, sign, p0, before, samples)
            # with the servo measurement the status row informs: its missing
            # proof never holds back the servo row, a contradiction still counts (R302 FI-I35)
            rows.append({**row, "informational": True} if "servo" in ctx else row)
        if c.error:
            raise RuntimeError(f"the session ended after the jogs — {c.error}")
        return rows
    return ("jog", step)


@contextmanager
def _no_section():
    yield {}


def plateau_cases():
    """F-OVERRIDE.S2 (R283, R299–R301): G1 X100 → X500 F6000 twice, override
    1.0 then 0.5 (confirmed in the status before the move), each its own
    servo section; the median speed in X 150…450 from adjacent samples; the
    first section re-judged against a planted 75 mm/s."""
    def step(ctx):
        from test_support import servo_cases as sc
        c, rows = ctx["client"], ctx.setdefault("rows", [])
        _servo_prep(c)
        sections = {}
        for scale, case in ((1.0, "override-plateau-100"), (0.5, "override-plateau-50")):
            _to(c, *PLATEAU_START)
            c.request("set_feed_override", scale=scale)
            _wait(c, lambda st: isinstance(st.get("feed_override"), (int, float))
                  and abs(st["feed_override"] - scale) < 1e-9, 10, f"feed override {scale}")
            with _section(ctx, case) as box:
                _routine(c, f"G53 G1 X{PLATEAU_END:g} F{PLATEAU_FEED:g}", deadline=60.0,
                         extra=lambda st: _near(st, (PLATEAU_END, PLATEAU_START[1], PLATEAU_START[2])))
                time.sleep(0.5)                 # the post window (R300)
            if "section" in box:
                sections[case] = box["section"]
                rows.append(sc.eval_plateau(case, box["section"], 100.0 * scale, ctx["servo_period_s"]))
            _servo_failed(box, rows, case)
        c.request("set_feed_override", scale=1.0)
        planted = sc.eval_plateau("override-plateau-100", sections["override-plateau-100"], 75.0,
                                  ctx["servo_period_s"])
        rows.append(nc.counter("override-plateau.counter-75", planted, rows[0]))
        return rows
    return ("plateau", step)


def goto_cases():
    """F-GOTO.S1c (R284, R299–R301): → Zero (gateway command), → Home and
    → G30 (their routines by mdi) from G53 X200 Y200 Z−60, each its own servo
    section judged by phase: Z up first with X/Y still, then X/Y with Z up,
    a G30 descent only after X/Y arrived, at rest on the target; an MDI pair
    moving X/Y first is refused against a passing → Zero."""
    def step(ctx):
        from test_support import servo_cases as sc
        from test_support import tool_change as tc
        c, rows = ctx["client"], ctx.setdefault("rows", [])
        _servo_prep(c)
        for line in (f"G10 L2 P1 X{GOTO_G54[0]:g} Y{GOTO_G54[1]:g} Z0", "G54", "G64 P0.001"):
            _short(c, line)
        g30 = c.request("read_g30")
        if not g30.get("confirmed"):
            raise Refused(f"G30 not read: {g30}")
        targets = {"goto-zero": (GOTO_G54[0], GOTO_G54[1], 0.0), "goto-home": (0.0, 0.0, 0.0),
                   "goto-g30": tuple(float(g30["values"][a]) for a in "XYZ")}
        ctx["report"]["goto"] = {"targets": targets, "g64": "G64 P0.001", "g54": GOTO_G54}

        def zero():
            cursor = len(c.frames)
            c.request("go_to_zero")
            tc.serve(c, tc.ToolChanges([]), tc.RoutineEnd(), 60.0, cursor=cursor)
        triggers = {"goto-zero": zero,
                    "goto-home": lambda: _routine(c, "O<go_to_home> CALL", deadline=60.0),
                    "goto-g30": lambda: _routine(c, "O<go_to_g30> CALL", deadline=60.0)}
        for case, fire in triggers.items():
            _to(c, *GOTO_START)
            with _section(ctx, case) as box:
                fire()
                time.sleep(0.5)                 # the post window (R300)
            if "section" in box:
                rows.append(sc.eval_retract_path(case, box["section"], start=GOTO_START, target=targets[case]))
            _servo_failed(box, rows, case)
        _to(c, *GOTO_START)
        with _section(ctx, "goto-zero.counter-xy-first") as box:
            _routine(c, f"G53 G0 X{GOTO_G54[0]:g} Y{GOTO_G54[1]:g}", deadline=60.0)
            _routine(c, "G53 G0 Z0", deadline=60.0)
            time.sleep(0.5)
        if "section" in box:
            xy_first = sc.eval_retract_path("goto-zero", box["section"], start=GOTO_START, target=targets["goto-zero"])
            rows.append(nc.counter("goto-zero.counter-xy-first", xy_first, rows[0]))
        _servo_failed(box, rows, "goto-zero.counter-xy-first")
        return rows
    return ("goto", step)


def plate_from_hal(texts: list[str]) -> dict:
    """The sim tool setter's PHYSICAL plate from the copy's HAL (`setp
    <comp>.plate-x/-y/-z`): the independent measure the probe and M600 are
    held to — never the table or a var after the attempt (R283 FI282-05)."""
    import re
    found = {}
    for text in texts:
        for m in re.finditer(r"^\s*setp\s+\S+\.plate-([xyz])\s+(-?[\d.]+)\s*$", text, re.M):
            found[m.group(1)] = float(m.group(2))
    if set(found) != {"x", "y", "z"}:
        raise Refused(f"the plate is not fully declared in the copy's HAL (found {sorted(found)})")
    return found


def _hal_texts(ini: Path) -> list[str]:
    halfiles = lt.ini_values(ini.read_text()).get(("HAL", "HALFILE")) or []
    return [(ini.parent / h).read_text() for h in halfiles if (ini.parent / h).is_file()]


def _g54_z(st):
    off = st.get("g5x_offset")
    if st.get("g5x_index") != 1 or not isinstance(off, list) or len(off) < 3:
        return None
    return off[2]


def _routine(c, text, vars=None, declared=(), hold_s=0.0, deadline=120.0, require_busy=True, extra=None):
    """One `mdi` to its END (its reply means sent): every tool change it
    raises served by the M6 helper, only the declared ones (nothing declared:
    an M6 here ends the sequence). Returns the trigger time, the changes
    served and the errors received meanwhile."""
    from test_support import tool_change as tc
    changes = tc.ToolChanges(list(declared), hold_s=hold_s)

    def bounds():
        # the start's conditions, the frame and error cursors and the trigger
        # time of THIS attempt: a refused one's frames end nothing (FI-I37)
        refusal = changes.precheck(c.status)
        if refusal:
            raise RuntimeError(f"{text}: {refusal}")
        return len(c.errors), len(c.frames), time.monotonic()
    _, (seen, cursor, t0) = _when_free(c, "mdi", before=bounds,
                                       text=text, **({"vars": {str(k): v for k, v in vars.items()}} if vars else {}))
    end = tc.RoutineEnd(require_busy=require_busy, grace=SHORT_GRACE)

    def done(t, st):
        # BOTH on every frame: `extra` may latch what shows only while the
        # routine runs (the probe's M50 P0), never only on idle frames
        effect = extra(st) if extra else True
        return end(t, st) and effect
    served = tc.serve(c, changes, done, deadline, cursor=cursor)
    return {"t0": t0, "t_done": changes.ended_at, "served": served, "changes": changes,
            "errors": [(k, x) for _, k, x in c.errors[seen:]]}


def _short(c, text):
    """A block too short to show busy in a status frame (no motion, no M6)."""
    return _routine(c, text, require_busy=False, deadline=10.0)


def _read_params(c, nums, tries=3):
    """Interpreter parameters with no status field (#5070, #5063): a tagged
    DEBUG line through the error channel — a status tick a client skips
    loses its errors, so the read is repeated (it changes nothing)."""
    import re
    for attempt in range(tries):
        tag = f"NATIVE{int(time.monotonic() * 1000) % 10**9}"
        seen = len(c.errors)
        _short(c, f"(DEBUG,{tag} " + " ".join(f"P{n}=#{n}" for n in nums) + ")")
        end = time.monotonic() + DEBUG_WAIT
        while time.monotonic() < end:
            line = next((x for _, _, x in c.errors[seen:] if tag in x), None)
            if line:
                vals = dict(re.findall(r"P(\d+)=(-?[\d.]+)", line))
                return {n: float(vals[str(n)]) if str(n) in vals else None for n in nums}
            time.sleep(0.05)
    return {n: None for n in nums}


def _vars(c, nums) -> dict:
    """The INTERPRETER's values — what a routine reads. Not get_probe_vars:
    it reads the var FILE, which every interp synch rewrites from the
    interpreter's memory (live run 2026-11-05: a set_probe_vars' file write
    was overwritten by a synch before its MDI took the value — the file read
    the OLD #3102). Read in portions under LinuxCNC's 255-character line; a
    number not read ends the run."""
    nums, out = [int(n) for n in nums], {}
    for i in range(0, len(nums), VARS_PER_READ):
        out.update(_read_params(c, nums[i:i + VARS_PER_READ]))
    unread = [n for n in nums if out.get(n) is None]
    if unread:
        raise Refused(f"parameters not read from the interpreter: {unread}")
    return out


def _tool_z(c, tool):
    row = next((t for t in c.request("get_tool_table")["tools"] if t.get("T") == tool), None)
    return None if row is None else row.get("Z")


def _claim_refused(e) -> bool:
    """A KNOWN refusal for the start claim alone — the gateway answered and
    sent nothing. A lost transport or a missing reply is an unknown delivery
    whatever its text, never asked again (Codex R306 FI-I37)."""
    from test_support.live_session import Refused as SessionRefused
    return isinstance(e, SessionRefused) and "starting or running" in str(e)


def _when_free(c, cmd, before=None, **kw):
    """A write or a start right after a routine: the gateway refuses it while
    the routine's start claim is held ("A program or macro is starting or
    running — wait") and releases the claim on its next status proof — asked
    again for CLAIM_WAIT_S; any other refusal ends it at once. A refused
    command was not sent, so asking again sends it once. `before()` runs
    right before EACH attempt and its value is the accepted attempt's
    (a routine binds its frame and error bounds there — FI-I37)."""
    end = time.monotonic() + CLAIM_WAIT_S
    while True:
        mark = before() if before else None
        try:
            reply = c.request(cmd, **kw)
            return (reply, mark) if before else reply
        except RuntimeError as e:
            if not _claim_refused(e) or time.monotonic() >= end:
                raise
            time.sleep(0.1)


def _set_tool_length(c, tool, length):
    _when_free(c, "save_tool", tool_number=tool, z_offset=length)
    back = _tool_z(c, tool)
    if back is None or abs(back - length) > nc.SAME:
        raise Refused(f"T{tool}'s length {length} not read back from the table (read {back})")


def _rules(ctx):
    """The run tree's toolsetter rule (P2): the gateway that runs judges the
    section with exactly this file."""
    import importlib.util
    spec = importlib.util.spec_from_file_location("toolsetter_rules_run",
                                                  Path(ctx["tree"]) / "lcnc-gateway" / "toolsetter_rules.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _save_toolsetter(ctx, c, values) -> dict:
    """The toolsetter section as the form saves it ({var: number} → the form's
    keys) — since P2 what a program start and run from line apply. Judged set
    up by the run tree's rule first; returns {"var": the canonical number}."""
    tr = _rules(ctx)
    inv = {v: k for k, v in tr.VAR_MAP.items()}
    section = {inv[int(k)]: v for k, v in values.items()}
    setup = tr.setup(section)
    if not setup["ok"]:
        raise Refused(f"the toolsetter section would not be set up: {setup}")
    reply = _when_free(c, "save_settings", section="toolsetter", data=section)
    if not reply or reply.get("ok") is False:
        raise Refused(f"the toolsetter section was not saved: {reply}")
    return {str(k): v for k, v in setup["values"].items()}


def _load_program(ctx, c, name, text, timeout=60.0):
    """Write and load a program; wait until the gateway published exactly it
    (its file and the run's own hash of the text)."""
    import hashlib
    path = ctx["config"] / NC_FILES / name
    path.write_text(text)
    digest = hashlib.sha256(text.encode()).hexdigest()
    c.request("load_file", path=str(path))
    end = time.monotonic() + timeout
    while not (c.preview_origin and c.preview_origin.get("source") == digest
               and Path(str(c.preview_origin.get("file"))).resolve() == path.resolve()):
        if time.monotonic() > end:
            raise Refused(f"the published origin is not the program written: {c.preview_origin}")
        time.sleep(0.1)
    return path


def _to(c, x, y, z):
    """G53 move with NO tool offset applied — the joint start proven whatever
    G53 does with an active offset (G49 first), then waited for in joint space."""
    _short(c, "G49")
    _routine(c, f"G53 G0 X{x:g} Y{y:g} Z{z:g}", deadline=60.0,
             extra=lambda st: _near(st, (x, y, z)))


def probe_cases():
    """F-PROBE.S3 on the real task: probe_z_minus_wco with #3030 = 0 writes
    G54 Z = the plate; started beyond the search depth it records no contact
    and sets nothing; a planted plate 1 mm off is refused."""
    def step(ctx):
        c, rows = ctx["client"], ctx.setdefault("rows", [])
        plate = ctx["plate"] = plate_from_hal(_hal_texts(ctx["ini"]))
        ctx["report"]["plate"] = plate
        _set_tool_length(c, PROBE_TOOL, PROBE_L0)
        for line in ("G54", "G92.1", "G10 L2 P1 X0 Y0 Z0"):
            _short(c, line)
        # T99 the UI's way (tool_change: T99 M6, then G43 H99) — the change declared
        from test_support import tool_change as tc
        changes = tc.ToolChanges([PROBE_TOOL])
        refusal = changes.precheck(c.status)
        if refusal:
            raise RuntimeError(f"T{PROBE_TOOL}: {refusal}")
        cursor = len(c.frames)
        c.request("tool_change", tool_number=PROBE_TOOL)
        end = tc.RoutineEnd()
        tc.serve(c, changes, lambda t, st: end(t, st) and st.get("tool_number") == PROBE_TOOL, 60.0, cursor=cursor)
        shipped = _vars(c, PROBE_VARS)
        probe_vars = {**shipped, 3030: 0}

        def probe_from(over):
            contact_z = plate["z"] + PROBE_L0
            _to(c, plate["x"], plate["y"], contact_z + over)
            _short(c, f"G43 H{PROBE_TOOL}")
            off = (c.status.get("tool_offset") or [None] * 3)[2]
            if off is None or abs(off - PROBE_L0) > nc.SAME:
                raise Refused(f"G43 H{PROBE_TOOL} applied {off}, not {PROBE_L0}")
            before = _g54_z(c.status)
            # its end only after it STARTED: its M50 P0 locks the override (a
            # late frame from between the vars' MDIs and the call is no end)
            started = {"seen": False}

            def ran(st):
                started["seen"] = started["seen"] or st.get("feed_override_enabled") is False
                return started["seen"]
            r = _routine(c, "O<probe_z_minus_wco> CALL", vars=probe_vars, deadline=90.0, extra=ran)
            p = _read_params(c, [5070, 5063])
            return p[5070], before, _g54_z(c.status), r["errors"]

        contact, _, g54, errors = probe_from(PROBE_OVER)
        hit = nc.eval_probe_z("probe-z", contact, g54, expected=plate["z"], errors=errors)
        hit["vars_sent"] = {str(k): v for k, v in probe_vars.items()}
        # the same measurement against a plate planted 1 mm off: refused only
        # because of the plant — it passed against the true one (R292 FI-I27)
        planted = nc.eval_probe_z("probe-z", contact, g54, expected=plate["z"] + 1, errors=errors)
        rows += [hit, nc.counter("probe-z.counter-plate-1", planted, hit)]
        _short(c, "G10 L2 P1 Z0")
        # a G38.2 ending without contact aborts the routine and leaves #5070
        # as the LAST probe wrote it — 1 from the hit (live run 2026-11-05):
        # planted 0 and read back, its read after the miss is evidence again
        _short(c, "#5070=0")
        if _read_params(c, [5070])[5070] != 0:
            raise Refused("#5070 not planted 0 before the miss")
        contact, before, after, errors = probe_from(MISS_OVER)
        rows.append(nc.eval_probe_miss("probe-z-miss", contact, before, after, errors))
        rows[-1]["vars_read_back"] = {str(k): v for k, v in _vars(c, PROBE_VARS).items()}
        return rows
    return ("probe", step)


def m600_cases():
    """M600 measures the tool on the real task: T<n> M600 → the table length
    = L0 (read BEFORE) ± 0.002 and G43 applies it; during its measuring
    phase the status says the feed override is locked, free after
    (F-OVERRIDE.S2b); #3102 planted 1 mm off is refused; then the table
    length and #3102 are put back and read back (a reset that fails ends the
    run: the sim's physical length IS the table length)."""
    def step(ctx):
        c, frames, plate, rows = ctx["client"], ctx["frames"], ctx["plate"], ctx.setdefault("rows", [])
        tool = MEASURED_TOOL
        l0 = _tool_z(c, tool)
        if l0 is None:
            raise Refused(f"T{tool} has no row in the copy's table")
        ts = {**_vars(c, TOOLSETTER_VARS), 3005: M600_SLOW}
        if abs(ts[3102] - plate["z"]) > nc.SAME:
            raise Refused(f"#3102 {ts[3102]} is not the plate {plate['z']} — the copy's setup differs")

        def measure(vars_):
            """T0 M600 then T1 M600 with `vars_`: each from another spindle
            tool; T1 from where the unload left the spindle (G30 — the top in
            the copy), the operator's own flow. Returns the call's and the
            end's joint positions too."""
            u = _routine(c, "T0 M600", vars=vars_, declared=[0], deadline=120.0,
                         extra=lambda st: st.get("tool_number") == 0)
            unload = (u, c.status.get("tool_number"), (c.status.get("tool_offset") or [None] * 3)[2])
            pre = c.status
            call = (list((pre.get("joint_pos") or [None] * 3)[:3]), pre.get("tool_number"),
                    (pre.get("tool_offset") or [None] * 3)[2])
            r = _routine(c, f"T{tool} M600", vars=vars_, declared=[tool], deadline=180.0,
                         extra=lambda st: st.get("tool_number") == tool)
            st = c.status
            end = list((st.get("joint_pos") or [None] * 3)[:3])
            return (unload, r, st.get("tool_table_z"), (st.get("tool_offset") or [None] * 3)[2],
                    st.get("tool_number"), call, end)

        unload, r, length, g43, _, call, end = measure(ts)
        rows.append(nc.eval_unload("m600-unload", unload[0]["served"], unload[1], unload[2]))
        row = nc.eval_m600("m600-t1", l0, length, g43, errors=r["errors"])
        row["table_on_disk"] = _tool_z(c, tool)
        rows.append(row)
        # the return (#3106 = 1): from the top with the longer T1, back at the
        # call's X/Y and Z still up; re-judged against a call planted 1 mm off
        # in X (Codex R307: the setting, the climb, the tool and its length shown)
        (cpos, ctool, coff), st_end = call, c.status
        ret = dict(errors=r["errors"], setting=ts.get(3106), call_tool=ctool, call_offset=coff, tool=tool,
                   end_tool=st_end.get("tool_number"), table=length, applied=g43)
        back = nc.eval_m600_return("m600-t1-return", cpos, end, M600_TOP_Z, **ret)
        planted = nc.eval_m600_return("m600-t1-return", [None if cpos[0] is None else cpos[0] + 1, *cpos[1:]],
                                      end, M600_TOP_Z, **ret)
        rows += [back, nc.counter("m600-t1-return.counter-x+1", planted, back)]
        # the release window is WAITED for (R292 FI-I26 B): a free frame at or
        # after the completion, or the window's end — then judged
        until = r["t_done"] + nc.RELEASE_WITHIN + 0.1
        while time.monotonic() < until and not any(t >= r["t_done"] and st.get("feed_override_enabled") is True
                                                    for t, st in frames[-50:]):
            time.sleep(0.05)
        rows.append(nc.eval_override_lock("m600-t1-override-lock", [f for f in frames if f[0] >= r["t0"]], r["t0"]))
        # the #3102 counter-probe: its OWN run, judged on its own (R292 FI-I27),
        # predicted from ITS base — the length the first measurement left,
        # which IS the sim's physical length (R293); L0 stays for the reset
        base_c = _tool_z(c, tool)
        _, rc, length_c, g43_c, tool_c, _, _ = measure({**ts, 3102: plate["z"] + 1})
        crow = nc.eval_m600_counter("m600-t1.counter-3102", base=base_c, true_3102=plate["z"],
                                    planted_3102=plate["z"] + 1, length=length_c, g43=g43_c, tool_after=tool_c,
                                    tool=tool, errors=rc["errors"])
        crow["l0"] = l0
        crow["table_on_disk"] = _tool_z(c, tool)
        rows.append(crow)
        # the reset, read back: the table length, #3102, the applied offset
        _set_tool_length(c, tool, l0)
        _when_free(c, "set_probe_vars", vars={"3102": plate["z"]})
        back = _vars(c, [3102])[3102]
        if back is None or abs(back - plate["z"]) > nc.SAME:
            raise Refused(f"#3102 not put back: {back}")
        _short(c, f"G43 H{tool}")
        off = (c.status.get("tool_offset") or [None] * 3)[2]
        if off is None or abs(off - l0) > nc.SAME:
            raise Refused(f"T{tool}'s offset not put back: {off}")
        return rows
    return ("m600", step)


def m6_hold_case():
    """F-TOOLCHANGE.S2 on the real task: M6 waits for the explicit
    confirmation — held 5 s, every 20 Hz sample with the request open, the
    interpreter not idle, the spindle tool unchanged — and goes on with the
    new tool (the UI's tool_change: its G43 applies the new length)."""
    def step(ctx):
        from test_support import tool_change as tc
        c = ctx["client"]
        changes = tc.ToolChanges([PROBE_TOOL], hold_s=HOLD_S)
        refusal = changes.precheck(c.status)
        if refusal:
            raise RuntimeError(f"m6-hold: {refusal}")
        before = c.status.get("tool_number")
        cursor = len(c.frames)
        c.request("tool_change", tool_number=PROBE_TOOL)
        end = tc.RoutineEnd()
        try:
            tc.serve(c, changes, lambda t, st: end(t, st) and st.get("tool_number") == PROBE_TOOL, M6_DEADLINE,
                     cursor=cursor)
        except tc.ToolChangeError as e:
            # the run ends either way; the ROW says whether a frame disproved
            # the hold or the frames never showed it (R293 FI-I24)
            status = "incomplete" if e.cause == "unobserved" else "FAIL"
            raise StepFailed([{"case": "m6-hold", "status": status, "detail": str(e), "cause": e.cause,
                               "holds": changes.holds}], f"the M6 sequence ended: {e}") from None
        st = c.status
        return [nc.eval_m6_hold("m6-hold", changes.holds, before, st.get("tool_number"),
                                (st.get("tool_offset") or [None] * 3)[2], PROBE_TOOL, PROBE_L0, HOLD_S)]
    return ("m6-hold", step)


def ts_sync_cases():
    """P2 on the real task (Codex R308–R309): the toolsetter section saved
    with the machine OFF (the live red case — the form sends nothing then)
    reaches the interpreter at the PROGRAM start: Cycle Start's sync writes
    it before AUTO, and the program's T1 M600 measures with it — L0 (the
    table before) + |new #3102| − |old|, ± M600_TOL at #3005 = 20; only the
    new basis passes, an NML error is a FAIL; a counter re-judges it against
    the old basis. The booking this connection received says what the form
    projects (old #3102 before, every key the section's number after); a
    second start with the same section writes nothing. Put back: T1's length
    (the sim's physical one), the section, #3102, the applied offset."""
    def step(ctx):
        from test_support import tool_change as tc
        c, plate, rows = ctx["client"], ctx["plate"], ctx.setdefault("rows", [])
        tool = MEASURED_TOOL
        l0 = _tool_z(c, tool)
        if l0 is None:
            raise Refused(f"T{tool} has no row in the copy's table")
        ts = {**_vars(c, TOOLSETTER_VARS), 3005: M600_SLOW}
        if abs(ts[3102] - plate["z"]) > nc.SAME:
            raise Refused(f"#3102 {ts[3102]} is not the plate {plate['z']} — the copy's setup differs")
        # the machine holds the copy's values (an MDI write, booked applied),
        # the server the same section
        _when_free(c, "set_probe_vars", vars={str(k): v for k, v in ts.items()})
        prepared = _save_toolsetter(ctx, c, ts)
        new = {**ts, 3102: plate["z"] + 1}
        c.request("machine_off")
        _wait(c, lambda s: s.get("is_enabled") is False, 10, "machine off")
        values = _save_toolsetter(ctx, c, new)
        c.request("machine_on")
        _wait(c, lambda s: s.get("is_enabled") is True, 10, "machine on")
        if not all(c.status.get("homed_joints") or [False]):
            c.request("home_all")
            _wait(c, lambda s: all(s.get("homed_joints") or [False]) and s.get("inpos"), 60, "homed again")
        before = _vars(c, [3102])[3102]
        _load_program(ctx, c, TS_FILE, TS_PROGRAM)
        changes = tc.ToolChanges([tool])
        refusal = changes.precheck(c.status)
        if refusal:
            raise RuntimeError(f"ts-sync: {refusal}")
        booking_before = c.toolsetter_booking
        # the observation bounds of the ACCEPTED start (FI-I37, R312 FI-I44)
        reply, (cursor, err_from) = _when_free(c, "cycle_start", before=lambda: (len(c.frames), len(c.errors)))
        end = tc.RoutineEnd()
        tc.serve(c, changes, lambda t, st: end(t, st) and st.get("tool_number") == tool, TS_DEADLINE, cursor=cursor)
        st = c.status
        length, g43 = st.get("tool_table_z"), (st.get("tool_offset") or [None] * 3)[2]
        errors = [(k, x) for _, k, x in c.errors[err_from:]]
        after = _vars(c, [3102])[3102]
        note = (reply or {}).get("toolsetter")

        def judge(new_3102):
            return nc.eval_ts_sync("ts-sync-program-m600", l0, ts[3102], new_3102, length, g43, note, before, after,
                                   errors=errors)
        row = judge(new[3102])
        rows += [row, nc.counter("ts-sync-program-m600.counter-old-basis", judge(ts[3102]), row),
                 nc.eval_ts_booking("ts-sync-booking", prepared, values, booking_before, c.toolsetter_booking,
                                    canon=_rules(ctx).canonical)]
        # the same section again: the named decision — nothing written; its
        # own attempt, its errors judged (R312 FI-I44)
        _load_program(ctx, c, TS_IDLE_FILE, TS_IDLE_PROGRAM)
        v0 = (c.toolsetter_booking or {}).get("version")
        reply, (cursor, err_from) = _when_free(c, "cycle_start", before=lambda: (len(c.frames), len(c.errors)))
        tc.serve(c, tc.ToolChanges([]), tc.RoutineEnd(require_busy=False, grace=SHORT_GRACE), 30.0, cursor=cursor)
        rows.append(nc.eval_ts_stable("ts-sync-stable", (reply or {}).get("toolsetter"), v0,
                                      (c.toolsetter_booking or {}).get("version"),
                                      errors=[(k, x) for _, k, x in c.errors[err_from:]]))
        # put back, read back
        _set_tool_length(c, tool, l0)
        _save_toolsetter(ctx, c, ts)
        _when_free(c, "set_probe_vars", vars={"3102": plate["z"]})
        back = _vars(c, [3102])[3102]
        if back is None or abs(back - plate["z"]) > nc.SAME:
            raise Refused(f"#3102 not put back: {back}")
        _short(c, f"G43 H{tool}")
        off = (c.status.get("tool_offset") or [None] * 3)[2]
        if off is None or abs(off - l0) > nc.SAME:
            raise Refused(f"T{tool}'s offset not put back: {off}")
        return rows
    return ("ts-sync", step)


def _with_outcome(row: dict, outcome: dict | None) -> dict:
    """The attempt's outcome in its line's row: a known refusal or
    contradiction makes it a FAIL, a missing observation incomplete — a FAIL
    the evaluator found stays one; the cause is kept (R295 FI-I31)."""
    if not outcome:
        return row
    if row["status"] == "FAIL":
        return {**row, "cause": outcome["cause"], "detail": f"{row['detail']}; {outcome['detail']}"}
    return {**row, "status": outcome["status"], "cause": outcome["cause"],
            "detail": f"{outcome['detail']}; {row['detail']}"}


def rfl_cases():
    """F-RFL.S3 on the real task (Codex R292 FI292-01): EIN auto_run as the
    UI sends it — the loaded file, its published version and source (checked
    against the run's own hash of what it wrote), line 7 with the
    pre-measurement of T1 (the one change declared), the spindle's set
    value, the entry G54/G21. Judged on the frames RECEIVED: the witness (the
    first motion of the program itself is line 7, with its tool, length and
    spindle), line 7's end and the program's, no earlier line in what was
    seen, the start point (incomplete until step 2c), the L+1 counter."""
    def step(ctx):
        import hashlib
        from test_support import live_session as ls
        from test_support import tool_change as tc
        c, frames, rows = ctx["client"], ctx["frames"], ctx.setdefault("rows", [])
        tool = MEASURED_TOOL
        l0 = _tool_z(c, tool)
        if l0 is None:
            raise Refused(f"T{tool} has no row in the copy's table")
        ts = {**_vars(c, TOOLSETTER_VARS), 3005: M600_SLOW}
        # the dialog's values must be the server's section (P2): saved first
        _save_toolsetter(ctx, c, ts)
        for line in ("G54", "G92.1", "G10 L2 P1 X0 Y0 Z0"):
            _short(c, line)
        path = ctx["config"] / NC_FILES / RFL_FILE
        path.write_text(RFL_PROGRAM)
        digest = hashlib.sha256(RFL_PROGRAM.encode()).hexdigest()
        c.request("load_file", path=str(path))
        end = time.monotonic() + 60
        while not (c.preview_origin and c.preview_origin.get("source") == digest
                   and Path(str(c.preview_origin.get("file"))).resolve() == path.resolve()):
            if time.monotonic() > end:
                raise Refused(f"the published origin is not the program written: {c.preview_origin}")
            time.sleep(0.1)
        origin = dict(c.preview_origin)
        ctx["report"]["rfl_origin"] = {"file": origin["file"], "version": origin["version"], "source": digest,
                                       "before": {k: c.status.get(k) for k in ("tool_number", "joint_pos")}}
        changes = tc.ToolChanges([tool])
        refusal = changes.precheck(c.status)
        if refusal:
            raise RuntimeError(f"run from line: {refusal}")
        cursor, hist_from, err_from = len(c.frames), len(c.rfl_history), len(c.errors)
        # the servo stream of the whole attempt: the start point (2c-b, Codex
        # R309–R310) is judged from it, attributed by the texts' line sets
        box: dict = {}
        with (_section(ctx, "rfl") if "servo" in ctx else _no_section()) as box:
            # ONE outcome of the attempt from the auto_run on (R295 FI-I31): a
            # known refusal or contradiction, an observed failure, a missing
            # observation — carried into the line's row on every path
            outcome = None
            try:
                c.request("auto_run", line=RFL_LINE, file=origin["file"], version=origin["version"],
                          source=origin["source"], spindle_dir="forward", spindle_speed=int(RFL_SPEED), pre_tool=tool,
                          probe_vars={str(k): v for k, v in ts.items()}, safe_z=True, entry_x=RFL_ENTRY[0],
                          entry_y=RFL_ENTRY[1], entry_wcs="G54", entry_units="G21")
            except ls.Refused as e:
                outcome = {"status": "FAIL", "cause": "refused", "detail": f"auto_run refused: {e}"}
            except (ls.NoReply, ls.TransportLost) as e:
                # no answer or a lost transport is no refusal (R296 FI-I31 A/B)
                outcome = {"status": "incomplete", "cause": "unobserved", "detail": f"auto_run not answered: {e}"}
            seen = {"program": False}

            def ran(st):
                seen["program"] = seen["program"] or (st.get("task_mode") == nc.MODE_AUTO and st.get("call_level") == 0
                                                      and isinstance(st.get("motion_line"), int)
                                                      and st["motion_line"] >= RFL_LINE)
                return seen["program"]

            def failed_phase():
                return next((p for _, p in c.rfl_history[hist_from:] if nc.rfl_failed(p)), None)

            def known_failure():
                return failed_phase() is not None or nc._failures([(k, x) for _, k, x in c.errors[err_from:]])
            routine_end = tc.RoutineEnd()

            def done(t, st):
                effect, end = ran(st), routine_end(t, st)
                # a known failure of THIS attempt ends it once idle — no program
                # witness is waited for (R294/R295 FI-I31)
                if known_failure() and st.get("interp_state") == 1:
                    return True
                return end and effect
            if outcome is None:
                try:
                    tc.serve(c, changes, done, RFL_DEADLINE, cursor=cursor)
                except tc.ToolChangeError as e:
                    outcome = {"status": "incomplete" if e.cause == "unobserved" else "FAIL", "cause": e.cause,
                               "detail": f"the attempt's tool changes ended: {e}"}
        # the rows on EVERY path, from what was received since this attempt began
        hist, run_frames = list(c.rfl_history[hist_from:]), frames[cursor:]
        errors = [(k, x) for _, k, x in c.errors[err_from:]]
        ctx["report"]["rfl_history"] = hist
        ctx["report"]["rfl_errors"] = errors
        common = dict(tool=tool, l0=l0, spindle_speed=RFL_SPEED, end_point=(200.0, None, RFL_SAFE_Z),
                      final=(200.0, 200.0, RFL_Z_END + l0), line_holds={1: RFL_ENTRY[1], 2: RFL_SAFE_Z},
                      errors=errors,
                      ended_at=changes.ended_at)
        line = _with_outcome(nc.eval_rfl_line("rfl-line", hist, run_frames, line=RFL_LINE, **common), outcome)
        planted = nc.eval_rfl_line("rfl-line", hist, run_frames, line=RFL_LINE + 1, **common)
        rows += [line, nc.counter("rfl-line.counter-line+1", planted, line),
                 nc.eval_rfl_no_earlier("rfl-no-earlier-line", hist, run_frames, line=RFL_LINE)]
        if "section" in box:
            from test_support import servo_cases as sc
            r_lines, sources, problem = sc.routine_sources(ctx["tree"], ROUTINE_TEXTS)
            sources = {**sources, "program": ctx["report"]["rfl_origin"]["source"]}
            judge = dict(line=RFL_LINE, safe_z=RFL_SAFE_Z, routine_lines=r_lines, sources=sources,
                         source_problem=problem, program_lines=frozenset(range(1, len(RFL_PROGRAM.splitlines()) + 1)))
            start = sc.eval_rfl_start_servo("rfl-start-point", box["section"], entry_xy=RFL_ENTRY, **judge)
            off = sc.eval_rfl_start_servo("rfl-start-point", box["section"],
                                          entry_xy=(RFL_ENTRY[0] + 1, RFL_ENTRY[1]), **judge)
            rows += [start, nc.counter("rfl-start-point.counter-entry-x+1", off, start)]
        else:
            rows.append(nc.eval_rfl_start_point("rfl-start-point", hist, run_frames, entry_xy=RFL_ENTRY))
        if "error" in box:
            why = outcome["detail"] if outcome is not None else "the attempt's own outcome stands in the rows"
            raise StepFailed(rows, f"the run from line ended: {why}; the servo measurement failed — {box['error']}")
        if outcome is not None or known_failure():
            # the instance goes down; a gap stays a gap in the rows
            why = outcome["detail"] if outcome is not None else (
                f"phase {failed_phase().get('phase')}" if failed_phase() is not None else
                f"the attempt reported: {nc._failures(errors)[0]}")
            raise StepFailed(rows, f"the run from line ended: {why}")
        return rows
    return ("rfl", step)


class Helper:
    """A client in its own process (test_support/proto_client.py): it can be
    dropped or stopped alone. The token goes in its environment."""

    def __init__(self, ctx, session: str):
        import queue
        import threading
        token = (lt.ini_values(ctx["ini"].read_text()).get(("DISPLAY", "WEBUI_TOKEN")) or [""])[-1]
        self.session, self.lines = session, queue.Queue()
        self.proc = subprocess.Popen([sys.executable, "-I", str(HERE / "test_support" / "proto_client.py"), session],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1,
                                     env={**os.environ, "LCNC_NATIVE_TOKEN": token})
        threading.Thread(target=lambda: [self.lines.put(json.loads(x)) for x in self.proc.stdout], daemon=True).start()
        self.hello = self._read(30)

    @property
    def pid(self):
        return self.proc.pid

    def _read(self, timeout):
        import queue
        try:
            return self.lines.get(timeout=timeout)
        except queue.Empty:
            raise Refused(f"the helper {self.session} did not answer within {timeout} s") from None

    def request(self, cmd, timeout=40, **kw):
        self.proc.stdin.write(json.dumps({"op": "request", "cmd": cmd, "kw": kw}) + "\n")
        self.proc.stdin.flush()
        out = self._read(timeout)
        if "error" in out:
            raise Refused(f"helper {cmd}: {out['error']}")
        return out["reply"]

    def when_free(self, cmd, **kw):
        """A write right after the previous program's abort: the gateway holds
        the start claim until its next status proof ("starting or running —
        wait") — asked again for CLAIM_WAIT_S, like _when_free; any other
        refusal ends it at once."""
        end = time.monotonic() + CLAIM_WAIT_S
        while True:
            try:
                return self.request(cmd, **kw)
            except Refused as e:
                if "starting or running" not in str(e) or time.monotonic() >= end:
                    raise
                time.sleep(0.1)

    def drop(self):
        self.proc.stdin.write(json.dumps({"op": "drop"}) + "\n")
        self.proc.stdin.flush()
        return self._read(10)

    def end(self):
        if self.proc.poll() is None:
            self.proc.kill()
        self.proc.wait(timeout=10)


def _trace_events(ctx, pred) -> list:
    """The events of THIS run's gateway (its own log folder) that match."""
    out = []
    try:
        with (ctx["run"] / "logs" / "trace.ndjson").open() as f:
            for line in f:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if pred(e):
                    out.append(e)
    except OSError:
        pass
    return out


def _trace_wait(ctx, pred, timeout):
    end = time.monotonic() + timeout
    while True:
        found = _trace_events(ctx, pred)
        if found or time.monotonic() > end:
            return found[0] if found else None
        time.sleep(0.1)


def _bind_helper(ctx, helper) -> int:
    """The helper's client id (plan Codex R314–R315): its hello asked for a
    resume with its own fresh session — unarmed, and exactly ONE
    session.resume_denied_no_match with that session in the trace."""
    if "error" in helper.hello or (helper.hello.get("reply") or {}).get("armed") is not False:
        raise Refused(f"the helper's hello is no fresh unarmed session: {helper.hello}")
    _trace_wait(ctx, lambda e: e.get("tag") == "session.resume_denied_no_match"
                and e.get("session_id") == helper.session, 5)
    found = _trace_events(ctx, lambda e: e.get("tag", "").startswith("session.")
                          and e.get("session_id") == helper.session)
    if len(found) != 1 or found[0].get("tag") != "session.resume_denied_no_match":
        raise Refused(f"the helper's session is not bound to one client: {[e.get('tag') for e in found]}")
    return found[0]["client_id"]


def disconnect_cases():
    """SYS-CONN.S4 on the real task (plan Codex R313–R316): a helper client
    A in its own process (bound to its client id by its resume hello) arms,
    loads and starts the program; then it goes away — `close`: it drops its
    connection (no abort, no disarm); `heartbeat`: A2 is stopped (trip.stop)
    until the gateway's heartbeat timeout. The gateway's own event for
    exactly that client id is read from the trace, THEN the mark W is set;
    the window after it is judged (eval_disconnect); then the run's client B
    aborts the program."""
    def step(ctx):
        from test_support import servo_cases as sc
        from test_support import trip as tp
        c, rows, state = ctx["client"], ctx.setdefault("rows", []), ctx["state"]
        lines = frozenset(range(1, len(DISC_PROGRAM.splitlines()) + 1))

        def save(_state):
            save_state(ctx)
        for kind, letter in (("close", "A"), ("heartbeat", "A2")):
            case = f"disconnect-{kind}"
            helper = Helper(ctx, f"native-{letter}-{ctx['run'].name}")
            rec, event, frames_after, w_mark = None, None, [], None
            try:
                cid = _bind_helper(ctx, helper)
                if helper.request("arm", armed=True).get("armed") is not True:
                    raise Refused(f"the helper {letter} did not arm")
                path = ctx["config"] / NC_FILES / DISC_FILE
                path.write_text(DISC_PROGRAM)
                helper.when_free("load_file", path=str(path))
                import hashlib
                digest = hashlib.sha256(DISC_PROGRAM.encode()).hexdigest()
                _wait(c, lambda s: (c.preview_origin or {}).get("source") == digest, 60, "the program published")
                with _section(ctx, case) as box:
                    helper.when_free("cycle_start")
                    _wait(c, lambda s: s.get("interp_state") not in (None, sc.INTERP_IDLE), 10, "the program runs")
                    time.sleep(1.0)
                    if kind == "close":
                        helper.drop()
                        tag = "ws.disconnect"
                    else:
                        rec = tp.stop(state, save, helper.pid, f"the helper client {letter}")
                        tag = "safety.hb_stall_disarmed"
                    event = _trace_wait(ctx, lambda e: e.get("tag") == tag and e.get("client_id") == cid,
                                        DISC_EVENT_S[kind])
                    if event is not None:
                        w_mark = ctx["servo"].phase(box["attempt"], 1)
                        i_f = len(c.frames)
                        time.sleep(DISC_WINDOW_S)
                        frames_after = list(c.frames[i_f:])
                sec = box.get("section") or {"samples": [], "problems": [box.get("error") or "no section"]}
                rows.append(sc.eval_disconnect(case, sec, w_mark, event, frames_after, lines))
                _servo_failed(box, rows, case)
            except Refused as e:
                rows.append({"case": case, "status": "incomplete", "detail": f"not judged: {e}"})
            finally:
                # B ends the program on every path, then the stopped helper is continued
                c.request("abort")
                _wait(c, lambda s: s.get("interp_state") == sc.INTERP_IDLE and s.get("inpos"), 15, "B's abort")
                if rec is not None:
                    tp.cont(state, save, rec)
                if kind == "heartbeat" and helper.proc.poll() is None:
                    try:
                        helper.drop()
                    except Refused:
                        pass
                helper.end()
        return rows
    return ("disconnect", step)


def _gen_load(path: Path, mb: int) -> None:
    """perf_matrix.gen_gcode's random walk (seed 42) without its T13 M600:
    the load is the parse, a tool change only bends it."""
    import random
    rng = random.Random(42)
    with path.open("w") as f:
        f.write("G21 G90\nG0 X0 Y0 Z5\n")
        size, x, y = 0, 0.0, 0.0
        while size < mb * 1_000_000:
            x = (x + rng.random()) % 200
            y = (y + rng.random()) % 200
            line = f"G1 X{x:.3f} Y{y:.3f} Z-{rng.random():.3f} F1200\n"
            f.write(line)
            size += len(line)
        f.write("G0 Z5\nM2\n")


def _fetch_preview(token: str, version) -> dict:
    import hashlib
    import urllib.request
    req = urllib.request.Request(f"http://127.0.0.1:8000/preview?v={version}",
                                 headers={"X-Auth-Token": token, "Accept-Encoding": "gzip"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            body = r.read()
            return {"status": r.status, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    except Exception as e:  # noqa: BLE001 — named in the row
        return {"status": getattr(e, "code", None), "error": f"{type(e).__name__}: {e}"}


def clients_cases():
    """SYS-CONN.S1 on the real task (plan Codex R283, R313–R316): for N = 4,
    then 8, N unarmed protocol clients connect; in ONE section — before
    (≥ 1 s), the window from the load to the last fetch + 5 s, after (≥ 1 s),
    split by the attempt's own marks — the run's client loads the big
    program, waits for its publication, and the N fetch /preview at once
    behind a barrier. eval_clients judges the heartbeat's edges across the
    window from the controller's periods."""
    def step(ctx):
        import hashlib
        import threading
        from test_support import servo_cases as sc
        from test_support.live_session import SimulatorClient
        c, rows = ctx["client"], ctx.setdefault("rows", [])
        token = (lt.ini_values(ctx["ini"].read_text()).get(("DISPLAY", "WEBUI_TOKEN")) or [""])[-1]
        for n in CLIENTS_N:
            case = f"clients-{n}"
            path = ctx["config"] / NC_FILES / f"native_load_{n}.ngc"
            _gen_load(path, CLIENTS_MB)
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            clients, hellos, results, published = [], [], [None] * n, {"ok": False}
            try:
                for i in range(n):
                    cl = SimulatorClient(token, session=f"native-load-{n}-{i}-{ctx['run'].name}", auto_confirm=False)
                    clients.append(cl)
                    cl.start(arm=False)
                    hellos.append({k: v for k, v in cl.hello_reply.items() if k != "conn_key"})
                with _section(ctx, case) as box:
                    time.sleep(CLIENTS_PRE_S)
                    w1 = ctx["servo"].phase(box["attempt"], 1)
                    c.request("load_file", path=str(path))
                    _wait(c, lambda s: (c.preview_origin or {}).get("source") == digest and Path(
                        str((c.preview_origin or {}).get("file"))).resolve() == path.resolve(),
                        CLIENTS_PUBLISH_S, f"{path.name} published")
                    published = {"ok": True, "file": path.name, "source": digest,
                                  "version": c.preview_origin.get("version")}
                    barrier = threading.Barrier(n)

                    def fetch(i):
                        barrier.wait(timeout=30)
                        results[i] = _fetch_preview(token, published["version"])
                    threads = [threading.Thread(target=fetch, args=(i,)) for i in range(n)]
                    for t in threads:
                        t.start()
                    for t in threads:
                        t.join(timeout=150)
                    time.sleep(CLIENTS_TAIL_S)
                    w2 = ctx["servo"].phase(box["attempt"], 2)
                    time.sleep(CLIENTS_POST_S)
                sec = box.get("section") or {"samples": [], "problems": [box.get("error") or "no section"]}
                rows.append(sc.eval_clients(case, sec, w1, w2, n, hellos, [r or {} for r in results], published))
                _servo_failed(box, rows, case)
            finally:
                for cl in clients:
                    cl.drop()            # unarmed watchers: no abort, no disarm
        return rows
    return ("clients", step)


def _gateway_pid(ctx) -> int:
    """The gateway of THIS run's test instance: a `gateway:app` process in the
    test unit's own cgroup — never another instance's."""
    unit = ctx["state"].get("test_unit")
    for p in lt.read_procs():
        if "gateway:app" not in p["cmdline"]:
            continue
        try:
            if f"/{unit}.service" in Path(f"/proc/{p['pid']}/cgroup").read_text():
                return p["pid"]
        except OSError:
            continue
    raise Refused(f"no gateway in the test unit {unit}")


def latch_order():
    """The delayed variant (R284 FI282-04): webui-hb-latch moved before
    oneshot.0 through the measurement's gate, the order read back and kept in
    the report — the latch then sees the expiry one cycle late."""
    def step(ctx):
        from test_support import servo as sv
        gate = ctx["servo"].gate
        before = sv.thread_of(gate("show", "thread", "servo-thread"))["functions"]
        gate("delf", "webui-hb-latch", "servo-thread")
        rest = sv.thread_of(gate("show", "thread", "servo-thread"))["functions"]
        gate("addf", "webui-hb-latch", "servo-thread", rest.index("oneshot.0") + 1)
        after = sv.thread_of(gate("show", "thread", "servo-thread"))["functions"]
        ctx["report"]["latch_order"] = {"before": before, "after": after}
        if not (after.index("webui-hb-latch") < after.index("oneshot.0") and after[-1] == "sampler.0"):
            raise Refused(f"the delayed order did not take: {after}")
        return []
    return ("latch-order", step)


def latch_cases(variant=None):
    """F-ESTOP S4/S4b on the real task — the LAST step: a trip disturbs
    whatever follows. The gateway of this instance is stopped (its identity
    on disk first, test_support/trip.py) past the oneshot budget and
    continued; in the OUTAGE section the falling edge of oneshot.0.out, the
    latch, the heartbeat's return, the E-Stop Reset asked before the
    acknowledgement (refused) and the frames showing the waiting trip; then —
    only for the run's own proven trip — the RECOVERY in its own section:
    acknowledge, arm, E-Stop Reset, Machine On. `variant` "latch-delayed":
    the same with webui-hb-latch before oneshot.0 (latch_order) — its rows
    carry the variant and S4b's is the counter-evidence row."""
    def step(ctx):
        from test_support import servo_cases as sc
        from test_support import trip as tp
        from test_support.live_session import Refused as SessionRefused
        from test_support.system_host import SystemHost
        c, rows, state = ctx["client"], ctx.setdefault("rows", []), ctx["state"]
        delayed = variant == "latch-delayed"
        sh, unit = SystemHost(), state.get("test_unit")

        def save(_state):
            save_state(ctx)

        def tag(row):
            return {**row, "variant": variant} if variant else row
        before_trip = c.safety_trip
        if before_trip:
            raise Refused(f"a trip waits before the latch case ({before_trip}) — never acknowledged")
        inst_before = list((sh.unit_instance(unit) or ())[1:])
        pid = _gateway_pid(ctx)
        reset_reply, trip_frames = None, []
        with _section(ctx, "latch-outage") as box:
            rec = tp.stop(state, save, pid, "the test instance's gateway")
            try:
                time.sleep(LATCH_STOP_S)
            finally:
                tp.cont(state, save, rec)
            t_cont = time.monotonic()
            end = t_cont + 10
            while not any(t > t_cont for t, _ in c.trip_history[-20:]):
                if time.monotonic() > end:
                    raise Refused("no status frame after the gateway was continued")
                time.sleep(0.05)
            try:
                reset_reply = c.request("estop_reset")
            except SessionRefused as e:
                reset_reply = {"ok": False, "error": str(e)}
            time.sleep(LATCH_POST_S)
            trip_frames = [tr for t, tr in c.trip_history if t > t_cont]
        sec = box.get("section") or {"samples": [], "problems": [box.get("error") or "no section"]}
        same = sc.eval_latch_same_cycle("latch-same-cycle.delayed-order" if delayed else "latch-same-cycle", sec,
                                        delayed=delayed)
        rows += [tag(same), tag(sc.eval_latch_sticky("latch-sticky", sec, reset_reply, trip_frames))]
        _servo_failed(box, rows, "the latch outage")
        why = tp.own_trip(before_trip, same.get("edge_index"), inst_before,
                          list((sh.unit_instance(unit) or ())[1:]))
        if why:
            raise StepFailed(rows, f"the trip is not proven the run's own: {why} — not acknowledged")
        with _section(ctx, "latch-recovery") as box:
            i_f, i_t = len(c.frames), len(c.trip_history)
            c.request("safety_trip_ack")
            c.request("arm", armed=True)
            c.request("estop_reset")
            _wait(c, lambda s: s.get("is_estop") is False, 10, "E-Stop reset after the trip")
            c.request("machine_on")
            _wait(c, lambda s: s.get("is_enabled") is True, 10, "machine on after the trip")
            time.sleep(RECOVERY_POST_S)
            # the frames received in the recovery, each with its own trip field
            frames = [(tr, st.get("is_estop"), st.get("is_enabled"))
                      for (_t, st), (_t2, tr) in zip(c.frames[i_f:], c.trip_history[i_t:])]
        sec = box.get("section") or {"samples": [], "problems": [box.get("error") or "no section"]}
        rows.append(tag(sc.eval_latch_recovered("latch-recovered", sec, frames)))
        _servo_failed(box, rows, "the latch recovery")
        return rows
    return ("latch", step)


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
    ap.add_argument("--variant", choices=VARIANTS, help="a step-3 variant: its own run and instance")
    a = ap.parse_args(argv)
    if not in_restore_unit():
        print("native_run: runs only in the user unit `native-run` with the restore as its ExecStopPost (see --help)")
        return 2
    from test_support.system_host import SystemHost
    joints = PROFILES[a.profile][1]
    base = [make_tree(a.commit, a.profile), make_copy(a.profile), start_copy(), connect_client(), servo_device()]
    if a.variant == "latch-delayed":
        steps = base + [latch_order(), latch_cases(a.variant)]
    else:
        steps = base + [home_cases(joints), jog_cases(joints), plateau_cases(), goto_cases(),
                        probe_cases(), m600_cases(), m6_hold_case(), ts_sync_cases(), rfl_cases(),
                        disconnect_cases(), clients_cases(), latch_cases()]
    with heavy_lock("native_run", wait=0):
        report = run(SystemHost(), steps, a.run_dir)
    report["variant"] = a.variant
    report["verdict"] = verdict(report)
    write_json(a.run_dir / "report.json", report)
    print(f"native_run: {report['verdict']} — restore {report['restore']['outcome']} → {a.run_dir / 'report.json'}")
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

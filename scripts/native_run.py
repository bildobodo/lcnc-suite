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
JOG_CASES = (("jog-x+", 0, 1), ("jog-x-", 0, -1), ("jog-y+", 1, 1), ("jog-y-", 1, -1), ("jog-z+", 2, 1),
             ("jog-z-", 2, -1))
#: what a case reads from a status frame — kept per frame, the rest is not
FRAME_KEYS = ("joint_pos", "current_vel", "interp_state", "inpos", "feed_override_enabled", "tool_number",
              "tool_offset", "tool_table_z", "tool_change_requested", "tool_change_seq", "tool_change_tool",
              "g5x_index", "g5x_offset", "motion_line", "call_level", "task_mode", "spindle_direction",
              "spindle_speed")
# step 2a (plan R283–R285 FI282-05): the probe tool T99 at L0 = 50, started
# 8 mm over its contact (joint Z = plate + L0) inside #3020 = 10; the miss 15
# mm over it; the toolsetter's values as the copy ships them, #3005 slow 20
PROBE_TOOL, PROBE_L0 = 99, 50.0
PROBE_OVER, MISS_OVER = 8.0, 15.0
PROBE_VARS = (3014, 3015, 3016, 3017, 3020, 3021, 3030)          # what probe_z_minus_wco reads
TOOLSETTER_VARS = (3004, 3005, 3006, 3007, 3009, 3010, 3013) + tuple(range(3100, 3116))   # toolsetterVarMap
M600_SLOW = 20.0
MEASURED_TOOL = 1       # its case ids below name it literally ("m600-t1")
HOLD_S = 5.0
M6_DEADLINE = 60.0      # s for the held change to complete
# step 2b, run from line (Codex R292 FI292-01): the program the run writes
# into the copy's nc_files. Line 7 starts from the entry the dialog derives
# (X100 Y100 in G54, G21 — scanEntryPositionBefore); every Z keeps the joint
# within its window with T1's 50 mm (program Z + length ≤ 0)
RFL_PROGRAM = "\n".join([
    "(native stage: run from line - Codex R292 FI292-01)",
    "G21 G90 G94 G17 G54",
    "T1 M600",
    "S1000 M3",
    "G0 X100 Y100",
    "G0 Z-100",
    "G1 X200 F3000",
    "G1 Y200",
    "G0 Z-50",
    "M5",
    "M2"]) + "\n"
RFL_FILE, RFL_LINE, RFL_ENTRY, RFL_SPEED = "native_rfl.ngc", 7, (100.0, 100.0), 1000.0
RFL_Z_LINE, RFL_Z_END = -100.0, -50.0
RFL_DEADLINE = 300.0    # s: the pre-measurement, the entry and the program
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
            rows = fn(ctx) or []
            report["rows"] += rows
    except Exception as e:  # noqa: BLE001 — every failure ends in the restore and the report
        report["rows"] += getattr(e, "rows", [])
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
    """The client's own end (abort, disarm, close) — its failure is named.
    The test unit and the tree are the restore's (rl.end_test_resources),
    one code for `finally` and ExecStopPost."""
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
        if len(HOME_CASES) != joints + 1:
            raise Refused(f"the home cases name {len(HOME_CASES) - 1} joints, the profile has {joints}")
        for case, joint in HOME_CASES:
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
        if {axis for _, axis, _ in JOG_CASES} != set(range(joints)):
            raise Refused(f"the jog cases do not name the profile's {joints} axes")
        for case, axis, sign in JOG_CASES:
            c.request("mdi", text=start)
            _wait(c, lambda s: s.get("inpos") and s.get("interp_state") == 1 and _near(s, JOG_START), 30, "the jog start")
            c.request("set_mode", mode=1)   # MANUAL for the jog
            p0 = c.status["joint_pos"][axis]
            c.request("jog_cont", axis=axis, vel=sign * nc.JOG_SPEED)
            time.sleep(0.3)
            c.request("jog_stop", axis=axis)
            t_reply = time.monotonic()
            time.sleep(1.0)
            if c.error:
                raise RuntimeError(f"{case}: the session ended — {c.error}")
            seen = list(frames)
            # the bracket around the reply (R287 FI-I23): the last frame before it, every one after
            prior = [(t - t_reply, st) for t, st in seen if t < t_reply]
            before = (prior[-1][0], _pos(prior[-1][1], axis)) if prior else None
            samples = [(t - t_reply, _pos(st, axis), _vel(st)) for t, st in seen if t >= t_reply]
            rows.append(nc.eval_jog(case, axis, sign, p0, before, samples))
        if c.error:
            raise RuntimeError(f"the session ended after the jogs — {c.error}")
        return rows
    return ("jog", step)


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
    refusal = changes.precheck(c.status)
    if refusal:
        raise RuntimeError(f"{text}: {refusal}")
    seen, cursor = len(c.errors), len(c.frames)
    t0 = time.monotonic()
    c.request("mdi", text=text, **({"vars": {str(k): v for k, v in vars.items()}} if vars else {}))
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
    got = c.request("get_probe_vars", vars=list(nums))["vars"]
    return {int(k): v for k, v in got.items()}


def _tool_z(c, tool):
    row = next((t for t in c.request("get_tool_table")["tools"] if t.get("T") == tool), None)
    return None if row is None else row.get("Z")


def _set_tool_length(c, tool, length):
    c.request("save_tool", tool_number=tool, z_offset=length)
    back = _tool_z(c, tool)
    if back is None or abs(back - length) > nc.SAME:
        raise Refused(f"T{tool}'s length {length} not read back from the table (read {back})")


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
        c, rows = ctx["client"], []
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
        c, frames, plate, rows = ctx["client"], ctx["frames"], ctx["plate"], []
        tool = MEASURED_TOOL
        l0 = _tool_z(c, tool)
        if l0 is None:
            raise Refused(f"T{tool} has no row in the copy's table")
        ts = {**_vars(c, TOOLSETTER_VARS), 3005: M600_SLOW}
        if abs(ts[3102] - plate["z"]) > nc.SAME:
            raise Refused(f"#3102 {ts[3102]} is not the plate {plate['z']} — the copy's setup differs")

        def measure(vars_):
            """T0 M600 then T1 M600 with `vars_`: each from another spindle tool."""
            u = _routine(c, "T0 M600", vars=vars_, declared=[0], deadline=120.0,
                         extra=lambda st: st.get("tool_number") == 0)
            unload = (u, c.status.get("tool_number"), (c.status.get("tool_offset") or [None] * 3)[2])
            r = _routine(c, f"T{tool} M600", vars=vars_, declared=[tool], deadline=180.0,
                         extra=lambda st: st.get("tool_number") == tool)
            st = c.status
            return unload, r, st.get("tool_table_z"), (st.get("tool_offset") or [None] * 3)[2], st.get("tool_number")

        unload, r, length, g43, _ = measure(ts)
        rows.append(nc.eval_unload("m600-unload", unload[0]["served"], unload[1], unload[2]))
        row = nc.eval_m600("m600-t1", l0, length, g43, errors=r["errors"])
        row["table_on_disk"] = _tool_z(c, tool)
        rows.append(row)
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
        _, rc, length_c, g43_c, tool_c = measure({**ts, 3102: plate["z"] + 1})
        crow = nc.eval_m600_counter("m600-t1.counter-3102", base=base_c, true_3102=plate["z"],
                                    planted_3102=plate["z"] + 1, length=length_c, g43=g43_c, tool_after=tool_c,
                                    tool=tool, errors=rc["errors"])
        crow["l0"] = l0
        crow["table_on_disk"] = _tool_z(c, tool)
        rows.append(crow)
        # the reset, read back: the table length, #3102, the applied offset
        _set_tool_length(c, tool, l0)
        c.request("set_probe_vars", vars={"3102": plate["z"]})
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
        c, frames, rows = ctx["client"], ctx["frames"], []
        tool = MEASURED_TOOL
        l0 = _tool_z(c, tool)
        if l0 is None:
            raise Refused(f"T{tool} has no row in the copy's table")
        ts = {**_vars(c, TOOLSETTER_VARS), 3005: M600_SLOW}
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
        common = dict(tool=tool, l0=l0, spindle_speed=RFL_SPEED, end_point=(200.0, None, RFL_Z_LINE + l0),
                      final=(200.0, 200.0, RFL_Z_END + l0), line_holds={1: RFL_ENTRY[1]}, errors=errors,
                      ended_at=changes.ended_at)
        line = _with_outcome(nc.eval_rfl_line("rfl-line", hist, run_frames, line=RFL_LINE, **common), outcome)
        planted = nc.eval_rfl_line("rfl-line", hist, run_frames, line=RFL_LINE + 1, **common)
        rows += [line, nc.counter("rfl-line.counter-line+1", planted, line),
                 nc.eval_rfl_no_earlier("rfl-no-earlier-line", hist, run_frames, line=RFL_LINE),
                 nc.eval_rfl_start_point("rfl-start-point", hist, run_frames, entry_xy=RFL_ENTRY)]
        if outcome is not None or known_failure():
            # the instance goes down; a gap stays a gap in the rows
            why = outcome["detail"] if outcome is not None else (
                f"phase {failed_phase().get('phase')}" if failed_phase() is not None else
                f"the attempt reported: {nc._failures(errors)[0]}")
            raise StepFailed(rows, f"the run from line ended: {why}")
        return rows
    return ("rfl", step)


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
                                    connect_client(), home_cases(joints), jog_cases(joints),
                                    probe_cases(), m600_cases(), m6_hold_case(), rfl_cases()], a.run_dir)
    report["verdict"] = verdict(report)
    write_json(a.run_dir / "report.json", report)
    print(f"native_run: {report['verdict']} — restore {report['restore']['outcome']} → {a.run_dir / 'report.json'}")
    return 0 if report["verdict"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

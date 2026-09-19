#!/usr/bin/env python3
"""Suite test entry point. Offline checks never connect to LinuxCNC.

Live TWP checks are opt-in and target the shipped 45-degree gantry TWP simulator.
They require a running matching session; this runner never launches or stops
LinuxCNC. See docs/testing.md for setup, scope and evidence retention.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent.parent
LIVE_SCRIPTS = (
    "twp_buttons_check.py", "twp_reorient_check.py", "twp_capture_check.py",
    "twp_touchoff_check.py", "twp_touchoff_plane_check.py",
    "twp_g683_check.py", "twp_adverse_check.py",
)
LIVE_GATES = ("preview-goldens", "live-parity", *(Path(name).stem for name in LIVE_SCRIPTS))


def python():
    venv = ROOT / "lcnc-gateway/.venv/bin/python3"
    return str(venv) if venv.is_file() else sys.executable


def stamp():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def ini_values(text):
    """Retain repeated HALFILE/HALCMD/REMAP keys, unlike ConfigParser."""
    values, section = {}, ""
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if line.startswith("[") and line.endswith("]"):
            section = line[1:-1].upper()
        elif "=" in line:
            key, value = line.split("=", 1)
            values.setdefault((section, key.strip().upper()), []).append(value.strip())
    return values


def validate_live_target(ini, running_ini):
    """Reject other machines: the active corpus uses the 45-degree gantry."""
    ini = Path(ini).expanduser().resolve()
    if ini != Path(running_ini).expanduser().resolve():
        raise ValueError("Requested INI differs from the running LinuxCNC session")
    if ini.name != "lcnc_suite_sim_6axis_twp_xyzabc.ini":
        raise ValueError("live-twp requires lcnc_suite_sim_6axis_twp_xyzabc.ini with the gantry geometry")
    got = ini_values(ini.read_text())
    expected = ini_values((ROOT / "examples/sim_config/lcnc_suite_sim_6axis_twp_xyzabc.ini").read_text())
    for key in (("KINS", "KINEMATICS"), ("KINS", "JOINTS"), ("TRAJ", "COORDINATES"),
                ("HAL", "HALFILE"), ("HAL", "POSTGUI_HALFILE")):
        if got.get(key) != expected.get(key):
            raise ValueError(f"Not the supported simulator: {key} differs from the shipped fixture")
    pins = lambda v: [s for s in v.get(("HAL", "HALCMD"), [])
                      if s.startswith("setp xyzacb_trsrn_kins.")]
    if pins(got) != pins(expected):
        raise ValueError("Simulator kinematic geometry differs from the corpus fixture")
    # A checked-out merge cannot certify a gateway/remap still using an old worktree.
    paths = {
        ("DISPLAY", "DISPLAY"): ROOT / "lcnc-suite",
        ("PYTHON", "TOPLEVEL"): ROOT / "examples/sim_config/twp/python/toplevel.py",
    }
    for key, want in paths.items():
        value = got.get(key, [""])[0]
        path = Path(value).expanduser()
        if not path.is_absolute():
            path = ini.parent / path
        if path.resolve() != want.resolve():
            raise ValueError(f"{key} must point to this checkout: {want}")
    return got


def materialize_corpus(ini, out):
    """Use repository programs, keeping historical 55-degree recordings unchanged."""
    source = ROOT / "scripts/parity_corpus/twp_gantry.json"
    corpus = json.loads(source.read_text())
    corpus["ini"] = str(ini)
    programs = out / "programs"
    programs.mkdir()
    for entry in corpus["programs"]:
        name = Path(entry["file"]).name
        src = source.parent / entry["file"]
        dest = programs / name
        dest.write_bytes(src.read_bytes())
        entry["file"] = str(dest)
    dest = out / "corpus.json"
    dest.write_text(json.dumps(corpus, indent=2) + "\n")
    return dest, programs / "twp_simple_example.ngc"


def offline_commands(component):
    commands = []
    if component in ("all", "backend"):
        commands.append(("backend", [python(), "-m", "pytest"], ROOT / "lcnc-gateway"))
        commands.append(("5axis-model", [python(), str(ROOT / "scripts/test_5axis_xyzac.py")], ROOT))
    if component in ("all", "frontend"):
        for name, cmd in (("lint", ["npm", "run", "lint"]),
                          ("build", ["npm", "run", "build"]),
                          ("unit", ["npm", "test"]),
                          ("browser", ["npm", "run", "test:e2e"])):
            commands.append(("frontend-" + name, cmd, ROOT / "lcnc-webui"))
    return commands


def run_gate(name, command, cwd, out, env, timeout):
    log = out / (name + ".log")
    row = {"name": name, "command": command, "cwd": str(cwd), "log": log.name,
           "started": stamp(), "status": "running"}
    print(f"RUN  {name} → {log}", flush=True)
    started = time.monotonic()
    with log.open("w") as stream:
        proc = subprocess.Popen(command, cwd=cwd, env=env, stdout=stream,
                                stderr=subprocess.STDOUT, start_new_session=True)
        try:
            row["exit_code"] = proc.wait(timeout=timeout)
            row["status"] = "pass" if row["exit_code"] == 0 else "fail"
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            import signal
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
            row["status"] = "interrupted"
    row["seconds"] = round(time.monotonic() - started, 2)
    row["finished"] = stamp()
    row["notes"] = [line.strip() for line in log.read_text(errors="replace").splitlines()
                    if re.search(r"\bskip(?:s|ped)?\b", line, re.IGNORECASE)]
    print(f"{row['status'].upper():4s} {name} ({row['seconds']}s)", flush=True)
    if row["status"] != "pass":
        print("\n".join(log.read_text(errors="replace").splitlines()[-40:]), flush=True)
    return row


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="mode", required=True)
    sub.add_parser("list", help="show the offline and live gates")
    offline = sub.add_parser("offline", help="lint, build, discovered unit tests and browser tests")
    offline.add_argument("--component", choices=("all", "backend", "frontend"), default="all")
    live = sub.add_parser("live-twp", help="motion tests on the running standard TWP simulator")
    live.add_argument("--ini", type=Path, required=True)
    live.add_argument("--allow-sim-motion", action="store_true", help="permit the listed motion tests")
    live.add_argument("--prepare-sim", action="store_true", help="reset E-stop, enable and home the simulator")
    live.add_argument("--gate", action="append", choices=LIVE_GATES,
                      help="run only the named gate (repeatable); report is marked partial")
    for parser in (offline, live):
        parser.add_argument("--out-dir", type=Path)
        parser.add_argument("--timeout", type=float, default=1800, help="seconds per gate")
    args = ap.parse_args(argv)
    if args.mode == "list":
        print("offline: backend pytest discovery; frontend lint, build, vitest (recorded parity), Playwright")
        print("live-twp: preview goldens; live cached-payload parity + plane invariants;")
        print("          " + ", ".join(LIVE_SCRIPTS))
        return 0
    if args.mode == "live-twp" and not args.allow_sim_motion:
        ap.error("live-twp moves the simulator; specify --allow-sim-motion")
    out = (args.out_dir or ROOT / "runlogs/test-suite" /
           (datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + args.mode)).resolve()
    out.mkdir(parents=True, exist_ok=False)  # Never replace previous evidence.
    report = {"mode": args.mode, "started": stamp(), "root": str(ROOT), "gates": [],
              "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
              "tracked_changes": subprocess.check_output(
                  ["git", "diff", "HEAD", "--name-only"], cwd=ROOT, text=True).splitlines(),
              "runner_sha256": sha(__file__), "status": "running"}
    untracked = subprocess.check_output(
        ["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=ROOT
    ).decode().strip("\0").split("\0")
    report["changed_file_sha256"] = {
        name: sha(ROOT / name) if (ROOT / name).is_file() else None
        for name in sorted(set(report["tracked_changes"] + untracked)) if name
    }
    env = dict(os.environ, PYTHONUNBUFFERED="1")
    session = None
    try:
        if args.mode == "offline":
            commands = offline_commands(args.component)
        else:
            import linuxcnc
            stat = linuxcnc.stat()
            stat.poll()
            ini = args.ini.expanduser().resolve()
            values = validate_live_target(ini, stat.ini_filename)
            if stat.interp_state != linuxcnc.INTERP_IDLE or stat.current_vel:
                raise ValueError("Simulator is busy; wait for it to become idle")
            # Check the running gateway too: editing DISPLAY does not restart it.
            gateways = []
            for proc in Path("/proc").glob("[0-9]*/cmdline"):
                try:
                    words = proc.read_bytes().decode().split("\0")
                except (OSError, UnicodeDecodeError):
                    continue
                if "gateway:app" in words and "--app-dir" in words:
                    gateways.append(Path(words[words.index("--app-dir") + 1]).resolve())
            if gateways != [ROOT / "lcnc-gateway"]:
                raise ValueError("The running gateway must use this checkout; restart the simulator after repointing DISPLAY")
            report.update(ini=str(ini), ini_sha256=sha(ini))
            token = values.get(("DISPLAY", "WEBUI_TOKEN"), [""])[0]
            if values.get(("DISPLAY", "WEBUI_PORT"), ["8000"])[0] != "8000":
                raise ValueError("Existing TWP button gates require gateway port 8000")
            env["LCNC_WS_TOKEN"] = token
            corpus, demo = materialize_corpus(ini, out)
            from test_support.live_session import SimulatorClient
            session = SimulatorClient(token)
            session.start()
            if args.prepare_sim:
                session.prepare()
            stat.poll()
            if stat.task_state != linuxcnc.STATE_ON or not all(stat.homed[:6]):
                raise ValueError("Simulator must be ON and homed; use --prepare-sim for unattended setup")
            commands = [
                ("preview-goldens", [python(), str(ROOT / "scripts/preview_gate.py"), "check",
                 "--ini", str(ini), "--config-name", "twp_gantry", str(demo)], ROOT),
                ("live-parity", [python(), str(ROOT / "scripts/sim_parity.py"), "gate",
                 "--corpus", str(corpus), "--out-dir", str(out / "parity")], ROOT),
            ] + [(Path(name).stem, [python(), str(ROOT / "scripts" / name)], ROOT)
                 for name in LIVE_SCRIPTS]
            report["scope"] = "partial" if args.gate else "full"
            report["omitted_gates"] = [name for name in LIVE_GATES
                                        if args.gate and name not in args.gate]
            if args.gate:
                commands = [row for row in commands if row[0] in args.gate]
        for name, command, cwd in commands:
            row = run_gate(name, command, cwd, out, env, args.timeout)
            report["gates"].append(row)
            (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
            if session and session.error:
                raise RuntimeError(f"Simulator client lost: {session.error}")
            if row["status"] != "pass":
                break
        report["status"] = "pass" if len(report["gates"]) == len(commands) and all(
            r["status"] == "pass" for r in report["gates"]) else "fail"
        report["not_run"] = [name for name, *_ in commands[len(report["gates"]):]]
    except (Exception, KeyboardInterrupt) as exc:
        report["status"] = "error"
        report["error"] = str(exc)
        print(f"ERROR: {exc}", file=sys.stderr)
    finally:
        if session:
            session.close()
        report["finished"] = stamp()
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    scope = " (partial live run)" if report.get("scope") == "partial" else ""
    print(f"{report['status'].upper()}{scope}: {out / 'report.json'}")
    return 0 if report["status"] == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())

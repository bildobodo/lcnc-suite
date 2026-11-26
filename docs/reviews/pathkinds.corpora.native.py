#!/usr/bin/env python3
"""Path kinds (step 0 + Codex R487 H1) — the TWP and XYZAC parity corpora on the
VM's REAL LinuxCNC, owed before the merge. One profile per run, through the
native stage's machinery (scripts/native_run.py of the tree --scripts names:
record + stop the LAN sim, a run tree of --commit with its own build, a
confined copy of the profile, the target check before the start, the process
proof, the restore in `finally`; the unit's ExecStopPost is restore_lan.py).
native_run itself knows the 3-axis profile only: the two profiles are named
here (the copy, the check and the start read nothing else of a profile).

  --profile twp     scripts/test_suite.py live-twp of the run tree, every gate
                    (preview goldens, the 11 parity runs + plane invariants, the
                    buttons, reorient, capture, touch-off, G68.3, adverse) — the
                    round's owed live gate `live-twp` with it; --gate NAME limits.
                    Its HOME is the run's `home/`, whose linuxcnc/nc_files is the
                    copy's NC folder: twp_capture_check writes its refusal probe
                    to ~/linuxcnc/nc_files (the LAN install's PROGRAM_PREFIX),
                    and the copy's gateway admits only its own folder (C2 "File
                    not in NC files directory", run 20261126T001641-twp)
  --profile xyzac   scripts/sim_parity.py gate on xyzac/m600_live.ngc (two M600
                    measurements during the run), tolerance 0.5 both ways, as on
                    2026-10-11: G54 X-238.281465 Y-200 Z-103.798156 set by MDI,
                    T1 100 / T7 66 and the toolsetter values the template's but
                    the traverse feed #3006 = 6000 (the LAN install's: the
                    template's 500 made the run longer than the capture's 180 s,
                    run 20261126T003152-xyzac; 2026-10-11's took 63 s), the
                    plate the HAL's, an armed client confirming the two changes.
                    The base worker's payload (24f3bd3a; its one vertex less) is
                    fetched in the same state first — the worker FILE exchanged
                    in this run's own detached tree and put back byte for byte —
                    and compared with the SAME run: the report has both.

  python3 -I docs/reviews/pathkinds.corpora.native.py --scripts <tree> --run-dir <dir> --commit <sha> --profile twp|xyzac
Runs only as the user unit `native-run` (restore as its ExecStopPost). What the
run writes lies in the run folder; nothing of it is committed but its record.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

BASE, WORKER = "24f3bd3a", "lcnc-gateway/gcode_parse_worker.py"
PROFILES = {"twp": ("6axis_twp_xyzabc", "lcnc_suite_sim_6axis_twp_xyzabc.ini", 6),
            "xyzac": ("5axis_xyzac", "lcnc_suite_sim_5axis_xyzac.ini", 5)}
XYZAC_G54 = "G10 L2 P1 X-238.281465 Y-200 Z-103.798156 A0 C0 R0"
XYZAC_PROGRAM = "scripts/parity_corpus/xyzac/m600_live.ngc"
#: the toolsetter's place in the XYZAC template's parameter file = the sim's plate
PLATE_VARS = {"x": "3100", "y": "3101", "z": "3102"}
#: the toolsetter's traverse feed (tool_touch_off.ngc #<traverse_fr>) as the LAN install has it
TRAVERSE = 6000.0


def child_env(ctx) -> dict:
    """The gates' environment: the gateway's log folder, nothing written beside
    the tree's sources. HOME stays this unit's — LinuxCNC keeps its tool mmap
    there, the gates' stat.poll() reads it."""
    return {**os.environ, "LCNC_LOG_DIR": str(ctx["run"] / "logs"), "PYTHONPYCACHEPREFIX": str(ctx["run"] / "pycache"),
            "PYTHONUNBUFFERED": "1"}


def twp_step(nr, gates):
    def step(ctx):
        tree, out = Path(ctx["tree"]), ctx["run"] / "live-twp"
        # ~/linuxcnc/nc_files of the gates = the copy's NC folder (PROGRAM_PREFIX
        # of the copy's INI, relative to its folder)
        prefix = Path(nr.lt.ini_values(Path(ctx["ini"]).read_text())[("DISPLAY", "PROGRAM_PREFIX")][-1]).expanduser()
        nc = prefix if prefix.is_absolute() else Path(ctx["ini"]).parent / prefix
        home = ctx["run"] / "home"
        (home / "linuxcnc").mkdir(parents=True, exist_ok=True)
        (home / "linuxcnc" / "nc_files").symlink_to(nc.resolve(), target_is_directory=True)
        cmd = [str(tree / "lcnc-gateway/.venv/bin/python3"), str(tree / "scripts/test_suite.py"), "live-twp", "--ini", str(ctx["ini"]),
               "--allow-sim-motion", "--prepare-sim", "--out-dir", str(out)]
        for g in gates:
            cmd += ["--gate", g]
        r = subprocess.run(cmd, cwd=tree, env={**child_env(ctx), "HOME": str(home)}, capture_output=True, text=True, timeout=5400)
        (ctx["run"] / "live-twp.log").write_text(r.stdout + r.stderr)
        rep = ctx["report"].setdefault("corpora", {})
        suite = json.loads((out / "report.json").read_text()) if (out / "report.json").exists() else {}
        log = out / "live-parity.log"
        rep["twp"] = {"exit": r.returncode, "status": suite.get("status"), "error": suite.get("error"), "scope": suite.get("scope"),
                      "gates": {g.get("name"): g.get("status") for g in suite.get("gates") or []}, "not_run": suite.get("not_run"),
                      "parity": [ln for ln in log.read_text().splitlines() if re.match(r"\[(PASS|FAIL|----)\]|sim parity gate", ln)]
                      if log.exists() else []}
        passed = [ln for ln in rep["twp"]["parity"] if ln.startswith("[PASS]") and "plane invariants" not in ln]
        wanted = not gates or "live-parity" in gates
        ok = r.returncode == 0 and suite.get("status") == "pass" and (not wanted or len(passed) == 11)
        rep["verdict"] = "PASS" if ok else "FAIL"
        return []
    return ("corpora-twp", step)


def xyzac_step(nr, pk):
    def step(ctx):
        from test_support.live_session import SimulatorClient
        tree, run, config, ini = Path(ctx["tree"]), ctx["run"], ctx["config"], ctx["ini"]
        rep = ctx["report"].setdefault("corpora", {})
        for p in (tree / "lcnc-gateway", tree / "scripts"):
            sys.path.insert(0, str(p))
        import sim_parity as sp
        # the run's measure: the HAL's plate, the template's toolsetter place, the tools
        plate = nr.plate_from_hal(nr._hal_texts(ini))
        values = nr.lt.ini_values(ini.read_text())
        var = dict(ln.split()[:2] for ln in (config / values[("RS274NGC", "PARAMETER_FILE")][-1]).read_text().splitlines() if ln.split())
        table = (config / values[("EMCIO", "TOOL_TABLE")][-1]).read_text()
        tools = {int(m.group(1)): float(m.group(2)) for m in re.finditer(r"^T(\d+)\b.*?\bZ([-+0-9.]+)", table, re.M)}
        rep["state"] = {"plate": plate, "toolsetter": {k: var.get(v) for k, v in PLATE_VARS.items()}, "T1": tools.get(1), "T7": tools.get(7),
                        "#3006 template": var.get("3006"), "#3006 run": TRAVERSE}
        if any(abs(float(var.get(v, "nan")) - plate[k]) > 1e-6 for k, v in PLATE_VARS.items()) or (tools.get(1), tools.get(7)) != (100.0, 66.0):
            raise nr.Refused(f"not the corpus' machine: {rep['state']}")
        token = (values.get(("DISPLAY", "WEBUI_TOKEN")) or [""])[-1]
        client = SimulatorClient(token, session="pathkinds-corpora", auto_confirm=True, keep=nr.FRAME_KEYS)
        ctx.update(client=client, frames=client.frames, cleanup=lambda: nr._stop_copy(ctx))
        client.start()
        nr._wait(client, lambda s: s.get("is_estop") is not None, 30, "the gateway's first status")
        joints = PROFILES["xyzac"][2]
        client.prepare(joint_count=joints)
        # prepare() judges the homing on its own STAT read; the profile homes
        # at once (HOME_SEARCH_VEL 0), so the gateway's policy, which reads its
        # published status, may still say "Not homed" (run 20261126T000153).
        # Every joint homed in the GATEWAY's status before the first MDI: a
        # short wait for the status, a Home All only if it really is not homed.
        homed = lambda s: len(s.get("homed_joints") or []) == joints and all(s["homed_joints"]) and s.get("inpos")
        try:
            nr._wait(client, homed, 5, "homed in the gateway's status")
        except RuntimeError:
            client.request("home_all")
            nr._wait(client, homed, 60, "homed (Home All)")
        for line in ("G21", "G92.1", "G49", XYZAC_G54, "G54", f"#3006={TRAVERSE:g}"):
            nr._short(client, line)
        nc = config / nr.NC_FILES
        text = (tree / XYZAC_PROGRAM).read_text()
        # the base worker's payload, in this state (another name: a load of its own)
        worker = tree / WORKER
        new = worker.read_bytes()
        base = subprocess.run(["git", "-C", str(tree), "show", f"{BASE}:{WORKER}"], capture_output=True, check=True).stdout
        try:
            worker.write_bytes(base)
            nr._load_program(ctx, client, "m600_live_base.ngc", text)
            time.sleep(8)                   # the idle edges (drift) have published
            raw, payload = pk.fetch(client, token)
        finally:
            worker.write_bytes(new)
        if payload.get("parse_error"):
            raise nr.Refused(f"the base worker: {payload['parse_error']}")
        base_file = run / "m600_live.base.msgpack"
        base_file.write_bytes(raw)
        # the gate: the published payload of the commit's worker, the run, the replay
        folder = nc / ".lcnc-live-gate"
        folder.mkdir()
        program = folder / "m600_live.ngc"
        program.write_text(text)
        corpus = run / "corpus.json"
        entry = json.loads((tree / "scripts/parity_corpus/xyzac.json").read_text())["programs"][0]
        corpus.write_text(json.dumps({"ini": str(ini), "programs": [{**entry, "file": str(program)}]}))
        out = run / "parity"
        r = subprocess.run([str(tree / "lcnc-gateway/.venv/bin/python3"), str(tree / "scripts/sim_parity.py"), "gate", "--corpus", str(corpus),
                            "--out-dir", str(out)], cwd=tree, env={**child_env(ctx), "LCNC_WS_TOKEN": token}, capture_output=True, text=True, timeout=1200)
        (run / "sim-parity.log").write_text(r.stdout + r.stderr)
        rep["parity"] = [ln for ln in r.stdout.splitlines() if re.match(r"\[(PASS|FAIL|----)\]|sim parity gate", ln)]
        rep["exit"] = r.returncode
        if client.error:
            raise RuntimeError(client.error)
        # the same run against the base worker's payload
        truth = out / "m600_live.run1.truth.ndjson"
        if truth.exists():
            import test_path_kinds_worker as T
            pk.sim_dump(tree, base_file, truth, run / "base.sim.jsonl")
            ok, said = sp.compare_files(str(truth), str(run / "base.sim.jsonl"), float(entry["tol"]))
            import msgspec
            mine = msgspec.msgpack.decode((out / "m600_live.run1.payload.msgpack").read_bytes())
            seqs = [{(v["stream"], v["seq"]): v["p"] for v in T.vertices(p)} for p in (payload, mine)]
            rep["base"] = {"pass": bool(ok), "detail": said, "vertices": [len(s) for s in seqs],
                           "only_new": [[k, v] for k, v in seqs[1].items() if k not in seqs[0]],
                           "only_base": [[k, v] for k, v in seqs[0].items() if k not in seqs[1]]}
        rep["worker_restored"] = hashlib.sha256(worker.read_bytes()).hexdigest() == hashlib.sha256(new).hexdigest()
        rep["verdict"] = "PASS" if r.returncode == 0 and rep["worker_restored"] and any(ln.startswith("[PASS] m600_live.run1:") for ln in rep["parity"]) \
            else "FAIL"
        return []
    return ("corpora-xyzac", step)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scripts", type=Path, required=True)
    ap.add_argument("--run-dir", type=Path, required=True)
    ap.add_argument("--commit", required=True)
    ap.add_argument("--profile", choices=sorted(PROFILES), required=True)
    ap.add_argument("--gate", action="append", default=[], help="twp: only these live-twp gates")
    a = ap.parse_args(argv)
    sys.dont_write_bytecode = True          # nothing beside the trees' sources
    scripts = a.scripts.resolve()
    sys.path.insert(0, str(scripts / "scripts"))
    import native_run as nr
    from test_support.heavy_lock import heavy_lock
    from test_support.system_host import SystemHost
    from test_support import restore_lan as rl
    if not nr.in_restore_unit():
        print("pathkinds.corpora: runs only in the user unit `native-run` with the restore as its ExecStopPost")
        return 2
    spec = importlib.util.spec_from_file_location("pathkinds_native", scripts / "docs/reviews/pathkinds.native.py")
    pk = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pk)
    profile, ini_name, joints = PROFILES[a.profile]
    nr.PROFILES[profile] = (ini_name, joints)
    steps = [nr.make_tree(a.commit, profile), nr.make_copy(profile), nr.start_copy(),
             twp_step(nr, a.gate) if a.profile == "twp" else xyzac_step(nr, pk)]
    with heavy_lock("pathkinds-corpora", wait=3600):
        try:
            report = nr.run(SystemHost(), steps, a.run_dir)
        except rl.TakeOverRefused as e:
            print(f"pathkinds.corpora: refused — {e}")
            return 2
    nr.write_json(a.run_dir / "report.json", report)
    said = (report.get("corpora") or {}).get("verdict")
    print(f"pathkinds.corpora {a.profile}: {'error: ' + report['error'] if report.get('error') else said} — restore "
          f"{report['restore']['outcome']} → {a.run_dir / 'report.json'}")
    return 0 if not report.get("error") and said == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

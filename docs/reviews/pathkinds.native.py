#!/usr/bin/env python3
"""Path kinds (step 0, 2026-11-25; Codex R487) — the published preview's path
against what the VM's REAL LinuxCNC commands, through the native stage's
machinery (scripts/native_run.py of the tree --scripts names: record + stop the
LAN sim, a run tree of --commit, a confined copy of the 3-axis profile, start,
the steps, the restore in `finally`; the unit's ExecStopPost is
restore_lan.py). Nothing is committed from the run but its record.

Programs (G54 at X300 Y300 Z-100, G61 exact path, F3000, no tool):
  g83     G98 G83 R3 Q3 Z-18 at two holes
  hidden  G0 Z15 / G0 Z-2 / G1 Z-5 / G0 Z15 / G0 Z-4.5 / G1 Z-8: the rapid
          into the block, hidden behind its feed
  pocket  a ramp from Z3 into a contour, the next level entered by rapid to
          Z-2.5 at the same X / Y
  rev     to and fro inside one kind (Codex R487 H1): his program's rapids
          Z40 / -10 / 15 / -5 / 20, then eight feeds of ONE line to and fro
          along X

Each program is loaded twice through the gateway: with the commit's parse
worker (`new`), and with the BASE worker (24f3bd3a) as the red control
(`base`) — the worker FILE alone is exchanged, in this run's own detached tree
under --run-dir (the gateway spawns it per parse), and put back byte for byte;
no other tree and no installed file is touched. The published bytes are fetched
by their version. Then the program runs once (Cycle Start through the gateway)
while STAT is polled every 2 ms: the COMMANDED joint positions, motion_type
(1 traverse, 2 feed, 3 arc), motion_line.

Judged, for `new` and for `base`:
  geometry  scripts/sim_parity.py compare_files, both ways: the run against the
            scrub's joints (scripts/runSimDump.mjs → simDump.ts: the client's
            own decode, merge, entry track, sampling and kinematics)
  order     the discrete Fréchet distance of the two paths, both resampled at
            0.1 mm: geometry alone cannot see a back-and-forth on one line
  kinds     the runs of one kind in execution order: rapid / feed by
            motion_type against the payload's streams merged by seq
            (lcnc-gateway/test_path_kinds_worker.py vertices / runs), each
            run's end point
PASS: `new` holds all three, `base` is red where the defect is — g83: order and
kinds; hidden: kinds; pocket: geometry, order; rev: order alone (the same
places, the same ends) — and the run was observed.

Tolerances. TOL_PATH 0.25 mm: the resampling (0.1) on both sides, STAT's cycle
(10 ms) cutting a reversal by at most a/2·(5 ms)² = 0.01 mm at 750 mm/s², the
decimation's 0.005; G61 stops at every vertex and the COMMANDED positions are
read, so no blending and no following error is in it. The smallest thing the
base worker drops here is a 2.7 mm retract. TOL_END 0.6 mm: a run's last
snapshot before the next run — one cycle (0.04 mm) as a rule, 40 ms of a late
poll at 750 mm/s² at the most; a larger gap anywhere while moving is named and
makes the program INCOMPLETE, never PASS.

Reused: native_run (make_tree, make_copy, start_copy, connect_client,
_home_joints, _short, _load_program, run), sim_parity.compare_files,
runSimDump / simDump, test_path_kinds_worker.vertices / runs; the context
header is twp_parity.sample_run's shape (sample_run itself starts the program
by raw NML, past the gateway).

  python3 -I docs/reviews/pathkinds.native.py --scripts <tree> --run-dir <dir> --commit <sha>
  python3 -I docs/reviews/pathkinds.native.py --selftest --scripts <tree>   (offline: no LinuxCNC, no lock)
Runs only as the user unit `native-run` (restore as its ExecStopPost).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

BASE = "24f3bd3a"
WORKER = "lcnc-gateway/gcode_parse_worker.py"
ORIGIN = (300.0, 300.0, -100.0)          # G54, machine: inner, Z40 at -60, Z-18 at -118 (limits -190 … 0.1)
HEAD = "G21 G90 G94 G17 G40 G49 G80 G54 G61\nG0 X0 Y0 Z40\n"
TAIL = "G80\nG0 Z40\nG64\nM2\n"
PROGRAMS = {
    "g83": HEAD + "G98 G83 X20 Y10 Z-18 R3 Q3 F3000\nX45\n" + TAIL,
    "hidden": HEAD + "G0 X50 Y30\nG0 Z15\nG0 Z-2\nG1 Z-5 F3000\nG0 Z15\nG0 Z-4.5\nG1 Z-8\nG0 Z15\nG0 X80\n" + TAIL,
    "pocket": HEAD + ("G0 X6 Y6\nG0 Z15\nG0 Z3\nG1 X26 Z-3 F3000\nG1 Y30\nG1 X6 Y6\nG0 Z5\nG0 Z-2.5\n"
                      "G1 X26 Z-6\nG1 Y30\nG1 X6 Y6\nG0 Z15\nG0 X80\n") + TAIL,
    "rev": HEAD + ("G0 X50 Y30\nG0 Z-10\nG0 Z15\nG0 Z-5\nG0 Z20\n#1=0\no100 while [#1 LT 8]\n"
                   "G1 X[75+25*[#1 MOD 2]+5*[[#1 MOD 4] GE 2]] F3000\n#1=[#1+1]\no100 endwhile\n") + TAIL,
}
#: what the base worker must fail, per program (the red control)
RED = {"g83": ("order", "kinds"), "hidden": ("kinds",), "pocket": ("geometry", "order"), "rev": ("order",)}
STEP, TOL_PATH, TOL_END, MAX_GAP_S = 0.1, 0.25, 0.6, 0.040
KIND = {1: "rapid", 2: "feed", 3: "feed"}        # STAT.motion_type; 0 and the rest name no move of a program


# ───────────────────────── the comparison (pure) ─────────────────────────

def densify(points, step=STEP):
    import numpy as np
    P = np.asarray(points, dtype=float)
    out = [P[:1]]
    for a, b in zip(P, P[1:]):
        n = max(1, int(np.ceil(np.linalg.norm(b - a) / step)))
        out.append(a + (b - a) * (np.arange(1, n + 1) / n)[:, None])
    return np.concatenate(out)


def frechet(A, B) -> float:
    """The discrete Fréchet distance of two point rows, by anti-diagonals."""
    import numpy as np
    n, m = len(A), len(B)
    prev2 = prev = np.full(n, np.inf)
    for k in range(n + m - 1):
        i0, i1 = max(0, k - m + 1), min(n - 1, k)
        i = np.arange(i0, i1 + 1)
        d = np.sqrt(((A[i] - B[k - i]) ** 2).sum(1))
        cur = np.full(n, np.inf)
        if k == 0:
            cur[0] = d[0]
        else:
            left = prev[i]                                         # (i, j - 1)
            up = np.where(i > 0, prev[i - 1], np.inf)              # (i - 1, j)
            diag = np.where(i > 0, prev2[i - 1], np.inf)           # (i - 1, j - 1)
            # outside the matrix: (i, -1) exists only where j > 0
            left = np.where(k - i > 0, left, np.inf)
            diag = np.where(k - i > 0, diag, np.inf)
            cur[i] = np.maximum(np.minimum(np.minimum(left, up), diag), d)
        prev2, prev = prev, cur
    return float(prev[n - 1])


def truth_runs(rows, offset):
    """[(kind, end point in the program frame)] of the commanded motion."""
    out = []
    for r in rows:
        kind = KIND.get(r["motion_type"])
        if kind is None:
            continue
        p = [r["joints"][k] - offset[k] for k in range(3)]
        if out and out[-1][0] == kind:
            out[-1][1] = p
        else:
            out.append([kind, p])
    return out


def payload_runs(T, payload):
    """[(kind, end point)] of the published path: its streams merged by seq."""
    return [[kind, list(last["p"])] for kind, _first, last in T.runs(T.vertices(payload))]


def kinds_problem(truth, shown):
    """None, or the first place where the runs of one kind differ."""
    for k in range(max(len(truth), len(shown))):
        if k >= len(truth) or k >= len(shown):
            return f"{len(truth)} runs driven, {len(shown)} shown; from run {k}: " \
                   f"{(truth if k < len(truth) else shown)[k]} is in one only"
        (a, p), (b, q) = truth[k], shown[k]
        if a != b:
            return f"run {k}: driven {a} to {[round(v, 2) for v in p]}, shown {b} to {[round(v, 2) for v in q]}"
        off = max(abs(x - y) for x, y in zip(p, q))
        if off > TOL_END:
            return f"run {k} ({a}) ends {off:.2f} off: driven {[round(v, 2) for v in p]}, shown {[round(v, 2) for v in q]}"
    return None


def observation(rows):
    """What the polling saw: the moving stretch's largest gap between two snapshots."""
    moving = [r for r in rows if r["motion_type"] in KIND]
    gaps = [b["t"] - a["t"] for a, b in zip(moving, moving[1:])]
    return {"rows": len(rows), "moving": len(moving), "max_gap_s": round(max(gaps, default=float("inf")), 4),
            "observed": bool(moving) and max(gaps, default=float("inf")) <= MAX_GAP_S}


def judge(T, sp, truth_file, rows, offset, sim_file, payload):
    """The three verdicts of one payload against one run."""
    import numpy as np
    geometry, said = sp.compare_files(str(truth_file), str(sim_file), TOL_PATH)
    sim, nulls = sp.load_sim_joints(str(sim_file))
    run = np.asarray([r["joints"] for r in rows], dtype=float)
    keep = np.r_[True, np.abs(np.diff(run, axis=0)).sum(1) > 1e-9]     # a standing machine adds no path
    dist = frechet(densify(run[keep]), densify(np.asarray(sim)[:, :3]))
    driven, shown = truth_runs(rows, offset), payload_runs(T, payload)
    problem = kinds_problem(driven, shown)
    return {"geometry": {"pass": bool(geometry), "detail": said}, "order": {"pass": dist <= TOL_PATH, "frechet_mm": round(dist, 3)},
            "kinds": {"pass": problem is None, "detail": problem, "driven": len(driven), "shown": len(shown)},
            "null_samples": int(nulls)}


def verdict(name, obs, new, base):
    if not obs["observed"]:
        return "incomplete", f"the run was not observed closely enough: {obs}"
    bad = [k for k in ("geometry", "order", "kinds") if not new[k]["pass"]]
    if bad:
        return "FAIL", f"the published path fails {bad}"
    blind = [k for k in RED[name] if base[k]["pass"]]
    if blind:
        return "FAIL", f"the base worker's path passes {blind}: the control does not see the defect"
    return "PASS", f"the base worker's path fails {[k for k in ('geometry', 'order', 'kinds') if not base[k]['pass']]}"


# ───────────────────────── the native step ─────────────────────────

class Poller(threading.Thread):
    """STAT every 2 ms: a row per changed snapshot (the task's cycle is 10 ms)."""

    def __init__(self, stat):
        super().__init__(daemon=True)
        self.stat, self.stop, self.rows, self.error = stat, threading.Event(), [], None

    def run(self):
        last = None
        t0 = time.monotonic()
        try:
            while not self.stop.is_set():
                s = self.stat
                s.poll()
                row = {"joints": [round(v, 6) for v in s.joint_position[:3]], "motion_type": int(s.motion_type),
                       "motion_line": int(s.motion_line), "interp": int(s.interp_state), "mode": int(s.task_mode)}
                key = tuple(row["joints"]) + (row["motion_type"], row["motion_line"], row["interp"])
                if key != last:
                    last = key
                    self.rows.append({"t": round(time.monotonic() - t0, 4), **row})
                time.sleep(0.002)
        except Exception as e:  # noqa: BLE001 — named: an ended poller is no observation
            self.error = f"{type(e).__name__}: {e}"


def fetch(client, token):
    """The published bytes by the origin's version and program; superseded by a
    newer publication of the same program meanwhile (409): asked again."""
    import msgspec
    import urllib.error
    import urllib.request
    from urllib.parse import urlencode
    for _ in range(10):
        origin = dict(client.preview_origin)
        q = urlencode({"v": origin["version"], "p": origin.get("program_id") or ""})
        req = urllib.request.Request(f"http://127.0.0.1:8000/preview?{q}", headers={"X-Auth-Token": token})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            return body, msgspec.msgpack.decode(body)
        except urllib.error.HTTPError as e:
            if e.code != 409:
                raise
            time.sleep(0.5)
    raise RuntimeError("the preview was superseded ten times")


def sim_dump(tree, payload_file, truth_file, out):
    r = subprocess.run(["node", "scripts/runSimDump.mjs", str(payload_file), str(truth_file), str(out)],
                       cwd=Path(tree) / "lcnc-webui", capture_output=True, text=True, timeout=180)
    if r.returncode or not Path(out).exists():
        raise RuntimeError(f"simDump rc={r.returncode} {r.stderr[-600:]}")
    return r.stdout.strip().splitlines()[-1]


def write_truth(path, header, rows):
    with open(path, "w") as f:
        for r in (header, *rows):
            f.write(json.dumps(r) + "\n")


def make_step(nr):
    def step(ctx):
        import linuxcnc
        c, tree, out = ctx["client"], Path(ctx["tree"]), ctx["run"] / "pathkinds"
        out.mkdir()
        rep = ctx["report"].setdefault("pathkinds", {})
        for p in (tree / "lcnc-gateway", tree / "scripts"):
            sys.path.insert(0, str(p))
        import sim_parity as sp
        import test_path_kinds_worker as T
        token = (nr.lt.ini_values(ctx["ini"].read_text()).get(("DISPLAY", "WEBUI_TOKEN")) or [""])[-1]
        worker = tree / WORKER
        new = worker.read_bytes()
        base = subprocess.run(["git", "-C", str(tree), "show", f"{BASE}:{WORKER}"], capture_output=True, check=True).stdout
        sha = lambda b: hashlib.sha256(b).hexdigest()[:16]
        rep["workers"] = {"new": sha(new), "base": sha(base), "base_commit": BASE}
        if new == base:
            raise nr.Refused("the commit's worker IS the base worker — no control")
        nr._home_joints(c, 3)
        c.request("set_feed_override", scale=1.0)
        for line in ("G21", "G92.1", "G49", f"G10 L2 P1 X{ORIGIN[0]:g} Y{ORIGIN[1]:g} Z{ORIGIN[2]:g} R0", "G54"):
            nr._short(c, line)
        stat = linuxcnc.stat()
        results = rep["programs"] = {}
        for name, text in PROGRAMS.items():
            res = results[name] = {}
            payloads = {}
            try:
                for variant, body in (("base", base), ("new", new)):      # `new` last: the program that runs
                    worker.write_bytes(body)
                    nr._load_program(ctx, c, f"pathkinds_{name}_{variant}.ngc", text)
                    raw, payload = fetch(c, token)
                    (out / f"{name}.{variant}.msgpack").write_bytes(raw)
                    payloads[variant] = payload
                    res[f"{variant}_vertices"] = len(T.vertices(payload))
            finally:
                worker.write_bytes(new)
            if payloads["new"].get("parse_error") or payloads["base"].get("parse_error"):
                raise nr.Refused(f"{name}: {payloads['new'].get('parse_error')} / {payloads['base'].get('parse_error')}")
            if payloads["new"].get("violations_total"):
                # a soft limit ends the run: no comparison of paths
                raise nr.Refused(f"{name}: the program leaves the travel: {payloads['new'].get('violations')}")
            # ---- the run
            stat.poll()
            header = {"header": True, "axes": ["X", "Y", "Z"], "kins": None, "start_joints": list(stat.joint_position[:3]),
                      "wcs": {"g5x": list(stat.g5x_offset[:9]), "g92": list(stat.g92_offset[:9]),
                              "rotationDeg": stat.rotation_xy, "tool": list(stat.tool_offset[:3])},
                      "wcs_table": [{"name": f"G{54 + k}" if k < 6 else f"G59.{k - 5}",
                                     **dict(zip("xyzabcuvw", [*(ORIGIN if k == 0 else (0, 0, 0)), 0, 0, 0, 0, 0, 0])), "r": 0.0}
                                    for k in range(9)]}
            offset = [stat.g5x_offset[k] + stat.g92_offset[k] + stat.tool_offset[k] for k in range(3)]
            if max(abs(a - b) for a, b in zip(offset, ORIGIN)) > 1e-6:
                raise nr.Refused(f"{name}: the offsets in effect are {offset}, not {ORIGIN}")
            poller = Poller(linuxcnc.stat())
            poller.start()
            try:
                time.sleep(0.1)
                c.request("cycle_start")
                end, busy, idle_since = time.monotonic() + 120, False, None
                while time.monotonic() < end:
                    stat.poll()
                    running = stat.interp_state != linuxcnc.INTERP_IDLE or not stat.inpos
                    busy = busy or running
                    idle_since = None if running or not busy else idle_since or time.monotonic()
                    if idle_since and time.monotonic() - idle_since > 0.5 and stat.task_mode == linuxcnc.MODE_AUTO:
                        break
                    if c.error:
                        raise RuntimeError(c.error)
                    time.sleep(0.02)
                else:
                    c.request("abort")
                    raise nr.Refused(f"{name}: the run did not end within 120 s (busy {busy})")
                time.sleep(0.3)
            finally:
                poller.stop.set()
                poller.join(5)
            if poller.error:
                raise RuntimeError(f"{name}: the polling ended: {poller.error}")
            rows = poller.rows
            truth = out / f"{name}.truth.ndjson"
            write_truth(truth, header, rows)
            res["observation"] = observation(rows)
            for variant in ("new", "base"):
                sim = out / f"{name}.{variant}.sim.jsonl"
                res[f"{variant}_dump"] = sim_dump(tree, out / f"{name}.{variant}.msgpack", truth, sim)
                res[variant] = judge(T, sp, truth, rows, offset, sim, payloads[variant])
            res["verdict"], res["why"] = verdict(name, res["observation"], res["new"], res["base"])
        rep["worker_restored"] = sha(worker.read_bytes()) == rep["workers"]["new"]
        rep["verdict"] = "PASS" if rep["worker_restored"] and len(results) == len(PROGRAMS) \
            and all(r["verdict"] == "PASS" for r in results.values()) else "FAIL"
        return []
    return step


# ───────────────────────── offline self-test ─────────────────────────

def selftest(scripts: Path) -> int:
    """The comparison on synthetic runs, no LinuxCNC: the committed payloads
    (path_kinds_payloads) — `.full` drives, the shipped one is shown — and a
    path with its changes dropped. Through simDump too."""
    import tempfile
    import msgspec
    for p in (scripts / "lcnc-gateway", scripts / "scripts"):
        sys.path.insert(0, str(p))
    import numpy as np
    import sim_parity as sp
    import test_path_kinds_worker as T
    fx = scripts / "scripts/test_fixtures/path_kinds_payloads"
    load = lambda n: (fx / f"{n}.msgpack", msgspec.msgpack.decode((fx / f"{n}.msgpack").read_bytes()))
    bad = []
    with tempfile.TemporaryDirectory(prefix="pathkinds-selftest-") as tmp:
        for case, red in (("pk_g83_99", ("order", "kinds")), ("pk_hidden_rapid", ("kinds",)), ("pk_ramp_levels", ("geometry", "order")),
                          ("pk_rev_many", ("order",))):
            thin_file, thin = load(case)
            path = T.vertices(load(f"{case}.full")[1])
            # a synthetic run over the un-thinned path: 1 mm steps, the program frame as joints
            start, t = [100.0, 100.0, 45.0], 0.0
            rows = [{"t": t, "joints": start, "motion_type": 0, "motion_line": 0, "interp": 1, "mode": 2}]   # the poller runs before the start
            at = start
            for v in path:
                for p in densify([at, v["p"]], 1.0)[1:]:
                    t += 0.01
                    rows.append({"t": t, "joints": [float(x) for x in p], "motion_type": 1 if v["stream"] == "rapid" else 2,
                                 "motion_line": 1, "interp": 2, "mode": 2})
                at = v["p"]
            header = {"header": True, "axes": ["X", "Y", "Z"], "kins": None, "start_joints": start,
                      "wcs": {"g5x": [0] * 9, "g92": [0] * 9, "rotationDeg": 0, "tool": [0, 0, 0]}, "wcs_table": []}
            truth = Path(tmp) / f"{case}.ndjson"
            write_truth(truth, header, rows)
            # the same path with the rapid vertices thinned as the base worker did: every
            # rapid vertex on the chord of its neighbours in the RAPID stream dropped
            import copy
            lost = copy.deepcopy(thin)
            rp, rq = (np.frombuffer(thin[k], d).reshape(-1, w) for k, d, w in (("rapid", "<f4", 3), ("rapid_seq", "<u4", 1)))
            sys.path.insert(0, str(scripts / "lcnc-gateway"))
            keep = _rdp(rp.astype(float), 0.005)
            for k, d, w in (("rapid", "<f4", 3), ("rapid_seq", "<u4", 1), ("rapid_lines", "<u4", 1), ("rapid_tcum", "<f4", 1),
                            ("rapid_brk", "<u1", 1), ("rapid_ustart", "<u1", 1), ("rapid_lineok", "<u1", 1), ("rapid_outside", "<u1", 1)):
                if thin.get(k):
                    lost[k] = np.frombuffer(thin[k], d).reshape(-1, w)[keep].tobytes()
            lost_file = Path(tmp) / f"{case}.lost.msgpack"
            lost_file.write_bytes(msgspec.msgpack.encode(lost))
            for label, file, payload, want in (("shipped", thin_file, thin, ()), ("changes dropped", lost_file, lost, red)):
                sim = Path(tmp) / f"{case}.{label[:4]}.jsonl"
                sim_dump(scripts, file, truth, sim)
                got = judge(T, sp, truth, rows, [0, 0, 0], sim, payload)
                failed = [k for k in ("geometry", "order", "kinds") if not got[k]["pass"]]
                ok = (not failed) if not want else set(want) <= set(failed)
                print(f"{case} {label}: fails {failed}; Fréchet {got['order']['frechet_mm']}, {got['kinds']['detail']}; {got['geometry']['detail'][:70]}"
                      f" -> {'ok' if ok else 'WRONG'}")
                if not ok:
                    bad.append(f"{case} {label}")
            if not observation(rows)["observed"]:
                bad.append(f"{case}: the synthetic run is not observed")
            if observation(rows[:3] + [{**r, "t": r["t"] + 1.0} for r in rows[3:]])["observed"]:
                bad.append("a one-second gap reads as observed")
    print("selftest:", "PASS" if not bad else f"FAIL {bad}")
    return 1 if bad else 0


def _rdp(P, eps):
    """The base worker's thinning of one stream (no anchors but the ends)."""
    import numpy as np
    keep = np.zeros(len(P), dtype=bool)
    keep[[0, -1]] = True
    stack = [(0, len(P) - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        d, Q = P[b] - P[a], P[a + 1:b] - P[a]
        L2 = float(d @ d)
        t = np.clip((Q @ d) / L2, 0, 1) if L2 else np.zeros(len(Q))
        off = ((Q - t[:, None] * d) ** 2).sum(1)
        k = int(off.argmax())
        if off[k] > eps * eps:
            keep[a + 1 + k] = True
            stack += [(a, a + 1 + k), (a + 1 + k, b)]
    return np.flatnonzero(keep)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scripts", type=Path, required=True)
    ap.add_argument("--run-dir", type=Path)
    ap.add_argument("--commit")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    sys.dont_write_bytecode = True          # nothing beside the trees' sources
    if a.selftest:
        return selftest(a.scripts.resolve())
    if not (a.run_dir and a.commit):
        ap.error("--run-dir and --commit")
    sys.path.insert(0, str(a.scripts.resolve() / "scripts"))
    import native_run as nr
    from test_support.heavy_lock import heavy_lock
    from test_support.system_host import SystemHost
    from test_support import restore_lan as rl
    if not nr.in_restore_unit():
        print("pathkinds.native: runs only in the user unit `native-run` with the restore as its ExecStopPost")
        return 2
    steps = [nr.make_tree(a.commit, "3axis_xyz"), nr.make_copy("3axis_xyz"), nr.start_copy(), nr.connect_client(),
             ("pathkinds", make_step(nr))]
    with heavy_lock("pathkinds", wait=3600):
        try:
            report = nr.run(SystemHost(), steps, a.run_dir)
        except rl.TakeOverRefused as e:
            print(f"pathkinds.native: refused — {e}")
            return 2
    nr.write_json(a.run_dir / "report.json", report)
    said = (report.get("pathkinds") or {}).get("verdict")
    print(f"pathkinds.native: {'error: ' + report['error'] if report.get('error') else said} — restore "
          f"{report['restore']['outcome']} → {a.run_dir / 'report.json'}")
    return 0 if not report.get("error") and said == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

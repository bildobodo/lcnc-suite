"""P6-a parse-time measurement (Codex R459: "Die Backend-Gesamtdauern
verschiedener Zweige sind keine Messung des zusätzlichen Callback-Aufwands").

The worker's `parse(ctx)` on ONE big program, timed in two trees that differ
in lcnc-gateway/gcode_canon.py only (the base 4eda3892 and P6-a fd720676,
`git archive` copies): the same route as native_start_probe.py (LinuxCNC's
native offline interpreter, synthetic STAT, a temporary INI / var file / tool
table and a private tool data mmap under a private HOME — never the live
sim's), the same setup for both trees (this file, not each tree's probe: the
base's probe lacks the machine day's setup the program needs — its `T13
M600` runs the bundled toolsetter routine through the M600 remap).

  child:   python3 -I p6a.parse-time.py run <tree> <program>
  series:  python3 -I p6a.parse-time.py series <base tree> <head tree> <program> <out.json> [runs]
  pattern: python3 -I p6a.parse-time.py pattern

A child prints one JSON line: wall (perf_counter) and CPU (process_time)
seconds around `worker.parse(ctx)` alone, the parse error, the move counts
and a digest of the payload (every field) — equal in both trees, or the two
parses did not do the same work. The series runs one warm-up per tree
(discarded: the page cache, the .pyc files), then base, head alternating,
`runs` each, every run a fresh process; run it under the heavy lock.
"""
import hashlib
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def child(tree, program):
    import contextlib
    import ctypes
    import io
    from collections import namedtuple
    from types import SimpleNamespace

    gw = Path(tree).resolve() / "lcnc-gateway"
    sys.path.insert(0, str(gw))
    import linuxcnc

    work = Path(tempfile.mkdtemp(prefix="p6a-parse-time-"))
    try:
        os.environ["LCNC_LOG_DIR"] = str(work / "logs")
        ini = work / "machine.ini"
        # the machine day's machine (native_start_probe's `_mday` case): its
        # limits, velocities, the M600 remap and the bundled routines
        ini.write_text(f"""[EMC]
MACHINE = P6A_PARSE_TIME
[TRAJ]
COORDINATES = XYZ
LINEAR_UNITS = mm
ANGULAR_UNITS = degree
MAX_LINEAR_VELOCITY = 100
[RS274NGC]
PARAMETER_FILE = machine.var
SUBROUTINE_PATH = {work}
REMAP=M600 modalgroup=6 ngc=m600
[EMCIO]
TOOL_TABLE = tool.tbl
[AXIS_X]
MIN_LIMIT = -0.1
MAX_LIMIT = 685
MAX_VELOCITY = 100
[AXIS_Y]
MIN_LIMIT = -0.1
MAX_LIMIT = 705
MAX_VELOCITY = 100
[AXIS_Z]
MIN_LIMIT = -190
MAX_LIMIT = 0.1
MAX_VELOCITY = 80
""")
        os.environ["INI_FILE_NAME"] = str(ini)
        tools = [(1, 10), (13, 63.192), (99, 67.2175)]
        (work / "tool.tbl").write_text("".join(f"T{n} P{n} Z{z} D6\n" for n, z in tools))
        ts = {3004: 500, 3005: 50, 3006: 6000, 3007: 180, 3009: 2, 3010: 180, 3013: 3, 3014: 0,
              3100: 0, 3101: 0, 3102: -180, 3103: 0, 3104: 0, 3105: 0, 3106: 0, 3107: 5, 3108: 0,
              3109: 0, 3110: 0, 3111: 25, 3112: 50, 3113: 0, 3114: 0, 3115: 0, 3116: 0}
        var = {5161: 0, 5181: 0, 5182: 0, 5183: 0, 5210: 1, 5211: 0, 5212: 0, 5213: 0,
               5220: 1, 5221: 0, 5222: 0, 5223: 0, **ts}
        (work / "machine.var").write_text("".join(f"{k} {var[k]}\n" for k in sorted(var)))
        for rel in ("tool_length_probe/m600.ngc", "tool_length_probe/tool_touch_off.ngc"):
            shutil.copy(Path(tree) / "subroutines" / rel, work / Path(rel).name)
        # the tool data mmap a running iocontrol makes, in THIS process under
        # a private HOME (native_start_probe.py: tool_mmap_creator,
        # tooldata_init, tooldata_load)
        os.environ["HOME"] = str(work)
        td = ctypes.CDLL("libtooldata.so.0")
        stat_buf = ctypes.create_string_buffer(1 << 20)
        td["_Z17tool_mmap_creatorPK13EMC_TOOL_STATi"](stat_buf, 0)
        td["_Z13tooldata_initb"].argtypes = [ctypes.c_bool]
        td["_Z13tooldata_initb"](False)
        load = td["_Z13tooldata_loadPKcPPc"]
        load.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_char_p)]
        comments = [ctypes.create_string_buffer(256) for _ in range(1001)]
        ptrs = (ctypes.c_char_p * 1001)(*[ctypes.cast(b, ctypes.c_char_p) for b in comments])
        if load(str(work / "tool.tbl").encode(), ptrs) != 0:
            raise SystemExit("tool table not loaded")
        ngc = work / "program.ngc"
        shutil.copy(program, ngc)

        Tool = namedtuple("Tool", "id xoffset yoffset zoffset aoffset boffset coffset "
                                  "uoffset voffset woffset diameter frontangle backangle orientation")
        s = SimpleNamespace(poll=lambda: None, axis_mask=7, angular_units=1.0, linear_units=1.0,
                            block_delete=False, actual_position=[0] * 9, g92_offset=[0] * 9,
                            tool_offset=[0] * 9, tool_in_spindle=1, gcodes=(490,), joint=None,
                            tool_table=[Tool(n, 0, 0, z, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0)
                                        for n, z in [tools[0]] + tools])
        linuxcnc.stat = lambda: s

        def no_command(*a, **kw):
            raise AssertionError("machine commands prohibited")
        linuxcnc.command = no_command

        import msgspec
        import gcode_canon
        import gcode_parse_worker as worker
        assert Path(gcode_canon.__file__).resolve().parent == gw, gcode_canon.__file__
        fix = {str(b + j): "0" for b in range(5220, 5381, 20) for j in range(1, 11)}
        fix.update({"5221": "238.525", "5222": "379.696", "5223": "-96.75"})
        ctx = {"file": str(ngc), "ini_path": str(ini), "units": "mm", "g5x_index": 1,
               "var_patches": fix, "kins_type": 0, "kins_frame": None}
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            c0, t0 = time.process_time(), time.perf_counter()
            out = worker.parse(ctx)
            t1, c1 = time.perf_counter(), time.process_time()
        st = out.get("stats") or {}
        comparable = {k: v for k, v in out.items() if k != "file"}
        print(json.dumps({
            "tree": str(tree), "canon_sha256": hashlib.sha256(Path(gcode_canon.__file__).read_bytes()).hexdigest(),
            "wall_s": t1 - t0, "cpu_s": c1 - c0, "parse_error": out.get("parse_error"),
            "feedMoves": st.get("feedMoves"), "rapidMoves": st.get("rapidMoves"), "arcMoves": st.get("arcMoves"),
            "start_believed": out.get("start_believed"),
            "digest_without_start": hashlib.sha256(msgspec.msgpack.encode(
                {k: v for k, v in comparable.items() if k not in ("start_believed", "tlo_start")})).hexdigest(),
        }))
    finally:
        shutil.rmtree(work, True)


def one(tree, program):
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    p = subprocess.run([sys.executable, "-I", __file__, "run", str(tree), str(program)], capture_output=True,
                       text=True, env=env, cwd=Path(tree) / "lcnc-gateway", timeout=3600)
    lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
    if p.returncode != 0 or not lines:
        raise SystemExit(f"{tree}: rc={p.returncode} {p.stdout[-400:]} {p.stderr[-1200:]}")
    r = json.loads(lines[-1])
    if r["parse_error"]:
        raise SystemExit(f"{tree}: parse error {r['parse_error']}")
    return r


def series(base, head, program, out, runs=3):
    rows = []
    started = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    for label, tree in (("base", base), ("head", head)):
        r = one(tree, program)
        rows.append({"label": label, "warmup": True, **r})
        print(json.dumps(rows[-1]), flush=True)
    for _ in range(runs):
        for label, tree in (("base", base), ("head", head)):
            r = one(tree, program)
            rows.append({"label": label, "warmup": False, **r})
            print(json.dumps(rows[-1]), flush=True)
    summary = {}
    for label in ("base", "head"):
        kept = [r for r in rows if r["label"] == label and not r["warmup"]]
        for key in ("wall_s", "cpu_s"):
            v = [r[key] for r in kept]
            summary[f"{label}_{key}"] = {"runs": v, "median": statistics.median(v), "min": min(v), "max": max(v),
                                         "spread": max(v) - min(v)}
    for key in ("wall_s", "cpu_s"):
        b, h = summary[f"base_{key}"]["median"], summary[f"head_{key}"]["median"]
        summary[f"diff_{key}"] = {"seconds": h - b, "percent": 100.0 * (h - b) / b}
    kept = [r for r in rows if not r["warmup"]]
    same_work = len({r["digest_without_start"] for r in kept}) == 1
    record = {"program": str(program), "lines": sum(1 for _ in open(program, "rb")),
              "program_sha256": hashlib.sha256(Path(program).read_bytes()).hexdigest(),
              "started": started, "ended": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "runs_per_tree": runs,
              "same_work": same_work, "rows": rows, "summary": summary}
    Path(out).write_text(json.dumps(record, indent=1) + "\n")
    print(json.dumps({"same_work": same_work, **{k: v for k, v in summary.items() if k.startswith("diff")},
                      **{k: v["median"] for k, v in summary.items() if not k.startswith("diff")}}), flush=True)
    return 0 if same_work else 1


def pattern(n=2_000_000, repeat=7):
    """The added statements alone, per call: a motion handler's shape before
    and after P6-a (straight_feed's: `try`, the `seq == 0` test, the `finally`
    store) around the same trivial body, past the first point (seq > 0, as
    for every callback but the first). A model of the cost, not the canon."""
    import timeit

    class Canon:
        seq = 1
        suppress = 0
        _start_proof = None
        n = 0

        def _enter(self):
            pass

        def _body(self):
            self.n += 1

        def before(self):
            self._enter()
            if self.suppress > 0: return
            self._body()

        def after(self):
            self._enter()
            if self.suppress > 0: return
            try:
                if self.seq == 0:
                    self._start_proof = None
                self._body()
            finally:
                self._start_proof = None

    c = Canon()
    out = {}
    for name in ("before", "after", "before", "after"):
        f = getattr(c, name)
        best = min(timeit.repeat(f, number=n, repeat=repeat)) / n * 1e9
        out.setdefault(name, []).append(best)
    res = {k: min(v) for k, v in out.items()}
    res["added_ns"] = res["after"] - res["before"]
    print(json.dumps({"python": sys.version.split()[0], "calls": n, "repeat": repeat, "ns_per_call": res}))


if __name__ == "__main__":
    if sys.argv[1] == "pattern":
        pattern()
    elif sys.argv[1] == "run":
        child(sys.argv[2], sys.argv[3])
    elif sys.argv[1] == "series":
        raise SystemExit(series(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5],
                                int(sys.argv[6]) if len(sys.argv) > 6 else 3))
    else:
        raise SystemExit(__doc__)

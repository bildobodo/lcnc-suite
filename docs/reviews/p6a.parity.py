"""P6-a parity corpora, before and after (plan maschinentag.r457.p6a-plan-v3
build item 3, Codex R457): every program of the TWP gantry and the XYZAC
corpus (scripts/parity_corpus/twp_gantry.json, xyzac.json) through the REAL
parse worker of a tree — base and fix — under the profile's own INI from that
tree's examples/sim_config (cwd = the INI's directory, as LinuxCNC runs a
display), its var file and tool table, LinuxCNC's native offline interpreter.
No running LinuxCNC: STAT is synthetic (the profile's axis mask, mm, the
tool table, the rotaries at 0 — pinned as `rotary_pose`, a G49 start) and
`linuxcnc.command` raises, as in lcnc-gateway/native_start_probe.py; the tool
data mmap is made in this process under a private HOME. One process per parse.

Variants per profile: the template's stored fixtures (`stored`) and the
fixture the corpus names for its live runs (`corpus`: TWP G54 −100 140 −725 —
its programs write it themselves; XYZAC G54 −238.281465 −200 −103.798156).

  python3 -I docs/reviews/p6a.parity.py run <tree> <out_dir>
  python3 -I docs/reviews/p6a.parity.py compare <base_out> <fix_out>
"""
import json
import os
import subprocess
import sys
from pathlib import Path

PY = Path(__file__).resolve().parents[2] / "lcnc-gateway/.venv/bin/python3"
PROFILES = {
    "twp_gantry": ("lcnc_suite_sim_6axis_twp_xyzabc.ini", "twp_gantry.json", 63, "XYZABC",
                   {"stored": {}, "corpus": {"5221": "-100", "5222": "140", "5223": "-725"}}),
    "xyzac": ("lcnc_suite_sim_5axis_xyzac.ini", "xyzac.json", 47, "XYZAC",
              {"stored": {}, "corpus": {"5221": "-238.281465", "5222": "-200", "5223": "-103.798156"}}),
}
FIELDS = ("parse_error", "start_believed", "start_unbound", "start_dep_unavailable", "rapid_dep", "feed_dep",
          "rapid_ustart", "points", "digest_without_start")


def one(tree, profile, variant, program):
    """The parse, in THIS process (spawned by `run`)."""
    import ctypes
    import hashlib
    import io
    import contextlib
    import re
    import shutil
    import tempfile
    from collections import namedtuple
    from types import SimpleNamespace
    tree, program = Path(tree).resolve(), Path(program).resolve()
    ini_name, _corpus, mask, letters, variants = PROFILES[profile]
    cfg = tree / "examples/sim_config"
    ini = cfg / ini_name
    work = Path(tempfile.mkdtemp(prefix="p6a-parity-"))
    try:
        os.environ["LCNC_LOG_DIR"] = str(work / "logs")
        os.environ["INI_FILE_NAME"] = str(ini)
        os.environ["HOME"] = str(work)
        os.chdir(cfg)
        sys.path.insert(0, str(tree / "lcnc-gateway"))
        import linuxcnc
        tbl_rel = next(ln.split("=", 1)[1].strip() for ln in ini.read_text().splitlines()
                       if re.match(r"\s*TOOL_TABLE\s*=", ln))
        tbl = cfg / tbl_rel
        shutil.copy(tbl, work / "tool.tbl")
        tools = []
        for ln in tbl.read_text().splitlines():
            m = re.match(r"\s*T(\d+)\b.*?\bZ([-+0-9.]+)", ln)
            if m:
                tools.append((int(m.group(1)), float(m.group(2))))
        td = ctypes.CDLL("libtooldata.so.0")
        keep = ctypes.create_string_buffer(1 << 20)
        td["_Z17tool_mmap_creatorPK13EMC_TOOL_STATi"](keep, 0)
        td["_Z13tooldata_initb"].argtypes = [ctypes.c_bool]
        td["_Z13tooldata_initb"](False)
        load = td["_Z13tooldata_loadPKcPPc"]
        load.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_char_p)]
        comments = [ctypes.create_string_buffer(256) for _ in range(1001)]
        ptrs = (ctypes.c_char_p * 1001)(*[ctypes.cast(b, ctypes.c_char_p) for b in comments])
        if load(str(work / "tool.tbl").encode(), ptrs) != 0:
            raise SystemExit("tool table not loaded")
        Tool = namedtuple("Tool", "id xoffset yoffset zoffset aoffset boffset coffset "
                                  "uoffset voffset woffset diameter frontangle backangle orientation")
        tt = [Tool(n, 0, 0, z, 0, 0, 0, 0, 0, 0, 6, 0, 0, 0) for n, z in tools]
        s = SimpleNamespace(poll=lambda: None, axis_mask=mask, angular_units=1.0, linear_units=1.0,
                            block_delete=False, actual_position=[0.0] * 9, g92_offset=[0.0] * 9,
                            tool_offset=[0.0] * 9, tool_in_spindle=0, gcodes=(490,),
                            tool_table=[Tool(-1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)] + tt, joint=None)
        linuxcnc.stat = lambda: s

        def no_command(*a, **kw):
            raise AssertionError("machine commands prohibited")
        linuxcnc.command = no_command
        import msgspec
        import numpy as np
        import gcode_parse_worker as worker
        ctx = {"file": str(program), "ini_path": str(ini), "units": "mm", "g5x_index": 1,
               "var_patches": dict(variants[variant]), "kins_type": 0, "kins_frame": None,
               "rotary_pose": {k: 0.0 for k in letters[3:]}}
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            out = worker.parse(ctx)
        comparable = {k: v for k, v in out.items() if k not in ("file", "tlo_start", "start_believed")}
        u8 = lambda k: list(out[k]) if isinstance(out.get(k), bytes) else out.get(k)
        n = lambda k: len(np.frombuffer(out[k], dtype=np.float32)) // 3 if isinstance(out.get(k), bytes) else 0
        rec = {k: out.get(k) for k in ("parse_error", "start_believed", "start_unbound", "start_dep_unavailable")}
        rec.update(rapid_dep=u8("rapid_dep"), feed_dep=u8("feed_dep"), rapid_ustart=u8("rapid_ustart"),
                   points={"feed": n("feed"), "rapid": n("rapid")},
                   digest_without_start=hashlib.sha256(msgspec.msgpack.encode(comparable)).hexdigest(),
                   errors=[ln for ln in err.getvalue().splitlines() if "rror" in ln][-3:])
        print(json.dumps(rec))
    finally:
        shutil.rmtree(work, True)


def run(tree, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    corpus_dir = Path(tree) / "scripts/parity_corpus"
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    rows = []
    for profile, (_ini, corpus, *_rest) in PROFILES.items():
        progs = [p["file"] for p in json.loads((corpus_dir / corpus).read_text())["programs"]]
        for variant in PROFILES[profile][4]:
            for prog in progs:
                p = subprocess.run([str(PY), "-I", __file__, "one", str(tree), profile, variant,
                                    str(corpus_dir / prog)], capture_output=True, text=True, env=env, timeout=600)
                lines = [ln for ln in p.stdout.splitlines() if ln.startswith("{")]
                rec = json.loads(lines[-1]) if lines else {"error": f"rc={p.returncode}", "stderr": p.stderr[-1200:]}
                rows.append({"profile": profile, "variant": variant, "program": prog, **rec})
    (out / "parity.json").write_text(json.dumps(rows, indent=1))
    print(json.dumps({"parses": len(rows), "errors": [r["program"] for r in rows if "error" in r or r.get("parse_error")]}))


def compare(base, fix):
    a = {(r["profile"], r["variant"], r["program"]): r for r in json.loads((Path(base) / "parity.json").read_text())}
    b = {(r["profile"], r["variant"], r["program"]): r for r in json.loads((Path(fix) / "parity.json").read_text())}
    for k in sorted(a):
        ra, rb = a[k], b.get(k, {})
        diff = [f for f in FIELDS if f != "start_believed" and ra.get(f) != rb.get(f)]
        sa, sb = ra.get("start_believed"), rb.get("start_believed")
        moved = (sa is None) != (sb is None) or (sa is not None and max(abs(x - y) for x, y in zip(sa, sb)) > 1e-9)
        print(json.dumps({"case": "/".join(k), "start_believed": [sa, sb] if moved else "equal",
                          "other_fields_changed": diff, "start_unbound": [ra.get("start_unbound"), rb.get("start_unbound")],
                          "dep": [ra.get("rapid_dep"), ra.get("feed_dep")], "errors": [ra.get("error"), rb.get("error")]}))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "one":
        one(*sys.argv[2:6])
    elif cmd == "run":
        run(*sys.argv[2:4])
    elif cmd == "compare":
        compare(*sys.argv[2:4])

import json, subprocess, os, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
GW = Path("/home/cnc/lcnc-suite-partb/lcnc-gateway")
PY = "/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python"
sys.path.insert(0, str(HERE)); from compare import classify
EPS = json.loads(os.environ.get("EPS", "[0, 0, 1.0]"))
env = dict(os.environ); env.pop("PYTHONPATH", None)
def one(prog, ini, seed, tag):
    out = HERE / f"out/{tag}.npz"; out.parent.mkdir(exist_ok=True)
    p = subprocess.run(["nice", "-n", "10", PY, "-B", "_vp20_diffcase.py"  # = viewer-palette-fest.plan-vp-i20.f3.diffcase.py beside the worker, str(prog), ini, seed, str(out)],
                       cwd=GW, env=env, text=True, capture_output=True, timeout=900)
    if p.returncode:
        return {"returncode": p.returncode, "stderr": p.stderr[-800:]}, None
    return json.loads([l for l in p.stdout.splitlines() if l.startswith("{")][-1]), out
cases = sys.argv[1:] or [p.stem for p in sorted((HERE / "progs").glob("*.ngc"))]
results = []
for case in cases:
    prog = HERE / "progs" / f"{case}.ngc"
    main_seed = "none" if case == "unknown" else "0,0,10"
    base = [0, 0, 0] if case == "unknown" else [0, 0, 10]
    shadow_seed = ",".join(str(b + e) for b, e in zip(base, EPS))
    m, mo = one(prog, "synthetic", main_seed, f"{case}.main")
    s, so = one(prog, "synthetic", shadow_seed, f"{case}.shadow")
    row = {"case": case, "program": prog.read_text(), "main": m, "shadow": s}
    if mo and so:
        row["diff"] = classify(str(mo), str(so), EPS, {"X": [-500, 500], "Y": [-500, 500], "Z": [-500, 50]})
    results.append(row)
    print(json.dumps({"case": case, "main_err": m.get("parse_error", m.get("stderr")), "shadow_err": s.get("parse_error", s.get("stderr")),
                      "diff": row.get("diff")}), flush=True)
(HERE / os.environ.get("OUT", "synthetic-results.json")).write_text(json.dumps(results, indent=1) + "\n")

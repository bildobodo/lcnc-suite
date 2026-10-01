import json, subprocess, os, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); from compare import classify
GW = Path("/home/cnc/lcnc-suite-partb/lcnc-gateway"); PY = "/home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python"
INI = "/home/cnc/linuxcnc/configs/lcnc_suite_sim/lcnc_suite_sim_5axis_xyzac.ini"
PROG = "/home/cnc/linuxcnc/nc_files/heavy_test.ngc"
LIM = {"X": [-250, 250], "Y": [-200, 200], "Z": [-400, 0]}
env = dict(os.environ); env.pop("PYTHONPATH", None)
runs = {}
for tag, seed in (("main", "0,0,65.0512"), ("shadow_xyz", "0.25,0.5,66.0512"), ("shadow_z", "0,0,66.0512")):
    out = HERE / f"out/heavy.{tag}.npz"
    p = subprocess.run(["nice", "-n", "10", PY, "-B", "_vp20_diffcase.py", PROG, INI, seed, str(out)],
                       cwd=GW, env=env, text=True, capture_output=True, timeout=900)
    d = json.loads([l for l in p.stdout.splitlines() if l.startswith("{")][-1]); d.pop("program", None)
    d["returncode"] = p.returncode; runs[tag] = d
res = {"what": "heavy_test.ngc (689 079 lines) on the XYZAC sim INI (read-only), live tool table via a read-only stat; T13 table 65.0512, G54 X -86.025 Z -109.725; one fresh process per parse",
       "runs": runs,
       "diff_shadow_xyz": classify(str(HERE / "out/heavy.main.npz"), str(HERE / "out/heavy.shadow_xyz.npz"), [0.25, 0.5, 1.0], LIM),
       "diff_shadow_z": classify(str(HERE / "out/heavy.main.npz"), str(HERE / "out/heavy.shadow_z.npz"), [0, 0, 1.0], LIM)}
(HERE / "heavy-results.json").write_text(json.dumps(res, indent=1) + "\n")
print(json.dumps({k: {kk: v.get(kk) for kk in ("parse_error", "feed", "interp_s", "total_s", "maxrss_mb")} for k, v in runs.items()}))
print(json.dumps(res["diff_shadow_xyz"])[:300]); print(json.dumps(res["diff_shadow_z"]))

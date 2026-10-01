import json, os, resource, subprocess, sys, time
import msgspec
GW = "/home/cnc/lcnc-suite-partb/lcnc-gateway"
INI = "/home/cnc/linuxcnc/configs/lcnc_suite_sim/lcnc_suite_sim_5axis_xyzac.ini"
PROG = "/home/cnc/linuxcnc/nc_files/heavy_test.ngc"
OUT = sys.argv[1]
def run(z, verify=None):
    ctx = {"file": PROG, "ini_path": INI, "units": "mm", "g5x_index": 1, "var_patches": {},
           "kins_type": 0, "kins_frame": None, "rotary_pose": {"A": 0.0, "C": 0.0},
           "applied_tlo": {"xyz": [0.0, 0.0, z], "mode": 430}}
    if verify: ctx["verify_against"] = verify
    env = dict(os.environ); env["INI_FILE_NAME"] = INI; env.pop("PYTHONPATH", None)
    t0 = time.monotonic()
    p = subprocess.Popen([sys.executable, "-B", os.path.join(GW, "gcode_parse_worker.py")],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         env=env, cwd=os.path.dirname(INI))
    out, err = p.communicate(msgspec.msgpack.encode(ctx))
    _, status, ru = os.wait4(p.pid, 0) if False else (None, None, None)
    wall = time.monotonic() - t0
    rss = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024
    lines = [l for l in err.decode().splitlines() if l.startswith(("__VERIFY__", "__SAME__", "worker total_ms", "gcode.parse "))]
    return {"z": z, "verify": bool(verify), "rc": p.returncode, "wall_s": round(wall, 2),
            "stdout_bytes": len(out), "max_child_rss_mb_so_far": round(rss, 1), "log": lines}, out
r1, out1 = run(65.0512)
with open(OUT, "wb") as f: f.write(out1)
r2, _ = run(65.0562, verify=OUT)
r3, _ = run(65.0562)
r4, _ = run(66.0512, verify=OUT)
print(json.dumps([r1, r2, r3, r4], indent=1))

#!/usr/bin/env python3
"""Diagnose the native home step at integ/p3: the base steps of native_run
(tree, copy, start, connect, servo), then the home step's first moves with
every status field it reads and every error the client receives printed.
Runs only in the user unit `native-run` with the restore as ExecStopPost."""
import json
import sys
import time
from pathlib import Path

WT = Path(sys.argv[1])
RUN = Path(sys.argv[2])
sys.path.insert(0, str(WT / "scripts"))
import native_run as nr  # noqa: E402
from test_support.system_host import SystemHost  # noqa: E402
from test_support.heavy_lock import heavy_lock  # noqa: E402


def debug_step():
    def step(ctx):
        c = ctx["client"]
        log = []

        def snap(what):
            st = c.status
            log.append({"what": what, "t": round(time.monotonic(), 3),
                        **{k: st.get(k) for k in ("homed", "homed_joints", "home_axes", "inpos", "task_mode",
                                                  "interp_state", "motion_mode", "joint_pos", "estop", "enabled")},
                        "errors": [x for _, _, x in c.errors][-5:]})
        snap("start")
        for j in range(3):
            r = c.request("home", axis=j)
            snap(f"home axis {j} reply {r}")
            end = time.monotonic() + 30
            while time.monotonic() < end and not ((c.status.get("homed_joints") or [False] * 3)[j]
                                                   and c.status.get("inpos")):
                time.sleep(0.2)
            snap(f"after home axis {j}")
        r = c.request("mdi", text="G49")
        time.sleep(2.5)
        snap(f"after G49 {r}")
        r = c.request("mdi", text="G53 G0 X-0.08 Y-0.08 Z0")
        for i in range(10):
            time.sleep(0.5)
            snap(f"G53 +{0.5 * (i + 1)} s reply {r}")
        (RUN / "debug.json").write_text(json.dumps(log, indent=1, default=str))
        return []
    return ("debug", step)


def main():
    if not nr.in_restore_unit():
        print("runs only in the unit native-run")
        return 2
    commit = sys.argv[3]
    steps = [nr.make_tree(commit, "3axis_xyz"), nr.make_copy("3axis_xyz"), nr.start_copy(), nr.connect_client(),
             debug_step()]
    with heavy_lock("native_debug", wait=0):
        report = nr.run(SystemHost(), steps, RUN)
    nr.write_json(RUN / "report.json", report)
    print("debug:", report.get("error"), report["restore"]["outcome"] if "restore" in report else "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

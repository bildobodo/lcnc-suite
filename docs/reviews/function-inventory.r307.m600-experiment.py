#!/usr/bin/env python3
"""One-off live experiment (operator question 2026-11-05): does M600 from the
top of Z fail when the new tool is longer? Runs in a 3-axis COPY instance via
the native stage's run() (record, stop the LAN sim, restore in finally) — as
the user unit `native-run` with the restore as ExecStopPost.

A: T3 (22 mm) measured and applied, spindle to G53 Z0, then T4 M600 (73 mm).
B: from there (T4 applied) spindle to G53 Z0, then T3 M600 (short).
C: T0 M600 (unload), then T4 M600 from where the unload left the spindle.
Each: the errors, the joint position, the tool and its applied offset after."""
import json
import sys
from pathlib import Path

WT = Path("/home/cnc/lcnc-suite-native")
sys.path.insert(0, str(WT / "scripts"))
import native_run as nr                      # noqa: E402
from test_support.system_host import SystemHost   # noqa: E402
from test_support.heavy_lock import heavy_lock    # noqa: E402

SHORT, LONG = 3, 4


def experiment(ctx):
    c, rows = ctx["client"], ctx["rows"]
    c.request("home_all")
    nr._wait(c, lambda s: all(s.get("homed_joints") or [False]) and s.get("inpos"), 60, "homed")
    plate = nr.plate_from_hal(nr._hal_texts(ctx["ini"]))
    ts = {**nr._vars(c, nr.TOOLSETTER_VARS), 3005: nr.M600_SLOW}
    lengths = {t: nr._tool_z(c, t) for t in (SHORT, LONG)}
    ctx["report"]["setup"] = {"plate": plate, "lengths": lengths, "vars": {str(k): v for k, v in ts.items()},
                              "g30": nr._vars(c, [5181, 5182, 5183])}

    def state():
        st = c.status
        return {"joint_pos": st.get("joint_pos"), "tool": st.get("tool_number"),
                "offset_z": (st.get("tool_offset") or [None] * 3)[2], "table_z": st.get("tool_table_z")}

    def m600(case, tool):
        before = state()
        r = nr._routine(c, f"T{tool} M600", vars=ts, declared=[tool], deadline=180.0,
                        extra=lambda st: st.get("tool_number") == tool)
        after = state()
        failed = [e for e in r["errors"] if e[0] in (1, 11)]
        b, f = before["joint_pos"] or [None] * 3, after["joint_pos"] or [None] * 3
        # the fixed contract (2026-11-05): ends at the call's X/Y at the top (joint Z 0)
        at_call_top = None not in (b[0], b[1], f[0], f[1], f[2]) and abs(f[2]) < 0.01 \
            and abs(f[0] - b[0]) < 0.01 and abs(f[1] - b[1]) < 0.01
        rows.append({"case": case, "status": "PASS" if not failed else "FAIL",
                     "detail": "; ".join(x for _, x in r["errors"]) or "no error",
                     "at_call_xy_top": at_call_top, "before": before, "after": after, "errors": r["errors"]})

    def top():
        nr._short(c, "G90")
        nr._routine(c, "G53 G0 Z0", deadline=60.0, require_busy=False,
                    extra=lambda st: abs((st.get("joint_pos") or [9] * 3)[2]) < 0.01)

    # A: short loaded and measured from low, G43 active, to the top, then the long tool
    nr._to(c, plate["x"], plate["y"], -120.0)
    m600("load-short-from-low", SHORT)
    top()
    rows.append({"case": "at-top-with-short", "status": "PASS", "detail": "", "state": state()})
    m600("A-short-to-long-from-top", LONG)
    # B: the long tool applied, to the top, then the short tool
    top()
    m600("B-long-to-short-from-top", SHORT)
    # C: unload, then the long tool from where the unload left the spindle
    m600("C-unload", 0)
    m600("C-empty-to-long", LONG)
    return rows


def main():
    run_dir = Path(sys.argv[1])
    with heavy_lock("m600_experiment", wait=0):
        commit = sys.argv[2] if len(sys.argv) > 2 else "8b248869"
        report = nr.run(SystemHost(), [nr.make_tree(commit, "3axis_xyz"), nr.make_copy("3axis_xyz"),
                                       nr.start_copy(), nr.connect_client(), ("experiment", experiment)], run_dir)
    nr.write_json(run_dir / "report.json", report)
    print("experiment:", report.get("error"), "restore", report["restore"]["outcome"])


if __name__ == "__main__":
    main()

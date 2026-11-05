#!/usr/bin/env python3
"""P2 live red proof (Codex R307/R308): a toolsetter section saved while the
machine is not ready never reaches the interpreter (the form pushes only at
the save's confirmation, and only when ready — ToolsetterSettings.
pushWhenConfirmed), and a PROGRAM's M600 (Cycle Start carries no toolsetter
values) measures with the interpreter's older values. Runs in a 3-axis COPY
through the native stage's run() — as the user unit `native-run` with the
restore as ExecStopPost.

1. home; read the interpreter's toolsetter values (#3004–#3013, #3100–#3115)
2. machine off; save the toolsetter section with touchZ 1 mm up — what the
   form does; it would NOT push now (not ready), so nothing else is sent
3. machine on (home again if needed); read #3102 in the interpreter
4. load `G21 G90 / T1 M600 / M2`, Cycle Start, serve the declared T1 change;
   the stored length tells which #3102 the routine used (the sim's physical
   length = T1's table length against the true plate; 1 mm less against the
   saved one)
5. put back: the section, T1's table length."""
import sys
import time
from pathlib import Path

WT = Path(sys.argv[3] if len(sys.argv) > 3 else "/home/cnc/lcnc-suite-m600n")
sys.path.insert(0, str(WT / "scripts"))
import native_run as nr                              # noqa: E402
from test_support.system_host import SystemHost      # noqa: E402
from test_support.heavy_lock import heavy_lock       # noqa: E402

# toolsetterVarMap (lcnc-webui/src/toolsetterSetup.ts), inverted
INV = {3004: "fastFeed", 3005: "slowFeed", 3006: "traverseFeed", 3007: "maxZTravel", 3009: "retractDist",
       3010: "spindleZeroHeight", 3013: "offsetDirection", 3100: "touchX", 3101: "touchY", 3102: "touchZ",
       3103: "useToolTable", 3104: "toolMinDis", 3105: "brakeAfter", 3106: "goBackToStart", 3107: "spindleStopM",
       3108: "disablePrePos", 3109: "addReps", 3110: "lastTry", 3111: "offsetDiameter", 3112: "offsetValue",
       3113: "finderTouchX", 3114: "finderTouchY", 3115: "finderDiffZ"}
PROGRAM = "G21 G90\nT1 M600\nM2\n"


def experiment(ctx):
    from test_support import tool_change as tc
    c, rows = ctx["client"], ctx["rows"]
    homed = lambda s: all(s.get("homed_joints") or [False]) and s.get("inpos")   # noqa: E731
    c.request("home_all")
    nr._wait(c, homed, 60, "homed")
    interp = nr._vars(c, sorted(INV))
    section = {INV[k]: v for k, v in interp.items()}
    true_z, l0 = interp[3102], nr._tool_z(c, 1)
    ctx["report"]["setup"] = {"interp": {str(k): v for k, v in interp.items()}, "t1_table": l0}

    c.request("machine_off")
    nr._wait(c, lambda s: s.get("is_enabled") is False, 10, "machine off")
    saved = {**section, "touchZ": true_z + 1}
    reply = c.request("save_settings", section="toolsetter", data=saved)
    rows.append({"case": "save-while-off", "status": "PASS", "detail": f"the section saved with touchZ {true_z + 1}",
                 "reply": {k: v for k, v in (reply or {}).items() if k != "data"}})

    c.request("machine_on")
    nr._wait(c, lambda s: s.get("is_enabled") is True, 10, "machine on")
    if not homed(c.status):
        c.request("home_all")
        nr._wait(c, homed, 60, "homed again")
    now = nr._vars(c, [3102])[3102]
    rows.append({"case": "interp-3102-after", "status": "PASS" if now == true_z else "FAIL",
                 "detail": f"the interpreter holds {now}; the saved section says {true_z + 1}", "interp": now})

    path = ctx["config"] / nr.NC_FILES / "p2_m600.ngc"
    path.write_text(PROGRAM)
    c.request("load_file", path=str(path))
    end = time.monotonic() + 60
    while not (c.preview_origin and Path(str(c.preview_origin.get("file"))).resolve() == path.resolve()):
        if time.monotonic() > end:
            raise nr.Refused(f"the program was not published: {c.preview_origin}")
        time.sleep(0.1)
    changes = tc.ToolChanges([1])
    cursor, err_from = len(c.frames), len(c.errors)
    c.request("cycle_start")
    done = tc.RoutineEnd()
    tc.serve(c, changes, lambda t, st: done(t, st) and st.get("tool_number") == 1, 240.0, cursor=cursor)
    length = nr._tool_z(c, 1)
    errors = [(k, x) for _, k, x in c.errors[err_from:]]
    against = ("the interpreter's old #3102" if length is not None and abs(length - l0) < 0.01 else
               "the saved #3102" if length is not None and abs(length - (l0 - 1)) < 0.01 else "neither")
    rows.append({"case": "program-m600", "status": "PASS" if against != "neither" else "incomplete",
                 "detail": f"T1 measured {length} (table before {l0}) — against {against}",
                 "length": length, "l0": l0, "against": against, "errors": errors})

    c.request("save_settings", section="toolsetter", data=section)
    nr._set_tool_length(c, 1, l0)
    return rows


def main():
    run_dir, commit = Path(sys.argv[1]), sys.argv[2]
    with heavy_lock("p2_experiment", wait=0):
        report = nr.run(SystemHost(), [nr.make_tree(commit, "3axis_xyz"), nr.make_copy("3axis_xyz"),
                                       nr.start_copy(), nr.connect_client(), ("experiment", experiment)], run_dir)
    nr.write_json(run_dir / "report.json", report)
    print("experiment:", report.get("error"), "restore", report["restore"]["outcome"])


if __name__ == "__main__":
    main()

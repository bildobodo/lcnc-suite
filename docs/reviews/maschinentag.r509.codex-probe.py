#!/usr/bin/env python3
"""R509: read-only re-evaluation and explicit PLAN countermodels.

Run from /tmp, not as a product test. No LinuxCNC imports, connections or
commands. The countermodels implement the stated plan predicates only;
they do not claim execution of a future implementation or a new native run.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", type=Path, default=Path("/home/cnc/lcnc-suite"))
    ap.add_argument("--upstream", type=Path, default=Path("/home/cnc/claude-work/bg/upstream-2.9.4"))
    ap.add_argument("--report", type=Path, default=Path("/home/cnc/claude-work/start/step0/runs/20261126T114857-p1p3/report.json"))
    args = ap.parse_args()
    raw = args.report.read_bytes()
    report = json.loads(raw)
    row = report["p1p3"]["seq"][36]
    assert row["label"] == "P3: before the start (G55 G43 H1 G92 X1 Y2)"
    reported = row["stat_after_read"]["tool_offset_z"]
    table_parameter = row["interp"]["p5403"]
    tol = 1e-6
    assert reported == 50 and table_parameter == 0
    assert abs(reported - table_parameter) > tol

    source = (args.upstream / "interp_convert.cc").read_text()
    assert "settings->parameters[5403] = settings->tool_table[0].offset.tran.z;" in source
    a = source.index("int Interp::convert_tool_length_offset(")
    b = source.index("settings->tool_offset = tool_offset;", a)
    offset_function = source[a:b]
    assert "parameters[5403]" not in offset_function
    assert "ZERO_EMC_POSE(tool_offset);" in offset_function
    assert "g_code == G_49" in offset_function

    # Source-informed model: the loaded tool and status retain Z50, while
    # the interpreter has selected G49 (Z0). No new native sequence claimed.
    loaded_z, applied_interpreter_z, status_z = 50, 0, 50
    plan_confirms_tlo = abs(loaded_z - status_z) <= tol
    actual_sources_agree = abs(applied_interpreter_z - status_z) <= tol
    assert plan_confirms_tlo and not actual_sources_agree

    # A numbered parameter is not automatically a getter of the matching
    # active interpreter field. The stock readonly list excludes #5220.
    arrays = (args.upstream / "src/emc/rs274ngc/interp_array.cc").read_text()
    readonly = arrays.split("const int Interp::_readonly_parameters[] = {", 1)[1].split("};", 1)[0]
    assert "5220" not in readonly
    index_model = dict(stored_5220=2, active_origin_index=1, status_index=2)
    assert index_model["stored_5220"] == index_model["status_index"]
    assert index_model["active_origin_index"] != index_model["status_index"]

    # The production poller observes completion before consuming ERR.
    gateway = subprocess.check_output(
        ["git", "-C", str(args.repo), "show", "dbd14cab:lcnc-gateway/gateway.py"], text=True)
    poll_start = gateway.index("_poll_cycle += 1")
    status_at = gateway.index("_poll_and_serialize)", poll_start)
    err_at = gateway.index("_status_runtime.read_errors, err_chan", status_at)
    assert status_at < err_at
    timeline = dict(write_begin=0, task_display_enqueue=1, task_done=2,
                    gateway_completion_poll=3, gateway_error_read=4)
    plan_receipt_window_ok = (timeline["write_begin"] <= timeline["gateway_error_read"]
                              <= timeline["gateway_completion_poll"])
    assert not plan_receipt_window_ok

    # A confirmed empty queue does not make a newly executed abort hook
    # inert. The plan's no-op branch contains no hook predicate.
    before = dict(confirmed=True, queue_empty=True, booked_since_read=False)
    plan_abort_opens = not (before["confirmed"] and not before["booked_since_read"])
    hook_can_execute = "int Interp::on_abort(" in (args.upstream / "rs274ngc_pre.cc").read_text()
    assert hook_can_execute and not plan_abort_opens

    # The touch-off last-admit predicate cannot be transplanted as an
    # unconditional AUTO start gate: explicit unverified consent exists.
    agreed_unverified_start = dict(consent=True, hard_gates=True, basis="INCONSISTENT")
    unconditional_touch_admit = agreed_unverified_start["basis"] == "CONFIRMED"
    assert not unconditional_touch_admit

    print(json.dumps({
        "kind": "read-only native-report re-evaluation plus plan countermodels",
        "native_run_executed": False,
        "product_code_executed": False,
        "raw_report": str(args.report),
        "raw_report_sha256": hashlib.sha256(raw).hexdigest(),
        "raw_report_whole_run_error": report.get("error"),
        "native_row_36": {"label": row["label"], "status_tlo_z": reported,
                          "p5400": row["interp"]["p5400"], "p5403": table_parameter,
                          "tool_offset_flag": row["interp"]["tlo_on"],
                          "r509_tlo_compare": "INCONSISTENT"},
        "tlo_false_confirmation_model": {"loaded_tool_z": loaded_z,
            "interpreter_applied_z": applied_interpreter_z, "status_z": status_z,
            "plan_confirms": plan_confirms_tlo, "actual_values_agree": actual_sources_agree},
        "index_source_model": {**index_model, "numbered_parameter_is_readonly": False,
                               "plan_compares_stored_not_active": True},
        "completion_before_receipt_model": {"timeline": timeline,
            "plan_receipt_window_accepts": plan_receipt_window_ok,
            "production_poller_order_verified": True},
        "abort_hook_model": {"before": before, "plan_opens": plan_abort_opens,
            "hook_is_not_covered_by_empty_queue_predicate": True},
        "consented_unverified_start_model": {**agreed_unverified_start,
            "unconditional_touch_admit_accepts": unconditional_touch_admit},
        "checks": "all assertions passed; these are not native acceptance results"
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

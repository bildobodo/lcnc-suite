"""P2a red proofs: each mutation breaks ONE rule of the agreed plan (Codex
R427/R428); the named guards must fail. Run from lcnc-gateway/ of the tree;
every file restored byte-identical in every case.

  python3 -I mut_p2a.py [name …]
"""
import json
import pathlib
import subprocess
import sys

TB = "test_toolsetter_basis.py::"
NS = "../scripts/test_native_stage.py::"
R = TB + "TestReadbackEnds::"
BP = "test_bulk_pipeline.py::"
H, E, N = TB + "TestHoldAndAttempt::", TB + "TestConfirmedEquality::", BP + "TestDriftReparseNiced::"
MUTS = {
    # P2a-1: the version decides again, not the confirmed content
    "version_instead_of_content": ("gateway.py", [('''    if toolsetter_inputs_equal(pub, _toolsetter_parse_ctx()):
        return None
    if _ts_reparse_for''', '''    if _ts_reparse_for''')],
        [H + "test_the_measured_probe_sequence_parses_nothing",
         H + "test_a_recurring_input_after_a_failed_attempt_is_a_new_attempt"]),
    # P2a-1: the origin is part of the input (applied ≠ read)
    "origin_in_equality": ("gateway_util.py", [('''    return pa is not None and pb is not None and pa == pb''',
                                                 '''    return (pa is not None and pb is not None and pa == pb
            and (a or {}).get("view") == (b or {}).get("view"))''')],
        [E + "test_the_same_confirmed_values_applied_or_read_are_one_input"]),
    # MT427-02: an assumed input compares by its booked patches
    "assumed_counts_as_equal": ("gateway_util.py", [('''if not isinstance(view, dict) or view.get("state") != "confirmed" or not isinstance(patches, dict):''',
                                                      '''if not isinstance(view, dict) or not isinstance(patches, dict):''')],
        [E + "test_an_assumed_value_is_equal_to_nothing",
         E + "test_the_file_replaced_between_booking_and_copy_proves_nothing"]),
    # P2a-2: no hold — the tick that starts the read-back reports the drift
    "no_hold": ("gateway.py", [('''    if reason is None or _ts_hold_reason(st) is not None:''', '''    if reason is None:''')],
        [H + "test_the_measured_probe_sequence_parses_nothing",
         H + "test_a_tick_the_read_back_is_not_due_in_is_held"]),
    # P2a-2: a failed or aborted read-back does not end the hold
    "hold_without_its_end": ("gateway.py", [('''    if outcome in ("failed", "aborted", "confirmed"):''', '''    if outcome in ("confirmed",):''')],
        [H + "test_a_failed_read_back_ends_the_hold_with_one_parse",
         H + "test_an_aborted_read_back_ends_the_hold"]),
    # P2a-2: no 30 s bound
    "hold_without_bound": ("gateway.py", [('''    if time.monotonic() - anchor[1] >= TS_HOLD_MAX_S:''', '''    if False:''')],
        [H + "test_a_read_back_not_admitted_retries_until_the_bound"]),
    # P2a-2: AUTO-ON held (no synch possible there)
    "held_in_auto": ("gateway.py", [('''    if getattr(st, "state", None) == linuxcnc.STATE_ON and getattr(st, "task_mode", None) == linuxcnc.MODE_AUTO:
        return None
    key = _ts_attempt_key()''', '''    key = _ts_attempt_key()''')],
        [H + "test_in_auto_on_and_when_unknown_nothing_is_held"]),
    # MT427-01: the attempt ignores the program
    "attempt_without_program": ("gateway.py", [('''    if _ts_reparse_for == (_ts_basis_version, _ts_program_identity()):''',
                                                 '''    if _ts_reparse_for is not None and _ts_reparse_for[0] == _ts_basis_version:''')],
        [H + "test_another_program_is_another_attempt"]),
    # Codex R428: the same-revision exception removed — a load with an assumed basis re-parses
    "same_revision_repeats": ("gateway.py", [('''    pv, pub = _ts_published_input()
    if pv == _ts_basis_version:
        return None
    if toolsetter_inputs_equal''', '''    pv, pub = _ts_published_input()
    if toolsetter_inputs_equal''')],
        [H + "test_a_preview_of_the_current_revision_needs_nothing_and_stays_assumed"]),
    # the masked toolsetter reason hidden
    "masked_hidden": ("gateway.py", [('''    elif ts_reason:
        _trace.emit("gcode.reparse_toolsetter_masked", by=drift, version=_ts_basis_version)
        _ts_reparse_asked()''', '''    elif False:
        pass''')],
        [H + "test_a_masked_toolsetter_reason_is_said_and_booked"]),
    # P2a-3: drift re-parses not niced
    "drift_not_niced": ("bulk_pipeline.py", [('''                if reason not in self.LOAD_REASONS:
                    ctx["nice"] = self.DRIFT_NICE''', '''                pass''')],
        [N + "test_a_drift_reparse_runs_niced_a_load_does_not"]),
    # P2a-3: the leash and the history keyed on pinned again
    "leash_by_pinned": ("bulk_pipeline.py", [('''            niced = pinned or ctx.get("nice") is not None''', '''            niced = pinned''')],
        [N + "test_the_leash_and_the_history_follow_the_priority"]),
    # Codex R430 MT-I15: no done-callback — a cancel before the first step or a binding error books nothing
    "no_task_end_booking": ("gateway.py", [('''        task.add_done_callback(lambda t, a=attempt: _ts_readback_task_done(t, a))
''', '''''')],
        [R + "test_r430_a_cancel_before_the_tasks_first_step_ends_the_hold",
         R + "test_r430_a_binding_error_ends_the_hold_as_failed"]),
    # MT-I15: a late completion overwrites another attempt's terminal outcome
    "late_completion_overwrites": ("gateway.py", [('''    if had is not None and had != "not_admitted":
        return
''', '''''')],
        [R + "test_a_late_completion_never_books_a_newer_attempt"]),
    # Codex R430 MT-I16: the read-back's attempt by the path only (the parse's keeps the full identity)
    "read_back_by_path": ("gateway.py", [('''    return (_ts_basis_version, _ts_program_identity())


def _ts_readback_ended''', '''    return (_ts_basis_version, _ts_program_identity()[0])


def _ts_readback_ended''')],
        [R + "test_r430_a_new_source_at_the_same_path_gets_its_read_back_attempt"]),
    # Codex R430 MT-I17: the judge ignores what the last op still owes
    "judge_ignores_owed": ("../scripts/test_support/native_cases.py", [('''    owed = pb_owed(ev)
    if owed:''', '''    owed = pb_owed(ev)
    if False:''')],
        [NS + "test_r430_the_window_closed_before_the_last_read_back_is_incomplete"]),
    # MT-I17: the quiet wait ignores the owed read-back (closes at 4 s of no parse)
    "quiet_ignores_owed": ("../scripts/native_run.py", [('''        if owed_now or (c.status or {}).get("preview_refresh"):''',
                                                          '''        if (c.status or {}).get("preview_refresh"):''')],
        [NS + "test_the_quiet_wait_waits_for_the_owed_read_back_then_its_quiet"]),
    # Codex R431 MT-I17 A: an unconfirmed outcome counts only with its follow-up parse in the window
    "unconfirmed_needs_its_parse": ("../scripts/test_support/native_cases.py", [('''    if unconfirmed:
        return _row(case, "incomplete", f"a read-back did not confirm''', '''    if unconfirmed and (ts or measured["toolsetter_edges"] or measured["masked"]):
        return _row(case, "incomplete", f"a read-back did not confirm''')],
        [NS + "test_r431_an_unconfirmed_last_attempt_is_no_zero_parse_pass[failed]",
         NS + "test_r431_an_unconfirmed_last_attempt_is_no_zero_parse_pass[aborted]",
         NS + "test_r431_an_unconfirmed_last_attempt_is_no_zero_parse_pass[cap]",
         NS + "test_r431_an_unconfirmed_last_attempt_is_no_zero_parse_pass[no_anchor]"]),
    # MT-I17 B: a read error settles the owed attempt
    "unreadable_settles": ("../scripts/test_support/native_cases.py", [('''        if events.problems:
            return f"the trace is not readable: {events.problems[0]}"''', '''        if False:
            return f"the trace is not readable: {events.problems[0]}"''')],
        [NS + "test_r431_a_read_error_beside_a_seemingly_ended_slice_settles_nothing"]),
    # MT-I17 B: an empty first observation settles the owed attempt
    "empty_observation_settles": ("../scripts/test_support/native_cases.py", [('''        if not any(e.get("tag") == "toolsetter.basis" for e in events):
            return "no booking of the op in the trace yet"''', '''        if False:
            return "no booking of the op in the trace yet"''')],
        [NS + "test_r431_an_empty_or_damaged_observation_settles_nothing"]),
    # MT-I17 B: the reader drops its damaged lines and read errors again
    "reader_drops_problems": ("../scripts/native_run.py", [('''    out, problems = [], list(errors)''', '''    out, problems = [], []'''),
                                                         ('''        if damaged:
            problems.append(f"{name}: {damaged} damaged line(s)")''', '''        pass''')],
        [NS + "test_r431_a_read_error_beside_a_seemingly_ended_slice_settles_nothing",
         NS + "test_r431_an_empty_or_damaged_observation_settles_nothing"]),
    # Codex R431 MT-I18: frame_window drops the gateway's losses
    "frame_drops_losses": ("../scripts/test_support/native_cases.py", [('''            if not (began_after or said_before):
                losses.append''', '''            if False:
                losses.append''')],
        [NS + "test_r431_a_framed_gateway_loss_is_no_evidence_that_no_parse_ran",
         NS + "test_r431_a_loss_reported_after_the_window_counts_unless_it_began_after_it"]),
    # MT-I18: the basis judge ignores the losses
    "basis_ignores_losses": ("../scripts/test_support/native_cases.py", [('''    losses = window.get("losses") or []
    if losses:''', '''    losses = window.get("losses") or []
    if False:''')],
        [NS + "test_r431_a_framed_gateway_loss_is_no_evidence_that_no_parse_ran"]),
    # MT-I18: the nice judge ignores the losses
    "nice_ignores_losses": ("../scripts/test_support/native_cases.py", [('''    if window.get("losses"):
        # a lost record may be a parse without its priority''', '''    if False:
        # a lost record may be a parse without its priority''')],
        [NS + "test_r431_a_framed_gateway_loss_is_no_evidence_that_no_parse_ran"]),
    # MT-I18: another process's loss counts as the gateway's
    "foreign_loss_counts": ("../scripts/test_support/native_cases.py", [('''            if (r is None or r.get("tag") != "trace.write_lost" or r.get("proc") != MARK_PROC
                    or r.get("pid") != pid):''', '''            if r is None or r.get("tag") != "trace.write_lost":''')],
        [NS + "test_r431_a_loss_reported_after_the_window_counts_unless_it_began_after_it"]),
}

only = sys.argv[1:]
res = {}
for name, (rel, pairs, tests) in MUTS.items():
    if only and name not in only:
        continue
    f = pathlib.Path(rel)
    orig = f.read_bytes()
    text = orig.decode()
    for old, new in pairs:
        assert text.count(old) == 1, (name, old[:70])
        text = text.replace(old, new)
    try:
        f.write_text(text)
        r = subprocess.run([".venv/bin/python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "-o", "addopts=",
                            *tests], capture_output=True, text=True, timeout=600)
    finally:
        f.write_bytes(orig)
    failed = [t for t in tests if ("FAILED " + t) in r.stdout]
    res[name] = {"file": rel, "failed": len(failed), "of": len(tests)}
    print(name, res[name], flush=True)
print(json.dumps(res))
print("ALL_RED" if all(v["failed"] == v["of"] for v in res.values()) else "SOME_GREEN")

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
    "held_in_auto": ("gateway.py", [('''    if _machine_on_in_auto(st):
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
    "drift_not_niced": ("bulk_pipeline.py", [('''                if reason not in self.LOAD_REASONS and self.refreshes_published(filepath, _mtime_at_parse):
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
    "reader_drops_problems": ("../scripts/native_run.py", [('''    problems = list(errors)
    seen: dict = {}''', '''    problems = []
    seen: dict = {}'''),
                                                         ('''        if damaged:
            problems.append(f"{name}: {damaged} damaged line(s)")''', '''        pass''')],
        [NS + "test_r431_a_read_error_beside_a_seemingly_ended_slice_settles_nothing",
         NS + "test_r431_an_empty_or_damaged_observation_settles_nothing"]),
    # Codex R431 MT-I18: frame_window drops the gateway's losses
    "frame_drops_losses": ("../scripts/test_support/native_cases.py", [('''            out.append({k: r.get(k) for k in ("count", "since_ns", "t_wall_ns", "why")})''', '''            pass''')],
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
    # Codex R432 MT-I18 A: the progress reader drops the gateway's own loss report
    "reader_ignores_losses": ("../scripts/native_run.py", [('''                    lost += int(e.get("count") or 1)''', '''                    pass''')],
        [NS + "test_r432_a_gateway_loss_cannot_settle_the_live_owed_wait"]),
    # MT-I18 A: the progress reader sorts by wall time again
    "reader_sorts_by_wall": ("../scripts/native_run.py", [('''    return nc.TraceSlice(out, problems)''',
                                                         '''    return nc.TraceSlice(sorted(out, key=lambda e: e.get("t_wall_ns") or 0), problems)''')],
        [NS + "test_r432_the_progress_reader_keeps_file_order_across_a_wall_step"]),
    # Codex R432 MT-I18 B: a report inside the frame excluded by its since_ns (the wall)
    "inside_excluded_by_since": ("../scripts/test_support/native_cases.py", [('''            if after and isinstance(since, int) and isinstance(t_end, int) and since > t_end:''',
                                                                             '''            if isinstance(since, int) and isinstance(t_end, int) and since > t_end:''')],
        [NS + "test_r432_a_loss_physically_inside_the_frame_is_not_excluded_by_wall_time[back_at_end]",
         NS + "test_r432_the_real_trace_writer_can_put_a_loss_inside_the_frame_across_a_wall_step"]),
    # MT-I18 B: a report inside the frame excluded by its report wall time before the start
    "inside_excluded_by_report_time": ("../scripts/test_support/native_cases.py", [('''            if before:
                continue
            since = r.get("since_ns")''', '''            t_start = parsed[mark_ino][1][s].get("t_wall_ns")
            if before or (isinstance(r.get("t_wall_ns"), int) and isinstance(t_start, int)
                          and r["t_wall_ns"] < t_start):
                continue
            since = r.get("since_ns")''')],
        [NS + "test_r432_a_loss_physically_inside_the_frame_is_not_excluded_by_wall_time[back_before_report]"]),
    # MT-I18 B: a report before the start mark counted (the order relation dropped)
    "before_start_counted": ("../scripts/test_support/native_cases.py", [('''            if before:
                continue
            since = r.get("since_ns")''', '''            since = r.get("since_ns")''')],
        [NS + "test_r432_a_report_before_the_start_mark_is_excluded_by_order_whatever_its_wall_time"]),
    # Codex R433 MT-I18 A: the slice's beginning re-derived per file from the wall clock
    "slice_begins_per_file": ("../scripts/native_run.py", [('''        damaged, lost = 0, 0
        for line in data.split(b"\\n")[:-1]:''', '''        damaged, lost = 0, 0
        inside = False
        for line in data.split(b"\\n")[:-1]:''')],
        [NS + "test_r433_a_wall_step_at_a_rotation_keeps_the_new_generation_after_the_beginning[False]",
         NS + "test_r433_a_wall_step_at_a_rotation_keeps_the_new_generation_after_the_beginning[True]",
         NS + "test_r433_the_rotated_loss_does_not_release_the_live_wait"]),
    # MT-I18 A: the generations walked newest first (the order not proven)
    "generations_newest_first": ("../scripts/native_run.py", [('''    for name, _ino, data in sorted(files, key=lambda f: -nc._generation(f[0])):   # the oldest first''',
                                                             '''    for name, _ino, data in files:''')],
        [NS + "test_r433_a_wall_step_at_a_rotation_keeps_the_new_generation_after_the_beginning[False]"]),
    # MT-I18 A: a rotation during the read goes unnoticed
    "rotation_during_read_unnoticed": ("../scripts/native_run.py", [('''        if ino in seen:
            problems.append''', '''        if False:
            problems.append''')],
        [NS + "test_r433_a_rotation_during_the_read_is_no_proven_order"]),
    # Fable's merge check (1): "machine ON in AUTO" read from the payload's `state` again (dead)
    "auto_on_by_state": ("gateway.py", [('''    return getattr(st, "enabled", None) is True and getattr(st, "task_mode", None) == linuxcnc.MODE_AUTO''',
                                        '''    return getattr(st, "state", None) == linuxcnc.STATE_ON and getattr(st, "task_mode", None) == linuxcnc.MODE_AUTO''')],
        [TB + "TestAutoOnFromTheRealPayload::test_auto_on_from_the_real_payload_is_not_due_and_not_held_then_due_after_auto",
         TB + "TestEdges::test_an_unconfirmed_basis_is_read_back_once_while_the_program_is_loaded",
         H + "test_in_auto_on_and_when_unknown_nothing_is_held"]),
    # Fable's merge check (2): every non-load reason niced again (a superseded load too)
    "nice_without_published": ("bulk_pipeline.py", [('''                if reason not in self.LOAD_REASONS and self.refreshes_published(filepath, _mtime_at_parse):''',
                                                     '''                if reason not in self.LOAD_REASONS:''')],
        [BP + "TestNicedOnlyARefresh::test_a_load_superseded_by_a_drift_edge_is_not_niced",
         BP + "TestNicedOnlyARefresh::test_a_drift_over_a_changed_file_is_not_niced",
         BP + "TestNicedOnlyARefresh::test_a_drift_over_another_file_is_not_niced"]),
    # (2): the mtime not compared
    "nice_ignores_mtime": ("bulk_pipeline.py", [('''                and mtime is not None and self.last_mtime == mtime)''', '''                )''')],
        [BP + "TestNicedOnlyARefresh::test_a_drift_over_a_changed_file_is_not_niced"]),
    # (2): the file not compared
    "nice_ignores_file": ("bulk_pipeline.py", [('''        return (self.last_file == filepath and self.preview_available()''',
                                               '''        return (self.preview_available()''')],
        [BP + "TestNicedOnlyARefresh::test_a_drift_over_another_file_is_not_niced"]),
    # the worker's applied priority not traced
    "applied_priority_untraced": ("bulk_pipeline.py", [('''stdout_bytes=len(stdout), nice_applied=_nice_applied)''', '''stdout_bytes=len(stdout))''')],
        [BP + "TestNicedOnlyARefresh::test_the_worker_applied_priority_is_traced_with_its_job"]),
    # the nice judge takes the spawn's asked priority for the applied one
    "judge_ignores_applied": ("../scripts/test_support/native_cases.py", [('''    if wrong:
        return _row(case, "FAIL", f"{len(wrong)} drift re-parses not niced by the worker"''', '''    if False:
        return _row(case, "FAIL", f"{len(wrong)} drift re-parses not niced by the worker"'''),
                                                                         ('''    if unproven:
        return _row(case, "incomplete", f"{len(unproven)} of {len(drift)} drift re-parses''', '''    if False:
        return _row(case, "incomplete", f"{len(unproven)} of {len(drift)} drift re-parses''')],
        [NS + "test_parse_nice_reads_the_workers_applied_priority"]),
    # Codex R435 MT-I19: a start without its own answer filtered out (incomplete only if none answered)
    "nice_filters_unanswered": ("../scripts/test_support/native_cases.py", [('''    if unproven:
        return _row(case, "incomplete", f"{len(unproven)} of {len(drift)} drift re-parses''', '''    if unproven and not applied:
        return _row(case, "incomplete", f"{len(unproven)} of {len(drift)} drift re-parses''')],
        [NS + "test_r435_one_worker_answer_missing_is_incomplete[1]",
         NS + "test_r435_one_worker_answer_missing_is_incomplete[2]",
         NS + "test_r435_a_worker_failure_without_answer_is_no_proof_of_nice",
         NS + "test_r435_an_unrelated_answer_does_not_cover_the_missing_job"]),
    # MT-I19: answers kept in an overwriting dict (a job answered twice passes)
    "nice_answers_overwrite": ("../scripts/test_support/native_cases.py", [('''            answers.setdefault(e.get("job"), []).append(e.get("nice_applied"))''',
                                                                         '''            answers[e.get("job")] = [e.get("nice_applied")]''')],
        [NS + "test_r435_a_job_answered_or_started_twice_is_ambiguous"]),
    # MT-I19: a job started twice not checked
    "nice_twice_started_ok": ("../scripts/test_support/native_cases.py", [('''    if twice:
        return _row(case, "incomplete", f"job(s) {twice} started twice in the window", drift=len(drift))''',
                                                                        '''    if False:
        return _row(case, "incomplete", f"job(s) {twice} started twice in the window", drift=len(drift))''')],
        [NS + "test_r435_a_job_answered_or_started_twice_is_ambiguous"]),
    # MT-I19: a start without a job id matched by an answer without one
    "nice_jobless_ok": ("../scripts/test_support/native_cases.py", [('''    if any(not isinstance(j, int) or isinstance(j, bool) for j in jobs):''', '''    if False:''')],
        [NS + "test_r435_a_job_answered_or_started_twice_is_ambiguous"]),
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

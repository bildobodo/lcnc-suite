"""Gateway mutations for the P1b red proofs: each mutation, the tests that must fail.
Run from lcnc-gateway/ of the worktree; restores gateway.py in every case."""
import json
import pathlib
import subprocess
import sys

GW = pathlib.Path("gateway.py")
T = "test_jog_lease_gateway.py::"
MUTS = {
    # the in-thread check at each write (the early check at the handler start stays)
    "no_deadline_check_at_write": ([('''        if lease_key is not None:
            why = _lease_write_refusal(lease_key)
            if why:
                return why
        why = gate()''', '''        why = gate()''')],
        [T + "TestTheDeadline::test_the_deadline_passing_at_the_write_writes_nothing"]),
    # neither check: the start is judged by nothing but the machine
    "no_deadline_check_at_all": ([('''        if lease_key is not None:
            why = _lease_write_refusal(lease_key)
            if why:
                return why
        why = gate()''', '''        why = gate()'''), ('''    if lease_key is not None:
        why = _lease_write_refusal(lease_key)
        if why:
            return _lease_refused(why)
    gate = _gate_admit("jog", armed)''', '''    gate = _gate_admit("jog", armed)''')],
        [T + "TestTheDeadline::test_a_start_past_its_deadline_writes_nothing",
         T + "TestTheReceiptAnchor::test_a_start_that_waits_past_its_deadline_is_never_written"]),
    "expiry_does_not_stop": ([('''                result = await _stop_owned_axes(key)
    except Exception as e:  # noqa: BLE001 - the expiry must report, never vanish''',
                               '''                result = {"stopped": [], "failed": [], "not_owned": []}
    except Exception as e:  # noqa: BLE001 - the expiry must report, never vanish''')],
        [T + "TestTheReceiptAnchor::test_renewals_keep_a_jog_and_their_absence_ends_it",
         T + "TestTheExpiry::test_the_expiry_stops_the_axes_its_lease_still_owns"]),
    # both ownership checks gone: a lease's stop reaches whatever is booked
    "old_owner_stops_new_motion": ([('''    owned = sorted(ax for ax, row in _active_jogs.items()
                   if (_jog_row_owner(row) or (None, 0))[0] == lease_key)''', '''    owned = sorted(_active_jogs)'''),
                                    ('''        row = _active_jogs.get(ax)
        owner = _jog_row_owner(row)
        if owner is None or owner[0] != lease_key:
            out["not_owned"].append(ax)
            continue
        if _jog_row_link(row) is not current_link():''', '''        row = _active_jogs.get(ax)
        owner = _jog_row_owner(row)
        if False:
            out["not_owned"].append(ax)
            continue
        if _jog_row_link(row) is not current_link():'''),
                                    ('''        try:
            await _send_jog_stop(ax, owner=owner)''', '''        try:
            await _send_jog_stop(ax)''')],
        [T + "TestTheExpiry::test_an_expired_lease_leaves_an_axis_another_gesture_took",
         T + "TestTheChange::test_a_change_stops_only_what_its_lease_owns"]),
    "renewal_revives": ([('''    return _jog_leases.renew(conn_key, ids, time.monotonic())''', '''    for _i in ids:
        _lz = _jog_leases.get((conn_key, _i))
        if _lz is not None:
            _lz.state = "live"
            _lz.deadline = time.monotonic() + _jog_leases.ttl
    return []''')],
        [T + "TestTheReceiptAnchor::test_late_renewals_revive_nothing"]),
    "no_receipt_booking": ([('''                if _rcmd in _JOG_LEASE_FRAMES:
                    _receive_jog_lease(client.conn_key, msg)   # the deadline's anchor: receipt''',
                             '''                pass''')],
        [T + "TestTheReceiptAnchor::test_renewals_keep_a_jog_and_their_absence_ends_it"]),
    "abort_keeps_leases": ([('''                    await _tell_leases_ended(ws, _end_client_leases(client.conn_key, why=_rcmd), _rcmd)
                if _rcmd in _JOG_LEASE_FRAMES:''', '''                    pass
                if _rcmd in _JOG_LEASE_FRAMES:''')],
        [T + "TestTheClientsLeasesEnd::test_an_abort_ends_them_and_a_kept_change_starts_nothing"]),
    "disarm_keeps_leases": ([('''            await _tell_leases_ended(ws, _end_client_leases(client.conn_key, why="disarm"), "disarm")
''', '''            pass
''')],
        [T + "TestTheClientsLeasesEnd::test_a_disarm_ends_them"]),
    # Codex R427 MT-I08: an ended lease is forgotten by its timer (the stop lost)
    "ended_lease_forgotten": ([('''        left = lease.deadline - time.monotonic()
        if left > 0:
            _arm_lease_timer(lease, left)
            return
    else:''', '''        _jog_leases.forget(key)
        return
    else:''')],
        [T + "TestTheOwedStop::test_an_end_whose_command_never_ran_is_stopped_at_its_deadline",
         T + "TestTheRefusedEnd::test_an_end_the_full_queue_refused_still_stops_by_the_deadline"]),
    # MT-I08: the client's end cancels its timer and forgets it at once
    "client_end_settles_at_receipt": ([('''    for lz in leases:
        _jog_leases.end(lz.key, by=why)
    if drop:''', '''    for lz in leases:
        _jog_leases.end(lz.key, by=why)
        _settle_lease(lz.key)
    if drop:''')],
        [T + "TestTheOwedStop::test_an_abort_written_settles_what_it_ended_one_not_written_leaves_the_stop_owed",
         T + "TestTheOwedStop::test_a_client_stop_settles_only_a_lease_no_booking_names"]),
    # Codex R427 MT-I09: both Link checks gone — the old lease stops through B
    "stop_ignores_write_link": ([('''        if _jog_row_link(row) is not current_link():''', '''        if False:'''),
                                 ('''        if _jog_row_link(now) is not lk:
            return JOG_STOP_LINK_CHANGED''', '''        if False:
            return JOG_STOP_LINK_CHANGED''')],
        [T + "TestTheWriteLink::test_an_old_leases_expiry_never_writes_through_a_new_link",
         T + "TestTheWriteLink::test_an_end_and_a_changes_stop_half_on_a_new_link_say_the_stop_failed"]),
    # Codex R428 MT-I11: the cleanup's failed stop hidden behind "page delayed"
    "cleanup_failure_hidden": ([('''            if cleanup["failed"]:''', '''            if False:''')],
        [T + "TestTheReportedFailure::test_a_partial_start_cleanup_reports_its_failed_stop"]),
    # Codex R428 MT-I08 rest: a waiting expiry does not check its lease is still owed
    "settled_expiry_works_anyway": ([('''            if _jog_leases.get(key) is not lease:''', '''            if False:''')],
        [T + "TestTheReportedFailure::test_a_queued_expiry_does_not_retry_a_reported_end_failure"]),
    # R428: a reported failure is tried again by the lease
    "reported_failure_retried": ([('''    todo = [ax for ax in named if ax in owned and ax not in said]''',
                                   '''    todo = [ax for ax in named if ax in owned]''')],
        [T + "TestTheReportedFailure::test_a_partial_start_cleanup_reports_its_failed_stop"]),
    # MT-I09: only the write thread's check gone
    "no_link_check_in_the_write_thread": ([('''        if _jog_row_link(now) is not lk:
            return JOG_STOP_LINK_CHANGED''', '''        if False:
            return JOG_STOP_LINK_CHANGED''')],
        [T + "TestTheWriteLink::test_the_write_thread_refuses_a_link_changed_after_the_lock"]),
}

orig = GW.read_text()
res = {}
only = sys.argv[1:]
try:
    for name, (pairs, tests) in MUTS.items():
        if only and name not in only:
            continue
        text = orig
        for old, new in pairs:
            assert text.count(old) == 1, (name, old[:60])
            text = text.replace(old, new)
        GW.write_text(text)
        r = subprocess.run([".venv/bin/python", "-m", "pytest", "-q", "-p", "no:cacheprovider", *tests],
                           capture_output=True, text=True, timeout=600)
        failed = [t for t in tests if ("FAILED " + t) in r.stdout]
        res[name] = {"failed": len(failed), "of": len(tests)}
        print(name, res[name], flush=True)
finally:
    GW.write_text(orig)
print(json.dumps(res))
print("ALL_RED" if all(v["failed"] == v["of"] for v in res.values()) else "SOME_GREEN")

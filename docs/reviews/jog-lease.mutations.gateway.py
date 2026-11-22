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
                                    ('''        owner = _jog_row_owner(_active_jogs.get(ax))
        if owner is None or owner[0] != lease_key:
            out["not_owned"].append(ax)
            continue
        try:
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

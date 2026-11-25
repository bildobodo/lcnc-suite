"""R483: isolated boundary checks and the requested Cycle Start class check.
Run with -p conftest. The last test documents an existing sibling, not a fix.
"""
import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest
import fake_linuxcnc
fake_linuxcnc.install()
import gateway
from command_policy import MachineState
from test_tool_guard_gateway import _Guard


def record(value):
    with Path(os.environ['R483_RESULTS']).open('a') as f:
        f.write(json.dumps(value, ensure_ascii=False) + '\n')


@pytest.fixture
def guard():
    g = _Guard()
    g.setUp()
    try:
        yield g
    finally:
        g.tearDown()
        g.doCleanups()


def test_snapshot_age_bound_and_identity(guard):
    a, b = dict(guard.reader), dict(guard.reader, tool_prepare=True)
    cutoff = 100.0 - gateway._hal_bridge.stale_sec
    for age_delta, allowed in ((0.001, True), (0.0, True), (-0.001, False)):
        with patch.object(gateway, '_reader_state_now', side_effect=[(a, cutoff + age_delta), (b, 100.0)]) as take, \
             patch.object(gateway.time, 'monotonic', return_value=100.0):
            got = gateway._reader_fresh_snapshot()
        assert take.call_count == 1
        assert (got is a) if allowed else (got is None)
        record(dict(case='age boundary', arrival_minus_cutoff=age_delta, allowed=allowed, calls=take.call_count))


def test_fresh_snapshot_does_not_borrow_later_stale_time(guard):
    a, b = dict(guard.reader), dict(guard.reader, tool_prepare=True)
    with patch.object(gateway, '_reader_state_now', side_effect=[(a, 100.0), (b, 0.0)]) as take, \
         patch.object(gateway.time, 'monotonic', return_value=100.0):
        got = gateway._reader_fresh_snapshot()
    assert got is a
    assert take.call_count == 1
    record(dict(case='fresh followed by stale', same_object=got is a, calls=take.call_count))


def test_cycle_start_sibling_also_has_an_unknown_mode_case(guard):
    """No NML write. Observe the actual helper with a controlled publication
    between its two reads, as is possible at its write-thread admission.
    B has an UNKNOWN kins, not an unsupported configured kinematics mode.
    """
    guard.conn.stat.g5x_index = 6
    base = MachineState(armed=True, is_estop=False, is_enabled=True,
        is_homed=True, is_idle=True, is_running=False, is_paused=False,
        eoffset_enabled=False, kins_switchable=True, twp_capable=True)
    a = dict(guard.reader, kins_type=2, twp_active=False)
    b = dict(guard.reader, kins_type=None, twp_active=True)
    bridge = gateway._hal_bridge
    with patch.object(gateway, '_shared_status', {}), \
         patch.object(gateway, '_live_policy_state', return_value=base):
        guard.arrived(a)
        why_a = gateway._program_start_refusal(True)
        guard.arrived(b)
        why_b = gateway._program_start_refusal(True)
        guard.arrived(a)
        read_fields = []
        def reading(field):
            value = bridge.reader_get(field)
            read_fields.append([field, value])
            if field == 'kins_type':
                guard.arrived(b)
            return value
        with patch.object(gateway, '_reader_get', reading):
            mixed = gateway._program_start_refusal(True)
    assert why_a and why_b
    assert mixed is None
    record(dict(case='Cycle Start sibling (existing)', coherent=[why_a, why_b], mixed=mixed, reads=read_fields))

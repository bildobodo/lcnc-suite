"""R486: real bridge publication during a threaded start admission; no NML.
Run from the archived gateway with -p conftest. JSONL goes to R486_RESULTS.
"""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from threading import Event
from unittest.mock import patch

import pytest
import fake_linuxcnc
fake_linuxcnc.install()
import gateway
import test_tool_guard_gateway as helpers
from command_policy import MachineState


def record(**value):
    with Path(os.environ['R486_RESULTS']).open('a') as f:
        f.write(json.dumps(value, ensure_ascii=False) + '\n')


@pytest.fixture
def prepared():
    fixture = helpers._Guard()
    fixture.setUp()
    fixture.conn.stat.g5x_index = 6
    base = MachineState(armed=True, is_estop=False, is_enabled=True,
        is_homed=True, is_idle=True, is_running=False, is_paused=False,
        eoffset_enabled=False, kins_switchable=True, twp_capable=True)
    try:
        with patch.object(gateway, '_shared_status', {}), \
             patch.object(gateway, '_live_policy_state', return_value=base) as policy:
            yield fixture, policy
    finally:
        fixture.tearDown()
        fixture.doCleanups()


@pytest.mark.parametrize('later', [
    {'kins_type': None, 'twp_active': True},
    {'twp_active': True},
    {'kins_type': 3, 'twp_active': True},
])
def test_threaded_start_never_combines_two_refused_states(prepared, later):
    fixture, _ = prepared
    reached, resume = Event(), Event()
    reads = []

    class PausedSnapshot(dict):
        def get(self, field, default=None):
            value = super().get(field, default)
            reads.append(field)
            if field == 'kins_type':
                reached.set()
                assert resume.wait(5), 'publisher did not release admission'
            return value

    fixture.arrived(later)
    later_refusal = gateway._program_start_refusal(True)
    assert later_refusal
    first = PausedSnapshot(kins_type=2, twp_active=False)
    fixture.arrived(first)
    with ThreadPoolExecutor(max_workers=1) as executor:
        admission = executor.submit(gateway._program_start_refusal, True)
        try:
            assert reached.wait(5), 'admission did not read kins'
            fixture.arrived(later)
        finally:
            resume.set()
        result = admission.result(timeout=5)
    record(case='threaded publication', later=later, refused=result,
           later_refusal=later_refusal, first_reads=reads)
    assert result == 'Plane kinematics without a plane — select Machine'
    assert reads == ['kins_type', 'twp_active']


@pytest.mark.parametrize('age_delta,allowed', [(0.001, True), (0.0, True), (-0.001, False)])
def test_start_uses_one_snapshot_with_its_arrival(prepared, age_delta, allowed):
    _, _policy = prepared
    good = {'kins_type': 2, 'twp_active': True}
    stale_cutoff = 100.0 - gateway._hal_bridge.stale_sec
    with patch.object(gateway, '_reader_state_now',
                      side_effect=[(good, stale_cutoff + age_delta), ({}, 100.0)]) as take, \
         patch.object(gateway.time, 'monotonic', return_value=100.0):
        result = gateway._program_start_refusal(True)
    record(case='start freshness', arrival_minus_cutoff=age_delta, refusal=result,
           reads=take.call_count)
    assert take.call_count == 1
    assert (result is None) == allowed


@pytest.mark.parametrize('fields', [None, {}, {'kins_type': None, 'twp_active': True},
                                  {'kins_type': 2}, {'kins_type': 3, 'twp_active': True}])
def test_start_unknown_fields_refuse(prepared, fields):
    fixture, _ = prepared
    fixture.arrived(fields)
    if fields is None:
        gateway._hal_bridge._reader_state = None
    result = gateway._program_start_refusal(True)
    record(case='unknown or unsupported', fields=fields, refusal=result)
    assert result


def test_fixed_kinematics_does_not_require_a_switch_pin(prepared):
    _, policy = prepared
    policy.return_value = replace(policy.return_value, kins_switchable=False)
    gateway._hal_bridge._reader_state = None
    result = gateway._program_start_refusal(True)
    record(case='fixed kinematics', refusal=result)
    assert result is None


def test_failed_stat_poll_still_refuses(prepared):
    fixture, _ = prepared
    fixture.arrived({'kins_type': 2, 'twp_active': True})
    with patch.object(fixture.conn.stat, 'poll', side_effect=RuntimeError('R486 fake read failure')):
        result = gateway._program_start_refusal(True)
    record(case='STAT poll failure', refusal=result)
    assert result == 'Machine status not read — start again'

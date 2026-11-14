"""R373 independent replay contract probes; run beside test_replay.py.

No controller or network access. FAIL assertions express the required contract;
the reviewed head incorrectly returns PASS for the negative cases.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_replay import A, B, Mock, attempt, origin, replay, run


@pytest.mark.parametrize('msg', [
    {'cmd': 'timing_log'},
    {'cmd': 'halshow_live'},
    {'cmd': 'device_rename'},
    {'cmd': 'save_settings', 'base_rev': 0, 'data': {}},
    {'cmd': 'save_settings', 'section': 'machine', 'data': {}},
    {'cmd': 'tab_visibility'},
])
def test_missing_reader_field_is_not_valid(tmp_path, msg):
    m = Mock()
    c = m.page(A)
    m.frame(c, msg)
    result = run(tmp_path, [m], [attempt(A)])
    assert result['verdict'] == 'FAIL', result


@pytest.mark.parametrize('bad_origin', [
    {**origin(A), 'project': 'another-project'},
    {k: v for k, v in origin(A).items() if k != 'project'},
])
def test_origin_project_is_checked(tmp_path, bad_origin):
    m = Mock()
    m.http(bad_origin)
    c = m.open(bad_origin)
    m.frame(c, {'cmd': 'hello', 'session': 's'})
    result = run(tmp_path, [m], [attempt(A)])
    assert result['verdict'] == 'FAIL', result


def test_test_cannot_send_to_another_workers_mock(tmp_path):
    m1, m2 = Mock('m1'), Mock('m2')
    m1.page(A)
    m2.page(B)
    c = m2.open(origin(A))
    m2.frame(c, {'cmd': 'machine_off'})
    result = run(tmp_path, [m1, m2], [attempt(A, 'm1'), attempt(B, 'm2')])
    assert result['verdict'] == 'FAIL', result


@pytest.mark.parametrize('raw', [False, True])
def test_frame_without_open_is_never_silently_discarded(tmp_path, raw):
    m = Mock()
    m.page(A)
    if raw:
        m.raw(999, 'not JSON')
    else:
        m.frame(999, {'cmd': 'not_a_command'})
    result = run(tmp_path, [m], [attempt(A)])
    assert result['verdict'] == 'FAIL', result


@pytest.mark.parametrize('change', ['extra-field', 'two-hellos'])
def test_no_cookie_exception_is_exactly_one_valid_hello(tmp_path, change):
    m = Mock()
    m.page(A)
    c = m.open(None)
    msg = {'cmd': 'hello', 'session': replay.NO_COOKIE_SESSION}
    if change == 'extra-field':
        msg.update(unreviewed_field=True, resume_armed='yes')
    m.frame(c, msg)
    if change == 'two-hellos':
        m.frame(c, msg)
    result = run(tmp_path, [m], [attempt(A, file=replay.NO_COOKIE_SPEC)])
    assert result['verdict'] == 'FAIL', result


def test_control_valid_reader_fields_and_two_workers(tmp_path):
    m1, m2 = Mock('m1'), Mock('m2')
    c = m1.page(A)
    m2.page(B)
    for msg in [
        {'cmd': 'timing_log', 'enable': False},
        {'cmd': 'halshow_live', 'on': False},
        {'cmd': 'device_rename', 'name': 'Panel'},
        {'cmd': 'save_settings', 'section': 'machine', 'base_rev': 0, 'data': {}},
        {'cmd': 'tab_visibility', 'hidden': False},
    ]:
        m1.frame(c, msg)
    assert run(tmp_path, [m1, m2], [attempt(A, 'm1'), attempt(B, 'm2')])['verdict'] == 'PASS'


def test_control_current_reader_does_not_require_a_device_target(tmp_path):
    m = Mock()
    c = m.page(A)
    m.frame(c, {'cmd': 'device_reset'})
    assert run(tmp_path, [m], [attempt(A)])['verdict'] == 'PASS'


def test_control_exact_named_no_cookie_exception(tmp_path):
    m = Mock()
    m.page(A)
    c = m.open(None)
    m.frame(c, {'cmd': 'hello', 'session': replay.NO_COOKIE_SESSION})
    assert run(tmp_path, [m], [attempt(A, file=replay.NO_COOKIE_SPEC)])['verdict'] == 'PASS'


def test_control_late_frame_keeps_original_attempt(tmp_path):
    m = Mock()
    c = m.page(A)
    m.page(B)
    m.frame(c, {'cmd': 'heartbeat', 'seq': 42})
    result = run(tmp_path, [m], [attempt(A, title='a', stop=25), attempt(B, title='b', start=26)])
    assert result['verdict'] == 'PASS'
    # Late delivery may be valid. Do not reassign it to the new attempt.
    assert result['per_attempt']['x.spec.ts › a [retry 0]']['heartbeat'] == 1

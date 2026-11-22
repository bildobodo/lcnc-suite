"""R435: every spawned drift needs its own applied-priority evidence."""
from test_support import native_cases as nc
import pytest


def window(*, missing=None, wrong=None, fail=False):
    events = []
    for job in (1, 2):
        events.append({'tag': 'gcode.spawn_start', 'job': job, 'reason': 'tool_offset', 'nice': 19})
        if job != missing:
            events.append({'tag': 'gcode.worker_done', 'job': job, 'nice_applied': '0' if job == wrong else '19'})
        elif fail:
            events.append({'tag': 'gcode.parse_worker_failed', 'job': job, 'rc': 1})
    return {'framed': True, 'losses': [], 'events': events}


def test_all_workers_confirmed():
    out = nc.eval_parse_nice('nice', window())
    assert out['status'] == 'PASS' and out['applied'] == out['drift'] == 2


def test_known_wrong_priority_fails():
    out = nc.eval_parse_nice('nice', window(wrong=2))
    assert out['status'] == 'FAIL', out


@pytest.mark.parametrize('missing', [1, 2])
def test_one_worker_answer_missing_is_incomplete(missing):
    out = nc.eval_parse_nice('nice', window(missing=missing))
    assert out['status'] == 'incomplete', out


def test_worker_failure_without_answer_is_not_proof_of_nice():
    out = nc.eval_parse_nice('nice', window(missing=2, fail=True))
    assert out['status'] == 'incomplete', out


def test_unrelated_answer_does_not_cover_the_missing_job():
    w = window(missing=2)
    w['events'].append({'tag': 'gcode.worker_done', 'job': 99, 'nice_applied': '19'})
    out = nc.eval_parse_nice('nice', w)
    assert out['status'] == 'incomplete', out


def test_no_answers_is_incomplete():
    w = window()
    w['events'] = [e for e in w['events'] if e['tag'] != 'gcode.worker_done']
    assert nc.eval_parse_nice('nice', w)['status'] == 'incomplete'

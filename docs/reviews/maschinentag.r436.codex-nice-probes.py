"""R436 independent checks of multi-job completeness and fault precedence."""
from itertools import combinations
import pytest
from test_support import native_cases as nc


def window():
    events = []
    for j, reason in ((11, 'tool_offset'), (22, 'wcsoff:G54:z'), (33, 'toolsetter')):
        events.extend([{'tag': 'gcode.spawn_start', 'job': j, 'reason': reason, 'nice': 19},
                       {'tag': 'gcode.worker_done', 'job': j, 'nice_applied': '19'}])
    # Unrelated load with normal priority is outside the drift claim.
    events.extend([{'tag': 'gcode.spawn_start', 'job': 44, 'reason': 'file', 'nice': 0},
                   {'tag': 'gcode.worker_done', 'job': 44, 'nice_applied': None}])
    return {'framed': True, 'losses': [], 'events': events}


SUBSETS = [tuple(s) for n in range(4) for s in combinations((11, 22, 33), n)]
@pytest.mark.parametrize('missing', SUBSETS)
def test_every_subset_of_missing_answers(missing):
    w = window()
    w['events'] = [e for e in w['events'] if not(e['tag'] == 'gcode.worker_done' and e['job'] in missing)]
    result = nc.eval_parse_nice('nice', w)
    assert result['status'] == ('incomplete' if missing else 'PASS'), result
    assert result['drift'] == 3 and result['applied'] == 3 - len(missing), result


@pytest.mark.parametrize('missing,wrong', [(a,b) for a in (11,22,33) for b in (11,22,33) if a != b])
def test_known_fault_survives_other_missing_answer_in_every_position(missing,wrong):
    w = window()
    w['events'] = [e for e in w['events'] if not(e['tag'] == 'gcode.worker_done' and e['job'] == missing)]
    for e in w['events']:
        if e['tag'] == 'gcode.worker_done' and e['job'] == wrong:e['nice_applied'] = '0'
    result = nc.eval_parse_nice('nice', w)
    assert result['status'] == 'FAIL', result


@pytest.mark.parametrize('value', [None, '19', '0'])
def test_multiple_answers_cannot_be_overwritten(value):
    w = window()
    w['events'].append({'tag': 'gcode.worker_done', 'job': 22, 'nice_applied': value})
    result = nc.eval_parse_nice('nice', w)
    assert result['status'] == 'incomplete', result


@pytest.mark.parametrize('invalid', [None, True, '22'])
def test_unproven_start_id_is_not_accepted(invalid):
    w = window()
    for e in w['events']:
        if e['job'] == 22:e['job'] = invalid
    assert nc.eval_parse_nice('nice', w)['status'] == 'incomplete'

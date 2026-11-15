"""R381 plan feasibility: actual lcnc_trace writers, no machine or network.

This inspects where the proposed markers land. It is NOT the future reader.
Usage: python3 r381-trace-marks.py /tmp/codex-r379
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(sys.argv[1]).resolve()

if len(sys.argv) == 2:
    rows = []
    for case in ('none', 'foreign-before', 'foreign-during', 'gateway-during'):
        result = subprocess.run([sys.executable, __file__, str(root), case],
                                check=True, text=True, capture_output=True)
        rows.append(json.loads(result.stdout))
    print(json.dumps(rows, indent=2))
    raise SystemExit(0)

sys.path.insert(0, str(root / 'lcnc-gateway'))
import lcnc_trace as tr


def foreign_rotate(folder):
    subprocess.run([sys.executable, '-c', '''
import sys
sys.path.insert(0, sys.argv[1])
import lcnc_trace as tr
tr.init('hal_reader', log_dir=sys.argv[2])
h = next(h for h in tr._logger.handlers if getattr(h, '_lcnc_role', '') == 'trace')
h.doRollover()
tr.emit('r381.helper')
''', str(root / 'lcnc-gateway'), folder], check=True)


case = sys.argv[2]
with tempfile.TemporaryDirectory(prefix='r381-trace-') as folder:
    tr.init('gateway', log_dir=folder)
    tr.emit('r381.baseline')
    if case == 'foreign-before':
        foreign_rotate(folder)
    token = 'r381.' + case
    tr.emit('client.diag', native_mark=token, edge='start')
    if case == 'foreign-during':
        foreign_rotate(folder)
    elif case == 'gateway-during':
        h = next(h for h in tr._logger.handlers if getattr(h, '_lcnc_role', '') == 'trace')
        h.doRollover()
    tr.emit('features.job', cmd='probe_run', line='O<probe_z_minus_wco> CALL')
    tr.emit('client.diag', native_mark=token, edge='end')
    marks, jobs = {}, []
    for path in sorted(Path(folder).glob('trace.ndjson*')):
        with path.open('rb') as stream:
            st = os.fstat(stream.fileno())
            lines = stream.read(st.st_size).splitlines(keepends=True)
        assert all(line.endswith(b'\n') for line in lines)
        for index, line in enumerate(lines):
            event = json.loads(line)
            if event.get('proc') != 'gateway' or event.get('pid') != os.getpid():
                continue
            place = ((st.st_dev, st.st_ino), index, path.name)
            if event.get('native_mark') == token and event.get('tag') == 'client.diag':
                assert event['edge'] not in marks
                marks[event['edge']] = place
            if event.get('tag') == 'features.job':
                jobs.append(place)
    assert set(marks) == {'start', 'end'} and len(jobs) == 1
    same = marks['start'][0] == marks['end'][0]
    framed = same and marks['start'][1] < jobs[0][1] < marks['end'][1] and jobs[0][0] == marks['start'][0]
    assert framed == (case != 'gateway-during')
    print(json.dumps({'case': case, 'start_file': marks['start'][2], 'end_file': marks['end'][2],
                      'same_open_file_identity': same, 'job_between_marks': framed,
                      'planned_window': 'assessable' if framed else 'incomplete'}))

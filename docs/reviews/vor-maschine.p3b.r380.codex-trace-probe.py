"""R380: real trace writer; no gateway, HAL, socket or machine access.

Run: python3 r380-trace-probe.py /tmp/codex-r379
The helper forces exactly one ordinary rollover BEFORE the planned window.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / 'lcnc-gateway'))
import lcnc_trace as tr


def mark(path):
    with path.open('rb') as stream:
        st = os.fstat(stream.fileno())
        return st.st_dev, st.st_ino, st.st_size


def read_window(path, start):
    with path.open('rb') as stream:
        st = os.fstat(stream.fileno())
        assert (st.st_dev, st.st_ino) == start[:2]
        assert st.st_size >= start[2]
        stream.seek(start[2])
        return [json.loads(line) for line in stream]


with tempfile.TemporaryDirectory(prefix='r380-trace-') as folder:
    path = Path(folder) / 'trace.ndjson'
    tr.init('gateway', log_dir=folder)
    tr.emit('r380.baseline')
    before = mark(path)
    tr.emit('features.job', cmd='probe_run', line='O<probe_z_minus_wco> CALL')
    control = read_window(path, before)
    assert sum(e['tag'] == 'features.job' for e in control) == 1

    subprocess.run([sys.executable, '-c', '''
import sys
sys.path.insert(0, sys.argv[1])
import lcnc_trace as tr
tr.init('hal_reader', log_dir=sys.argv[2])
handler = next(h for h in tr._logger.handlers if getattr(h, '_lcnc_role', '') == 'trace')
handler.doRollover()
tr.emit('r380.after_rollover')
''', str(root / 'lcnc-gateway'), folder], check=True)

    # The planned window starts AFTER the rollover, on the stable current path.
    before = mark(path)
    tr.emit('features.job', cmd='probe_run', line='O<probe_z_minus_wco> CALL')
    after = mark(path)
    window = read_window(path, before)
    rotated = [json.loads(line) for line in path.with_name('trace.ndjson.1').read_text().splitlines()]
    jobs = [e for e in rotated if e['tag'] == 'features.job']
    assert before == after and not window and len(jobs) == 2
    print(json.dumps({
        'control_current_path_jobs': 1,
        'rollover_before_window': True,
        'current_path_identity_and_size_unchanged': before == after,
        'planned_window_jobs': len(window),
        'new_job_written_to_rotated_file': jobs[-1]['cmd'] == 'probe_run',
        'new_job_writer': jobs[-1]['proc'],
        'new_job_pid_is_test_process': jobs[-1]['pid'] == os.getpid(),
        'interpretation': 'No absence verdict is justified from the current path alone.'
    }, indent=2))

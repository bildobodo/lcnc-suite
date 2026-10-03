"""R70: only the native INI reader; never construct stat/command or contact LinuxCNC.
Run from the archive root with /usr/bin/python3 (linuxcnc binding installed).
"""
import sys, tempfile, json
from pathlib import Path
sys.path.insert(0, 'scripts')
from config_sync_check import drifted_lines
import linuxcnc
with tempfile.TemporaryDirectory(prefix='r70-ini-') as d:
    a = '[JOINT_0]\nMAX_VELOCITY = 10\nMAX_VELOCITY = 20\n'
    b = '[JOINT_0]\nMAX_VELOCITY = 20\nMAX_VELOCITY = 10\n'
    p, q = Path(d)/'a.ini', Path(d)/'b.ini'
    p.write_text(a); q.write_text(b)
    out = {'repo': a, 'deployed': b,
           'repo_effective': linuxcnc.ini(str(p)).find('JOINT_0', 'MAX_VELOCITY'),
           'deployed_effective': linuxcnc.ini(str(q)).find('JOINT_0', 'MAX_VELOCITY'),
           'drift': drifted_lines(a, b, ini=True)}
    print(json.dumps(out, indent=2))
    assert out['repo_effective'] == out['deployed_effective'] or any(out['drift']), 'changed effective value must not be classified as unchanged'

"""Run actual offline native probes in fresh processes; no live command."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
rows = []
for case in ('m6_random_loaded', 'm6_random_swap', 'm6_unload', 'm6_row_not_number'):
    env = dict(os.environ)
    env.pop('PYTHONPATH', None)
    r = subprocess.run([sys.executable, 'native_start_probe.py', case], cwd=root/'lcnc-gateway',
                       env=env, capture_output=True, text=True, timeout=30)
    payloads = [json.loads(line) for line in r.stdout.splitlines() if line.startswith('{')]
    assert r.returncode == 0 and payloads and 'skip' not in payloads[-1], (case, r.stdout, r.stderr)
    data = payloads[-1]
    assert data['parse_error'] is None, data
    rows.append({'case': case, 'exit': r.returncode, 'payload': data, 'stderr': r.stderr})
    print(json.dumps({'case': case, 'tools': data['tool_change_lines'], 'tlo': data['tlo_events']}))
assert rows[0]['payload']['tool_change_lines'] == [[3, 7]]
assert rows[1]['payload']['tool_change_lines'] == [[3, 2]]
assert rows[2]['payload']['tool_change_lines'] == [[3, 1], [6, 0]]
(root/'evidence/native-results.json').write_text(json.dumps(rows, indent=2) + '\n')

"""Run six independent native interpreters: python THIS_SCRIPT ARCHIVE_ROOT OUTPUT_JSON."""
import json
import os
import subprocess
import sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
exe = Path(sys.executable)
result = {'kind': 'native offline parameter sensitivity; no measured delay or machine motion',
          'probe_F_mm_min': 200, 'assumed_delta_mm': 0.1,
          'corresponding_delay_at_full_feed_ms': 30, 'plan_threshold_ms': 600,
          'source_commit': '663c3a4c095dd2d42fdf365bc09eae4d5ebbdd10', 'cases': {}}
for kind in ('fixed', 'amplified', 'branch'):
    for label in ('ideal', 'delta'):
        name = f'r124_{kind}_{label}'
        p = subprocess.run([str(exe), str(Path(__file__).with_name('viewer-palette-fest.r124.codex-native.py')), name],
                           cwd=root / 'lcnc-gateway', text=True, capture_output=True,
                           env={**os.environ, 'PYTHONPYCACHEPREFIX': str(root / '.pycache')}, timeout=45)
        lines = p.stdout.strip().splitlines()
        data = json.loads(lines[-1]) if lines else {}
        assert p.returncode == 0 and 'skip' not in data and not data.get('parse_error'), (name, p.stderr, p.stdout)
        assert data['mmap_unchanged']
        last = data['feed'][-1]
        result['cases'][name] = {'last_feed': last, 'last_line': data['feed_lines'][-1],
                                'tlo_events': data['tlo_events'], 'payload': data,
                                'stderr': p.stderr, 'stdout_prefix': lines[:-1]}
        print(name, last, flush=True)
result['assertions'] = {}
for kind, expected_shift in [('fixed', 0), ('amplified', 10), ('branch', 100)]:
    a = result['cases'][f'r124_{kind}_ideal']['last_feed']
    b = result['cases'][f'r124_{kind}_delta']['last_feed']
    shift = abs(a[0]-b[0])
    assert abs(shift-expected_shift) < 1e-4, (kind, a, b)
    result['assertions'][kind] = {'observed_X_shift': shift, 'expected_X_shift': expected_shift, 'pass': True}
Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')

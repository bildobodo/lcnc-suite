"""Review R351: run the real lint step in an isolated archive, with faults.

Usage: PYTHONDONTWRITEBYTECODE=1 <ruff-venv-python> r351-probe.py <archive>
Never run this in a live checkout; each temporary source is deleted finally.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(sys.argv[1]).resolve()
assert str(root).startswith('/tmp/codex-r351')
sys.path.insert(0, str(root / 'scripts'))
spec = importlib.util.spec_from_file_location('r351_suite', root / 'scripts/test_suite.py')
suite = importlib.util.module_from_spec(spec)
spec.loader.exec_module(suite)
from test_select.rules import decide

name, command, cwd = suite.offline_commands('backend')[0]
assert name == 'ruff'

def run(cmd=command, where=cwd):
    p = subprocess.run(cmd, cwd=where, capture_output=True, text=True, timeout=120)
    return {'command': cmd, 'cwd': str(where), 'exit': p.returncode,
            'stdout': p.stdout, 'stderr': p.stderr}

rows = []
baseline = run()
rows.append({'case': 'unmodified root', 'pass': baseline['exit'] == 0, **baseline})
listed = run(command + ['--show-files'])
expected = {str(p.relative_to(root)) for base in ('lcnc-gateway', 'scripts', 'subroutines', 'examples')
            for p in (root / base).rglob('*.py')}
actual = {str(Path(p).relative_to(root)) for p in listed['stdout'].splitlines()}
rows.append({'case': 'discovery equals all in-scope Python', 'pass': expected == actual,
             'count': len(actual), 'missing': sorted(expected - actual), 'extra': sorted(actual - expected)})
for folder in ['lcnc-gateway', 'scripts', 'scripts/test_support',
               'subroutines/surfacemap', 'examples/sim_config/twp/python',
               'examples/sim_config/sim_toolsetter']:
    path = root / folder / 'codex_r351_probe.py'
    assert not path.exists()
    try:
        path.write_text('def review_probe():\n    return not_declared_for_r351\n')
        result = run()
        rows.append({'case': 'F821 in ' + folder,
                     'pass': result['exit'] == 1 and 'F821' in result['stdout'], **result})
    finally:
        path.unlink()
path = root / 'docs' / 'codex_r351_probe.py'
assert not path.exists()
try:
    path.write_text('def review_probe():\n    return not_declared_for_r351\n')
    result = run()
    rows.append({'case': 'docs evidence excluded', 'pass': result['exit'] == 0, **result})
finally:
    path.unlink()
result = run([command[0], '-S'] + command[1:])
rows.append({'case': 'ruff absent', 'pass': result['exit'] != 0 and 'No module named ruff' in result['stderr'], **result})
d = decide('ruff.toml')
rows.append({'case': 'config selects backend', 'pass': d.backend and not d.unmatched,
             'backend': d.backend, 'unmatched': d.unmatched, 'rules': d.rules})
rows.append({'case': 'step order and count',
             'pass': len(suite.offline_commands('backend')) == 12 and len(suite.offline_commands('all')) == 16
                     and suite.offline_commands('backend')[1][0] == 'backend',
             'backend': [x[0] for x in suite.offline_commands('backend')],
             'all_count': len(suite.offline_commands('all'))})
# Use the production run_gate to retain its failed-step status and log.
bad = root / 'scripts/codex_r351_probe.py'
assert not bad.exists()
try:
    bad.write_text('def review_probe():\n    return not_declared_for_r351\n')
    import os
    import contextlib
    import io
    with tempfile.TemporaryDirectory(prefix='r351-gate-') as tmp, contextlib.redirect_stdout(io.StringIO()):
        result = suite.run_gate(name, command, cwd, Path(tmp), dict(os.environ), 120)
        log = (Path(tmp) / result['log']).read_text()
    rows.append({'case': 'actual run_gate records lint failure',
                 'pass': result['status'] == 'fail' and result['exit_code'] == 1 and 'F821' in log,
                 'status': result['status'], 'exit': result['exit_code'], 'log': log})
finally:
    bad.unlink()
result = run()
rows.append({'case': 'restored clean control', 'pass': result['exit'] == 0, **result})
print(json.dumps({'head': '22348f34a703841ac5bd094a5240fb4c229bdd86',
                  'python': sys.version, 'cases': rows, 'all_pass': all(r['pass'] for r in rows),
                  'ruff_files': sorted(actual),
                  'source_sha256': {p: hashlib.sha256((root / p).read_bytes()).hexdigest()
                                    for p in ('ruff.toml', 'scripts/test_suite.py', 'scripts/test_select/rules.py')}},
                 ensure_ascii=False, indent=2))
sys.exit(0 if all(r['pass'] for r in rows) else 1)

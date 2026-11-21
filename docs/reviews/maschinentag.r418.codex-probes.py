"""R418: offline counterexamples on the exact archived source; no network."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace

ROOT = Path('/tmp/codex-r418')
OUT = Path('/tmp/r418')

def functions(path, names, ns, assignments=()):
    tree = ast.parse((ROOT / path).read_text())
    selected = [n for n in tree.body if
                isinstance(n, ast.FunctionDef) and n.name in names or
                isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in assignments for t in n.targets)]
    assert len(selected) == len(names) + len(assignments)
    mod = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)] + selected, type_ignores=[])
    ast.fix_missing_locations(mod)
    exec(compile(mod, str(ROOT / path), 'exec'), ns)

ns = {'time': time, '_trace': SimpleNamespace(emit=lambda *a, **k: None)}
functions('lcnc-gateway/gateway_util.py', ('toolsetter_ctx', 'toolsetter_basis_view'), ns, ('TOOLSETTER_BASIS_KEYS',))
functions('lcnc-gateway/gateway.py', ('_ts_book', '_ts_drift_reason', '_ts_open_drift'), ns)
out = {'toolsetter': []}
for origin in ('applied', 'assumed', 'unknown'):
    ns['_ts_basis'] = {k: {'value': 1.0, 'origin': origin, 't': 1} for k in ns['TOOLSETTER_BASIS_KEYS']}
    ns['_ts_basis_version'], ns['_ts_reparse_for'] = 1, None
    before = ns['toolsetter_ctx'](ns['_ts_basis'], 1)
    ns['_bulk'] = SimpleNamespace(published_toolsetter={'routine': True}, published_ctx={'toolsetter': before})
    ns['_ts_book']({k: 1.0 for k in ns['TOOLSETTER_BASIS_KEYS']}, 'read')
    after = ns['toolsetter_ctx'](ns['_ts_basis'], ns['_ts_basis_version'])
    item = {'transition': origin + ' -> read', 'equal_values': True,
            'before': before, 'after': after, 'drift': ns['_ts_drift_reason'](),
            'run_start_drift': ns['_ts_open_drift']()}
    assert item['drift'] == item['run_start_drift'] == 'toolsetter'
    if origin == 'applied':
        assert before['patches'] == after['patches'] and before['unpredictable'] == after['unpredictable']
    if origin == 'unknown':
        assert before['unpredictable'] == 'toolsetter_unknown' and after['unpredictable'] is None
    out['toolsetter'].append(item)

CHILD = '''
import sys, json
sys.path.insert(0, sys.argv[1])
import lcnc_trace as t
t.init(sys.argv[2], log_dir=sys.argv[3])
for h in t._logger.handlers:
    h.maxBytes = 0
    h.backupCount = 1
print('ready', flush=True)
for line in sys.stdin:
    cmd = json.loads(line)
    if cmd['op'] == 'emit':
        t.emit('crash.r418_probe' if cmd['role'] == 'crash' else 'r418_probe', marker=cmd['marker'])
    elif cmd['op'] == 'rotate':
        next(h for h in t._logger.handlers if h._lcnc_role == cmd['role']).doRollover()
    print('ok', flush=True)
'''
out['rotation'] = []
for role, filename in [('trace', 'trace.ndjson'), ('crash', 'crash.log')]:
    directory = Path(tempfile.mkdtemp(prefix='rotation-' + role + '-', dir=OUT))
    ps = [subprocess.Popen([sys.executable, '-B', '-c', CHILD, str(ROOT / 'lcnc-gateway'), name, str(directory)],
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
          for name in ('writer-a', 'writer-b')]
    def send(p, **cmd):
        p.stdin.write(json.dumps(cmd) + '\n'); p.stdin.flush()
        assert p.stdout.readline().strip() == 'ok'
    def occurrences(marker):
        return [p.name for p in directory.glob(filename + '*') if marker in p.read_text()]
    try:
        for p in ps:
            assert p.stdout.readline().strip() == 'ready'
        send(ps[0], op='rotate', role=role)
        send(ps[1], op='emit', role=role, marker='late-before-delete')
        first = occurrences('late-before-delete')
        assert first == [filename + '.1'], first
        send(ps[0], op='rotate', role=role)
        send(ps[1], op='emit', role=role, marker='late-after-delete')
        second = occurrences('late-after-delete')
        assert second == [], second
        out['rotation'].append({'role': role, 'after_one_rotation': first,
                                'after_two_rotations_visible_files_with_record': second,
                                'both_writer_operations_returned_normally': True})
    finally:
        for p in ps:
            p.stdin.close()
        for p in ps:
            p.wait(timeout=10)
            assert p.returncode == 0 and not p.stderr.read()

out['source_sha256'] = {n: hashlib.sha256((ROOT / n).read_bytes()).hexdigest() for n in (
    'lcnc-gateway/gateway.py', 'lcnc-gateway/gateway_util.py', 'lcnc-gateway/lcnc_trace.py')}
(OUT / 'probes.json').write_text(json.dumps(out, indent=2) + '\n')
print('PASS: 3 toolsetter origin transitions; 2 real two-process rotation probes (trace and crash).')

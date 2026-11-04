"""R277: run in an isolated archive of b588eaea, with copied node_modules.
No network or gateway import. Mutation restored; formatter targets temporary files.
Usage: python3 [-O] r277-part-a.py /tmp/codex-r277/a
"""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(sys.argv[1]).resolve()
if not str(root).startswith('/tmp/'):
    raise SystemExit('isolated /tmp archive required')
out = {'target': 'b588eaea', 'optimized': not __debug__}
spec = importlib.util.spec_from_file_location('r277_functions', root / 'scripts/inventory/functions.py')
fn = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fn)
web, py, data = fn.load()
out['inventory_problems'] = fn.problems(web, py, data, root)
out['roundtrip'] = json.loads(fn.dump(data)) == data
out['idempotent'] = fn.dump(json.loads(fn.dump(data))) == fn.dump(data)
out['formatter_cases'] = []
for kind in ['function_extra', 'root_extra', 'empty_uses', 'empty_statements']:
    trial = copy.deepcopy(data)
    if kind == 'function_extra': trial['functions'][0]['reviewNote'] = 'must not disappear'
    elif kind == 'root_extra': trial['reviewNote'] = 'must not disappear'
    elif kind == 'empty_uses': trial['functions'][0]['uses'] = []
    else: trial['functions'][0]['statements'] = []
    with tempfile.TemporaryDirectory(prefix='r277-format-') as temp:
        path = Path(temp) / 'functions.json'
        path.write_text(json.dumps(trial, ensure_ascii=False, indent=3))
        before = path.read_bytes()
        fn.HERE = Path(temp)
        sys.argv = ['functions.py', '--format']
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = fn.main()
        row = {'case': kind, 'exit': code, 'unchanged_bytes': before == path.read_bytes(),
               'equal_data': json.loads(path.read_text()) == trial, 'stdout': stdout.getvalue()}
        if not row['equal_data'] or (kind.endswith('extra') and (code != 1 or not row['unchanged_bytes'])):
            raise RuntimeError(row)
        out['formatter_cases'].append(row)

source = root / 'lcnc-webui/src/toolsetterSetup.ts'
before = source.read_bytes()
out['source_sha_before'] = hashlib.sha256(before).hexdigest()
if __debug__:
    try:
        old = '"3104": p.toolMinDis'
        if before.decode().count(old) != 1: raise RuntimeError('mutation anchor')
        source.write_text(before.decode().replace(old, '"3904": p.toolMinDis'))
        command = ['node', 'node_modules/vitest/vitest.mjs', 'run', 'src/toolsetterSetup.test.ts',
                   '-t', 'writes the var numbers', '--maxWorkers=1', '--allowOnly=false', '--retry=0']
        result = subprocess.run(command, cwd=root / 'lcnc-webui', text=True, capture_output=True)
        out['key_mutation'] = {'exit': result.returncode, 'stdout': result.stdout, 'stderr': result.stderr}
        if result.returncode != 1 or 'AssertionError' not in result.stderr: raise RuntimeError('mutation did not fail by assertion')
    finally:
        source.write_bytes(before)
out['source_sha_after'] = hashlib.sha256(source.read_bytes()).hexdigest()
print(json.dumps(out, ensure_ascii=False, indent=2))

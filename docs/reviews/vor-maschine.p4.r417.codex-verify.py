"""R417 offline review. Run under heavy_lock; mutate only the archive copy."""
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import xml.etree.ElementTree as ET

ROOT = Path('/tmp/codex-r417')
OUT = Path('/tmp/r417')
PY = '/home/cnc/lcnc-suite-dev/lcnc-gateway/.venv/bin/python3'
test_path = ROOT / 'scripts/test_native_stage.py'
source_path = ROOT / 'scripts/native_run.py'
source = source_path.read_bytes()

old = next(n for n in ast.parse((OUT / 'original-r384.py').read_text()).body
           if isinstance(n, ast.FunctionDef))
new = next(n for n in ast.parse(test_path.read_text()).body
           if isinstance(n, ast.FunctionDef) and 'loses_its_admission' in n.name)
assert isinstance(old.body[0], ast.Expr)
assert ast.unparse(old.body[0]) == "monkeypatch.setattr(nr.heavy, 'LOCK', tmp_path / 'own-heavy.lock')"
old.body.pop(0)
old.name = new.name
# The standalone probe imported the same class at module level; the guard
# imports it inside the test. Check that exact relocation before comparing.
assert ast.unparse(new.body[0]) == 'from test_support.live_session import SimulatorClient'
new.body.pop(0)

class NamedChanges(ast.NodeTransformer):
    def visit_Call(self, node):
        if isinstance(node.func, ast.Attribute) and ast.unparse(node.func) == 'guards.FakeHost':
            node.func = ast.Name(id='FakeHost', ctx=ast.Load())
        return self.generic_visit(node)

    def visit_Assert(self, node):
        # Only the announced conditional assertion, exactly as in R384.
        if isinstance(node.test, ast.IfExp):
            expected = ast.parse("assert nr.verdict(report) == 'FAIL' and 'NotAdmitted' in report['error'] if not wrapped else (nr.verdict(report) == 'FAIL' and 'StepFailed' in report['error'])").body[0]
            assert ast.dump(node) == ast.dump(expected)
            return ast.parse("assert nr.verdict(report) == 'FAIL'\nassert ('StepFailed' if wrapped else 'NotAdmitted') in report['error']").body
        return self.generic_visit(node)

old = NamedChanges().visit(old)
assert ast.dump(old) == ast.dump(new), 'unannounced change from the R384 probe'

env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
identity = subprocess.run([PY, '-B', '-c',
    'import native_run as n; import test_native_stage as t; assert n.heavy is t.hl; print("same heavy_lock module")'],
    cwd=ROOT / 'scripts', env=env, capture_output=True, text=True, check=True)

results = {'r384_ast_equal_after_named_adaptations': True,
           'lock_module_identity': identity.stdout.strip(),
           'source_sha256': hashlib.sha256(source).hexdigest(), 'runs': []}

def run(label, selected, failures, passes):
    cmd = [PY, '-B', '-m', 'pytest', '-q', '-p', 'no:cacheprovider',
           'test_native_stage.py', f'--junitxml={OUT / (label + ".xml")}']
    if selected:
        cmd += ['-k', 'loses_its_admission']
    p = subprocess.run(cmd, cwd=ROOT / 'scripts', env=env, capture_output=True,
                       text=True, timeout=240)
    (OUT / (label + '.txt')).write_text(p.stdout + p.stderr)
    cases = list(ET.parse(OUT / (label + '.xml')).iter('testcase'))
    failed = [c for c in cases if c.find('failure') is not None]
    errors = [c for c in cases if c.find('error') is not None]
    skipped = [c for c in cases if c.find('skipped') is not None]
    item = dict(label=label, command=cmd, exit=p.returncode, tests=len(cases),
                failed=len(failed), errors=len(errors), skipped=len(skipped),
                failures=[{'case': c.attrib['name'], 'message': c.find('failure').attrib.get('message', '')}
                          for c in failed])
    results['runs'].append(item)
    (OUT / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    print(f'{label}: exit={p.returncode}, tests={len(cases)}, failures={len(failed)}, errors={len(errors)}, skipped={len(skipped)}', flush=True)
    assert p.returncode == (1 if failures else 0), item
    assert len(cases) == failures + passes and len(failed) == failures, item
    assert not errors and not skipped, item
    if selected and failures == 8:
        assert all('None-' not in c.attrib['name'] for c in failed), item

run('full', False, 0, 655)
mutants = next(ast.literal_eval(n.value) for n in ast.parse((OUT / 'supplied-mutants.py').read_text()).body
               if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'MUTANTS' for t in n.targets))
try:
    for i, (name, (before, after)) in enumerate(mutants.items(), 1):
        text = source.decode()
        assert text.count(before) == 1, name
        source_path.write_text(text.replace(before, after))
        run(f'M{i}', True, 12 if i == 3 else 8, 0 if i == 3 else 4)
        source_path.write_bytes(source)
finally:
    source_path.write_bytes(source)
run('restored', True, 0, 12)
assert hashlib.sha256(source_path.read_bytes()).hexdigest() == results['source_sha256']
print('PASS: exact source restored; all four mutations failed inside the test body.', flush=True)

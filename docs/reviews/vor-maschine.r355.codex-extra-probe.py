#!/usr/bin/env python3
"""R355 extra probes. Run ONLY on the archive, never on a live checkout.

No machine channels, polling, services or commands. Native access is only
imports and class/constant inspection. Every file change is restored.
"""
import importlib
import json
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
assert root == Path('/tmp/codex-r355'), 'This probe only mutates its review archive'
sys.path.insert(0, str(root / 'lcnc-gateway'))
import lcnc_iface_check as check
from json_types import to_float, to_int

results = {'target': '6cab2166', 'native_access': 'import and class inspection only'}


def gate():
    r = subprocess.run([sys.executable, str(root/'scripts/run_pyright.py'), '--outputjson'],
                       cwd=root, text=True, capture_output=True, timeout=120)
    d = json.loads(r.stdout)
    return {'exit': r.returncode, 'summary': d['summary'], 'diagnostics': d['generalDiagnostics']}


def mutate(title, files):
    old = {p: p.read_bytes() if p.exists() else None for p in files}
    try:
        for p, data in files.items():
            p.write_text(data)
        results[title] = {'gate': gate(), 'native_problems': check.problems()}
    finally:
        for p, data in old.items():
            if data is None:
                p.unlink()
            else:
                p.write_bytes(data)


results['baseline'] = {'gate': gate(), 'native_problems': check.problems()}
lc = root / 'typings/linuxcnc.pyi'
hal = root / 'typings/hal.pyi'
consumer = root / 'typings/conformance/check_r355_extra.py'
text = lc.read_text()
mutate('class_assignment', {
    lc: text.replace('class command:', 'class command:\n    codex_nonexistent = 1', 1),
    consumer: 'import linuxcnc\n\ndef f(c: linuxcnc.command) -> int:\n    return c.codex_nonexistent\n',
})
mutate('conditional_member', {
    lc: text.replace('class command:', 'import sys\n\nclass command:\n    if sys.platform == "linux":\n        def codex_nonexistent(self) -> None: ...', 1),
    consumer: 'import linuxcnc\n\ndef f(c: linuxcnc.command) -> None:\n    c.codex_nonexistent()\n',
})
ht = hal.read_text()
assert 'HAL_OUT: Final = 32' in ht
mutate('calculated_constant', {
    hal: ht.replace('HAL_OUT: Final = 32', 'HAL_OUT: Final = 16 + 17'),
    consumer: 'import hal\n\ndef f() -> int:\n    return hal.HAL_OUT\n',
})
mutate('literal_constant_control', {
    hal: ht.replace('HAL_OUT: Final = 32', 'HAL_OUT: Final = 33'),
})


def outcome(fn, value):
    try:
        return {'value': fn(value)}
    except Exception as exc:
        return {'error': type(exc).__name__, 'message': str(exc)}


# These are not JSON values: this probes the new helper's broader claim,
# not an asserted regression for a real JSON payload.
results['conversion_claim_limit'] = {
    name: {'builtin': outcome(builtin, memoryview(b'12')),
           'helper': outcome(helper, memoryview(b'12'))}
    for name, helper, builtin in [('to_float', to_float, float), ('to_int', to_int, int)]
}
results['real_missing_extra_member'] = not hasattr(importlib.import_module('linuxcnc').command, 'codex_nonexistent')
results['restored'] = {'gate': gate(), 'native_problems': check.problems()}
out.write_text(json.dumps(results, indent=2) + '\n')
for key, value in results.items():
    if isinstance(value, dict) and 'gate' in value:
        print(key, 'pyright', value['gate']['exit'], value['gate']['summary'], 'native', value['native_problems'])
    else:
        print(key, value)

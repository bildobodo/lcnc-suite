#!/usr/bin/env python3
"""R358 rerun of R357 offline review, including unchanged R355/R356 counter-cases. Mutates only its archive and restores every file.
Native LinuxCNC modules: imports/classes only, no channels or polling.
CPython _testcapi: argument parsing only, no LinuxCNC involvement.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

root = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
assert root == Path('/tmp/codex-r358')
sys.path.insert(0, str(root/'lcnc-gateway'))
import _testcapi
import fake_linuxcnc as fake
import lcnc_iface_check as check
import linuxcnc as native
from settings_store import SettingsStore, MACHINE_SECTIONS, DEVICE_SECTIONS

results = {'target': '13affe2b', 'python': sys.version}


def gate():
    r = subprocess.run([sys.executable, str(root/'scripts/run_pyright.py'), '--outputjson'],
                       cwd=root, text=True, capture_output=True, timeout=120)
    d = json.loads(r.stdout)
    return {'exit': r.returncode, 'summary': d['summary'], 'diagnostics': d['generalDiagnostics']}


def mutate(title, files):
    originals = {p: p.read_bytes() if p.exists() else None for p in files}
    try:
        for p, text in files.items():
            p.write_text(text)
        results[title] = {'gate': gate(), 'native_problems': check.problems()}
    finally:
        for p, text in originals.items():
            if text is None:
                p.unlink()
            else:
                p.write_bytes(text)


results['baseline'] = {'gate':gate(),'native_problems':check.problems()}
lc = root/'typings/linuxcnc.pyi'
consumer = root/'typings/conformance/check_r357_resolver.py'
text=lc.read_text()
call='import linuxcnc\n\ndef use(c: linuxcnc.command) -> int:\n    return c.codex_nonexistent()\n'
for form in ('annotated', 'method'):
    decl = ('    __getattribute__: Any\n' if form == 'annotated' else
            '    def __getattribute__(self, name: str) -> Any: ...\n')
    mutate(form+'_resolver',{
        lc:text.replace('from typing import Final, Literal, overload',
                        'from typing import Final, Literal, overload, Any, Callable').replace(
                        'class command:', 'class command:\n'+decl,1),
        consumer:call,
    })
results['restored'] = {'gate':gate(),'native_problems':check.problems()}
out.write_text(json.dumps(results,indent=2)+'\n')
for k,v in results.items():
    if isinstance(v,dict) and 'gate' in v:
        print(k,v['gate']['summary'],v['native_problems'])

#!/usr/bin/env python3
"""R357 offline review, including unchanged R355/R356 counter-cases. Mutates only its archive and restores every file.
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
assert root == Path('/tmp/codex-r357')
sys.path.insert(0, str(root/'lcnc-gateway'))
import _testcapi
import fake_linuxcnc as fake
import lcnc_iface_check as check
import linuxcnc as native
from settings_store import SettingsStore, MACHINE_SECTIONS, DEVICE_SECTIONS

results = {'target': '3fe74118', 'python': sys.version}


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


results['baseline'] = {'gate': gate(), 'native_problems': check.problems()}
lc = root/'typings/linuxcnc.pyi'
hal = root/'typings/hal.pyi'
consumer = root/'typings/conformance/check_r357.py'
text = lc.read_text()
call = 'import linuxcnc\n\ndef use(c: linuxcnc.command) -> None:\n    c.codex_nonexistent()\n'
mutate('r355_class_assignment', {
    lc: text.replace('class command:', 'class command:\n    codex_nonexistent = 1', 1),
    consumer: 'import linuxcnc\n\ndef use(c: linuxcnc.command) -> int:\n    return c.codex_nonexistent\n',
})
mutate('r355_conditional_member', {
    lc: text.replace('class command:', 'import sys\n\nclass command:\n    if sys.platform == "linux":\n        def codex_nonexistent(self) -> None: ...', 1),
    consumer: call,
})
mutate('r355_calculated_constant', {hal: hal.read_text().replace('HAL_OUT: Final = 32','HAL_OUT: Final = 16 + 17')})
mutate('private_inherited_member', {
    lc: text.replace('class command:', 'class _CommandExtra:\n    def codex_nonexistent(self) -> None: ...\n\nclass command(_CommandExtra):', 1),
    consumer: call,
})
mutate('public_inherited_member', {
    lc: text.replace('class command:', 'class command(stat):', 1),
    consumer: 'import linuxcnc\n\ndef use(c: linuxcnc.command) -> tuple[float, ...]:\n    return c.actual_position\n',
})
# The base must be the BUILTIN, not an imported type with the same name.
helper = root/'typings/codex_helper.pyi'
error_call = 'import linuxcnc\n\ndef use(e: linuxcnc.error) -> int:\n    return e.codex_nonexistent()\n'
mutate('imported_builtin_spelling', {
    lc: text.replace('class error(RuntimeError):', 'from codex_helper import RuntimeError\n\nclass error(RuntimeError):', 1),
    helper: 'class RuntimeError(Exception):\n    def codex_nonexistent(self) -> int: ...\n',
    consumer: error_call,
})
mutate('explicit_actual_builtin_control', {
    lc: text.replace('class error(RuntimeError):', 'from builtins import RuntimeError\n\nclass error(RuntimeError):', 1),
    consumer: error_call,
})
results['native_error_has_codex_nonexistent'] = hasattr(native.error, 'codex_nonexistent')

results['real_missing_members'] = {name: not hasattr(native.command,name)
                                   for name in ('codex_nonexistent','actual_position')}


def outcome(fn, value):
    try:
        result = fn(value)
        return {'ok': True, 'value_repr': repr(result)}
    except Exception as exc:
        return {'ok': False, 'exception': type(exc).__name__, 'message': str(exc)}


c = fake._Command()
results['argument_formats'] = []
for label, method, parser, value in [
    ('i_max_control', 'home', _testcapi.getargs_i, 2**31-1),
    ('i_positive_overflow', 'home', _testcapi.getargs_i, 2**31),
    ('i_negative_overflow', 'unhome', _testcapi.getargs_i, -(2**31)-1),
    ('s_hash_valid', 'mdi', _testcapi.getargs_s_hash, 'G0 X1'),
    ('s_hash_invalid_unicode', 'mdi', _testcapi.getargs_s_hash, '\ud800'),
]:
    before = c.serial
    parsed = outcome(parser,value)
    simulated = outcome(getattr(c,method),value)
    results['argument_formats'].append({'case':label,'value_repr':repr(value),'method':method,
                                       'cpython_parser':parsed,'fake':simulated,'serial_increment':c.serial-before})

# All current section kinds: malformed writes must neither persist nor book.
with tempfile.TemporaryDirectory(dir=root/'probes') as tmp:
    p = Path(tmp)/'settings.json'
    errors=[]
    store = SettingsStore(p,lambda:'ini-review',on_load_error=errors.append)
    device,_ = store.bind('e'*32,None)
    original=p.read_bytes()
    version=(store.version,store.devices_version)
    refused=[]
    for scope, sections in [(None,MACHINE_SECTIONS),(device,DEVICE_SECTIONS)]:
        for section in sorted(sections):
            for value in (None,[],4,'bad',False):
                res=outcome(lambda v:store.save_section(section,v,device=scope,base_rev=0,writer='review'),value)
                assert res.get('exception')=='ValueError', (section,value,res)
                assert p.read_bytes()==original and (store.version,store.devices_version)==version
                refused.append({'section':section,'scope':'machine' if scope is None else 'device','value_repr':repr(value)})
    results['settings_non_object_writes']={'refused':len(refused),'unchanged_file_and_versions':True,'cases':refused}
    doc=json.loads(original)
    doc['ini-review']['machine']=None
    doc['ini-review']['probe']=['old']
    doc['ini-review']['toolsetter']={'x':1}
    p.write_text(json.dumps(doc)); store._cache=None
    results['legacy_load']=store.load()
    assert results['legacy_load'].get('toolsetter')=={'x':1}
    assert 'machine' not in results['legacy_load'] and 'probe' not in results['legacy_load']

results['restored'] = {'gate':gate(),'native_problems':check.problems()}
out.write_text(json.dumps(results,indent=2)+'\n')
for key,val in results.items():
    if isinstance(val,dict) and 'gate' in val:
        print(key, val['gate']['summary'], val['native_problems'])
    elif key!='settings_non_object_writes':
        print(key,repr(val))
    else:
        print(key,val['refused'],'refused, file/revisions unchanged')

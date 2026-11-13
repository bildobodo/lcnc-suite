import json, sys, subprocess
from pathlib import Path
root=Path(sys.argv[1]).resolve()
assert root == Path('/tmp/codex-r358')
sys.path.insert(0,str(root/'lcnc-gateway'))
import lcnc_iface_check as check
text=(root/'typings/linuxcnc.pyi').read_text()
results={'target':'13affe2b','baseline_problems':check.problems(),'shape_cases':{}}
for name,stub in {
    'actual_builtin_control':text,
    'explicit_builtin_import_is_declined':text.replace('class error(RuntimeError):','from builtins import RuntimeError\nclass error(RuntimeError):',1),
    'imported_property':text.replace('class error(RuntimeError):','from codex_helper import property\nclass error(RuntimeError):',1),
    'imported_overload':text.replace('from typing import Final, Literal, overload','from typing import Final, Literal\nfrom codex_helper import overload',1),
    'locally_annotated_property':text.replace('class error(RuntimeError):','property: int\nclass error(RuntimeError):',1),
    'module_getattribute_annotation':text+'\n__getattribute__: object\n',
    'module_getattr_annotation':text+'\n__getattr__: object\n',
}.items():
    claims=check.stub_claims(stub)
    results['shape_cases'][name]=claims.unsupported
    assert bool(claims.unsupported) == (name != 'actual_builtin_control'),name
package=root/'typings/rs274/__init__.pyi'
old=package.read_bytes()
try:
    package.write_bytes(old+b'\ncodex_nonexistent: int\n')
    results['package_extra_export']=check.problems()
    assert 'rs274.codex_nonexistent is claimed by the stub and missing' in results['package_extra_export']
finally: package.write_bytes(old)
unknown=root/'typings/codex_unregistered.pyi'
assert not unknown.exists()
try:
    unknown.write_text('class Extra: ...\n')
    p=subprocess.run([sys.executable,'-m','pytest','-q','-p','no:cacheprovider',
        'test_lcnc_iface.py::StubClaims::test_every_stub_is_checked_or_named'],
        cwd=root/'lcnc-gateway',text=True,capture_output=True,timeout=60)
    results['unregistered_stub']={'exit':p.returncode,'stdout':p.stdout,'stderr':p.stderr}
    assert p.returncode==1 and 'codex_unregistered.pyi' in p.stdout
finally: unknown.unlink()
results['restored_problems']=check.problems()
assert results['restored_problems']==[]
Path(sys.argv[2]).write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))

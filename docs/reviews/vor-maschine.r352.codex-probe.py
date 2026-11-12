#!/usr/bin/env python3
"""R352: offline type-plan counterexamples. No product imports or services.
Usage: python3 probe.py --pyright /path/to/pyright/index.js --out /tmp/result.json
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile

p = argparse.ArgumentParser()
p.add_argument('--pyright', required=True)
p.add_argument('--out', required=True)
p.add_argument('--source', default='/tmp/codex-r352')
a = p.parse_args()
proto = '''from typing import Protocol
class Command(Protocol):
    def mdi(self, text: str, /) -> None: ...
'''
good = '''class Fake:
    def mdi(self, text: str, /) -> None:
        pass
'''
cases = [
 ('included_bad_body', {'check.py':'value: int = \"not an int\"\n'}, 1),
 ('exclude_imported_type_still_visible', {'check.py':'from omitted import value\ntext: str = value\n', 'omitted.py':'value: int = 1\n'}, 1),
 ('nominal_same_shape', {'binding.pyi': 'class command:\n    def mdi(self, text: str, /) -> None: ...\n',
  'check.py': 'from binding import command\n' + good + 'checked: command = Fake()\n'}, 1),
 ('structural_same_shape', {'check.py': proto + good + 'checked: Command = Fake()\n'}, 0),
 ('structural_wrong_argument', {'check.py': proto + good.replace('text: str', 'text: int') + 'checked: Command = Fake()\n'}, 1),
 ('structural_missing_method', {'check.py': proto + 'class Fake:\n    pass\nchecked: Command = Fake()\n'}, 1),
 ('structural_wrong_return', {'check.py': proto + 'class Fake:\n    def mdi(self, text: str, /) -> int:\n        return 1\nchecked: Command = Fake()\n'}, 1),
 ('structural_catchall_still_passes', {'check.py': proto + 'class Fake:\n    def mdi(self, *args: object, **kwargs: object) -> None:\n        pass\nchecked: Command = Fake()\nFake().mdi(1, 2, unrecognized=True)\n'}, 0),
 ('exclude_imported_body_not_gate_checked', {'check.py': 'from omitted import value\n', 'omitted.py': 'value: int = "not an int"\n'}, 0),
 ('ignore_imported_is_suppressed', {'check.py': 'from omitted import value\n', 'omitted.py': 'value: int = "not an int"\n'}, 0),
]
source = Path(a.source)
fake_source = (source / 'lcnc-gateway/fake_linuxcnc.py').read_text()
mod = ast.parse(fake_source)
cmd = next(n for n in mod.body if isinstance(n, ast.ClassDef) and n.name == '_Command')
cmd_source = ast.get_source_segment(fake_source, cmd)
cases.append(('existing_fake_unknown_and_bad_arity', {'check.py': cmd_source + '\n_Command().definitely_not_linuxcnc(1, 2, unknown=True)\n_Command().mdi(1, 2, unknown=True)\n'}, 0))
results = []
with tempfile.TemporaryDirectory(prefix='r352-type-') as tmp:
 for name, files, expected in cases:
    d = Path(tmp) / name
    d.mkdir()
    for file, content in files.items():
        (d / file).write_text(content)
    config = {'include':['check.py'], 'typeCheckingMode':'standard', 'pythonVersion':'3.11', 'pythonPlatform':'Linux'}
    if name.startswith('exclude_'):
        config['exclude'] = ['omitted.py']
    if name.startswith('ignore_'):
        config['ignore'] = ['omitted.py']
    (d/'pyrightconfig.json').write_text(json.dumps(config))
    proc = subprocess.run(['node',a.pyright,'--project',str(d/'pyrightconfig.json'),'--outputjson'], text=True, capture_output=True, timeout=30)
    data = json.loads(proc.stdout)
    observed = data['summary']['errorCount']
    results.append({'case':name,'expected_errors':expected,'errors':observed,'matches':observed==expected,
                    'exit':proc.returncode,'config':config,'files':files,'result':data,'stderr':proc.stderr})
# Extract ONLY the pure fake class, never import gateway or linuxcnc.
ns = {}
exec(compile(ast.Module(body=[cmd], type_ignores=[]), '<isolated fake class>', 'exec'), ns)
fake = ns['_Command']()
actual_fake = {'unknown_method_result':fake.definitely_not_linuxcnc(1,2,unknown=True),
               'bad_mdi_call_result':fake.mdi(1,2,unknown=True)}
# The connection counterexample is a model of the bound-command/global-CMD
# pattern in _cmd_blocking, NOT an execution or claim of a live reproduction.
class Channel:
    def __init__(self,name): self.name=name; self.serial=0
    def mdi(self,text): self.serial += 1; return [self.name,'mdi',text,self.serial]
    def wait_complete(self): return [self.name,'wait_complete',self.serial]
old, new = Channel('old'), Channel('new')
prepared = old.mdi
slot = new
mix = {'write':prepared('G4 P0'), 'booked_serial':slot.serial, 'wait':slot.wait_complete()}
out = {'tool':subprocess.check_output(['node',a.pyright,'--version'],text=True).strip(),
       'product_target':'faa33958','isolation':'temporary snippets; fake class extracted by AST; no live imports/access',
       'source_hashes':{rel:hashlib.sha256((source/rel).read_bytes()).hexdigest() for rel in ['lcnc-gateway/fake_linuxcnc.py','lcnc-gateway/gateway.py','lcnc-gateway/writer_fixture.py']},
       'checks':results,'actual_fake_results':actual_fake,'connection_pattern_model':mix,
       'all_match':all(r['matches'] for r in results)}
Path(a.out).write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'tool':out['tool'],'checks':[{k:v for k,v in r.items() if k in ('case','expected_errors','errors','matches')} for r in results], 'actual_fake_results':actual_fake,'connection_pattern_model':mix,'all_match':out['all_match']},indent=2))
raise SystemExit(0 if out['all_match'] else 1)

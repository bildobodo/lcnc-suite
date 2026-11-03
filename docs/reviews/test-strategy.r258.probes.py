"""R258 probes. Usage: python probes.py TMP_WORK
Only TMP_WORK/repo and TMP_WORK are written; no machine/browser connection.
"""
from pathlib import Path
from unittest.mock import patch
import contextlib, dataclasses, hashlib, json, subprocess, sys
w=Path(sys.argv[1]).resolve(); repo=w/'repo'
assert str(w).startswith('/tmp/')
sys.path.insert(0,str(repo/'scripts'))
from test_select import reads, selector, proof, round_gate
result={'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()}
@contextlib.contextmanager
def edit(rel,fn):
 p=repo/rel;old=p.read_bytes()
 try:
  p.write_text(fn(old.decode()));yield p
 finally:p.write_bytes(old)
assert reads.problems(repo)==[]
extra='readFileSync(["..", "scripts", "test_fixtures", "macro_refusals.json"].join("/"), "utf8");'
known='const bundle = JSON.parse(readFileSync(new URL("../../test-fixtures/freecad/custom-native.json", import.meta.url), "utf8"));'
file='lcnc-webui/e2e/freecad-import.spec.ts'
variants={
 'r257_same_line':lambda s:s.replace(known,known+' '+extra),
 'r257_split_call':lambda s:s+'\n'+extra.replace('readFileSync(', 'readFileSync\n(')+'\n',
 'alias':lambda s:s+'\nconst rd = readFileSync;\n'+extra.replace('readFileSync(', 'rd(')+'\n',
}
for name,fn in variants.items():
 with edit(file,fn) as p:
  problems=reads.problems(repo);assert problems,(name,problems)
  result[name]={'problems':problems}
# The same namespace form the scanner promises to handle, with legal whitespace.
heavy='lcnc-webui/src/viewer/collisionContacts.test.ts'
for name,form in {
 'namespace_direct':'fs.readFileSync',
 'namespace_space':'fs .readFileSync',
 'namespace_wrap':'fs.\nreadFileSync',
}.items():
 added=extra.replace('readFileSync(',form+'(')
 with edit(heavy,lambda s:s+'\n'+added+'\n') as p:
  problems=reads.problems(repo)
  assert bool(problems)==(name=='namespace_direct'),(name,problems)
  result[name]={'file':heavy,'added':added,'problems':problems}
  if name=='namespace_wrap':
   r=subprocess.run(['/home/cnc/lcnc-suite-tiers/lcnc-gateway/.venv/bin/python3','-B','-m','pytest','-q','-p','no:cacheprovider','scripts/test_select/test_selector.py','-k','not test_a_listening_port_is_seen'],cwd=repo,text=True,capture_output=True)
   (w/'mutant-guards.txt').write_text(r.stdout+r.stderr)
   result[name]['selection_guards']={'exit':r.returncode,'output':r.stdout}
   assert r.returncode==0
 # Execute the additional expression independently in native Node; report only its byte length.
 expression=added.removesuffix(';')
 code='import fs from "node:fs";\nconsole.log('+expression+'.length);'
 r=subprocess.run(['node','--input-type=module','-e',code],cwd=repo/'lcnc-webui',capture_output=True,text=True)
 assert r.returncode==0,r.stderr
 result[name]['node_read_bytes']=int(r.stdout)
# A mixed import is also a normal Node import; unrecognized import syntax must not look read-free.
added='\nimport r258fs, { constants as r258constants } from "node:fs";\n'+extra.replace('readFileSync(', 'r258fs.readFileSync(')+'\nvoid r258constants;\n'
with edit(file,lambda s:s+added):
 problems=reads.problems(repo);assert problems==[],problems
 result['mixed_import']={'file':file,'added':added,'problems':problems}
 code='import r258fs, { constants as r258constants } from "node:fs";\nconsole.log(r258fs.readFileSync(["..", "scripts", "test_fixtures", "macro_refusals.json"].join("/"), "utf8").length);\nvoid r258constants;'
 r=subprocess.run(['node','--input-type=module','-e',code],cwd=repo/'lcnc-webui',capture_output=True,text=True,check=True)
 result['mixed_import']['node_read_bytes']=int(r.stdout)
with patch.object(selector,'changed_paths',return_value=[('M','scripts/test_fixtures/macro_refusals.json')]):
 sel=selector.select(repo,'HEAD','HEAD',[])
result['data_only_selection']={'heavy':sel['unit']['heavy'],'browser':sel['browser']['run'], 'collisionContacts_selected':heavy in sel['unit']['heavy'],'freecad_selected':'freecad-import' in sel['browser']['run']}
assert not result['data_only_selection']['collisionContacts_selected'] and not result['data_only_selection']['freecad_selected']
# Control the real unit runner with a test passing on its only attempt.
p=repo/'lcnc-webui/src/r258Control.test.ts';assert not p.exists()
logs=w/'control-logs';logs.mkdir(exist_ok=True)
try:
 p.write_text('import { expect, it } from "vitest";\nit("R258 control", () => { expect(1).toBe(1); });\n')
 result['unit_control']=round_gate.unit('control',['src/r258Control.test.ts'],[],logs)
 assert result['unit_control']['status']=='PASS',result['unit_control']
finally:p.unlink()
result['retry']=json.loads((w/'retry-result.json').read_text())
assert result['retry']['status']=='FAIL' and any('passed only after a failed attempt' in s for s in result['retry']['why'])
# Recheck the existing round3 unit report, not a new full run.
logs=Path('/home/cnc/lcnc-suite-tiers/docs/reviews/test-tiers.round3.gate-round.logs')
lst=json.loads((logs/'unit-light.list.json').read_text());ran=json.loads((logs/'unit-light.json').read_text())
assert proof.check_unit_executed(lst,ran)==[]
assert proof.vitest_retried(ran)==[]
result['round3_raw_report']={'listed':len(lst),'assertions':sum(proof.vitest_ran(ran).values()),'retried':proof.vitest_retried(ran),
 'sha256':{f:hashlib.sha256((logs/f).read_bytes()).hexdigest() for f in ['unit-light.list.json','unit-light.json']}}
assert subprocess.check_output(['git','status','--porcelain'],cwd=repo)==b''
(w/'results.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
print(json.dumps(result,indent=2,ensure_ascii=False))
